import test from 'node:test';
import assert from 'node:assert/strict';
import { coachHand } from '../server/coach/coachService.js';
import { HISTORY_WINDOW_SIZE } from '../server/coach/coachSchema.js';
import { createCoachError } from '../server/coach/errors.js';

function makeInitialModelOutput(overrides = {}) {
  return JSON.stringify({
    assistant: {
      content: 'Accessible coaching summary for this hand.',
      analysis: {
        factCheck: {
          heroCards: ['As', 'Kd'],
          heroHandCode: 'AKo',
          heroPosition: 'BTN',
          preflopLastAggressorPosition: 'UNKNOWN',
          heroWasPreflopAggressor: false,
          heroCanCbetFlop: false,
          heroPostflopPosition: 'unknown',
        },
        overallVerdict: 'incorrect',
        overallReason: 'Preflop call is fine, but flop fold may be too tight.',
        streetVerdicts: [
          {
            street: 'preflop',
            heroAction: 'Called open',
            verdict: 'correct',
            reason: 'Defend is acceptable.',
            gtoPreferredAction: 'Mostly call with this combo.',
          },
          {
            street: 'flop',
            heroAction: 'Folded',
            verdict: 'mixed',
            reason: 'Fold can be fine but may overfold versus small sizing when ranges are wide.',
            gtoPreferredAction: 'Continue more often when price and equity are favorable.',
          },
        ],
        keyAdjustments: ['Use clearer flop continue criteria.', 'Protect the defend range with stronger continues.'],
        confidence: 'medium',
      },
      ...overrides.assistant,
    },
  });
}

function makeFollowupModelOutput() {
  return JSON.stringify({
    assistant: {
      content: 'Check-raising turn can be good if villain over-c-bets and folds too much to aggression.',
      followupHighlights: ['Prefer it with equity + blockers.', 'Avoid it with pure air against sticky opponents.'],
    },
  });
}

function makePayload(history = []) {
  return {
    handId: 'hand-123',
    hand: {
      id: 'hand-123',
      schemaVersion: 2,
      source: { mode: 'manual' },
      hero: { cards: ['As', 'Kd'], position: 'BTN' },
      table: {
        numPlayers: 6,
        stakes: { sb: 0.5, bb: 1 },
      },
      board: { didReachFlop: true, cards: ['2c', '7d', 'Jh'] },
      heroStreetSummary: {
        preflop: { action: 'call', amountBb: 1, amountChips: 1 },
        flop: { action: 'fold', amountBb: null, amountChips: null },
        turn: null,
        river: null,
      },
      result: { netBb: -1, netChips: -1, tag: 'loss', magnitude: 'tiny' },
      timeline: { actions: [] },
      notes: 'Example note',
      manualActionText: 'Called preflop and folded flop.',
    },
    message: 'What should I do differently?',
    history,
  };
}

test('coachHand returns structured analysis response and truncates history window', async () => {
  const calls = [];
  const provider = {
    name: 'openrouter',
    async generate(input) {
      calls.push(input);
      return {
        provider: 'openrouter',
        model: 'provider/model:free',
        fallbackUsed: false,
        content: makeInitialModelOutput(),
      };
    },
  };

  const history = Array.from({ length: HISTORY_WINDOW_SIZE + 3 }, (_, index) => ({
    role: 'user',
    content: `message-${index}`,
  }));
  const response = await coachHand(makePayload(history), {
    provider,
    timeoutMs: 1000,
  });

  assert.equal(response.assistant.analysis.overallReason.length > 0, true);
  assert.equal(response.meta.historyWindowUsed, HISTORY_WINDOW_SIZE);
  assert.equal(response.meta.truncatedHistory, true);
  assert.equal(response.meta.model, 'provider/model:free');
  assert.equal(response.meta.responseMode, 'analysis');
  assert.equal(Array.isArray(response.meta.failedModelAttempts), true);
  assert.equal(response.meta.attemptSummary, 'none');
  assert.equal(response.warnings.length, 1);
  assert.match(response.warnings[0], /truncated/i);

  assert.equal(calls.length, 1);
  const sentMessages = calls[0].messages;
  const historyMessages = sentMessages.filter((item) => item.role === 'assistant' || item.role === 'user').slice(1, -1);
  assert.equal(historyMessages.length, HISTORY_WINDOW_SIZE);
});

test('coachHand derives overallVerdict from street verdicts and does not hard-fail on mismatch', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      return {
        provider: 'openrouter',
        model: 'provider/model:free',
        fallbackUsed: false,
        content: makeInitialModelOutput({
          assistant: {
            analysis: {
              factCheck: {
                heroCards: ['As', 'Kd'],
                heroHandCode: 'AKo',
                heroPosition: 'BTN',
                preflopLastAggressorPosition: 'UNKNOWN',
                heroWasPreflopAggressor: false,
                heroCanCbetFlop: false,
                heroPostflopPosition: 'unknown',
              },
              overallVerdict: 'mixed',
              overallReason: 'Model said mixed.',
              streetVerdicts: [
                {
                  street: 'preflop',
                  heroAction: 'Called open',
                  verdict: 'correct',
                  reason: 'Fine.',
                  gtoPreferredAction: 'Mostly call.',
                },
                {
                  street: 'flop',
                  heroAction: 'Folded',
                  verdict: 'correct',
                  reason: 'Fine versus this line.',
                  gtoPreferredAction: 'Fold often.',
                },
              ],
              keyAdjustments: ['Keep disciplined folds.', 'Review continue thresholds.'],
              confidence: 'low',
            },
          },
        }),
      };
    },
  };

  const response = await coachHand(makePayload([]), { provider });
  assert.equal(response.meta.responseMode, 'analysis');
  assert.equal(response.assistant.analysis.overallVerdict, 'correct');
});

test('coachHand followup mode accepts lightweight payload without analysis', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      return {
        provider: 'openrouter',
        model: 'provider/model:free',
        fallbackUsed: false,
        content: makeFollowupModelOutput(),
      };
    },
  };

  const history = [
    { role: 'user', content: 'Did I play this correctly?' },
    { role: 'assistant', content: 'Initial answer' },
  ];
  const response = await coachHand(makePayload(history), { provider });

  assert.equal(response.meta.responseMode, 'followup');
  assert.equal(typeof response.assistant.analysis, 'undefined');
  assert.equal(response.assistant.followupHighlights.length, 2);
});

test('coachHand performs one repair retry when model output is invalid', async () => {
  let callCount = 0;
  const provider = {
    name: 'openrouter',
    async generate() {
      callCount += 1;
      if (callCount === 1) {
        throw createCoachError('Invalid output', {
          statusCode: 502,
          code: 'COACH_PROVIDER_OUTPUT_INVALID',
          details: {
            attempts: [
              {
                model: 'provider/model-a:free',
                reason: 'invalid_output',
                contentSnippet: '{"assistant":"bad"}',
              },
            ],
          },
        });
      }
      return {
        provider: 'openrouter',
        model: 'provider/model-b:free',
        fallbackUsed: true,
        attempts: [{ model: 'provider/model-a:free', reason: 'provider_retryable_status', status: 429 }],
        content: makeInitialModelOutput(),
      };
    },
  };

  const response = await coachHand(makePayload([]), { provider });

  assert.equal(callCount, 2);
  assert.equal(response.meta.fallbackUsed, true);
  assert.ok(response.warnings.some((warning) => /repair retry/i.test(warning)));
  assert.equal(response.meta.failedModelAttempts.length >= 1, true);
});

test('coachHand returns structured 502 when repair retry also fails with attempt diagnostics', async () => {
  let callCount = 0;
  const provider = {
    name: 'openrouter',
    async generate() {
      callCount += 1;
      throw createCoachError('Still invalid output', {
        statusCode: 502,
        code: 'COACH_PROVIDER_OUTPUT_INVALID',
        details: {
          attempts: [{ model: 'provider/model-a:free', reason: 'invalid_output' }],
        },
      });
    },
  };

  await assert.rejects(
    () => coachHand(makePayload([]), { provider }),
    (error) =>
      error?.code === 'COACH_REPAIR_FAILED' &&
      Number(error?.statusCode) === 502 &&
      typeof error?.details?.attemptSummary === 'string' &&
      Array.isArray(error?.details?.failedModelAttempts)
  );
  assert.equal(callCount, 2);
});

test('coachHand rejects model output that omits acted streets from street verdicts in analysis mode', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      return {
        provider: 'openrouter',
        model: 'provider/model:free',
        fallbackUsed: false,
        content: JSON.stringify({
          assistant: {
            content: 'Summary',
            analysis: {
              factCheck: {
                heroCards: ['As', 'Kd'],
                heroHandCode: 'AKo',
                heroPosition: 'BTN',
                preflopLastAggressorPosition: 'UNKNOWN',
                heroWasPreflopAggressor: false,
                heroCanCbetFlop: false,
                heroPostflopPosition: 'unknown',
              },
              overallVerdict: 'mixed',
              overallReason: 'Missing acted-street verdict.',
              streetVerdicts: [
                {
                  street: 'preflop',
                  heroAction: 'Called open',
                  verdict: 'correct',
                  reason: 'Fine defend.',
                  gtoPreferredAction: 'Mostly call.',
                },
              ],
              keyAdjustments: ['Add flop verdict coverage.'],
              confidence: 'low',
            },
          },
        }),
      };
    },
  };

  await assert.rejects(
    () => coachHand(makePayload([]), { provider }),
    (error) => error?.code === 'COACH_MODEL_SCHEMA_INVALID' && Number(error?.statusCode) === 502
  );
});

test('coachHand exposes provider attempt diagnostics for exhausted-provider errors', async () => {
  const provider = {
    name: 'openrouter',
    async generate() {
      throw createCoachError('OpenRouter free models were exhausted.', {
        statusCode: 502,
        code: 'COACH_PROVIDER_EXHAUSTED',
        details: {
          attempts: [
            { model: 'provider/model-a:free', reason: 'provider_retryable_status', status: 429 },
            { model: 'provider/model-b:free', reason: 'provider_status', status: 404 },
          ],
        },
      });
    },
  };

  await assert.rejects(
    () => coachHand(makePayload([]), { provider }),
    (error) =>
      error?.code === 'COACH_PROVIDER_EXHAUSTED' &&
      Array.isArray(error?.details?.failedModelAttempts) &&
      typeof error?.details?.attemptSummary === 'string'
  );
});
