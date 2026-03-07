import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalHandCode, buildHandContext } from '../server/coach/handContext.js';

test('buildCanonicalHandCode derives suited, offsuit, and pair formats', () => {
  assert.equal(buildCanonicalHandCode(['5d', '4d']), '54s');
  assert.equal(buildCanonicalHandCode(['Jh', 'Ac']), 'AJo');
  assert.equal(buildCanonicalHandCode(['7c', '7d']), '77');
});

test('buildHandContext derives preflop aggressor and postflop position facts', () => {
  const context = buildHandContext({
    id: 'hand-1',
    source: { mode: 'manual' },
    hero: { cards: ['5d', '4d'], position: 'BB' },
    table: { numPlayers: 8, stakes: { sb: 0.5, bb: 1 } },
    board: { didReachFlop: true, cards: ['Qs', '8d', '2c'] },
    heroStreetSummary: {
      preflop: { action: 'call' },
      flop: { action: 'check' },
      turn: { action: 'fold' },
      river: null,
    },
    timeline: {
      actions: [
        { seq: 1, street: 'preflop', position: 'UTG+1', actionNorm: 'raise', isHero: false },
        { seq: 2, street: 'preflop', position: 'BB', actionNorm: 'call', isHero: true },
        { seq: 3, street: 'flop', position: 'BB', actionNorm: 'check', isHero: true },
        { seq: 4, street: 'flop', position: 'UTG+1', actionNorm: 'bet', isHero: false },
      ],
    },
  });

  assert.equal(context.factCheckGroundTruth.heroHandCode, '54s');
  assert.equal(context.factCheckGroundTruth.preflopLastAggressorPosition, 'UTG+1');
  assert.equal(context.factCheckGroundTruth.heroWasPreflopAggressor, false);
  assert.equal(context.factCheckGroundTruth.heroCanCbetFlop, false);
  assert.equal(context.factCheckGroundTruth.heroPostflopPosition, 'out_of_position');
});

test('buildHandContext marks hero as c-bet eligible when hero was last preflop aggressor', () => {
  const context = buildHandContext({
    id: 'hand-2',
    source: { mode: 'manual' },
    hero: { cards: ['Ah', 'Qc'], position: 'BTN' },
    table: { numPlayers: 6, stakes: { sb: 0.5, bb: 1 } },
    board: { didReachFlop: true, cards: ['Ts', '8d', '2c'] },
    heroStreetSummary: {
      preflop: { action: 'raise' },
      flop: { action: 'check' },
      turn: null,
      river: null,
    },
    timeline: {
      actions: [
        { seq: 1, street: 'preflop', position: 'CO', actionNorm: 'raise', isHero: false },
        { seq: 2, street: 'preflop', position: 'BTN', actionNorm: 'raise', isHero: true },
      ],
    },
  });

  assert.equal(context.factCheckGroundTruth.preflopLastAggressorPosition, 'BTN');
  assert.equal(context.factCheckGroundTruth.heroWasPreflopAggressor, true);
  assert.equal(context.factCheckGroundTruth.heroCanCbetFlop, true);
});
