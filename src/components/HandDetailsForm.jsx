import { CardInput } from './CardInput.jsx';

export function HandDetailsForm({
  myCard1,
  setMyCard1,
  myCard2,
  setMyCard2,
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
}) {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 border-amber-200 bg-amber-50/50 p-4">
      <h3 className="text-sm font-medium text-slate-700 mb-3">
        Hand details <span className="text-amber-600">(required to save)</span>
      </h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">My cards</label>
          <div className="flex gap-2">
            <CardInput
              id="import-my-card1"
              label="My card 1"
              value={myCard1}
              onChange={setMyCard1}
              className="flex-1"
              registerCardPickerTarget={registerCardPickerTarget}
            />
            <CardInput
              id="import-my-card2"
              label="My card 2"
              value={myCard2}
              onChange={setMyCard2}
              className="flex-1"
              registerCardPickerTarget={registerCardPickerTarget}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">Click a field, then use the card picker above.</p>
        </div>
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
            <label className="block text-sm font-medium text-slate-600">Community cards</label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Flop</span>
              <CardInput
                id="import-flop1"
                label="Flop 1"
                value={flop1}
                onChange={setFlop1}
                className="w-14 py-1.5 px-2"
                registerCardPickerTarget={registerCardPickerTarget}
              />
              <CardInput
                id="import-flop2"
                label="Flop 2"
                value={flop2}
                onChange={setFlop2}
                className="w-14 py-1.5 px-2"
                registerCardPickerTarget={registerCardPickerTarget}
              />
              <CardInput
                id="import-flop3"
                label="Flop 3"
                value={flop3}
                onChange={setFlop3}
                className="w-14 py-1.5 px-2"
                registerCardPickerTarget={registerCardPickerTarget}
              />
              <span className="text-xs text-slate-500 ml-1">Turn</span>
              <CardInput
                id="import-turn"
                label="Turn"
                value={turn}
                onChange={setTurn}
                className="w-14 py-1.5 px-2"
                registerCardPickerTarget={registerCardPickerTarget}
              />
              <span className="text-xs text-slate-500">River</span>
              <CardInput
                id="import-river"
                label="River"
                value={river}
                onChange={setRiver}
                className="w-14 py-1.5 px-2"
                registerCardPickerTarget={registerCardPickerTarget}
              />
            </div>
            <p className="text-xs text-slate-400">Required: at least the 3 flop cards if the hand saw the flop.</p>
          </div>
        )}
      </div>
    </div>
  );
}
