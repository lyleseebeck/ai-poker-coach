function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
    street: String(row?.street || 'unknown'),
    position: String(row?.position || ''),
    action: String(row?.actionRaw || row?.actionNorm || ''),
    amountChips: numberOrNull(row?.amountChips),
    isHero: Boolean(row?.isHero),
  }));

  return {
    actions: clipped,
    truncated: actions.length > limit,
  };
}

export function buildHandContext(hand) {
  const timeline = summarizeTimelineActions(hand?.timeline?.actions);

  return {
    handId: hand?.id || null,
    source: {
      mode: hand?.source?.mode || null,
      parserName: hand?.source?.parserName || null,
    },
    hero: {
      cards: Array.isArray(hand?.hero?.cards) ? hand.hero.cards.filter(Boolean) : [],
      position: hand?.hero?.position || null,
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
      preflop: summarizeDecision(hand?.heroStreetSummary?.preflop),
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
    notes: cleanText(hand?.notes, 1000),
    manualActionText: cleanText(hand?.manualActionText, 1600),
  };
}
