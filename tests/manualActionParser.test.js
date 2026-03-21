import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManualActionText } from '../src/lib/manualActionParser.js';

test('infers BB position and blind loss for preflop fold narrative', () => {
  const parsed = parseManualActionText('villain raised preflop and i folded from BB');

  assert.equal(parsed.parsedFields.hero.position, 'BB');
  assert.equal(parsed.parsedFields.heroStreetSummary.preflop.action, 'fold');
  assert.equal(parsed.parsedFields.result.netBb, -1);
  assert.ok(parsed.missingRequired.includes('hero.cards'));
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
  assert.ok(parsed.missingRequired.includes('hero.cards'));
});

test('uses boardCardsCount option to require later street actions', () => {
  const parsed = parseManualActionText('preflop i called', { boardCardsCount: 5 });

  assert.ok(parsed.missingRequired.includes('heroStreetSummary.flop.action'));
  assert.ok(parsed.missingRequired.includes('heroStreetSummary.turn.action'));
  assert.ok(parsed.missingRequired.includes('heroStreetSummary.river.action'));
});

test('tracks hero actions by street and infers standard 3-bet sizing when amount is missing', () => {
  const parsed = parseManualActionText(
    'i had AA in the button. villain raised, i 3bet, he called. flop JT2 rainbow. he check-raised, i call. turn 9, he jams, i fold'
  );

  assert.equal(parsed.parsedFields.hero.position, 'BTN');
  assert.equal(parsed.parsedFields.hero.cards.length, 2);
  assert.equal(parsed.parsedFields.hero.cards[0][0], 'A');
  assert.equal(parsed.parsedFields.hero.cards[1][0], 'A');
  assert.equal(parsed.parsedFields.hero.handCode, 'AA');
  assert.equal(parsed.parsedFields.heroStreetSummary.preflop.action, 'raise');
  assert.equal(parsed.parsedFields.heroStreetSummary.preflop.amountBb, 8);
  assert.equal(parsed.parsedFields.heroStreetSummary.flop.action, 'call');
  assert.equal(parsed.parsedFields.heroStreetSummary.flop.amountBb, 11.55);
  assert.equal(parsed.parsedFields.heroStreetSummary.flop.facingAmountBb, 11.55);
  assert.equal(parsed.parsedFields.heroStreetSummary.turn.action, 'fold');
  assert.equal(parsed.parsedFields.heroStreetSummary.turn.facingAmountBb, 40.6);
  assert.equal(parsed.parsedFields.result.netBb, -19.55);
  assert.equal(parsed.missingRequired.includes('heroStreetSummary.flop.action'), false);
  assert.equal(parsed.missingRequired.includes('heroStreetSummary.turn.action'), false);
  assert.equal(parsed.parsedFields.board.cards.length >= 4, true);
  assert.equal(parsed.parsedFields.board.cards.map((card) => card[0]).join(''), 'JT29');
});

test('infers fold-street result when hero bets then folds to a jam', () => {
  const parsed = parseManualActionText(
    'i had AA in the button. villain raised, i 3bet, he called. flop JT2 rainbow. he check-raised, i call. turn 9, he checks, i bet, he jams, i fold'
  );

  assert.equal(parsed.parsedFields.heroStreetSummary.turn.action, 'fold');
  assert.equal(parsed.parsedFields.heroStreetSummary.turn.facingAmountBb, 40.6);
  assert.equal(parsed.parsedFields.heroStreetSummary.turn.streetNetBb, -26.8);
  assert.equal(parsed.parsedFields.result.netBb, -46.35);
});

test('keeps explicit turn rank from text and ignores rank letters inside action words', () => {
  const parsed = parseManualActionText(
    'I had JJ, I raise, he calls. flop T92 rainbow. i bet he raises, i call. turn K, i check, he jams all-in, i fold.'
  );

  assert.equal(parsed.parsedFields.hero.cards.length, 2);
  assert.equal(parsed.parsedFields.hero.cards[0][0], 'J');
  assert.equal(parsed.parsedFields.hero.cards[1][0], 'J');
  assert.equal(parsed.parsedFields.board.cards.map((card) => card[0]).join(''), 'T92K');
  assert.equal(parsed.parsedFields.board.cards[3][0], 'K');
});

test('parses explicit hero cards with separators and compact notation', () => {
  const separated = parseManualActionText('I had As, Kd on the button. preflop I raised and won 3bb');
  const compact = parseManualActionText('I looked down at AsKd in the cutoff. preflop I folded and lost 0bb');

  assert.deepEqual(separated.parsedFields.hero.cards, ['As', 'Kd']);
  assert.equal(separated.parsedFields.hero.handCode, 'AKo');
  assert.deepEqual(compact.parsedFields.hero.cards, ['As', 'Kd']);
  assert.equal(compact.parsedFields.hero.handCode, 'AKo');
});

test('parses natural-language suited and offsuit hero hand phrases', () => {
  const suited = parseManualActionText('Holding ace king suited on the button, I raised preflop and won 4bb');
  const offsuit = parseManualActionText('Hero had king queen offsuit in the cutoff. preflop hero folded and lost 0bb');
  const pocket = parseManualActionText('I had pocket aces in the small blind and won 2bb preflop');
  const shorthand = parseManualActionText('I had AQo on the button. preflop I folded and lost 0bb');

  assert.equal(suited.parsedFields.hero.handCode, 'AKs');
  assert.equal(Array.isArray(suited.parsedFields.hero.cards), true);
  assert.equal(offsuit.parsedFields.hero.handCode, 'KQo');
  assert.equal(Array.isArray(offsuit.parsedFields.hero.cards), true);
  assert.equal(pocket.parsedFields.hero.handCode, 'AA');
  assert.equal(Array.isArray(pocket.parsedFields.hero.cards), true);
  assert.equal(shorthand.parsedFields.hero.handCode, 'AQo');
  assert.equal(Array.isArray(shorthand.parsedFields.hero.cards), true);
});
