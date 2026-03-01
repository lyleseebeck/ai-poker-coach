import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManualActionText } from '../src/lib/manualActionParser.js';

test('infers BB position and blind loss for preflop fold narrative', () => {
  const parsed = parseManualActionText('villain raised preflop and i folded from BB');

  assert.equal(parsed.parsedFields.hero.position, 'BB');
  assert.equal(parsed.parsedFields.heroStreetSummary.preflop.action, 'fold');
  assert.equal(parsed.parsedFields.result.netBb, -1);
  assert.equal(parsed.missingRequired.length, 0);
  assert.ok(parsed.confidence.overall >= 0.75);
});

test('keeps netBb missing for ambiguous narrative and stays low-confidence', () => {
  const parsed = parseManualActionText('raised preflop but later he got me to fold');

  assert.equal(parsed.parsedFields.heroStreetSummary.preflop.action, 'fold');
  assert.equal(parsed.parsedFields.result.netBb, null);
  assert.ok(parsed.missingRequired.includes('result.netBb'));
  assert.ok(parsed.confidence.overall < 0.75);
});

test('detects preflop-only text and parses explicit small-blind loss', () => {
  const parsed = parseManualActionText("preflop i folded from sb and didn't reach flop, lost 0.5bb");

  assert.equal(parsed.parsedFields.hero.position, 'SB');
  assert.equal(parsed.parsedFields.board.didReachFlop, false);
  assert.equal(parsed.parsedFields.heroStreetSummary.preflop.action, 'fold');
  assert.equal(parsed.parsedFields.result.netBb, -0.5);
  assert.equal(parsed.missingRequired.length, 0);
});

test('uses boardCardsCount option to require later street actions', () => {
  const parsed = parseManualActionText('preflop i called', { boardCardsCount: 5 });

  assert.ok(parsed.missingRequired.includes('heroStreetSummary.flop.action'));
  assert.ok(parsed.missingRequired.includes('heroStreetSummary.turn.action'));
  assert.ok(parsed.missingRequired.includes('heroStreetSummary.river.action'));
});
