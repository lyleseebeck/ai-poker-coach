import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouterProvider } from '../server/coach/providers/openRouterProvider.js';

function makeResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeChoiceContent(content) {
  return {
    choices: [
      {
        message: {
          content,
        },
      },
    ],
  };
}

test('openRouter provider falls back to next free model on retryable status', async () => {
  let callCount = 0;
  const fetchMock = async () => {
    callCount += 1;
    if (callCount === 1) {
      return makeResponse(429, { error: { message: 'rate limit' } });
    }
    return makeResponse(200, makeChoiceContent('{"assistant":{"content":"ok","analysis":{"overallVerdict":"mixed","overallReason":"x","streetVerdicts":[{"street":"preflop","heroAction":"call","verdict":"mixed","reason":"x","gtoPreferredAction":"x"}],"biggestLeaks":[],"gtoCorrections":[],"topAlternatives":["x","y"],"exploitativeAdjustments":[],"confidence":"low"}}}'));
  };

  const provider = createOpenRouterProvider({
    apiKey: 'test-key',
    models: ['provider/model-a:free', 'provider/model-b:free'],
    fetchImpl: fetchMock,
  });

  const out = await provider.generate({
    messages: [{ role: 'user', content: 'hello' }],
    validateContent: (text) => {
      JSON.parse(text);
    },
  });

  assert.equal(out.model, 'provider/model-b:free');
  assert.equal(out.fallbackUsed, true);
  assert.equal(callCount, 2);
});

test('openRouter provider falls back when first model returns invalid output', async () => {
  let callCount = 0;
  const fetchMock = async () => {
    callCount += 1;
    if (callCount === 1) {
      return makeResponse(200, makeChoiceContent('not-json'));
    }
    return makeResponse(200, makeChoiceContent('{"ok":true}'));
  };

  const provider = createOpenRouterProvider({
    apiKey: 'test-key',
    models: ['provider/model-a:free', 'provider/model-b:free'],
    fetchImpl: fetchMock,
  });

  const out = await provider.generate({
    messages: [{ role: 'user', content: 'hello' }],
    validateContent: (text) => {
      JSON.parse(text);
    },
  });

  assert.equal(out.model, 'provider/model-b:free');
  assert.equal(out.fallbackUsed, true);
  assert.equal(callCount, 2);
});

test('openRouter provider fails fast on auth error', async () => {
  let callCount = 0;
  const fetchMock = async () => {
    callCount += 1;
    return makeResponse(401, { error: { message: 'bad key' } });
  };

  const provider = createOpenRouterProvider({
    apiKey: 'test-key',
    models: ['provider/model-a:free', 'provider/model-b:free'],
    fetchImpl: fetchMock,
  });

  await assert.rejects(
    () =>
      provider.generate({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    (error) => error?.code === 'COACH_PROVIDER_AUTH'
  );

  assert.equal(callCount, 1);
});

test('openRouter provider rejects non-free model config', () => {
  assert.throws(
    () =>
      createOpenRouterProvider({
        apiKey: 'test-key',
        models: ['provider/model-paid'],
        fetchImpl: async () => makeResponse(200, makeChoiceContent('ok')),
      }),
    /:free/
  );
});
