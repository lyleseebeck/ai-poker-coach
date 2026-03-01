function ensureObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function toStringArray(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item) => String(item));
}

function toRecord(value, label) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[String(k)] = v;
  }
  return out;
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
    payloadJson?.error ||
    payloadJson?.message ||
    payloadText ||
    `${status} ${statusText}`;
  return `AI normalize request failed: ${detail}`;
}

function normalizeAiResponse(raw) {
  const body = ensureObject(raw, 'AI response');
  const parsedFields = ensureObject(body.parsedFields || {}, 'parsedFields');

  return {
    parsedFields,
    confidenceByField: toRecord(body.confidenceByField, 'confidenceByField'),
    evidenceSnippets: toRecord(body.evidenceSnippets, 'evidenceSnippets'),
    missingRequired: toStringArray(body.missingRequired, 'missingRequired'),
    needsUserInput: toStringArray(body.needsUserInput, 'needsUserInput'),
    overallConfidence:
      typeof body.overallConfidence === 'number' && Number.isFinite(body.overallConfidence)
        ? body.overallConfidence
        : null,
    model: body.model ? String(body.model) : null,
  };
}

export async function normalizeHandFromText(payload, options = {}) {
  const response = await fetch('/api/hand-normalize', {
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
    throw new Error('AI normalize request failed: response was not valid JSON.');
  }
  return normalizeAiResponse(json);
}
