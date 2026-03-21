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

function normalizeMeta(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('meta must be an object.');
  }
  return {
    provider: value.provider ? String(value.provider) : null,
    model: value.model ? String(value.model) : null,
    fallbackUsed: Boolean(value.fallbackUsed),
    resultSource: value.resultSource ? String(value.resultSource) : null,
    attemptSummary: value.attemptSummary ? String(value.attemptSummary) : null,
    failedModelAttempts: Array.isArray(value.failedModelAttempts)
      ? value.failedModelAttempts.map((entry) => ({
          model: entry?.model ? String(entry.model) : null,
          reason: entry?.reason ? String(entry.reason) : null,
          status: Number.isFinite(Number(entry?.status)) ? Number(entry.status) : null,
          durationMs: Number.isFinite(Number(entry?.durationMs)) ? Number(entry.durationMs) : null,
        }))
      : [],
    attempts: Array.isArray(value.attempts)
      ? value.attempts.map((entry) => ({
          model: entry?.model ? String(entry.model) : null,
          state: entry?.state ? String(entry.state) : null,
          reason: entry?.reason ? String(entry.reason) : null,
          status: Number.isFinite(Number(entry?.status)) ? Number(entry.status) : null,
          durationMs: Number.isFinite(Number(entry?.durationMs)) ? Number(entry.durationMs) : null,
          overallConfidence:
            Number.isFinite(Number(entry?.overallConfidence)) ? Number(entry.overallConfidence) : null,
          missingRequiredCount:
            Number.isFinite(Number(entry?.missingRequiredCount)) ? Number(entry.missingRequiredCount) : null,
          attemptIndex: Number.isFinite(Number(entry?.attemptIndex)) ? Number(entry.attemptIndex) : null,
        }))
      : [],
    timings:
      value.timings && typeof value.timings === 'object' && !Array.isArray(value.timings)
        ? {
            deterministicMs:
              Number.isFinite(Number(value.timings.deterministicMs)) ? Number(value.timings.deterministicMs) : null,
            providerMs: Number.isFinite(Number(value.timings.providerMs)) ? Number(value.timings.providerMs) : null,
            totalMs: Number.isFinite(Number(value.timings.totalMs)) ? Number(value.timings.totalMs) : null,
          }
        : null,
  };
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

export function normalizeAiResponse(raw) {
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
    meta: normalizeMeta(body.meta),
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
