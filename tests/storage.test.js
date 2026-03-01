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

test('moveHandToTrash hides hand from active list and keeps it in trash', async () => {
  globalThis.localStorage = createLocalStorageMock();
  const now = Date.now();
  localStorage.setItem(
    'pokerHands',
    JSON.stringify([
      { id: 'a1', schemaVersion: 2, createdAt: now - 1000 },
      { id: 'a2', schemaVersion: 2, createdAt: now - 500 },
    ])
  );
  const storage = await import(`../src/lib/storage.js?case=trashMove-${Date.now()}-${Math.random()}`);

  const moved = storage.moveHandToTrash('a2', now);
  assert.equal(moved, true);

  const active = storage.getHands();
  const trash = storage.getTrashedHands();
  assert.deepEqual(active.map((h) => h.id), ['a1']);
  assert.deepEqual(trash.map((h) => h.id), ['a2']);
  assert.equal(Number(trash[0].deletedAt), now);
});

test('saveHands preserves existing trash entries', async () => {
  globalThis.localStorage = createLocalStorageMock();
  const now = Date.now();
  localStorage.setItem(
    'pokerHands',
    JSON.stringify([
      { id: 'active-1', schemaVersion: 2, createdAt: now - 5000 },
      { id: 'trash-1', schemaVersion: 2, deletedAt: now - 1000 },
    ])
  );
  const storage = await import(`../src/lib/storage.js?case=preserveTrash-${Date.now()}-${Math.random()}`);

  storage.saveHands([{ id: 'active-2', schemaVersion: 2 }]);
  const raw = JSON.parse(localStorage.getItem('pokerHands'));
  const ids = raw.map((h) => h.id).sort();
  assert.deepEqual(ids, ['active-2', 'trash-1']);
});

test('expired trash is purged after retention window', async () => {
  globalThis.localStorage = createLocalStorageMock();
  const now = Date.now();
  const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
  localStorage.setItem(
    'pokerHands',
    JSON.stringify([
      { id: 'active-1', schemaVersion: 2, createdAt: now - 1000 },
      { id: 'trash-expired', schemaVersion: 2, deletedAt: thirtyOneDaysAgo },
    ])
  );
  const storage = await import(`../src/lib/storage.js?case=purge-${Date.now()}-${Math.random()}`);

  const active = storage.getHands();
  const trash = storage.getTrashedHands();
  assert.deepEqual(active.map((h) => h.id), ['active-1']);
  assert.equal(trash.length, 0);

  const persisted = JSON.parse(localStorage.getItem('pokerHands'));
  assert.deepEqual(persisted.map((h) => h.id), ['active-1']);
});
