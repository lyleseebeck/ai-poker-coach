import { useState } from 'react';
import { parseIgnitionHandHistory } from '../lib/ignitionParser.js';
import { generateId, getHands, saveHands } from '../lib/storage.js';
import { HandDetailsForm } from './HandDetailsForm.jsx';

export function ImportSection({
  onHandsChange,
  heroCard1,
  heroCard2,
  registerCardPickerTarget,
  activeCardTargetId,
}) {
  const [rawText, setRawText] = useState('');
  const [parsedHand, setParsedHand] = useState(null);
  const [importError, setImportError] = useState('');
  const [noFlop, setNoFlop] = useState(false);
  const [flop1, setFlop1] = useState('');
  const [flop2, setFlop2] = useState('');
  const [flop3, setFlop3] = useState('');
  const [turn, setTurn] = useState('');
  const [river, setRiver] = useState('');

  const handleParse = () => {
    setImportError('');
    setParsedHand(null);
    const raw = rawText.trim();
    if (!raw) {
      setImportError('Paste hand history text first.');
      return;
    }
    try {
      const parsed = parseIgnitionHandHistory(raw);
      if (!parsed.actions || parsed.actions.length === 0) {
        setImportError(
          'Could not find any actions. Make sure you pasted the full Ignition hand (including "Hand Session" and the action table).'
        );
        return;
      }
      setParsedHand(parsed);
    } catch (err) {
      setImportError('Parse error: ' + (err.message || String(err)));
    }
  };

  const handleSave = () => {
    if (!parsedHand) return;
    setImportError('');
    if (!heroCard1.trim() || !heroCard2.trim()) {
      setImportError('Select your two hole cards in "Your hand" above first.');
      return;
    }
    if (!noFlop && (!flop1.trim() || !flop2.trim() || !flop3.trim())) {
      setImportError('Please enter at least the 3 flop cards, or check "Hand didn\'t reach flop".');
      return;
    }
    const communityCards = [];
    if (!noFlop) {
      if (flop1.trim()) communityCards.push(flop1.trim());
      if (flop2.trim()) communityCards.push(flop2.trim());
      if (flop3.trim()) communityCards.push(flop3.trim());
      if (turn.trim()) communityCards.push(turn.trim());
      if (river.trim()) communityCards.push(river.trim());
    }
    const hand = {
      id: generateId(),
      source: 'ignition',
      handId: parsedHand.handId,
      start: parsedHand.start,
      end: parsedHand.end,
      potSize: parsedHand.potSize,
      rake: parsedHand.rake,
      gameType: parsedHand.gameType,
      playMode: parsedHand.playMode,
      tableName: parsedHand.tableName,
      myCards: [heroCard1.trim(), heroCard2.trim()],
      communityCards,
      handDidNotReachFlop: noFlop,
      players: parsedHand.players || [],
      actions: parsedHand.actions || [],
      createdAt: Date.now(),
    };
    const hands = getHands();
    hands.push(hand);
    saveHands(hands);
    onHandsChange();
    setParsedHand(null);
    setRawText('');
  };

  const me = parsedHand?.players?.find((p) => p.isMe);
  const previewNodes = [];
  if (parsedHand?.tableName) previewNodes.push(<span key="table">Table: {parsedHand.tableName}</span>);
  if (parsedHand?.handId) previewNodes.push(<span key="hand">Hand: #{parsedHand.handId}</span>);
  if (parsedHand?.potSize != null) previewNodes.push(<span key="pot">Pot: ${parsedHand.potSize.toFixed(2)}</span>);
  if (parsedHand?.start) previewNodes.push(<span key="start">Start: {parsedHand.start}</span>);
  if (parsedHand?.actions?.length) previewNodes.push(<span key="actions">{parsedHand.actions.length} actions</span>);
  if (me != null && me.winLoss != null) {
    const wl = me.winLoss >= 0 ? '+' : '';
    previewNodes.push(
      <span key="result">
        Your result: <span className={me.winLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}>{wl}${me.winLoss.toFixed(2)}</span>
      </span>
    );
  }

  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8">
      <h2 className="text-lg font-medium text-slate-700 mb-4">Import hand history</h2>
      <p className="text-slate-500 text-sm mb-3">
        Paste a hand from Ignition Casino (copy the full hand history from the client). Each action will be stored.
      </p>
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        rows={8}
        placeholder="Paste Ignition hand history here…"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-y"
      />
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={handleParse}
          className="px-4 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300 transition"
        >
          Parse & preview
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!parsedHand}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save hand
        </button>
      </div>
      {parsedHand && (
        <>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-medium text-slate-700 mb-2">Preview</h3>
            <div className="text-sm text-slate-600 flex flex-wrap gap-x-2 gap-y-1">
              {previewNodes}
            </div>
          </div>
          <HandDetailsForm
            heroCard1={heroCard1}
            heroCard2={heroCard2}
            noFlop={noFlop}
            setNoFlop={setNoFlop}
            flop1={flop1}
            setFlop1={setFlop1}
            flop2={flop2}
            setFlop2={setFlop2}
            flop3={flop3}
            setFlop3={setFlop3}
            turn={turn}
            setTurn={setTurn}
            river={river}
            setRiver={setRiver}
            registerCardPickerTarget={registerCardPickerTarget}
            activeCardTargetId={activeCardTargetId}
          />
        </>
      )}
      {importError && <p className="mt-3 text-sm text-red-600">{importError}</p>}
    </section>
  );
}
