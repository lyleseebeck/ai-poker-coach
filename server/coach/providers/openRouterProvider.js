import { createCoachError } from '../errors.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 25000;
export const DEFAULT_OPENROUTER_FREE_MODEL_FALLBACKS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'stepfun/step-3.5-flash:free',
  'arcee-ai/trinity-large-preview:free',
];

function parseTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.round(n), 1000), 120000);
}

function normalizeModelList(rawModels, fallbackModels = DEFAULT_OPENROUTER_FREE_MODEL_FALLBACKS) {
  const list = Array.isArray(rawModels)
    ? rawModels
    : String(rawModels || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  for (const model of list) {
    if (!model.includes(':free')) {
      throw createCoachError(`Model must include ":free" for free-only policy: ${model}`, {
        statusCode: 500,
        code: 'COACH_CONFIG',
      });
    }
  }

  const merged = [];
  const seen = new Set();
  for (const model of [...list, ...fallbackModels]) {
    const trimmed = String(model || '').trim();
    if (!trimmed) continue;
    if (!trimmed.includes(':free')) {
      throw createCoachError(`Model must include ":free" for free-only policy: ${trimmed}`, {
        statusCode: 500,
        code: 'COACH_CONFIG',
      });
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }

  if (merged.length === 0) {
    throw createCoachError('No free OpenRouter models configured or available for fallback.', {
      statusCode: 500,
      code: 'COACH_CONFIG',
    });
  }

  return merged;
}

function readErrorDetail(payloadText) {
  if (!payloadText) return '';
  try {
    const json = JSON.parse(payloadText);
    return (
      json?.error?.message ||
      json?.message ||
      ''
    );
  } catch {
    return String(payloadText).slice(0, 400);
  }
}

function extractAssistantContent(responseJson) {
  const raw = responseJson?.choices?.[0]?.message?.content;
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function buildAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function summarizeAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return 'no attempt details';

  const counts = new Map();
  for (const attempt of attempts) {
    const reason = String(attempt?.reason || 'unknown');
    const statusPart = Number.isFinite(Number(attempt?.status))
      ? `:${Number(attempt.status)}`
      : '';
    const key = `${reason}${statusPart}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([key, count]) => `${key}x${count}`)
    .join(', ');
}

function nowMs() {
  return Date.now();
}

export function resolveOpenRouterConfig(options = {}) {
  const env = options.env || process.env;

  const apiKey = String(options.apiKey || env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    throw createCoachError('OPENROUTER_API_KEY is required for coach endpoint.', {
      statusCode: 500,
      code: 'COACH_CONFIG',
    });
  }

  const models = normalizeModelList(options.models || env.COACH_OPENROUTER_MODELS);
  const timeoutMs = parseTimeoutMs(options.defaultTimeoutMs ?? env.COACH_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  return {
    apiKey,
    models,
    timeoutMs,
    endpoint: options.endpoint || OPENROUTER_URL,
    siteUrl: options.siteUrl || env.COACH_SITE_URL || '',
    appName: options.appName || env.COACH_APP_NAME || 'AI Poker Coach',
  };
}

export function createOpenRouterProvider(options = {}) {
  const config = resolveOpenRouterConfig(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw createCoachError('Global fetch is not available for OpenRouter provider.', {
      statusCode: 500,
      code: 'COACH_CONFIG',
    });
  }

  return {
    name: 'openrouter',
    models: config.models,
    async generateWithProgress({ messages, timeoutMs, validateContent, onAttempt } = {}) {
      const attempts = [];
      const candidates = [];
      const resolvedTimeout = parseTimeoutMs(timeoutMs, config.timeoutMs);

      for (let index = 0; index < config.models.length; index += 1) {
        const model = config.models[index];
        const attemptIndex = index + 1;
        const startedAtMs = nowMs();
        const signalState = buildAbortSignal(resolvedTimeout);

        if (typeof onAttempt === 'function') {
          await onAttempt({
            phase: 'attempt_started',
            model,
            attemptIndex,
            totalModels: config.models.length,
            startedAtMs,
          });
        }

        try {
          const response = await fetchImpl(config.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
              ...(config.siteUrl ? { 'HTTP-Referer': config.siteUrl } : {}),
              ...(config.appName ? { 'X-Title': config.appName } : {}),
            },
            body: JSON.stringify({
              model,
              messages,
              temperature: 0,
            }),
            signal: signalState.signal,
          });

          const payloadText = await response.text();
          const durationMs = Math.max(0, nowMs() - startedAtMs);

          if (response.status === 401 || response.status === 403) {
            throw createCoachError(
              `OpenRouter authentication failed (${response.status}). ${readErrorDetail(payloadText)}`.trim(),
              {
                statusCode: 502,
                code: 'COACH_PROVIDER_AUTH',
              }
            );
          }

          if (!response.ok) {
            const detail = readErrorDetail(payloadText);
            const reason = isRetryableStatus(response.status) ? 'provider_retryable_status' : 'provider_status';
            const attempt = {
              model,
              state: 'failed',
              reason,
              status: response.status,
              detail,
              durationMs,
              attemptIndex,
            };
            attempts.push(attempt);
            if (typeof onAttempt === 'function') {
              await onAttempt({
                phase: 'attempt_completed',
                ...attempt,
                totalModels: config.models.length,
              });
            }

            if (isRetryableStatus(response.status) || response.status === 400 || response.status === 404 || response.status === 402) {
              continue;
            }

            throw createCoachError(
              `OpenRouter request failed for model ${model}: ${response.status}${detail ? ` ${detail}` : ''}`,
              {
                statusCode: 502,
                code: 'COACH_PROVIDER_ERROR',
              }
            );
          }

          let payloadJson;
          try {
            payloadJson = payloadText ? JSON.parse(payloadText) : null;
          } catch {
            const attempt = {
              model,
              state: 'failed',
              reason: 'invalid_provider_json',
              status: response.status,
              durationMs,
              attemptIndex,
            };
            attempts.push(attempt);
            if (typeof onAttempt === 'function') {
              await onAttempt({
                phase: 'attempt_completed',
                ...attempt,
                totalModels: config.models.length,
              });
            }
            continue;
          }

          const content = extractAssistantContent(payloadJson);
          if (!content) {
            const attempt = {
              model,
              state: 'failed',
              reason: 'empty_content',
              durationMs,
              attemptIndex,
            };
            attempts.push(attempt);
            if (typeof onAttempt === 'function') {
              await onAttempt({
                phase: 'attempt_completed',
                ...attempt,
                totalModels: config.models.length,
              });
            }
            continue;
          }

          if (typeof validateContent === 'function') {
            try {
              validateContent(content);
            } catch (error) {
              const attempt = {
                model,
                state: 'failed',
                reason: 'invalid_output',
                detail: error?.message || 'Model output failed schema validation.',
                errorCode: error?.code || null,
                validationFailures: Array.isArray(error?.details?.validationFailures)
                  ? error.details.validationFailures.map((item) => String(item))
                  : null,
                contentSnippet: content.slice(0, 800),
                durationMs,
                attemptIndex,
              };
              attempts.push(attempt);
              if (typeof onAttempt === 'function') {
                await onAttempt({
                  phase: 'attempt_completed',
                  ...attempt,
                  totalModels: config.models.length,
                });
              }
              continue;
            }
          }

          const successAttempt = {
            model,
            state: 'completed',
            durationMs,
            attemptIndex,
          };
          attempts.push(successAttempt);
          const candidate = {
            provider: 'openrouter',
            model,
            content,
            fallbackUsed: index > 0,
            durationMs,
            attemptIndex,
          };
          candidates.push(candidate);
          if (typeof onAttempt === 'function') {
            await onAttempt({
              phase: 'attempt_completed',
              ...successAttempt,
              totalModels: config.models.length,
              candidate,
            });
          }
        } catch (error) {
          if (error?.code === 'COACH_PROVIDER_AUTH' || error?.code === 'COACH_CONFIG') {
            throw error;
          }

          const attempt = {
            model,
            state: 'failed',
            reason: error?.name === 'AbortError' ? 'timeout' : 'network_error',
            detail: error?.message || String(error),
            durationMs: Math.max(0, nowMs() - startedAtMs),
            attemptIndex,
          };
          attempts.push(attempt);
          if (typeof onAttempt === 'function') {
            await onAttempt({
              phase: 'attempt_completed',
              ...attempt,
              totalModels: config.models.length,
            });
          }
        } finally {
          signalState.clear();
        }
      }

      return {
        provider: 'openrouter',
        attempts,
        candidates,
        exhausted: candidates.length === 0,
      };
    },
    async generate({ messages, timeoutMs, validateContent } = {}) {
      const attempts = [];
      const resolvedTimeout = parseTimeoutMs(timeoutMs, config.timeoutMs);

      for (let index = 0; index < config.models.length; index += 1) {
        const model = config.models[index];
        const signalState = buildAbortSignal(resolvedTimeout);

        try {
          const response = await fetchImpl(config.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
              ...(config.siteUrl ? { 'HTTP-Referer': config.siteUrl } : {}),
              ...(config.appName ? { 'X-Title': config.appName } : {}),
            },
            body: JSON.stringify({
              model,
              messages,
              temperature: 0,
            }),
            signal: signalState.signal,
          });

          const payloadText = await response.text();

          if (response.status === 401 || response.status === 403) {
            throw createCoachError(
              `OpenRouter authentication failed (${response.status}). ${readErrorDetail(payloadText)}`.trim(),
              {
                statusCode: 502,
                code: 'COACH_PROVIDER_AUTH',
              }
            );
          }

          if (!response.ok) {
            const detail = readErrorDetail(payloadText);
            const reason = isRetryableStatus(response.status) ? 'provider_retryable_status' : 'provider_status';
            attempts.push({ model, reason, status: response.status, detail });

            if (isRetryableStatus(response.status) || response.status === 400 || response.status === 404 || response.status === 402) {
              continue;
            }

            throw createCoachError(
              `OpenRouter request failed for model ${model}: ${response.status}${detail ? ` ${detail}` : ''}`,
              {
                statusCode: 502,
                code: 'COACH_PROVIDER_ERROR',
              }
            );
          }

          let payloadJson;
          try {
            payloadJson = payloadText ? JSON.parse(payloadText) : null;
          } catch {
            attempts.push({ model, reason: 'invalid_provider_json', status: response.status });
            continue;
          }

          const content = extractAssistantContent(payloadJson);
          if (!content) {
            attempts.push({ model, reason: 'empty_content' });
            continue;
          }

          if (typeof validateContent === 'function') {
            try {
              validateContent(content);
            } catch (error) {
              attempts.push({
                model,
                reason: 'invalid_output',
                detail: error?.message || 'Model output failed schema validation.',
                errorCode: error?.code || null,
                validationFailures: Array.isArray(error?.details?.validationFailures)
                  ? error.details.validationFailures.map((item) => String(item))
                  : null,
                contentSnippet: content.slice(0, 800),
              });
              continue;
            }
          }

          return {
            provider: 'openrouter',
            model,
            content,
            fallbackUsed: index > 0,
            attempts,
          };
        } catch (error) {
          if (error?.code === 'COACH_PROVIDER_AUTH' || error?.code === 'COACH_CONFIG') {
            throw error;
          }

          const isAbort = error?.name === 'AbortError';
          attempts.push({
            model,
            reason: isAbort ? 'timeout' : 'network_error',
            detail: error?.message || String(error),
          });
          continue;
        } finally {
          signalState.clear();
        }
      }

      const hasInvalidOutput = attempts.some((item) => item.reason === 'invalid_output');
      const attemptSummary = summarizeAttempts(attempts);
      throw createCoachError(`OpenRouter free models were exhausted. Attempt summary: ${attemptSummary}`, {
        statusCode: 502,
        code: hasInvalidOutput ? 'COACH_PROVIDER_OUTPUT_INVALID' : 'COACH_PROVIDER_EXHAUSTED',
        details: { attempts, attemptSummary, lastModel: attempts.length > 0 ? attempts[attempts.length - 1].model || null : null },
      });
    },
  };
}
