import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_WINDOW_SIZE,
  MAX_HISTORY_CONTENT_LENGTH,
  MAX_MESSAGE_LENGTH,
  parseCoachModelJson,
  truncateHistoryWindow,
  validateCoachModelPayload,
  validateCoachRequest,
} from '../server/coach/coachSchema.js';

function makeValidRequest(overrides = {}) {
  return {
    handId: 'hand-1',
    hand: {
      id: 'hand-1',
      schemaVersion: 2,
      hero: { cards: ['As', 'Kd'], position: 'BTN' },
      board: { cards: ['2c', '7d', 'Jh'], didReachFlop: true },
    },
    message: 'How can I improve this line?',
    history: [{ role: 'user', content: 'Earlier question' }],
    ...overrides,
  };
}

function makeValidModelPayload() {
  return {
    assistant: {
      content: 'You over-defended preflop and over-bluffed turn.',
      analysis: {
        situationSummary: 'Single-raised pot where you reached river with capped range.',
        biggestLeaks: ['Calling too wide preflop'],
        gtoCorrections: ['Fold more offsuit broadways versus early opens.'],
        streetPlan: {
          preflop: 'Tighten defend frequency.',
          flop: 'Check more medium-strength bluff-catchers.',
          turn: 'Reduce bluff density on bad turns.',
          river: 'Use clearer value/bluff splits based on blockers.',
        },
        exploitativeAdjustments: ['Versus this pool, overfold river bluff-catchers without blockers.'],
        practiceDrills: ['Run 20 BB BTN vs BB SRP turn nodes in solver.'],
        nextSessionFocus: 'Preflop defend thresholds by position.',
        confidence: 'medium',
        assumptions: ['Assuming villain opens standard ranges for 6-max cash.'],
      },
    },
  };
}

test('validateCoachRequest accepts a valid payload', () => {
  const parsed = validateCoachRequest(makeValidRequest());
  assert.equal(parsed.handId, 'hand-1');
  assert.equal(parsed.message, 'How can I improve this line?');
  assert.equal(parsed.history.length, 1);
});

test('validateCoachRequest rejects empty message', () => {
  assert.throws(
    () => validateCoachRequest(makeValidRequest({ message: '   ' })),
    /message is required/i
  );
});

test('validateCoachRequest rejects invalid history role', () => {
  assert.throws(
    () =>
      validateCoachRequest(
        makeValidRequest({
          history: [{ role: 'system', content: 'nope' }],
        })
      ),
    /role must be "user" or "assistant"/i
  );
});

test('validateCoachRequest rejects non-v2 hand', () => {
  assert.throws(
    () =>
      validateCoachRequest(
        makeValidRequest({
          hand: { schemaVersion: 1 },
        })
      ),
    /schemaVersion must be 2/i
  );
});

test('validateCoachRequest enforces message size limit', () => {
  assert.throws(
    () => validateCoachRequest(makeValidRequest({ message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })),
    /must be <=/i
  );
});

test('validateCoachRequest enforces history content limit', () => {
  assert.throws(
    () =>
      validateCoachRequest(
        makeValidRequest({
          history: [{ role: 'assistant', content: 'x'.repeat(MAX_HISTORY_CONTENT_LENGTH + 1) }],
        })
      ),
    /history\[0\]\.content must be <=/i
  );
});

test('truncateHistoryWindow keeps latest N items and marks truncation', () => {
  const history = Array.from({ length: HISTORY_WINDOW_SIZE + 3 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `msg-${index}`,
  }));

  const result = truncateHistoryWindow(history, HISTORY_WINDOW_SIZE);
  assert.equal(result.truncated, true);
  assert.equal(result.history.length, HISTORY_WINDOW_SIZE);
  assert.equal(result.history[0].content, 'msg-3');
});

test('parseCoachModelJson accepts fenced JSON', () => {
  const parsed = parseCoachModelJson('```json\n{"assistant": {"content": "ok", "analysis": {}}}\n```');
  assert.equal(typeof parsed, 'object');
});

test('validateCoachModelPayload accepts valid model shape', () => {
  const parsed = validateCoachModelPayload(makeValidModelPayload());
  assert.equal(parsed.assistant.analysis.confidence, 'medium');
});

test('validateCoachModelPayload rejects missing required fields', () => {
  const invalid = makeValidModelPayload();
  delete invalid.assistant.analysis.streetPlan.turn;
  assert.throws(() => validateCoachModelPayload(invalid), /streetPlan\.turn is required/i);
});

test('validateCoachModelPayload rejects bad field type', () => {
  const invalid = makeValidModelPayload();
  invalid.assistant.analysis.biggestLeaks = 'not-an-array';
  assert.throws(() => validateCoachModelPayload(invalid), /biggestLeaks must be an array/i);
});
