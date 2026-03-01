import { useMemo, useState } from 'react';
import { getHands, saveHands } from '../lib/storage.js';
import { normalizeCard } from '../lib/cards.js';
import { PLAYER_COUNTS, POSITIONS_BY_PLAYERS } from '../lib/positions.js';
import { buildHandRecordV2, createEmptyHandDraft } from '../lib/handSchema.js';
import { parseManualActionText } from '../lib/manualActionParser.js';
import { parseIgnitionHandHistory } from '../lib/ignitionParser.js';
import { CardLogo } from './CardLogo.jsx';

const ACTION_OPTIONS = [
  { value: 'none', label: 'Select action' },
  { value: 'fold', label: 'Fold' },
  { value: 'check', label: 'Check' },
  { value: 'call', label: 'Call' },
  { value: 'bet', label: 'Bet' },
  { value: 'raise', label: 'Raise' },
  { value: 'all_in', label: 'All-in' },
];

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  return {
    action: actionType,
    amountBb: bb && amountChips != null ? amountChips / bb : null,
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

function mergeParsedIntoState(current, parsed, fillOnlyMissing) {
  if (!parsed) return current;

  const next = { ...current };
  const parsedSummary = parsed.parsedFields?.heroStreetSummary || {};

  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    const parsedDecision = parsedSummary[street];
    if (!parsedDecision || parsedDecision.action === 'none') continue;

    const actionKey = `${street}Action`;
    const bbKey = `${street}AmountBb`;
    const chipsKey = `${street}AmountChips`;
    const shouldSetAction = !fillOnlyMissing || next[actionKey] === 'none';
    if (shouldSetAction) next[actionKey] = parsedDecision.action;

    if (parsedDecision.amountBb != null) {
      const shouldSetAmountBb = !fillOnlyMissing || next[bbKey] === '';
      if (shouldSetAmountBb) next[bbKey] = String(parsedDecision.amountBb);
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
  amountBb,
  amountChips,
  setAction,
  setAmountBb,
  setAmountChips,
}) {
  const inputClass =
    'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white';

  return (
    <div className="grid gap-2 md:grid-cols-[170px,1fr,130px,130px] items-center">
      <label className="text-sm font-medium text-slate-700">{label}</label>
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
        value={amountBb}
        onChange={(e) => setAmountBb(e.target.value)}
        className={inputClass}
        placeholder="BB size"
      />
      <input
        type="number"
        step="0.01"
        value={amountChips}
        onChange={(e) => setAmountChips(e.target.value)}
        className={inputClass}
        placeholder="$ amount"
      />
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
}) {
  const [numPlayers, setNumPlayers] = useState(8);
  const [heroPosition, setHeroPosition] = useState('');
  const [sbSize, setSbSize] = useState('');
  const [bbSize, setBbSize] = useState('');

  const [preflopAction, setPreflopAction] = useState('none');
  const [preflopAmountBb, setPreflopAmountBb] = useState('');
  const [preflopAmountChips, setPreflopAmountChips] = useState('');
  const [flopAction, setFlopAction] = useState('none');
  const [flopAmountBb, setFlopAmountBb] = useState('');
  const [flopAmountChips, setFlopAmountChips] = useState('');
  const [turnAction, setTurnAction] = useState('none');
  const [turnAmountBb, setTurnAmountBb] = useState('');
  const [turnAmountChips, setTurnAmountChips] = useState('');
  const [riverAction, setRiverAction] = useState('none');
  const [riverAmountBb, setRiverAmountBb] = useState('');
  const [riverAmountChips, setRiverAmountChips] = useState('');

  const [netBb, setNetBb] = useState('');
  const [netChips, setNetChips] = useState('');
  const [knownCardsText, setKnownCardsText] = useState('');
  const [manualActionText, setManualActionText] = useState('');
  const [notes, setNotes] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [parsePreview, setParsePreview] = useState(null);
  const [importRawText, setImportRawText] = useState('');
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [parsedImport, setParsedImport] = useState(null);
  const [parsedImportSnapshot, setParsedImportSnapshot] = useState('');

  const positions = POSITIONS_BY_PLAYERS[numPlayers] || [];
  const boardCards = useMemo(() => {
    if (noFlop) return [];
    return [flop1, flop2, flop3, turn, river].map((c) => normalizeCard(c)).filter(Boolean);
  }, [noFlop, flop1, flop2, flop3, turn, river]);

  const showFlop = !noFlop;
  const showTurn = !noFlop && boardCards.length >= 4;
  const showRiver = !noFlop && boardCards.length >= 5;

  const setFromMergedState = (next) => {
    setPreflopAction(next.preflopAction);
    setPreflopAmountBb(next.preflopAmountBb);
    setPreflopAmountChips(next.preflopAmountChips);
    setFlopAction(next.flopAction);
    setFlopAmountBb(next.flopAmountBb);
    setFlopAmountChips(next.flopAmountChips);
    setTurnAction(next.turnAction);
    setTurnAmountBb(next.turnAmountBb);
    setTurnAmountChips(next.turnAmountChips);
    setRiverAction(next.riverAction);
    setRiverAmountBb(next.riverAmountBb);
    setRiverAmountChips(next.riverAmountChips);
    setNetBb(next.netBb);
    setNetChips(next.netChips);
  };

  const getCurrentState = () => ({
    preflopAction,
    preflopAmountBb,
    preflopAmountChips,
    flopAction,
    flopAmountBb,
    flopAmountChips,
    turnAction,
    turnAmountBb,
    turnAmountChips,
    riverAction,
    riverAmountBb,
    riverAmountChips,
    netBb,
    netChips,
  });

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
    const inferredHeroPosition =
      String(parsed.parsedFields?.hero?.position || parsed.metadata?.heroPosition || '').trim();

    if (inferredHeroPosition) {
      const shouldSetHeroPosition = !fillOnlyMissing || !heroPosition;
      if (shouldSetHeroPosition) {
        setHeroPosition(inferredHeroPosition);
      }
    }

    const merged = mergeParsedIntoState(getCurrentState(), parsed, fillOnlyMissing);
    setFromMergedState(merged);
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

  const handlePlayersChange = (value) => {
    const next = Number(value);
    setNumPlayers(next);
    const validPositions = POSITIONS_BY_PLAYERS[next] || [];
    const stillValid = validPositions.some((p) => p.value === heroPosition);
    if (!stillValid) setHeroPosition('');
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
      const didReachFlopFromTimeline = timeline.some(
        (row) => row.street === 'flop' || row.street === 'turn' || row.street === 'river'
      );
      const boardFromImport = (parsed.communityCards || []).map((card) => normalizeCard(card)).filter(Boolean);
      const heroCardsFromImport = (me?.cards || []).map((card) => normalizeCard(card)).filter(Boolean);
      const netChipsValue = inferImportNetChips(parsed, inferredHeroPosition || heroPosition);
      const netBbValue = netChipsValue != null && effectiveBb != null ? netChipsValue / effectiveBb : null;

      if (inferredPlayers) setNumPlayers(inferredPlayers);
      if (inferredHeroPosition) setHeroPosition(inferredHeroPosition);
      if (stakes.sb != null) setSbSize(String(stakes.sb));
      if (stakes.bb != null) setBbSize(String(stakes.bb));

      setPreflopAction(importSummary.preflop.action);
      setPreflopAmountBb(importSummary.preflop.amountBb != null ? String(importSummary.preflop.amountBb) : '');
      setPreflopAmountChips(importSummary.preflop.amountChips != null ? String(importSummary.preflop.amountChips) : '');
      setFlopAction(importSummary.flop.action);
      setFlopAmountBb(importSummary.flop.amountBb != null ? String(importSummary.flop.amountBb) : '');
      setFlopAmountChips(importSummary.flop.amountChips != null ? String(importSummary.flop.amountChips) : '');
      setTurnAction(importSummary.turn.action);
      setTurnAmountBb(importSummary.turn.amountBb != null ? String(importSummary.turn.amountBb) : '');
      setTurnAmountChips(importSummary.turn.amountChips != null ? String(importSummary.turn.amountChips) : '');
      setRiverAction(importSummary.river.action);
      setRiverAmountBb(importSummary.river.amountBb != null ? String(importSummary.river.amountBb) : '');
      setRiverAmountChips(importSummary.river.amountChips != null ? String(importSummary.river.amountChips) : '');

      if (netChipsValue != null) {
        setNetChips(String(netChipsValue));
      }
      if (netBbValue != null) {
        setNetBb(String(netBbValue));
      }

      setNoFlop(boardFromImport.length < 3 && !didReachFlopFromTimeline);
      setFlop1(boardFromImport[0] || '');
      setFlop2(boardFromImport[1] || '');
      setFlop3(boardFromImport[2] || '');
      setTurn(boardFromImport[3] || '');
      setRiver(boardFromImport[4] || '');

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
          didReachFlop: boardFromImport.length >= 3 || didReachFlopFromTimeline,
        },
        prefill: {
          preflopAction: importSummary.preflop.action,
          preflopAmountBb: importSummary.preflop.amountBb != null ? String(importSummary.preflop.amountBb) : '',
          preflopAmountChips: importSummary.preflop.amountChips != null ? String(importSummary.preflop.amountChips) : '',
          flopAction: importSummary.flop.action,
          flopAmountBb: importSummary.flop.amountBb != null ? String(importSummary.flop.amountBb) : '',
          flopAmountChips: importSummary.flop.amountChips != null ? String(importSummary.flop.amountChips) : '',
          turnAction: importSummary.turn.action,
          turnAmountBb: importSummary.turn.amountBb != null ? String(importSummary.turn.amountBb) : '',
          turnAmountChips: importSummary.turn.amountChips != null ? String(importSummary.turn.amountChips) : '',
          riverAction: importSummary.river.action,
          riverAmountBb: importSummary.river.amountBb != null ? String(importSummary.river.amountBb) : '',
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
      });
      return nextImport;
    } catch (error) {
      if (!silent) setImportError('Parse error: ' + (error.message || String(error)));
      return null;
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    setFormErrors({});
    setImportError('');

    const rawImport = importRawText.trim();
    let activeImport = null;
    let importParsedNow = false;
    if (rawImport) {
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
      effectiveBoardCards = importedBoard;
      effectiveDidReachFlop = Boolean(
        activeImport?.inferred?.didReachFlop || importedBoard.length >= 3
      );
    }

    if (manualActionText.trim()) {
      const parseResult = runManualParser(true);
      if (parseResult?.merged) {
        mergedState = parseResult.merged;
      }
      if (parseResult?.inferredHeroPosition) {
        effectiveHeroPosition = parseResult.inferredHeroPosition;
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
    draft.board.didReachFlop = effectiveDidReachFlop;
    draft.board.cards = effectiveBoardCards;
    draft.heroStreetSummary.preflop = {
      action: mergedState.preflopAction,
      amountBb: numberOrNull(mergedState.preflopAmountBb),
      amountChips: numberOrNull(mergedState.preflopAmountChips),
      source: activeImport ? 'imported' : 'manual',
    };
    draft.heroStreetSummary.flop = {
      action: mergedState.flopAction,
      amountBb: numberOrNull(mergedState.flopAmountBb),
      amountChips: numberOrNull(mergedState.flopAmountChips),
      source: activeImport ? 'imported' : 'manual',
    };
    draft.heroStreetSummary.turn = {
      action: mergedState.turnAction,
      amountBb: numberOrNull(mergedState.turnAmountBb),
      amountChips: numberOrNull(mergedState.turnAmountChips),
      source: activeImport ? 'imported' : 'manual',
    };
    draft.heroStreetSummary.river = {
      action: mergedState.riverAction,
      amountBb: numberOrNull(mergedState.riverAmountBb),
      amountChips: numberOrNull(mergedState.riverAmountChips),
      source: activeImport ? 'imported' : 'manual',
    };
    draft.result.netBb = numberOrNull(mergedState.netBb);
    draft.result.netChips = numberOrNull(mergedState.netChips);
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

    try {
      const hand = buildHandRecordV2(draft, { requireBb: true });
      const hands = getHands();
      hands.push(hand);
      saveHands(hands);
      onHandsChange?.();
      onHandSelectionReset?.();

      setHeroPosition('');
      setSbSize('');
      setBbSize('');
      setPreflopAction('none');
      setPreflopAmountBb('');
      setPreflopAmountChips('');
      setFlopAction('none');
      setFlopAmountBb('');
      setFlopAmountChips('');
      setTurnAction('none');
      setTurnAmountBb('');
      setTurnAmountChips('');
      setRiverAction('none');
      setRiverAmountBb('');
      setRiverAmountChips('');
      setNetBb('');
      setNetChips('');
      setKnownCardsText('');
      setManualActionText('');
      setNotes('');
      setParsePreview(null);
      setImportRawText('');
      setImportPreview(null);
      setParsedImport(null);
      setParsedImportSnapshot('');
      setImportError('');
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
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Your hand (from above)</label>
          <div className="flex items-center gap-2">
            <CardLogo value={heroCard1} />
            <CardLogo value={heroCard2} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="block text-sm font-medium text-slate-700 mb-1">Import from Ignition (optional)</label>
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
              {typeof importPreview.winLoss === 'number' ? `Win/Loss: ${importPreview.winLoss >= 0 ? '+' : ''}${importPreview.winLoss.toFixed(2)}.` : ''}
            </p>
          )}
          {importError && <p className="text-xs text-red-600 mt-1">{importError}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Table context</label>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <span className="text-xs text-slate-500">Players at table</span>
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
              <span className="text-xs text-slate-500">Small blind (optional)</span>
              <input
                type="number"
                step="0.01"
                value={sbSize}
                onChange={(e) => setSbSize(e.target.value)}
                className={inputClass}
                placeholder="e.g. 0.5"
              />
            </div>
            <div>
              <span className="text-xs text-slate-500">Big blind (required)</span>
              <input
                type="number"
                step="0.01"
                value={bbSize}
                onChange={(e) => setBbSize(e.target.value)}
                className={inputClass}
                placeholder="e.g. 1"
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
          <StreetDecisionRow
            street="preflop"
            label="Preflop (required)"
            action={preflopAction}
            amountBb={preflopAmountBb}
            amountChips={preflopAmountChips}
            setAction={setPreflopAction}
            setAmountBb={setPreflopAmountBb}
            setAmountChips={setPreflopAmountChips}
          />
          {showFlop && (
            <StreetDecisionRow
              street="flop"
              label="Flop"
              action={flopAction}
              amountBb={flopAmountBb}
              amountChips={flopAmountChips}
              setAction={setFlopAction}
              setAmountBb={setFlopAmountBb}
              setAmountChips={setFlopAmountChips}
            />
          )}
          {showTurn && (
            <StreetDecisionRow
              street="turn"
              label="Turn"
              action={turnAction}
              amountBb={turnAmountBb}
              amountChips={turnAmountChips}
              setAction={setTurnAction}
              setAmountBb={setTurnAmountBb}
              setAmountChips={setTurnAmountChips}
            />
          )}
          {showRiver && (
            <StreetDecisionRow
              street="river"
              label="River"
              action={riverAction}
              amountBb={riverAmountBb}
              amountChips={riverAmountChips}
              setAction={setRiverAction}
              setAmountBb={setRiverAmountBb}
              setAmountChips={setRiverAmountChips}
            />
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
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
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Net result ($, optional)</label>
            <input
              type="number"
              step="0.01"
              value={netChips}
              onChange={(e) => setNetChips(e.target.value)}
              className={inputClass}
              placeholder="e.g. -18.00"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">
            Manual action text (optional parse helper)
          </label>
          <textarea
            value={manualActionText}
            onChange={(e) => setManualActionText(e.target.value)}
            rows={3}
            className={inputClass + ' resize-y'}
            placeholder="Example: Preflop I raised to 3bb, c-bet flop 4bb, checked turn, folded river, lost 18bb."
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => runManualParser(true)}
              className="px-3 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300 transition"
            >
              Parse & preview text
            </button>
            {parsePreview && (
              <span className="text-xs text-slate-500">
                Confidence: {(parsePreview.overall * 100).toFixed(0)}%
              </span>
            )}
          </div>
          {parsePreview?.message && (
            <p className="text-xs text-slate-500 mt-1">{parsePreview.message}</p>
          )}
          {parsePreview?.missingRequired?.length > 0 && (
            <p className="text-xs text-amber-600 mt-1">
              Missing from text: {parsePreview.missingRequired.join(', ')}
            </p>
          )}
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
