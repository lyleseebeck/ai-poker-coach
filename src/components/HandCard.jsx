export function HandCard({ hand, onDelete }) {
  if (hand.schemaVersion === 2) {
    const heroCards = hand.hero?.cards?.join(' ') || '';
    const position = hand.hero?.position || '—';
    const netBb = hand.result?.netBb;
    const netBbStr = typeof netBb === 'number' ? `${netBb >= 0 ? '+' : ''}${netBb.toFixed(1)} bb` : '—';
    const netClass =
      typeof netBb === 'number'
        ? netBb > 0
          ? 'text-emerald-600'
          : netBb < 0
            ? 'text-red-600'
            : 'text-slate-600'
        : 'text-slate-500';
    const boardStr =
      hand.board?.didReachFlop
        ? hand.board?.cards?.length
          ? hand.board.cards.join(' ')
          : '—'
        : '— (pre-flop)';
    const sourceLabel = hand.source?.mode === 'ignition_import' ? 'Imported' : 'Manual';

    const streetParts = [];
    const summary = hand.heroStreetSummary || {};
    if (summary.preflop?.action && summary.preflop.action !== 'none') streetParts.push(`PF: ${summary.preflop.action}`);
    if (summary.flop?.action && summary.flop.action !== 'none') streetParts.push(`F: ${summary.flop.action}`);
    if (summary.turn?.action && summary.turn.action !== 'none') streetParts.push(`T: ${summary.turn.action}`);
    if (summary.river?.action && summary.river.action !== 'none') streetParts.push(`R: ${summary.river.action}`);

    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium text-slate-800">{heroCards}</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-600 text-sm">{position}</span>
              <span className="text-slate-400">·</span>
              <span className={`text-sm font-medium ${netClass}`}>{netBbStr}</span>
              <span className="text-slate-400">·</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">{sourceLabel}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Board: <span className="font-mono">{boardStr}</span>
            </p>
            {streetParts.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                {streetParts.join(' · ')}
              </p>
            )}
            {hand.notes && <p className="text-xs text-slate-500 mt-1">{hand.notes}</p>}
          </div>
          <button
            type="button"
            onClick={() => onDelete(hand.id)}
            className="shrink-0 text-slate-400 hover:text-red-600 text-sm"
            title="Delete"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  if (hand.actions && hand.actions.length > 0) {
    const tableName = hand.tableName || 'Imported hand';
    const handId = hand.handId ? '#' + hand.handId : '';
    const potStr = hand.potSize != null ? `Pot $${hand.potSize.toFixed(2)}` : '';
    const mePlayer = (hand.players || []).find((p) => p.isMe);
    const myResult =
      mePlayer && mePlayer.winLoss != null
        ? (mePlayer.winLoss >= 0 ? '+' : '') + '$' + mePlayer.winLoss.toFixed(2)
        : '';
    const resultClass =
      mePlayer && mePlayer.winLoss != null
        ? mePlayer.winLoss >= 0
          ? 'text-emerald-600'
          : 'text-red-600'
        : 'text-slate-500';
    const myCardsStr =
      hand.myCards && hand.myCards.length >= 2
        ? `${hand.myCards[0]} ${hand.myCards[1]}`
        : '';
    const boardStr =
      hand.communityCards?.length > 0
        ? hand.communityCards.join(' ')
        : hand.handDidNotReachFlop
          ? '— (pre-flop)'
          : '';

    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
        <div className="p-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-800">{tableName}</span>
              {handId && <span className="text-slate-400 text-sm">{handId}</span>}
              {potStr && <span className="text-slate-500 text-sm">{potStr}</span>}
              {myResult && (
                <span className={`text-sm font-medium ${resultClass}`}>{myResult}</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {hand.start || ''}
              {hand.end ? ` – ${hand.end}` : ''}
            </p>
            {myCardsStr && (
              <p className="text-xs text-slate-600 mt-1">
                <span className="text-slate-500">My cards:</span>{' '}
                <span className="font-mono">{myCardsStr}</span>
              </p>
            )}
            {(boardStr !== undefined && boardStr !== '') && (
              <p className="text-xs text-slate-600 mt-0.5">
                <span className="text-slate-500">Board:</span>{' '}
                <span className="font-mono">{boardStr}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDelete(hand.id)}
            className="shrink-0 text-slate-400 hover:text-red-600 text-sm"
            title="Delete"
          >
            Delete
          </button>
        </div>
        <div className="border-t border-slate-200 bg-white/60">
          <details className="group">
            <summary className="px-3 py-2 text-sm text-slate-600 cursor-pointer list-none flex items-center gap-1">
              <span className="group-open:rotate-90 transition-transform">▶</span>
              <span>{hand.actions.length} actions</span>
            </summary>
            <div className="px-3 pb-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1 pr-2 font-medium">Position</th>
                    <th className="py-1 pr-2 font-medium">Action</th>
                    <th className="py-1 pr-2 font-medium">Time</th>
                    <th className="py-1 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {hand.actions.map((a, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="py-1 pr-2 text-slate-600">{a.position}</td>
                      <td className="py-1 pr-2">{a.action}</td>
                      <td className="py-1 pr-2 text-slate-500 text-xs">{a.timestamp || ''}</td>
                      <td className="py-1 text-slate-600">
                        {a.amount != null ? '$' + a.amount.toFixed(2) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>
    );
  }

  const rankLabel = { win: 'Won', loss: 'Lost', tie: 'Tie' }[hand.outcome] || hand.outcome;
  const outcomeClass =
    hand.outcome === 'win'
      ? 'text-emerald-600'
      : hand.outcome === 'loss'
        ? 'text-red-600'
        : 'text-slate-500';

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium text-slate-800">
              {hand.card1 || ''} {hand.card2 || ''}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600 text-sm">{hand.position || '—'}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600 text-sm">{hand.action || '—'}</span>
            <span className="text-slate-400">·</span>
            <span className={`text-sm font-medium ${outcomeClass}`}>{rankLabel}</span>
          </div>
          {hand.opponentCards && (
            <p className="text-xs text-slate-500 mt-1">Villain: {hand.opponentCards}</p>
          )}
          {hand.notes && (
            <p className="text-xs text-slate-500 mt-1">{hand.notes}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDelete(hand.id)}
          className="shrink-0 text-slate-400 hover:text-red-600 text-sm"
          title="Delete"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
