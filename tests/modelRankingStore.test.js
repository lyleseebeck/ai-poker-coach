import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRankingStore } from '../server/coach/providers/modelRankingStore.js';

test('model ranking store preserves configured order on cold start', async () => {
  const store = createModelRankingStore({
    env: {},
    nowMs: () => 1_710_000_000_000,
    randomFn: () => 0.99,
  });

  const plan = await store.getSelectionPlan({
    scope: 'normalize',
    models: ['cold/model-a:free', 'cold/model-b:free'],
  });

  assert.equal(plan.strategy, 'static');
  assert.deepEqual(plan.plannedOrder, ['cold/model-a:free', 'cold/model-b:free']);
});

test('model ranking store keeps normalize and coach stats separate', async () => {
  const store = createModelRankingStore({
    env: {},
    nowMs: () => 1_710_000_000_000,
    randomFn: () => 0.99,
  });

  await store.recordAttempt({
    scope: 'normalize',
    model: 'shared/model-a:free',
    attempt: { state: 'failed', reason: 'timeout' },
  });
  await store.recordAttempt({
    scope: 'normalize',
    model: 'shared/model-b:free',
    attempt: { state: 'completed', durationMs: 15 },
  });

  await store.recordAttempt({
    scope: 'coach',
    model: 'shared/model-a:free',
    attempt: { state: 'completed', durationMs: 20 },
  });
  await store.recordAttempt({
    scope: 'coach',
    model: 'shared/model-b:free',
    attempt: { state: 'failed', reason: 'invalid_output' },
  });

  const normalizePlan = await store.getSelectionPlan({
    scope: 'normalize',
    models: ['shared/model-a:free', 'shared/model-b:free'],
  });
  const coachPlan = await store.getSelectionPlan({
    scope: 'coach',
    models: ['shared/model-a:free', 'shared/model-b:free'],
  });

  assert.deepEqual(normalizePlan.plannedOrder, ['shared/model-b:free', 'shared/model-a:free']);
  assert.deepEqual(coachPlan.plannedOrder, ['shared/model-a:free', 'shared/model-b:free']);
});

test('model ranking store exploration can promote a challenger', async () => {
  const store = createModelRankingStore({
    env: {},
    nowMs: () => 1_710_000_000_000,
    randomFn: () => 0.05,
  });

  await store.recordAttempt({
    scope: 'normalize',
    model: 'explore/model-a:free',
    attempt: { state: 'completed', durationMs: 10 },
  });
  await store.recordAttempt({
    scope: 'normalize',
    model: 'explore/model-a:free',
    attempt: { state: 'completed', durationMs: 12 },
  });
  await store.recordAttempt({
    scope: 'normalize',
    model: 'explore/model-b:free',
    attempt: { state: 'failed', reason: 'timeout' },
  });

  const plan = await store.getSelectionPlan({
    scope: 'normalize',
    models: ['explore/model-a:free', 'explore/model-b:free'],
  });

  assert.equal(plan.strategy, 'exploration');
  assert.deepEqual(plan.plannedOrder, ['explore/model-b:free', 'explore/model-a:free']);
});
