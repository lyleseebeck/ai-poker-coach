import { useState } from 'react';
import { generateId, getHands, saveHands } from '../lib/storage.js';
import { POSITIONS_BY_PLAYERS, PLAYER_COUNTS } from '../lib/positions.js';
import { CardLogo } from './CardLogo.jsx';

const ACTIONS = [
  { value: '', label: 'What did you do?' },
  { value: 'Fold', label: 'Fold' },
  { value: 'Check', label: 'Check' },
  { value: 'Call', label: 'Call' },
  { value: 'Bet', label: 'Bet' },
  { value: 'Raise', label: 'Raise' },
  { value: 'All-in', label: 'All-in' },
];
const OUTCOMES = [
  { value: '', label: 'Select outcome' },
  { value: 'win', label: 'Win' },
  { value: 'loss', label: 'Loss' },
  { value: 'tie', label: 'Tie' },
];

export function QuickAddForm({
  onHandsChange,
  onHandSelectionReset,
  heroCard1,
  heroCard2,
  heroPosition,
  setHeroPosition,
  numPlayers,
  setNumPlayers,
  positionLocked,
  hasParsedImportData,
  importedAction,
  importedOutcome,
}) {
  const [action, setAction] = useState('');
  const [opponentCards, setOpponentCards] = useState('');
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const positions = POSITIONS_BY_PLAYERS[numPlayers] || [];
  const actionLocked = Boolean(importedAction);
  const outcomeLocked = Boolean(importedOutcome);
  const effectiveAction = actionLocked ? importedAction : action;
  const effectiveOutcome = outcomeLocked ? importedOutcome : outcome;

  const handlePlayersChange = (n) => {
    const newCount = Number(n);
    setNumPlayers(newCount);
    const newPositions = POSITIONS_BY_PLAYERS[newCount] || [];
    const stillValid = newPositions.some((p) => p.value === heroPosition);
    if (!stillValid) setHeroPosition('');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!heroCard1.trim() || !heroCard2.trim()) {
      alert('Select your two hole cards in "Your hand" at the top first.');
      return;
    }
    if (!effectiveOutcome) {
      alert('Please select an outcome (Win / Loss / Tie).');
      return;
    }
    const hand = {
      id: generateId(),
      card1: heroCard1.trim(),
      card2: heroCard2.trim(),
      position: heroPosition || undefined,
      numPlayers: typeof numPlayers === 'number' ? numPlayers : undefined,
      action: effectiveAction || undefined,
      opponentCards: opponentCards.trim() || undefined,
      outcome: effectiveOutcome,
      notes: notes.trim() || undefined,
      createdAt: Date.now(),
    };
    const hands = getHands();
    hands.push(hand);
    saveHands(hands);
    onHandsChange();
    onHandSelectionReset?.();
    setAction('');
    setOpponentCards('');
    setOutcome('');
    setNotes('');
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white';

  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8">
      <h2 className="text-lg font-medium text-slate-700 mb-4">Add a hand (quick)</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Your hand (from above)</label>
          <div className="flex items-center gap-2">
            <CardLogo value={heroCard1} />
            <CardLogo value={heroCard2} />
          </div>
          <p className="text-xs text-slate-400 mt-1">Change your hole cards in “Your hand” at the top.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Table info</label>
          {positionLocked ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-3 py-2 rounded-lg bg-slate-100 text-slate-800 font-medium">
                  Players: {numPlayers ?? '—'}
                </span>
                <span className="px-3 py-2 rounded-lg bg-slate-100 text-slate-800 font-medium">
                  Position: {heroPosition || '—'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {hasParsedImportData
                  ? 'Using players/position from the imported hand history.'
                  : 'Import text detected. Parse & preview to populate players/position, or clear the import text to edit manually.'}
              </p>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-slate-600">Players at table</span>
                <select
                  value={numPlayers}
                  onChange={(e) => handlePlayersChange(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                >
                  {PLAYER_COUNTS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-sm text-slate-600">Your position (hero)</p>
              <div className="flex flex-wrap gap-2">
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
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Action</label>
          <select
            value={effectiveAction}
            onChange={(e) => setAction(e.target.value)}
            disabled={actionLocked}
            className={inputClass + (actionLocked ? ' bg-slate-100 text-slate-500 cursor-not-allowed' : '')}
          >
            {ACTIONS.map((opt) => (
              <option key={opt.value || 'empty'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {actionLocked && <p className="text-xs text-slate-400 mt-1">Action locked from imported hand history.</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Opponent cards (optional)</label>
          <input
            type="text"
            value={opponentCards}
            onChange={(e) => setOpponentCards(e.target.value)}
            placeholder="e.g. Ac Kc or leave blank"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Outcome</label>
          <select
            value={effectiveOutcome}
            onChange={(e) => setOutcome(e.target.value)}
            disabled={outcomeLocked}
            className={inputClass + (outcomeLocked ? ' bg-slate-100 text-slate-500 cursor-not-allowed' : '')}
          >
            {OUTCOMES.map((opt) => (
              <option key={opt.value || 'empty'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {outcomeLocked && <p className="text-xs text-slate-400 mt-1">Outcome locked from imported hand history.</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Any extra context…"
            className={inputClass + ' resize-none'}
          />
        </div>
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
