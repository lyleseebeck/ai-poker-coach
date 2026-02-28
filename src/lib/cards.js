const VALID_RANKS = new Set(['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']);
const VALID_SUITS = new Set(['c', 'd', 'h', 's']);

export function normalizeCard(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';

  const suit = raw.slice(-1).toLowerCase();
  let rank = raw.slice(0, -1).toUpperCase();
  if (rank === '10') rank = 'T';

  if (!VALID_RANKS.has(rank) || !VALID_SUITS.has(suit)) return '';
  return rank + suit;
}

export function findDuplicateCard(cards) {
  const seen = new Set();
  for (const card of cards) {
    const normalized = normalizeCard(card);
    if (!normalized) continue;
    if (seen.has(normalized)) return normalized;
    seen.add(normalized);
  }
  return null;
}
