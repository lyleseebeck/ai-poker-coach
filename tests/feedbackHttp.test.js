import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFeedbackRequest } from '../server/feedback/http.js';

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
      this.payload += String(value || '');
    },
  };
}

function readJson(res) {
  return JSON.parse(res.payload || '{}');
}

test('handleFeedbackRequest rejects non-POST methods', async () => {
  const res = makeRes();

  await handleFeedbackRequest(makeReq({ method: 'GET' }), res);

  const payload = readJson(res);
  assert.equal(res.statusCode, 405);
  assert.equal(payload.error.code, 'METHOD_NOT_ALLOWED');
});

test('handleFeedbackRequest returns 429 with rate-limit headers', async () => {
  const res = makeRes();
  let feedbackCalled = false;

  await handleFeedbackRequest(
    makeReq({ body: { message: 'bug report' } }),
    res,
    {
      rateLimitImpl: async () => ({
        allowed: false,
        limit: 3,
        remaining: 0,
        retryAfterSeconds: 12,
        resetEpochSeconds: 1_710_000_012,
      }),
      feedbackImpl: async () => {
        feedbackCalled = true;
        return { ok: true };
      },
    }
  );

  const payload = readJson(res);
  assert.equal(feedbackCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal(payload.error.code, 'RATE_LIMITED');
  assert.equal(res.getHeader('retry-after'), '12');
});

test('handleFeedbackRequest returns 200 on success', async () => {
  const res = makeRes();

  await handleFeedbackRequest(
    makeReq({ body: { message: 'manual parser missed my flop action' } }),
    res,
    {
      rateLimitImpl: async () => ({ allowed: true }),
      feedbackImpl: async (payload) => {
        assert.equal(payload.message, 'manual parser missed my flop action');
        return { ok: true };
      },
    }
  );

  const payload = readJson(res);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.ok, true);
});

test('handleFeedbackRequest surfaces validation failures', async () => {
  const res = makeRes();

  await handleFeedbackRequest(
    makeReq({ body: { message: '' } }),
    res,
    {
      rateLimitImpl: async () => ({ allowed: true }),
      feedbackImpl: async () => {
        const error = new Error('message must be a non-empty string.');
        error.statusCode = 400;
        error.code = 'FEEDBACK_INVALID';
        throw error;
      },
    }
  );

  const payload = readJson(res);
  assert.equal(res.statusCode, 400);
  assert.equal(payload.error.code, 'FEEDBACK_INVALID');
});

test('handleFeedbackRequest surfaces delivery failures', async () => {
  const res = makeRes();

  await handleFeedbackRequest(
    makeReq({ body: { message: 'coach panel blanked out' } }),
    res,
    {
      rateLimitImpl: async () => ({ allowed: true }),
      feedbackImpl: async () => {
        const error = new Error('Feedback email delivery failed.');
        error.statusCode = 502;
        error.code = 'FEEDBACK_DELIVERY_FAILED';
        throw error;
      },
    }
  );

  const payload = readJson(res);
  assert.equal(res.statusCode, 502);
  assert.equal(payload.error.code, 'FEEDBACK_DELIVERY_FAILED');
});
