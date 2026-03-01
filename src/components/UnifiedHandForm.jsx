import { useMemo, useState } from 'react';
import { getHands, saveHands } from '../lib/storage.js';
import { normalizeCard } from '../lib/cards.js';
import { PLAYER_COUNTS, POSITIONS_BY_PLAYERS } from '../lib/positions.js';
import { buildHandRecordV2, createEmptyHandDraft } from '../lib/handSchema.js';
import { parseManualActionText } from '../lib/manualActionParser.js';
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
  noFlop,
  flop1,
  flop2,
  flop3,
  turn,
  river,
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

  const handleSave = (e) => {
    e.preventDefault();
    setFormErrors({});

    let mergedState = getCurrentState();
    let effectiveHeroPosition = heroPosition;
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
    draft.source.mode = 'manual';
    draft.hero.cards = [heroCard1, heroCard2];
    draft.hero.position = effectiveHeroPosition;
    draft.table.numPlayers = numPlayers;
    draft.table.stakes.sb = numberOrNull(sbSize);
    draft.table.stakes.bb = numberOrNull(bbSize);
    draft.board.didReachFlop = !noFlop;
    draft.board.cards = boardCards;
    draft.heroStreetSummary.preflop = {
      action: mergedState.preflopAction,
      amountBb: numberOrNull(mergedState.preflopAmountBb),
      amountChips: numberOrNull(mergedState.preflopAmountChips),
      source: 'manual',
    };
    draft.heroStreetSummary.flop = {
      action: mergedState.flopAction,
      amountBb: numberOrNull(mergedState.flopAmountBb),
      amountChips: numberOrNull(mergedState.flopAmountChips),
      source: 'manual',
    };
    draft.heroStreetSummary.turn = {
      action: mergedState.turnAction,
      amountBb: numberOrNull(mergedState.turnAmountBb),
      amountChips: numberOrNull(mergedState.turnAmountChips),
      source: 'manual',
    };
    draft.heroStreetSummary.river = {
      action: mergedState.riverAction,
      amountBb: numberOrNull(mergedState.riverAmountBb),
      amountChips: numberOrNull(mergedState.riverAmountChips),
      source: 'manual',
    };
    draft.result.netBb = numberOrNull(mergedState.netBb);
    draft.result.netChips = numberOrNull(mergedState.netChips);
    draft.opponents.knownCardsText = knownCardsText.trim() || null;
    draft.notes = notes.trim() || null;
    draft.manualActionText = manualActionText.trim() || null;
    draft.provenance = {
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
