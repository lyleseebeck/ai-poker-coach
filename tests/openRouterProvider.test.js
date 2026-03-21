import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpenRouterProvider,
  DEFAULT_OPENROUTER_FREE_MODEL_FALLBACKS,
} from '../server/coach/providers/openRouterProvider.js';

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

function staticRankingStore(plannedOrder) {
  return {
    async getSelectionPlan() {
      return {
        scope: 'coach',
        strategy: 'static',
        plannedOrder,
      };
    },
    async recordAttempt() {},
  };
}

test('openRouter provider falls back to next free model on retryable status', async () => {
  let callCount = 0;
  const fetchMock = async () => {
    callCount += 1;
    if (callCount === 1) {
      return makeResponse(429, { error: { message: 'rate limit' } });
    }
    return makeResponse(200, makeChoiceContent('{"assistant":{"content":"ok","analysis":{"factCheck":{"heroCards":["As","Kd"],"heroHandCode":"AKo","heroPosition":"BTN","preflopLastAggressorPosition":"CO","heroWasPreflopAggressor":false,"heroCanCbetFlop":false,"heroPostflopPosition":"unknown"},"overallVerdict":"mixed","overallReason":"x","streetVerdicts":[{"street":"preflop","heroAction":"call","verdict":"mixed","reason":"x","gtoPreferredAction":"x"}],"keyAdjustments":["x"],"confidence":"low"}}}'));
  };

  const provider = createOpenRouterProvider({
    apiKey: 'test-key',
    models: ['provider/model-a:free', 'provider/model-b:free'],
    modelRankingStore: staticRankingStore(['provider/model-a:free', 'provider/model-b:free']),
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
    modelRankingStore: staticRankingStore(['provider/model-a:free', 'provider/model-b:free']),
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
    modelRankingStore: staticRankingStore(['provider/model-a:free', 'provider/model-b:free']),
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

test('openRouter provider appends default free fallback models after configured list', () => {
  const configured = ['provider/model-a:free', 'provider/model-b:free'];
  const provider = createOpenRouterProvider({
    apiKey: 'test-key',
    models: configured,
    fetchImpl: async () => makeResponse(200, makeChoiceContent('ok')),
  });

  assert.deepEqual(provider.models.slice(0, configured.length), configured);
  for (const fallbackModel of DEFAULT_OPENROUTER_FREE_MODEL_FALLBACKS) {
    assert.equal(provider.models.includes(fallbackModel), true);
  }
});

test('openRouter provider uses default free fallback models when COACH_OPENROUTER_MODELS is empty', () => {
  const provider = createOpenRouterProvider({
    apiKey: 'test-key',
    env: {
      OPENROUTER_API_KEY: 'test-key',
      COACH_OPENROUTER_MODELS: '',
    },
    fetchImpl: async () => makeResponse(200, makeChoiceContent('ok')),
  });

  assert.deepEqual(provider.models, DEFAULT_OPENROUTER_FREE_MODEL_FALLBACKS);
});

test('openRouter provider uses ranked planned order and emits selection events', async () => {
  const seenModels = [];
  const seenPhases = [];
  const provider = createOpenRouterProvider({
    apiKey: 'test-key',
    models: ['provider/model-a:free', 'provider/model-b:free'],
    modelRankingStore: {
      async getSelectionPlan() {
        return {
          scope: 'normalize',
          strategy: 'ranked',
          plannedOrder: ['provider/model-b:free', 'provider/model-a:free'],
        };
      },
      async recordAttempt() {},
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      seenModels.push(body.model);
      return makeResponse(200, makeChoiceContent('{"ok":true}'));
    },
  });

  const out = await provider.generate({
    messages: [{ role: 'user', content: 'hello' }],
    requestKind: 'normalize',
    validateContent: (text) => {
      JSON.parse(text);
    },
    onAttempt: async (event) => {
      seenPhases.push(event.phase);
    },
  });

  assert.equal(out.model, 'provider/model-b:free');
  assert.equal(out.selectionPlan.strategy, 'ranked');
  assert.deepEqual(seenModels, ['provider/model-b:free']);
  assert.deepEqual(seenPhases, ['selection_plan', 'attempt_started', 'attempt_completed']);
});
