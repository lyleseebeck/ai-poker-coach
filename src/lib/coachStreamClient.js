import { normalizeCoachResponse } from './coachClient.js';

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

export function normalizeCoachStreamEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Coach stream event must be an object.');
  }

  const type = raw.type ? String(raw.type) : '';
  if (!type) {
    throw new Error('Coach stream event type is required.');
  }

  const base = {
    type,
    model: raw.model ? String(raw.model) : null,
    message: raw.message ? String(raw.message) : null,
    attemptIndex: toFiniteNumber(raw.attemptIndex),
    totalModels: toFiniteNumber(raw.totalModels),
    durationMs: toFiniteNumber(raw.durationMs),
    status: toFiniteNumber(raw.status),
    pass: raw.pass ? String(raw.pass) : 'initial',
  };

  if (raw.state) base.state = String(raw.state);
  if (raw.reason) base.reason = String(raw.reason);
  if (raw.scope) base.scope = String(raw.scope);
  if (raw.strategy) base.strategy = String(raw.strategy);
  if (Array.isArray(raw.plannedOrder)) {
    base.plannedOrder = raw.plannedOrder.map((item) => String(item));
  }
  if (raw.response) {
    base.response = normalizeCoachResponse(raw.response);
  }

  return base;
}

export async function streamCoachHand(payload, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Streaming coach requires fetch.');
  }

  let response;
  try {
    response = await fetchImpl('/api/coach-hand/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify(payload || {}),
      signal: options.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Coach request stopped.');
    }
    throw error;
  }

  if (!response.ok) {
    const text = await response.text();
    const payloadJson = parseJsonSafely(text);
    const detail =
      payloadJson?.error?.message ||
      payloadJson?.message ||
      text ||
      `${response.status} ${response.statusText}`;
    throw new Error(`Coach request failed: ${detail}`);
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Coach request failed: response body was not streamable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse = null;

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('Coach request stopped.');
      }
      throw error;
    }
    const { done, value } = chunk;
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const parsed = parseJsonSafely(line);
        if (!parsed) {
          throw new Error('Coach request failed: received invalid NDJSON event.');
        }
        const event = normalizeCoachStreamEvent(parsed);
        if (typeof options.onEvent === 'function') {
          await options.onEvent(event);
        }
        if (event.type === 'final_result' && event.response) {
          finalResponse = event.response;
        }
        if (event.type === 'error' && event.message) {
          throw new Error(`Coach request failed: ${event.message}`);
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }

    if (done) break;
  }

  if (!finalResponse) {
    throw new Error('Coach request failed: stream ended before final_result.');
  }

  return finalResponse;
}
