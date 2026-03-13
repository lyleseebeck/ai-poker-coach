import { useState, useCallback, useEffect } from 'react';
import {
  getHands,
  getTrashedHands,
  moveHandToTrash,
  permanentlyDeleteHand,
  restoreHandFromTrash,
  TRASH_RETENTION_DAYS,
} from './lib/storage.js';
import { normalizeCard } from './lib/cards.js';
import { HandList } from './components/HandList.jsx';
import { TrashList } from './components/TrashList.jsx';
import { UnifiedHandForm } from './components/UnifiedHandForm.jsx';
import { CoachPanel } from './components/CoachPanel.jsx';

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
  const [trashedHands, setTrashedHands] = useState(() => getTrashedHands());
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
    setTrashedHands(getTrashedHands());
  }, []);

  const handleDeleteHand = useCallback(
    (id) => {
      if (!id) return;
      const ok = window.confirm(
        `Move this hand to trash? It will be permanently deleted after ${TRASH_RETENTION_DAYS} days.`
      );
      if (!ok) return;
      moveHandToTrash(id);
      refreshHands();
    },
    [refreshHands]
  );

  const handleRestoreHand = useCallback(
    (id) => {
      if (!id) return;
      restoreHandFromTrash(id);
      refreshHands();
    },
    [refreshHands]
  );

  const handleDeleteNow = useCallback(
    (id) => {
      if (!id) return;
      const ok = window.confirm('Permanently delete this trashed hand now? This cannot be undone.');
      if (!ok) return;
      permanentlyDeleteHand(id);
      refreshHands();
    },
    [refreshHands]
  );

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
        <h1 className="text-2xl font-semibold text-slate-800">AI Poker Coach</h1>
        <p className="text-slate-500 text-sm mt-1">
          Capture real hands, get AI coaching feedback, and improve your decision-making street by street. All hand data you save is stored in your browser.
        </p>
      </header>

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
        effectiveTargetId={effectiveTargetId}
        cardPickerRank={cardPickerRank}
        setCardPickerRank={setCardPickerRank}
        cardPickerError={cardPickerError}
        onApplyCard={onApplyCard}
        registerCardPickerTarget={registerCardPickerTarget}
        clearCardBySlotId={clearCardBySlotId}
      />

      <CoachPanel hands={hands} />

      <div className="my-6 border-t border-slate-200" aria-hidden="true" />

      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-medium text-slate-700 mb-4">Saved hands</h2>
        <HandList hands={hands} onDeleteHand={handleDeleteHand} />
      </section>

      <section className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-medium text-slate-700 mb-1">Trash</h2>
        <p className="text-xs text-slate-500 mb-4">
          Deleted hands stay here for {TRASH_RETENTION_DAYS} days, then are removed automatically.
        </p>
        <TrashList
          hands={trashedHands}
          onRestoreHand={handleRestoreHand}
          onDeleteNow={handleDeleteNow}
        />
      </section>
    </div>
  );
}
