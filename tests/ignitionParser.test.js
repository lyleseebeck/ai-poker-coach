import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIgnitionHandHistory } from '../src/lib/ignitionParser.js';

function makeHistory(actionRows) {
  return [
    '#123456',
    'Start: 2026-03-07 12:00:00',
    'End: 2026-03-07 12:02:00',
    'Pot Size: $3.00',
    'Rake: $0.10',
    'Game Type: No Limit Holdem',
    'Play Mode: Real Money',
    'Table Name: Unit Test Table',
    'Community cards',
    ':',
    'Player Information',
    'Position\tSeat\tStack\tBet\tWin',
    'UTG [ME]\t1\t$100.00/$99.00\t$1.00\t-$1.00',
    'BTN\t2\t$100.00/$101.00\t$0.00\t$1.00',
    'Hand Session',
    'Position\tAction\tTime\tAmount',
    ...actionRows,
  ].join('\n');
}

test('does not parse set dealer seat value as money amount', () => {
  const parsed = parseIgnitionHandHistory(
    makeHistory([
      'Dealer\tSet dealer\t12:00',
      '3',
      'UTG [ME]\tFold\t12:01',
    ])
  );

  assert.equal(parsed.actions.length, 2);
  assert.equal(parsed.actions[0].action, 'Set dealer');
  assert.equal(parsed.actions[0].amount, null);
});

test('still parses standalone numeric amount for betting actions', () => {
  const parsed = parseIgnitionHandHistory(
    makeHistory([
      'UTG [ME]\tCall\t12:00',
      '2.50',
    ])
  );

  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0].action, 'Call');
  assert.equal(parsed.actions[0].amount, 2.5);
});
