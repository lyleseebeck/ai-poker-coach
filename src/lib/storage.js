const STORAGE_KEY = 'pokerHands';
const HAND_SCHEMA_VERSION = 2;
export const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
let warnedLegacyHands = false;

function isV2Hand(hand) {
  return Boolean(hand && typeof hand === 'object' && hand.schemaVersion === HAND_SCHEMA_VERSION);
}

function isTrashed(hand) {
  const deletedAt = Number(hand?.deletedAt);
  return Number.isFinite(deletedAt) && deletedAt > 0;
}

function isExpiredTrash(hand, now) {
  if (!isTrashed(hand)) return false;
  return now - Number(hand.deletedAt) >= TRASH_RETENTION_MS;
}

function readStoredHands() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const v2Hands = parsed.filter(isV2Hand);
    const legacyCount = parsed.length - v2Hands.length;
    if (legacyCount > 0 && !warnedLegacyHands) {
      warnedLegacyHands = true;
      // Minimal migration mode: ignore legacy records rather than auto-convert.
      console.warn(`Ignoring ${legacyCount} legacy hand record(s) that are not schemaVersion=2.`);
    }
    return v2Hands;
  } catch {
    return [];
  }
}

function writeStoredHands(hands) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hands.filter(isV2Hand)));
}

function loadAndPurge(now = Date.now()) {
  const all = readStoredHands();
  const kept = all.filter((hand) => !isExpiredTrash(hand, now));
  if (kept.length !== all.length) {
    writeStoredHands(kept);
  }
  return kept;
}

function asActiveHand(hand) {
  if (!hand || typeof hand !== 'object') return hand;
  if (!isTrashed(hand)) return hand;
  const next = { ...hand };
  delete next.deletedAt;
  return next;
}

export function getHands() {
  return loadAndPurge().filter((hand) => !isTrashed(hand));
}

export function getTrashedHands() {
  return loadAndPurge().filter(isTrashed);
}

export function saveHands(hands) {
  const nextActive = Array.isArray(hands)
    ? hands.filter(isV2Hand).map(asActiveHand)
    : [];
  const trashed = loadAndPurge().filter(isTrashed);
  writeStoredHands([...nextActive, ...trashed]);
}

export function moveHandToTrash(id, now = Date.now()) {
  if (!id) return false;
  const all = loadAndPurge(now);
  let changed = false;
  const next = all.map((hand) => {
    if (hand.id !== id || isTrashed(hand)) return hand;
    changed = true;
    return { ...hand, deletedAt: now };
  });
  if (changed) writeStoredHands(next);
  return changed;
}

export function restoreHandFromTrash(id) {
  if (!id) return false;
  const all = loadAndPurge();
  let changed = false;
  const next = all.map((hand) => {
    if (hand.id !== id || !isTrashed(hand)) return hand;
    changed = true;
    return asActiveHand(hand);
  });
  if (changed) writeStoredHands(next);
  return changed;
}

export function permanentlyDeleteHand(id) {
  if (!id) return false;
  const all = loadAndPurge();
  const next = all.filter((hand) => hand.id !== id);
  if (next.length === all.length) return false;
  writeStoredHands(next);
  return true;
}

export function purgeExpiredTrash(now = Date.now()) {
  const all = readStoredHands();
  const next = all.filter((hand) => !isExpiredTrash(hand, now));
  if (next.length === all.length) return 0;
  writeStoredHands(next);
  return all.length - next.length;
}

export function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}
