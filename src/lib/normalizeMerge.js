import { normalizeCard } from './cards.js';
import { ACTION_TYPES } from './handSchema.js';

const STREETS = ['preflop', 'flop', 'turn', 'river'];

function toAction(value) {
  const action = String(value || 'none').trim().toLowerCase();
  return ACTION_TYPES.includes(action) ? action : 'none';
}

function toTrimmed(value) {
  return String(value || '').trim();
}

function toUpper(value) {
  return toTrimmed(value).toUpperCase();
}

function toBoolean(value, fallback = true) {
  return typeof value === 'boolean' ? value : fallback;
}

function toNumberString(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return String(n);
}

function normalizeNumberForCompare(value) {
  const text = toTrimmed(value);
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : text;
}

function equalByType(left, right, type) {
  if (type === 'card') return normalizeCard(left) === normalizeCard(right);
  if (type === 'position') return toUpper(left) === toUpper(right);
  if (type === 'action') return toAction(left) === toAction(right);
  if (type === 'boolean') return Boolean(left) === Boolean(right);
  if (type === 'number') {
    const a = normalizeNumberForCompare(left);
    const b = normalizeNumberForCompare(right);
    return a === b;
  }
  return toTrimmed(left) === toTrimmed(right);
}

function cloneSnapshot(snapshot) {
  return {
    ...snapshot,
  };
}

function buildFieldConflict(id, label, type, currentValue, suggestedValue) {
  return {
    id,
    label,
    type,
    currentValue,
    suggestedValue,
    resolution: null,
  };
}

function shouldTreatDidReachFlopAsFilled(snapshot) {
  if (snapshot.didReachFlopFilled) return true;
  if (snapshot.didReachFlop === false) return true;
  if (normalizeCard(snapshot.heroCard1) || normalizeCard(snapshot.heroCard2)) return false;
  if (snapshot.flopAction !== 'none' || snapshot.turnAction !== 'none' || snapshot.riverAction !== 'none') return true;
  return false;
}

export function buildNormalizeSnapshot(raw = {}) {
  return {
    heroCard1: normalizeCard(raw.heroCard1) || '',
    heroCard2: normalizeCard(raw.heroCard2) || '',
    heroPosition: toUpper(raw.heroPosition),
    didReachFlop: toBoolean(raw.didReachFlop, true),
    didReachFlopFilled: Boolean(raw.didReachFlopFilled),

    preflopAction: toAction(raw.preflopAction),
    preflopAmountBb: toTrimmed(raw.preflopAmountBb),
    preflopAmountChips: toTrimmed(raw.preflopAmountChips),

    flopAction: toAction(raw.flopAction),
    flopAmountBb: toTrimmed(raw.flopAmountBb),
    flopAmountChips: toTrimmed(raw.flopAmountChips),

    turnAction: toAction(raw.turnAction),
    turnAmountBb: toTrimmed(raw.turnAmountBb),
    turnAmountChips: toTrimmed(raw.turnAmountChips),

    riverAction: toAction(raw.riverAction),
    riverAmountBb: toTrimmed(raw.riverAmountBb),
    riverAmountChips: toTrimmed(raw.riverAmountChips),

    netBb: toTrimmed(raw.netBb),
    netChips: toTrimmed(raw.netChips),
  };
}

function applyField({
  next,
  conflicts,
  fillOnlyMissing,
  id,
  label,
  type,
  currentValue,
  suggestedValue,
  isMissing,
  assign,
}) {
  const hasSuggestion =
    suggestedValue !== null &&
    suggestedValue !== undefined &&
    !(typeof suggestedValue === 'string' && toTrimmed(suggestedValue) === '');

  if (!hasSuggestion) return;

  const missing = isMissing(currentValue);
  if (missing || !fillOnlyMissing) {
    assign(suggestedValue);
    return;
  }

  if (!equalByType(currentValue, suggestedValue, type)) {
    conflicts.push(buildFieldConflict(id, label, type, currentValue, suggestedValue));
  }
}

export function applyParsedFieldsToSnapshot(snapshot, parsedFields, options = {}) {
  const fillOnlyMissing = options.fillOnlyMissing !== false;
  const next = cloneSnapshot(snapshot);
  const conflicts = [];

  const hero = parsedFields?.hero || {};
  const board = parsedFields?.board || {};
  const result = parsedFields?.result || {};
  const summary = parsedFields?.heroStreetSummary || {};

  applyField({
    next,
    conflicts,
    fillOnlyMissing,
    id: 'hero.position',
    label: 'Hero position',
    type: 'position',
    currentValue: next.heroPosition,
    suggestedValue: hero.position ? toUpper(hero.position) : '',
    isMissing: (value) => toTrimmed(value) === '',
    assign: (value) => {
      next.heroPosition = toUpper(value);
    },
  });

  const heroCards = Array.isArray(hero.cards) ? hero.cards : [];
  const suggestedCard1 = normalizeCard(heroCards[0]) || '';
  const suggestedCard2 = normalizeCard(heroCards[1]) || '';

  applyField({
    next,
    conflicts,
    fillOnlyMissing,
    id: 'hero.card1',
    label: 'Hero card 1',
    type: 'card',
    currentValue: next.heroCard1,
    suggestedValue: suggestedCard1,
    isMissing: (value) => !normalizeCard(value),
    assign: (value) => {
      next.heroCard1 = normalizeCard(value) || '';
    },
  });

  applyField({
    next,
    conflicts,
    fillOnlyMissing,
    id: 'hero.card2',
    label: 'Hero card 2',
    type: 'card',
    currentValue: next.heroCard2,
    suggestedValue: suggestedCard2,
    isMissing: (value) => !normalizeCard(value),
    assign: (value) => {
      next.heroCard2 = normalizeCard(value) || '';
    },
  });

  applyField({
    next,
    conflicts,
    fillOnlyMissing,
    id: 'board.didReachFlop',
    label: 'Reached flop',
    type: 'boolean',
    currentValue: next.didReachFlop,
    suggestedValue:
      typeof board.didReachFlop === 'boolean' ? board.didReachFlop : null,
    isMissing: () => !shouldTreatDidReachFlopAsFilled(next),
    assign: (value) => {
      next.didReachFlop = Boolean(value);
      next.didReachFlopFilled = true;
    },
  });

  for (const street of STREETS) {
    const parsedStreet = summary?.[street] || {};

    applyField({
      next,
      conflicts,
      fillOnlyMissing,
      id: `heroStreetSummary.${street}.action`,
      label: `${street[0].toUpperCase()}${street.slice(1)} action`,
      type: 'action',
      currentValue: next[`${street}Action`],
      suggestedValue:
        parsedStreet.action != null ? toAction(parsedStreet.action) : null,
      isMissing: (value) => toAction(value) === 'none',
      assign: (value) => {
        next[`${street}Action`] = toAction(value);
      },
    });

    applyField({
      next,
      conflicts,
      fillOnlyMissing,
      id: `heroStreetSummary.${street}.amountBb`,
      label: `${street[0].toUpperCase()}${street.slice(1)} amount (BB)`,
      type: 'number',
      currentValue: next[`${street}AmountBb`],
      suggestedValue: parsedStreet.amountBb != null ? toNumberString(parsedStreet.amountBb) : '',
      isMissing: (value) => toTrimmed(value) === '',
      assign: (value) => {
        next[`${street}AmountBb`] = toNumberString(value);
      },
    });

    applyField({
      next,
      conflicts,
      fillOnlyMissing,
      id: `heroStreetSummary.${street}.amountChips`,
      label: `${street[0].toUpperCase()}${street.slice(1)} amount ($)`,
      type: 'number',
      currentValue: next[`${street}AmountChips`],
      suggestedValue: parsedStreet.amountChips != null ? toNumberString(parsedStreet.amountChips) : '',
      isMissing: (value) => toTrimmed(value) === '',
      assign: (value) => {
        next[`${street}AmountChips`] = toNumberString(value);
      },
    });
  }

  applyField({
    next,
    conflicts,
    fillOnlyMissing,
    id: 'result.netBb',
    label: 'Net result (BB)',
    type: 'number',
    currentValue: next.netBb,
    suggestedValue: result.netBb != null ? toNumberString(result.netBb) : '',
    isMissing: (value) => toTrimmed(value) === '',
    assign: (value) => {
      next.netBb = toNumberString(value);
    },
  });

  applyField({
    next,
    conflicts,
    fillOnlyMissing,
    id: 'result.netChips',
    label: 'Net result ($)',
    type: 'number',
    currentValue: next.netChips,
    suggestedValue: result.netChips != null ? toNumberString(result.netChips) : '',
    isMissing: (value) => toTrimmed(value) === '',
    assign: (value) => {
      next.netChips = toNumberString(value);
    },
  });

  return {
    nextSnapshot: next,
    conflicts,
  };
}

export function applyConflictResolution(snapshot, conflict, resolution) {
  const next = cloneSnapshot(snapshot);
  if (resolution !== 'use_ai') return next;

  const value = conflict?.suggestedValue;
  switch (conflict?.id) {
    case 'hero.position':
      next.heroPosition = toUpper(value);
      break;
    case 'hero.card1':
      next.heroCard1 = normalizeCard(value) || '';
      break;
    case 'hero.card2':
      next.heroCard2 = normalizeCard(value) || '';
      break;
    case 'board.didReachFlop':
      next.didReachFlop = Boolean(value);
      next.didReachFlopFilled = true;
      break;
    case 'result.netBb':
      next.netBb = toNumberString(value);
      break;
    case 'result.netChips':
      next.netChips = toNumberString(value);
      break;
    default: {
      for (const street of STREETS) {
        if (conflict?.id === `heroStreetSummary.${street}.action`) {
          next[`${street}Action`] = toAction(value);
          return next;
        }
        if (conflict?.id === `heroStreetSummary.${street}.amountBb`) {
          next[`${street}AmountBb`] = toNumberString(value);
          return next;
        }
        if (conflict?.id === `heroStreetSummary.${street}.amountChips`) {
          next[`${street}AmountChips`] = toNumberString(value);
          return next;
        }
      }
    }
  }

  return next;
}

export function unresolvedConflictCount(conflicts) {
  return (Array.isArray(conflicts) ? conflicts : []).filter((item) => !item?.resolution).length;
}

export function formatConflictValue(type, value) {
  if (value == null || value === '') return '(empty)';
  if (type === 'boolean') return value ? 'Yes' : 'No';
  if (type === 'position') return toUpper(value);
  if (type === 'card') return normalizeCard(value) || String(value);
  return String(value);
}
