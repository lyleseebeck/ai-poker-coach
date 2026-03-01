export function HandCard({ hand, onDelete }) {
  const heroCards = hand.hero?.cards?.join(' ') || '';
  const position = hand.hero?.position || '—';
  const netBb = hand.result?.netBb;
  const netChips = hand.result?.netChips;
  const netBbStr = typeof netBb === 'number' ? `${netBb >= 0 ? '+' : ''}${netBb.toFixed(1)} bb` : '—';
  const netChipsStr = typeof netChips === 'number' ? `${netChips >= 0 ? '+' : ''}$${netChips.toFixed(2)}` : null;
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
  const tableInfo = hand.table?.tableName || hand.table?.gameType || null;
  const stakes =
    hand.table?.stakes?.sb != null && hand.table?.stakes?.bb != null
      ? `${hand.table.stakes.sb}/${hand.table.stakes.bb}`
      : null;
  const timelineActions = Array.isArray(hand.timeline?.actions) ? hand.timeline.actions : [];

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
            {netChipsStr && (
              <>
                <span className="text-slate-400">·</span>
                <span className={`text-sm font-medium ${netClass}`}>{netChipsStr}</span>
              </>
            )}
            <span className="text-slate-400">·</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">{sourceLabel}</span>
          </div>
          {(tableInfo || stakes || hand.table?.numPlayers) && (
            <p className="text-xs text-slate-500 mt-1">
              {tableInfo ? `${tableInfo}` : ''}
              {tableInfo && stakes ? ' · ' : ''}
              {stakes ? `Blinds ${stakes}` : ''}
              {(tableInfo || stakes) && hand.table?.numPlayers ? ' · ' : ''}
              {hand.table?.numPlayers ? `${hand.table.numPlayers} players` : ''}
            </p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            Board: <span className="font-mono">{boardStr}</span>
          </p>
          {streetParts.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              {streetParts.join(' · ')}
            </p>
          )}
          {timelineActions.length > 0 && (
            <details className="mt-2 group">
              <summary className="text-xs text-slate-600 cursor-pointer list-none flex items-center gap-1">
                <span className="group-open:rotate-90 transition-transform">▶</span>
                <span>{timelineActions.length} imported actions</span>
              </summary>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1 pr-2 font-medium">Street</th>
                      <th className="py-1 pr-2 font-medium">Position</th>
                      <th className="py-1 pr-2 font-medium">Action</th>
                      <th className="py-1 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timelineActions.map((a) => (
                      <tr key={a.seq} className="border-b border-slate-100 last:border-0">
                        <td className="py-1 pr-2 text-slate-600">{a.street || 'unknown'}</td>
                        <td className="py-1 pr-2 text-slate-600">{a.position || '—'}</td>
                        <td className="py-1 pr-2 text-slate-700">{a.actionRaw || '—'}</td>
                        <td className="py-1 text-slate-600">
                          {a.amountChips != null ? '$' + Number(a.amountChips).toFixed(2) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
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
