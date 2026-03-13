import { useEffect, useMemo, useState } from 'react';
import { getHands, saveHands } from '../lib/storage.js';
import { normalizeCard } from '../lib/cards.js';
import { PLAYER_COUNTS, POSITIONS_BY_PLAYERS } from '../lib/positions.js';
import { buildHandRecordV2, createEmptyHandDraft, validateHandDraft } from '../lib/handSchema.js';
import { parseManualActionText } from '../lib/manualActionParser.js';
import { parseIgnitionHandHistory } from '../lib/ignitionParser.js';
import { normalizeHandFromText } from '../lib/aiNormalizeClient.js';
import {
  applyConflictResolution,
  applyParsedFieldsToSnapshot,
  buildNormalizeSnapshot,
  formatConflictValue,
  unresolvedConflictCount,
} from '../lib/normalizeMerge.js';
import { CardPicker } from './CardPicker.jsx';
import { CardLogo } from './CardLogo.jsx';
import { HandDetailsForm } from './HandDetailsForm.jsx';

const ACTION_OPTIONS = [
  { value: 'none', label: 'Action' },
  { value: 'fold', label: 'Fold' },
  { value: 'check', label: 'Check' },
  { value: 'call', label: 'Call' },
  { value: 'bet', label: 'Bet' },
  { value: 'raise', label: 'Raise' },
  { value: 'all_in', label: 'All-in' },
];

const AI_FALLBACK_CONFIDENCE_THRESHOLD = 0.75;
const DEFAULT_PRE_FLOP_OPEN_BB = 2.5;
const DEFAULT_PRE_FLOP_3BET_BB = 8;
const STREET_DECISION_ROW_CLASS = 'grid gap-2 items-center md:grid-cols-[170px,minmax(0,1fr)]';
const STREET_DECISION_CONTROLS_CLASS = 'grid gap-2 sm:grid-cols-3';

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundBb(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

function postedBlindBbByPosition(position) {
  const pos = normalizePosition(position);
  if (pos === 'SB') return 0.5;
  if (pos === 'BB') return 1;
  return 0;
}

function getLastHeroAction(summary) {
  for (const street of ['river', 'turn', 'flop', 'preflop']) {
    const action = String(summary?.[street]?.action || 'none').toLowerCase();
    if (action && action !== 'none') return { street, action };
  }
  return { street: null, action: 'none' };
}

function estimateStreetContributionBb(street, decision, runningPotBb, heroPosition, assumptions) {
  const action = String(decision?.action || 'none').toLowerCase();
  if (action === 'none' || action === 'check') return 0;
  if (action === 'fold') {
    const streetNet = numberOrNull(decision?.streetNetBb);
    return streetNet != null && streetNet < 0 ? Math.abs(streetNet) : 0;
  }

  const explicitAmount = numberOrNull(decision?.amountBb);
  if (explicitAmount != null && explicitAmount >= 0) return explicitAmount;
  const facingAmount = numberOrNull(decision?.facingAmountBb);
  if (action === 'call' && facingAmount != null && facingAmount >= 0) {
    return facingAmount;
  }

  if (street === 'preflop') {
    if (action === 'call') {
      assumptions.push('Assumed preflop call size as 2.5bb (standard open).');
      return DEFAULT_PRE_FLOP_OPEN_BB;
    }
    if (action === 'raise') {
      assumptions.push('Assumed preflop raise size as 8bb (standard 3-bet sizing).');
      return DEFAULT_PRE_FLOP_3BET_BB;
    }
    if (action === 'all_in') {
      assumptions.push('Assumed preflop all-in commit as 20bb due to missing size.');
      return 20;
    }
    assumptions.push('Assumed preflop investment as 2.5bb due to missing size.');
    return DEFAULT_PRE_FLOP_OPEN_BB;
  }

  const basePot = Math.max(numberOrNull(runningPotBb) || 0, 6);
  if (action === 'call') {
    assumptions.push(`Assumed ${street} call size as ~66% pot (${roundBb(basePot * 0.66)}bb).`);
    return roundBb(basePot * 0.66) || 0;
  }
  if (action === 'bet') {
    assumptions.push(`Assumed ${street} bet size as ~66% pot (${roundBb(basePot * 0.66)}bb).`);
    return roundBb(basePot * 0.66) || 0;
  }
  if (action === 'raise') {
    assumptions.push(`Assumed ${street} raise size as ~150% pot (${roundBb(basePot * 1.5)}bb).`);
    return roundBb(basePot * 1.5) || 0;
  }
  if (action === 'all_in') {
    const fallback = Math.max(roundBb(basePot * 1.5) || 0, 20);
    assumptions.push(`Assumed ${street} all-in investment as ${fallback}bb due to missing size.`);
    return fallback;
  }

  if (action === 'fold') {
    return street === 'preflop' ? postedBlindBbByPosition(heroPosition) : 0;
  }

  return 0;
}

function buildStreetContributionEstimate(summary, heroPosition) {
  const assumptions = [];
  let heroInvestedBb = postedBlindBbByPosition(heroPosition);
  let runningPotBb = 1.5;

  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    const decision = summary?.[street] || {};
    const contribution = estimateStreetContributionBb(
      street,
      decision,
      runningPotBb,
      heroPosition,
      assumptions
    );
    heroInvestedBb += contribution;
    runningPotBb += contribution * 2;

    if (String(decision?.action || 'none').toLowerCase() === 'fold') {
      break;
    }
  }

  return {
    heroInvestedBb: roundBb(heroInvestedBb),
    assumptions,
    lastAction: getLastHeroAction(summary),
  };
}

function estimateNetBbFromSummary(summary, heroPosition) {
  const estimate = buildStreetContributionEstimate(summary, heroPosition);

  if (estimate.lastAction.action === 'fold') {
    return {
      estimatedNetBb: -roundBb(estimate.heroInvestedBb),
      assumptions: [
        `Estimated net result in BB as -${roundBb(estimate.heroInvestedBb)} based on inferred street investments.`,
        ...estimate.assumptions,
      ],
    };
  }

  return {
    estimatedNetBb: null,
    assumptions: estimate.assumptions,
  };
}

function evaluateFoldNetConsistency(summary, heroPosition, netBb) {
  const netValue = numberOrNull(netBb);
  if (netValue == null) return null;

  const estimate = buildStreetContributionEstimate(summary, heroPosition);
  if (estimate.lastAction.action !== 'fold') return null;

  const expectedLoss = roundBb(estimate.heroInvestedBb);
  if (expectedLoss == null) return null;
  const mismatch = Math.abs(Math.abs(netValue) - expectedLoss);
  return {
    expectedNetBb: -expectedLoss,
    mismatchBb: roundBb(mismatch) || 0,
    assumptions: estimate.assumptions,
  };
}

function normalizePosition(value) {
  return String(value || '')
    .replace(/\s*\[ME\]\s*$/i, '')
    .trim()
    .toUpperCase();
}

function parseStakesFromGameType(gameType) {
  const text = String(gameType || '');
  const match = text.match(/\$?(\d+(?:\.\d+)?)\s*\/\s*\$?(\d+(?:\.\d+)?)/);
  if (!match) return { sb: null, bb: null };
  return {
    sb: numberOrNull(match[1]),
    bb: numberOrNull(match[2]),
  };
}

function parseStakesFromActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return { sb: null, bb: null };

  let sb = null;
  let bb = null;

  for (const action of actions) {
    const actionText = String(action?.action || '').toLowerCase();
    const amount = numberOrNull(action?.amount);
    if (amount == null) continue;

    if (sb == null && actionText.includes('small blind')) {
      sb = amount;
    }
    if (bb == null && actionText.includes('big blind')) {
      bb = amount;
    }
    if (sb != null && bb != null) break;
  }

  return { sb, bb };
}

function inferImportStakes(parsed, fallbackBb) {
  const fromText = parseStakesFromGameType(`${parsed?.gameType || ''} ${parsed?.tableName || ''}`);
  const fromActions = parseStakesFromActions(parsed?.actions || []);
  const sb = fromText.sb ?? fromActions.sb ?? null;
  const bb = fromText.bb ?? fromActions.bb ?? numberOrNull(fallbackBb);
  return { sb, bb };
}

function inferImportNetChips(parsed, heroPosition) {
  const heroPos = normalizePosition(heroPosition);
  const me = (parsed?.players || []).find((player) => player.isMe);
  if (me?.winLoss != null) return numberOrNull(me.winLoss);

  if (!Array.isArray(parsed?.actions) || !heroPos) return null;
  for (let i = parsed.actions.length - 1; i >= 0; i -= 1) {
    const action = parsed.actions[i];
    if (normalizePosition(action?.position) !== heroPos) continue;
    if (!String(action?.action || '').toLowerCase().includes('hand result')) continue;
    const amount = numberOrNull(action?.amount);
    if (amount != null) return amount;
  }
  return null;
}

function expectedBoardCardsFromTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return 0;
  let max = 0;
  for (const row of timeline) {
    if (row.street === 'river') return 5;
    if (row.street === 'turn') max = Math.max(max, 4);
    else if (row.street === 'flop') max = Math.max(max, 3);
  }
  return max;
}

function streetLabelForBoardCount(count) {
  if (count >= 5) return 'river';
  if (count >= 4) return 'turn';
  if (count >= 3) return 'flop';
  return 'preflop';
}

function importBoardRequirementMessage(expectedCount) {
  if (expectedCount >= 5) {
    return 'Imported hand reached river. Enter exactly 5 community cards (flop, turn, river).';
  }
  if (expectedCount >= 4) {
    return 'Imported hand reached turn. Enter exactly 4 community cards (flop + turn).';
  }
  if (expectedCount >= 3) {
    return 'Imported hand reached flop. Enter exactly 3 community cards.';
  }
  return "Imported hand ended preflop. Enable 'Hand didn't reach flop' and clear community cards.";
}

function mapActionType(actionText) {
  const text = String(actionText || '').toLowerCase();
  if (!text) return 'none';
  if (text.includes('all-in') || text.includes('all in') || text.includes('jam') || text.includes('shove')) return 'all_in';
  if (text.includes('raise')) return 'raise';
  if (text.includes('bet')) return 'bet';
  if (text.includes('call') || text.includes('flat')) return 'call';
  if (text.includes('check')) return 'check';
  if (text.includes('fold') || text.includes('muck')) return 'fold';
  return 'none';
}

function streetFromMarker(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'preflop' || text === 'pre-flop') return 'preflop';
  if (text === 'flop') return 'flop';
  if (text === 'turn') return 'turn';
  if (text === 'river') return 'river';
  return null;
}

function detectStreetMarker(action) {
  return streetFromMarker(action?.position) || streetFromMarker(action?.action);
}

function inferStreetFromActionRow(action, fallbackStreet = 'unknown') {
  const marker = detectStreetMarker(action);
  if (marker) return marker;

  const text = `${action?.position || ''} ${action?.action || ''} ${action?.timestamp || ''}`.toLowerCase();
  if (text.includes('preflop') || text.includes('pre-flop')) return 'preflop';
  if (text.includes('flop')) return 'flop';
  if (text.includes('turn')) return 'turn';
  if (text.includes('river')) return 'river';
  return fallbackStreet;
}

function createImportDecision(actionType, amount, bbSize) {
  const amountChips = numberOrNull(amount);
  const bb = numberOrNull(bbSize);
  const amountBb = bb && amountChips != null ? amountChips / bb : null;
  return {
    action: actionType,
    amountBb,
    facingAmountBb: actionType === 'call' ? amountBb : null,
    amountChips,
    source: 'imported',
  };
}

function inferHeroStreetSummaryFromImport(actions, heroPosition, bbSize) {
  const summary = {
    preflop: createImportDecision('none', null, bbSize),
    flop: createImportDecision('none', null, bbSize),
    turn: createImportDecision('none', null, bbSize),
    river: createImportDecision('none', null, bbSize),
  };

  const heroPos = normalizePosition(heroPosition);
  if (!heroPos || !Array.isArray(actions) || actions.length === 0) return summary;

  let currentStreet = 'preflop';
  for (const action of actions) {
    const markerStreet = detectStreetMarker(action);
    if (markerStreet) {
      currentStreet = markerStreet;
      continue;
    }
    if (normalizePosition(action?.position) !== heroPos) continue;
    const actionType = mapActionType(action?.action);
    if (actionType === 'none') continue;
    const decision = createImportDecision(actionType, action?.amount, bbSize);
    const street = inferStreetFromActionRow(action, currentStreet);
    if (!['preflop', 'flop', 'turn', 'river'].includes(street)) continue;
    summary[street] = decision;
  }

  return summary;
}

function mapImportTimeline(actions, heroPosition) {
  const heroPos = normalizePosition(heroPosition);
  if (!Array.isArray(actions)) return [];
  let currentStreet = 'preflop';
  const rows = [];
  let seq = 1;

  for (const action of actions) {
    const markerStreet = detectStreetMarker(action);
    if (markerStreet) {
      currentStreet = markerStreet;
      continue;
    }

    rows.push({
      seq,
      street: inferStreetFromActionRow(action, currentStreet),
      position: action?.position || null,
      actionRaw: action?.action || '',
      actionNorm: mapActionType(action?.action),
      amountChips: numberOrNull(action?.amount),
      timestamp: action?.timestamp || null,
      isHero: normalizePosition(action?.position) === heroPos,
    });
    seq += 1;
  }

  return rows;
}

function formatFieldKey(key) {
  return key
    .replace(/^street_/, '')
    .replace(/_/g, ' ')
    .replace(/\./g, ' ')
    .trim();
}

function manualTextSignature(value) {
  return String(value || '').trim();
}

function shouldRequestAiFallback(parsed) {
  if (!parsed) return false;
  const missing = Array.isArray(parsed.missingRequired) ? parsed.missingRequired.length : 0;
  const overallConfidence = Number(parsed.confidence?.overall ?? 0);
  return missing > 0 || overallConfidence < AI_FALLBACK_CONFIDENCE_THRESHOLD;
}

function summarizeAiProposal(proposal) {
  const fields = proposal?.parsedFields || {};
  const summary = [];

  if (Array.isArray(fields?.hero?.cards) && fields.hero.cards.length === 2) {
    summary.push(`Hero cards: ${fields.hero.cards.join(' ')}`);
  } else if (fields?.hero?.handCode) {
    summary.push(`Hero hand: ${fields.hero.handCode}`);
  }

  const position = fields?.hero?.position;
  if (position) summary.push(`Hero position: ${position}`);

  const streetSummary = fields?.heroStreetSummary || {};
  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    const decision = streetSummary?.[street] || {};
    const action = decision?.action;
    if (action && action !== 'none') {
      const streetBetBb = numberOrNull(decision.amountBb) ?? numberOrNull(decision.facingAmountBb);
      const streetNetBb = numberOrNull(decision.streetNetBb);
      if (streetBetBb != null && streetNetBb != null) {
        summary.push(`${street}: ${action} ${streetBetBb}bb (street result ${streetNetBb}bb)`);
      } else if (streetBetBb != null) {
        summary.push(`${street}: ${action} ${streetBetBb}bb`);
      } else if (streetNetBb != null) {
        summary.push(`${street}: ${action} (street result ${streetNetBb}bb)`);
      } else {
        summary.push(`${street}: ${action}`);
      }
    }
  }

  const netBb = fields?.result?.netBb;
  if (netBb != null) summary.push(`Net BB: ${netBb}`);
  const netChips = fields?.result?.netChips;
  if (netChips != null) summary.push(`Net $: ${netChips}`);

  const boardCards = Array.isArray(fields?.board?.cards) ? fields.board.cards : [];
  if (boardCards.length >= 3) {
    summary.push(`Board: ${boardCards.join(' ')}`);
  }

  return summary;
}

function mergeParsedIntoState(current, parsed, fillOnlyMissing) {
  if (!parsed) return current;

  const next = { ...current };
  const parsedSummary = parsed.parsedFields?.heroStreetSummary || {};

  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    const parsedDecision = parsedSummary[street];
    if (!parsedDecision || parsedDecision.action === 'none') continue;

    const actionKey = `${street}Action`;
    const bbKey = `${street}AmountBb`;
    const streetNetKey = `${street}StreetNetBb`;
    const facingKey = `${street}FacingAmountBb`;
    const chipsKey = `${street}AmountChips`;
    const shouldSetAction = !fillOnlyMissing || next[actionKey] === 'none';
    if (shouldSetAction) next[actionKey] = parsedDecision.action;

    if (parsedDecision.amountBb != null) {
      const shouldSetAmountBb = !fillOnlyMissing || next[bbKey] === '';
      if (shouldSetAmountBb) next[bbKey] = String(parsedDecision.amountBb);
    }
    if (parsedDecision.facingAmountBb != null) {
      const shouldSetFacingBb = !fillOnlyMissing || next[facingKey] === '';
      if (shouldSetFacingBb) next[facingKey] = String(parsedDecision.facingAmountBb);
    }
    if (parsedDecision.streetNetBb != null) {
      const shouldSetStreetNetBb = !fillOnlyMissing || next[streetNetKey] === '';
      if (shouldSetStreetNetBb) next[streetNetKey] = String(parsedDecision.streetNetBb);
    }
    if (parsedDecision.amountChips != null) {
      const shouldSetAmountChips = !fillOnlyMissing || next[chipsKey] === '';
      if (shouldSetAmountChips) next[chipsKey] = String(parsedDecision.amountChips);
    }
  }

  if (parsed.parsedFields?.result?.netBb != null) {
    const shouldSetNetBb = !fillOnlyMissing || next.netBb === '';
    if (shouldSetNetBb) next.netBb = String(parsed.parsedFields.result.netBb);
  }
  if (parsed.parsedFields?.result?.netChips != null) {
    const shouldSetNetChips = !fillOnlyMissing || next.netChips === '';
    if (shouldSetNetChips) next.netChips = String(parsed.parsedFields.result.netChips);
  }

  return next;
}

function StreetDecisionRow({
  street,
  label,
  action,
  streetBetBb,
  streetResultBb,
  setAction,
  setStreetBetBb,
  setStreetResultBb,
}) {
  const inputClass =
    'w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white';

  return (
    <div className={STREET_DECISION_ROW_CLASS}>
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className={STREET_DECISION_CONTROLS_CLASS}>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className={inputClass}
        >
          {ACTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.1"
          value={streetBetBb}
          onChange={(e) => setStreetBetBb(e.target.value)}
          className={inputClass}
          placeholder="Bet size (BB)"
        />
        <input
          type="number"
          step="0.1"
          value={streetResultBb}
          onChange={(e) => setStreetResultBb(e.target.value)}
          className={inputClass}
          placeholder="Street result (BB)"
        />
      </div>
    </div>
  );
}

export function UnifiedHandForm({
  onHandsChange,
  onHandSelectionReset,
  heroCard1,
  heroCard2,
  setHeroCard1,
  setHeroCard2,
  noFlop,
  setNoFlop,
  flop1,
  flop2,
  flop3,
  turn,
  river,
  setFlop1,
  setFlop2,
  setFlop3,
  setTurn,
  setRiver,
  effectiveTargetId,
  cardPickerRank,
  setCardPickerRank,
  cardPickerError,
  onApplyCard,
  registerCardPickerTarget,
  clearCardBySlotId,
}) {
  const [numPlayers, setNumPlayers] = useState(8);
  const [heroPosition, setHeroPosition] = useState('');
  const [sbSize, setSbSize] = useState('');
  const [bbSize, setBbSize] = useState('');
  const [heroStackDepthBb, setHeroStackDepthBb] = useState('');
  const [villainStackDepthBb, setVillainStackDepthBb] = useState('');

  const [preflopAction, setPreflopAction] = useState('none');
  const [preflopAmountBb, setPreflopAmountBb] = useState('');
  const [preflopStreetNetBb, setPreflopStreetNetBb] = useState('');
  const [preflopFacingAmountBb, setPreflopFacingAmountBb] = useState('');
  const [preflopAmountChips, setPreflopAmountChips] = useState('');
  const [flopAction, setFlopAction] = useState('none');
  const [flopAmountBb, setFlopAmountBb] = useState('');
  const [flopStreetNetBb, setFlopStreetNetBb] = useState('');
  const [flopFacingAmountBb, setFlopFacingAmountBb] = useState('');
  const [flopAmountChips, setFlopAmountChips] = useState('');
  const [turnAction, setTurnAction] = useState('none');
  const [turnAmountBb, setTurnAmountBb] = useState('');
  const [turnStreetNetBb, setTurnStreetNetBb] = useState('');
  const [turnFacingAmountBb, setTurnFacingAmountBb] = useState('');
  const [turnAmountChips, setTurnAmountChips] = useState('');
  const [riverAction, setRiverAction] = useState('none');
  const [riverAmountBb, setRiverAmountBb] = useState('');
  const [riverStreetNetBb, setRiverStreetNetBb] = useState('');
  const [riverFacingAmountBb, setRiverFacingAmountBb] = useState('');
  const [riverAmountChips, setRiverAmountChips] = useState('');

  const [netBb, setNetBb] = useState('');
  const [netChips, setNetChips] = useState('');
  const [knownCardsText, setKnownCardsText] = useState('');
  const [entryMode, setEntryMode] = useState('manual');
  const [manualActionText, setManualActionText] = useState('');
  const [notes, setNotes] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [parsePreview, setParsePreview] = useState(null);
  const [importRawText, setImportRawText] = useState('');
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [parsedImport, setParsedImport] = useState(null);
  const [parsedImportSnapshot, setParsedImportSnapshot] = useState('');
  const [aiStatus, setAiStatus] = useState('idle');
  const [aiError, setAiError] = useState('');
  const [aiProposal, setAiProposal] = useState(null);
  const [aiProposalSignature, setAiProposalSignature] = useState('');
  const [aiConflicts, setAiConflicts] = useState([]);
  const [manualParseInFlight, setManualParseInFlight] = useState(false);

  const positions = POSITIONS_BY_PLAYERS[numPlayers] || [];
  const boardCards = useMemo(() => {
    if (noFlop) return [];
    return [flop1, flop2, flop3, turn, river].map((c) => normalizeCard(c)).filter(Boolean);
  }, [noFlop, flop1, flop2, flop3, turn, river]);

  const showFlop = !noFlop;
  const showTurn = !noFlop && boardCards.length >= 4;
  const showRiver = !noFlop && boardCards.length >= 5;
  const isImportMode = entryMode === 'ignition';

  useEffect(() => {
    const signature = manualTextSignature(manualActionText);
    if (!signature) {
      setAiStatus('idle');
      setAiError('');
      setAiProposal(null);
      setAiProposalSignature('');
      setAiConflicts([]);
      return;
    }
    if (aiProposalSignature && aiProposalSignature !== signature) {
      setAiStatus('idle');
      setAiError('');
      setAiProposal(null);
      setAiProposalSignature('');
      setAiConflicts([]);
    }
  }, [manualActionText, aiProposalSignature]);

  useEffect(() => {
    if (!isImportMode) {
      setImportError('');
    }
  }, [isImportMode]);

  const setFromMergedState = (next) => {
    setPreflopAction(next.preflopAction);
    setPreflopAmountBb(next.preflopAmountBb);
    setPreflopStreetNetBb(next.preflopStreetNetBb);
    setPreflopFacingAmountBb(next.preflopFacingAmountBb);
    setPreflopAmountChips(next.preflopAmountChips);
    setFlopAction(next.flopAction);
    setFlopAmountBb(next.flopAmountBb);
    setFlopStreetNetBb(next.flopStreetNetBb);
    setFlopFacingAmountBb(next.flopFacingAmountBb);
    setFlopAmountChips(next.flopAmountChips);
    setTurnAction(next.turnAction);
    setTurnAmountBb(next.turnAmountBb);
    setTurnStreetNetBb(next.turnStreetNetBb);
    setTurnFacingAmountBb(next.turnFacingAmountBb);
    setTurnAmountChips(next.turnAmountChips);
    setRiverAction(next.riverAction);
    setRiverAmountBb(next.riverAmountBb);
    setRiverStreetNetBb(next.riverStreetNetBb);
    setRiverFacingAmountBb(next.riverFacingAmountBb);
    setRiverAmountChips(next.riverAmountChips);
    setNetBb(next.netBb);
    setNetChips(next.netChips);
  };

  const getCurrentState = () => ({
    preflopAction,
    preflopAmountBb,
    preflopStreetNetBb,
    preflopFacingAmountBb,
    preflopAmountChips,
    flopAction,
    flopAmountBb,
    flopStreetNetBb,
    flopFacingAmountBb,
    flopAmountChips,
    turnAction,
    turnAmountBb,
    turnStreetNetBb,
    turnFacingAmountBb,
    turnAmountChips,
    riverAction,
    riverAmountBb,
    riverStreetNetBb,
    riverFacingAmountBb,
    riverAmountChips,
    netBb,
    netChips,
  });

  const hasDidReachFlopSignal = (state = getCurrentState()) =>
    noFlop ||
    boardCards.length > 0 ||
    state.flopAction !== 'none' ||
    state.turnAction !== 'none' ||
    state.riverAction !== 'none';

  const buildSnapshot = (overrides = {}) =>
    buildNormalizeSnapshot({
      heroCard1,
      heroCard2,
      heroPosition,
      didReachFlop: !noFlop,
      didReachFlopFilled: hasDidReachFlopSignal(),
      flop1,
      flop2,
      flop3,
      turn,
      river,
      ...getCurrentState(),
      ...overrides,
    });

  const applySnapshotToForm = (snapshot) => {
    setHeroCard1(snapshot.heroCard1 || '');
    setHeroCard2(snapshot.heroCard2 || '');
    setHeroPosition(snapshot.heroPosition || '');
    setNoFlop(!snapshot.didReachFlop);
    setFlop1(snapshot.didReachFlop ? snapshot.flop1 || '' : '');
    setFlop2(snapshot.didReachFlop ? snapshot.flop2 || '' : '');
    setFlop3(snapshot.didReachFlop ? snapshot.flop3 || '' : '');
    setTurn(snapshot.didReachFlop ? snapshot.turn || '' : '');
    setRiver(snapshot.didReachFlop ? snapshot.river || '' : '');
    setFromMergedState({
      preflopAction: snapshot.preflopAction || 'none',
      preflopAmountBb: snapshot.preflopAmountBb || '',
      preflopStreetNetBb: snapshot.preflopStreetNetBb || '',
      preflopFacingAmountBb: snapshot.preflopFacingAmountBb || '',
      preflopAmountChips: snapshot.preflopAmountChips || '',
      flopAction: snapshot.flopAction || 'none',
      flopAmountBb: snapshot.flopAmountBb || '',
      flopStreetNetBb: snapshot.flopStreetNetBb || '',
      flopFacingAmountBb: snapshot.flopFacingAmountBb || '',
      flopAmountChips: snapshot.flopAmountChips || '',
      turnAction: snapshot.turnAction || 'none',
      turnAmountBb: snapshot.turnAmountBb || '',
      turnStreetNetBb: snapshot.turnStreetNetBb || '',
      turnFacingAmountBb: snapshot.turnFacingAmountBb || '',
      turnAmountChips: snapshot.turnAmountChips || '',
      riverAction: snapshot.riverAction || 'none',
      riverAmountBb: snapshot.riverAmountBb || '',
      riverStreetNetBb: snapshot.riverStreetNetBb || '',
      riverFacingAmountBb: snapshot.riverFacingAmountBb || '',
      riverAmountChips: snapshot.riverAmountChips || '',
      netBb: snapshot.netBb || '',
      netChips: snapshot.netChips || '',
    });
  };

  const runManualParser = (fillOnlyMissing) => {
    const text = manualActionText.trim();
    if (!text) {
      setParsePreview({
        overall: 0,
        missingRequired: [],
        message: 'Enter manual action text first.',
      });
      return null;
    }

    const parsed = parseManualActionText(text, {
      boardCardsCount: boardCards.length,
      heroPosition,
    });
    const baseSnapshot = buildSnapshot();
    const { nextSnapshot } = applyParsedFieldsToForm(
      parsed.parsedFields,
      fillOnlyMissing,
      baseSnapshot
    );
    const merged = {
      preflopAction: nextSnapshot.preflopAction,
      preflopAmountBb: nextSnapshot.preflopAmountBb,
      preflopStreetNetBb: nextSnapshot.preflopStreetNetBb,
      preflopFacingAmountBb: nextSnapshot.preflopFacingAmountBb,
      preflopAmountChips: nextSnapshot.preflopAmountChips,
      flopAction: nextSnapshot.flopAction,
      flopAmountBb: nextSnapshot.flopAmountBb,
      flopStreetNetBb: nextSnapshot.flopStreetNetBb,
      flopFacingAmountBb: nextSnapshot.flopFacingAmountBb,
      flopAmountChips: nextSnapshot.flopAmountChips,
      turnAction: nextSnapshot.turnAction,
      turnAmountBb: nextSnapshot.turnAmountBb,
      turnStreetNetBb: nextSnapshot.turnStreetNetBb,
      turnFacingAmountBb: nextSnapshot.turnFacingAmountBb,
      turnAmountChips: nextSnapshot.turnAmountChips,
      riverAction: nextSnapshot.riverAction,
      riverAmountBb: nextSnapshot.riverAmountBb,
      riverStreetNetBb: nextSnapshot.riverStreetNetBb,
      riverFacingAmountBb: nextSnapshot.riverFacingAmountBb,
      riverAmountChips: nextSnapshot.riverAmountChips,
      netBb: nextSnapshot.netBb,
      netChips: nextSnapshot.netChips,
    };
    const inferredHeroPosition = nextSnapshot.heroPosition || '';

    setParsePreview({
      overall: parsed.confidence?.overall ?? 0,
      missingRequired: parsed.missingRequired || [],
      message:
        parsed.missingRequired?.length > 0
          ? 'Parser found partial info. Missing required fields are listed below.'
          : 'Parser populated fields successfully.',
    });
    return { parsed, merged, inferredHeroPosition };
  };

  const applyParsedFieldsToForm = (parsedFields, fillOnlyMissing = true, baseSnapshot = null) => {
    if (!parsedFields) return { conflicts: [] };
    const activeSnapshot = baseSnapshot || buildSnapshot();
    const { nextSnapshot, conflicts } = applyParsedFieldsToSnapshot(activeSnapshot, parsedFields, {
      fillOnlyMissing,
    });
    applySnapshotToForm(nextSnapshot);
    return { conflicts, nextSnapshot };
  };

  const requestAiProposal = async (manualParseResult) => {
    const signature = manualTextSignature(manualActionText);
    if (!signature) return null;

    if (aiProposal && aiProposalSignature === signature && aiStatus !== 'error') {
      return aiProposal;
    }

    setAiStatus('loading');
    setAiError('');
    try {
      const payload = {
        manualActionText: signature,
        context: {
          heroPosition: heroPosition || null,
          numPlayers: numberOrNull(numPlayers),
          boardCards,
          didReachFlop: !noFlop,
          heroCards: [heroCard1, heroCard2],
          stakes: {
            sb: numberOrNull(sbSize),
            bb: numberOrNull(bbSize),
          },
          currentFields: getCurrentState(),
        },
        deterministicParse: manualParseResult || null,
      };

      const proposal = await normalizeHandFromText(payload);
      setAiProposal(proposal);
      setAiProposalSignature(signature);
      setAiStatus('idle');
      setAiError('');
      return proposal;
    } catch (error) {
      setAiStatus('error');
      setAiProposal(null);
      setAiProposalSignature(signature);
      setAiConflicts([]);
      setAiError(error?.message || 'AI assistant failed to return suggestions.');
      return null;
    }
  };

  const applyAiProposalWithConflicts = (proposal, options = {}) => {
    if (!proposal?.parsedFields) return { conflicts: [] };
    const { conflicts } = applyParsedFieldsToForm(
      proposal.parsedFields,
      true,
      options.baseSnapshot || null
    );
    setAiConflicts(conflicts);
    setAiStatus(unresolvedConflictCount(conflicts) > 0 ? 'conflicts' : 'applied');
    setAiError('');
    return { conflicts };
  };

  const handleResolveAiConflict = (conflictId, resolution) => {
    const selectedConflict = aiConflicts.find((item) => item.id === conflictId);
    if (!selectedConflict) return;

    if (resolution === 'use_ai') {
      const snapshot = buildSnapshot();
      const nextSnapshot = applyConflictResolution(snapshot, selectedConflict, resolution);
      applySnapshotToForm(nextSnapshot);
    }

    setAiConflicts((prev) => {
      const next = prev.map((item) =>
        item.id === conflictId
          ? { ...item, resolution: resolution === 'keep' || resolution === 'use_ai' ? resolution : null }
          : item
      );
      const unresolved = unresolvedConflictCount(next);
      setAiStatus(unresolved > 0 ? 'conflicts' : 'applied');
      return next;
    });
  };

  const handlePlayersChange = (value) => {
    const next = Number(value);
    setNumPlayers(next);
    const validPositions = POSITIONS_BY_PLAYERS[next] || [];
    const stillValid = validPositions.some((p) => p.value === heroPosition);
    if (!stillValid) setHeroPosition('');
  };

  const handleParseManualText = async () => {
    if (manualParseInFlight) return;
    setManualParseInFlight(true);
    try {
      const parseResult = runManualParser(true);
      if (!parseResult?.parsed) return;

      if (shouldRequestAiFallback(parseResult.parsed)) {
        const proposal = await requestAiProposal(parseResult.parsed);
        if (!proposal) return;

        const baseSnapshot = buildSnapshot({
          ...(parseResult.merged || {}),
          heroPosition: parseResult.inferredHeroPosition || heroPosition,
        });
        const { conflicts } = applyAiProposalWithConflicts(proposal, { baseSnapshot });
        const unresolved = unresolvedConflictCount(conflicts);

        setParsePreview({
          overall:
            proposal.overallConfidence ??
            parseResult.parsed.confidence?.overall ??
            0,
          missingRequired: proposal.missingRequired || [],
          message:
            unresolved > 0
              ? `AI auto-filled missing fields and found ${unresolved} conflicting field${unresolved === 1 ? '' : 's'} that require confirmation below.`
              : 'AI auto-filled missing fields. Review and edit any field before saving.',
        });
        return;
      }

      setAiStatus('idle');
      setAiError('');
      setAiProposal(null);
      setAiProposalSignature('');
      setAiConflicts([]);
    } finally {
      setManualParseInFlight(false);
    }
  };

  const parseImportAndApply = ({ silent = false } = {}) => {
    const raw = importRawText.trim();
    if (!raw) {
      if (!silent) setImportError('Paste hand history text first.');
      return null;
    }

    try {
      const parsed = parseIgnitionHandHistory(raw);
      if (!parsed.actions || parsed.actions.length === 0) {
        if (!silent) {
          setImportError(
            'Could not find actions. Paste the full Ignition hand including the Hand Session table.'
          );
        }
        return null;
      }

      const me = (parsed.players || []).find((player) => player.isMe) || null;
      const inferredHeroPosition = normalizePosition(me?.position || '');
      const inferredPlayers = Array.isArray(parsed.players) ? parsed.players.length : null;
      const stakes = inferImportStakes(parsed, bbSize);
      const effectiveBb = stakes.bb || numberOrNull(bbSize);
      const importSummary = inferHeroStreetSummaryFromImport(
        parsed.actions || [],
        inferredHeroPosition || heroPosition,
        effectiveBb
      );
      const timeline = mapImportTimeline(parsed.actions || [], inferredHeroPosition || heroPosition);
      const boardFromImport = (parsed.communityCards || []).map((card) => normalizeCard(card)).filter(Boolean);
      const hasImportedBoardCards = boardFromImport.length > 0;
      const expectedBoardCards = Math.max(
        boardFromImport.length,
        expectedBoardCardsFromTimeline(timeline)
      );
      const reachedStreet = streetLabelForBoardCount(expectedBoardCards);
      const heroCardsFromImport = (me?.cards || []).map((card) => normalizeCard(card)).filter(Boolean);
      const netChipsValue = inferImportNetChips(parsed, inferredHeroPosition || heroPosition);
      const netBbValue = netChipsValue != null && effectiveBb != null ? netChipsValue / effectiveBb : null;

      if (inferredPlayers) setNumPlayers(inferredPlayers);
      if (inferredHeroPosition) setHeroPosition(inferredHeroPosition);
      if (stakes.sb != null) setSbSize(String(stakes.sb));
      if (stakes.bb != null) setBbSize(String(stakes.bb));

      setPreflopAction(importSummary.preflop.action);
      setPreflopAmountBb(importSummary.preflop.amountBb != null ? String(importSummary.preflop.amountBb) : '');
      setPreflopStreetNetBb('');
      setPreflopFacingAmountBb(importSummary.preflop.facingAmountBb != null ? String(importSummary.preflop.facingAmountBb) : '');
      setPreflopAmountChips(importSummary.preflop.amountChips != null ? String(importSummary.preflop.amountChips) : '');
      setFlopAction(importSummary.flop.action);
      setFlopAmountBb(importSummary.flop.amountBb != null ? String(importSummary.flop.amountBb) : '');
      setFlopStreetNetBb('');
      setFlopFacingAmountBb(importSummary.flop.facingAmountBb != null ? String(importSummary.flop.facingAmountBb) : '');
      setFlopAmountChips(importSummary.flop.amountChips != null ? String(importSummary.flop.amountChips) : '');
      setTurnAction(importSummary.turn.action);
      setTurnAmountBb(importSummary.turn.amountBb != null ? String(importSummary.turn.amountBb) : '');
      setTurnStreetNetBb('');
      setTurnFacingAmountBb(importSummary.turn.facingAmountBb != null ? String(importSummary.turn.facingAmountBb) : '');
      setTurnAmountChips(importSummary.turn.amountChips != null ? String(importSummary.turn.amountChips) : '');
      setRiverAction(importSummary.river.action);
      setRiverAmountBb(importSummary.river.amountBb != null ? String(importSummary.river.amountBb) : '');
      setRiverStreetNetBb('');
      setRiverFacingAmountBb(importSummary.river.facingAmountBb != null ? String(importSummary.river.facingAmountBb) : '');
      setRiverAmountChips(importSummary.river.amountChips != null ? String(importSummary.river.amountChips) : '');

      if (netChipsValue != null) {
        setNetChips(String(netChipsValue));
      }
      if (netBbValue != null) {
        setNetBb(String(netBbValue));
      }

      if (hasImportedBoardCards) {
        setNoFlop(false);
        setFlop1(boardFromImport[0] || '');
        setFlop2(boardFromImport[1] || '');
        setFlop3(boardFromImport[2] || '');
        setTurn(boardFromImport[3] || '');
        setRiver(boardFromImport[4] || '');
      } else if (expectedBoardCards === 0 && boardCards.length === 0) {
        setNoFlop(true);
      } else if (expectedBoardCards >= 3) {
        setNoFlop(false);
      }

      if (heroCardsFromImport.length >= 2) {
        setHeroCard1(heroCardsFromImport[0]);
        setHeroCard2(heroCardsFromImport[1]);
      }

      const nextImport = {
        parsed,
        timeline,
        importedAt: Date.now(),
        inferred: {
          heroPosition: inferredHeroPosition || null,
          numPlayers: inferredPlayers,
          sb: stakes.sb,
          bb: effectiveBb,
          didReachFlop: expectedBoardCards >= 3,
          expectedBoardCards,
          reachedStreet,
        },
        prefill: {
          preflopAction: importSummary.preflop.action,
          preflopAmountBb: importSummary.preflop.amountBb != null ? String(importSummary.preflop.amountBb) : '',
          preflopStreetNetBb: '',
          preflopFacingAmountBb: importSummary.preflop.facingAmountBb != null ? String(importSummary.preflop.facingAmountBb) : '',
          preflopAmountChips: importSummary.preflop.amountChips != null ? String(importSummary.preflop.amountChips) : '',
          flopAction: importSummary.flop.action,
          flopAmountBb: importSummary.flop.amountBb != null ? String(importSummary.flop.amountBb) : '',
          flopStreetNetBb: '',
          flopFacingAmountBb: importSummary.flop.facingAmountBb != null ? String(importSummary.flop.facingAmountBb) : '',
          flopAmountChips: importSummary.flop.amountChips != null ? String(importSummary.flop.amountChips) : '',
          turnAction: importSummary.turn.action,
          turnAmountBb: importSummary.turn.amountBb != null ? String(importSummary.turn.amountBb) : '',
          turnStreetNetBb: '',
          turnFacingAmountBb: importSummary.turn.facingAmountBb != null ? String(importSummary.turn.facingAmountBb) : '',
          turnAmountChips: importSummary.turn.amountChips != null ? String(importSummary.turn.amountChips) : '',
          riverAction: importSummary.river.action,
          riverAmountBb: importSummary.river.amountBb != null ? String(importSummary.river.amountBb) : '',
          riverStreetNetBb: '',
          riverFacingAmountBb: importSummary.river.facingAmountBb != null ? String(importSummary.river.facingAmountBb) : '',
          riverAmountChips: importSummary.river.amountChips != null ? String(importSummary.river.amountChips) : '',
          netBb: netBbValue != null ? String(netBbValue) : '',
          netChips: netChipsValue != null ? String(netChipsValue) : '',
        },
      };

      setParsedImport(nextImport);
      setParsedImportSnapshot(raw);
      setImportError('');
      setImportPreview({
        handId: parsed.handId || null,
        tableName: parsed.tableName || null,
        actionCount: parsed.actions.length,
        heroPosition: inferredHeroPosition || null,
        numPlayers: inferredPlayers,
        winLoss: netChipsValue,
        reachedStreet,
        expectedBoardCards,
      });
      setAiStatus('idle');
      setAiError('');
      setAiProposal(null);
      setAiProposalSignature('');
      setAiConflicts([]);
      return nextImport;
    } catch (error) {
      if (!silent) setImportError('Parse error: ' + (error.message || String(error)));
      return null;
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormErrors({});
    setImportError('');

    const unresolvedCount = unresolvedConflictCount(aiConflicts);
    if (unresolvedCount > 0) {
      setFormErrors({
        aiConflicts: `Resolve ${unresolvedCount} AI conflict${unresolvedCount === 1 ? '' : 's'} before saving.`,
      });
      return;
    }

    const rawImport = importRawText.trim();
    let activeImport = null;
    let importParsedNow = false;
    if (isImportMode && rawImport) {
      const isCurrent = parsedImport && parsedImportSnapshot === rawImport;
      if (isCurrent) {
        activeImport = parsedImport;
      } else {
        activeImport = parseImportAndApply({ silent: true });
        importParsedNow = Boolean(activeImport);
      }
      if (!activeImport) {
        setFormErrors({
          import: 'Import text exists but could not be parsed. Fix it or clear import text before saving.',
        });
        setImportError('Import parse failed. Please review the pasted text.');
        return;
      }
    }

    let mergedState = getCurrentState();
    let effectiveHeroPosition = heroPosition;
    let effectiveNumPlayers = numPlayers;
    let effectiveSbSize = sbSize;
    let effectiveBbSize = bbSize;
    let effectiveBoardCards = boardCards;
    let effectiveDidReachFlop = !noFlop;

    if (importParsedNow && activeImport?.prefill) {
      mergedState = activeImport.prefill;
      if (activeImport?.inferred?.heroPosition) effectiveHeroPosition = activeImport.inferred.heroPosition;
      if (activeImport?.inferred?.numPlayers) effectiveNumPlayers = activeImport.inferred.numPlayers;
      if (activeImport?.inferred?.sb != null) effectiveSbSize = String(activeImport.inferred.sb);
      if (activeImport?.inferred?.bb != null) effectiveBbSize = String(activeImport.inferred.bb);
      const importedBoard = (activeImport?.parsed?.communityCards || [])
        .map((card) => normalizeCard(card))
        .filter(Boolean);
      if (importedBoard.length > 0) {
        effectiveBoardCards = importedBoard;
      }
      const expectedBoardCards = Number(activeImport?.inferred?.expectedBoardCards ?? -1);
      if (expectedBoardCards === 0) {
        effectiveDidReachFlop = false;
      } else if (expectedBoardCards >= 3) {
        effectiveDidReachFlop = true;
      } else {
        effectiveDidReachFlop = Boolean(
          activeImport?.inferred?.didReachFlop || effectiveBoardCards.length >= 3
        );
      }
    }

    if (activeImport?.inferred) {
      const expectedBoardCards = Number(activeImport.inferred.expectedBoardCards ?? 0);
      const actualBoardCards = effectiveDidReachFlop ? effectiveBoardCards.length : 0;
      const isMismatch =
        expectedBoardCards === 0
          ? effectiveDidReachFlop || actualBoardCards > 0
          : !effectiveDidReachFlop || actualBoardCards !== expectedBoardCards;

      if (isMismatch) {
        const message = importBoardRequirementMessage(expectedBoardCards);
        setImportError(message);
        setFormErrors({ importBoard: message });
        return;
      }
    }

    let manualParseResult = null;
    if (manualActionText.trim()) {
      manualParseResult = runManualParser(true);
      if (manualParseResult?.merged) {
        mergedState = manualParseResult.merged;
      }
      if (manualParseResult?.inferredHeroPosition) {
        effectiveHeroPosition = manualParseResult.inferredHeroPosition;
      }
    }

    const draft = createEmptyHandDraft();
    draft.source.mode = activeImport ? 'ignition_import' : 'manual';
    draft.source.parserName = activeImport ? 'ignition' : null;
    draft.source.parserVersion = activeImport ? 'v1' : null;
    draft.source.importedAt = activeImport ? activeImport.importedAt : null;
    draft.source.rawText = activeImport ? rawImport : null;
    draft.hero.cards = [heroCard1, heroCard2];
    draft.hero.position = effectiveHeroPosition;
    draft.table.numPlayers = effectiveNumPlayers;
    draft.table.gameType = activeImport?.parsed?.gameType || null;
    draft.table.playMode = activeImport?.parsed?.playMode || null;
    draft.table.tableName = activeImport?.parsed?.tableName || null;
    draft.table.stakes.sb = numberOrNull(effectiveSbSize);
    draft.table.stakes.bb = numberOrNull(effectiveBbSize);
    draft.table.stackDepthBb.hero = numberOrNull(heroStackDepthBb);
    draft.table.stackDepthBb.villain = numberOrNull(villainStackDepthBb);
    draft.board.didReachFlop = effectiveDidReachFlop;
    draft.board.cards = effectiveBoardCards;
    const resolveStreetBetBb = (street) =>
      numberOrNull(mergedState[`${street}AmountBb`]) ??
      numberOrNull(mergedState[`${street}FacingAmountBb`]);
    draft.heroStreetSummary.preflop = {
      action: mergedState.preflopAction,
      amountBb: resolveStreetBetBb('preflop'),
      streetNetBb: numberOrNull(mergedState.preflopStreetNetBb),
      facingAmountBb: resolveStreetBetBb('preflop'),
      amountChips: null,
      source: activeImport ? 'imported' : 'manual',
    };
    draft.heroStreetSummary.flop = {
      action: mergedState.flopAction,
      amountBb: resolveStreetBetBb('flop'),
      streetNetBb: numberOrNull(mergedState.flopStreetNetBb),
      facingAmountBb: resolveStreetBetBb('flop'),
      amountChips: null,
      source: activeImport ? 'imported' : 'manual',
    };
    draft.heroStreetSummary.turn = {
      action: mergedState.turnAction,
      amountBb: resolveStreetBetBb('turn'),
      streetNetBb: numberOrNull(mergedState.turnStreetNetBb),
      facingAmountBb: resolveStreetBetBb('turn'),
      amountChips: null,
      source: activeImport ? 'imported' : 'manual',
    };
    draft.heroStreetSummary.river = {
      action: mergedState.riverAction,
      amountBb: resolveStreetBetBb('river'),
      streetNetBb: numberOrNull(mergedState.riverStreetNetBb),
      facingAmountBb: resolveStreetBetBb('river'),
      amountChips: null,
      source: activeImport ? 'imported' : 'manual',
    };
    draft.result.netBb = numberOrNull(mergedState.netBb);
    draft.result.netChips = null;
    draft.timeline = activeImport
      ? { actions: activeImport.timeline || [] }
      : null;
    draft.opponents.players = activeImport?.parsed?.players || null;
    draft.opponents.knownCardsText = knownCardsText.trim() || null;
    draft.notes = notes.trim() || null;
    draft.manualActionText = manualActionText.trim() || null;
    draft.provenance = {
      sourceMode: activeImport ? 'imported' : 'manual',
      manualActionText: manualActionText.trim() ? 'manual' : 'manual',
    };

    const assumptionNotes = [];
    if (manualParseResult?.parsed?.evidenceSnippets) {
      for (const [field, note] of Object.entries(manualParseResult.parsed.evidenceSnippets)) {
        if (!/assumed/i.test(String(note || ''))) continue;
        assumptionNotes.push(`${field}: ${String(note)}`);
      }
    }

    if (draft.result.netBb == null) {
      const estimate = estimateNetBbFromSummary(draft.heroStreetSummary, effectiveHeroPosition);
      if (estimate.estimatedNetBb != null) {
        draft.result.netBb = estimate.estimatedNetBb;
        assumptionNotes.push(...estimate.assumptions);
      }
    }
    const bbForChipDerive = numberOrNull(effectiveBbSize);
    if (draft.result.netBb != null && bbForChipDerive != null && bbForChipDerive > 0) {
      draft.result.netChips = Number((draft.result.netBb * bbForChipDerive).toFixed(4));
    }

    const netConsistency = evaluateFoldNetConsistency(
      draft.heroStreetSummary,
      effectiveHeroPosition,
      draft.result.netBb
    );
    if (netConsistency?.assumptions?.length) {
      assumptionNotes.push(...netConsistency.assumptions);
    }
    if (netConsistency && netConsistency.mismatchBb > 0.75) {
      setFormErrors({
        netBb:
          `Deterministic check failed: net BB (${draft.result.netBb}) does not match fold-loss total ` +
          `from street amounts (${netConsistency.expectedNetBb}). Update street amounts or net BB.`,
      });
      return;
    }

    const assumptionSet = [...new Set(assumptionNotes.filter(Boolean))];
    if (assumptionSet.length > 0) {
      const assumptionMessage = [
        'I made assumptions for missing fields:',
        ...assumptionSet.map((line) => `- ${line}`),
        '',
        'Click OK to save this hand with these assumptions, or Cancel to edit first.',
      ].join('\n');
      const accepted = window.confirm(assumptionMessage);
      if (!accepted) {
        setFormErrors({
          assumptions: 'Save canceled. Review the assumed fields and try again.',
        });
        return;
      }
    }

    const validation = validateHandDraft(draft, { requireBb: false });
    const currentManualSignature = manualTextSignature(manualActionText);
    const shouldTryAiFallback =
      !activeImport &&
      Boolean(currentManualSignature) &&
      Boolean(manualParseResult?.parsed) &&
      shouldRequestAiFallback(manualParseResult.parsed);
    const hasCurrentAiProposal =
      Boolean(currentManualSignature) &&
      aiProposalSignature === currentManualSignature &&
      Boolean(aiProposal);

    if (!validation.isValid && shouldTryAiFallback && !hasCurrentAiProposal) {
      const proposal = await requestAiProposal(manualParseResult.parsed);
      let unresolved = 0;
      if (proposal) {
        const baseSnapshot = buildSnapshot({
          ...mergedState,
          heroPosition: effectiveHeroPosition,
          didReachFlop: effectiveDidReachFlop,
          didReachFlopFilled: true,
        });
        const { conflicts } = applyAiProposalWithConflicts(proposal, { baseSnapshot });
        unresolved = unresolvedConflictCount(conflicts);
        setParsePreview({
          overall: proposal.overallConfidence ?? parsePreview?.overall ?? 0,
          missingRequired: proposal.missingRequired || [],
          message:
            unresolved > 0
              ? `AI found ${unresolved} conflict${unresolved === 1 ? '' : 's'}. Resolve them below before saving.`
              : 'AI auto-filled missing fields. Review and save again.',
        });
      }
      setFormErrors({
        ...validation.errors,
        aiReview: proposal
          ? unresolved > 0
            ? 'AI conflicts were detected. Resolve them before saving.'
            : 'AI suggestions were auto-applied to missing fields. Review and save again.'
          : 'AI suggestions could not be loaded. Fill required fields manually and try saving again.',
      });
      return;
    }

    if (!validation.isValid) {
      setFormErrors(validation.errors);
      return;
    }

    try {
      const hand = buildHandRecordV2(draft, { requireBb: false });
      const hands = getHands();
      hands.push(hand);
      saveHands(hands);
      onHandsChange?.();
      onHandSelectionReset?.();

      setHeroPosition('');
      setSbSize('');
      setBbSize('');
      setHeroStackDepthBb('');
      setVillainStackDepthBb('');
      setPreflopAction('none');
      setPreflopAmountBb('');
      setPreflopStreetNetBb('');
      setPreflopFacingAmountBb('');
      setPreflopAmountChips('');
      setFlopAction('none');
      setFlopAmountBb('');
      setFlopStreetNetBb('');
      setFlopFacingAmountBb('');
      setFlopAmountChips('');
      setTurnAction('none');
      setTurnAmountBb('');
      setTurnStreetNetBb('');
      setTurnFacingAmountBb('');
      setTurnAmountChips('');
      setRiverAction('none');
      setRiverAmountBb('');
      setRiverStreetNetBb('');
      setRiverFacingAmountBb('');
      setRiverAmountChips('');
      setNetBb('');
      setNetChips('');
      setKnownCardsText('');
      setEntryMode('manual');
      setManualActionText('');
      setNotes('');
      setParsePreview(null);
      setImportRawText('');
      setImportPreview(null);
      setParsedImport(null);
      setParsedImportSnapshot('');
      setImportError('');
      setAiStatus('idle');
      setAiError('');
      setAiProposal(null);
      setAiProposalSignature('');
      setAiConflicts([]);
      setManualParseInFlight(false);
    } catch (error) {
      setFormErrors(error?.validation?.errors || { form: error.message || 'Unable to save hand.' });
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white';

  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8">
      <h2 className="text-lg font-medium text-slate-700 mb-4">Hand capture</h2>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <label className="text-sm font-medium text-slate-700">Hand input</label>
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
              <button
                type="button"
                onClick={() => setEntryMode('manual')}
                className={
                  'px-3 py-1.5 rounded-md text-xs font-medium transition ' +
                  (!isImportMode ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                Manual text
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('ignition')}
                className={
                  'px-3 py-1.5 rounded-md text-xs font-medium transition ' +
                  (isImportMode ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                Ignition import
              </button>
            </div>
          </div>

          {!isImportMode ? (
            <>
              <p className="text-xs text-slate-500 mb-2">
                Describe the hand in plain text, then parse to auto-fill fields below.
              </p>
              <textarea
                value={manualActionText}
                onChange={(e) => setManualActionText(e.target.value)}
                rows={4}
                className={inputClass + ' resize-y'}
                placeholder="Example: Preflop I raised to 3bb, c-bet flop 4bb, checked turn, folded river, lost 18bb."
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleParseManualText}
                  disabled={manualParseInFlight}
                  className={
                    'px-3 py-2 rounded-lg text-sm font-medium transition ' +
                    (manualParseInFlight
                      ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300')
                  }
                >
                  {manualParseInFlight ? 'Parsing...' : 'Parse & preview text'}
                </button>
                {parsePreview && (
                  <span className="text-xs text-slate-500">
                    Confidence: {(parsePreview.overall * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              {manualParseInFlight && (
                <p className="text-xs text-slate-600 mt-1">
                  Parsing your hand now. AI fallback can take a few seconds.
                </p>
              )}
              {parsePreview?.message && (
                <p className="text-xs text-slate-500 mt-1">{parsePreview.message}</p>
              )}
              {parsePreview?.missingRequired?.length > 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  Missing from text: {parsePreview.missingRequired.join(', ')}
                </p>
              )}
              {aiStatus === 'loading' && (
                <p className="text-xs text-emerald-700 mt-1">
                  AI is still working on missing details...
                </p>
              )}
              {aiError && (
                <p className="text-xs text-red-600 mt-1">{aiError}</p>
              )}
              {aiProposal && aiStatus !== 'loading' && (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-xs font-medium text-emerald-800">AI normalization complete</p>
                  <p className="text-xs text-emerald-700 mt-1">
                    Missing fields were auto-filled when possible. Resolve conflicts below before saving.
                  </p>
                  {aiProposal?.meta?.model && (
                    <p className="text-[11px] text-emerald-700 mt-1">
                      Model: {aiProposal.meta.model}
                      {aiProposal?.meta?.fallbackUsed ? ' (fallback mode)' : ''}
                    </p>
                  )}
                  {summarizeAiProposal(aiProposal).length > 0 && (
                    <ul className="mt-1 text-xs text-emerald-800 list-disc list-inside">
                      {summarizeAiProposal(aiProposal).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {aiConflicts.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-medium text-amber-900">
                    Resolve AI conflicts ({unresolvedConflictCount(aiConflicts)} unresolved)
                  </p>
                  <div className="mt-2 space-y-2">
                    {aiConflicts.map((conflict) => (
                      <div key={conflict.id} className="rounded-md border border-amber-200 bg-white px-2 py-2">
                        <p className="text-xs font-medium text-slate-700">{conflict.label}</p>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Current: {formatConflictValue(conflict.type, conflict.currentValue)}
                        </p>
                        <p className="text-xs text-slate-600">
                          AI: {formatConflictValue(conflict.type, conflict.suggestedValue)}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleResolveAiConflict(conflict.id, 'keep')}
                            className={
                              'px-2 py-1 rounded text-xs font-medium transition ' +
                              (conflict.resolution === 'keep'
                                ? 'bg-slate-700 text-white'
                                : 'bg-slate-200 text-slate-700 hover:bg-slate-300')
                            }
                          >
                            Keep mine
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResolveAiConflict(conflict.id, 'use_ai')}
                            className={
                              'px-2 py-1 rounded text-xs font-medium transition ' +
                              (conflict.resolution === 'use_ai'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200')
                            }
                          >
                            Use AI value
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {aiStatus === 'applied' && aiConflicts.length === 0 && (
                <p className="text-xs text-emerald-700 mt-1">
                  AI suggestions were applied to missing fields. You can still edit fields before saving.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-2">
                Paste full hand history text, then parse to auto-fill this same form. Save still uses the single button below.
              </p>
              <textarea
                value={importRawText}
                onChange={(e) => setImportRawText(e.target.value)}
                rows={5}
                className={inputClass + ' resize-y font-mono'}
                placeholder="Paste Ignition hand history here..."
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => parseImportAndApply({ silent: false })}
                  className="px-3 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300 transition"
                >
                  Parse & preview import
                </button>
                {importPreview && (
                  <span className="text-xs text-slate-500">
                    {importPreview.actionCount} actions parsed
                  </span>
                )}
              </div>
              {importPreview && (
                <p className="text-xs text-slate-500 mt-1">
                  {importPreview.tableName ? `Table: ${importPreview.tableName}. ` : ''}
                  {importPreview.handId ? `Hand #${importPreview.handId}. ` : ''}
                  {importPreview.heroPosition ? `Hero: ${importPreview.heroPosition}. ` : ''}
                  {importPreview.reachedStreet ? `Reached: ${importPreview.reachedStreet}. ` : ''}
                  {typeof importPreview.winLoss === 'number' ? `Win/Loss: ${importPreview.winLoss >= 0 ? '+' : ''}${importPreview.winLoss.toFixed(2)}.` : ''}
                </p>
              )}
              {importError && <p className="text-xs text-red-600 mt-1">{importError}</p>}
            </>
          )}
        </div>

        <CardPicker
          targetId={effectiveTargetId}
          selectedRank={cardPickerRank}
          onSelectRank={setCardPickerRank}
          onApplyCard={onApplyCard}
        />
        {cardPickerError && <p className="-mt-4 text-sm text-red-600">{cardPickerError}</p>}

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-medium text-slate-700 mb-2">Your hand (hero)</h3>
          <p className="text-slate-500 text-sm mb-3">
            Click a card then use the selector above, or pick rank/suit to fill the first empty slot.
          </p>
          <div className="flex gap-3">
            {[
              { id: 'hero-card1', label: 'Card 1', value: heroCard1 },
              { id: 'hero-card2', label: 'Card 2', value: heroCard2 },
            ].map((slot) => (
              <div key={slot.id} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => registerCardPickerTarget(slot.id)}
                  className={
                    'flex flex-col items-center gap-1 rounded-lg border-2 p-1 transition hover:border-emerald-400 focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 ' +
                    (effectiveTargetId === slot.id ? 'border-emerald-500 bg-emerald-50/50' : 'border-transparent')
                  }
                  aria-label={`Select ${slot.label}`}
                >
                  <CardLogo value={slot.value} />
                  <span className="text-xs text-slate-400">{slot.label}</span>
                </button>
                {slot.value && (
                  <button
                    type="button"
                    onClick={() => clearCardBySlotId(slot.id)}
                    className="text-xs text-slate-400 hover:text-red-600 transition"
                  >
                    Clear
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <HandDetailsForm
          noFlop={noFlop}
          setNoFlop={setNoFlop}
          flop1={flop1}
          flop2={flop2}
          flop3={flop3}
          turn={turn}
          river={river}
          registerCardPickerTarget={registerCardPickerTarget}
          clearCardBySlotId={clearCardBySlotId}
          activeCardTargetId={effectiveTargetId}
        />

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Table context</label>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <span className="mb-1 flex min-h-[2.5rem] items-end text-xs text-slate-500">Players at table</span>
              <select
                value={numPlayers}
                onChange={(e) => handlePlayersChange(e.target.value)}
                className={inputClass}
              >
                {PLAYER_COUNTS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="mb-1 flex min-h-[2.5rem] items-end text-xs text-slate-500">Big blind (optional)</span>
              <input
                type="number"
                step="0.01"
                value={bbSize}
                onChange={(e) => setBbSize(e.target.value)}
                className={inputClass}
                placeholder="e.g. 1"
              />
            </div>
            <div>
              <span className="mb-1 flex min-h-[2.5rem] items-end text-xs text-slate-500">Hero stack (BB, optional)</span>
              <input
                type="number"
                step="0.1"
                value={heroStackDepthBb}
                onChange={(e) => setHeroStackDepthBb(e.target.value)}
                className={inputClass}
                placeholder="e.g. 100"
              />
            </div>
            <div>
              <span className="mb-1 flex min-h-[2.5rem] items-end text-xs text-slate-500">Villain stack (BB, optional)</span>
              <input
                type="number"
                step="0.1"
                value={villainStackDepthBb}
                onChange={(e) => setVillainStackDepthBb(e.target.value)}
                className={inputClass}
                placeholder="e.g. 100"
              />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-sm text-slate-600">Hero position</span>
            <div className="flex flex-wrap gap-2 mt-2">
              {positions.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setHeroPosition(heroPosition === value ? '' : value)}
                  className={
                    'px-3 py-2 rounded-lg border text-sm font-medium transition ' +
                    (heroPosition === value
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100')
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-600">Hero decisions by street</label>
          <p className="text-xs text-slate-500">
            Street bet size is the max BB size relevant to your decision. Street result is your win/loss on that street (useful when a fold ends the action).
          </p>
          <StreetDecisionRow
            street="preflop"
            label="Preflop (required)"
            action={preflopAction}
            streetBetBb={preflopAmountBb}
            streetResultBb={preflopStreetNetBb}
            setAction={setPreflopAction}
            setStreetBetBb={(value) => {
              setPreflopAmountBb(value);
              setPreflopFacingAmountBb(value);
            }}
            setStreetResultBb={setPreflopStreetNetBb}
          />
          {showFlop && (
            <StreetDecisionRow
              street="flop"
              label="Flop"
              action={flopAction}
              streetBetBb={flopAmountBb}
              streetResultBb={flopStreetNetBb}
              setAction={setFlopAction}
              setStreetBetBb={(value) => {
                setFlopAmountBb(value);
                setFlopFacingAmountBb(value);
              }}
              setStreetResultBb={setFlopStreetNetBb}
            />
          )}
          {showTurn && (
            <StreetDecisionRow
              street="turn"
              label="Turn"
              action={turnAction}
              streetBetBb={turnAmountBb}
              streetResultBb={turnStreetNetBb}
              setAction={setTurnAction}
              setStreetBetBb={(value) => {
                setTurnAmountBb(value);
                setTurnFacingAmountBb(value);
              }}
              setStreetResultBb={setTurnStreetNetBb}
            />
          )}
          {showRiver && (
            <StreetDecisionRow
              street="river"
              label="River"
              action={riverAction}
              streetBetBb={riverAmountBb}
              streetResultBb={riverStreetNetBb}
              setAction={setRiverAction}
              setStreetBetBb={(value) => {
                setRiverAmountBb(value);
                setRiverFacingAmountBb(value);
              }}
              setStreetResultBb={setRiverStreetNetBb}
            />
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-1">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Net result (BB, required)</label>
            <input
              type="number"
              step="0.1"
              value={netBb}
              onChange={(e) => setNetBb(e.target.value)}
              className={inputClass}
              placeholder="e.g. -18 or 12.5"
            />
            <p className="mt-1 text-xs text-slate-500">
              Dollar result is derived automatically from net BB when Big blind size is provided.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Opponent cards / showdown (optional)</label>
          <input
            type="text"
            value={knownCardsText}
            onChange={(e) => setKnownCardsText(e.target.value)}
            className={inputClass}
            placeholder="e.g. Villain showed Ac Kc"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={inputClass + ' resize-y'}
          />
        </div>

        {Object.keys(formErrors).length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-sm font-medium text-red-700">Please fix the following:</p>
            <ul className="mt-1 text-xs text-red-700 list-disc list-inside">
              {Object.entries(formErrors).map(([key, value]) => (
                <li key={key}>
                  {formatFieldKey(key)}: {String(value)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-emerald-600 text-white font-medium py-2.5 rounded-lg hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition"
        >
          Save hand
        </button>
      </form>
    </section>
  );
}
