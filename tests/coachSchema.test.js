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
        factCheck: {
          heroCards: ['As', 'Kd'],
          heroHandCode: 'AKo',
          heroPosition: 'BTN',
          preflopLastAggressorPosition: 'CO',
          heroWasPreflopAggressor: false,
          heroCanCbetFlop: true,
          heroPostflopPosition: 'in_position',
        },
        overallVerdict: 'mixed',
        overallReason: 'Preflop is standard, but the flop line gives up too much EV.',
        streetVerdicts: [
          {
            street: 'preflop',
            heroAction: 'Called versus open',
            verdict: 'correct',
            reason: 'This defend appears within baseline range at this stack depth.',
            gtoPreferredAction: 'Mostly call, occasional low-frequency 3-bet mix.',
          },
          {
            street: 'flop',
            heroAction: 'Checked back',
            verdict: 'incorrect',
            reason: 'Your range keeps enough advantage to c-bet more often.',
            gtoPreferredAction: 'Use a small c-bet at high frequency.',
          },
        ],
        biggestLeaks: ['Calling too wide preflop'],
        gtoCorrections: ['Fold more offsuit broadways versus early opens.'],
        topAlternatives: [
          'Flop: use a small bet with range advantage and backdoor equity.',
          'Turn: after check-back flop, value-bet thinner and reduce bluff density.',
        ],
        exploitativeAdjustments: ['Versus this pool, overfold river bluff-catchers without blockers.'],
        confidence: 'medium',
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
  assert.equal(parsed.assistant.analysis.overallVerdict, 'mixed');
});

test('validateCoachModelPayload rejects missing required fields', () => {
  const invalid = makeValidModelPayload();
  delete invalid.assistant.analysis.overallReason;
  assert.throws(() => validateCoachModelPayload(invalid), /overallReason is required/i);
});

test('validateCoachModelPayload rejects bad field type', () => {
  const invalid = makeValidModelPayload();
  invalid.assistant.analysis.biggestLeaks = 'not-an-array';
  assert.throws(() => validateCoachModelPayload(invalid), /biggestLeaks must be an array/i);
});

test('validateCoachModelPayload rejects duplicate street verdicts', () => {
  const invalid = makeValidModelPayload();
  invalid.assistant.analysis.streetVerdicts.push({
    street: 'flop',
    heroAction: 'Second flop action',
    verdict: 'mixed',
    reason: 'Duplicate street.',
    gtoPreferredAction: 'Use one verdict per street.',
  });

  assert.throws(() => validateCoachModelPayload(invalid), /duplicate street/i);
});

test('validateCoachModelPayload rejects invalid verdict enum', () => {
  const invalid = makeValidModelPayload();
  invalid.assistant.analysis.overallVerdict = 'great';
  assert.throws(() => validateCoachModelPayload(invalid), /overallVerdict must be one of/i);
});

test('validateCoachModelPayload enforces exactly two top alternatives', () => {
  const invalid = makeValidModelPayload();
  invalid.assistant.analysis.topAlternatives = ['Only one'];
  assert.throws(() => validateCoachModelPayload(invalid), /topAlternatives must contain exactly 2 items/i);
});

test('validateCoachModelPayload rejects suitedness mismatch inside fact check', () => {
  const invalid = makeValidModelPayload();
  invalid.assistant.analysis.factCheck.heroCards = ['5d', '4d'];
  invalid.assistant.analysis.factCheck.heroHandCode = '54o';
  assert.throws(() => validateCoachModelPayload(invalid), /heroHandCode must match heroCards/i);
});

test('validateCoachModelPayload rejects illegal c-bet guidance when hero cannot c-bet flop', () => {
  const invalid = makeValidModelPayload();
  invalid.assistant.analysis.factCheck.heroCanCbetFlop = false;
  invalid.assistant.analysis.topAlternatives[0] = 'Flop: c-bet small at low frequency.';
  assert.throws(() => validateCoachModelPayload(invalid), /illegal flop c-bet guidance/i);
});

test('validateCoachModelPayload rejects in-position wording when hero is out of position', () => {
  const invalid = makeValidModelPayload();
  invalid.assistant.analysis.factCheck.heroPostflopPosition = 'out_of_position';
  invalid.assistant.analysis.gtoCorrections = ['Take the in position check back line more often.'];
  assert.throws(() => validateCoachModelPayload(invalid), /out-of-position postflop facts/i);
});

test('validateCoachModelPayload rejects explicit percentages', () => {
  const invalid = makeValidModelPayload();
  invalid.assistant.analysis.gtoCorrections = ['3-bet 15% in this spot.'];
  assert.throws(() => validateCoachModelPayload(invalid), /percentage frequencies are not allowed/i);
});
