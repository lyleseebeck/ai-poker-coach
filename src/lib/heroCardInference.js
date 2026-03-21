import { normalizeCard } from './cards.js';

const RANK_ORDER = '23456789TJQKA';
const SUIT_ORDER = ['s', 'h', 'd', 'c'];
const HERO_ANCHOR_PATTERN =
  /\b(?:i had|i have|i held|i was dealt|hero had|hero was dealt|holding|held|my hand was|looked down at|look down at|woke up with|picked up|pick up)\b/i;
const HERO_WITH_PATTERN = /\b(?:i|me|my|hero)\b[\s\S]{0,20}\bwith\b/i;
const CLAUSE_SPLIT_PATTERN = /\r?\n|[.;]+/;
const RANK_WORDS = {
  ace: 'A',
  aces: 'A',
  king: 'K',
  kings: 'K',
  queen: 'Q',
  queens: 'Q',
  jack: 'J',
  jacks: 'J',
  ten: 'T',
  tens: 'T',
  nine: '9',
  nines: '9',
  eight: '8',
  eights: '8',
  seven: '7',
  sevens: '7',
  six: '6',
  sixes: '6',
  five: '5',
  fives: '5',
  four: '4',
  fours: '4',
  three: '3',
  threes: '3',
  two: '2',
  twos: '2',
};
const RANK_WORD_PATTERN =
  'ace|aces|king|kings|queen|queens|jack|jacks|ten|tens|nine|nines|eight|eights|seven|sevens|six|sixes|five|fives|four|fours|three|threes|two|twos';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeHandCodeText(value) {
  if (value == null || value === '') return null;
  const text = String(value)
    .trim()
    .toUpperCase()
    .replace(/10/g, 'T')
    .replace(/\s+/g, '');
  const match = text.match(/^([2-9TJQKA])([2-9TJQKA])([SO])?$/);
  if (!match) return null;

  const rankA = match[1];
  const rankB = match[2];
  const suitedness = (match[3] || '').toLowerCase();
  if (rankA === rankB) {
    return `${rankA}${rankB}`;
  }

  const first = RANK_ORDER.indexOf(rankA) >= RANK_ORDER.indexOf(rankB) ? rankA : rankB;
  const second = first === rankA ? rankB : rankA;
  return `${first}${second}${suitedness}`;
}

export function deriveHandCodeFromCards(cards) {
  if (!Array.isArray(cards) || cards.length !== 2) return null;
  const first = normalizeCard(cards[0]);
  const second = normalizeCard(cards[1]);
  if (!first || !second || first === second) return null;

  const rankA = first[0].toUpperCase();
  const rankB = second[0].toUpperCase();
  if (rankA === rankB) {
    return `${rankA}${rankB}`;
  }

  const highRank = RANK_ORDER.indexOf(rankA) >= RANK_ORDER.indexOf(rankB) ? rankA : rankB;
  const lowRank = highRank === rankA ? rankB : rankA;
  return `${highRank}${lowRank}${first[1] === second[1] ? 's' : 'o'}`;
}

function splitClauses(text) {
  return String(text || '')
    .split(CLAUSE_SPLIT_PATTERN)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function buildBlockedSet(blockedCards) {
  return new Set(
    (Array.isArray(blockedCards) ? blockedCards : [])
      .map((card) => normalizeCard(card))
      .filter(Boolean)
  );
}

function sanitizeHeroCards(cards, blockedSet) {
  if (!Array.isArray(cards) || cards.length !== 2) return [];
  const normalized = cards.map((card) => normalizeCard(card)).filter(Boolean);
  if (normalized.length !== 2 || normalized[0] === normalized[1]) return [];
  if (blockedSet.has(normalized[0]) || blockedSet.has(normalized[1])) return [];
  return normalized;
}

function pickPairCards(rank, blockedSet) {
  for (let left = 0; left < SUIT_ORDER.length; left += 1) {
    for (let right = left + 1; right < SUIT_ORDER.length; right += 1) {
      const first = normalizeCard(`${rank}${SUIT_ORDER[left]}`);
      const second = normalizeCard(`${rank}${SUIT_ORDER[right]}`);
      if (!first || !second) continue;
      if (blockedSet.has(first) || blockedSet.has(second)) continue;
      return [first, second];
    }
  }
  return [];
}

function pickSuitedCards(rankA, rankB, blockedSet) {
  for (const suit of SUIT_ORDER) {
    const first = normalizeCard(`${rankA}${suit}`);
    const second = normalizeCard(`${rankB}${suit}`);
    if (!first || !second) continue;
    if (blockedSet.has(first) || blockedSet.has(second)) continue;
    return [first, second];
  }
  return [];
}

function pickOffsuitCards(rankA, rankB, blockedSet) {
  for (const leftSuit of SUIT_ORDER) {
    for (const rightSuit of SUIT_ORDER) {
      if (leftSuit === rightSuit) continue;
      const first = normalizeCard(`${rankA}${leftSuit}`);
      const second = normalizeCard(`${rankB}${rightSuit}`);
      if (!first || !second) continue;
      if (blockedSet.has(first) || blockedSet.has(second)) continue;
      return [first, second];
    }
  }
  return [];
}

function canonicalCardsFromHandCode(handCode, blockedSet) {
  const normalizedCode = normalizeHandCodeText(handCode);
  if (!normalizedCode) return [];

  const match = normalizedCode.match(/^([2-9TJQKA])([2-9TJQKA])([so])?$/i);
  if (!match) return [];

  const rankA = match[1].toUpperCase();
  const rankB = match[2].toUpperCase();
  const suitedness = (match[3] || '').toLowerCase();

  if (rankA === rankB) return pickPairCards(rankA, blockedSet);
  if (suitedness === 's') return pickSuitedCards(rankA, rankB, blockedSet);
  if (suitedness === 'o') return pickOffsuitCards(rankA, rankB, blockedSet);

  const offsuit = pickOffsuitCards(rankA, rankB, blockedSet);
  return offsuit.length > 0 ? offsuit : pickSuitedCards(rankA, rankB, blockedSet);
}

function isHeroAnchoredClause(clause) {
  return HERO_ANCHOR_PATTERN.test(clause) || HERO_WITH_PATTERN.test(clause);
}

function parseExplicitCardsFromClause(clause, blockedSet) {
  const explicitPatterns = [
    /\b([2-9TJQKA](?:10)?[shdc])\s*[,/ -]+\s*([2-9TJQKA](?:10)?[shdc])\b/i,
    /\b([2-9TJQKA](?:10)?[shdc])([2-9TJQKA](?:10)?[shdc])\b/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = clause.match(pattern);
    if (!match) continue;
    const cards = sanitizeHeroCards([match[1], match[2]], blockedSet);
    if (cards.length === 2) {
      return {
        cards,
        handCode: deriveHandCodeFromCards(cards),
        confidence: 0.98,
        evidence: normalizeWhitespace(match[0]),
        source: 'explicit_cards',
      };
    }
  }

  return null;
}

function detectNaturalHandCodeFromClause(clause) {
  const pairMatch = clause.match(new RegExp(`\\b(?:pocket|pair of)\\s+(${RANK_WORD_PATTERN})\\b`, 'i'));
  if (pairMatch?.[1]) {
    const rank = RANK_WORDS[String(pairMatch[1]).toLowerCase()] || null;
    if (rank) {
      return {
        handCode: `${rank}${rank}`,
        confidence: 0.9,
        evidence: normalizeWhitespace(pairMatch[0]),
        source: 'natural_pair',
      };
    }
  }

  const comboMatch = clause.match(
    new RegExp(
      `\\b(${RANK_WORD_PATTERN})\\s+(${RANK_WORD_PATTERN})(?:\\s+(suited|offsuit|off\\s*suit|off-suit|off\\s*suited|off-suited))?\\b`,
      'i'
    )
  );
  if (comboMatch?.[1] && comboMatch?.[2]) {
    const rankA = RANK_WORDS[String(comboMatch[1]).toLowerCase()] || null;
    const rankB = RANK_WORDS[String(comboMatch[2]).toLowerCase()] || null;
    if (rankA && rankB) {
      if (rankA === rankB) {
        return {
          handCode: `${rankA}${rankB}`,
          confidence: 0.88,
          evidence: normalizeWhitespace(comboMatch[0]),
          source: 'natural_pair',
        };
      }

      const suitednessRaw = String(comboMatch[3] || '').toLowerCase().replace(/\s+/g, '');
      const suitedness = suitednessRaw.startsWith('off') ? 'o' : suitednessRaw === 'suited' ? 's' : '';
      return {
        handCode: normalizeHandCodeText(`${rankA}${rankB}${suitedness}`),
        confidence: suitedness ? 0.88 : 0.82,
        evidence: normalizeWhitespace(comboMatch[0]),
        source: 'natural_combo',
      };
    }
  }

  return null;
}

function detectHandCodeFromClause(clause) {
  const explicitMatch = clause.match(/\b([2-9TJQKA]{2}(?:[SO])?)\b/i);
  if (explicitMatch?.[1]) {
    const handCode = normalizeHandCodeText(explicitMatch[1]);
    if (handCode) {
      return {
        handCode,
        confidence: 0.9,
        evidence: normalizeWhitespace(explicitMatch[0]),
        source: 'hand_code',
      };
    }
  }

  return detectNaturalHandCodeFromClause(clause);
}

export function inferHeroHandFromText(text, options = {}) {
  const normalizedText = normalizeWhitespace(text);
  if (!normalizedText) {
    return {
      cards: [],
      handCode: null,
      confidence: 0,
      evidence: null,
      source: null,
    };
  }

  const blockedSet = buildBlockedSet(options.blockedCards);
  const clauses = splitClauses(normalizedText);
  const candidateClauses = clauses.filter(isHeroAnchoredClause);

  for (const clause of candidateClauses) {
    const explicit = parseExplicitCardsFromClause(clause, blockedSet);
    if (explicit) return explicit;

    const handCodeMatch = detectHandCodeFromClause(clause);
    if (!handCodeMatch?.handCode) continue;

    const cards = canonicalCardsFromHandCode(handCodeMatch.handCode, blockedSet);
    if (cards.length === 2) {
      return {
        cards,
        handCode: handCodeMatch.handCode,
        confidence: handCodeMatch.confidence,
        evidence: handCodeMatch.evidence,
        source: handCodeMatch.source,
      };
    }

    return {
      cards: [],
      handCode: handCodeMatch.handCode,
      confidence: handCodeMatch.confidence,
      evidence: handCodeMatch.evidence,
      source: handCodeMatch.source,
    };
  }

  return {
    cards: [],
    handCode: null,
    confidence: 0,
    evidence: null,
    source: null,
  };
}
