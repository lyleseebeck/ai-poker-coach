const STORAGE_KEY = 'pokerHands';

export function getHands() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveHands(hands) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hands));
}

export function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}
