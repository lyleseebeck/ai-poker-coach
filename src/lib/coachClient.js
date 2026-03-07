function ensureObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function ensureString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function ensureStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((item, index) => ensureString(item, `${label}[${index}]`));
}

function parseJsonSafely(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractErrorMessage(status, statusText, payloadText) {
  const payloadJson = parseJsonSafely(payloadText);
  const detail =
    payloadJson?.error?.message ||
    payloadJson?.message ||
    payloadText ||
    `${status} ${statusText}`;
  return `Coach request failed: ${detail}`;
}

function normalizeCoachResponse(raw) {
  const body = ensureObject(raw, 'Coach response');
  const assistant = ensureObject(body.assistant, 'assistant');
  const analysis = ensureObject(assistant.analysis, 'assistant.analysis');
  const streetPlan = ensureObject(analysis.streetPlan, 'assistant.analysis.streetPlan');
  const meta = ensureObject(body.meta, 'meta');

  const confidence = ensureString(analysis.confidence, 'assistant.analysis.confidence').toLowerCase();
  if (!['low', 'medium', 'high'].includes(confidence)) {
    throw new Error('assistant.analysis.confidence must be one of low, medium, high.');
  }

  return {
    assistant: {
      content: ensureString(assistant.content, 'assistant.content'),
      analysis: {
        situationSummary: ensureString(analysis.situationSummary, 'assistant.analysis.situationSummary'),
        biggestLeaks: ensureStringArray(analysis.biggestLeaks, 'assistant.analysis.biggestLeaks'),
        gtoCorrections: ensureStringArray(analysis.gtoCorrections, 'assistant.analysis.gtoCorrections'),
        streetPlan: {
          preflop: ensureString(streetPlan.preflop, 'assistant.analysis.streetPlan.preflop'),
          flop: ensureString(streetPlan.flop, 'assistant.analysis.streetPlan.flop'),
          turn: ensureString(streetPlan.turn, 'assistant.analysis.streetPlan.turn'),
          river: ensureString(streetPlan.river, 'assistant.analysis.streetPlan.river'),
        },
        exploitativeAdjustments: ensureStringArray(
          analysis.exploitativeAdjustments,
          'assistant.analysis.exploitativeAdjustments'
        ),
        practiceDrills: ensureStringArray(analysis.practiceDrills, 'assistant.analysis.practiceDrills'),
        nextSessionFocus: ensureString(analysis.nextSessionFocus, 'assistant.analysis.nextSessionFocus'),
        confidence,
        assumptions: ensureStringArray(analysis.assumptions, 'assistant.analysis.assumptions'),
      },
    },
    meta: {
      provider: ensureString(meta.provider, 'meta.provider'),
      model: ensureString(meta.model, 'meta.model'),
      fallbackUsed: Boolean(meta.fallbackUsed),
      historyWindowUsed: Number(meta.historyWindowUsed) || 0,
      truncatedHistory: Boolean(meta.truncatedHistory),
    },
    warnings: Array.isArray(body.warnings) ? body.warnings.map((item) => String(item)) : [],
  };
}

export async function coachHand(payload, options = {}) {
  const response = await fetch('/api/coach-hand', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
    signal: options.signal,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(extractErrorMessage(response.status, response.statusText, text));
  }

  const json = parseJsonSafely(text);
  if (!json) {
    throw new Error('Coach request failed: response was not valid JSON.');
  }

  return normalizeCoachResponse(json);
}
