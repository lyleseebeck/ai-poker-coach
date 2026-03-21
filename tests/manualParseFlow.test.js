import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSatisfiedManualMissingFields, shouldOfferManualAiAssist } from '../src/lib/manualParseFlow.js';

test('filterSatisfiedManualMissingFields removes fields already satisfied in the current form snapshot', () => {
  const remaining = filterSatisfiedManualMissingFields(
    ['hero.cards', 'hero.position', 'heroStreetSummary.preflop.action', 'result.netBb'],
    {
      heroCard1: 'As',
      heroCard2: 'Kd',
      heroPosition: 'BTN',
      preflopAction: 'raise',
      netBb: '',
    }
  );

  assert.deepEqual(remaining, ['result.netBb']);
});

test('shouldOfferManualAiAssist returns true for outstanding missing fields', () => {
  assert.equal(
    shouldOfferManualAiAssist({
      parsed: { confidence: { overall: 0.92 } },
      remainingMissingRequired: ['hero.cards'],
    }),
    true
  );
});

test('shouldOfferManualAiAssist returns true for low-confidence parses even with no missing fields', () => {
  assert.equal(
    shouldOfferManualAiAssist({
      parsed: { confidence: { overall: 0.4 } },
      remainingMissingRequired: [],
    }),
    true
  );
});

test('shouldOfferManualAiAssist returns false for complete, confident parses', () => {
  assert.equal(
    shouldOfferManualAiAssist({
      parsed: { confidence: { overall: 0.92 } },
      remainingMissingRequired: [],
    }),
    false
  );
});
