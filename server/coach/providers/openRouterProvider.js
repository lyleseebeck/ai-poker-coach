import { createCoachError } from '../errors.js';
import { createModelRankingStore } from './modelRankingStore.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_DISCOVERY_TTL_MS = 60 * 60 * 1000;
const OPENROUTER_FREE_ROUTER = 'openrouter/free';
export const DEFAULT_OPENROUTER_FREE_MODEL_FALLBACKS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'stepfun/step-3.5-flash:free',
  'arcee-ai/trinity-large-preview:free',
];

let discoveredFreeModelCache = {
  expiresAtMs: 0,
  models: [],
};

function parseTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.round(n), 1000), 120000);
}

function parseDiscoveryTtlMs(value, fallback = DEFAULT_DISCOVERY_TTL_MS) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.max(Math.round(n), 0), 24 * 60 * 60 * 1000);
}

function shouldDiscoverDynamicFreeModels(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return true;
  return !['0', 'false', 'no', 'off'].includes(text);
}

function isAllowedConfiguredModel(model) {
  const text = String(model || '').trim();
  return text === OPENROUTER_FREE_ROUTER || text.includes(':free');
}

function normalizeModelList(rawModels, fallbackModels = DEFAULT_OPENROUTER_FREE_MODEL_FALLBACKS) {
  const list = Array.isArray(rawModels)
    ? rawModels
    : String(rawModels || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  for (const model of list) {
    if (!isAllowedConfiguredModel(model)) {
      throw createCoachError(`Model must be a free variant or openrouter/free: ${model}`, {
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
    if (!isAllowedConfiguredModel(trimmed)) {
      throw createCoachError(`Model must be a free variant or openrouter/free: ${trimmed}`, {
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
    return json?.error?.message || json?.message || '';
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

function buildAbortSignal(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const abortFromExternalSignal = () => {
    controller.abort(new DOMException('Request aborted by client.', 'AbortError'));
  };
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortFromExternalSignal();
    } else {
      externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
    }
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abortFromExternalSignal);
      }
    },
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
    const statusPart = Number.isFinite(Number(attempt?.status)) ? `:${Number(attempt.status)}` : '';
    const key = `${reason}${statusPart}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([key, count]) => `${key}x${count}`)
    .join(', ');
}

function defaultNowMs() {
  return Date.now();
}

function supportsTextResponses(model) {
  const outputModalities = Array.isArray(model?.architecture?.output_modalities)
    ? model.architecture.output_modalities.map((item) => String(item || '').trim().toLowerCase())
    : [];
  if (outputModalities.length === 0) return true;
  return outputModalities.includes('text');
}

function isFreeModelRecord(model) {
  const id = String(model?.id || '').trim();
  if (!id || !id.includes(':free')) return false;
  return supportsTextResponses(model);
}

async function fetchDiscoveredFreeModels({
  fetchImpl,
  apiKey,
  modelsEndpoint,
  nowMs,
  cacheTtlMs,
} = {}) {
  if (cacheTtlMs > 0 && discoveredFreeModelCache.expiresAtMs > nowMs && discoveredFreeModelCache.models.length > 0) {
    return [...discoveredFreeModelCache.models];
  }

  const response = await fetchImpl(modelsEndpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });
  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter models discovery failed (${response.status}): ${payloadText.slice(0, 300)}`);
  }

  let payloadJson;
  try {
    payloadJson = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    throw new Error('OpenRouter models discovery returned invalid JSON.');
  }

  const models = Array.isArray(payloadJson?.data)
    ? payloadJson.data
        .filter(isFreeModelRecord)
        .map((item) => String(item.id).trim())
        .filter(Boolean)
    : [];

  discoveredFreeModelCache = {
    expiresAtMs: nowMs + cacheTtlMs,
    models,
  };

  return [...models];
}

async function resolveCandidateModels(config, fetchImpl, nowMs) {
  const baseModels = [...config.models];
  const seen = new Set(baseModels);
  const discovered = [];

  if (config.discoverFreeModels) {
    try {
      const dynamicModels = await fetchDiscoveredFreeModels({
        fetchImpl,
        apiKey: config.apiKey,
        modelsEndpoint: config.modelsEndpoint,
        nowMs,
        cacheTtlMs: config.discoveryTtlMs,
      });
      for (const model of dynamicModels) {
        if (seen.has(model)) continue;
        seen.add(model);
        discovered.push(model);
      }
    } catch {
      // Discovery is best-effort. We keep the configured allowlist if the catalog is unavailable.
    }
  }

  if (!seen.has(OPENROUTER_FREE_ROUTER)) {
    seen.add(OPENROUTER_FREE_ROUTER);
    discovered.push(OPENROUTER_FREE_ROUTER);
  }

  return [...baseModels, ...discovered];
}

function toSelectionPlan(selectionPlan, scope, fallbackModels) {
  return {
    scope: String(selectionPlan?.scope || scope || 'coach'),
    strategy: String(selectionPlan?.strategy || 'static'),
    plannedOrder: Array.isArray(selectionPlan?.plannedOrder) ? selectionPlan.plannedOrder.map((item) => String(item)) : [...fallbackModels],
  };
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
    modelsEndpoint: options.modelsEndpoint || env.COACH_OPENROUTER_MODELS_ENDPOINT || OPENROUTER_MODELS_URL,
    siteUrl: options.siteUrl || env.COACH_SITE_URL || '',
    appName: options.appName || env.COACH_APP_NAME || 'AI Poker Coach',
    discoverFreeModels: shouldDiscoverDynamicFreeModels(
      options.discoverFreeModels ?? env.COACH_OPENROUTER_DISCOVER_FREE_MODELS
    ),
    discoveryTtlMs: parseDiscoveryTtlMs(
      options.discoveryTtlMs ?? env.COACH_OPENROUTER_DISCOVERY_TTL_MS,
      DEFAULT_DISCOVERY_TTL_MS
    ),
    env,
  };
}

async function emitAttempt(onAttempt, event) {
  if (typeof onAttempt !== 'function') return null;
  return onAttempt(event);
}

async function runOpenRouterAttempts({
  config,
  fetchImpl,
  rankingStore,
  nowMs = defaultNowMs,
  mode = 'single',
  messages,
  timeoutMs,
  validateContent,
  onAttempt,
  requestKind = 'coach',
  attemptContext = {},
  signal: externalSignal,
} = {}) {
  const attempts = [];
  const candidates = [];
  const resolvedTimeout = parseTimeoutMs(timeoutMs, config.timeoutMs);
  const candidateModels = await resolveCandidateModels(config, fetchImpl, nowMs());
  const selectionPlan = toSelectionPlan(
    await rankingStore.getSelectionPlan({ scope: requestKind, models: candidateModels }),
    requestKind,
    candidateModels
  );
  const orderedModels = selectionPlan.plannedOrder.length > 0 ? selectionPlan.plannedOrder : [...candidateModels];

  await emitAttempt(onAttempt, {
    phase: 'selection_plan',
    requestKind,
    totalModels: orderedModels.length,
    ...attemptContext,
    ...selectionPlan,
  });

  for (let index = 0; index < orderedModels.length; index += 1) {
    const model = orderedModels[index];
    const attemptIndex = index + 1;
    const startedAtMs = nowMs();
    const signalState = buildAbortSignal(resolvedTimeout, externalSignal);

    await emitAttempt(onAttempt, {
      phase: 'attempt_started',
      model,
      attemptIndex,
      totalModels: orderedModels.length,
      startedAtMs,
      requestKind,
      ...attemptContext,
    });

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
          totalModels: orderedModels.length,
          requestKind,
          ...attemptContext,
        };
        attempts.push(attempt);
        await rankingStore.recordAttempt({ scope: requestKind, model, attempt });
        await emitAttempt(onAttempt, {
          phase: 'attempt_completed',
          ...attempt,
        });

        if (
          isRetryableStatus(response.status) ||
          response.status === 400 ||
          response.status === 404 ||
          response.status === 402
        ) {
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
          totalModels: orderedModels.length,
          requestKind,
          ...attemptContext,
        };
        attempts.push(attempt);
        await rankingStore.recordAttempt({ scope: requestKind, model, attempt });
        await emitAttempt(onAttempt, {
          phase: 'attempt_completed',
          ...attempt,
        });
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
          totalModels: orderedModels.length,
          requestKind,
          ...attemptContext,
        };
        attempts.push(attempt);
        await rankingStore.recordAttempt({ scope: requestKind, model, attempt });
        await emitAttempt(onAttempt, {
          phase: 'attempt_completed',
          ...attempt,
        });
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
            totalModels: orderedModels.length,
            requestKind,
            ...attemptContext,
          };
          attempts.push(attempt);
          await rankingStore.recordAttempt({ scope: requestKind, model, attempt });
          await emitAttempt(onAttempt, {
            phase: 'attempt_completed',
            ...attempt,
          });
          continue;
        }
      }

      const successAttempt = {
        model,
        state: 'completed',
        durationMs,
        attemptIndex,
        totalModels: orderedModels.length,
        requestKind,
        ...attemptContext,
      };
      attempts.push(successAttempt);
      await rankingStore.recordAttempt({ scope: requestKind, model, attempt: successAttempt });
      const candidate = {
        provider: 'openrouter',
        model,
        content,
        fallbackUsed: index > 0,
        durationMs,
        attemptIndex,
        selectionPlan,
      };
      candidates.push(candidate);
      const attemptResult = await emitAttempt(onAttempt, {
        phase: 'attempt_completed',
        ...successAttempt,
        candidate,
      });

      if (mode === 'single') {
        return {
          provider: 'openrouter',
          model,
          content,
          fallbackUsed: index > 0,
          attempts,
          selectionPlan,
          stopReason: String(attemptResult?.stopReason || 'first_valid_candidate'),
        };
      }

      if (attemptResult?.stop) {
        return {
          provider: 'openrouter',
          attempts,
          candidates,
          exhausted: candidates.length === 0,
          selectionPlan,
          stopReason: String(attemptResult.stopReason || 'external_stop'),
        };
      }
    } catch (error) {
      if (error?.code === 'COACH_PROVIDER_AUTH' || error?.code === 'COACH_CONFIG') {
        throw error;
      }

       if (error?.name === 'AbortError' && externalSignal?.aborted) {
        throw error;
      }

      const attempt = {
        model,
        state: 'failed',
        reason: error?.name === 'AbortError' ? 'timeout' : 'network_error',
        detail: error?.message || String(error),
        durationMs: Math.max(0, nowMs() - startedAtMs),
        attemptIndex,
        totalModels: orderedModels.length,
        requestKind,
        ...attemptContext,
      };
      attempts.push(attempt);
      await rankingStore.recordAttempt({ scope: requestKind, model, attempt });
      await emitAttempt(onAttempt, {
        phase: 'attempt_completed',
        ...attempt,
      });
    } finally {
      signalState.clear();
    }
  }

  if (mode === 'multi') {
    return {
      provider: 'openrouter',
      attempts,
      candidates,
      exhausted: candidates.length === 0,
      selectionPlan,
      stopReason: candidates.length > 0 ? 'evaluated_ranked_models' : 'exhausted_without_candidate',
    };
  }

  const hasInvalidOutput = attempts.some((item) => item.reason === 'invalid_output');
  const attemptSummary = summarizeAttempts(attempts);
  throw createCoachError(`OpenRouter free models were exhausted. Attempt summary: ${attemptSummary}`, {
    statusCode: 502,
    code: hasInvalidOutput ? 'COACH_PROVIDER_OUTPUT_INVALID' : 'COACH_PROVIDER_EXHAUSTED',
    details: {
      attempts,
      attemptSummary,
      lastModel: attempts.length > 0 ? attempts[attempts.length - 1].model || null : null,
    },
  });
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

  const rankingStore = options.modelRankingStore || createModelRankingStore({
    env: config.env,
    fetchImpl,
    nowMs: typeof options.nowMs === 'function' ? options.nowMs : defaultNowMs,
    randomFn: typeof options.randomFn === 'function' ? options.randomFn : Math.random,
  });
  const nowMsImpl = typeof options.nowMs === 'function' ? options.nowMs : defaultNowMs;

  return {
    name: 'openrouter',
    models: config.models,
    async generateWithProgress({ messages, timeoutMs, validateContent, onAttempt, requestKind, attemptContext, signal } = {}) {
      return runOpenRouterAttempts({
        config,
        fetchImpl,
        rankingStore,
        nowMs: nowMsImpl,
        mode: 'multi',
        messages,
        timeoutMs,
        validateContent,
        onAttempt,
        requestKind,
        attemptContext,
        signal,
      });
    },
    async generate({ messages, timeoutMs, validateContent, onAttempt, requestKind, attemptContext, signal } = {}) {
      return runOpenRouterAttempts({
        config,
        fetchImpl,
        rankingStore,
        nowMs: nowMsImpl,
        mode: 'single',
        messages,
        timeoutMs,
        validateContent,
        onAttempt,
        requestKind,
        attemptContext,
        signal,
      });
    },
  };
}
