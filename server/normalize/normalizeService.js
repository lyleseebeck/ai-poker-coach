import { parseManualActionText } from '../../src/lib/manualActionParser.js';
import { normalizeCard } from '../../src/lib/cards.js';
import { getLlmProvider } from '../coach/providers/index.js';
import {
  normalizeHandCodeText,
  parseNormalizeModelJson,
  validateNormalizeModelPayload,
  validateNormalizeRequest,
} from './normalizeSchema.js';
import { buildNormalizeMessages } from './normalizePrompt.js';

const DEFAULT_TIMEOUT_MS = 25000;
const RANK_ORDER = '23456789TJQKA';
const SUIT_ORDER = ['s', 'h', 'd', 'c'];

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(n), 1000), 120000);
}

function mergeObject(base, extra) {
  return {
    ...(base || {}),
    ...(extra || {}),
  };
}

function averageConfidence(values) {
  const list = Object.values(values || {}).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (list.length === 0) return 0;
  return list.reduce((sum, n) => sum + n, 0) / list.length;
}

function removeSatisfiedMissingFields(missingSet, parsedFields) {
  const checks = {
    'hero.position': Boolean(parsedFields?.hero?.position),
    'hero.cards': Array.isArray(parsedFields?.hero?.cards) && parsedFields.hero.cards.length === 2,
    'board.didReachFlop': typeof parsedFields?.board?.didReachFlop === 'boolean',
    'result.netBb': parsedFields?.result?.netBb != null,
    'result.netChips': parsedFields?.result?.netChips != null,
  };

  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    checks[`heroStreetSummary.${street}.action`] =
      Boolean(parsedFields?.heroStreetSummary?.[street]?.action) &&
      String(parsedFields.heroStreetSummary[street].action).toLowerCase() !== 'none';
  }

  for (const [field, satisfied] of Object.entries(checks)) {
    if (satisfied) {
      missingSet.delete(field);
    }
  }
}

function normalizeStreetSummary(streetSummary) {
  const out = {};
  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    const source = streetSummary?.[street] || {};
    out[street] = {
      action: source.action || 'none',
      amountBb: source.amountBb ?? null,
      facingAmountBb: source.facingAmountBb ?? null,
      streetNetBb: source.streetNetBb ?? null,
      amountChips: source.amountChips ?? null,
      source: source.source || 'manual',
    };
  }
  return out;
}

function buildDeterministicBaseline(request) {
  const context = request.context || {};
  const boardCards = Array.isArray(context.boardCards) ? context.boardCards.filter(Boolean) : [];
  const parsed = parseManualActionText(request.manualActionText, {
    heroPosition: context.heroPosition || '',
    boardCardsCount: boardCards.length,
  });

  const deterministic = request.deterministicParse || null;
  const parsedFields = mergeObject(parsed.parsedFields, deterministic?.parsedFields);
  parsedFields.hero = mergeObject(parsed.parsedFields?.hero, deterministic?.parsedFields?.hero);
  parsedFields.result = mergeObject(parsed.parsedFields?.result, deterministic?.parsedFields?.result);
  parsedFields.board = mergeObject(parsed.parsedFields?.board, deterministic?.parsedFields?.board);
  parsedFields.heroStreetSummary = normalizeStreetSummary(
    mergeObject(parsed.parsedFields?.heroStreetSummary, deterministic?.parsedFields?.heroStreetSummary)
  );

  const confidenceByField = mergeObject(
    parsed.confidence?.byField,
    deterministic?.confidence?.byField
  );
  const evidenceSnippets = mergeObject(
    parsed.evidenceSnippets,
    deterministic?.evidenceSnippets
  );
  const missingSet = new Set([
    ...(parsed.missingRequired || []),
    ...(deterministic?.missingRequired || []),
  ]);

  const bb = toNumberOrNull(context?.stakes?.bb);
  const netBb = toNumberOrNull(parsedFields?.result?.netBb);
  const netChips = toNumberOrNull(parsedFields?.result?.netChips);

  if (bb && netBb == null && netChips != null) {
    parsedFields.result.netBb = Number((netChips / bb).toFixed(4));
    confidenceByField.result_netBb = Math.max(confidenceByField.result_netBb || 0, 0.9);
    evidenceSnippets['result.netBb'] =
      evidenceSnippets['result.netBb'] || `Derived from net chips ${netChips} and BB ${bb}`;
    missingSet.delete('result.netBb');
  }

  if (bb && netChips == null && netBb != null) {
    parsedFields.result.netChips = Number((netBb * bb).toFixed(4));
    confidenceByField.result_netChips = Math.max(confidenceByField.result_netChips || 0, 0.9);
    evidenceSnippets['result.netChips'] =
      evidenceSnippets['result.netChips'] || `Derived from net BB ${netBb} and BB ${bb}`;
  }

  if (!parsedFields.hero?.position && context?.heroPosition) {
    parsedFields.hero.position = String(context.heroPosition).trim().toUpperCase();
    confidenceByField.heroPosition = Math.max(confidenceByField.heroPosition || 0, 0.92);
    evidenceSnippets['hero.position'] = evidenceSnippets['hero.position'] || 'Used selected hero position context';
    missingSet.delete('hero.position');
  }

  parsedFields.hero = mergeObject(parsedFields.hero, {});
  parsedFields.result = mergeObject(parsedFields.result, {});
  parsedFields.board = mergeObject(parsedFields.board, {});
  parsedFields.heroStreetSummary = normalizeStreetSummary(parsedFields.heroStreetSummary);

  removeSatisfiedMissingFields(missingSet, parsedFields);

  const missingRequired = Array.from(missingSet);
  const overallConfidence = Number(averageConfidence(confidenceByField).toFixed(3));

  return {
    parsedFields,
    confidenceByField,
    evidenceSnippets,
    missingRequired,
    needsUserInput: [...missingRequired],
    overallConfidence,
    model: 'deterministic-manual-v1',
  };
}

function normalizeRankOrder(rankA, rankB) {
  return RANK_ORDER.indexOf(rankA) >= RANK_ORDER.indexOf(rankB)
    ? [rankA, rankB]
    : [rankB, rankA];
}

function deriveHandCodeFromCards(cards) {
  if (!Array.isArray(cards) || cards.length !== 2) return null;
  const a = normalizeCard(cards[0]);
  const b = normalizeCard(cards[1]);
  if (!a || !b) return null;
  const rankA = a[0].toUpperCase();
  const rankB = b[0].toUpperCase();
  const suitA = a[1].toLowerCase();
  const suitB = b[1].toLowerCase();

  if (rankA === rankB) return `${rankA}${rankB}`;
  const [hi, lo] = normalizeRankOrder(rankA, rankB);
  return `${hi}${lo}${suitA === suitB ? 's' : 'o'}`;
}

function parseExplicitHeroCardsFromText(text) {
  const matches = [...String(text || '').matchAll(/\b([2-9TJQKA][shdc])\b/gi)];
  if (matches.length < 2) return [];

  const unique = [];
  for (const match of matches) {
    const card = normalizeCard(match[1]);
    if (!card) continue;
    if (!unique.includes(card)) unique.push(card);
    if (unique.length === 2) break;
  }

  return unique.length === 2 ? unique : [];
}

function detectHandCodeFromText(text) {
  const lower = String(text || '').toLowerCase();
  const prioritized = lower.match(/(?:\bi\s+had\b|\bi\s+have\b|\bholding\b|\bwith\b)\s+([2-9tjqka]{2}(?:s|o)?)/i);
  if (prioritized?.[1]) {
    return normalizeHandCodeText(prioritized[1]);
  }

  const generic = [...lower.matchAll(/\b([2-9tjqka]{2}(?:s|o)?)\b/g)];
  for (const item of generic) {
    const candidate = String(item?.[1] || '').toUpperCase();
    if (!candidate) continue;
    if (!/^[2-9TJQKA]{2}(?:[SO])?$/.test(candidate)) continue;
    const rankA = candidate[0];
    const rankB = candidate[1];
    if (!RANK_ORDER.includes(rankA) || !RANK_ORDER.includes(rankB)) continue;
    return normalizeHandCodeText(candidate);
  }

  return null;
}

function buildBlockedCardSet(context, parsedBoardCards = []) {
  const blocked = new Set();
  const boardCards = Array.isArray(context?.boardCards) ? context.boardCards : [];
  const heroCards = Array.isArray(context?.heroCards) ? context.heroCards : [];

  for (const card of [...boardCards, ...parsedBoardCards, ...heroCards]) {
    const normalized = normalizeCard(card);
    if (normalized) blocked.add(normalized);
  }

  return blocked;
}

function pickPairCards(rank, blocked) {
  for (let i = 0; i < SUIT_ORDER.length; i += 1) {
    for (let j = i + 1; j < SUIT_ORDER.length; j += 1) {
      const a = normalizeCard(`${rank}${SUIT_ORDER[i]}`);
      const b = normalizeCard(`${rank}${SUIT_ORDER[j]}`);
      if (!a || !b) continue;
      if (blocked.has(a) || blocked.has(b)) continue;
      return [a, b];
    }
  }
  return [];
}

function pickSuitedCards(rankA, rankB, blocked) {
  for (const suit of SUIT_ORDER) {
    const a = normalizeCard(`${rankA}${suit}`);
    const b = normalizeCard(`${rankB}${suit}`);
    if (!a || !b || a === b) continue;
    if (blocked.has(a) || blocked.has(b)) continue;
    return [a, b];
  }
  return [];
}

function pickOffsuitCards(rankA, rankB, blocked) {
  for (const suitA of SUIT_ORDER) {
    for (const suitB of SUIT_ORDER) {
      if (suitA === suitB) continue;
      const a = normalizeCard(`${rankA}${suitA}`);
      const b = normalizeCard(`${rankB}${suitB}`);
      if (!a || !b || a === b) continue;
      if (blocked.has(a) || blocked.has(b)) continue;
      return [a, b];
    }
  }
  return [];
}

function canonicalCardsFromHandCode(handCode, blockedCards) {
  const normalizedCode = normalizeHandCodeText(handCode);
  if (!normalizedCode) return [];

  const match = normalizedCode.match(/^([2-9TJQKA])([2-9TJQKA])([so])?$/i);
  if (!match) return [];

  const rankA = match[1].toUpperCase();
  const rankB = match[2].toUpperCase();
  const suitedness = (match[3] || '').toLowerCase();
  const blocked = new Set(blockedCards || []);

  if (rankA === rankB) return pickPairCards(rankA, blocked);
  if (suitedness === 's') return pickSuitedCards(rankA, rankB, blocked);
  if (suitedness === 'o') return pickOffsuitCards(rankA, rankB, blocked);

  return pickOffsuitCards(rankA, rankB, blocked).length > 0
    ? pickOffsuitCards(rankA, rankB, blocked)
    : pickSuitedCards(rankA, rankB, blocked);
}

function sanitizeHeroCards(cards, blocked) {
  if (!Array.isArray(cards) || cards.length !== 2) return [];
  const normalized = cards.map((card) => normalizeCard(card)).filter(Boolean);
  if (normalized.length !== 2 || normalized[0] === normalized[1]) return [];
  if (blocked.has(normalized[0]) || blocked.has(normalized[1])) return [];
  return normalized;
}

function ensureHeroCardInference(parsedFields, manualActionText, context, missingSet) {
  parsedFields.hero = mergeObject(parsedFields.hero, {});
  const blocked = buildBlockedCardSet(context, parsedFields?.board?.cards || []);

  let cards = sanitizeHeroCards(parsedFields.hero.cards, blocked);
  if (cards.length !== 2) {
    cards = sanitizeHeroCards(parseExplicitHeroCardsFromText(manualActionText), blocked);
  }

  let handCode = normalizeHandCodeText(parsedFields.hero.handCode);
  if (!handCode && cards.length === 2) {
    handCode = deriveHandCodeFromCards(cards);
  }
  if (!handCode) {
    handCode = detectHandCodeFromText(manualActionText);
  }

  if (cards.length !== 2 && handCode) {
    cards = canonicalCardsFromHandCode(handCode, blocked);
  }

  if (cards.length === 2) {
    parsedFields.hero.cards = cards;
    missingSet.delete('hero.cards');
  } else {
    delete parsedFields.hero.cards;
    missingSet.add('hero.cards');
  }

  if (handCode) {
    parsedFields.hero.handCode = handCode;
  }
}

function mergeParsedFields(baseParsedFields, modelParsedFields) {
  const merged = {
    ...baseParsedFields,
    hero: { ...(baseParsedFields?.hero || {}) },
    board: { ...(baseParsedFields?.board || {}) },
    result: { ...(baseParsedFields?.result || {}) },
    heroStreetSummary: normalizeStreetSummary(baseParsedFields?.heroStreetSummary),
  };

  if (modelParsedFields?.hero?.position) {
    merged.hero.position = String(modelParsedFields.hero.position).trim().toUpperCase();
  }

  if (Array.isArray(modelParsedFields?.hero?.cards) && modelParsedFields.hero.cards.length === 2) {
    merged.hero.cards = modelParsedFields.hero.cards.map((card) => normalizeCard(card));
  }

  if (modelParsedFields?.hero?.handCode) {
    merged.hero.handCode = normalizeHandCodeText(modelParsedFields.hero.handCode);
  }

  if (typeof modelParsedFields?.board?.didReachFlop === 'boolean') {
    merged.board.didReachFlop = modelParsedFields.board.didReachFlop;
  }
  if (Array.isArray(modelParsedFields?.board?.cards) && modelParsedFields.board.cards.length > 0) {
    merged.board.cards = modelParsedFields.board.cards.map((card) => normalizeCard(card)).filter(Boolean);
  }

  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    const suggestion = modelParsedFields?.heroStreetSummary?.[street];
    if (!suggestion) continue;

    const current = {
      ...(merged.heroStreetSummary?.[street] || {
        action: 'none',
        amountBb: null,
        facingAmountBb: null,
        streetNetBb: null,
        amountChips: null,
        source: 'manual',
      }),
    };

    if (suggestion.action != null) current.action = suggestion.action;
    if (suggestion.amountBb != null) current.amountBb = suggestion.amountBb;
    if (suggestion.facingAmountBb != null) current.facingAmountBb = suggestion.facingAmountBb;
    if (suggestion.streetNetBb != null) current.streetNetBb = suggestion.streetNetBb;
    if (suggestion.amountChips != null) current.amountChips = suggestion.amountChips;
    current.source = current.source || 'manual';

    merged.heroStreetSummary[street] = current;
  }

  if (modelParsedFields?.result?.netBb != null) {
    merged.result.netBb = modelParsedFields.result.netBb;
  }

  if (modelParsedFields?.result?.netChips != null) {
    merged.result.netChips = modelParsedFields.result.netChips;
  }

  return merged;
}

function applyDerivedResultFields(parsedFields, context, confidenceByField, evidenceSnippets, missingSet) {
  const bb = toNumberOrNull(context?.stakes?.bb);
  const netBb = toNumberOrNull(parsedFields?.result?.netBb);
  const netChips = toNumberOrNull(parsedFields?.result?.netChips);

  if (bb && netBb == null && netChips != null) {
    parsedFields.result.netBb = Number((netChips / bb).toFixed(4));
    confidenceByField.result_netBb = Math.max(confidenceByField.result_netBb || 0, 0.9);
    evidenceSnippets['result.netBb'] =
      evidenceSnippets['result.netBb'] || `Derived from net chips ${netChips} and BB ${bb}`;
  }

  if (bb && netChips == null && netBb != null) {
    parsedFields.result.netChips = Number((netBb * bb).toFixed(4));
    confidenceByField.result_netChips = Math.max(confidenceByField.result_netChips || 0, 0.9);
    evidenceSnippets['result.netChips'] =
      evidenceSnippets['result.netChips'] || `Derived from net BB ${netBb} and BB ${bb}`;
  }

  removeSatisfiedMissingFields(missingSet, parsedFields);
}

function mergeNormalizeResponses(base, modelPayload, request, generation, providerName) {
  const parsedFields = mergeParsedFields(base.parsedFields, modelPayload.parsedFields);
  const confidenceByField = { ...base.confidenceByField };
  for (const [key, value] of Object.entries(modelPayload.confidenceByField || {})) {
    const current = toNumberOrNull(confidenceByField[key]);
    const next = toNumberOrNull(value);
    if (next == null) continue;
    confidenceByField[key] = current == null ? next : Math.max(current, next);
  }

  const evidenceSnippets = {
    ...base.evidenceSnippets,
    ...(modelPayload.evidenceSnippets || {}),
  };
  const missingSet = new Set([
    ...(base.missingRequired || []),
    ...(modelPayload.missingRequired || []),
  ]);

  ensureHeroCardInference(parsedFields, request.manualActionText, request.context, missingSet);
  applyDerivedResultFields(parsedFields, request.context, confidenceByField, evidenceSnippets, missingSet);

  const missingRequired = Array.from(missingSet);
  const overallConfidence = Number(averageConfidence(confidenceByField).toFixed(3));

  return {
    parsedFields,
    confidenceByField,
    evidenceSnippets,
    missingRequired,
    needsUserInput: [...new Set([...(modelPayload.needsUserInput || []), ...missingRequired])],
    overallConfidence,
    model: generation?.model || base.model,
    meta: {
      provider: generation?.provider || providerName || 'openrouter',
      model: generation?.model || null,
      fallbackUsed: Boolean(generation?.fallbackUsed),
    },
  };
}

function finalizeBaselineResponse(base, request, providerName) {
  const parsedFields = {
    ...base.parsedFields,
    hero: { ...(base.parsedFields?.hero || {}) },
    result: { ...(base.parsedFields?.result || {}) },
    board: { ...(base.parsedFields?.board || {}) },
    heroStreetSummary: normalizeStreetSummary(base.parsedFields?.heroStreetSummary),
  };

  const confidenceByField = { ...(base.confidenceByField || {}) };
  const evidenceSnippets = { ...(base.evidenceSnippets || {}) };
  const missingSet = new Set(base.missingRequired || []);

  ensureHeroCardInference(parsedFields, request.manualActionText, request.context, missingSet);
  applyDerivedResultFields(parsedFields, request.context, confidenceByField, evidenceSnippets, missingSet);

  const missingRequired = Array.from(missingSet);

  return {
    parsedFields,
    confidenceByField,
    evidenceSnippets,
    missingRequired,
    needsUserInput: [...new Set([...(base.needsUserInput || []), ...missingRequired])],
    overallConfidence: Number(averageConfidence(confidenceByField).toFixed(3)),
    model: base.model,
    meta: {
      provider: providerName || 'openrouter',
      model: null,
      fallbackUsed: true,
    },
  };
}

export async function normalizeHandFromText(payload, options = {}) {
  const request = validateNormalizeRequest(payload);
  const baseline = buildDeterministicBaseline(request);

  const providerName = options.providerName || process.env.COACH_PROVIDER || 'openrouter';

  let provider;
  try {
    provider =
      options.provider ||
      getLlmProvider(providerName, options.providerOptions || {});
  } catch {
    return finalizeBaselineResponse(baseline, request, providerName);
  }

  const timeoutMs = parseTimeoutMs(options.timeoutMs ?? process.env.COACH_REQUEST_TIMEOUT_MS);
  const messages = buildNormalizeMessages({
    manualActionText: request.manualActionText,
    context: request.context,
    deterministicParse: baseline,
  });

  let generation;
  try {
    generation = await provider.generate({
      messages,
      timeoutMs,
      validateContent: (content) => {
        const parsed = parseNormalizeModelJson(content);
        validateNormalizeModelPayload(parsed);
      },
    });
  } catch {
    return finalizeBaselineResponse(baseline, request, provider?.name || providerName);
  }

  try {
    const modelJson = parseNormalizeModelJson(generation?.content || '');
    const modelPayload = validateNormalizeModelPayload(modelJson);
    return mergeNormalizeResponses(
      baseline,
      modelPayload,
      request,
      generation,
      provider?.name || providerName
    );
  } catch {
    return finalizeBaselineResponse(baseline, request, provider?.name || providerName);
  }
}
