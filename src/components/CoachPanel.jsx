import { useEffect, useMemo, useRef, useState } from 'react';
import { streamCoachHand } from '../lib/coachStreamClient.js';
import { createCoachDiagnosticsState, reduceCoachDiagnostics } from '../lib/coachStreamDiagnostics.js';
import { formatDurationMs } from '../lib/normalizeStreamDiagnostics.js';

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

function toTitleCase(value) {
  const text = String(value || '').trim();
  if (!text) return 'Unknown';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function verdictClasses(verdict) {
  switch (verdict) {
    case 'correct':
      return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
    case 'mixed':
      return 'bg-amber-100 text-amber-700 border border-amber-200';
    case 'incorrect':
      return 'bg-rose-100 text-rose-700 border border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-200';
  }
}

function coachAttemptStatusLabel(attempt) {
  const state = String(attempt?.state || 'pending');
  if (state === 'running') return 'Running';
  if (state === 'completed') return 'Completed';
  if (state === 'failed') {
    if (Number.isFinite(Number(attempt?.status))) return `Failed (${Number(attempt.status)})`;
    if (attempt?.reason) return `Failed (${String(attempt.reason).replace(/_/g, ' ')})`;
    return 'Failed';
  }
  return 'Pending';
}

function coachAttemptDurationLabel(attempt, nowMs) {
  if (attempt?.durationMs != null) return formatDurationMs(attempt.durationMs);
  if (String(attempt?.state || '') !== 'running') return null;
  if (!Number.isFinite(Number(attempt?.startedAtMs))) return null;
  return formatDurationMs(Math.max(0, nowMs - Number(attempt.startedAtMs)));
}

function coachStrategyLabel(strategy) {
  if (!strategy) return null;
  return String(strategy).replace(/_/g, ' ');
}

function PlannedOrderDisclosure({ plannedOrder, strategy, tone = 'emerald' }) {
  if (!Array.isArray(plannedOrder) || plannedOrder.length === 0) return null;
  const textClass = tone === 'slate' ? 'text-slate-500' : 'text-emerald-700';
  const borderClass = tone === 'slate' ? 'border-slate-200 bg-slate-50' : 'border-emerald-200/70 bg-white/50';

  return (
    <details className={`rounded-md border px-2 py-1 ${borderClass}`}>
      <summary className={`cursor-pointer text-xs font-medium ${textClass}`}>
        Planned order ({coachStrategyLabel(strategy) || 'static'}) · {plannedOrder.length} model
        {plannedOrder.length === 1 ? '' : 's'}
      </summary>
      <p className={`mt-1 break-words text-xs ${textClass}`}>{plannedOrder.join(' -> ')}</p>
    </details>
  );
}

function DebugJsonBlock({ label, value }) {
  if (value == null) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-slate-700">{label}</p>
      <textarea
        readOnly
        value={JSON.stringify(value, null, 2)}
        rows={8}
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 font-mono text-[11px] text-slate-700 outline-none"
      />
    </div>
  );
}

function AnalysisDetails({ analysis }) {
  return (
    <div className="mt-3 space-y-3 text-sm text-slate-700">
      <section>
        <p className="font-medium text-slate-800">Overall verdict</p>
        <div className="mt-1 flex items-center gap-2">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${verdictClasses(analysis.overallVerdict)}`}>
            {analysis.overallVerdict}
          </span>
        </div>
        <p className="mt-2 text-slate-600">{analysis.overallReason}</p>
      </section>

      <section>
        <p className="font-medium text-slate-800">Per-street review</p>
        <div className="mt-1 space-y-2">
          {analysis.streetVerdicts.map((item, index) => (
            <div key={`street-${item.street}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-slate-700">{toTitleCase(item.street)}</p>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${verdictClasses(item.verdict)}`}>
                  {item.verdict}
                </span>
              </div>
              <p className="mt-1 text-slate-600"><span className="font-medium text-slate-700">Your action:</span> {item.heroAction}</p>
              <p className="mt-1 text-slate-600"><span className="font-medium text-slate-700">Why:</span> {item.reason}</p>
              <p className="mt-1 text-slate-600"><span className="font-medium text-slate-700">GTO prefers:</span> {item.gtoPreferredAction}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="font-medium text-slate-800">Key adjustments</p>
        <ul className="mt-1 list-disc pl-5 space-y-1 text-slate-600">
          {analysis.keyAdjustments.map((item, index) => (
            <li key={`key-adjustment-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <p className="text-xs uppercase tracking-wide text-slate-500">Confidence: {analysis.confidence}</p>
    </div>
  );
}

export function CoachPanel({ hands, showSaveReminder = true }) {
  const sortedHands = useMemo(
    () => [...hands].sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0)),
    [hands]
  );

  const [selectedHandId, setSelectedHandId] = useState(() => sortedHands[0]?.id || '');
  const [draftMessage, setDraftMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [includeDebug, setIncludeDebug] = useState(false);
  const [chatByHandId, setChatByHandId] = useState({});
  const [coachDiagnosticsByHandId, setCoachDiagnosticsByHandId] = useState({});
  const [coachDiagnosticsNowMs, setCoachDiagnosticsNowMs] = useState(() => Date.now());
  const coachAbortRef = useRef(null);

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
  const coachDiagnostics = coachDiagnosticsByHandId[selectedHandId] || createCoachDiagnosticsState();
  const completedAttemptCount = coachDiagnostics.attempts.filter((attempt) => attempt.state !== 'running').length;

  useEffect(() => {
    if (!isSubmitting) return undefined;
    const timer = window.setInterval(() => {
      setCoachDiagnosticsNowMs(Date.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, [isSubmitting]);

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
    setCoachDiagnosticsNowMs(Date.now());
    setCoachDiagnosticsByHandId((prev) => ({
      ...prev,
      [targetHandId]: createCoachDiagnosticsState(),
    }));
    const abortController = new AbortController();
    coachAbortRef.current = abortController;

    try {
      const response = await streamCoachHand(
        {
          handId: targetHandId,
          hand: selectedHand,
          message,
          history,
          includeDebug,
        },
        {
          signal: abortController.signal,
          onEvent: async (event) => {
            setCoachDiagnosticsByHandId((prev) => ({
              ...prev,
              [targetHandId]: reduceCoachDiagnostics(prev[targetHandId], event, { nowMs: Date.now() }),
            }));
          },
        }
      );

      const assistantMessage = {
        id: makeMessageId(),
        role: 'assistant',
        content: response.assistant.content,
        analysis: response.assistant.analysis,
        followupHighlights: response.assistant.followupHighlights || [],
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
      if (abortController.signal.aborted) {
        setError('Coach request stopped.');
        return;
      }
      setCoachDiagnosticsByHandId((prev) => ({
        ...prev,
        [targetHandId]: reduceCoachDiagnostics(
          prev[targetHandId],
          { type: 'error', message: submitError?.message || 'Coach request failed.' },
          { nowMs: Date.now() }
        ),
      }));
      setError(submitError?.message || 'Coach request failed.');
    } finally {
      if (coachAbortRef.current === abortController) {
        coachAbortRef.current = null;
      }
      setIsSubmitting(false);
    }
  };

  const handleStopCoach = () => {
    coachAbortRef.current?.abort();
  };

  return (
    <section className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-lg font-medium text-slate-700 mb-2">Coach</h2>
      <p className="text-sm text-slate-500 mb-4">
        Ask for GTO-focused coaching in plain language. Coach remembers only the last {HISTORY_WINDOW_SIZE} messages for context.
      </p>
      {showSaveReminder && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-sm font-medium text-amber-900">Coach only works on saved hands.</p>
          <p className="mt-1 text-sm text-amber-800">
            If you just entered or edited a hand above, click <span className="font-medium">Save Hand</span> first. The coach can only analyze hands that already exist in your saved hand list.
          </p>
        </div>
      )}

      {sortedHands.length === 0 ? (
        <p className="text-sm text-slate-400">Save at least one hand to start coaching.</p>
      ) : (
        <>
          <label className="block text-sm font-medium text-slate-600 mb-1">Hand to analyze</label>
          <p className="text-xs text-slate-500 mb-2">
            Newly entered hands will not appear here until you save them.
          </p>
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
                    {!entry.analysis && Array.isArray(entry.followupHighlights) && entry.followupHighlights.length > 0 && (
                      <div className="mt-3">
                        <p className="font-medium text-slate-800">Followup highlights</p>
                        <ul className="mt-1 list-disc pl-5 space-y-1 text-slate-600">
                          {entry.followupHighlights.map((item, index) => (
                            <li key={`followup-${entry.id}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(entry.warnings) && entry.warnings.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 space-y-1">
                        {entry.warnings.map((warning, index) => (
                          <li key={`warning-${entry.id}-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    {entry.meta && (
                      <div className="mt-3 space-y-1 text-xs text-slate-500">
                        <p>
                          Model: {entry.meta.model} ({entry.meta.provider})
                          {entry.meta.fallbackUsed ? ' · fallback used' : ''}
                          {entry.meta.truncatedHistory ? ` · last ${entry.meta.historyWindowUsed} messages` : ''}
                          {entry.meta.responseMode ? ` · ${entry.meta.responseMode}` : ''}
                        </p>
                        {entry.meta.timings?.providerMs != null && (
                          <p>
                            AI time: {formatDurationMs(entry.meta.timings.providerMs)}. Total:{' '}
                            {formatDurationMs(entry.meta.timings.totalMs)}.
                          </p>
                        )}
                        <PlannedOrderDisclosure
                          plannedOrder={entry.meta.modelSelection?.plannedOrder}
                          strategy={entry.meta.modelSelection?.strategy}
                          tone="slate"
                        />
                        {entry.meta.modelSelection?.stopReason && (
                          <p>Stop reason: {entry.meta.modelSelection.stopReason.replace(/_/g, ' ')}</p>
                        )}
                        {Array.isArray(entry.meta.failedModelAttempts) && entry.meta.failedModelAttempts.length > 0 && (
                          <p>
                            Fallback attempts:{' '}
                            {entry.meta.failedModelAttempts
                              .map((attempt) => {
                                const statusLabel = Number.isFinite(Number(attempt?.status))
                                  ? Number(attempt.status)
                                  : attempt?.reason || 'unknown';
                                return `${attempt.model} (${statusLabel})`;
                              })
                              .join(', ')}
                          </p>
                        )}
                        {entry.meta.attemptSummary && entry.meta.attemptSummary !== 'none' && (
                          <p>Attempt summary: {entry.meta.attemptSummary}</p>
                        )}
                        {Array.isArray(entry.meta.attempts) && entry.meta.attempts.length > 0 && (
                          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                            <p className="text-[11px] font-medium text-slate-700">Attempt timeline</p>
                            <div className="mt-1 space-y-1">
                              {entry.meta.attempts.map((attempt) => (
                                <div
                                  key={`${entry.id}-${attempt.pass}-${attempt.attemptIndex || attempt.model}`}
                                  className="flex items-center justify-between gap-3 text-[11px] text-slate-600"
                                >
                                  <span>
                                    {attempt.pass === 'repair' ? 'Repair ' : ''}
                                    {attempt.attemptIndex ? `${attempt.attemptIndex}. ` : ''}
                                    {attempt.model || 'Unknown model'} · {coachAttemptStatusLabel(attempt)}
                                  </span>
                                  <span>{coachAttemptDurationLabel(attempt, coachDiagnosticsNowMs) || '...'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {entry.meta.debug && (
                          <details className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                            <summary className="cursor-pointer text-[11px] font-medium text-slate-700">
                              Debug payload
                            </summary>
                            <div className="mt-2 space-y-2">
                              <DebugJsonBlock label="Submitted hand" value={entry.meta.debug.submittedHand} />
                              <DebugJsonBlock label="Derived hand context" value={entry.meta.debug.handContext} />
                              <DebugJsonBlock label="Outbound LLM messages" value={entry.meta.debug.messages} />
                              <DebugJsonBlock label="Returned fact check" value={entry.analysis?.factCheck || null} />
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {(isSubmitting || coachDiagnostics.attempts.length > 0 || coachDiagnostics.finalResponse) && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
              <p className="text-xs font-medium text-emerald-800">
                {isSubmitting ? 'Coach request diagnostics' : 'Last coach request diagnostics'}
              </p>
              <div className="mt-1 space-y-1 text-xs text-emerald-700">
                <PlannedOrderDisclosure
                  plannedOrder={coachDiagnostics.plannedOrder}
                  strategy={coachDiagnostics.strategy}
                />
                {isSubmitting && coachDiagnostics.totalModels > 0 && (
                  <p>
                    Coach running: {completedAttemptCount} of {coachDiagnostics.totalModels} attempts finished.
                  </p>
                )}
                {coachDiagnostics.repairStarted && (
                  <p>Repair retry started after invalid output from the first pass.</p>
                )}
                {coachDiagnostics.finalResponse?.meta?.timings?.providerMs != null && (
                  <p>
                    AI time: {formatDurationMs(coachDiagnostics.finalResponse.meta.timings.providerMs)}. Total:{' '}
                    {formatDurationMs(coachDiagnostics.finalResponse.meta.timings.totalMs)}.
                  </p>
                )}
                {coachDiagnostics.finalResponse?.meta?.model && (
                  <p>
                    Final model: {coachDiagnostics.finalResponse.meta.model}
                    {coachDiagnostics.finalResponse.meta.fallbackUsed ? ' (fallback used)' : ''}
                  </p>
                )}
                {coachDiagnostics.finalResponse?.meta?.modelSelection?.stopReason && (
                  <p>
                    Stop reason:{' '}
                    {coachDiagnostics.finalResponse.meta.modelSelection.stopReason.replace(/_/g, ' ')}
                  </p>
                )}
              </div>
              {coachDiagnostics.attempts.length > 0 && (
                <div className="mt-2 rounded-md border border-white/70 bg-white/70 px-2 py-2">
                  <p className="text-[11px] font-medium text-slate-700">Attempt timeline</p>
                  <div className="mt-1 space-y-1">
                    {coachDiagnostics.attempts.map((attempt) => (
                      <div
                        key={`${selectedHandId}-${attempt.pass}-${attempt.attemptIndex || attempt.model}-${attempt.state}`}
                        className="flex items-center justify-between gap-3 text-[11px] text-slate-600"
                      >
                        <span>
                          {attempt.pass === 'repair' ? 'Repair ' : ''}
                          {attempt.attemptIndex ? `${attempt.attemptIndex}. ` : ''}
                          {attempt.model || 'Unknown model'} · {coachAttemptStatusLabel(attempt)}
                        </span>
                        <span>{coachAttemptDurationLabel(attempt, coachDiagnosticsNowMs) || '...'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={includeDebug}
                    onChange={(event) => setIncludeDebug(event.target.checked)}
                    disabled={isSubmitting}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Include debug payload
                </label>
                <div className="flex items-center gap-2">
                {isSubmitting && (
                  <button
                    type="button"
                    onClick={handleStopCoach}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition"
                  >
                    Stop
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting || !selectedHand}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Coaching…' : 'Get coaching'}
                  </button>
                </div>
              </div>
            </div>
          </form>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </>
      )}
    </section>
  );
}
