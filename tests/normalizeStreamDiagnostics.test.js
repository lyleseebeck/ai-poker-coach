import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNormalizeDiagnosticsState,
  formatDurationMs,
  reduceNormalizeDiagnostics,
} from '../src/lib/normalizeStreamDiagnostics.js';

test('reduceNormalizeDiagnostics tracks running, provisional, and final states', () => {
  let state = createNormalizeDiagnosticsState();

  state = reduceNormalizeDiagnostics(state, { type: 'deterministic_started' }, { nowMs: 10 });
  state = reduceNormalizeDiagnostics(state, { type: 'deterministic_completed', durationMs: 7 }, { nowMs: 17 });
  state = reduceNormalizeDiagnostics(
    state,
    { type: 'attempt_started', model: 'provider/model-a:free', attemptIndex: 1, totalModels: 2 },
    { nowMs: 20 }
  );
  state = reduceNormalizeDiagnostics(
    state,
    {
      type: 'provisional_result',
      model: 'provider/model-a:free',
      provisional: true,
      response: {
        parsedFields: {},
        confidenceByField: {},
        evidenceSnippets: {},
        missingRequired: [],
        needsUserInput: [],
        overallConfidence: 0.8,
        model: 'provider/model-a:free',
        meta: { provider: 'openrouter', model: 'provider/model-a:free', fallbackUsed: false },
      },
    },
    { nowMs: 25 }
  );
  state = reduceNormalizeDiagnostics(
    state,
    {
      type: 'final_result',
      response: {
        parsedFields: {},
        confidenceByField: {},
        evidenceSnippets: {},
        missingRequired: [],
        needsUserInput: [],
        overallConfidence: 0.9,
        model: 'provider/model-b:free',
        meta: {
          provider: 'openrouter',
          model: 'provider/model-b:free',
          fallbackUsed: true,
          attempts: [
            { model: 'provider/model-a:free', state: 'completed', durationMs: 12, attemptIndex: 1 },
            { model: 'provider/model-b:free', state: 'completed', durationMs: 20, attemptIndex: 2 },
          ],
          timings: { deterministicMs: 7, providerMs: 32, totalMs: 40 },
        },
      },
    },
    { nowMs: 40 }
  );

  assert.equal(state.phase, 'complete');
  assert.equal(state.provisionalModel, 'provider/model-a:free');
  assert.equal(state.finalResponse.meta.model, 'provider/model-b:free');
  assert.equal(state.attempts.length, 2);
  assert.equal(state.providerMs, 32);
});

test('formatDurationMs formats milliseconds and seconds', () => {
  assert.equal(formatDurationMs(125), '125ms');
  assert.equal(formatDurationMs(1200), '1.2s');
});
