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

function ensureBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function ensureStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((item, index) => ensureString(item, `${label}[${index}]`));
}

function ensureEnum(value, label, allowedValues) {
  const normalized = ensureString(value, label).toLowerCase();
  if (!allowedValues.includes(normalized)) {
    throw new Error(`${label} must be one of: ${allowedValues.join(', ')}.`);
  }
  return normalized;
}

function parseJsonSafely(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractErrorMessage(status, statusText, payloadText) {
  const payloadJson = parseJsonSafely(payloadText);
  const errorObj = payloadJson?.error || null;
  if (!errorObj) {
    const detail = payloadJson?.message || payloadText || `${status} ${statusText}`;
    return `Coach request failed: ${detail}`;
  }

  const code = String(errorObj.code || '');
  const details = errorObj?.details || {};
  const validationFailures = Array.isArray(details.validationFailures)
    ? details.validationFailures.map((item) => String(item).trim()).filter(Boolean)
    : [];

  let message;
  if (code === 'COACH_FACT_CHECK_FAILED') {
    message = 'Coach response failed fact-check (position/action legality mismatch).';
  } else if (code === 'COACH_LEGALITY_FAILED') {
    message = 'Coach response failed legality checks for this hand.';
  } else if (code === 'COACH_CONSISTENCY_FAILED') {
    message = 'Coach response failed consistency checks for this hand.';
  } else if (code === 'COACH_REPAIR_FAILED') {
    message = 'Coach response was invalid after one repair retry.';
  } else {
    message = errorObj.message || payloadJson?.message || payloadText || `${status} ${statusText}`;
  }

  const extras = [];
  if (validationFailures.length > 0) {
    extras.push(validationFailures.slice(0, 2).join(' | '));
  }
  if (details?.attemptSummary) {
    extras.push(`Attempt summary: ${details.attemptSummary}`);
  }

  return `Coach request failed: ${message}${extras.length > 0 ? ` ${extras.join(' ')}` : ''}`;
}

const VERDICTS = ['correct', 'mixed', 'incorrect', 'unclear'];
const STREETS = ['preflop', 'flop', 'turn', 'river'];

export function normalizeCoachResponse(raw) {
  const body = ensureObject(raw, 'Coach response');
  const assistant = ensureObject(body.assistant, 'assistant');
  const analysis = ensureObject(assistant.analysis, 'assistant.analysis');
  const meta = ensureObject(body.meta, 'meta');

  const confidence = ensureEnum(analysis.confidence, 'assistant.analysis.confidence', ['low', 'medium', 'high']);
  const overallVerdict = ensureEnum(analysis.overallVerdict, 'assistant.analysis.overallVerdict', VERDICTS);
  const factCheck = ensureObject(analysis.factCheck, 'assistant.analysis.factCheck');

  if (!Array.isArray(analysis.streetVerdicts)) {
    throw new Error('assistant.analysis.streetVerdicts must be an array.');
  }
  const seenStreets = new Set();
  const streetVerdicts = analysis.streetVerdicts.map((item, index) => {
    const entry = ensureObject(item, `assistant.analysis.streetVerdicts[${index}]`);
    const street = ensureEnum(entry.street, `assistant.analysis.streetVerdicts[${index}].street`, STREETS);
    if (seenStreets.has(street)) {
      throw new Error(`assistant.analysis.streetVerdicts contains duplicate street: ${street}.`);
    }
    seenStreets.add(street);

    return {
      street,
      heroAction: ensureString(entry.heroAction, `assistant.analysis.streetVerdicts[${index}].heroAction`),
      verdict: ensureEnum(entry.verdict, `assistant.analysis.streetVerdicts[${index}].verdict`, VERDICTS),
      reason: ensureString(entry.reason, `assistant.analysis.streetVerdicts[${index}].reason`),
      gtoPreferredAction: ensureString(
        entry.gtoPreferredAction,
        `assistant.analysis.streetVerdicts[${index}].gtoPreferredAction`
      ),
    };
  });

  const topAlternatives = ensureStringArray(analysis.topAlternatives, 'assistant.analysis.topAlternatives');
  if (topAlternatives.length !== 2) {
    throw new Error('assistant.analysis.topAlternatives must contain exactly 2 items.');
  }
  const heroCards = ensureStringArray(factCheck.heroCards, 'assistant.analysis.factCheck.heroCards');
  if (heroCards.length !== 2) {
    throw new Error('assistant.analysis.factCheck.heroCards must contain exactly 2 cards.');
  }

  return {
    assistant: {
      content: ensureString(assistant.content, 'assistant.content'),
      analysis: {
        factCheck: {
          heroCards,
          heroHandCode: ensureString(factCheck.heroHandCode, 'assistant.analysis.factCheck.heroHandCode'),
          heroPosition: ensureString(factCheck.heroPosition, 'assistant.analysis.factCheck.heroPosition'),
          preflopLastAggressorPosition: ensureString(
            factCheck.preflopLastAggressorPosition,
            'assistant.analysis.factCheck.preflopLastAggressorPosition'
          ),
          heroWasPreflopAggressor: ensureBoolean(
            factCheck.heroWasPreflopAggressor,
            'assistant.analysis.factCheck.heroWasPreflopAggressor'
          ),
          heroCanCbetFlop: ensureBoolean(factCheck.heroCanCbetFlop, 'assistant.analysis.factCheck.heroCanCbetFlop'),
          heroPostflopPosition: ensureEnum(
            factCheck.heroPostflopPosition,
            'assistant.analysis.factCheck.heroPostflopPosition',
            ['out_of_position', 'in_position', 'unknown']
          ),
        },
        overallVerdict,
        overallReason: ensureString(analysis.overallReason, 'assistant.analysis.overallReason'),
        streetVerdicts,
        biggestLeaks: ensureStringArray(analysis.biggestLeaks, 'assistant.analysis.biggestLeaks'),
        gtoCorrections: ensureStringArray(analysis.gtoCorrections, 'assistant.analysis.gtoCorrections'),
        topAlternatives,
        exploitativeAdjustments: ensureStringArray(
          analysis.exploitativeAdjustments,
          'assistant.analysis.exploitativeAdjustments'
        ),
        confidence,
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
