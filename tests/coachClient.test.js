import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoachResponse } from '../src/lib/coachClient.js';

function makeValidResponse() {
  return {
    assistant: {
      content: 'Summary',
      analysis: {
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
