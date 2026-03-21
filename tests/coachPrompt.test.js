import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialCoachMessages } from '../server/coach/coachPrompt.js';

function makeHandContext() {
  return {
    handId: 'hand-1',
    hero: {
      cards: ['Ks', 'Kd'],
      position: 'BTN',
      handCode: 'KK',
    },
    board: {
      didReachFlop: true,
      cards: ['Kh', '7d', '2c'],
    },
    heroStreetSummary: {
      preflop: { action: 'call', amountBb: 2.5, amountChips: null },
      flop: { action: 'check', amountBb: null, amountChips: null },
      turn: null,
      river: null,
    },
    heroHandFacts: {
      heroMadeHandCategory: 'trips',
      heroPairingDetail: 'top_set',
    },
    factCheckGroundTruth: {
      heroCards: ['Ks', 'Kd'],
      heroHandCode: 'KK',
      heroPosition: 'BTN',
      preflopLastAggressorPosition: 'CO',
      heroWasPreflopAggressor: false,
      heroCanCbetFlop: false,
      heroPostflopPosition: 'in_position',
      heroMadeHandCategory: 'trips',
      heroPairingDetail: 'top_set',
    },
  };
}

test('buildInitialCoachMessages serializes hero cards, board cards, and pairing facts into the prompt context', () => {
  const messages = buildInitialCoachMessages({
    handContext: makeHandContext(),
    history: [{ role: 'user', content: 'Earlier question' }],
    message: 'How should I play this hand?',
    historyWindowSize: 8,
  });

  assert.equal(messages.length, 4);
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /"cards": \[\s*"Kh"/i);
  assert.match(messages[1].content, /"heroMadeHandCategory": "trips"/i);
  assert.match(messages[1].content, /"heroPairingDetail": "top_set"/i);
});
