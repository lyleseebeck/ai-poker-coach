import { getHands, saveHands } from '../lib/storage.js';
import { HandCard } from './HandCard.jsx';

export function HandList({ hands, onHandsChange }) {
  const sorted = [...hands].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const handleDelete = (id) => {
    const next = getHands().filter((h) => h.id !== id);
    saveHands(next);
    onHandsChange();
  };

  if (hands.length === 0) {
    return (
      <p className="text-slate-400 text-sm">No V2 hands saved yet. Add one above.</p>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((hand) => (
        <HandCard key={hand.id} hand={hand} onDelete={handleDelete} />
      ))}
    </div>
  );
}
