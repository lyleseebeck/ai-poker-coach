import { useState, useRef, useCallback } from 'react';
import { getHands } from './lib/storage.js';
import { CardPicker } from './components/CardPicker.jsx';
import { CardLogo } from './components/CardLogo.jsx';
import { PositionSelector } from './components/PositionSelector.jsx';
import { ImportSection } from './components/ImportSection.jsx';
import { QuickAddForm } from './components/QuickAddForm.jsx';
import { HandList } from './components/HandList.jsx';

export function App() {
  const [hands, setHands] = useState(() => getHands());
  const [heroCard1, setHeroCard1] = useState('');
  const [heroCard2, setHeroCard2] = useState('');
  const [numPlayers, setNumPlayers] = useState(8);
  const [heroPosition, setHeroPosition] = useState('');
  const [cardPickerTargetId, setCardPickerTargetId] = useState(null);
  const [cardPickerRank, setCardPickerRank] = useState(null);
  const applyCardRef = useRef(null);

  const refreshHands = useCallback(() => {
    setHands(getHands());
  }, []);

  const registerCardPickerTarget = useCallback((id, setValue) => {
    setCardPickerTargetId(id);
    setCardPickerRank(null);
    applyCardRef.current = setValue;
  }, []);

  const firstEmptyHeroSlot =
    !heroCard1.trim() ? 'hero-card1' : !heroCard2.trim() ? 'hero-card2' : null;
  const effectiveTargetId = cardPickerTargetId || firstEmptyHeroSlot;

  const onApplyCard = useCallback(
    (card) => {
      if (applyCardRef.current) {
        applyCardRef.current(card);
      } else if (!heroCard1.trim()) {
        setHeroCard1(card);
      } else if (!heroCard2.trim()) {
        setHeroCard2(card);
      }
    },
    [heroCard1, heroCard2]
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-800">Poker Hand Tracker</h1>
        <p className="text-slate-500 text-sm mt-1">
          Log hands and review them later. Data stays in your browser.
        </p>
      </header>

      <CardPicker
        targetId={effectiveTargetId}
        selectedRank={cardPickerRank}
        onSelectRank={setCardPickerRank}
        onApplyCard={onApplyCard}
      />

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-medium text-slate-700 mb-2">Your hand (hero)</h2>
        <p className="text-slate-500 text-sm mb-3">Click a card then use the picker above, or pick rank/suit to fill the first empty slot.</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => registerCardPickerTarget('hero-card1', setHeroCard1)}
            className="flex flex-col items-center gap-1 rounded-lg border-2 border-transparent p-1 transition hover:border-emerald-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1"
            aria-label="Select card 1"
          >
            <CardLogo value={heroCard1} />
            <span className="text-xs text-slate-400">Card 1</span>
          </button>
          <button
            type="button"
            onClick={() => registerCardPickerTarget('hero-card2', setHeroCard2)}
            className="flex flex-col items-center gap-1 rounded-lg border-2 border-transparent p-1 transition hover:border-emerald-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1"
            aria-label="Select card 2"
          >
            <CardLogo value={heroCard2} />
            <span className="text-xs text-slate-400">Card 2</span>
          </button>
        </div>
      </section>

      <PositionSelector
        numPlayers={numPlayers}
        setNumPlayers={setNumPlayers}
        heroPosition={heroPosition}
        setHeroPosition={setHeroPosition}
      />

      <ImportSection
        onHandsChange={refreshHands}
        heroCard1={heroCard1}
        heroCard2={heroCard2}
        registerCardPickerTarget={registerCardPickerTarget}
      />

      <QuickAddForm
        onHandsChange={refreshHands}
        heroCard1={heroCard1}
        heroCard2={heroCard2}
        heroPosition={heroPosition}
      />

      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-medium text-slate-700 mb-4">Saved hands</h2>
        <HandList hands={hands} onHandsChange={refreshHands} />
      </section>
    </div>
  );
}
