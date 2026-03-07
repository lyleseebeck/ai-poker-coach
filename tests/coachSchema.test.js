import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_WINDOW_SIZE,
  MAX_HISTORY_CONTENT_LENGTH,
  MAX_MESSAGE_LENGTH,
  deriveOverallVerdictFromStreetVerdicts,
  parseCoachModelJson,
  truncateHistoryWindow,
  validateFollowupCoachModelPayload,
  validateInitialCoachModelPayload,
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

function makeValidInitialPayload() {
  return {
    assistant: {
      content: 'You defended preflop correctly and folded turn correctly.',
      analysis: {
        factCheck: {
          heroCards: ['As', 'Kd'],
          heroHandCode: 'AKo',
          heroPosition: 'BTN',
          preflopLastAggressorPosition: 'CO',
          heroWasPreflopAggressor: false,
          heroCanCbetFlop: false,
          heroPostflopPosition: 'out_of_position',
        },
        overallVerdict: 'incorrect',
        overallReason: 'Preflop and turn were fine, flop needed more aggression.',
        streetVerdicts: [
          {
            street: 'preflop',
            heroAction: 'Call versus open',
            verdict: 'correct',
            reason: 'Defend is in range.',
            gtoPreferredAction: 'Mostly call with occasional 3-bet mix.',
          },
          {
            street: 'flop',
            heroAction: 'Check',
            verdict: 'mixed',
            reason: 'Check is acceptable but can miss value in some runouts.',
            gtoPreferredAction: 'Mix checks and small bets when equity realization is favorable.',
          },
        ],
        keyAdjustments: ['Use clearer flop criteria for when to lead.', 'Protect turn folds versus larger sizing.'],
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
  const parsed = parseCoachModelJson('```json\n{"assistant":{"content":"ok","analysis":{}}}\n```');
  assert.equal(typeof parsed, 'object');
});

test('deriveOverallVerdictFromStreetVerdicts follows worst-street rule', () => {
  assert.equal(
    deriveOverallVerdictFromStreetVerdicts([
      { verdict: 'mixed' },
      { verdict: 'correct' },
      { verdict: 'correct' },
    ]),
    'mixed'
  );
  assert.equal(
    deriveOverallVerdictFromStreetVerdicts([
      { verdict: 'correct' },
      { verdict: 'correct' },
    ]),
    'correct'
  );
  assert.equal(
    deriveOverallVerdictFromStreetVerdicts([
      { verdict: 'incorrect' },
      { verdict: 'correct' },
    ]),
    'incorrect'
  );
  assert.equal(deriveOverallVerdictFromStreetVerdicts([{ verdict: 'unclear' }]), 'unclear');
});

test('validateInitialCoachModelPayload accepts valid model shape and derives overallVerdict', () => {
  const parsed = validateInitialCoachModelPayload(makeValidInitialPayload());
  assert.equal(parsed.assistant.analysis.confidence, 'medium');
  assert.equal(parsed.assistant.analysis.overallVerdict, 'mixed');
  assert.equal(parsed.assistant.analysis.keyAdjustments.length, 2);
});

test('validateInitialCoachModelPayload rejects missing required fields', () => {
  const invalid = makeValidInitialPayload();
  delete invalid.assistant.analysis.overallReason;
  assert.throws(() => validateInitialCoachModelPayload(invalid), /overallReason is required/i);
});

test('validateInitialCoachModelPayload rejects duplicate street verdicts', () => {
  const invalid = makeValidInitialPayload();
  invalid.assistant.analysis.streetVerdicts.push({
    street: 'flop',
    heroAction: 'Second flop action',
    verdict: 'mixed',
    reason: 'Duplicate street.',
    gtoPreferredAction: 'Use one verdict per street.',
  });

  assert.throws(() => validateInitialCoachModelPayload(invalid), /duplicate street/i);
});

test('validateInitialCoachModelPayload rejects invalid verdict enum', () => {
  const invalid = makeValidInitialPayload();
  invalid.assistant.analysis.streetVerdicts[0].verdict = 'great';
  assert.throws(() => validateInitialCoachModelPayload(invalid), /must be one of/i);
});

test('validateInitialCoachModelPayload rejects suitedness mismatch inside fact check', () => {
  const invalid = makeValidInitialPayload();
  invalid.assistant.analysis.factCheck.heroCards = ['5d', '4d'];
  invalid.assistant.analysis.factCheck.heroHandCode = '54o';
  assert.throws(() => validateInitialCoachModelPayload(invalid), /heroHandCode must match heroCards/i);
});

test('validateInitialCoachModelPayload rejects illegal c-bet guidance when hero cannot c-bet flop', () => {
  const invalid = makeValidInitialPayload();
  invalid.assistant.analysis.factCheck.heroCanCbetFlop = false;
  invalid.assistant.analysis.keyAdjustments = ['Flop: c-bet small at low frequency.'];
  assert.throws(() => validateInitialCoachModelPayload(invalid), /illegal flop c-bet guidance/i);
});

test('validateInitialCoachModelPayload rejects in-position wording when hero is out of position', () => {
  const invalid = makeValidInitialPayload();
  invalid.assistant.analysis.factCheck.heroPostflopPosition = 'out_of_position';
  invalid.assistant.analysis.keyAdjustments = ['Take the in position check back line more often.'];
  assert.throws(() => validateInitialCoachModelPayload(invalid), /out-of-position postflop facts/i);
});

test('validateInitialCoachModelPayload rejects explicit percentages', () => {
  const invalid = makeValidInitialPayload();
  invalid.assistant.analysis.keyAdjustments = ['3-bet 15% in this spot.'];
  assert.throws(() => validateInitialCoachModelPayload(invalid), /percentage frequencies are not allowed/i);
});

test('validateFollowupCoachModelPayload accepts lightweight followup shape', () => {
  const parsed = validateFollowupCoachModelPayload({
    assistant: {
      content: 'Check-raising turn can work if villain over-c-bets and over-folds to aggression.',
      followupHighlights: ['Prefer check-raise with equity + blockers.', 'Fold pure air versus strong double barrels.'],
    },
  });

  assert.equal(parsed.assistant.content.length > 0, true);
  assert.equal(parsed.assistant.followupHighlights.length, 2);
});

test('validateFollowupCoachModelPayload rejects missing assistant content', () => {
  assert.throws(
    () =>
      validateFollowupCoachModelPayload({
        assistant: {
          followupHighlights: ['Only bullets'],
        },
      }),
    /assistant\.content is required/i
  );
});
