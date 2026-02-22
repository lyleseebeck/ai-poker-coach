import { useState, useRef, useCallback } from 'react';
import { getHands } from './lib/storage.js';
import { CardPicker } from './components/CardPicker.jsx';
import { ImportSection } from './components/ImportSection.jsx';
import { QuickAddForm } from './components/QuickAddForm.jsx';
import { HandList } from './components/HandList.jsx';

export function App() {
  const [hands, setHands] = useState(() => getHands());
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-800">Poker Hand Tracker</h1>
        <p className="text-slate-500 text-sm mt-1">
          Log hands and review them later. Data stays in your browser.
        </p>
      </header>

      <CardPicker
        targetId={cardPickerTargetId}
        selectedRank={cardPickerRank}
        onSelectRank={setCardPickerRank}
        applyCardRef={applyCardRef}
      />

      <ImportSection onHandsChange={refreshHands} registerCardPickerTarget={registerCardPickerTarget} />

      <QuickAddForm onHandsChange={refreshHands} registerCardPickerTarget={registerCardPickerTarget} />

      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-medium text-slate-700 mb-4">Saved hands</h2>
        <HandList hands={hands} onHandsChange={refreshHands} />
      </section>
    </div>
  );
}
