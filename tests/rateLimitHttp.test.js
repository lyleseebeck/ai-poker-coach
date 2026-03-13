import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceIpRateLimit } from '../server/rateLimit/upstashRateLimit.js';
import { handleCoachHandRequest } from '../server/coach/http.js';
import { handleHandNormalizeRequest } from '../server/normalize/http.js';

function makeReq({ method = 'POST', body = {}, headers = {} } = {}) {
  return { method, body, headers };
}

function makeRes() {
  const headers = new Map();
  return {
    statusCode: 0,
    payload: '',
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    end(value) {
      this.payload = String(value || '');
    },
  };
}

function readJson(res) {
  return JSON.parse(res.payload || '{}');
}

test('enforceIpRateLimit allows requests in non-production when Upstash vars are missing', async () => {
  const result = await enforceIpRateLimit({
    req: makeReq(),
    namespace: 'coach-hand',
    requestsPerMinute: 5,
    env: { NODE_ENV: 'development' },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.mode, 'disabled');
});

test('enforceIpRateLimit fails closed in production when Upstash vars are missing', async () => {
  await assert.rejects(
    () =>
      enforceIpRateLimit({
        req: makeReq(),
        namespace: 'coach-hand',
        requestsPerMinute: 5,
        env: { VERCEL_ENV: 'production' },
      }),
    (error) => Number(error?.statusCode) === 503 && error?.code === 'RATE_LIMIT_CONFIG'
  );
});

test('enforceIpRateLimit returns throttled result when counter exceeds limit', async () => {
  const fetchMock = async (url, init) => {
    assert.match(String(url), /\/pipeline$/);
    const commands = JSON.parse(init.body);
    assert.equal(commands[0][0], 'INCR');
    return new Response(JSON.stringify([{ result: 6 }, { result: 1 }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await enforceIpRateLimit({
    req: makeReq({ headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9' } }),
    namespace: 'coach-hand',
    requestsPerMinute: 5,
    env: {
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
    },
    fetchImpl: fetchMock,
    nowMs: 1_710_000_000_000,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.limit, 5);
  assert.equal(result.remaining, 0);
  assert.equal(result.retryAfterSeconds > 0, true);
  assert.equal(result.count, 6);
});

test('enforceIpRateLimit fails closed in production when Upstash is unavailable', async () => {
  await assert.rejects(
    () =>
      enforceIpRateLimit({
        req: makeReq(),
        namespace: 'coach-hand',
        requestsPerMinute: 5,
        env: {
          VERCEL_ENV: 'production',
          UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
          UPSTASH_REDIS_REST_TOKEN: 'token',
        },
        fetchImpl: async () => {
          throw new Error('network down');
        },
      }),
    (error) => Number(error?.statusCode) === 503 && error?.code === 'RATE_LIMIT_UNAVAILABLE'
  );
});

test('handleCoachHandRequest returns 429 with rate-limit headers', async () => {
  let coachCalled = false;
  const res = makeRes();

  await handleCoachHandRequest(
    makeReq({
      body: {
        handId: 'h1',
        hand: { schemaVersion: 2 },
        message: 'test',
      },
    }),
    res,
    {
      rateLimitImpl: async () => ({
        allowed: false,
        limit: 5,
        remaining: 0,
        retryAfterSeconds: 17,
        resetEpochSeconds: 1_710_000_017,
      }),
      coachHandImpl: async () => {
        coachCalled = true;
        return { ok: true };
      },
    }
  );

  const payload = readJson(res);
  assert.equal(coachCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal(payload.error.code, 'RATE_LIMITED');
  assert.equal(res.getHeader('retry-after'), '17');
  assert.equal(res.getHeader('x-ratelimit-limit'), '5');
  assert.equal(res.getHeader('x-ratelimit-remaining'), '0');
  assert.equal(res.getHeader('x-ratelimit-reset'), '1710000017');
});

test('handleHandNormalizeRequest surfaces production limiter config failures as 503', async () => {
  const res = makeRes();
  await handleHandNormalizeRequest(
    makeReq({ body: { manualActionText: 'hero bets' } }),
    res,
    {
      rateLimitImpl: async () => {
        const error = new Error('missing env');
        error.statusCode = 503;
        error.code = 'RATE_LIMIT_CONFIG';
        throw error;
      },
      normalizeHandFromTextImpl: async () => ({ ok: true }),
    }
  );

  const payload = readJson(res);
  assert.equal(res.statusCode, 503);
  assert.equal(payload.error.code, 'RATE_LIMIT_CONFIG');
});
