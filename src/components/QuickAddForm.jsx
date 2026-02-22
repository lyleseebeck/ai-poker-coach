import { useState } from 'react';
import { CardInput } from './CardInput.jsx';
import { generateId, getHands, saveHands } from '../lib/storage.js';

const POSITIONS = [
  { value: '', label: 'Select position' },
  { value: 'BTN', label: 'BTN (Button)' },
  { value: 'SB', label: 'SB (Small Blind)' },
  { value: 'BB', label: 'BB (Big Blind)' },
  { value: 'UTG', label: 'UTG' },
  { value: 'UTG+1', label: 'UTG+1' },
  { value: 'MP', label: 'MP (Middle)' },
  { value: 'HJ', label: 'HJ (Hijack)' },
  { value: 'CO', label: 'CO (Cutoff)' },
];
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

export function QuickAddForm({ onHandsChange, registerCardPickerTarget }) {
  const [card1, setCard1] = useState('');
  const [card2, setCard2] = useState('');
  const [position, setPosition] = useState('');
  const [action, setAction] = useState('');
  const [opponentCards, setOpponentCards] = useState('');
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!card1.trim() || !card2.trim()) {
      alert('Please enter both of your cards.');
      return;
    }
    if (!outcome) {
      alert('Please select an outcome (Win / Loss / Tie).');
      return;
    }
    const hand = {
      id: generateId(),
      card1: card1.trim(),
      card2: card2.trim(),
      position: position || undefined,
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
    setCard1('');
    setCard2('');
    setPosition('');
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
          <label className="block text-sm font-medium text-slate-600 mb-1">My cards</label>
          <div className="flex gap-2">
            <CardInput
              id="quick-card1"
              label="My card 1"
              value={card1}
              onChange={setCard1}
              className="flex-1"
              registerCardPickerTarget={registerCardPickerTarget}
            />
            <CardInput
              id="quick-card2"
              label="My card 2"
              value={card2}
              onChange={setCard2}
              className="flex-1"
              registerCardPickerTarget={registerCardPickerTarget}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">Click a field, then use the card picker above.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Position</label>
          <select value={position} onChange={(e) => setPosition(e.target.value)} className={inputClass}>
            {POSITIONS.map((opt) => (
              <option key={opt.value || 'empty'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
