import { useState, useCallback, useEffect } from 'react';
import { getHands } from './lib/storage.js';
import { normalizeCard } from './lib/cards.js';
import { CardPicker } from './components/CardPicker.jsx';
import { CardLogo } from './components/CardLogo.jsx';
import { HandList } from './components/HandList.jsx';
import { HandDetailsForm } from './components/HandDetailsForm.jsx';
import { UnifiedHandForm } from './components/UnifiedHandForm.jsx';

const HERO_SLOT_IDS = ['hero-card1', 'hero-card2'];
const COMMUNITY_SLOT_IDS = ['import-flop1', 'import-flop2', 'import-flop3', 'import-turn', 'import-river'];
const SLOT_LABELS = {
  'hero-card1': 'Hole card 1',
  'hero-card2': 'Hole card 2',
  'import-flop1': 'Flop 1',
  'import-flop2': 'Flop 2',
  'import-flop3': 'Flop 3',
  'import-turn': 'Turn',
  'import-river': 'River',
};

export function App() {
  const [hands, setHands] = useState(() => getHands());
  const [heroCard1, setHeroCard1] = useState('');
  const [heroCard2, setHeroCard2] = useState('');
  const [noFlop, setNoFlop] = useState(false);
  const [flop1, setFlop1] = useState('');
  const [flop2, setFlop2] = useState('');
  const [flop3, setFlop3] = useState('');
  const [turn, setTurn] = useState('');
  const [river, setRiver] = useState('');
  const [cardPickerTargetId, setCardPickerTargetId] = useState(null);
  const [cardPickerRank, setCardPickerRank] = useState(null);
  const [cardPickerError, setCardPickerError] = useState('');

  const refreshHands = useCallback(() => {
    setHands(getHands());
  }, []);

  const registerCardPickerTarget = useCallback((id) => {
    setCardPickerTargetId(id);
    setCardPickerRank(null);
    setCardPickerError('');
  }, []);

  useEffect(() => {
    if (noFlop && cardPickerTargetId && cardPickerTargetId.startsWith('import-')) {
      setCardPickerTargetId(null);
      setCardPickerError('');
    }
  }, [noFlop, cardPickerTargetId]);

  const cardValuesById = {
    'hero-card1': heroCard1,
    'hero-card2': heroCard2,
    'import-flop1': flop1,
    'import-flop2': flop2,
    'import-flop3': flop3,
    'import-turn': turn,
    'import-river': river,
  };

  const firstEmptyHeroSlot = HERO_SLOT_IDS.find((id) => !normalizeCard(cardValuesById[id])) || null;
  const firstEmptyCommunitySlot =
    !noFlop ? COMMUNITY_SLOT_IDS.find((id) => !normalizeCard(cardValuesById[id])) || null : null;
  const effectiveTargetId = cardPickerTargetId || firstEmptyHeroSlot || firstEmptyCommunitySlot;

  const setCardBySlotId = useCallback((slotId, card) => {
    if (slotId === 'hero-card1') setHeroCard1(card);
    else if (slotId === 'hero-card2') setHeroCard2(card);
    else if (slotId === 'import-flop1') setFlop1(card);
    else if (slotId === 'import-flop2') setFlop2(card);
    else if (slotId === 'import-flop3') setFlop3(card);
    else if (slotId === 'import-turn') setTurn(card);
    else if (slotId === 'import-river') setRiver(card);
  }, []);

  const clearCardBySlotId = useCallback(
    (slotId) => {
      setCardBySlotId(slotId, '');
      if (cardPickerTargetId === slotId) {
        setCardPickerTargetId(null);
      }
      setCardPickerError('');
    },
    [setCardBySlotId, cardPickerTargetId]
  );

  const onApplyCard = useCallback(
    (card) => {
      const targetId = effectiveTargetId;
      const normalized = normalizeCard(card);
      if (!targetId || !normalized) return;

      const activeSlotIds = noFlop ? HERO_SLOT_IDS : [...HERO_SLOT_IDS, ...COMMUNITY_SLOT_IDS];
      const duplicateSlotId = activeSlotIds.find(
        (id) => id !== targetId && normalizeCard(cardValuesById[id]) === normalized
      );
      if (duplicateSlotId) {
        setCardPickerError(
          `Duplicate card: ${normalized}. ${SLOT_LABELS[targetId]} cannot match ${SLOT_LABELS[duplicateSlotId]}.`
        );
        return;
      }

      setCardPickerError('');
      setCardBySlotId(targetId, normalized);
      const isExplicitTarget = Boolean(cardPickerTargetId);
      if (!isExplicitTarget) {
        setCardPickerTargetId(null);
        return;
      }

      const targetIndex = activeSlotIds.indexOf(targetId);
      let nextTargetId = null;
      for (let i = targetIndex + 1; i < activeSlotIds.length; i += 1) {
        const slotId = activeSlotIds[i];
        if (!normalizeCard(cardValuesById[slotId])) {
          nextTargetId = slotId;
          break;
        }
      }

      setCardPickerTargetId(nextTargetId);
    },
    [effectiveTargetId, noFlop, cardValuesById, setCardBySlotId, cardPickerTargetId]
  );

  const resetHandSelection = useCallback(() => {
    setHeroCard1('');
    setHeroCard2('');
    setNoFlop(false);
    setFlop1('');
    setFlop2('');
    setFlop3('');
    setTurn('');
    setRiver('');
    setCardPickerTargetId(null);
    setCardPickerRank(null);
    setCardPickerError('');
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
        targetId={effectiveTargetId}
        selectedRank={cardPickerRank}
        onSelectRank={setCardPickerRank}
        onApplyCard={onApplyCard}
      />
      {cardPickerError && <p className="mb-6 -mt-4 text-sm text-red-600">{cardPickerError}</p>}

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-medium text-slate-700 mb-2">Your hand (hero)</h2>
        <p className="text-slate-500 text-sm mb-3">Click a card then use the picker above, or pick rank/suit to fill the first empty slot.</p>
        <div className="flex gap-3">
          {[
            { id: 'hero-card1', label: 'Card 1', value: heroCard1 },
            { id: 'hero-card2', label: 'Card 2', value: heroCard2 },
          ].map((slot) => (
            <div key={slot.id} className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => registerCardPickerTarget(slot.id)}
                className={
                  'flex flex-col items-center gap-1 rounded-lg border-2 p-1 transition hover:border-emerald-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 ' +
                  (effectiveTargetId === slot.id ? 'border-emerald-500 bg-emerald-50/50' : 'border-transparent')
                }
                aria-label={`Select ${slot.label}`}
              >
                <CardLogo value={slot.value} />
                <span className="text-xs text-slate-400">{slot.label}</span>
              </button>
              {slot.value && (
                <button
                  type="button"
                  onClick={() => clearCardBySlotId(slot.id)}
                  className="text-xs text-slate-400 hover:text-red-600 transition"
                >
                  Clear
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <HandDetailsForm
        noFlop={noFlop}
        setNoFlop={setNoFlop}
        flop1={flop1}
        flop2={flop2}
        flop3={flop3}
        turn={turn}
        river={river}
        registerCardPickerTarget={registerCardPickerTarget}
        clearCardBySlotId={clearCardBySlotId}
        activeCardTargetId={effectiveTargetId}
      />

      <UnifiedHandForm
        onHandsChange={refreshHands}
        onHandSelectionReset={resetHandSelection}
        heroCard1={heroCard1}
        heroCard2={heroCard2}
        setHeroCard1={setHeroCard1}
        setHeroCard2={setHeroCard2}
        noFlop={noFlop}
        setNoFlop={setNoFlop}
        flop1={flop1}
        flop2={flop2}
        flop3={flop3}
        turn={turn}
        river={river}
        setFlop1={setFlop1}
        setFlop2={setFlop2}
        setFlop3={setFlop3}
        setTurn={setTurn}
        setRiver={setRiver}
      />

      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-medium text-slate-700 mb-4">Saved hands</h2>
        <HandList hands={hands} onHandsChange={refreshHands} />
      </section>
    </div>
  );
}
