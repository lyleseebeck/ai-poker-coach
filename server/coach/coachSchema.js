import { createCoachError } from './errors.js';

export const HISTORY_WINDOW_SIZE = 8;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_HISTORY_CONTENT_LENGTH = 2000;
export const MAX_HISTORY_ITEMS = 40;
export const COACH_VERDICTS = ['correct', 'mixed', 'incorrect', 'unclear'];
export const COACH_STREETS = ['preflop', 'flop', 'turn', 'river'];
export const COACH_POSTFLOP_POSITION = ['out_of_position', 'in_position', 'unknown'];
const CBET_PATTERN = /\bc[\s-]?bet\b|\bcontinuation[\s-]?bet\b/i;
const POSITIONALLY_INCORRECT_PATTERN = /\bin[\s-]?position\b|\bcheck[\s-]?back\b/i;
const NEGATION_PATTERN = /\b(cannot|can't|can not|not able|unable|do not|don't|out of position|oop)\b/i;
const PERCENT_PATTERN = /\b\d+(\.\d+)?\s*%/;

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readTrimmedString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function requireStringField(value, label, maxLength, statusCode = 400) {
  const text = readTrimmedString(value);
  if (!text) {
    throw createCoachError(`${label} is required.`, {
      statusCode,
      code: statusCode >= 500 ? 'COACH_MODEL_SCHEMA_INVALID' : 'COACH_REQUEST_INVALID',
    });
  }
  if (text.length > maxLength) {
    throw createCoachError(`${label} must be <= ${maxLength} characters.`, {
      statusCode,
      code: statusCode >= 500 ? 'COACH_MODEL_SCHEMA_INVALID' : 'COACH_REQUEST_INVALID',
    });
  }
  return text;
}

function requireStringArray(value, label, maxItemLength, statusCode = 500) {
  if (!Array.isArray(value)) {
    throw createCoachError(`${label} must be an array of strings.`, {
      statusCode,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }
  return value.map((item, index) =>
    requireStringField(item, `${label}[${index}]`, maxItemLength, statusCode)
  );
}

function requireOptionalStringArray(value, label, maxItemLength, statusCode = 500) {
  if (value == null) return [];
  return requireStringArray(value, label, maxItemLength, statusCode);
}

function requireEnumField(value, label, allowedValues, statusCode = 500) {
  const normalized = requireStringField(value, label, 120, statusCode).toLowerCase();
  if (!allowedValues.includes(normalized)) {
    throw createCoachError(`${label} must be one of: ${allowedValues.join(', ')}.`, {
      statusCode,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }
  return normalized;
}

function requireBooleanField(value, label, statusCode = 500) {
  if (typeof value !== 'boolean') {
    throw createCoachError(`${label} must be a boolean.`, {
      statusCode,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }
  return value;
}

function validateCardText(value, label, statusCode = 500) {
  const text = requireStringField(value, label, 3, statusCode);
  if (!/^[2-9TJQKA][shdc]$/i.test(text)) {
    throw createCoachError(`${label} must be a valid card like As or Td.`, {
      statusCode,
      code: 'COACH_FACT_CHECK_FAILED',
    });
  }
  return `${text[0].toUpperCase()}${text[1].toLowerCase()}`;
}

function normalizeRankValue(rank) {
  return '23456789TJQKA'.indexOf(rank);
}

function buildHandCodeFromCards(cards) {
  if (!Array.isArray(cards) || cards.length !== 2) return null;
  const rankA = cards[0][0];
  const suitA = cards[0][1];
  const rankB = cards[1][0];
  const suitB = cards[1][1];
  if (rankA === rankB) return `${rankA}${rankB}`;
  const first = normalizeRankValue(rankA) >= normalizeRankValue(rankB) ? rankA : rankB;
  const second = first === rankA ? rankB : rankA;
  return `${first}${second}${suitA === suitB ? 's' : 'o'}`;
}

function collectAnalysisText(content, analysis) {
  const lines = [content, analysis?.overallReason];
  for (const item of analysis?.streetVerdicts || []) {
    lines.push(item.heroAction, item.reason, item.gtoPreferredAction);
  }
  for (const group of ['keyAdjustments']) {
    for (const item of analysis?.[group] || []) {
      lines.push(item);
    }
  }
  return lines.map((item) => String(item || '').trim()).filter(Boolean);
}

function isLikelyContradictoryRecommendation(text, pattern) {
  if (!pattern.test(text)) return false;
  return !NEGATION_PATTERN.test(text);
}

function extractJsonCandidate(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';

  const fullFence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fullFence) return fullFence[1].trim();

  const partialFence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (partialFence) return partialFence[1].trim();

  return text;
}

export function validateCoachRequest(payload) {
  if (!isPlainObject(payload)) {
    throw createCoachError('Request body must be a JSON object.', {
      statusCode: 400,
      code: 'COACH_REQUEST_INVALID',
    });
  }

  const handId = requireStringField(payload.handId, 'handId', 200);

  if (!isPlainObject(payload.hand)) {
    throw createCoachError('hand must be an object.', {
      statusCode: 400,
      code: 'COACH_REQUEST_INVALID',
    });
  }
  if (Number(payload.hand.schemaVersion) !== 2) {
    throw createCoachError('hand.schemaVersion must be 2.', {
      statusCode: 400,
      code: 'COACH_REQUEST_INVALID',
    });
  }

  const message = requireStringField(payload.message, 'message', MAX_MESSAGE_LENGTH);

  const rawHistory = payload.history == null ? [] : payload.history;
  if (!Array.isArray(rawHistory)) {
    throw createCoachError('history must be an array.', {
      statusCode: 400,
      code: 'COACH_REQUEST_INVALID',
    });
  }
  if (rawHistory.length > MAX_HISTORY_ITEMS) {
    throw createCoachError(`history must include at most ${MAX_HISTORY_ITEMS} messages.`, {
      statusCode: 400,
      code: 'COACH_REQUEST_INVALID',
    });
  }

  const history = rawHistory.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw createCoachError(`history[${index}] must be an object.`, {
        statusCode: 400,
        code: 'COACH_REQUEST_INVALID',
      });
    }

    const role = readTrimmedString(entry.role).toLowerCase();
    if (role !== 'user' && role !== 'assistant') {
      throw createCoachError(`history[${index}].role must be "user" or "assistant".`, {
        statusCode: 400,
        code: 'COACH_REQUEST_INVALID',
      });
    }

    const content = requireStringField(
      entry.content,
      `history[${index}].content`,
      MAX_HISTORY_CONTENT_LENGTH
    );

    return { role, content };
  });

  return {
    handId,
    hand: payload.hand,
    message,
    history,
  };
}

export function truncateHistoryWindow(history, windowSize = HISTORY_WINDOW_SIZE) {
  const safeHistory = Array.isArray(history) ? history : [];
  const resolvedWindow = Number.isInteger(windowSize) && windowSize > 0 ? windowSize : HISTORY_WINDOW_SIZE;
  if (safeHistory.length <= resolvedWindow) {
    return {
      history: safeHistory,
      truncated: false,
      windowSize: resolvedWindow,
    };
  }

  return {
    history: safeHistory.slice(-resolvedWindow),
    truncated: true,
    windowSize: resolvedWindow,
  };
}

export function parseCoachModelJson(rawText) {
  const candidate = extractJsonCandidate(rawText);
  if (!candidate) {
    throw createCoachError('Coach model returned empty content.', {
      statusCode: 502,
      code: 'COACH_MODEL_INVALID_JSON',
    });
  }

  try {
    return JSON.parse(candidate);
  } catch {
    throw createCoachError('Coach model returned invalid JSON.', {
      statusCode: 502,
      code: 'COACH_MODEL_INVALID_JSON',
      details: {
        snippet: candidate.slice(0, 500),
      },
    });
  }
}

export function deriveOverallVerdictFromStreetVerdicts(streetVerdicts) {
  const verdicts = Array.isArray(streetVerdicts) ? streetVerdicts.map((item) => String(item?.verdict || '').toLowerCase()) : [];
  if (verdicts.includes('incorrect')) return 'incorrect';
  if (verdicts.includes('mixed')) return 'mixed';
  if (verdicts.includes('correct')) return 'correct';
  return 'unclear';
}

function validateFactCheck(factCheckRaw) {
  if (!isPlainObject(factCheckRaw)) {
    throw createCoachError('assistant.analysis.factCheck must be an object.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }

  if (!Array.isArray(factCheckRaw.heroCards) || factCheckRaw.heroCards.length !== 2) {
    throw createCoachError('assistant.analysis.factCheck.heroCards must contain exactly 2 cards.', {
      statusCode: 502,
      code: 'COACH_FACT_CHECK_FAILED',
    });
  }
  const factHeroCards = factCheckRaw.heroCards.map((card, index) =>
    validateCardText(card, `assistant.analysis.factCheck.heroCards[${index}]`, 502)
  );
  const derivedHandCode = buildHandCodeFromCards(factHeroCards);
  const factHeroHandCode = requireStringField(
    factCheckRaw.heroHandCode,
    'assistant.analysis.factCheck.heroHandCode',
    10,
    502
  ).toUpperCase();
  if (derivedHandCode && factHeroHandCode !== derivedHandCode.toUpperCase()) {
    throw createCoachError(
      'assistant.analysis.factCheck.heroHandCode must match heroCards suitedness and ranks.',
      {
        statusCode: 502,
        code: 'COACH_FACT_CHECK_FAILED',
      }
    );
  }

  return {
    heroCards: factHeroCards,
    heroHandCode: factHeroHandCode,
    heroPosition: requireStringField(factCheckRaw.heroPosition, 'assistant.analysis.factCheck.heroPosition', 40, 502).toUpperCase(),
    preflopLastAggressorPosition: requireStringField(
      factCheckRaw.preflopLastAggressorPosition,
      'assistant.analysis.factCheck.preflopLastAggressorPosition',
      40,
      502
    ).toUpperCase(),
    heroWasPreflopAggressor: requireBooleanField(
      factCheckRaw.heroWasPreflopAggressor,
      'assistant.analysis.factCheck.heroWasPreflopAggressor',
      502
    ),
    heroCanCbetFlop: requireBooleanField(
      factCheckRaw.heroCanCbetFlop,
      'assistant.analysis.factCheck.heroCanCbetFlop',
      502
    ),
    heroPostflopPosition: requireEnumField(
      factCheckRaw.heroPostflopPosition,
      'assistant.analysis.factCheck.heroPostflopPosition',
      COACH_POSTFLOP_POSITION,
      502
    ),
  };
}

function validateStreetVerdicts(streetVerdictsRaw) {
  if (!Array.isArray(streetVerdictsRaw)) {
    throw createCoachError('assistant.analysis.streetVerdicts must be an array.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }
  const seenStreets = new Set();
  return streetVerdictsRaw.map((item, index) => {
    if (!isPlainObject(item)) {
      throw createCoachError(`assistant.analysis.streetVerdicts[${index}] must be an object.`, {
        statusCode: 502,
        code: 'COACH_MODEL_SCHEMA_INVALID',
      });
    }

    const street = requireEnumField(
      item.street,
      `assistant.analysis.streetVerdicts[${index}].street`,
      COACH_STREETS,
      502
    );
    if (seenStreets.has(street)) {
      throw createCoachError(`assistant.analysis.streetVerdicts contains duplicate street: ${street}.`, {
        statusCode: 502,
        code: 'COACH_MODEL_SCHEMA_INVALID',
      });
    }
    seenStreets.add(street);

    return {
      street,
      heroAction: requireStringField(
        item.heroAction,
        `assistant.analysis.streetVerdicts[${index}].heroAction`,
        500,
        502
      ),
      verdict: requireEnumField(
        item.verdict,
        `assistant.analysis.streetVerdicts[${index}].verdict`,
        COACH_VERDICTS,
        502
      ),
      reason: requireStringField(item.reason, `assistant.analysis.streetVerdicts[${index}].reason`, 1800, 502),
      gtoPreferredAction: requireStringField(
        item.gtoPreferredAction,
        `assistant.analysis.streetVerdicts[${index}].gtoPreferredAction`,
        600,
        502
      ),
    };
  });
}

export function validateInitialCoachModelPayload(payload) {
  if (!isPlainObject(payload)) {
    throw createCoachError('Coach model payload must be a JSON object.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }

  const assistantObj = payload.assistant;
  if (!isPlainObject(assistantObj)) {
    throw createCoachError('assistant must be an object.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }

  const content = requireStringField(assistantObj.content, 'assistant.content', 6000, 502);

  const analysis = assistantObj.analysis;
  if (!isPlainObject(analysis)) {
    throw createCoachError('assistant.analysis must be an object.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }

  const factCheck = validateFactCheck(analysis.factCheck);
  const confidence = requireEnumField(analysis.confidence, 'assistant.analysis.confidence', ['low', 'medium', 'high'], 502);
  const streetVerdicts = validateStreetVerdicts(analysis.streetVerdicts);
  const keyAdjustments = requireStringArray(analysis.keyAdjustments, 'assistant.analysis.keyAdjustments', 1200, 502);
  const dedupedKeyAdjustments = [...new Set(keyAdjustments)];
  if (dedupedKeyAdjustments.length === 0) {
    throw createCoachError('assistant.analysis.keyAdjustments must include at least 1 item.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }
  if (dedupedKeyAdjustments.length > 5) {
    throw createCoachError('assistant.analysis.keyAdjustments must include at most 5 items.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }

  const normalizedAnalysis = {
    factCheck,
    overallVerdict: deriveOverallVerdictFromStreetVerdicts(streetVerdicts),
    overallReason: requireStringField(analysis.overallReason, 'assistant.analysis.overallReason', 4000, 502),
    streetVerdicts,
    keyAdjustments: dedupedKeyAdjustments,
    confidence,
  };

  const allText = collectAnalysisText(content, normalizedAnalysis);
  if (allText.some((text) => PERCENT_PATTERN.test(text))) {
    throw createCoachError('Explicit percentage frequencies are not allowed in coach output.', {
      statusCode: 502,
      code: 'COACH_CONSISTENCY_FAILED',
      details: {
        validationFailures: ['Use qualitative frequencies (low/high/mixed) instead of numeric percentages.'],
      },
    });
  }

  if (!factCheck.heroCanCbetFlop && allText.some((text) => isLikelyContradictoryRecommendation(text, CBET_PATTERN))) {
    throw createCoachError('Coach output contains illegal flop c-bet guidance for this hand context.', {
      statusCode: 502,
      code: 'COACH_LEGALITY_FAILED',
      details: {
        validationFailures: ['Hero cannot c-bet flop in this hand, but output recommended c-betting.'],
      },
    });
  }

  if (
    factCheck.heroPostflopPosition === 'out_of_position' &&
    allText.some((text) => isLikelyContradictoryRecommendation(text, POSITIONALLY_INCORRECT_PATTERN))
  ) {
    throw createCoachError('Coach output conflicts with out-of-position postflop facts.', {
      statusCode: 502,
      code: 'COACH_CONSISTENCY_FAILED',
      details: {
        validationFailures: ['Output implied in-position play while hero is out of position.'],
      },
    });
  }

  return {
    assistant: {
      content,
      analysis: normalizedAnalysis,
    },
  };
}

export function validateFollowupCoachModelPayload(payload) {
  if (!isPlainObject(payload)) {
    throw createCoachError('Coach model payload must be a JSON object.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }

  const assistantObj = payload.assistant;
  if (!isPlainObject(assistantObj)) {
    throw createCoachError('assistant must be an object.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }

  const content = requireStringField(assistantObj.content, 'assistant.content', 6000, 502);
  const followupHighlights = requireOptionalStringArray(
    assistantObj.followupHighlights,
    'assistant.followupHighlights',
    800,
    502
  );
  if (followupHighlights.length > 5) {
    throw createCoachError('assistant.followupHighlights must include at most 5 items.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }

  return {
    assistant: {
      content,
      followupHighlights,
    },
  };
}

export function validateCoachModelPayload(payload) {
  return validateInitialCoachModelPayload(payload);
}
