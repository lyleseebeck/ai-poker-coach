import { ACTION_TYPES } from './handSchema.js';

const ACTION_DEFS = [
  { action: 'all_in', patterns: [/\ball[\s-]?in\b/i, /\bjam(?:med|ming)?\b/i, /\bshove(?:d|s)?\b/i] },
  { action: 'raise', patterns: [/\braise(?:d|s|ing)?\b/i, /\b3-?bet\b/i, /\b4-?bet\b/i, /\b5-?bet\b/i] },
  { action: 'bet', patterns: [/\bbet(?:s|ting)?\b/i, /\bc-?bet(?:s|ting)?\b/i] },
  { action: 'call', patterns: [/\bcall(?:ed|s|ing)?\b/i, /\bflat(?:ted|s|ting)?\b/i] },
  { action: 'check', patterns: [/\bcheck(?:ed|s|ing)?\b/i] },
  { action: 'fold', patterns: [/\bfold(?:ed|s|ing)?\b/i, /\bmuck(?:ed|s|ing)?\b/i] },
];

const STREET_PATTERNS = {
  preflop: [/\bpre[\s-]?flop\b/i, /\bpf\b/i, /\bpre\b/i],
  flop: [/\bflop\b/i],
  turn: [/\bturn\b/i],
  river: [/\briver\b/i],
};

const LOSS_HINT = /\blose|lost|down|punt(?:ed|ing)?|spew(?:ed|ing)?\b/i;
const WIN_HINT = /\bwin|won|up|profit|value\s*own\b/i;
const SPLIT_HINT = /\bsplit|chop|breakeven|broke even|tie|push(?:ed)?\b/i;

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toClampedConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Number(n.toFixed(3));
}

function splitClauses(rawText) {
  return String(rawText || '')
    .split(/\r?\n|[.;]+/)
    .map((x) => normalizeWhitespace(x))
    .filter(Boolean);
}

function normalizePosition(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function inferHeroPosition(rawText, providedPosition) {
  const fromProvided = normalizePosition(providedPosition);
  if (fromProvided) return fromProvided;

  const text = String(rawText || '').toLowerCase();
  if (/\bout of bb\b|\bin the bb\b|\bfrom bb\b|\bbig blind\b/.test(text)) return 'BB';
  if (/\bout of sb\b|\bin the sb\b|\bfrom sb\b|\bsmall blind\b/.test(text)) return 'SB';
  return '';
}

function findStreet(text) {
  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    for (const pattern of STREET_PATTERNS[street]) {
      if (pattern.test(text)) return street;
    }
  }
  return null;
}

function findLastAction(text) {
  let winner = null;

  for (const def of ACTION_DEFS) {
    for (const pattern of def.patterns) {
      const re = new RegExp(pattern.source, 'ig');
      let match = re.exec(text);
      while (match) {
        const candidate = {
          action: def.action,
          index: match.index,
          matchedText: match[0],
        };
        if (!winner || candidate.index >= winner.index) {
          winner = candidate;
        }
        match = re.exec(text);
      }
    }
  }

  return winner;
}

function parseBbAmount(text) {
  const matches = [...String(text || '').matchAll(/([+-]?\d+(?:\.\d+)?)\s*(?:bb|bbs|big blind|big blinds)\b/gi)];
  if (matches.length === 0) return { value: null, snippet: null };
  const m = matches[matches.length - 1];
  return {
    value: toNumber(m[1]),
    snippet: m[0],
  };
}

function parseChipAmount(text) {
  const dollarMatches = [...String(text || '').matchAll(/\$([+-]?\d+(?:,\d{3})*(?:\.\d+)?)/g)];
  if (dollarMatches.length > 0) {
    const m = dollarMatches[dollarMatches.length - 1];
    return {
      value: toNumber(m[1]),
      snippet: m[0],
    };
  }

  const chipMatches = [...String(text || '').matchAll(/([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:chips?|usd)\b/gi)];
  if (chipMatches.length > 0) {
    const m = chipMatches[chipMatches.length - 1];
    return {
      value: toNumber(m[1]),
      snippet: m[0],
    };
  }

  return { value: null, snippet: null };
}

function parseSignedFromContext(rawAmount, contextText) {
  if (rawAmount == null) return null;
  if (rawAmount < 0) return rawAmount;
  if (SPLIT_HINT.test(contextText)) return 0;
  if (LOSS_HINT.test(contextText)) return -Math.abs(rawAmount);
  if (WIN_HINT.test(contextText)) return Math.abs(rawAmount);
  return rawAmount;
}

function inferBlindLossNetBb({ currentNetBb, text, heroPosition, preflopAction }) {
  if (currentNetBb != null) return { value: currentNetBb, confidence: null, snippet: null };
  if (preflopAction !== 'fold') return { value: null, confidence: null, snippet: null };

  const lower = String(text || '').toLowerCase();
  const seemsLikeWalk = /\bwalk\b|\bchecked option\b|\bcheck(?:ed)? in bb\b|\beveryone folded to me\b/.test(lower);

  if (heroPosition === 'BB') {
    if (seemsLikeWalk) {
      return {
        value: 0,
        confidence: 0.6,
        snippet: 'BB preflop walk/check scenario',
      };
    }
    return {
      value: -1,
      confidence: 0.78,
      snippet: 'Preflop fold from BB (blind posted)',
    };
  }

  if (heroPosition === 'SB') {
    return {
      value: -0.5,
      confidence: 0.72,
      snippet: 'Preflop fold from SB (blind posted)',
    };
  }

  return { value: null, confidence: null, snippet: null };
}

function inferDidReachFlop(rawText) {
  const text = String(rawText || '').toLowerCase();
  if (!text) return { value: null, confidence: 0 };
  if (
    /didn'?t reach flop|no flop|ended preflop|preflop only|folded preflop|never saw flop/.test(text)
  ) {
    return { value: false, confidence: 0.95 };
  }
  if (/\bflop\b|\bturn\b|\briver\b/.test(text)) {
    return { value: true, confidence: 0.95 };
  }
  return { value: null, confidence: 0.2 };
}

function inferRequiredStreets(options, didReachFlop, rawText) {
  if (Array.isArray(options.requiredStreets) && options.requiredStreets.length > 0) {
    const sanitized = options.requiredStreets.filter((s) => ['preflop', 'flop', 'turn', 'river'].includes(s));
    if (!sanitized.includes('preflop')) sanitized.unshift('preflop');
    return sanitized;
  }

  if (typeof options.boardCardsCount === 'number') {
    const n = options.boardCardsCount;
    const streets = ['preflop'];
    if (n >= 3) streets.push('flop');
    if (n >= 4) streets.push('turn');
    if (n >= 5) streets.push('river');
    return streets;
  }

  if (didReachFlop === false) return ['preflop'];

  const text = String(rawText || '').toLowerCase();
  const streets = ['preflop'];
  if (didReachFlop === true || /\bflop\b/.test(text)) streets.push('flop');
  if (/\bturn\b/.test(text)) streets.push('turn');
  if (/\briver\b/.test(text)) streets.push('river');
  return streets;
}

function scoreActionConfidence(isStreetExplicit, hasAction, hasAmount) {
  if (!hasAction) return 0;
  if (isStreetExplicit && hasAmount) return 0.95;
  if (isStreetExplicit) return 0.9;
  if (hasAmount) return 0.7;
  return 0.62;
}

function defaultDecision() {
  return {
    action: 'none',
    amountBb: null,
    amountChips: null,
    source: 'manual',
  };
}

function ensureKnownAction(action) {
  return ACTION_TYPES.includes(action) ? action : 'none';
}

export function parseManualActionText(rawText, options = {}) {
  const text = normalizeWhitespace(rawText);
  const didReach = inferDidReachFlop(text);
  const requiredStreets = inferRequiredStreets(options, didReach.value, text);
  const heroPosition = inferHeroPosition(text, options.heroPosition);

  const actionsByStreet = {
    preflop: null,
    flop: null,
    turn: null,
    river: null,
  };
  const genericActionCandidates = [];

  const clauses = splitClauses(text);
  for (const clause of clauses) {
    const street = findStreet(clause);
    const lastAction = findLastAction(clause);
    if (!lastAction) continue;

    const bbAmount = parseBbAmount(clause);
    const chipAmount = parseChipAmount(clause);
    const amountBb = bbAmount.value;
    const amountChips = chipAmount.value;
    const hasAmount = amountBb != null || amountChips != null;

    const candidate = {
      action: ensureKnownAction(lastAction.action),
      amountBb,
      amountChips,
      source: 'manual',
      confidence: scoreActionConfidence(Boolean(street), true, hasAmount),
      evidence: clause,
    };

    if (street) {
      actionsByStreet[street] = candidate;
    } else {
      genericActionCandidates.push(candidate);
    }
  }

  if (!actionsByStreet.preflop && genericActionCandidates.length > 0) {
    const fallback = genericActionCandidates[0];
    actionsByStreet.preflop = {
      ...fallback,
      confidence: toClampedConfidence(fallback.confidence - 0.25),
    };
  }

  const netBbData = parseBbAmount(text);
  const hasExplicitNetBb = netBbData.value != null;
  let signedNetBb = parseSignedFromContext(netBbData.value, text);
  const netChipsData = parseChipAmount(text);
  const signedNetChips = parseSignedFromContext(netChipsData.value, text);

  const blindFallback = inferBlindLossNetBb({
    currentNetBb: signedNetBb,
    text,
    heroPosition,
    preflopAction: actionsByStreet.preflop?.action || 'none',
  });
  if (signedNetBb == null && blindFallback.value != null) {
    signedNetBb = blindFallback.value;
  }

  let netBbConfidence = 0;
  if (signedNetBb != null) {
    if (hasExplicitNetBb) {
      netBbConfidence = /net|result|pnl|won|lost|profit|down|up|bb/.test(text.toLowerCase()) ? 0.95 : 0.7;
    } else if (blindFallback.confidence != null) {
      netBbConfidence = blindFallback.confidence;
    } else {
      netBbConfidence = 0.65;
    }
  }

  const byField = {
    didReachFlop: toClampedConfidence(didReach.confidence),
    result_netBb: toClampedConfidence(netBbConfidence),
  };
  if (heroPosition) {
    byField.heroPosition = 0.9;
  }
  const evidenceSnippets = {};
  const missingRequired = [];

  const heroStreetSummary = {
    preflop: defaultDecision(),
    flop: defaultDecision(),
    turn: defaultDecision(),
    river: defaultDecision(),
  };

  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    const value = actionsByStreet[street];
    if (value) {
      heroStreetSummary[street] = {
        action: value.action,
        amountBb: value.amountBb,
        amountChips: value.amountChips,
        source: 'manual',
      };
      byField[`heroStreetSummary_${street}_action`] = toClampedConfidence(value.confidence);
      evidenceSnippets[`heroStreetSummary.${street}.action`] = value.evidence;
      if (value.amountBb != null) evidenceSnippets[`heroStreetSummary.${street}.amountBb`] = String(value.amountBb) + ' bb';
      if (value.amountChips != null) evidenceSnippets[`heroStreetSummary.${street}.amountChips`] = '$' + String(value.amountChips);
    } else {
      byField[`heroStreetSummary_${street}_action`] = 0;
    }
  }

  for (const street of requiredStreets) {
    const decision = heroStreetSummary[street];
    if (!decision || decision.action === 'none') {
      missingRequired.push(`heroStreetSummary.${street}.action`);
    }
  }

  if (signedNetBb == null) {
    missingRequired.push('result.netBb');
  } else {
    evidenceSnippets['result.netBb'] = netBbData.snippet || blindFallback.snippet || `${signedNetBb} bb`;
  }

  if (signedNetChips != null) {
    evidenceSnippets['result.netChips'] = netChipsData.snippet || String(signedNetChips);
  }

  const requiredConfidence = [];
  for (const street of requiredStreets) {
    requiredConfidence.push(byField[`heroStreetSummary_${street}_action`] || 0);
  }
  requiredConfidence.push(byField.result_netBb || 0);

  const overallConfidence = requiredConfidence.length
    ? toClampedConfidence(requiredConfidence.reduce((sum, v) => sum + v, 0) / requiredConfidence.length)
    : 0;

  return {
    parsedFields: {
      manualActionText: text || null,
      board: {
        didReachFlop: didReach.value,
      },
      heroStreetSummary,
      result: {
        netBb: signedNetBb,
        netChips: signedNetChips,
      },
    },
    confidence: {
      overall: overallConfidence,
      byField,
    },
    missingRequired,
    evidenceSnippets,
    metadata: {
      parser: 'deterministic-manual-v1',
      requiredStreets,
      heroPosition: heroPosition || null,
    },
  };
}
