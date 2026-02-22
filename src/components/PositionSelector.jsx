import { POSITIONS_BY_PLAYERS, PLAYER_COUNTS } from '../lib/positions.js';

export function PositionSelector({ numPlayers, setNumPlayers, heroPosition, setHeroPosition }) {
  const positions = POSITIONS_BY_PLAYERS[numPlayers] || POSITIONS_BY_PLAYERS[8];

  const handlePlayersChange = (n) => {
    const newCount = Number(n);
    setNumPlayers(newCount);
    const newPositions = POSITIONS_BY_PLAYERS[newCount] || [];
    const stillValid = newPositions.some((p) => p.value === heroPosition);
    if (!stillValid) setHeroPosition('');
  };

  return (
    <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-medium text-slate-700 mb-3">Position</h2>
      <div className="flex flex-wrap items-center gap-4 mb-4">
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
      <p className="text-slate-500 text-sm mb-2">Your position</p>
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
    </section>
  );
}
