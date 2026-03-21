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

function makeModelsDiscoveryResponse(ids) {
  return makeResponse(200, {
    data: ids.map((id) => ({
      id,
      architecture: {
        output_modalities: ['text'],
      },
    })),
  });
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
    discoverFreeModels: false,
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
    discoverFreeModels: false,
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
    discoverFreeModels: false,
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
        discoverFreeModels: false,
        fetchImpl: async () => makeResponse(200, makeChoiceContent('ok')),
      }),
    /free variant|openrouter\/free/i
  );
});

test('openRouter provider appends default free fallback models after configured list', () => {
  const configured = ['provider/model-a:free', 'provider/model-b:free'];
  const provider = createOpenRouterProvider({
    apiKey: 'test-key',
    models: configured,
    discoverFreeModels: false,
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
    discoverFreeModels: false,
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
    discoverFreeModels: false,
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

test('openRouter provider appends discovered free models and keeps trying them after configured failures', async () => {
  const seenModels = [];
  const provider = createOpenRouterProvider({
    apiKey: 'test-key',
    models: ['provider/model-a:free'],
    discoverFreeModels: true,
    discoveryTtlMs: 0,
    modelRankingStore: staticRankingStore([
      'provider/model-a:free',
      'provider/model-b:free',
      'openrouter/free',
    ]),
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes('/models')) {
        return makeModelsDiscoveryResponse(['provider/model-b:free']);
      }
      const body = JSON.parse(init.body);
      seenModels.push(body.model);
      if (body.model === 'provider/model-a:free') {
        return makeResponse(429, { error: { message: 'retry later' } });
      }
      return makeResponse(200, makeChoiceContent('{"ok":true}'));
    },
  });

  const out = await provider.generate({
    messages: [{ role: 'user', content: 'hello' }],
    validateContent: (text) => {
      JSON.parse(text);
    },
  });

  assert.equal(out.model, 'provider/model-b:free');
  assert.deepEqual(seenModels, ['provider/model-a:free', 'provider/model-b:free']);
});

test('openRouter provider falls back to openrouter/free when discovery is unavailable', async () => {
  const seenModels = [];
  const provider = createOpenRouterProvider({
    apiKey: 'test-key',
    models: ['provider/model-a:free'],
    discoverFreeModels: true,
    discoveryTtlMs: 0,
    modelRankingStore: staticRankingStore(['provider/model-a:free', 'openrouter/free']),
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes('/models')) {
        throw new Error('catalog unavailable');
      }
      const body = JSON.parse(init.body);
      seenModels.push(body.model);
      if (body.model === 'provider/model-a:free') {
        return makeResponse(503, { error: { message: 'upstream unavailable' } });
      }
      return makeResponse(200, makeChoiceContent('{"ok":true}'));
    },
  });

  const out = await provider.generate({
    messages: [{ role: 'user', content: 'hello' }],
    validateContent: (text) => {
      JSON.parse(text);
    },
  });

  assert.equal(out.model, 'openrouter/free');
  assert.deepEqual(seenModels, ['provider/model-a:free', 'openrouter/free']);
});
