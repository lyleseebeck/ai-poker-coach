import test from 'node:test';
import assert from 'node:assert/strict';
import { extractErrorMessage, normalizeCoachResponse } from '../src/lib/coachClient.js';

function makeValidAnalysisResponse() {
  return {
    assistant: {
      content: 'Summary',
      analysis: {
        factCheck: {
          heroCards: ['As', 'Kd'],
          heroHandCode: 'AKo',
          heroPosition: 'BTN',
          preflopLastAggressorPosition: 'CO',
          heroWasPreflopAggressor: false,
          heroCanCbetFlop: false,
          heroPostflopPosition: 'unknown',
        },
        overallVerdict: 'mixed',
        overallReason: 'Mixed line overall.',
        streetVerdicts: [
          {
            street: 'preflop',
            heroAction: 'Called open',
            verdict: 'correct',
            reason: 'Defend is fine.',
            gtoPreferredAction: 'Mostly call.',
          },
        ],
        keyAdjustments: ['Review defend range.', 'Avoid thin turn bluffs.'],
        confidence: 'medium',
      },
    },
    meta: {
      provider: 'openrouter',
      model: 'provider/model:free',
      fallbackUsed: false,
      historyWindowUsed: 8,
      truncatedHistory: false,
      failedModelAttempts: [],
      attemptSummary: 'none',
      responseMode: 'analysis',
    },
    warnings: [],
  };
}

test('normalizeCoachResponse accepts analysis-mode response', () => {
  const normalized = normalizeCoachResponse(makeValidAnalysisResponse());
  assert.equal(normalized.meta.responseMode, 'analysis');
  assert.equal(normalized.assistant.analysis.overallVerdict, 'mixed');
  assert.equal(normalized.assistant.analysis.streetVerdicts.length, 1);
  assert.equal(normalized.assistant.analysis.keyAdjustments.length, 2);
});

test('normalizeCoachResponse accepts followup-mode response without analysis', () => {
  const normalized = normalizeCoachResponse({
    assistant: {
      content: 'You can check-raise turn selectively.',
      followupHighlights: ['Use strong draws.', 'Avoid against calling stations.'],
    },
    meta: {
      provider: 'openrouter',
      model: 'provider/model:free',
      fallbackUsed: true,
      historyWindowUsed: 8,
      truncatedHistory: false,
      failedModelAttempts: [{ model: 'provider/model-a:free', reason: 'provider_retryable_status', status: 429 }],
      attemptSummary: 'provider_retryable_status:429x1',
      responseMode: 'followup',
    },
    warnings: [],
  });

  assert.equal(normalized.meta.responseMode, 'followup');
  assert.equal(typeof normalized.assistant.analysis, 'undefined');
  assert.equal(normalized.assistant.followupHighlights.length, 2);
});

test('normalizeCoachResponse rejects malformed analysis payload', () => {
  const invalid = makeValidAnalysisResponse();
  invalid.assistant.analysis.keyAdjustments = 'not-array';
  assert.throws(
    () => normalizeCoachResponse(invalid),
    /assistant\.analysis\.keyAdjustments must be an array/i
  );
});

test('extractErrorMessage includes validation and failed-model diagnostics', () => {
  const payload = JSON.stringify({
    error: {
      code: 'COACH_FACT_CHECK_FAILED',
      message: 'Internal',
      details: {
        validationFailures: ['heroPosition mismatch'],
        attemptSummary: 'invalid_outputx2',
        failedModelAttempts: [{ model: 'provider/model-a:free', reason: 'provider_retryable_status', status: 429 }],
      },
    },
  });

  const message = extractErrorMessage(502, 'Bad Gateway', payload);
  assert.match(message, /failed fact-check/i);
  assert.match(message, /heroPosition mismatch/i);
  assert.match(message, /Attempt summary:/i);
  assert.match(message, /Failed models:/i);
});
