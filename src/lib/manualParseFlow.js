export const AI_FALLBACK_CONFIDENCE_THRESHOLD = 0.75;

function hasFilledAction(action) {
  const text = String(action || '').trim().toLowerCase();
  return Boolean(text) && text !== 'none';
}

export function filterSatisfiedManualMissingFields(missingRequired, snapshot = {}) {
  const missing = Array.isArray(missingRequired) ? missingRequired : [];

  return missing.filter((field) => {
    if (field === 'hero.cards') {
      return !(snapshot.heroCard1 && snapshot.heroCard2);
    }
    if (field === 'hero.position') {
      return !snapshot.heroPosition;
    }
    if (field === 'board.didReachFlop') {
      return !snapshot.didReachFlopFilled;
    }
    if (field === 'result.netBb') {
      return snapshot.netBb == null || snapshot.netBb === '';
    }

    const streetMatch = field.match(/^heroStreetSummary\.(preflop|flop|turn|river)\.action$/);
    if (streetMatch?.[1]) {
      return !hasFilledAction(snapshot[`${streetMatch[1]}Action`]);
    }

    return true;
  });
}

export function shouldOfferManualAiAssist(parseResult) {
  if (!parseResult) return false;
  const remainingMissingRequired = Array.isArray(parseResult.remainingMissingRequired)
    ? parseResult.remainingMissingRequired
    : [];
  const overallConfidence = Number(parseResult.parsed?.confidence?.overall ?? 0);
  return remainingMissingRequired.length > 0 || overallConfidence < AI_FALLBACK_CONFIDENCE_THRESHOLD;
}
