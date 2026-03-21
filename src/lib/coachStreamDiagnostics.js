function cloneAttempt(attempt) {
  return {
    model: attempt?.model || null,
    state: attempt?.state || 'pending',
    reason: attempt?.reason || null,
    status: attempt?.status ?? null,
    durationMs: attempt?.durationMs ?? null,
    attemptIndex: attempt?.attemptIndex ?? null,
    totalModels: attempt?.totalModels ?? null,
    pass: attempt?.pass || 'initial',
    startedAtMs: attempt?.startedAtMs ?? null,
  };
}

export function createCoachDiagnosticsState() {
  return {
    phase: 'idle',
    startedAtMs: null,
    totalModels: 0,
    plannedOrder: [],
    strategy: null,
    attempts: [],
    repairStarted: false,
    finalResponse: null,
    totalMs: null,
    providerMs: null,
    errorMessage: '',
  };
}

function upsertAttempt(attempts, nextAttempt) {
  const next = attempts.map(cloneAttempt);
  const index = next.findIndex((item) => {
    if (nextAttempt.pass && item.pass && nextAttempt.attemptIndex != null && item.attemptIndex != null) {
      return item.pass === nextAttempt.pass && item.attemptIndex === nextAttempt.attemptIndex;
    }
    return item.pass === nextAttempt.pass && item.model && nextAttempt.model && item.model === nextAttempt.model;
  });

  if (index >= 0) {
    next[index] = {
      ...next[index],
      ...nextAttempt,
    };
    return next;
  }

  next.push(cloneAttempt(nextAttempt));
  return next;
}

export function reduceCoachDiagnostics(state, event, options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const current = state || createCoachDiagnosticsState();

  switch (event?.type) {
    case 'selection_plan':
      return {
        ...current,
        phase: 'running',
        startedAtMs: current.startedAtMs ?? nowMs,
        totalModels: event.totalModels ?? current.totalModels,
        plannedOrder: Array.isArray(event.plannedOrder) ? event.plannedOrder : current.plannedOrder,
        strategy: event.strategy || current.strategy,
        errorMessage: '',
      };
    case 'attempt_started':
      return {
        ...current,
        phase: 'running',
        totalModels: event.totalModels ?? current.totalModels,
        attempts: upsertAttempt(current.attempts, {
          model: event.model,
          attemptIndex: event.attemptIndex,
          totalModels: event.totalModels,
          pass: event.pass || 'initial',
          state: 'running',
          startedAtMs: nowMs,
        }),
      };
    case 'attempt_completed':
      return {
        ...current,
        phase: 'running',
        totalModels: event.totalModels ?? current.totalModels,
        attempts: upsertAttempt(current.attempts, {
          model: event.model,
          attemptIndex: event.attemptIndex,
          totalModels: event.totalModels,
          pass: event.pass || 'initial',
          state: event.state || 'completed',
          reason: event.reason || null,
          status: event.status ?? null,
          durationMs: event.durationMs ?? null,
        }),
      };
    case 'repair_started':
      return {
        ...current,
        repairStarted: true,
      };
    case 'final_result':
      return {
        ...current,
        phase: 'complete',
        finalResponse: event.response || current.finalResponse,
        totalMs: event.response?.meta?.timings?.totalMs ?? current.totalMs,
        providerMs: event.response?.meta?.timings?.providerMs ?? current.providerMs,
        attempts:
          Array.isArray(event.response?.meta?.attempts) && event.response.meta.attempts.length > 0
            ? event.response.meta.attempts.map(cloneAttempt)
            : current.attempts,
      };
    case 'error':
      return {
        ...current,
        phase: 'error',
        errorMessage: event.message || current.errorMessage,
      };
    default:
      return current;
  }
}
