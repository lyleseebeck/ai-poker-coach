import { normalizeCard } from '../../src/lib/cards.js';
import { ACTION_TYPES } from '../../src/lib/handSchema.js';
import { createCoachError } from '../coach/errors.js';

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const HAND_CODE_PATTERN = /^([2-9TJQKA])([2-9TJQKA])([SO])?$/;

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toError(message, statusCode = 400, code = 'NORMALIZE_REQUEST_INVALID', details) {
  return createCoachError(message, {
    statusCode,
    code,
    ...(details ? { details } : {}),
  });
}

function requireString(value, label, maxLength = 6000) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw toError(`${label} is required.`);
  }
  if (text.length > maxLength) {
    throw toError(`${label} must be <= ${maxLength} characters.`);
  }
  return text;
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTrimmedUpper(value) {
  if (value == null) return '';
  return String(value).trim().toUpperCase();
}

function sanitizeCardArray(value, label, allowShort = false, maxCount = 2) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw toError(`${label} must be an array of cards.`, 400, 'NORMALIZE_REQUEST_INVALID');
  }
  if (!allowShort && value.length !== 2) {
    throw toError(`${label} must contain exactly 2 cards.`);
  }
  if (allowShort && value.length > maxCount) {
    throw toError(`${label} must include at most ${maxCount} cards.`);
  }

  const cards = [];
  for (let i = 0; i < value.length; i += 1) {
    const normalized = normalizeCard(value[i]);
    if (!normalized) {
      throw toError(`${label}[${i}] must be a valid card like As.`);
    }
    cards.push(normalized);
  }

  if (cards.length === 2 && cards[0] === cards[1]) {
    throw toError(`${label} contains duplicate cards.`);
  }

  return cards;
}

function sanitizeHandCode(value, label = 'handCode') {
  if (value == null || value === '') return null;
  const text = String(value).trim().toUpperCase().replace(/10/g, 'T').replace(/\s+/g, '');
  const match = text.match(HAND_CODE_PATTERN);
  if (!match) {
    throw toError(`${label} must look like AA, AKo, or 76s.`, 502, 'NORMALIZE_MODEL_INVALID');
  }

  const rankA = match[1];
  const rankB = match[2];
  const suitedness = match[3] || '';

  if (rankA === rankB) {
    return `${rankA}${rankB}`;
  }

  const rankOrder = '23456789TJQKA';
  const first = rankOrder.indexOf(rankA) >= rankOrder.indexOf(rankB) ? rankA : rankB;
  const second = first === rankA ? rankB : rankA;
  return `${first}${second}${suitedness.toLowerCase()}`;
}

function sanitizeDecision(raw, label) {
  if (!isPlainObject(raw)) {
    throw toError(`${label} must be an object.`, 502, 'NORMALIZE_MODEL_INVALID');
  }

  const hasAction = raw.action != null && raw.action !== '';
  const hasAmountBb = raw.amountBb != null && raw.amountBb !== '';
  const hasAmountChips = raw.amountChips != null && raw.amountChips !== '';

  if (!hasAction && !hasAmountBb && !hasAmountChips) return null;

  const out = {};

  if (hasAction) {
    const action = String(raw.action).trim().toLowerCase();
    if (!ACTION_TYPES.includes(action)) {
      throw toError(`${label}.action must be one of ${ACTION_TYPES.join(', ')}.`, 502, 'NORMALIZE_MODEL_INVALID');
    }
    out.action = action;
  }

  if (hasAmountBb) {
    const amountBb = toFiniteNumber(raw.amountBb);
    if (amountBb == null) {
      throw toError(`${label}.amountBb must be numeric.`, 502, 'NORMALIZE_MODEL_INVALID');
    }
    out.amountBb = amountBb;
  }

  if (hasAmountChips) {
    const amountChips = toFiniteNumber(raw.amountChips);
    if (amountChips == null) {
      throw toError(`${label}.amountChips must be numeric.`, 502, 'NORMALIZE_MODEL_INVALID');
    }
    out.amountChips = amountChips;
  }

  return out;
}

function sanitizeStringArray(value, label, statusCode = 502) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw toError(`${label} must be an array.`, statusCode, 'NORMALIZE_MODEL_INVALID');
  }
  return value.map((item, index) => {
    const text = typeof item === 'string' ? item.trim() : '';
    if (!text) {
      throw toError(`${label}[${index}] must be a string.`, statusCode, 'NORMALIZE_MODEL_INVALID');
    }
    return text;
  });
}

function sanitizeRecord(value, label, valueMapper) {
  if (value == null) return {};
  if (!isPlainObject(value)) {
    throw toError(`${label} must be an object.`, 502, 'NORMALIZE_MODEL_INVALID');
  }

  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    out[String(key)] = valueMapper(raw, key);
  }
  return out;
}

function sanitizeModelParsedFields(rawParsed) {
  if (!isPlainObject(rawParsed)) {
    throw toError('parsedFields must be an object.', 502, 'NORMALIZE_MODEL_INVALID');
  }

  const parsedFields = {};

  if (isPlainObject(rawParsed.hero)) {
    const hero = {};

    const position = toTrimmedUpper(rawParsed.hero.position);
    if (position) {
      hero.position = position;
    }

    const heroCards = sanitizeCardArray(rawParsed.hero.cards, 'parsedFields.hero.cards', true);
    if (heroCards.length === 2) {
      hero.cards = heroCards;
    }

    const handCode = sanitizeHandCode(rawParsed.hero.handCode, 'parsedFields.hero.handCode');
    if (handCode) {
      hero.handCode = handCode;
    }

    if (Object.keys(hero).length > 0) {
      parsedFields.hero = hero;
    }
  }

  if (isPlainObject(rawParsed.board) && typeof rawParsed.board.didReachFlop === 'boolean') {
    parsedFields.board = {
      didReachFlop: rawParsed.board.didReachFlop,
    };
  }

  if (isPlainObject(rawParsed.board)) {
    const boardCards = sanitizeCardArray(rawParsed.board.cards, 'parsedFields.board.cards', true, 5);
    if (boardCards.length > 0) {
      parsedFields.board = parsedFields.board || {};
      parsedFields.board.cards = boardCards;
    }
  }

  if (isPlainObject(rawParsed.heroStreetSummary)) {
    const streetSummary = {};
    for (const street of STREETS) {
      if (!isPlainObject(rawParsed.heroStreetSummary[street])) continue;
      const decision = sanitizeDecision(rawParsed.heroStreetSummary[street], `parsedFields.heroStreetSummary.${street}`);
      if (decision) {
        streetSummary[street] = decision;
      }
    }
    if (Object.keys(streetSummary).length > 0) {
      parsedFields.heroStreetSummary = streetSummary;
    }
  }

  if (isPlainObject(rawParsed.result)) {
    const result = {};

    const netBbPresent = rawParsed.result.netBb != null && rawParsed.result.netBb !== '';
    if (netBbPresent) {
      const netBb = toFiniteNumber(rawParsed.result.netBb);
      if (netBb == null) {
        throw toError('parsedFields.result.netBb must be numeric.', 502, 'NORMALIZE_MODEL_INVALID');
      }
      result.netBb = netBb;
    }

    const netChipsPresent = rawParsed.result.netChips != null && rawParsed.result.netChips !== '';
    if (netChipsPresent) {
      const netChips = toFiniteNumber(rawParsed.result.netChips);
      if (netChips == null) {
        throw toError('parsedFields.result.netChips must be numeric.', 502, 'NORMALIZE_MODEL_INVALID');
      }
      result.netChips = netChips;
    }

    if (Object.keys(result).length > 0) {
      parsedFields.result = result;
    }
  }

  return parsedFields;
}

export function validateNormalizeRequest(payload) {
  if (!isPlainObject(payload)) {
    throw toError('Request body must be a JSON object.');
  }

  const manualActionText = requireString(payload.manualActionText, 'manualActionText', 8000);
  const contextRaw = isPlainObject(payload.context) ? payload.context : {};

  const boardCards = sanitizeCardArray(contextRaw.boardCards, 'context.boardCards', true, 5).slice(0, 5);
  const heroCardsRaw = Array.isArray(contextRaw.heroCards) ? contextRaw.heroCards : [];
  if (heroCardsRaw.length > 2) {
    throw toError('context.heroCards must include at most 2 cards.');
  }
  const heroCards = [];
  for (let i = 0; i < heroCardsRaw.length; i += 1) {
    const raw = heroCardsRaw[i];
    if (raw == null || String(raw).trim() === '') continue;
    const normalized = normalizeCard(raw);
    if (!normalized) {
      throw toError(`context.heroCards[${i}] must be a valid card like As.`);
    }
    heroCards.push(normalized);
  }

  const context = {
    heroPosition: toTrimmedUpper(contextRaw.heroPosition) || null,
    numPlayers: Number.isInteger(Number(contextRaw.numPlayers)) ? Number(contextRaw.numPlayers) : null,
    boardCards,
    didReachFlop: typeof contextRaw.didReachFlop === 'boolean' ? contextRaw.didReachFlop : null,
    stakes: {
      sb: toFiniteNumber(contextRaw?.stakes?.sb),
      bb: toFiniteNumber(contextRaw?.stakes?.bb),
    },
    currentFields: isPlainObject(contextRaw.currentFields) ? contextRaw.currentFields : {},
    heroCards,
  };

  const deterministicParseRaw = isPlainObject(payload.deterministicParse)
    ? payload.deterministicParse
    : null;

  const deterministicParse = deterministicParseRaw
    ? {
        parsedFields: isPlainObject(deterministicParseRaw.parsedFields)
          ? deterministicParseRaw.parsedFields
          : {},
        confidence: isPlainObject(deterministicParseRaw.confidence)
          ? deterministicParseRaw.confidence
          : {},
        missingRequired: sanitizeStringArray(
          deterministicParseRaw.missingRequired,
          'deterministicParse.missingRequired',
          400
        ),
        evidenceSnippets: isPlainObject(deterministicParseRaw.evidenceSnippets)
          ? deterministicParseRaw.evidenceSnippets
          : {},
      }
    : null;

  return {
    manualActionText,
    context,
    deterministicParse,
  };
}

function extractJsonCandidate(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';

  const fullFence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fullFence) return fullFence[1].trim();

  const partialFence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (partialFence) return partialFence[1].trim();

  return text;
}

export function parseNormalizeModelJson(rawText) {
  const candidate = extractJsonCandidate(rawText);
  if (!candidate) {
    throw toError('Normalize model returned empty content.', 502, 'NORMALIZE_MODEL_INVALID');
  }

  try {
    return JSON.parse(candidate);
  } catch {
    throw toError('Normalize model returned invalid JSON.', 502, 'NORMALIZE_MODEL_INVALID', {
      snippet: candidate.slice(0, 500),
    });
  }
}

export function validateNormalizeModelPayload(payload) {
  if (!isPlainObject(payload)) {
    throw toError('Normalize model payload must be a JSON object.', 502, 'NORMALIZE_MODEL_INVALID');
  }

  const parsedFields = sanitizeModelParsedFields(payload.parsedFields || {});
  const confidenceByField = sanitizeRecord(
    payload.confidenceByField,
    'confidenceByField',
    (value, key) => {
      const n = toFiniteNumber(value);
      if (n == null) {
        throw toError(`confidenceByField.${key} must be numeric.`, 502, 'NORMALIZE_MODEL_INVALID');
      }
      return Math.max(0, Math.min(1, Number(n.toFixed(3))));
    }
  );

  const evidenceSnippets = sanitizeRecord(
    payload.evidenceSnippets,
    'evidenceSnippets',
    (value, key) => {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) {
        throw toError(`evidenceSnippets.${key} must be a non-empty string.`, 502, 'NORMALIZE_MODEL_INVALID');
      }
      return text;
    }
  );

  const missingRequired = sanitizeStringArray(payload.missingRequired, 'missingRequired');
  const needsUserInput = sanitizeStringArray(payload.needsUserInput, 'needsUserInput');

  return {
    parsedFields,
    confidenceByField,
    evidenceSnippets,
    missingRequired,
    needsUserInput,
  };
}

export function normalizeHandCodeText(value) {
  return sanitizeHandCode(value, 'handCode');
}
