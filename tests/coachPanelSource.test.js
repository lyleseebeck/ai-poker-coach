import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const COACH_PANEL_PATH = new URL('../src/components/CoachPanel.jsx', import.meta.url);

test('CoachPanel source removes the debug opt-in control and keeps the debug payload disclosure', async () => {
  const source = await readFile(COACH_PANEL_PATH, 'utf8');

  assert.doesNotMatch(source, /Include debug payload/i);
  assert.match(source, /Debug payload/i);
  assert.doesNotMatch(source, /\bincludeDebug\b/);
});
