import { useState } from 'react';
import { generateId, getHands, saveHands } from '../lib/storage.js';

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

export function QuickAddForm({ onHandsChange, heroCard1, heroCard2, heroPosition }) {
  const [action, setAction] = useState('');
  const [opponentCards, setOpponentCards] = useState('');
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!heroCard1.trim() || !heroCard2.trim()) {
      alert('Select your two hole cards in "Your hand" at the top first.');
      return;
    }
    if (!outcome) {
      alert('Please select an outcome (Win / Loss / Tie).');
      return;
    }
    const hand = {
      id: generateId(),
      card1: heroCard1.trim(),
      card2: heroCard2.trim(),
      position: heroPosition || undefined,
      action: action || undefined,
      opponentCards: opponentCards.trim() || undefined,
      outcome,
      notes: notes.trim() || undefined,
      createdAt: Date.now(),
    };
    const hands = getHands();
    hands.push(hand);
    saveHands(hands);
    onHandsChange();
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
          <div className="flex items-center gap-2 font-mono text-slate-800">
            <span className="px-3 py-1.5 rounded bg-slate-100">{heroCard1 || '—'}</span>
            <span className="px-3 py-1.5 rounded bg-slate-100">{heroCard2 || '—'}</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Change your hole cards in “Your hand” at the top.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Position (from above)</label>
          <div className="flex items-center gap-2">
            <span className="px-3 py-2 rounded-lg bg-slate-100 text-slate-800 font-medium">
              {heroPosition || '—'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Change your position in the Position section above.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Action</label>
          <select value={action} onChange={(e) => setAction(e.target.value)} className={inputClass}>
            {ACTIONS.map((opt) => (
              <option key={opt.value || 'empty'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputClass}>
            {OUTCOMES.map((opt) => (
              <option key={opt.value || 'empty'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
