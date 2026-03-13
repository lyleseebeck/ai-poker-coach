const WINDOW_SECONDS = 60;
const COUNTER_TTL_SECONDS = 120;

export const DEFAULT_COACH_RATE_LIMIT_PER_MINUTE = 5;
export const DEFAULT_NORMALIZE_RATE_LIMIT_PER_MINUTE = 12;

function createRateLimitError(message, code = 'RATE_LIMIT_CONFIG', details) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code;
  if (details != null) {
    error.details = details;
  }
  return error;
}

function toTrimmedString(value) {
  return String(value == null ? '' : value).trim();
}

function sanitizeKeyPart(value) {
  const base = toTrimmedString(value).toLowerCase();
  if (!base) return 'unknown';
  return base.replace(/[^a-z0-9:._-]/g, '_').slice(0, 160);
}

function getHeaderValue(req, name) {
  const headers = req?.headers;
  if (!headers) return '';

  if (typeof headers.get === 'function') {
    return toTrimmedString(headers.get(name));
  }

  const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(direct)) {
    return toTrimmedString(direct[0]);
  }
  return toTrimmedString(direct);
}

export function getClientIp(req) {
  const forwarded = getHeaderValue(req, 'x-forwarded-for');
  if (forwarded) {
    return toTrimmedString(forwarded.split(',')[0]);
  }

  const realIp = getHeaderValue(req, 'x-real-ip');
  if (realIp) return realIp;

  return toTrimmedString(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '');
}

export function isProductionRuntime(env = process.env) {
  const vercelEnv = toTrimmedString(env?.VERCEL_ENV).toLowerCase();
  if (vercelEnv) return vercelEnv === 'production';

  const nodeEnv = toTrimmedString(env?.NODE_ENV).toLowerCase();
  if (nodeEnv) return nodeEnv === 'production';

  return false;
}

export function resolveRequestsPerMinute(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1, Math.round(parsed));
  }

  const fallbackParsed = Number(fallback);
  if (Number.isFinite(fallbackParsed) && fallbackParsed > 0) {
    return Math.max(1, Math.round(fallbackParsed));
  }

  return 1;
}

function parsePipelineCount(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Upstash pipeline returned an unexpected payload shape.');
  }

  const first = payload[0];
  if (first?.error) {
    throw new Error(`Upstash INCR command failed: ${String(first.error)}`);
  }

  const count = Number(first?.result);
  if (!Number.isFinite(count) || count < 0) {
    throw new Error('Upstash INCR result was not a valid number.');
  }

  return Math.floor(count);
}

async function incrementCounter({ redisUrl, redisToken, key, fetchImpl }) {
  const endpoint = `${String(redisUrl).replace(/\/+$/, '')}/pipeline`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, COUNTER_TTL_SECONDS],
    ]),
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Upstash request failed (${response.status}): ${payloadText.slice(0, 300)}`);
  }

  let payloadJson;
  try {
    payloadJson = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    throw new Error('Upstash returned invalid JSON.');
  }

  return parsePipelineCount(payloadJson);
}

export async function enforceIpRateLimit({
  req,
  namespace,
  requestsPerMinute,
  env = process.env,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
} = {}) {
  const safeNamespace = sanitizeKeyPart(namespace);
  if (!safeNamespace || safeNamespace === 'unknown') {
    throw new Error('Rate limit namespace is required.');
  }

  const limit = resolveRequestsPerMinute(requestsPerMinute, 1);
  const isProduction = isProductionRuntime(env);
  const redisUrl = toTrimmedString(env?.UPSTASH_REDIS_REST_URL);
  const redisToken = toTrimmedString(env?.UPSTASH_REDIS_REST_TOKEN);

  if (!redisUrl || !redisToken) {
    if (isProduction) {
      throw createRateLimitError(
        'Rate limiting is required in production. Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.',
        'RATE_LIMIT_CONFIG'
      );
    }
    return {
      allowed: true,
      mode: 'disabled',
      limit,
      remaining: limit,
    };
  }

  if (typeof fetchImpl !== 'function') {
    if (isProduction) {
      throw createRateLimitError('Rate limiter fetch implementation is unavailable in production.', 'RATE_LIMIT_CONFIG');
    }
    return {
      allowed: true,
      mode: 'disabled',
      limit,
      remaining: limit,
    };
  }

  const nowEpochSeconds = Math.floor(Number(nowMs) / 1000);
  const windowBucket = Math.floor(nowEpochSeconds / WINDOW_SECONDS);
  const resetEpochSeconds = (windowBucket + 1) * WINDOW_SECONDS;
  const retryAfterSeconds = Math.max(1, resetEpochSeconds - nowEpochSeconds);
  const ip = sanitizeKeyPart(getClientIp(req) || 'unknown');
  const counterKey = `ratelimit:${safeNamespace}:${ip}:${windowBucket}`;

  try {
    const count = await incrementCounter({
      redisUrl,
      redisToken,
      key: counterKey,
      fetchImpl,
    });
    const remaining = Math.max(0, limit - count);
    const throttled = count > limit;
    return {
      allowed: !throttled,
      limit,
      remaining,
      retryAfterSeconds,
      resetEpochSeconds,
      count,
    };
  } catch (error) {
    if (isProduction) {
      throw createRateLimitError('Rate limiter is unavailable in production.', 'RATE_LIMIT_UNAVAILABLE', {
        reason: error?.message || 'unknown',
      });
    }
    return {
      allowed: true,
      mode: 'degraded',
      limit,
      remaining: limit,
    };
  }
}

export function applyRateLimitHeaders(res, rateLimitResult) {
  if (!res || !rateLimitResult) return;

  if (Number.isFinite(Number(rateLimitResult.limit))) {
    res.setHeader('X-RateLimit-Limit', String(Math.max(0, Math.floor(Number(rateLimitResult.limit)))));
  }
  if (Number.isFinite(Number(rateLimitResult.remaining))) {
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, Math.floor(Number(rateLimitResult.remaining)))));
  }
  if (Number.isFinite(Number(rateLimitResult.resetEpochSeconds))) {
    res.setHeader('X-RateLimit-Reset', String(Math.max(0, Math.floor(Number(rateLimitResult.resetEpochSeconds)))));
  }
  if (Number.isFinite(Number(rateLimitResult.retryAfterSeconds))) {
    res.setHeader('Retry-After', String(Math.max(1, Math.floor(Number(rateLimitResult.retryAfterSeconds)))));
  }
}
