import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const UNIFIED_HAND_FORM_PATH =
  '/Users/lyleseebeck/Documents/AI Poker Coach/src/components/UnifiedHandForm.jsx';

test('UnifiedHandForm save validation does not inject the aiReview parser prompt error', async () => {
  const source = await readFile(UNIFIED_HAND_FORM_PATH, 'utf8');

  assert.doesNotMatch(source, /\baiReview\s*:/);
  assert.doesNotMatch(source, /Parser data is incomplete/i);
});
