import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHandFromText } from '../server/normalize/normalizeService.js';

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
