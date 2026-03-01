import { TRASH_RETENTION_DAYS } from '../lib/storage.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDeletedAt(ts) {
  if (!ts) return 'Unknown';
  return new Date(ts).toLocaleString();
}

function daysUntilPurge(ts) {
  const deletedAt = Number(ts);
  if (!Number.isFinite(deletedAt)) return TRASH_RETENTION_DAYS;
  const elapsed = Date.now() - deletedAt;
  const remaining = TRASH_RETENTION_DAYS - elapsed / DAY_MS;
  return Math.max(0, Math.ceil(remaining));
}

export function TrashList({ hands, onRestoreHand, onDeleteNow }) {
  const sorted = [...hands].sort((a, b) => (Number(b.deletedAt) || 0) - (Number(a.deletedAt) || 0));

  if (sorted.length === 0) {
    return <p className="text-slate-400 text-sm">Trash is empty.</p>;
  }

  return (
    <div className="space-y-3">
      {sorted.map((hand) => {
        const heroCards = hand.hero?.cards?.join(' ') || 'Unknown cards';
        const position = hand.hero?.position || '—';
        const netBb = typeof hand.result?.netBb === 'number' ? `${hand.result.netBb >= 0 ? '+' : ''}${hand.result.netBb.toFixed(1)} bb` : '—';
        const remainingDays = daysUntilPurge(hand.deletedAt);

        return (
          <div key={hand.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium text-slate-700">{heroCards}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600 text-sm">{position}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-sm text-slate-600">{netBb}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Deleted: {formatDeletedAt(hand.deletedAt)}. Auto-delete in {remainingDays} day{remainingDays === 1 ? '' : 's'}.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRestoreHand?.(hand.id)}
                  className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition"
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteNow?.(hand.id)}
                  className="text-xs px-2 py-1 rounded bg-slate-200 text-slate-700 hover:bg-red-100 hover:text-red-700 transition"
                >
                  Delete now
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
