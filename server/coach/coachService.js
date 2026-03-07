import {
  HISTORY_WINDOW_SIZE,
  parseCoachModelJson,
  truncateHistoryWindow,
  validateCoachModelPayload,
  validateCoachRequest,
} from './coachSchema.js';
import { buildHandContext } from './handContext.js';
import { buildCoachMessages, buildCoachRepairMessages } from './coachPrompt.js';
import { createCoachError } from './errors.js';
import { getLlmProvider } from './providers/index.js';

const DEFAULT_TIMEOUT_MS = 25000;
const STREET_ORDER = ['preflop', 'flop', 'turn', 'river'];

function parseTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(n), 1000), 120000);
}

function summarizeAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return 'no attempt details';
  const counts = new Map();
  for (const attempt of attempts) {
    const reason = String(attempt?.reason || 'unknown');
    const statusPart = Number.isFinite(Number(attempt?.status)) ? `:${Number(attempt.status)}` : '';
    const key = `${reason}${statusPart}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => `${key}x${count}`)
    .join(', ');
}

function latestModelFromAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const latest = attempts[attempts.length - 1];
  return latest?.model || null;
}

function extractValidationFailures(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return [];
  const failures = [];
  for (const attempt of attempts) {
    if (attempt?.reason !== 'invalid_output') continue;
    if (Array.isArray(attempt?.validationFailures)) {
      failures.push(...attempt.validationFailures.map((item) => String(item)));
      continue;
    }
    if (attempt?.detail) {
      failures.push(String(attempt.detail));
    }
  }
  return [...new Set(failures.filter(Boolean))];
}

function getRequiredStreetVerdictSet(handContext) {
  const required = new Set();
  const heroStreetSummary = handContext?.heroStreetSummary || {};

  for (const street of STREET_ORDER) {
    const summary = heroStreetSummary[street];
    const action = typeof summary?.action === 'string' ? summary.action.trim().toLowerCase() : '';
    if (action && action !== 'none') {
      required.add(street);
    }
  }

  return required;
}

function validateStreetCoverage(validatedPayload, handContext) {
  const required = getRequiredStreetVerdictSet(handContext);
  if (required.size === 0) {
    return;
  }

  const provided = new Set(validatedPayload?.assistant?.analysis?.streetVerdicts?.map((item) => item.street));
  const missing = Array.from(required).filter((street) => !provided.has(street));
  if (missing.length > 0) {
    throw createCoachError(
      `assistant.analysis.streetVerdicts must include acted streets: ${missing.join(', ')}.`,
      {
        statusCode: 502,
        code: 'COACH_MODEL_SCHEMA_INVALID',
        details: { missingStreets: missing },
      }
    );
  }
}

function normalizeFactValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).toUpperCase());
  }
  if (typeof value === 'string') return value.toUpperCase();
  return value;
}

function validateFactCheckAgainstGroundTruth(validatedPayload, handContext) {
  const expected = handContext?.factCheckGroundTruth || {};
  const actual = validatedPayload?.assistant?.analysis?.factCheck || {};
  const failures = [];

  const checks = [
    ['heroCards', expected.heroCards, actual.heroCards],
    ['heroHandCode', expected.heroHandCode, actual.heroHandCode],
    ['heroPosition', expected.heroPosition, actual.heroPosition],
    ['preflopLastAggressorPosition', expected.preflopLastAggressorPosition, actual.preflopLastAggressorPosition],
    ['heroWasPreflopAggressor', expected.heroWasPreflopAggressor, actual.heroWasPreflopAggressor],
    ['heroCanCbetFlop', expected.heroCanCbetFlop, actual.heroCanCbetFlop],
    ['heroPostflopPosition', expected.heroPostflopPosition, actual.heroPostflopPosition],
  ];

  for (const [label, expectedValue, actualValue] of checks) {
    const left = normalizeFactValue(expectedValue);
    const right = normalizeFactValue(actualValue);
    const same = Array.isArray(left)
      ? Array.isArray(right) && left.length === right.length && left.every((item, index) => item === right[index])
      : left === right;
    if (!same) {
      failures.push(`${label} mismatch (expected: ${JSON.stringify(expectedValue)}, got: ${JSON.stringify(actualValue)}).`);
    }
  }

  if (failures.length > 0) {
    throw createCoachError('Coach response failed fact-check validation.', {
      statusCode: 502,
      code: 'COACH_FACT_CHECK_FAILED',
      details: {
        validationFailures: failures,
      },
    });
  }
}

function parseAndValidateModelContent(content, handContext) {
  const parsed = parseCoachModelJson(content);
  const validatedPayload = validateCoachModelPayload(parsed);
  validateStreetCoverage(validatedPayload, handContext);
  validateFactCheckAgainstGroundTruth(validatedPayload, handContext);
  return validatedPayload;
}

function getInvalidOutputSnippet(error) {
  const attempts = Array.isArray(error?.details?.attempts) ? error.details.attempts : [];
  const lastInvalid = attempts
    .filter((attempt) => attempt.reason === 'invalid_output' && attempt.contentSnippet)
    .slice(-1)[0];
  return lastInvalid?.contentSnippet || '';
}

function getInvalidOutputDiagnostics(error) {
  const attempts = Array.isArray(error?.details?.attempts) ? error.details.attempts : [];
  const invalidAttempts = attempts.filter((attempt) => attempt.reason === 'invalid_output');
  const previousOutput = invalidAttempts.slice(-1)[0]?.contentSnippet || '';
  const validationFailures = [];

  for (const attempt of invalidAttempts) {
    if (Array.isArray(attempt?.validationFailures)) {
      validationFailures.push(...attempt.validationFailures.map((item) => String(item)));
    }
    if (attempt?.detail) {
      validationFailures.push(String(attempt.detail));
    }
  }

  return {
    previousOutput,
    validationFailures: [...new Set(validationFailures.map((item) => item.trim()).filter(Boolean))],
  };
}

export async function coachHand(payload, options = {}) {
  const request = validateCoachRequest(payload);
  const { history: historyWindow, truncated, windowSize } = truncateHistoryWindow(request.history, HISTORY_WINDOW_SIZE);

  const handContext = buildHandContext(request.hand);
  const provider =
    options.provider || getLlmProvider(options.providerName || process.env.COACH_PROVIDER || 'openrouter', options.providerOptions || {});
  const timeoutMs = parseTimeoutMs(options.timeoutMs ?? process.env.COACH_REQUEST_TIMEOUT_MS);

  const warnings = [];
  if (truncated) {
    warnings.push(`History truncated to the last ${windowSize} messages.`);
  }

  const firstPassMessages = buildCoachMessages({
    handContext,
    history: historyWindow,
    message: request.message,
    historyWindowSize: windowSize,
  });
  const modelContentValidator = (content) => {
    parseAndValidateModelContent(content, handContext);
  };

  let generation;

  try {
    generation = await provider.generate({
      messages: firstPassMessages,
      timeoutMs,
      validateContent: modelContentValidator,
    });
  } catch (error) {
    if (error?.code !== 'COACH_PROVIDER_OUTPUT_INVALID') {
      throw error;
    }

    warnings.push('Coach output required one repair retry to return valid JSON.');
    const diagnostics = getInvalidOutputDiagnostics(error);

    const repairMessages = buildCoachRepairMessages({
      handContext,
      history: historyWindow,
      message: request.message,
      previousOutput: diagnostics.previousOutput || getInvalidOutputSnippet(error),
      validationError: error?.message || 'Invalid JSON/schema from model.',
      validationFailures: diagnostics.validationFailures,
      historyWindowSize: windowSize,
    });

    try {
      generation = await provider.generate({
        messages: repairMessages,
        timeoutMs,
        validateContent: modelContentValidator,
      });
    } catch (repairError) {
      const attempts = repairError?.details?.attempts || error?.details?.attempts || [];
      const validationFailures = extractValidationFailures(attempts);
      throw createCoachError('Coach output remained invalid after one repair retry.', {
        statusCode: 502,
        code: 'COACH_REPAIR_FAILED',
        details: {
          firstPassErrorCode: error?.code || null,
          repairErrorCode: repairError?.code || null,
          attempts: attempts.length > 0 ? attempts : null,
          validationFailures,
          attemptSummary: summarizeAttempts(attempts),
          lastModel: latestModelFromAttempts(attempts),
        },
      });
    }
  }

  let parsedPayload;
  try {
    parsedPayload = parseAndValidateModelContent(generation.content, handContext);
  } catch (error) {
    const attempts = generation?.attempts || [];
    if (error?.details == null) {
      error.details = {};
    }
    if (!Array.isArray(error.details.validationFailures) || error.details.validationFailures.length === 0) {
      error.details.validationFailures = [error?.message || 'Model output failed validation.'];
    }
    if (!error.details.attemptSummary) {
      error.details.attemptSummary = summarizeAttempts(attempts);
    }
    if (!error.details.lastModel) {
      error.details.lastModel = generation?.model || latestModelFromAttempts(attempts);
    }
    throw error;
  }

  return {
    assistant: parsedPayload.assistant,
    meta: {
      provider: generation.provider || provider.name || 'openrouter',
      model: generation.model,
      fallbackUsed: Boolean(generation.fallbackUsed),
      historyWindowUsed: windowSize,
      truncatedHistory: truncated,
    },
    warnings,
  };
}
