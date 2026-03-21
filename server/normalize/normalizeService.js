import { parseManualActionText } from '../../src/lib/manualActionParser.js';
import { normalizeCard } from '../../src/lib/cards.js';
import { deriveHandCodeFromCards, inferHeroHandFromText } from '../../src/lib/heroCardInference.js';
import { getLlmProvider } from '../coach/providers/index.js';
import {
  normalizeHandCodeText,
  parseNormalizeModelJson,
  validateNormalizeModelPayload,
  validateNormalizeRequest,
} from './normalizeSchema.js';
import { buildNormalizeMessages } from './normalizePrompt.js';

const DEFAULT_TIMEOUT_MS = 25000;

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

function buildBlockedCardSet(context, parsedBoardCards = []) {
  const blocked = new Set();
  const boardCards = Array.isArray(context?.boardCards) ? context.boardCards : [];

  for (const card of [...boardCards, ...parsedBoardCards]) {
    const normalized = normalizeCard(card);
    if (normalized) blocked.add(normalized);
  }

  return blocked;
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
  const inferredHeroHand = cards.length === 2
    ? {
        cards,
        handCode: deriveHandCodeFromCards(cards),
      }
    : inferHeroHandFromText(manualActionText, {
        blockedCards: [...blocked],
      });

  let handCode = normalizeHandCodeText(parsedFields.hero.handCode);
  if (!handCode && cards.length === 2) {
    handCode = deriveHandCodeFromCards(cards);
  }
  if (!handCode && inferredHeroHand.handCode) {
    handCode = normalizeHandCodeText(inferredHeroHand.handCode);
  }

  if (cards.length !== 2 && Array.isArray(inferredHeroHand.cards) && inferredHeroHand.cards.length === 2) {
    cards = sanitizeHeroCards(inferredHeroHand.cards, blocked);
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

function summarizeNormalizeAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return 'none';

  const counts = new Map();
  for (const attempt of attempts) {
    const state = String(attempt?.state || 'unknown');
    const reason = String(attempt?.reason || (state === 'completed' ? 'success' : 'unknown'));
    const statusPart = Number.isFinite(Number(attempt?.status)) ? `:${Number(attempt.status)}` : '';
    const key = `${reason}${statusPart}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([key, count]) => `${key}x${count}`)
    .join(', ');
}

function sanitizeAttemptRecord(attempt) {
  return {
    model: attempt?.model ? String(attempt.model) : null,
    state: attempt?.state ? String(attempt.state) : 'unknown',
    reason: attempt?.reason ? String(attempt.reason) : null,
    status: Number.isFinite(Number(attempt?.status)) ? Number(attempt.status) : null,
    durationMs: Number.isFinite(Number(attempt?.durationMs)) ? Math.max(0, Math.round(Number(attempt.durationMs))) : null,
    overallConfidence:
      Number.isFinite(Number(attempt?.overallConfidence)) ? Number(Number(attempt.overallConfidence).toFixed(3)) : null,
    missingRequiredCount:
      Number.isFinite(Number(attempt?.missingRequiredCount)) ? Math.max(0, Math.round(Number(attempt.missingRequiredCount))) : null,
    attemptIndex: Number.isFinite(Number(attempt?.attemptIndex)) ? Math.max(1, Math.round(Number(attempt.attemptIndex))) : null,
    totalModels: Number.isFinite(Number(attempt?.totalModels)) ? Math.max(1, Math.round(Number(attempt.totalModels))) : null,
  };
}

function sanitizeModelSelection(selection, stopReason = null) {
  const plannedOrder = Array.isArray(selection?.plannedOrder)
    ? selection.plannedOrder.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  return {
    scope: selection?.scope ? String(selection.scope) : 'normalize',
    strategy: selection?.strategy ? String(selection.strategy) : 'static',
    plannedOrder,
    stopReason: stopReason ? String(stopReason) : null,
  };
}

function toFailedNormalizeAttempts(attempts) {
  if (!Array.isArray(attempts)) return [];
  return attempts
    .filter((attempt) => String(attempt?.state || '') === 'failed')
    .map((attempt) => {
      const sanitized = sanitizeAttemptRecord(attempt);
      return {
        model: sanitized.model,
        reason: sanitized.reason,
        ...(sanitized.status != null ? { status: sanitized.status } : {}),
        ...(sanitized.durationMs != null ? { durationMs: sanitized.durationMs } : {}),
      };
    });
}

function buildNormalizeTimings({ deterministicMs = null, providerMs = null, totalMs = null } = {}) {
  return {
    deterministicMs:
      Number.isFinite(Number(deterministicMs)) ? Math.max(0, Math.round(Number(deterministicMs))) : null,
    providerMs: Number.isFinite(Number(providerMs)) ? Math.max(0, Math.round(Number(providerMs))) : null,
    totalMs: Number.isFinite(Number(totalMs)) ? Math.max(0, Math.round(Number(totalMs))) : null,
  };
}

function withNormalizeDiagnostics(response, options = {}) {
  const attempts = Array.isArray(options.attempts) ? options.attempts.map(sanitizeAttemptRecord) : [];
  const resultSource = options.resultSource || (response?.meta?.model ? 'model_merged' : 'deterministic_fallback');
  return {
    ...response,
    meta: {
      ...(response?.meta || {}),
      resultSource,
      attemptSummary: summarizeNormalizeAttempts(attempts),
      failedModelAttempts: toFailedNormalizeAttempts(attempts),
      attempts,
      modelSelection: sanitizeModelSelection(options.modelSelection, options.stopReason),
      timings: buildNormalizeTimings(options.timings),
    },
  };
}

function candidateScore(response, attemptIndex) {
  return {
    missingRequiredCount: Array.isArray(response?.missingRequired) ? response.missingRequired.length : Number.MAX_SAFE_INTEGER,
    overallConfidence: Number.isFinite(Number(response?.overallConfidence)) ? Number(response.overallConfidence) : 0,
    attemptIndex: Number.isFinite(Number(attemptIndex)) ? Number(attemptIndex) : Number.MAX_SAFE_INTEGER,
  };
}

function isBetterCandidate(left, right) {
  if (!right) return true;
  if (left.missingRequiredCount !== right.missingRequiredCount) {
    return left.missingRequiredCount < right.missingRequiredCount;
  }
  if (left.overallConfidence !== right.overallConfidence) {
    return left.overallConfidence > right.overallConfidence;
  }
  return left.attemptIndex < right.attemptIndex;
}

function shouldStopAfterSuccessfulNormalizeCandidate(score) {
  return score.missingRequiredCount === 0;
}

async function emitNormalizeEvent(writer, event) {
  if (typeof writer !== 'function') return;
  await writer(event);
}

export async function normalizeHandFromText(payload, options = {}) {
  const startedAtMs = Date.now();
  const request = validateNormalizeRequest(payload);
  const deterministicStartedAtMs = Date.now();
  const baseline = buildDeterministicBaseline(request);
  const deterministicMs = Date.now() - deterministicStartedAtMs;

  const providerName = options.providerName || process.env.COACH_PROVIDER || 'openrouter';

  let provider;
  try {
    provider =
      options.provider ||
      getLlmProvider(providerName, options.providerOptions || {});
  } catch {
    return withNormalizeDiagnostics(finalizeBaselineResponse(baseline, request, providerName), {
      resultSource: 'deterministic_fallback',
      timings: {
        deterministicMs,
        providerMs: 0,
        totalMs: Date.now() - startedAtMs,
      },
    });
  }

  const timeoutMs = parseTimeoutMs(options.timeoutMs ?? process.env.COACH_REQUEST_TIMEOUT_MS);
  const messages = buildNormalizeMessages({
    manualActionText: request.manualActionText,
    context: request.context,
    deterministicParse: baseline,
  });

  let generation;
  try {
    const providerStartedAtMs = Date.now();
    generation = await provider.generate({
      messages,
      timeoutMs,
      requestKind: 'normalize',
      signal: options.signal,
      validateContent: (content) => {
        const parsed = parseNormalizeModelJson(content);
        validateNormalizeModelPayload(parsed);
      },
    });
    generation.providerMs = Date.now() - providerStartedAtMs;
  } catch {
    return withNormalizeDiagnostics(finalizeBaselineResponse(baseline, request, provider?.name || providerName), {
      attempts: Array.isArray(generation?.attempts) ? generation.attempts : [],
      modelSelection: generation?.selectionPlan,
      stopReason: generation?.stopReason,
      resultSource: 'deterministic_fallback',
      timings: {
        deterministicMs,
        providerMs: generation?.providerMs ?? null,
        totalMs: Date.now() - startedAtMs,
      },
    });
  }

  try {
    const modelJson = parseNormalizeModelJson(generation?.content || '');
    const modelPayload = validateNormalizeModelPayload(modelJson);
    return withNormalizeDiagnostics(
      mergeNormalizeResponses(
        baseline,
        modelPayload,
        request,
        generation,
        provider?.name || providerName
      ),
      {
        attempts: Array.isArray(generation?.attempts) ? generation.attempts : [],
        modelSelection: generation?.selectionPlan,
        stopReason: generation?.stopReason,
        resultSource: 'model_merged',
        timings: {
          deterministicMs,
          providerMs: generation?.providerMs ?? null,
          totalMs: Date.now() - startedAtMs,
        },
      }
    );
  } catch {
    return withNormalizeDiagnostics(finalizeBaselineResponse(baseline, request, provider?.name || providerName), {
      attempts: Array.isArray(generation?.attempts) ? generation.attempts : [],
      modelSelection: generation?.selectionPlan,
      stopReason: generation?.stopReason,
      resultSource: 'deterministic_fallback',
      timings: {
        deterministicMs,
        providerMs: generation?.providerMs ?? null,
        totalMs: Date.now() - startedAtMs,
      },
    });
  }
}

export async function normalizeHandFromTextStream(payload, options = {}) {
  const requestStartedAtMs = Date.now();
  const providerName = options.providerName || process.env.COACH_PROVIDER || 'openrouter';
  const writeEvent = options.writeEvent;

  const request = validateNormalizeRequest(payload);

  await emitNormalizeEvent(writeEvent, {
    type: 'deterministic_started',
    atMs: requestStartedAtMs,
  });

  const deterministicStartedAtMs = Date.now();
  const baseline = buildDeterministicBaseline(request);
  const deterministicMs = Date.now() - deterministicStartedAtMs;

  await emitNormalizeEvent(writeEvent, {
    type: 'deterministic_completed',
    durationMs: deterministicMs,
    overallConfidence: baseline.overallConfidence,
    missingRequired: baseline.missingRequired,
  });

  let provider;
  try {
    provider =
      options.provider ||
      getLlmProvider(providerName, options.providerOptions || {});
  } catch (error) {
    const fallback = withNormalizeDiagnostics(finalizeBaselineResponse(baseline, request, providerName), {
      resultSource: 'deterministic_fallback',
      timings: {
        deterministicMs,
        providerMs: 0,
        totalMs: Date.now() - requestStartedAtMs,
      },
    });
    await emitNormalizeEvent(writeEvent, {
      type: 'error',
      message: error?.message || 'AI provider unavailable. Using deterministic fallback.',
    });
    await emitNormalizeEvent(writeEvent, {
      type: 'final_result',
      provisional: false,
      response: fallback,
    });
    return fallback;
  }

  const timeoutMs = parseTimeoutMs(options.timeoutMs ?? process.env.COACH_REQUEST_TIMEOUT_MS);
  const messages = buildNormalizeMessages({
    manualActionText: request.manualActionText,
    context: request.context,
    deterministicParse: baseline,
  });

  const attempts = [];
  let providerMs = 0;
  let provisionalEmitted = false;
  let bestCandidate = null;
  let bestScore = null;
  let modelSelection = null;
  let stopReason = null;

  try {
    const providerStartedAtMs = Date.now();
    await provider.generateWithProgress({
      messages,
      timeoutMs,
      requestKind: 'normalize',
      signal: options.signal,
      validateContent: (content) => {
        const parsed = parseNormalizeModelJson(content);
        validateNormalizeModelPayload(parsed);
      },
      onAttempt: async (event) => {
        if (event?.phase === 'selection_plan') {
          modelSelection = sanitizeModelSelection(event);
          await emitNormalizeEvent(writeEvent, {
            type: 'selection_plan',
            scope: modelSelection.scope,
            strategy: modelSelection.strategy,
            plannedOrder: modelSelection.plannedOrder,
            totalModels: event.totalModels,
          });
          return null;
        }

        if (event?.phase === 'attempt_started') {
          await emitNormalizeEvent(writeEvent, {
            type: 'attempt_started',
            model: event.model,
            attemptIndex: event.attemptIndex,
            totalModels: event.totalModels,
          });
          return;
        }

        const nextAttempt = sanitizeAttemptRecord(event);
        if (event?.candidate?.content) {
          const modelJson = parseNormalizeModelJson(event.candidate.content);
          const modelPayload = validateNormalizeModelPayload(modelJson);
          const mergedResponse = mergeNormalizeResponses(
            baseline,
            modelPayload,
            request,
            event.candidate,
            provider?.name || providerName
          );
          const score = candidateScore(mergedResponse, event.attemptIndex);
          nextAttempt.overallConfidence = score.overallConfidence;
          nextAttempt.missingRequiredCount = score.missingRequiredCount;

          const attemptsSnapshot = [...attempts, nextAttempt];
          const candidateResponse = withNormalizeDiagnostics(mergedResponse, {
            attempts: attemptsSnapshot,
            resultSource: 'model_merged',
            timings: {
              deterministicMs,
              providerMs: Date.now() - providerStartedAtMs,
              totalMs: Date.now() - requestStartedAtMs,
            },
          });

          if (!provisionalEmitted) {
            provisionalEmitted = true;
            await emitNormalizeEvent(writeEvent, {
              type: 'provisional_result',
              provisional: true,
              model: event.model,
              attemptIndex: event.attemptIndex,
              totalModels: event.totalModels,
              response: candidateResponse,
            });
          }

          if (isBetterCandidate(score, bestScore)) {
            bestScore = score;
            bestCandidate = candidateResponse;
          }

          if (shouldStopAfterSuccessfulNormalizeCandidate(score)) {
            stopReason = 'first_valid_candidate';
            attempts.push(nextAttempt);
            await emitNormalizeEvent(writeEvent, {
              type: 'attempt_completed',
              ...nextAttempt,
              totalModels: event.totalModels,
            });
            return {
              stop: true,
              stopReason,
            };
          }
        }

        attempts.push(nextAttempt);
        await emitNormalizeEvent(writeEvent, {
          type: 'attempt_completed',
          ...nextAttempt,
          totalModels: event.totalModels,
        });
      },
    });
    providerMs = Date.now() - providerStartedAtMs;
  } catch (error) {
    await emitNormalizeEvent(writeEvent, {
      type: 'error',
      message: error?.message || 'AI normalize stream failed. Using deterministic fallback.',
    });
    const fallback = withNormalizeDiagnostics(finalizeBaselineResponse(baseline, request, provider?.name || providerName), {
      attempts,
      modelSelection,
      stopReason,
      resultSource: 'deterministic_fallback',
      timings: {
        deterministicMs,
        providerMs,
        totalMs: Date.now() - requestStartedAtMs,
      },
    });
    if (fallback?.meta?.modelSelection && stopReason && !fallback.meta.modelSelection.stopReason) {
      fallback.meta.modelSelection.stopReason = stopReason;
    }
    await emitNormalizeEvent(writeEvent, {
      type: 'final_result',
      provisional: false,
      response: fallback,
    });
    return fallback;
  }

  const finalResponse = withNormalizeDiagnostics(
    bestCandidate || finalizeBaselineResponse(baseline, request, provider?.name || providerName),
    {
      attempts,
      modelSelection,
      stopReason: stopReason || (bestCandidate ? 'evaluated_ranked_models' : 'exhausted_without_candidate'),
      resultSource: bestCandidate ? 'model_merged' : 'deterministic_fallback',
      timings: {
        deterministicMs,
        providerMs,
        totalMs: Date.now() - requestStartedAtMs,
      },
    }
  );
  if (finalResponse?.meta?.modelSelection && stopReason && !finalResponse.meta.modelSelection.stopReason) {
    finalResponse.meta.modelSelection.stopReason = stopReason;
  }

  await emitNormalizeEvent(writeEvent, {
    type: 'final_result',
    provisional: false,
    response: finalResponse,
  });

  return finalResponse;
}
