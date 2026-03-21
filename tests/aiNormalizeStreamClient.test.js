import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNormalizeStreamEvent,
  streamNormalizeHandFromText,
} from '../src/lib/aiNormalizeStreamClient.js';

test('normalizeNormalizeStreamEvent normalizes final_result payloads', () => {
  const event = normalizeNormalizeStreamEvent({
    type: 'final_result',
    provisional: false,
    response: {
      parsedFields: {},
      confidenceByField: {},
      evidenceSnippets: {},
      missingRequired: [],
      needsUserInput: [],
      overallConfidence: 0.9,
      model: 'provider/model-a:free',
      meta: {
        provider: 'openrouter',
        model: 'provider/model-a:free',
        fallbackUsed: true,
        resultSource: 'model_merged',
        attemptSummary: 'timeoutx1, successx1',
        failedModelAttempts: [{ model: 'provider/model-b:free', reason: 'timeout', durationMs: 45000 }],
        attempts: [{ model: 'provider/model-a:free', state: 'completed', durationMs: 12 }],
        timings: { deterministicMs: 5, providerMs: 17, totalMs: 24 },
      },
    },
  });

  assert.equal(event.type, 'final_result');
  assert.equal(event.response.meta.resultSource, 'model_merged');
  assert.equal(event.response.meta.timings.totalMs, 24);
});

test('streamNormalizeHandFromText reads NDJSON events and returns final response', async () => {
  const lines = [
    JSON.stringify({ type: 'deterministic_started' }),
    JSON.stringify({ type: 'attempt_started', model: 'provider/model-a:free', attemptIndex: 1, totalModels: 1 }),
    JSON.stringify({
      type: 'final_result',
      response: {
        parsedFields: {},
        confidenceByField: {},
        evidenceSnippets: {},
        missingRequired: [],
        needsUserInput: [],
        overallConfidence: 0.8,
        model: 'provider/model-a:free',
        meta: {
          provider: 'openrouter',
          model: 'provider/model-a:free',
          fallbackUsed: false,
          resultSource: 'model_merged',
          attemptSummary: 'successx1',
          failedModelAttempts: [],
          attempts: [{ model: 'provider/model-a:free', state: 'completed', durationMs: 14 }],
          timings: { deterministicMs: 4, providerMs: 14, totalMs: 19 },
        },
      },
    }),
  ].join('\n');

  const seenTypes = [];
  const response = await streamNormalizeHandFromText(
    { manualActionText: 'hero bets' },
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

  assert.deepEqual(seenTypes, ['deterministic_started', 'attempt_started', 'final_result']);
  assert.equal(response.meta.model, 'provider/model-a:free');
  assert.equal(response.meta.timings.providerMs, 14);
});
