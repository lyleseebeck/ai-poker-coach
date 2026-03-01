import test from 'node:test';
import assert from 'node:assert/strict';

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

test('getHands ignores non-V2 records and warns once', async () => {
  globalThis.localStorage = createLocalStorageMock();
  localStorage.setItem(
    'pokerHands',
    JSON.stringify([
      { id: 'legacy-1', cards: ['As', 'Kd'] },
      { id: 'v2-1', schemaVersion: 2, hero: { cards: ['Ah', 'Kh'] } },
      { id: 'legacy-2', schemaVersion: 1 },
    ])
  );

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));

  try {
    const storage = await import(`../src/lib/storage.js?case=getHands-${Date.now()}-${Math.random()}`);
    const hands = storage.getHands();

    assert.equal(hands.length, 1);
    assert.equal(hands[0].id, 'v2-1');
    assert.equal(warnings.length, 1);

    storage.getHands();
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test('saveHands persists only schemaVersion=2 records', async () => {
  globalThis.localStorage = createLocalStorageMock();
  const storage = await import(`../src/lib/storage.js?case=saveHands-${Date.now()}-${Math.random()}`);

  storage.saveHands([
    { id: 'legacy', schemaVersion: 1 },
    { id: 'v2-ok', schemaVersion: 2 },
    { id: 'no-version' },
  ]);

  const raw = localStorage.getItem('pokerHands');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'v2-ok');
});
