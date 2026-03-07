function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const CARD_RANK_ORDER = '23456789TJQKA';

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
  const heroPreflopDecision = summarizeDecision(hand?.heroStreetSummary?.preflop);
  const aggressorFacts = derivePreflopAggressor(timeline.actions, heroPosition, heroPreflopDecision?.action);
  const heroPostflopPosition = deriveHeroPostflopPosition(timeline.actions, Boolean(hand?.board?.didReachFlop));

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
      gameType: hand?.table?.gameType || null,
      playMode: hand?.table?.playMode || null,
      tableName: hand?.table?.tableName || null,
    },
    board: {
      didReachFlop: Boolean(hand?.board?.didReachFlop),
      cards: Array.isArray(hand?.board?.cards) ? hand.board.cards.filter(Boolean) : [],
    },
    heroStreetSummary: {
      preflop: heroPreflopDecision,
      flop: summarizeDecision(hand?.heroStreetSummary?.flop),
      turn: summarizeDecision(hand?.heroStreetSummary?.turn),
      river: summarizeDecision(hand?.heroStreetSummary?.river),
    },
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
    },
    notes: cleanText(hand?.notes, 1000),
    manualActionText: cleanText(hand?.manualActionText, 1600),
  };
}
