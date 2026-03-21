import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoachStreamEvent, streamCoachHand } from '../src/lib/coachStreamClient.js';

test('normalizeCoachStreamEvent normalizes final_result payloads', () => {
  const event = normalizeCoachStreamEvent({
    type: 'final_result',
    response: {
      assistant: {
        content: 'Coach answer',
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
          overallReason: 'x',
          streetVerdicts: [
            {
              street: 'preflop',
              heroAction: 'Call',
              verdict: 'mixed',
              reason: 'x',
              gtoPreferredAction: 'y',
            },
          ],
          keyAdjustments: ['z'],
          confidence: 'low',
        },
      },
      meta: {
        provider: 'openrouter',
        model: 'provider/model-a:free',
        fallbackUsed: false,
        historyWindowUsed: 8,
        truncatedHistory: false,
        failedModelAttempts: [],
        attempts: [{ model: 'provider/model-a:free', state: 'completed', durationMs: 15, pass: 'initial' }],
        modelSelection: {
          scope: 'coach',
          strategy: 'ranked',
          plannedOrder: ['provider/model-a:free'],
          stopReason: 'first_valid_candidate',
        },
        timings: { totalMs: 25, providerMs: 18 },
        attemptSummary: 'successx1',
        responseMode: 'analysis',
      },
      warnings: [],
    },
  });

  assert.equal(event.type, 'final_result');
  assert.equal(event.response.meta.modelSelection.strategy, 'ranked');
  assert.equal(event.response.meta.attempts[0].pass, 'initial');
});

test('streamCoachHand reads NDJSON events and returns final response', async () => {
  const lines = [
    JSON.stringify({
      type: 'selection_plan',
      scope: 'coach',
      strategy: 'ranked',
      plannedOrder: ['provider/model-a:free'],
      totalModels: 1,
      pass: 'initial',
    }),
    JSON.stringify({
      type: 'final_result',
      response: {
        assistant: {
          content: 'Coach answer',
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
            overallReason: 'x',
            streetVerdicts: [
              {
                street: 'preflop',
                heroAction: 'Call',
                verdict: 'mixed',
                reason: 'x',
                gtoPreferredAction: 'y',
              },
            ],
            keyAdjustments: ['z'],
            confidence: 'low',
          },
        },
        meta: {
          provider: 'openrouter',
          model: 'provider/model-a:free',
          fallbackUsed: false,
          historyWindowUsed: 8,
          truncatedHistory: false,
          failedModelAttempts: [],
          attempts: [{ model: 'provider/model-a:free', state: 'completed', durationMs: 15, pass: 'initial' }],
          modelSelection: {
            scope: 'coach',
            strategy: 'ranked',
            plannedOrder: ['provider/model-a:free'],
            stopReason: 'first_valid_candidate',
          },
          timings: { totalMs: 25, providerMs: 18 },
          attemptSummary: 'successx1',
          responseMode: 'analysis',
        },
        warnings: [],
      },
    }),
  ].join('\n');

  const seenTypes = [];
  const response = await streamCoachHand(
    { handId: 'h1', hand: { schemaVersion: 2 }, message: 'help' },
    {
      fetchImpl: async () =>
        new Response(`${lines}\n`, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        }),
      onEvent: async (event) => {
        seenTypes.push(event.type);
      },
    }
  );

  assert.deepEqual(seenTypes, ['selection_plan', 'final_result']);
  assert.equal(response.meta.model, 'provider/model-a:free');
  assert.equal(response.meta.timings.providerMs, 18);
});
