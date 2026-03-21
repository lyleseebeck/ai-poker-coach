function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const CARD_RANK_ORDER = '23456789TJQKA';
const MADE_HAND_CATEGORIES = [
  'high_card',
  'pair',
  'two_pair',
  'trips',
  'straight',
  'flush',
  'full_house',
  'quads',
  'straight_flush',
];
const PAIRING_DETAILS = [
  'none',
  'overpair',
  'top_pair',
  'middle_pair',
  'bottom_pair',
  'underpair',
  'top_set',
  'middle_set',
  'bottom_set',
  'trips',
  'two_pair',
  'full_house',
  'quads',
];

function normalizeCardText(card) {
  const text = String(card || '').trim();
  if (text.length < 2) return null;
  const rank = text[0].toUpperCase();
  const suit = text[1].toLowerCase();
  if (!CARD_RANK_ORDER.includes(rank)) return null;
  if (!['s', 'h', 'd', 'c'].includes(suit)) return null;
  return `${rank}${suit}`;
}

function rankValue(rank) {
  const index = CARD_RANK_ORDER.indexOf(rank);
  return index >= 0 ? index : -1;
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function parseCard(card) {
  const normalized = normalizeCardText(card);
  if (!normalized) return null;
  return {
    text: normalized,
    rank: normalized[0],
    suit: normalized[1],
    rankValue: rankValue(normalized[0]) + 2,
  };
}

function findStraightHigh(cards) {
  const uniqueRanks = [...new Set(cards.map((card) => card.rankValue))].sort((a, b) => b - a);
  if (uniqueRanks.includes(14)) {
    uniqueRanks.push(1);
  }

  let run = 1;
  let bestHigh = null;
  for (let index = 1; index < uniqueRanks.length; index += 1) {
    if (uniqueRanks[index - 1] - 1 === uniqueRanks[index]) {
      run += 1;
      if (run >= 5) {
        bestHigh = uniqueRanks[index - 4];
        break;
      }
    } else if (uniqueRanks[index - 1] !== uniqueRanks[index]) {
      run = 1;
    }
  }

  return bestHigh;
}

function deriveMadeHandCategory(heroCards, boardCards) {
  const combined = [...heroCards, ...boardCards];
  if (combined.length === 0) return 'high_card';

  const bySuit = countBy(combined, (card) => card.suit);
  const flushSuit = [...bySuit.entries()].find(([, count]) => count >= 5)?.[0] || null;
  if (flushSuit) {
    const flushCards = combined.filter((card) => card.suit === flushSuit);
    if (findStraightHigh(flushCards)) {
      return 'straight_flush';
    }
  }

  const rankCounts = [...countBy(combined, (card) => card.rankValue).values()].sort((a, b) => b - a);
  if (rankCounts[0] >= 4) return 'quads';
  if (rankCounts[0] >= 3 && rankCounts[1] >= 2) return 'full_house';
  if (flushSuit) return 'flush';
  if (findStraightHigh(combined)) return 'straight';
  if (rankCounts[0] >= 3) return 'trips';
  if (rankCounts[0] >= 2 && rankCounts[1] >= 2) return 'two_pair';
  if (rankCounts[0] >= 2) return 'pair';
  return 'high_card';
}

function classifyRankPosition(rank, boardRanksDesc) {
  if (boardRanksDesc.length === 0) return 'bottom';
  const highest = boardRanksDesc[0];
  if (rank === highest) return 'top';
  if (boardRanksDesc.length === 1) return 'bottom';
  const second = boardRanksDesc[1];
  if (rank === second) return 'middle';
  return 'bottom';
}

function derivePairingDetail(heroCards, boardCards, madeHandCategory) {
  if (boardCards.length === 0 || heroCards.length !== 2) {
    return 'none';
  }

  const heroRanks = heroCards.map((card) => card.rankValue);
  const boardRanks = boardCards.map((card) => card.rankValue);
  const combinedRanks = [...heroRanks, ...boardRanks];
  const boardDistinctDesc = [...new Set(boardRanks)].sort((a, b) => b - a);
  const combinedCounts = countBy(combinedRanks, (rank) => rank);
  const boardCounts = countBy(boardRanks, (rank) => rank);
  const heroCounts = countBy(heroRanks, (rank) => rank);
  const heroDistinct = [...new Set(heroRanks)];
  const heroBoardMatches = heroDistinct.filter((rank) => boardCounts.get(rank) > 0);
  const hasPocketPair = heroDistinct.length === 1;
  const pocketPairRank = hasPocketPair ? heroDistinct[0] : null;

  if (madeHandCategory === 'quads') return 'quads';
  if (madeHandCategory === 'full_house') return 'full_house';

  if (hasPocketPair && pocketPairRank != null && combinedCounts.get(pocketPairRank) === 3) {
    const position = classifyRankPosition(pocketPairRank, boardDistinctDesc);
    if (position === 'top') return 'top_set';
    if (position === 'middle') return 'middle_set';
    return 'bottom_set';
  }

  if (madeHandCategory === 'trips') {
    const heroTripRank = heroDistinct.find((rank) => combinedCounts.get(rank) === 3);
    if (heroTripRank != null) return 'trips';
  }

  if (madeHandCategory === 'two_pair') {
    return 'two_pair';
  }

  if (madeHandCategory !== 'pair') {
    return 'none';
  }

  if (hasPocketPair && pocketPairRank != null) {
    const highestBoardRank = boardDistinctDesc[0];
    if (pocketPairRank > highestBoardRank) return 'overpair';
    return 'underpair';
  }

  if (heroBoardMatches.length > 0) {
    const matchedRank = heroBoardMatches.sort((a, b) => b - a)[0];
    const position = classifyRankPosition(matchedRank, boardDistinctDesc);
    if (position === 'top') return 'top_pair';
    if (position === 'middle') return 'middle_pair';
    return 'bottom_pair';
  }

  return 'none';
}

function deriveHeroHandFacts(cards, boardCards) {
  const heroCards = cards.map(parseCard).filter(Boolean).slice(0, 2);
  const parsedBoard = boardCards.map(parseCard).filter(Boolean);
  const heroMadeHandCategory = deriveMadeHandCategory(heroCards, parsedBoard);
  const heroPairingDetail = derivePairingDetail(heroCards, parsedBoard, heroMadeHandCategory);

  return {
    heroMadeHandCategory,
    heroPairingDetail,
  };
}

function normalizePosition(value) {
  const text = String(value || '').trim();
  return text ? text.toUpperCase() : null;
}

function normalizeAction(action) {
  const text = String(action || '').trim().toLowerCase();
  return text || 'none';
}

function isAggressiveAction(action) {
  const text = normalizeAction(action);
  return text === 'raise' || text === 'bet' || text === 'all_in' || text.includes('raise') || text.includes('bet');
}

function cleanText(value, maxLen = 2000) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

function summarizeDecision(decision) {
  if (!decision || typeof decision !== 'object') return null;
  if (!decision.action || decision.action === 'none') return null;
  return {
    action: String(decision.action),
    amountBb: numberOrNull(decision.amountBb),
    amountChips: numberOrNull(decision.amountChips),
  };
}

function summarizeTimelineActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return {
      actions: [],
      truncated: false,
    };
  }

  const limit = 30;
  const clipped = actions.slice(0, limit).map((row) => ({
    seq: Number.isFinite(Number(row?.seq)) ? Number(row.seq) : null,
    street: String(row?.street || 'unknown'),
    position: String(row?.position || ''),
    actionRaw: String(row?.actionRaw || ''),
    actionNorm: normalizeAction(row?.actionNorm),
    action: String(row?.actionRaw || row?.actionNorm || ''),
    amountChips: numberOrNull(row?.amountChips),
    isHero: Boolean(row?.isHero),
  }));

  return {
    actions: clipped,
    truncated: actions.length > limit,
  };
}

function buildHeroCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card) => normalizeCardText(card)).filter(Boolean).slice(0, 2);
}

export function buildCanonicalHandCode(cards) {
  const heroCards = buildHeroCards(cards);
  if (heroCards.length !== 2) return null;

  const cardA = { rank: heroCards[0][0], suit: heroCards[0][1] };
  const cardB = { rank: heroCards[1][0], suit: heroCards[1][1] };

  if (cardA.rank === cardB.rank) {
    return `${cardA.rank}${cardB.rank}`;
  }

  const first = rankValue(cardA.rank) >= rankValue(cardB.rank) ? cardA : cardB;
  const second = first === cardA ? cardB : cardA;
  const suitedness = cardA.suit === cardB.suit ? 's' : 'o';
  return `${first.rank}${second.rank}${suitedness}`;
}

function derivePreflopAggressor(timelineActions, heroPosition, heroPreflopAction) {
  let lastAggressorPosition = null;
  let lastAggressorIsHero = null;

  for (const action of timelineActions) {
    if (action?.street !== 'preflop') continue;
    if (!isAggressiveAction(action?.actionNorm || action?.actionRaw || action?.action)) continue;
    lastAggressorPosition = normalizePosition(action?.position);
    lastAggressorIsHero = Boolean(action?.isHero);
  }

  if (!lastAggressorPosition && isAggressiveAction(heroPreflopAction)) {
    lastAggressorPosition = heroPosition;
    lastAggressorIsHero = true;
  }

  return {
    preflopLastAggressorPosition: lastAggressorPosition,
    heroWasPreflopAggressor: lastAggressorIsHero === true,
  };
}

function deriveHeroPostflopPosition(timelineActions, didReachFlop) {
  if (!didReachFlop) return 'unknown';
  const flopActions = timelineActions.filter((action) => action?.street === 'flop');
  if (flopActions.length === 0) return 'unknown';

  const firstHeroAction = flopActions.find((action) => action?.isHero);
  const firstVillainAction = flopActions.find((action) => !action?.isHero);
  if (!firstHeroAction || !firstVillainAction) return 'unknown';

  const heroSeq = Number.isFinite(Number(firstHeroAction.seq)) ? Number(firstHeroAction.seq) : null;
  const villainSeq = Number.isFinite(Number(firstVillainAction.seq)) ? Number(firstVillainAction.seq) : null;
  if (heroSeq == null || villainSeq == null) return 'unknown';
  if (heroSeq < villainSeq) return 'out_of_position';
  if (heroSeq > villainSeq) return 'in_position';
  return 'unknown';
}

export function buildHandContext(hand) {
  const timeline = summarizeTimelineActions(hand?.timeline?.actions);
  const heroCards = buildHeroCards(hand?.hero?.cards);
  const heroPosition = normalizePosition(hand?.hero?.position);
  const heroHandCode = buildCanonicalHandCode(heroCards);
  const boardCards = Array.isArray(hand?.board?.cards) ? hand.board.cards.filter(Boolean) : [];
  const heroPreflopDecision = summarizeDecision(hand?.heroStreetSummary?.preflop);
  const aggressorFacts = derivePreflopAggressor(timeline.actions, heroPosition, heroPreflopDecision?.action);
  const heroPostflopPosition = deriveHeroPostflopPosition(timeline.actions, Boolean(hand?.board?.didReachFlop));
  const heroHandFacts = deriveHeroHandFacts(heroCards, boardCards);

  return {
    handId: hand?.id || null,
    source: {
      mode: hand?.source?.mode || null,
      parserName: hand?.source?.parserName || null,
    },
    hero: {
      cards: heroCards,
      position: heroPosition,
      handCode: heroHandCode,
    },
    table: {
      numPlayers: numberOrNull(hand?.table?.numPlayers),
      stakes: {
        sb: numberOrNull(hand?.table?.stakes?.sb),
        bb: numberOrNull(hand?.table?.stakes?.bb),
        currency: hand?.table?.stakes?.currency || null,
      },
      stackDepthBb: {
        hero: numberOrNull(hand?.table?.stackDepthBb?.hero),
        villain: numberOrNull(hand?.table?.stackDepthBb?.villain),
      },
      gameType: hand?.table?.gameType || null,
      playMode: hand?.table?.playMode || null,
      tableName: hand?.table?.tableName || null,
    },
    board: {
      didReachFlop: Boolean(hand?.board?.didReachFlop),
      cards: boardCards,
    },
    heroStreetSummary: {
      preflop: heroPreflopDecision,
      flop: summarizeDecision(hand?.heroStreetSummary?.flop),
      turn: summarizeDecision(hand?.heroStreetSummary?.turn),
      river: summarizeDecision(hand?.heroStreetSummary?.river),
    },
    heroHandFacts,
    result: {
      netBb: numberOrNull(hand?.result?.netBb),
      netChips: numberOrNull(hand?.result?.netChips),
      tag: hand?.result?.tag || null,
      magnitude: hand?.result?.magnitude || null,
    },
    timeline,
    factCheckGroundTruth: {
      heroCards,
      heroHandCode: heroHandCode || 'UNKNOWN',
      heroPosition: heroPosition || 'UNKNOWN',
      preflopLastAggressorPosition: aggressorFacts.preflopLastAggressorPosition || 'UNKNOWN',
      heroWasPreflopAggressor: aggressorFacts.heroWasPreflopAggressor,
      heroCanCbetFlop: Boolean(hand?.board?.didReachFlop) && aggressorFacts.heroWasPreflopAggressor,
      heroPostflopPosition,
      heroMadeHandCategory: heroHandFacts.heroMadeHandCategory,
      heroPairingDetail: heroHandFacts.heroPairingDetail,
    },
    notes: cleanText(hand?.notes, 1000),
    manualActionText: cleanText(hand?.manualActionText, 1600),
  };
}

export { MADE_HAND_CATEGORIES, PAIRING_DETAILS };
