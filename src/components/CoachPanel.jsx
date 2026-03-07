import { useEffect, useMemo, useState } from 'react';
import { coachHand } from '../lib/coachClient.js';

const HISTORY_WINDOW_SIZE = 8;

function formatCreatedAt(value) {
  if (!Number.isFinite(value)) return 'Unknown date';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return 'Unknown date';
  }
}

function buildHandLabel(hand) {
  const cards = Array.isArray(hand?.hero?.cards) && hand.hero.cards.length > 0
    ? hand.hero.cards.join(' ')
    : 'Unknown cards';
  const position = hand?.hero?.position || 'Unknown position';
  const netBb = typeof hand?.result?.netBb === 'number'
    ? `${hand.result.netBb >= 0 ? '+' : ''}${hand.result.netBb.toFixed(1)}bb`
    : '—bb';
  return `${cards} · ${position} · ${netBb} · ${formatCreatedAt(hand?.createdAt)}`;
}

function makeMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function AnalysisDetails({ analysis }) {
  return (
    <div className="mt-3 space-y-3 text-sm text-slate-700">
      <section>
        <p className="font-medium text-slate-800">Situation summary</p>
        <p className="mt-1 text-slate-600">{analysis.situationSummary}</p>
      </section>

      <section>
        <p className="font-medium text-slate-800">Biggest leaks</p>
        <ul className="mt-1 list-disc pl-5 space-y-1 text-slate-600">
          {analysis.biggestLeaks.map((item, index) => (
            <li key={`leak-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <p className="font-medium text-slate-800">GTO corrections</p>
        <ul className="mt-1 list-disc pl-5 space-y-1 text-slate-600">
          {analysis.gtoCorrections.map((item, index) => (
            <li key={`gto-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <p className="font-medium text-slate-800">Street plan</p>
        <div className="mt-1 grid gap-1 text-slate-600 sm:grid-cols-2">
          <p><span className="font-medium text-slate-700">Preflop:</span> {analysis.streetPlan.preflop}</p>
          <p><span className="font-medium text-slate-700">Flop:</span> {analysis.streetPlan.flop}</p>
          <p><span className="font-medium text-slate-700">Turn:</span> {analysis.streetPlan.turn}</p>
          <p><span className="font-medium text-slate-700">River:</span> {analysis.streetPlan.river}</p>
        </div>
      </section>

      <section>
        <p className="font-medium text-slate-800">Exploitative adjustments</p>
        <ul className="mt-1 list-disc pl-5 space-y-1 text-slate-600">
          {analysis.exploitativeAdjustments.map((item, index) => (
            <li key={`exploit-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <p className="font-medium text-slate-800">Practice drills</p>
        <ul className="mt-1 list-disc pl-5 space-y-1 text-slate-600">
          {analysis.practiceDrills.map((item, index) => (
            <li key={`drill-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <p className="font-medium text-slate-800">Next session focus</p>
        <p className="mt-1 text-slate-600">{analysis.nextSessionFocus}</p>
      </section>

      <section>
        <p className="font-medium text-slate-800">Assumptions</p>
        <ul className="mt-1 list-disc pl-5 space-y-1 text-slate-600">
          {analysis.assumptions.map((item, index) => (
            <li key={`assumption-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <p className="text-xs uppercase tracking-wide text-slate-500">Confidence: {analysis.confidence}</p>
    </div>
  );
}

export function CoachPanel({ hands }) {
  const sortedHands = useMemo(
    () => [...hands].sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0)),
    [hands]
  );

  const [selectedHandId, setSelectedHandId] = useState(() => sortedHands[0]?.id || '');
  const [draftMessage, setDraftMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [chatByHandId, setChatByHandId] = useState({});

  useEffect(() => {
    if (sortedHands.length === 0) {
      setSelectedHandId('');
      return;
    }

    const exists = sortedHands.some((hand) => hand.id === selectedHandId);
    if (!exists) {
      setSelectedHandId(sortedHands[0].id);
    }
  }, [sortedHands, selectedHandId]);

  const selectedHand = sortedHands.find((hand) => hand.id === selectedHandId) || null;
  const thread = chatByHandId[selectedHandId] || [];

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const message = draftMessage.trim();
    if (!selectedHand) {
      setError('Select a saved hand first.');
      return;
    }
    if (!message) {
      setError('Enter a question or prompt for the coach.');
      return;
    }

    const targetHandId = selectedHand.id;
    const currentThread = chatByHandId[targetHandId] || [];
    const history = currentThread
      .slice(-HISTORY_WINDOW_SIZE)
      .map((entry) => ({ role: entry.role, content: entry.content }));

    const userMessage = {
      id: makeMessageId(),
      role: 'user',
      content: message,
    };

    setChatByHandId((prev) => {
      const existing = prev[targetHandId] || [];
      return {
        ...prev,
        [targetHandId]: [...existing, userMessage],
      };
    });

    setDraftMessage('');
    setIsSubmitting(true);

    try {
      const response = await coachHand({
        handId: targetHandId,
        hand: selectedHand,
        message,
        history,
      });

      const assistantMessage = {
        id: makeMessageId(),
        role: 'assistant',
        content: response.assistant.content,
        analysis: response.assistant.analysis,
        meta: response.meta,
        warnings: response.warnings || [],
      };

      setChatByHandId((prev) => {
        const existing = prev[targetHandId] || [];
        return {
          ...prev,
          [targetHandId]: [...existing, assistantMessage],
        };
      });
    } catch (submitError) {
      setError(submitError?.message || 'Coach request failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-lg font-medium text-slate-700 mb-2">Coach</h2>
      <p className="text-sm text-slate-500 mb-4">
        Ask for GTO-focused coaching in plain language. Coach remembers only the last {HISTORY_WINDOW_SIZE} messages for context.
      </p>

      {sortedHands.length === 0 ? (
        <p className="text-sm text-slate-400">Save at least one hand to start coaching.</p>
      ) : (
        <>
          <label className="block text-sm font-medium text-slate-600 mb-1">Hand to analyze</label>
          <select
            value={selectedHandId}
            onChange={(event) => setSelectedHandId(event.target.value)}
            disabled={isSubmitting}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
          >
            {sortedHands.map((hand) => (
              <option key={hand.id} value={hand.id}>
                {buildHandLabel(hand)}
              </option>
            ))}
          </select>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-[28rem] overflow-y-auto space-y-3">
            {thread.length === 0 ? (
              <p className="text-sm text-slate-400">No coach messages yet for this hand.</p>
            ) : (
              thread.map((entry) => {
                if (entry.role === 'user') {
                  return (
                    <div key={entry.id} className="flex justify-end">
                      <div className="max-w-[90%] rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm">
                        {entry.content}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={entry.id} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm">
                    <p className="text-slate-800 font-medium">Coach summary</p>
                    <p className="mt-1 text-slate-700">{entry.content}</p>
                    {entry.analysis && <AnalysisDetails analysis={entry.analysis} />}
                    {Array.isArray(entry.warnings) && entry.warnings.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 space-y-1">
                        {entry.warnings.map((warning, index) => (
                          <li key={`warning-${entry.id}-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    {entry.meta && (
                      <p className="mt-3 text-xs text-slate-500">
                        Model: {entry.meta.model} ({entry.meta.provider})
                        {entry.meta.fallbackUsed ? ' · fallback used' : ''}
                        {entry.meta.truncatedHistory ? ` · last ${entry.meta.historyWindowUsed} messages` : ''}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-2">
            <label className="block text-sm font-medium text-slate-600">Prompt for coach</label>
            <textarea
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Where did I deviate most from GTO in this hand?"
              disabled={isSubmitting}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-y"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">{draftMessage.length}/2000</p>
              <button
                type="submit"
                disabled={isSubmitting || !selectedHand}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Coaching…' : 'Get coaching'}
              </button>
            </div>
          </form>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </>
      )}
    </section>
  );
}
