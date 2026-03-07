import test from 'node:test';
import assert from 'node:assert/strict';
import { coachHand } from '../server/coach/coachService.js';
import { HISTORY_WINDOW_SIZE } from '../server/coach/coachSchema.js';
import { createCoachError } from '../server/coach/errors.js';

function makeValidModelOutput(summary = 'Default summary') {
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
        overallVerdict: 'mixed',
        overallReason: summary,
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
        biggestLeaks: ['Leak example'],
        gtoCorrections: ['Correction example'],
        topAlternatives: ['Alternative line 1', 'Alternative line 2'],
        exploitativeAdjustments: ['Exploit adjustment'],
        confidence: 'medium',
      },
    },
  });
}

function makePayload(historyLength = 0) {
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
    history: Array.from({ length: historyLength }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}`,
    })),
  };
}

test('coachHand returns structured response and truncates history window', async () => {
  const calls = [];
  const provider = {
    name: 'openrouter',
    async generate(input) {
      calls.push(input);
      return {
        provider: 'openrouter',
        model: 'provider/model:free',
        fallbackUsed: false,
        content: makeValidModelOutput('Truncation test summary'),
      };
    },
  };

  const response = await coachHand(makePayload(HISTORY_WINDOW_SIZE + 3), {
    provider,
    timeoutMs: 1000,
  });

  assert.equal(response.assistant.analysis.overallReason, 'Truncation test summary');
  assert.equal(response.meta.historyWindowUsed, HISTORY_WINDOW_SIZE);
  assert.equal(response.meta.truncatedHistory, true);
  assert.equal(response.meta.model, 'provider/model:free');
  assert.equal(response.warnings.length, 1);
  assert.match(response.warnings[0], /truncated/i);

  assert.equal(calls.length, 1);
  const sentMessages = calls[0].messages;
  const historyMessages = sentMessages.filter((item) => item.role === 'assistant' || item.role === 'user').slice(1, -1);
  assert.equal(historyMessages.length, HISTORY_WINDOW_SIZE);
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
                reason: 'invalid_output',
                contentSnippet: '{"assistant": "bad"}',
              },
            ],
          },
        });
      }
      return {
        provider: 'openrouter',
        model: 'provider/model:free',
        fallbackUsed: true,
        content: makeValidModelOutput('Repair path summary'),
      };
    },
  };

  const response = await coachHand(makePayload(2), { provider });

  assert.equal(callCount, 2);
  assert.equal(response.assistant.analysis.overallReason, 'Repair path summary');
  assert.equal(response.meta.fallbackUsed, true);
  assert.ok(response.warnings.some((warning) => /repair retry/i.test(warning)));
});

test('coachHand returns structured 502 when repair retry also fails', async () => {
  let callCount = 0;
  const provider = {
    name: 'openrouter',
    async generate() {
      callCount += 1;
      throw createCoachError('Still invalid output', {
        statusCode: 502,
        code: 'COACH_PROVIDER_OUTPUT_INVALID',
        details: { attempts: [{ reason: 'invalid_output' }] },
      });
    },
  };

  await assert.rejects(
    () => coachHand(makePayload(1), { provider }),
    (error) =>
      error?.code === 'COACH_REPAIR_FAILED' &&
      Number(error?.statusCode) === 502 &&
      typeof error?.details?.attemptSummary === 'string'
  );
  assert.equal(callCount, 2);
});

test('coachHand rejects model output that omits acted streets from street verdicts', async () => {
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
              biggestLeaks: ['Leak example'],
              gtoCorrections: ['Correction example'],
              topAlternatives: ['Alt 1', 'Alt 2'],
              exploitativeAdjustments: ['Exploit adjustment'],
              confidence: 'low',
            },
          },
        }),
      };
    },
  };

  await assert.rejects(
    () => coachHand(makePayload(0), { provider }),
    (error) => error?.code === 'COACH_MODEL_SCHEMA_INVALID' && Number(error?.statusCode) === 502
  );
});

test('coachHand rejects fact check mismatches with targeted error details', async () => {
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
                heroPosition: 'CO',
                preflopLastAggressorPosition: 'UNKNOWN',
                heroWasPreflopAggressor: false,
                heroCanCbetFlop: false,
                heroPostflopPosition: 'unknown',
              },
              overallVerdict: 'mixed',
              overallReason: 'Reason.',
              streetVerdicts: [
                {
                  street: 'preflop',
                  heroAction: 'Called open',
                  verdict: 'correct',
                  reason: 'Fine defend.',
                  gtoPreferredAction: 'Mostly call.',
                },
                {
                  street: 'flop',
                  heroAction: 'Folded',
                  verdict: 'mixed',
                  reason: 'Spot dependent.',
                  gtoPreferredAction: 'Continue selectively.',
                },
              ],
              biggestLeaks: ['Leak example'],
              gtoCorrections: ['Correction example'],
              topAlternatives: ['Alt 1', 'Alt 2'],
              exploitativeAdjustments: ['Exploit adjustment'],
              confidence: 'low',
            },
          },
        }),
      };
    },
  };

  await assert.rejects(
    () => coachHand(makePayload(0), { provider }),
    (error) =>
      error?.code === 'COACH_FACT_CHECK_FAILED' &&
      Number(error?.statusCode) === 502 &&
      Array.isArray(error?.details?.validationFailures) &&
      error.details.validationFailures.length > 0
  );
});
