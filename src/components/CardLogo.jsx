/**
 * Displays a single card as a small logo: rank + suit symbol.
 * value: e.g. "As", "Kh", "Td", "2c"
 */
const SUITS = {
  s: { symbol: '♠', red: false },
  h: { symbol: '♥', red: true },
  d: { symbol: '♦', red: true },
  c: { symbol: '♣', red: false },
};

function parseCard(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v.length < 2) return null;
  const rank = v.slice(0, -1).toUpperCase();
  const suitKey = v.slice(-1).toLowerCase();
  const suit = SUITS[suitKey];
  if (!suit || !'A23456789TJQK'.includes(rank)) return null;
  return { rank: rank === 'T' ? '10' : rank, symbol: suit.symbol, red: suit.red };
}

export function CardLogo({ value, className = '' }) {
  const card = parseCard(value);

  if (!card) {
    return (
      <span
        className={
          'inline-flex h-12 w-9 items-center justify-center rounded border-2 border-dashed border-slate-300 bg-slate-50/80 text-slate-400 text-lg ' +
          className
        }
        title="No card"
      >
        ?
      </span>
    );
  }

  return (
    <span
      className={
        'inline-flex h-12 w-9 flex-col items-center justify-center rounded border border-slate-300 bg-white shadow-sm ' +
        (card.red ? 'text-red-600' : 'text-slate-800') +
        ' ' +
        className
      }
      title={value}
    >
      <span className="text-sm font-bold leading-tight">{card.rank}</span>
      <span className="text-lg leading-none">{card.symbol}</span>
    </span>
  );
}
