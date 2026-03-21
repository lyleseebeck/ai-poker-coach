const LOOKBACK_DAYS = 7;
const BUCKET_TTL_SECONDS = 14 * 24 * 60 * 60;
const EXPLORATION_RATE = 0.1;
const MIN_CHALLENGER_ATTEMPTS = 5;
const UPSTASH_PIPELINE_PATH = '/pipeline';

const memoryBuckets = new Map();

function safeScope(value) {
  const scope = String(value || '').trim().toLowerCase();
  return scope || 'coach';
}

function safeModelKey(value) {
  return encodeURIComponent(String(value || '').trim());
}

function emptyStats() {
  return {
    attempts: 0,
    successes: 0,
    timeouts: 0,
    invalidOutputs: 0,
    retryableFailures: 0,
    networkFailures: 0,
    successfulLatencyMs: 0,
    successfulResponses: 0,
  };
}

function addStats(base, next) {
  return {
    attempts: base.attempts + next.attempts,
    successes: base.successes + next.successes,
    timeouts: base.timeouts + next.timeouts,
    invalidOutputs: base.invalidOutputs + next.invalidOutputs,
    retryableFailures: base.retryableFailures + next.retryableFailures,
    networkFailures: base.networkFailures + next.networkFailures,
    successfulLatencyMs: base.successfulLatencyMs + next.successfulLatencyMs,
    successfulResponses: base.successfulResponses + next.successfulResponses,
  };
}

function normalizeInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function bucketDay(nowMs, offsetDays = 0) {
  const date = new Date(Number(nowMs) - offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function bucketKey(scope, model, day) {
  return `model-ranking:v1:${safeScope(scope)}:${safeModelKey(model)}:${day}`;
}

function parseHashResult(raw) {
  if (!raw) return emptyStats();
  const source = Array.isArray(raw)
    ? raw.reduce((acc, value, index, array) => {
        if (index % 2 === 0) {
          acc[String(value)] = array[index + 1];
        }
        return acc;
      }, {})
    : typeof raw === 'object'
      ? raw
      : {};

  return {
    attempts: normalizeInteger(source.attempts),
    successes: normalizeInteger(source.successes),
    timeouts: normalizeInteger(source.timeouts),
    invalidOutputs: normalizeInteger(source.invalidOutputs),
    retryableFailures: normalizeInteger(source.retryableFailures),
    networkFailures: normalizeInteger(source.networkFailures),
    successfulLatencyMs: normalizeInteger(source.successfulLatencyMs),
    successfulResponses: normalizeInteger(source.successfulResponses),
  };
}

function summarizeAttempt(attempt) {
  const stats = emptyStats();
  stats.attempts = 1;

  if (String(attempt?.state || '') === 'completed') {
    stats.successes = 1;
    stats.successfulResponses = 1;
    stats.successfulLatencyMs = normalizeInteger(attempt?.durationMs);
    return stats;
  }

  const reason = String(attempt?.reason || '').trim().toLowerCase();
  if (reason === 'timeout') {
    stats.timeouts = 1;
  } else if (
    reason === 'invalid_output' ||
    reason === 'invalid_provider_json' ||
    reason === 'empty_content'
  ) {
    stats.invalidOutputs = 1;
  } else if (reason === 'provider_retryable_status') {
    stats.retryableFailures = 1;
  } else if (reason === 'network_error') {
    stats.networkFailures = 1;
  }

  return stats;
}

function statsTotalAttempts(stats) {
  return normalizeInteger(stats?.attempts);
}

function compareRankedModels(left, right) {
  if (left.score.successRate !== right.score.successRate) {
    return right.score.successRate - left.score.successRate;
  }
  if (left.score.timeoutRate !== right.score.timeoutRate) {
    return left.score.timeoutRate - right.score.timeoutRate;
  }
  if (left.score.invalidRate !== right.score.invalidRate) {
    return left.score.invalidRate - right.score.invalidRate;
  }
  if (left.score.averageLatencyMs !== right.score.averageLatencyMs) {
    return left.score.averageLatencyMs - right.score.averageLatencyMs;
  }
  return left.originalIndex - right.originalIndex;
}

function buildRankedEntry(model, originalIndex, stats) {
  const attempts = normalizeInteger(stats?.attempts);
  return {
    model,
    originalIndex,
    stats,
    score: {
      successRate: (normalizeInteger(stats?.successes) + 2) / (attempts + 4),
      timeoutRate: (normalizeInteger(stats?.timeouts) + 1) / (attempts + 4),
      invalidRate: (normalizeInteger(stats?.invalidOutputs) + 1) / (attempts + 4),
      averageLatencyMs:
        (normalizeInteger(stats?.successfulLatencyMs) + 8000) /
        (normalizeInteger(stats?.successfulResponses) + 1),
    },
  };
}

function selectChallenger(entries) {
  if (entries.length <= 1) return null;

  const underSampled = entries.find((entry, index) => index > 0 && statsTotalAttempts(entry.stats) < MIN_CHALLENGER_ATTEMPTS);
  if (underSampled) return underSampled.model;

  return entries[1]?.model || null;
}

function buildSelectionPlan(scope, models, statsByModel, randomValue) {
  const rankedEntries = models
    .map((model, index) => buildRankedEntry(model, index, statsByModel[model] || emptyStats()))
    .sort(compareRankedModels);

  const totalAttempts = rankedEntries.reduce((sum, entry) => sum + statsTotalAttempts(entry.stats), 0);
  if (totalAttempts === 0) {
    return {
      scope,
      strategy: 'static',
      plannedOrder: [...models],
      lookbackDays: LOOKBACK_DAYS,
    };
  }

  const rankedOrder = rankedEntries.map((entry) => entry.model);
  const shouldExplore = rankedEntries.length > 1 && Number(randomValue) < EXPLORATION_RATE;
  if (!shouldExplore) {
    return {
      scope,
      strategy: 'ranked',
      plannedOrder: rankedOrder,
      lookbackDays: LOOKBACK_DAYS,
    };
  }

  const challenger = selectChallenger(rankedEntries);
  if (!challenger) {
    return {
      scope,
      strategy: 'ranked',
      plannedOrder: rankedOrder,
      lookbackDays: LOOKBACK_DAYS,
    };
  }

  return {
    scope,
    strategy: 'exploration',
    plannedOrder: [challenger, ...rankedOrder.filter((model) => model !== challenger)],
    lookbackDays: LOOKBACK_DAYS,
  };
}

async function runUpstashPipeline({ redisUrl, redisToken, commands, fetchImpl }) {
  const endpoint = `${String(redisUrl).replace(/\/+$/, '')}${UPSTASH_PIPELINE_PATH}`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Upstash model ranking request failed (${response.status}): ${payloadText.slice(0, 300)}`);
  }

  let payload;
  try {
    payload = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    throw new Error('Upstash model ranking returned invalid JSON.');
  }

  if (!Array.isArray(payload)) {
    throw new Error('Upstash model ranking returned an unexpected payload shape.');
  }

  return payload;
}

function readMemoryBucket(scope, model, day) {
  return memoryBuckets.get(bucketKey(scope, model, day)) || emptyStats();
}

function writeMemoryBucket(scope, model, day, nextStats) {
  memoryBuckets.set(bucketKey(scope, model, day), nextStats);
}

async function readUpstashStats({ scope, models, nowMs, redisUrl, redisToken, fetchImpl }) {
  const commands = [];
  const indexLookup = [];
  for (const model of models) {
    for (let offset = 0; offset < LOOKBACK_DAYS; offset += 1) {
      const day = bucketDay(nowMs, offset);
      commands.push(['HGETALL', bucketKey(scope, model, day)]);
      indexLookup.push({ model });
    }
  }

  const results = await runUpstashPipeline({
    redisUrl,
    redisToken,
    commands,
    fetchImpl,
  });

  const statsByModel = Object.fromEntries(models.map((model) => [model, emptyStats()]));
  results.forEach((item, index) => {
    const model = indexLookup[index]?.model;
    if (!model) return;
    const parsed = parseHashResult(item?.result);
    statsByModel[model] = addStats(statsByModel[model], parsed);
  });
  return statsByModel;
}

async function writeUpstashAttempt({ scope, model, attempt, nowMs, redisUrl, redisToken, fetchImpl }) {
  const day = bucketDay(nowMs, 0);
  const key = bucketKey(scope, model, day);
  const stats = summarizeAttempt(attempt);
  const commands = [
    ['HINCRBY', key, 'attempts', stats.attempts],
    ['HINCRBY', key, 'successes', stats.successes],
    ['HINCRBY', key, 'timeouts', stats.timeouts],
    ['HINCRBY', key, 'invalidOutputs', stats.invalidOutputs],
    ['HINCRBY', key, 'retryableFailures', stats.retryableFailures],
    ['HINCRBY', key, 'networkFailures', stats.networkFailures],
    ['HINCRBY', key, 'successfulLatencyMs', stats.successfulLatencyMs],
    ['HINCRBY', key, 'successfulResponses', stats.successfulResponses],
    ['EXPIRE', key, BUCKET_TTL_SECONDS],
  ];

  await runUpstashPipeline({
    redisUrl,
    redisToken,
    commands,
    fetchImpl,
  });
}

export function createModelRankingStore(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const nowMsImpl = typeof options.nowMs === 'function' ? options.nowMs : () => Date.now();
  const randomFn = typeof options.randomFn === 'function' ? options.randomFn : () => Math.random();
  const redisUrl = String(env?.UPSTASH_REDIS_REST_URL || '').trim();
  const redisToken = String(env?.UPSTASH_REDIS_REST_TOKEN || '').trim();
  const useUpstash = Boolean(redisUrl && redisToken && typeof fetchImpl === 'function');

  return {
    async getSelectionPlan({ scope, models } = {}) {
      const safeModels = Array.isArray(models)
        ? models.map((model) => String(model || '').trim()).filter(Boolean)
        : [];
      const safeScopeValue = safeScope(scope);
      if (safeModels.length === 0) {
        return {
          scope: safeScopeValue,
          strategy: 'static',
          plannedOrder: [],
          lookbackDays: LOOKBACK_DAYS,
        };
      }

      const nowMs = nowMsImpl();
      try {
        const statsByModel = useUpstash
          ? await readUpstashStats({
              scope: safeScopeValue,
              models: safeModels,
              nowMs,
              redisUrl,
              redisToken,
              fetchImpl,
            })
          : Object.fromEntries(
              safeModels.map((model) => {
                const stats = Array.from({ length: LOOKBACK_DAYS }).reduce((acc, _item, index) => {
                  return addStats(acc, readMemoryBucket(safeScopeValue, model, bucketDay(nowMs, index)));
                }, emptyStats());
                return [model, stats];
              })
            );

        return buildSelectionPlan(safeScopeValue, safeModels, statsByModel, randomFn());
      } catch {
        return {
          scope: safeScopeValue,
          strategy: 'static',
          plannedOrder: [...safeModels],
          lookbackDays: LOOKBACK_DAYS,
        };
      }
    },
    async recordAttempt({ scope, model, attempt } = {}) {
      const safeModel = String(model || '').trim();
      if (!safeModel) return;

      const safeScopeValue = safeScope(scope);
      const nowMs = nowMsImpl();
      const summary = summarizeAttempt(attempt);
      const day = bucketDay(nowMs, 0);

      if (useUpstash) {
        try {
          await writeUpstashAttempt({
            scope: safeScopeValue,
            model: safeModel,
            attempt,
            nowMs,
            redisUrl,
            redisToken,
            fetchImpl,
          });
          return;
        } catch {
          // Fall back to in-memory aggregation when persistent ranking storage is unavailable.
        }
      }

      const current = readMemoryBucket(safeScopeValue, safeModel, day);
      writeMemoryBucket(safeScopeValue, safeModel, day, addStats(current, summary));
    },
  };
}
