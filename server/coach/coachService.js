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

function parseAndValidateModelContent(content, handContext) {
  const parsed = parseCoachModelJson(content);
  const validatedPayload = validateCoachModelPayload(parsed);
  validateStreetCoverage(validatedPayload, handContext);
  return validatedPayload;
}

function getInvalidOutputSnippet(error) {
  const attempts = Array.isArray(error?.details?.attempts) ? error.details.attempts : [];
  const lastInvalid = attempts
    .filter((attempt) => attempt.reason === 'invalid_output' && attempt.contentSnippet)
    .slice(-1)[0];
  return lastInvalid?.contentSnippet || '';
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
  let usedRepairRetry = false;

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

    usedRepairRetry = true;
    warnings.push('Coach output required one repair retry to return valid JSON.');

    const repairMessages = buildCoachRepairMessages({
      handContext,
      history: historyWindow,
      message: request.message,
      previousOutput: getInvalidOutputSnippet(error),
      validationError: error?.message || 'Invalid JSON/schema from model.',
      historyWindowSize: windowSize,
    });

    try {
      generation = await provider.generate({
        messages: repairMessages,
        timeoutMs,
        validateContent: modelContentValidator,
      });
    } catch (repairError) {
      throw createCoachError('Coach output remained invalid after one repair retry.', {
        statusCode: 502,
        code: 'COACH_REPAIR_FAILED',
        details: {
          firstPassErrorCode: error?.code || null,
          repairErrorCode: repairError?.code || null,
          attempts: repairError?.details?.attempts || error?.details?.attempts || null,
        },
      });
    }
  }

  const parsedPayload = parseAndValidateModelContent(generation.content, handContext);

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
