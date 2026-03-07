import { createCoachError } from './errors.js';

export const HISTORY_WINDOW_SIZE = 8;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_HISTORY_CONTENT_LENGTH = 2000;
export const MAX_HISTORY_ITEMS = 40;
export const COACH_VERDICTS = ['correct', 'mixed', 'incorrect', 'unclear'];
export const COACH_STREETS = ['preflop', 'flop', 'turn', 'river'];

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

export function validateCoachModelPayload(payload) {
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

  const confidence = requireEnumField(analysis.confidence, 'assistant.analysis.confidence', ['low', 'medium', 'high'], 502);
  const overallVerdict = requireEnumField(
    analysis.overallVerdict,
    'assistant.analysis.overallVerdict',
    COACH_VERDICTS,
    502
  );

  const streetVerdictsRaw = analysis.streetVerdicts;
  if (!Array.isArray(streetVerdictsRaw)) {
    throw createCoachError('assistant.analysis.streetVerdicts must be an array.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }
  const seenStreets = new Set();
  const streetVerdicts = streetVerdictsRaw.map((item, index) => {
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

  const topAlternatives = requireStringArray(
    analysis.topAlternatives,
    'assistant.analysis.topAlternatives',
    1200,
    502
  );
  if (topAlternatives.length !== 2) {
    throw createCoachError('assistant.analysis.topAlternatives must contain exactly 2 items.', {
      statusCode: 502,
      code: 'COACH_MODEL_SCHEMA_INVALID',
    });
  }

  return {
    assistant: {
      content,
      analysis: {
        overallVerdict,
        overallReason: requireStringField(analysis.overallReason, 'assistant.analysis.overallReason', 4000, 502),
        streetVerdicts,
        biggestLeaks: requireStringArray(analysis.biggestLeaks, 'assistant.analysis.biggestLeaks', 1200, 502),
        gtoCorrections: requireStringArray(analysis.gtoCorrections, 'assistant.analysis.gtoCorrections', 1200, 502),
        topAlternatives,
        exploitativeAdjustments: requireStringArray(
          analysis.exploitativeAdjustments,
          'assistant.analysis.exploitativeAdjustments',
          1200,
          502
        ),
        confidence,
      },
    },
  };
}
