import { normalizeAiResponse } from './aiNormalizeClient.js';

function parseJsonSafely(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeNormalizeStreamEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Normalize stream event must be an object.');
  }

  const type = raw.type ? String(raw.type) : '';
  if (!type) {
    throw new Error('Normalize stream event type is required.');
  }

  const base = {
    type,
    provisional: Boolean(raw.provisional),
    model: raw.model ? String(raw.model) : null,
    message: raw.message ? String(raw.message) : null,
    attemptIndex: toFiniteNumber(raw.attemptIndex),
    totalModels: toFiniteNumber(raw.totalModels),
    durationMs: toFiniteNumber(raw.durationMs),
    overallConfidence: toFiniteNumber(raw.overallConfidence),
  };

  if (Array.isArray(raw.missingRequired)) {
    base.missingRequired = raw.missingRequired.map((item) => String(item));
  }
  if (raw.reason) base.reason = String(raw.reason);
  if (toFiniteNumber(raw.status) != null) base.status = toFiniteNumber(raw.status);
  if (raw.state) base.state = String(raw.state);
  if (toFiniteNumber(raw.missingRequiredCount) != null) {
    base.missingRequiredCount = toFiniteNumber(raw.missingRequiredCount);
  }
  if (raw.response) {
    base.response = normalizeAiResponse(raw.response);
  }

  return base;
}

export async function streamNormalizeHandFromText(payload, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Streaming normalize requires fetch.');
  }

  const response = await fetchImpl('/api/hand-normalize/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify(payload || {}),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    const payloadJson = parseJsonSafely(text);
    const detail =
      payloadJson?.error?.message ||
      payloadJson?.message ||
      text ||
      `${response.status} ${response.statusText}`;
    throw new Error(`AI normalize stream failed: ${detail}`);
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('AI normalize stream failed: response body was not streamable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const parsed = parseJsonSafely(line);
        if (!parsed) {
          throw new Error('AI normalize stream failed: received invalid NDJSON event.');
        }
        const event = normalizeNormalizeStreamEvent(parsed);
        if (typeof options.onEvent === 'function') {
          await options.onEvent(event);
        }
        if (event.type === 'final_result' && event.response) {
          finalResponse = event.response;
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }

    if (done) break;
  }

  if (!finalResponse) {
    throw new Error('AI normalize stream failed: stream ended before final_result.');
  }

  return finalResponse;
}
