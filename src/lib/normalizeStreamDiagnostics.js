function cloneAttempt(attempt) {
  return {
    model: attempt?.model || null,
    state: attempt?.state || 'pending',
    reason: attempt?.reason || null,
    status: attempt?.status ?? null,
    durationMs: attempt?.durationMs ?? null,
    overallConfidence: attempt?.overallConfidence ?? null,
    missingRequiredCount: attempt?.missingRequiredCount ?? null,
    attemptIndex: attempt?.attemptIndex ?? null,
    startedAtMs: attempt?.startedAtMs ?? null,
  };
}

export function createNormalizeDiagnosticsState() {
  return {
    phase: 'idle',
    startedAtMs: null,
    deterministicMs: null,
    totalMs: null,
    providerMs: null,
    totalModels: 0,
    attempts: [],
    provisionalResponse: null,
    provisionalModel: null,
    finalResponse: null,
    errorMessage: '',
  };
}

function upsertAttempt(attempts, nextAttempt) {
  const next = attempts.map(cloneAttempt);
  const index = next.findIndex((item) => {
    if (nextAttempt.attemptIndex != null && item.attemptIndex != null) {
      return item.attemptIndex === nextAttempt.attemptIndex;
    }
    return item.model && nextAttempt.model && item.model === nextAttempt.model;
  });

  if (index >= 0) {
    next[index] = {
      ...next[index],
      ...nextAttempt,
    };
    return next;
  }

  next.push(cloneAttempt(nextAttempt));
  next.sort((left, right) => {
    const leftIndex = Number.isFinite(Number(left.attemptIndex)) ? Number(left.attemptIndex) : Number.MAX_SAFE_INTEGER;
    const rightIndex = Number.isFinite(Number(right.attemptIndex)) ? Number(right.attemptIndex) : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
  return next;
}

export function reduceNormalizeDiagnostics(state, event, options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const current = state || createNormalizeDiagnosticsState();

  switch (event?.type) {
    case 'deterministic_started':
      return {
        ...current,
        phase: 'deterministic',
        startedAtMs: nowMs,
        errorMessage: '',
      };
    case 'deterministic_completed':
      return {
        ...current,
        phase: 'deterministic_complete',
        deterministicMs: event.durationMs ?? current.deterministicMs,
      };
    case 'attempt_started':
      return {
        ...current,
        phase: 'ai_running',
        totalModels: event.totalModels ?? current.totalModels,
        attempts: upsertAttempt(current.attempts, {
          model: event.model,
          attemptIndex: event.attemptIndex,
          state: 'running',
          startedAtMs: nowMs,
        }),
      };
    case 'attempt_completed':
      return {
        ...current,
        phase: 'ai_running',
        totalModels: event.totalModels ?? current.totalModels,
        attempts: upsertAttempt(current.attempts, {
          model: event.model,
          attemptIndex: event.attemptIndex,
          state: event.state || 'completed',
          reason: event.reason || null,
          status: event.status ?? null,
          durationMs: event.durationMs ?? null,
          overallConfidence: event.overallConfidence ?? null,
          missingRequiredCount: event.missingRequiredCount ?? null,
        }),
      };
    case 'provisional_result':
      return {
        ...current,
        phase: 'provisional',
        provisionalResponse: event.response || current.provisionalResponse,
        provisionalModel: event.model || current.provisionalModel,
      };
    case 'final_result': {
      const timings = event.response?.meta?.timings || null;
      return {
        ...current,
        phase: 'complete',
        finalResponse: event.response || current.finalResponse,
        totalMs: timings?.totalMs ?? current.totalMs,
        providerMs: timings?.providerMs ?? current.providerMs,
        deterministicMs: timings?.deterministicMs ?? current.deterministicMs,
        attempts: Array.isArray(event.response?.meta?.attempts) && event.response.meta.attempts.length > 0
          ? event.response.meta.attempts.map(cloneAttempt)
          : current.attempts,
      };
    }
    case 'error':
      return {
        ...current,
        errorMessage: event.message || current.errorMessage,
      };
    default:
      return current;
  }
}

export function formatDurationMs(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < 0) return null;
  if (duration < 1000) return `${Math.round(duration)}ms`;
  return `${(duration / 1000).toFixed(duration >= 10_000 ? 0 : 1)}s`;
}
