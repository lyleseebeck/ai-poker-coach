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

test('normalizeHandFromText infers explicit hero cards from separated and compact text without model help', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      throw new Error('should not be needed');
    },
  };

  const separated = await normalizeHandFromText(
    makePayload({
      manualActionText: 'I had As/Kd on the button. preflop I raised, villain folded, won 2.5bb',
      context: {
        heroPosition: 'BTN',
        boardCards: [],
        didReachFlop: false,
        stakes: { bb: 1, sb: 0.5 },
        heroCards: ['', ''],
        currentFields: {},
      },
    }),
    { provider }
  );

  const compact = await normalizeHandFromText(
    makePayload({
      manualActionText: 'I looked down at AsKd in the cutoff. preflop I folded and lost 0bb',
      context: {
        heroPosition: 'CO',
        boardCards: [],
        didReachFlop: false,
        stakes: { bb: 1, sb: 0.5 },
        heroCards: ['', ''],
        currentFields: {},
      },
    }),
    { provider }
  );

  assert.deepEqual(separated.parsedFields.hero.cards, ['As', 'Kd']);
  assert.equal(compact.parsedFields.hero.handCode, 'AKo');
});

test('normalizeHandFromText infers natural-language hand codes and avoids board-card duplicates', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      throw new Error('should not be needed');
    },
  };

  const response = await normalizeHandFromText(
    makePayload({
      manualActionText: 'Holding ace king suited on the button. flop As Td 2h. I bet flop, checked turn, won 8bb',
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

  assert.equal(response.parsedFields.hero.handCode, 'AKs');
  assert.equal(response.parsedFields.hero.cards.includes('As'), false);
  assert.equal(response.parsedFields.hero.cards.length, 2);
});

test('normalizeHandFromText does not infer hero cards from board text alone', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      throw new Error('should not be needed');
    },
  };

  const response = await normalizeHandFromText(
    makePayload({
      manualActionText: 'Flop As Kd 2h. Turn 9c. I bet flop and folded turn, lost 12bb',
      context: {
        heroPosition: 'BTN',
        boardCards: ['As', 'Kd', '2h', '9c'],
        didReachFlop: true,
        stakes: { bb: 1, sb: 0.5 },
        heroCards: ['', ''],
        currentFields: {},
      },
    }),
    { provider }
  );

  assert.equal(Array.isArray(response.parsedFields.hero.cards), false);
  assert.equal(response.missingRequired.includes('hero.cards'), true);
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
              hero: { position: 'BTN', handCode: 'AA', cards: ['As', 'Ah'] },
              board: { didReachFlop: true },
              heroStreetSummary: {
                preflop: { action: 'raise', amountBb: 9 },
                flop: { action: 'call', facingAmountBb: 4.5 },
                turn: { action: 'fold', facingAmountBb: 24 },
              },
              result: { netBb: -25 },
            },
            confidenceByField: {
              heroPosition: 0.95,
              heroCards: 0.95,
              heroHandCode: 0.95,
              boardDidReachFlop: 0.95,
              streetPreflop: 0.95,
              streetFlop: 0.95,
              streetTurn: 0.95,
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

test('normalizeHandFromTextStream stops early after a strong complete candidate', async () => {
  const events = [];
  let secondAttemptStarted = false;
  const payload = makePayload({
    manualActionText: 'button opens, flop call, turn fold',
    deterministicParse: {
      parsedFields: {
        hero: {
          position: 'BTN',
          handCode: 'AA',
        },
        board: {
          didReachFlop: true,
        },
        heroStreetSummary: {
          preflop: { action: 'raise', amountBb: 9 },
          flop: { action: 'call', facingAmountBb: 4.5 },
          turn: { action: 'fold', facingAmountBb: 24 },
        },
        result: {
          netBb: -25,
        },
      },
      confidence: {
        byField: {
          heroPosition: 0.95,
          heroHandCode: 0.95,
          boardDidReachFlop: 0.95,
          streetPreflop: 0.95,
          streetFlop: 0.95,
          streetTurn: 0.95,
          result_netBb: 0.95,
        },
      },
      missingRequired: ['hero.cards'],
    },
  });
  const provider = {
    name: 'openrouter',
    async generateWithProgress({ onAttempt }) {
      await onAttempt({
        phase: 'selection_plan',
        scope: 'normalize',
        strategy: 'ranked',
        plannedOrder: ['provider/model-a:free', 'provider/model-b:free'],
        totalModels: 2,
      });
      await onAttempt({
        phase: 'attempt_started',
        model: 'provider/model-a:free',
        attemptIndex: 1,
        totalModels: 2,
      });
      const stop = await onAttempt({
        phase: 'attempt_completed',
        model: 'provider/model-a:free',
        state: 'completed',
        durationMs: 12,
        attemptIndex: 1,
        totalModels: 2,
        candidate: {
          provider: 'openrouter',
          model: 'provider/model-a:free',
          content: JSON.stringify({
            parsedFields: {
              hero: { position: 'BTN', handCode: 'AA', cards: ['As', 'Ah'] },
              board: { didReachFlop: true },
              heroStreetSummary: {
                preflop: { action: 'raise', amountBb: 9 },
                flop: { action: 'call', facingAmountBb: 4.5 },
                turn: { action: 'fold', facingAmountBb: 24 },
              },
              result: { netBb: -25 },
            },
            confidenceByField: {
              heroPosition: 0.95,
              heroCards: 0.95,
              heroHandCode: 0.95,
              boardDidReachFlop: 0.95,
              streetPreflop: 0.95,
              streetFlop: 0.95,
              streetTurn: 0.95,
              result_netBb: 0.95,
            },
            missingRequired: [],
            needsUserInput: [],
          }),
          fallbackUsed: false,
        },
      });
      assert.equal(stop?.stop, true);
      assert.equal(stop?.stopReason, 'first_valid_candidate');
      secondAttemptStarted = false;
    },
  };

  const response = await normalizeHandFromTextStream(payload, {
    provider,
    writeEvent: async (event) => {
      events.push(event);
    },
  });

  assert.equal(secondAttemptStarted, false);
  assert.equal(events.some((event) => event.type === 'selection_plan'), true);
  assert.equal(response.meta.modelSelection.stopReason, 'first_valid_candidate');
  assert.equal(response.meta.attempts.length, 1);
});
