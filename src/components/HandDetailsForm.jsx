import { CardLogo } from './CardLogo.jsx';

export function HandDetailsForm({
  noFlop,
  setNoFlop,
  flop1,
  setFlop1,
  flop2,
  setFlop2,
  flop3,
  setFlop3,
  turn,
  setTurn,
  river,
  setRiver,
  registerCardPickerTarget,
  activeCardTargetId,
}) {
  const communitySlots = [
    { id: 'import-flop1', label: 'Flop 1', value: flop1, setValue: setFlop1 },
    { id: 'import-flop2', label: 'Flop 2', value: flop2, setValue: setFlop2 },
    { id: 'import-flop3', label: 'Flop 3', value: flop3, setValue: setFlop3 },
    { id: 'import-turn', label: 'Turn', value: turn, setValue: setTurn },
    { id: 'import-river', label: 'River', value: river, setValue: setRiver },
  ];

  const handleSelectSlot = (id, setValue) => {
    registerCardPickerTarget?.(id, setValue);
  };

  return (
    <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-medium text-slate-700 mb-2">Community cards</h2>
      <p className="text-slate-500 text-sm mb-3">Click a board slot, then use the selector above.</p>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="import-no-flop"
            checked={noFlop}
            onChange={(e) => setNoFlop(e.target.checked)}
            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <label htmlFor="import-no-flop" className="text-sm text-slate-700">
            Hand didn't reach flop
          </label>
        </div>
        {!noFlop && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Click a slot, then choose rank and suit in the picker above.</p>
            <div className="flex flex-wrap gap-3">
              {communitySlots.map(({ id, label, value, setValue }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectSlot(id, setValue)}
                  className={
                    'flex flex-col items-center gap-1 rounded-lg border-2 p-1 transition hover:border-emerald-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 ' +
                    (activeCardTargetId === id ? 'border-emerald-500 bg-emerald-50/50' : 'border-transparent')
                  }
                  aria-label={`Select ${label}`}
                >
                  <CardLogo value={value} />
                  <span className="text-xs text-slate-500">{label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">For imported hands, at least the 3 flop cards are required unless pre-flop.</p>
          </div>
        )}
      </div>
    </section>
  );
}
