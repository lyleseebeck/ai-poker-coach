import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyConflictResolution,
  applyParsedFieldsToSnapshot,
  buildNormalizeSnapshot,
  unresolvedConflictCount,
} from '../src/lib/normalizeMerge.js';

test('applyParsedFieldsToSnapshot auto-fills missing fields', () => {
  const snapshot = buildNormalizeSnapshot({
    heroCard1: '',
    heroCard2: '',
    heroPosition: '',
    didReachFlop: true,
    didReachFlopFilled: false,
    preflopAction: 'none',
    preflopAmountBb: '',
    preflopAmountChips: '',
    flopAction: 'none',
    turnAction: 'none',
    riverAction: 'none',
    netBb: '',
    netChips: '',
  });

  const { nextSnapshot, conflicts } = applyParsedFieldsToSnapshot(snapshot, {
    hero: { position: 'BTN', cards: ['As', 'Ah'] },
    board: { didReachFlop: true, cards: ['Js', 'Th', '2d', '9c'] },
    heroStreetSummary: {
      preflop: { action: 'raise', amountBb: 3 },
    },
    result: { netBb: -18 },
  });

  assert.equal(conflicts.length, 0);
  assert.equal(nextSnapshot.heroPosition, 'BTN');
  assert.equal(nextSnapshot.heroCard1, 'As');
  assert.equal(nextSnapshot.heroCard2, 'Ah');
  assert.equal(nextSnapshot.didReachFlop, true);
  assert.equal(nextSnapshot.flop1, 'Js');
  assert.equal(nextSnapshot.flop2, 'Th');
  assert.equal(nextSnapshot.flop3, '2d');
  assert.equal(nextSnapshot.turn, '9c');
  assert.equal(nextSnapshot.preflopAction, 'raise');
  assert.equal(nextSnapshot.preflopAmountBb, '3');
  assert.equal(nextSnapshot.netBb, '-18');
});

test('applyParsedFieldsToSnapshot flags conflicts for already-filled contradictory fields', () => {
  const snapshot = buildNormalizeSnapshot({
    heroCard1: 'Ks',
    heroCard2: 'Kh',
    flop1: 'Qc',
    heroPosition: 'CO',
    didReachFlop: true,
    didReachFlopFilled: true,
    preflopAction: 'call',
    preflopAmountBb: '2',
    preflopAmountChips: '',
    flopAction: 'none',
    turnAction: 'none',
    riverAction: 'none',
    netBb: '-5',
    netChips: '',
  });

  const { conflicts } = applyParsedFieldsToSnapshot(snapshot, {
    hero: { position: 'BTN', cards: ['As', 'Ah'] },
    board: { cards: ['Js', 'Th', '2d'] },
    heroStreetSummary: {
      preflop: { action: 'raise', amountBb: 3 },
    },
    result: { netBb: -20 },
  });

  assert.equal(conflicts.some((item) => item.id === 'hero.position'), true);
  assert.equal(conflicts.some((item) => item.id === 'hero.card1'), true);
  assert.equal(conflicts.some((item) => item.id === 'board.flop1'), true);
  assert.equal(conflicts.some((item) => item.id === 'heroStreetSummary.preflop.action'), true);
  assert.equal(conflicts.some((item) => item.id === 'result.netBb'), true);
  assert.equal(unresolvedConflictCount(conflicts), conflicts.length);
});

test('applyConflictResolution applies AI value when resolution is use_ai', () => {
  const snapshot = buildNormalizeSnapshot({
    heroPosition: 'CO',
    preflopAction: 'call',
    netBb: '-5',
  });
  const conflict = {
    id: 'heroStreetSummary.preflop.action',
    suggestedValue: 'raise',
  };

  const next = applyConflictResolution(snapshot, conflict, 'use_ai');
  assert.equal(next.preflopAction, 'raise');
});

test('unresolvedConflictCount ignores resolved conflicts', () => {
  const conflicts = [
    { id: 'a', resolution: null },
    { id: 'b', resolution: 'keep' },
    { id: 'c', resolution: 'use_ai' },
  ];
  assert.equal(unresolvedConflictCount(conflicts), 1);
});
