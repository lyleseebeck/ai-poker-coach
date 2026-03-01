import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHandRecordV2,
  createEmptyHandDraft,
  deriveResultMagnitude,
  deriveResultTag,
  validateHandDraft,
} from '../src/lib/handSchema.js';

function makeValidFlopDraft() {
  const draft = createEmptyHandDraft();
  draft.hero.cards = ['As', 'Kd'];
  draft.hero.position = 'CO';
  draft.table.numPlayers = 8;
  draft.table.stakes.bb = 1;
  draft.board.didReachFlop = true;
  draft.board.cards = ['2c', '7d', 'Jh'];
  draft.heroStreetSummary.preflop = {
    action: 'call',
    amountBb: 1,
    amountChips: 1,
    source: 'manual',
  };
  draft.heroStreetSummary.flop = {
    action: 'fold',
    amountBb: null,
    amountChips: null,
    source: 'manual',
  };
  draft.result.netBb = -2;
  return draft;
}

test('validateHandDraft accepts a valid V2 flop hand', () => {
  const validation = validateHandDraft(makeValidFlopDraft(), { requireBb: true });
  assert.equal(validation.isValid, true);
  assert.deepEqual(validation.errors, {});
});

test('validateHandDraft rejects duplicate cards across hero and board', () => {
  const draft = makeValidFlopDraft();
  draft.board.cards = ['As', '7d', 'Jh'];
  const validation = validateHandDraft(draft, { requireBb: true });
  assert.equal(validation.isValid, false);
  assert.match(String(validation.errors.duplicateCards), /Duplicate card detected/i);
});

test('validateHandDraft rejects invalid board length when flop is reached', () => {
  const draft = makeValidFlopDraft();
  draft.board.cards = ['2c', '7d'];
  const validation = validateHandDraft(draft, { requireBb: true });
  assert.equal(validation.isValid, false);
  assert.match(String(validation.errors.board), /exactly 3, 4, or 5 cards/i);
});

test('preflop-only draft builds with postflop decisions set to null', () => {
  const draft = createEmptyHandDraft();
  draft.hero.cards = ['Ah', 'Qc'];
  draft.hero.position = 'BB';
  draft.table.numPlayers = 9;
  draft.table.stakes.bb = 1;
  draft.board.didReachFlop = false;
  draft.board.cards = [];
  draft.heroStreetSummary.preflop = {
    action: 'fold',
    amountBb: null,
    amountChips: null,
    source: 'manual',
  };
  draft.result.netBb = -1;

  const hand = buildHandRecordV2(draft, { requireBb: true });
  assert.equal(hand.board.didReachFlop, false);
  assert.deepEqual(hand.board.cards, []);
  assert.equal(hand.heroStreetSummary.flop, null);
  assert.equal(hand.heroStreetSummary.turn, null);
  assert.equal(hand.heroStreetSummary.river, null);
});

test('deriveResultTag and deriveResultMagnitude map expected buckets', () => {
  assert.equal(deriveResultTag(8), 'win');
  assert.equal(deriveResultTag(-0.5), 'loss');
  assert.equal(deriveResultTag(0), 'breakeven');

  assert.equal(deriveResultMagnitude(4.9), 'tiny');
  assert.equal(deriveResultMagnitude(5), 'small');
  assert.equal(deriveResultMagnitude(20), 'medium');
  assert.equal(deriveResultMagnitude(50), 'large');
  assert.equal(deriveResultMagnitude(100), 'massive');
});
