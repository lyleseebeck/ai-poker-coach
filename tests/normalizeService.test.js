import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHandFromText, normalizeHandFromTextStream } from '../server/normalize/normalizeService.js';

function makePayload(overrides = {}) {
  return {
    manualActionText: 'i had AA in the button. villain raised, i 3bet, he called. turn 9, he jams, i fold',
    context: {
      heroPosition: 'BTN',
      boardCards: ['Jc', 'Td', '2h', '9s'],
      didReachFlop: true,
      stakes: { bb: 1, sb: 0.5 },
      heroCards: ['', ''],
      currentFields: {},
    },
    deterministicParse: null,
    ...overrides,
  };
}

test('normalizeHandFromText merges valid model payload on top of deterministic parse', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      return {
        provider: 'openrouter',
        model: 'test/model:free',
        fallbackUsed: false,
        content: JSON.stringify({
          parsedFields: {
            hero: {
              position: 'BTN',
              handCode: 'AA',
            },
            heroStreetSummary: {
              preflop: { action: 'raise', amountBb: 9 },
              turn: { action: 'fold', facingAmountBb: 24 },
            },
            result: {
              netBb: -25,
            },
          },
          confidenceByField: {
            heroPosition: 0.95,
          },
          missingRequired: [],
          needsUserInput: [],
        }),
      };
    },
  };

  const response = await normalizeHandFromText(makePayload(), { provider });

  assert.equal(response.meta.fallbackUsed, false);
  assert.equal(response.meta.model, 'test/model:free');
  assert.equal(response.parsedFields.hero.position, 'BTN');
  assert.equal(response.parsedFields.heroStreetSummary.preflop.action, 'raise');
  assert.equal(response.parsedFields.heroStreetSummary.turn.facingAmountBb, 24);
  assert.equal(response.parsedFields.result.netBb, -25);
  assert.equal(Array.isArray(response.parsedFields.hero.cards), true);
  assert.equal(response.parsedFields.hero.cards.length, 2);
});

test('normalizeHandFromText falls back when model payload is invalid', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      return {
        provider: 'openrouter',
        model: 'test/model:free',
        fallbackUsed: false,
        content: JSON.stringify({
          parsedFields: {
            heroStreetSummary: {
              preflop: { action: 'explode' },
            },
          },
        }),
      };
    },
  };

  const response = await normalizeHandFromText(makePayload(), { provider });

  assert.equal(response.meta.fallbackUsed, true);
  assert.equal(response.model, 'deterministic-manual-v1');
  assert.equal(response.parsedFields.heroStreetSummary.preflop.action !== 'explode', true);
});

test('normalizeHandFromText falls back when provider request fails', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      throw new Error('network');
    },
  };

  const response = await normalizeHandFromText(makePayload(), { provider });

  assert.equal(response.meta.fallbackUsed, true);
  assert.equal(response.meta.provider, 'openrouter');
  assert.equal(Array.isArray(response.missingRequired), true);
});

test('normalizeHandFromText canonicalizes shorthand hand code and avoids board duplicates', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      return {
        provider: 'openrouter',
        model: 'test/model:free',
        fallbackUsed: false,
        content: JSON.stringify({
          parsedFields: {
            hero: {
              handCode: 'AA',
            },
          },
          confidenceByField: {},
          missingRequired: [],
          needsUserInput: [],
        }),
      };
    },
  };

  const response = await normalizeHandFromText(
    makePayload({
      context: {
        heroPosition: 'BTN',
        boardCards: ['As', 'Td', '2h'],
        didReachFlop: true,
        stakes: { bb: 1, sb: 0.5 },
        heroCards: ['', ''],
        currentFields: {},
      },
    }),
    { provider }
  );

  const cards = response.parsedFields.hero.cards;
  assert.equal(Array.isArray(cards), true);
  assert.equal(cards.length, 2);
  assert.notEqual(cards[0], 'As');
  assert.notEqual(cards[1], 'As');
  assert.equal(cards[0][0], 'A');
  assert.equal(cards[1][0], 'A');
});

test('normalizeHandFromTextStream emits provisional result and keeps checking later attempts', async () => {
  const events = [];
  const provider = {
    name: 'openrouter',
    async generateWithProgress({ onAttempt }) {
      await onAttempt({
        phase: 'attempt_started',
        model: 'provider/model-a:free',
        attemptIndex: 1,
        totalModels: 3,
      });
      await onAttempt({
        phase: 'attempt_completed',
        model: 'provider/model-a:free',
        state: 'completed',
        durationMs: 12,
        attemptIndex: 1,
        totalModels: 3,
        candidate: {
          provider: 'openrouter',
          model: 'provider/model-a:free',
          content: JSON.stringify({
            parsedFields: {
              hero: { position: 'BTN' },
            },
            confidenceByField: {
              heroPosition: 0.55,
            },
            missingRequired: [],
            needsUserInput: [],
          }),
          fallbackUsed: false,
        },
      });

      await onAttempt({
        phase: 'attempt_started',
        model: 'provider/model-b:free',
        attemptIndex: 2,
        totalModels: 3,
      });
      await onAttempt({
        phase: 'attempt_completed',
        model: 'provider/model-b:free',
        state: 'failed',
        reason: 'timeout',
        durationMs: 45_000,
        attemptIndex: 2,
        totalModels: 3,
      });

      await onAttempt({
        phase: 'attempt_started',
        model: 'provider/model-c:free',
        attemptIndex: 3,
        totalModels: 3,
      });
      await onAttempt({
        phase: 'attempt_completed',
        model: 'provider/model-c:free',
        state: 'completed',
        durationMs: 18,
        attemptIndex: 3,
        totalModels: 3,
        candidate: {
          provider: 'openrouter',
          model: 'provider/model-c:free',
          content: JSON.stringify({
            parsedFields: {
              hero: { position: 'BTN', handCode: 'AA' },
              result: { netBb: -25 },
            },
            confidenceByField: {
              heroPosition: 0.95,
              result_netBb: 0.95,
            },
            missingRequired: [],
            needsUserInput: [],
          }),
          fallbackUsed: true,
        },
      });
    },
  };

  const response = await normalizeHandFromTextStream(makePayload(), {
    provider,
    writeEvent: async (event) => {
      events.push(event);
    },
  });

  assert.equal(events[0].type, 'deterministic_started');
  assert.equal(events[1].type, 'deterministic_completed');
  assert.equal(events.some((event) => event.type === 'provisional_result' && event.model === 'provider/model-a:free'), true);
  assert.equal(events.some((event) => event.type === 'attempt_completed' && event.model === 'provider/model-b:free' && event.reason === 'timeout'), true);
  assert.equal(events[events.length - 1].type, 'final_result');
  assert.equal(response.meta.model, 'provider/model-c:free');
  assert.equal(response.meta.resultSource, 'model_merged');
  assert.equal(Array.isArray(response.meta.attempts), true);
  assert.equal(response.meta.attempts.length, 3);
});
