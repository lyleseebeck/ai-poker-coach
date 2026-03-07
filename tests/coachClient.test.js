import test from 'node:test';
import assert from 'node:assert/strict';
import { extractErrorMessage, normalizeCoachResponse } from '../src/lib/coachClient.js';

function makeValidResponse() {
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
        biggestLeaks: ['Leak one'],
        gtoCorrections: ['Correction one'],
        topAlternatives: ['Alternative one', 'Alternative two'],
        exploitativeAdjustments: ['Exploit one'],
        confidence: 'medium',
      },
    },
    meta: {
      provider: 'openrouter',
      model: 'provider/model:free',
      fallbackUsed: false,
      historyWindowUsed: 8,
      truncatedHistory: false,
    },
    warnings: [],
  };
}

test('normalizeCoachResponse accepts verdict-first response', () => {
  const normalized = normalizeCoachResponse(makeValidResponse());
  assert.equal(normalized.assistant.analysis.overallVerdict, 'mixed');
  assert.equal(normalized.assistant.analysis.streetVerdicts.length, 1);
  assert.equal(normalized.assistant.analysis.topAlternatives.length, 2);
});

test('normalizeCoachResponse rejects malformed analysis', () => {
  const invalid = makeValidResponse();
  invalid.assistant.analysis.topAlternatives = ['only one'];
  assert.throws(
    () => normalizeCoachResponse(invalid),
    /topAlternatives must contain exactly 2 items/i
  );
});

test('extractErrorMessage includes clear fact-check details', () => {
  const payload = JSON.stringify({
    error: {
      code: 'COACH_FACT_CHECK_FAILED',
      message: 'Internal',
      details: {
        validationFailures: ['heroPosition mismatch'],
        attemptSummary: 'invalid_outputx2',
      },
    },
  });

  const message = extractErrorMessage(502, 'Bad Gateway', payload);
  assert.match(message, /failed fact-check/i);
  assert.match(message, /heroPosition mismatch/i);
  assert.match(message, /Attempt summary:/i);
});
