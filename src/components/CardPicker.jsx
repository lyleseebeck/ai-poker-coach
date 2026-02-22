const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = [
  { key: 'c', symbol: '♣', title: 'Clubs', red: false },
  { key: 'd', symbol: '♦', title: 'Diamonds', red: true },
  { key: 'h', symbol: '♥', title: 'Hearts', red: true },
  { key: 's', symbol: '♠', title: 'Spades', red: false },
];

export function CardPicker({
  targetId,
  selectedRank,
  onSelectRank,
  onApplyCard,
}) {
  const handleSuitClick = (suitKey) => {
    if (!selectedRank) return;
    const card = selectedRank + suitKey;
    onApplyCard?.(card);
    onSelectRank(null);
  };

  let hint;
  if (!targetId) {
    hint = 'Both hole cards are set. Click a card field below to change one, or add/import a hand.';
  } else {
    const label = targetId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    hint = selectedRank
      ? `${label}: rank ${selectedRank} — now click a suit.`
      : `${label} — click a rank, then a suit.`;
  }

  return (
    <section
      className="mb-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      onMouseDown={(e) => e.preventDefault()}
    >
      <p className="text-sm text-slate-600 mb-3">
        Select <strong>rank</strong> then <strong>suit</strong> — fills your first empty hole card. Or click a card field below to choose which slot.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Rank</span>
        <div className="flex flex-wrap gap-1.5">
          {RANKS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onSelectRank(selectedRank === r ? null : r)}
              className={
                'w-9 h-9 rounded-lg border font-medium text-sm focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 ' +
                (selectedRank === r
                  ? 'ring-2 ring-emerald-500 ring-offset-1 bg-emerald-50 border-slate-300 text-slate-700'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100')
              }
            >
              {r}
            </button>
          ))}
        </div>
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide ml-2">Suit</span>
        <div className="flex gap-1.5">
          {SUITS.map(({ key, symbol, title, red }) => (
            <button
              key={key}
              type="button"
              title={title}
              onClick={() => handleSuitClick(key)}
              className={
                'w-10 h-9 rounded-lg border border-slate-300 bg-white text-xl hover:bg-slate-100 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 ' +
                (red ? 'text-red-600' : '')
              }
            >
              {symbol}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-2">{hint}</p>
    </section>
  );
}
