import { normalizeCard, findDuplicateCard } from './cards.js';

export const HAND_SCHEMA_VERSION = 2;

export const ACTION_TYPES = ['fold', 'check', 'call', 'bet', 'raise', 'all_in', 'none'];
export const STREETS = ['preflop', 'flop', 'turn', 'river', 'unknown'];

const RESULT_TAG_EPSILON = 0.01;

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValidAction(action) {
  return ACTION_TYPES.includes(action);
}

function defaultStreetDecision(source = 'manual') {
  return {
    action: 'none',
    amountBb: null,
    amountChips: null,
    source,
  };
}

function sanitizeStreetDecision(decision, defaultSource = 'manual') {
  const rawAction = String(decision?.action || 'none').toLowerCase();
  return {
    action: isValidAction(rawAction) ? rawAction : 'none',
    amountBb: toNumberOrNull(decision?.amountBb),
    amountChips: toNumberOrNull(decision?.amountChips),
    source: decision?.source || defaultSource,
  };
}

function reachedStreets(boardCards, didReachFlop) {
  const normalizedCount = Array.isArray(boardCards) ? boardCards.length : 0;
  const reached = ['preflop'];
  if (!didReachFlop) return reached;

  reached.push('flop');
  if (normalizedCount >= 4) reached.push('turn');
  if (normalizedCount >= 5) reached.push('river');
  return reached;
}

function normalizeBoardCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((c) => normalizeCard(c)).filter(Boolean);
}

function generateLocalId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

export function deriveResultTag(netBb) {
  const n = toNumberOrNull(netBb);
  if (n == null) return null;
  if (n > RESULT_TAG_EPSILON) return 'win';
  if (n < -RESULT_TAG_EPSILON) return 'loss';
  return 'breakeven';
}

export function deriveResultMagnitude(netBb) {
  const n = toNumberOrNull(netBb);
  if (n == null) return null;
  const abs = Math.abs(n);
  if (abs < 5) return 'tiny';
  if (abs < 20) return 'small';
  if (abs < 50) return 'medium';
  if (abs < 100) return 'large';
  return 'massive';
}

export function createEmptyHandDraft() {
  return {
    source: {
      mode: 'manual',
      parserName: null,
      parserVersion: null,
      importedAt: null,
      rawText: null,
    },
    hero: {
      cards: ['', ''],
      position: '',
    },
    table: {
      numPlayers: null,
      gameType: null,
      playMode: null,
      tableName: null,
      stakes: {
        sb: null,
        bb: null,
        currency: null,
      },
    },
    board: {
      cards: [],
      didReachFlop: true,
    },
    heroStreetSummary: {
      preflop: defaultStreetDecision('manual'),
      flop: defaultStreetDecision('manual'),
      turn: defaultStreetDecision('manual'),
      river: defaultStreetDecision('manual'),
    },
    result: {
      netBb: null,
      netChips: null,
      tag: null,
      magnitude: null,
    },
    timeline: null,
    opponents: {
      players: null,
      knownCardsText: null,
    },
    notes: null,
    manualActionText: null,
    provenance: {},
  };
}

export function validateHandDraft(draft, options = {}) {
  const requireBb = options.requireBb !== false;
  const errors = {};

  const heroCard1 = normalizeCard(draft?.hero?.cards?.[0]);
  const heroCard2 = normalizeCard(draft?.hero?.cards?.[1]);
  if (!heroCard1 || !heroCard2) {
    errors.heroCards = 'Two valid hero cards are required.';
  }

  const didReachFlop = Boolean(draft?.board?.didReachFlop);
  const boardCards = normalizeBoardCards(draft?.board?.cards || []);
  if (!didReachFlop && boardCards.length > 0) {
    errors.board = 'Board cards must be empty when the hand did not reach flop.';
  }
  if (didReachFlop && ![3, 4, 5].includes(boardCards.length)) {
    errors.board = 'Board cards must include exactly 3, 4, or 5 cards when flop was reached.';
  }

  const duplicateCard = findDuplicateCard([heroCard1, heroCard2, ...boardCards]);
  if (duplicateCard) {
    errors.duplicateCards = `Duplicate card detected (${duplicateCard}).`;
  }

  const heroPosition = String(draft?.hero?.position || '').trim();
  if (!heroPosition) {
    errors.heroPosition = 'Hero position is required.';
  }

  const numPlayers = Number(draft?.table?.numPlayers);
  if (!Number.isInteger(numPlayers) || numPlayers < 2) {
    errors.numPlayers = 'Players at table is required.';
  }

  if (requireBb) {
    const bb = toNumberOrNull(draft?.table?.stakes?.bb);
    if (bb == null || bb <= 0) {
      errors.bigBlind = 'Big blind size is required.';
    }
  }

  const netBb = toNumberOrNull(draft?.result?.netBb);
  if (netBb == null) {
    errors.netBb = 'Net result in BB is required.';
  }

  const streetsToValidate = reachedStreets(boardCards, didReachFlop);
  for (const street of streetsToValidate) {
    const decision = sanitizeStreetDecision(draft?.heroStreetSummary?.[street]);
    if (!decision || decision.action === 'none') {
      errors[`street_${street}`] = `Hero ${street} decision is required.`;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function buildHandRecordV2(draft, options = {}) {
  const validation = validateHandDraft(draft, options);
  if (!validation.isValid) {
    const err = new Error('Hand draft is invalid.');
    err.validation = validation;
    throw err;
  }

  const heroCards = [
    normalizeCard(draft.hero.cards[0]),
    normalizeCard(draft.hero.cards[1]),
  ];
  const boardCards = normalizeBoardCards(draft.board.cards);
  const didReachFlop = Boolean(draft.board.didReachFlop);

  const preflop = sanitizeStreetDecision(draft.heroStreetSummary?.preflop, 'manual');
  const flop = didReachFlop ? sanitizeStreetDecision(draft.heroStreetSummary?.flop, 'manual') : null;
  const turn = didReachFlop && boardCards.length >= 4
    ? sanitizeStreetDecision(draft.heroStreetSummary?.turn, 'manual')
    : null;
  const river = didReachFlop && boardCards.length >= 5
    ? sanitizeStreetDecision(draft.heroStreetSummary?.river, 'manual')
    : null;

  const netBb = Number(draft.result.netBb);
  const netChips = toNumberOrNull(draft.result.netChips);
  const resultTag = deriveResultTag(netBb);
  const resultMagnitude = deriveResultMagnitude(netBb);

  return {
    id: options.id || generateLocalId(),
    schemaVersion: HAND_SCHEMA_VERSION,
    createdAt: options.createdAt || Date.now(),
    source: {
      mode: draft.source?.mode || 'manual',
      parserName: draft.source?.parserName || null,
      parserVersion: draft.source?.parserVersion || null,
      importedAt: toNumberOrNull(draft.source?.importedAt),
      rawText: draft.source?.rawText || null,
    },
    hero: {
      cards: heroCards,
      position: String(draft.hero.position || '').trim(),
    },
    table: {
      numPlayers: Number(draft.table.numPlayers),
      gameType: draft.table?.gameType || null,
      playMode: draft.table?.playMode || null,
      tableName: draft.table?.tableName || null,
      stakes: {
        sb: toNumberOrNull(draft.table?.stakes?.sb),
        bb: toNumberOrNull(draft.table?.stakes?.bb),
        currency: draft.table?.stakes?.currency || null,
      },
    },
    board: {
      cards: didReachFlop ? boardCards : [],
      didReachFlop,
    },
    heroStreetSummary: {
      preflop,
      flop,
      turn,
      river,
    },
    result: {
      netBb,
      netChips,
      tag: resultTag,
      magnitude: resultMagnitude,
    },
    timeline: draft.timeline || null,
    opponents: {
      players: draft.opponents?.players || null,
      knownCardsText: draft.opponents?.knownCardsText || null,
    },
    notes: draft.notes || null,
    manualActionText: draft.manualActionText || null,
    provenance: draft.provenance || {},
  };
}
