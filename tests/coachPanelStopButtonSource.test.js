import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const COACH_PANEL_PATH = new URL('../src/components/CoachPanel.jsx', import.meta.url);

test('CoachPanel keeps a stop button inside the diagnostics header while coaching is running', async () => {
  const source = await readFile(COACH_PANEL_PATH, 'utf8');

  assert.match(source, /Coach request diagnostics/);
  assert.match(source, /onClick=\{handleStopCoach\}/);
  assert.match(source, /border-emerald-300 bg-white px-3 py-1\.5 text-xs/);
});
