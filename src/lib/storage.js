const STORAGE_KEY = 'pokerHands';
const HAND_SCHEMA_VERSION = 2;
let warnedLegacyHands = false;

function isV2Hand(hand) {
  return Boolean(hand && typeof hand === 'object' && hand.schemaVersion === HAND_SCHEMA_VERSION);
}

export function getHands() {
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

export function saveHands(hands) {
  const safeHands = Array.isArray(hands) ? hands.filter(isV2Hand) : [];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeHands));
}

export function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}
