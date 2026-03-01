import { HandCard } from './HandCard.jsx';

export function HandList({ hands, onDeleteHand }) {
  const sorted = [...hands].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (hands.length === 0) {
    return (
      <p className="text-slate-400 text-sm">No V2 hands saved yet. Add one above.</p>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((hand) => (
        <HandCard key={hand.id} hand={hand} onDelete={onDeleteHand} />
      ))}
    </div>
  );
}
