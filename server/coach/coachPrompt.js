import { HISTORY_WINDOW_SIZE } from './coachSchema.js';

const HISTORY_PROMPT_CONTENT_LIMIT = 600;

const INITIAL_RESPONSE_SHAPE_REFERENCE = {
  assistant: {
    content: 'Short plain-language summary for the user.',
    analysis: {
      factCheck: {
        heroCards: ['5d', '4d'],
        heroHandCode: '54s',
        heroPosition: 'BB',
        preflopLastAggressorPosition: 'UTG+1',
        heroWasPreflopAggressor: false,
        heroCanCbetFlop: false,
        heroPostflopPosition: 'out_of_position',
      },
      overallVerdict: 'mixed',
      overallReason: 'The preflop call is defendable, but flop passivity misses EV.',
      streetVerdicts: [
        {
          street: 'preflop',
          heroAction: 'Call BB versus open',
          verdict: 'correct',
          reason: 'Defending this combo at this stack depth is standard.',
          gtoPreferredAction: 'Mix call and occasional low-frequency 3-bet.',
        },
      ],
      keyAdjustments: ['Adjustment 1', 'Adjustment 2', 'Adjustment 3'],
      confidence: 'medium',
    },
  },
};

const FOLLOWUP_RESPONSE_SHAPE_REFERENCE = {
  assistant: {
    content: 'Free-form coaching paragraph answering the user followup.',
    followupHighlights: ['Optional short bullet 1', 'Optional short bullet 2'],
  },
};

const INITIAL_SYSTEM_PROMPT = [
  'You are an elite poker coach and Game Theory Optimal (GTO) specialist.',
  'You explain advanced strategy in accessible, beginner-friendly language without dumbing down key concepts.',
  'Use concrete recommendations tied to the exact hand context provided. Never invent facts.',
  'Judge whether each hero action is correct, mixed, incorrect, or unclear, and explain why.',
  'Respond with JSON only. No markdown, no prose outside JSON, no code fences.',
  'Follow a strict 2-stage process before writing any advice:',
  'Stage A (fact check): fill analysis.factCheck exactly from hand context facts.',
  'Stage B (coaching): write verdicts/reasons that must stay consistent with analysis.factCheck.',
  'Return exactly one JSON object matching this structure and field types:',
  JSON.stringify(INITIAL_RESPONSE_SHAPE_REFERENCE, null, 2),
  'Rules:',
  '- Keep assistant.content concise (2-4 sentences).',
  '- Ensure every required field is present.',
  '- analysis.factCheck values must match the hand context exactly.',
  '- If heroCanCbetFlop is false, never recommend hero c-bet/continuation-bet on flop.',
  '- If heroPostflopPosition is out_of_position, never use phrases that imply in-position play (for example "check back").',
  '- Keep suitedness and hand notation consistent with heroCards/heroHandCode.',
  '- overallVerdict and each streetVerdicts[].verdict must be one of: correct, mixed, incorrect, unclear.',
  '- confidence must be one of: low, medium, high.',
  '- keyAdjustments must be an array of 3-5 concise strings.',
  '- Do not use explicit percentages or numeric frequencies. Use qualitative terms like low-frequency / high-frequency.',
  '- streetVerdicts must include each street where heroStreetSummary in context has a non-null action.',
  '- For each street verdict, reason must explicitly evaluate the hero action (for example: "Flop check is incorrect because...").',
  '- Avoid vague filler phrases and avoid generic advice that is not tied to the hand.',
  '- If details are missing, use verdict "unclear" and state what is missing in overallReason or street reason.',
].join('\n');

const FOLLOWUP_SYSTEM_PROMPT = [
  'You are an elite poker coach and Game Theory Optimal (GTO) specialist.',
  'This is a followup turn. Answer the user directly in plain language.',
  'Do not repeat the full structured hand breakdown. Keep the answer focused and concise.',
  'Respond with JSON only. No markdown, no prose outside JSON, no code fences.',
  'Return exactly one JSON object matching this structure:',
  JSON.stringify(FOLLOWUP_RESPONSE_SHAPE_REFERENCE, null, 2),
  'Rules:',
  '- assistant.content must be a direct answer to the latest user question.',
  '- followupHighlights is optional; if provided, use 1-3 short bullet strings.',
  '- Stay consistent with the provided hand context facts and prior chat context.',
  '- If heroCanCbetFlop is false, never recommend hero c-bet/continuation-bet on flop.',
  '- If heroPostflopPosition is out_of_position, never imply in-position lines such as "check back".',
  '- Keep suitedness and position claims consistent with hand context.',
  '- Do not use explicit percentages or numeric frequencies.',
].join('\n');

function trimPromptText(value, maxChars = HISTORY_PROMPT_CONTENT_LIMIT) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function createContextMessage(handContext, historyWindowSize = HISTORY_WINDOW_SIZE, responseMode = 'analysis') {
  return [
    responseMode === 'followup'
      ? 'Answer a followup question about this poker hand context.'
      : 'Analyze this poker hand context.',
    `Only the last ${historyWindowSize} prior chat messages are included for context.`,
    'Hand context JSON:',
    JSON.stringify(handContext, null, 2),
  ].join('\n\n');
}

function buildHistoryMessages(history) {
  const priorHistory = Array.isArray(history)
    ? history
        .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
        .map((item) => ({ role: item.role, content: trimPromptText(item.content) }))
        .filter((item) => item.content)
    : [];

  return priorHistory;
}

export function buildInitialCoachMessages({ handContext, history, message, historyWindowSize = HISTORY_WINDOW_SIZE }) {
  return [
    { role: 'system', content: INITIAL_SYSTEM_PROMPT },
    {
      role: 'user',
      content: createContextMessage(handContext, historyWindowSize, 'analysis'),
    },
    ...buildHistoryMessages(history),
    {
      role: 'user',
      content: message,
    },
  ];
}

export function buildFollowupCoachMessages({ handContext, history, message, historyWindowSize = HISTORY_WINDOW_SIZE }) {
  return [
    { role: 'system', content: FOLLOWUP_SYSTEM_PROMPT },
    {
      role: 'user',
      content: createContextMessage(handContext, historyWindowSize, 'followup'),
    },
    ...buildHistoryMessages(history),
    {
      role: 'user',
      content: message,
    },
  ];
}

export function buildInitialCoachRepairMessages({
  handContext,
  history,
  message,
  previousOutput,
  validationError,
  validationFailures,
  historyWindowSize = HISTORY_WINDOW_SIZE,
}) {
  const safeValidationFailures = Array.isArray(validationFailures)
    ? validationFailures.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
    : [];

  const requiredFactCheck = handContext?.factCheckGroundTruth || {};

  const shapeReference = {
    ...INITIAL_RESPONSE_SHAPE_REFERENCE,
    assistant: {
      ...INITIAL_RESPONSE_SHAPE_REFERENCE.assistant,
      analysis: {
        ...INITIAL_RESPONSE_SHAPE_REFERENCE.assistant.analysis,
        factCheck: {
          heroCards: Array.isArray(requiredFactCheck.heroCards) ? requiredFactCheck.heroCards : ['5d', '4d'],
          heroHandCode: requiredFactCheck.heroHandCode || '54s',
          heroPosition: requiredFactCheck.heroPosition || 'BB',
          preflopLastAggressorPosition: requiredFactCheck.preflopLastAggressorPosition || 'UTG+1',
          heroWasPreflopAggressor: Boolean(requiredFactCheck.heroWasPreflopAggressor),
          heroCanCbetFlop: Boolean(requiredFactCheck.heroCanCbetFlop),
          heroPostflopPosition: requiredFactCheck.heroPostflopPosition || 'unknown',
        },
      },
    },
  };

  const repairInstruction = [
    'Your previous answer was invalid JSON or did not match the required schema.',
    `Validation issue: ${validationError || 'Unknown schema issue.'}`,
    safeValidationFailures.length > 0
      ? `Validation failures to fix exactly:\n- ${safeValidationFailures.join('\n- ')}`
      : 'Validation failures to fix exactly: unknown (must still satisfy full schema).',
    'Critical requirement: analysis.factCheck must be present and must match hand context ground truth exactly.',
    'Critical requirement: if heroCanCbetFlop is false, never recommend hero c-bet/continuation-bet on the flop.',
    'Critical requirement: if heroPostflopPosition is out_of_position, never imply in-position lines such as check back.',
    'Critical requirement: use no numeric percentages anywhere.',
    'Critical requirement: include keyAdjustments only (do not include old fields like biggestLeaks/gtoCorrections/topAlternatives/exploitativeAdjustments).',
    'Return exactly one JSON object in this shape (no markdown):',
    JSON.stringify(shapeReference, null, 2),
    'Correct your answer and return only valid JSON matching the required schema.',
    'Do not include markdown or extra commentary.',
    'Previous invalid output:',
    String(previousOutput || '').slice(0, 3000),
  ].join('\n\n');

  return [
    ...buildInitialCoachMessages({ handContext, history, message, historyWindowSize }),
    { role: 'user', content: repairInstruction },
  ];
}

export function buildFollowupCoachRepairMessages({
  handContext,
  history,
  message,
  previousOutput,
  validationError,
  validationFailures,
  historyWindowSize = HISTORY_WINDOW_SIZE,
}) {
  const safeValidationFailures = Array.isArray(validationFailures)
    ? validationFailures.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
    : [];

  const repairInstruction = [
    'Your previous answer was invalid JSON or did not match the required schema.',
    `Validation issue: ${validationError || 'Unknown schema issue.'}`,
    safeValidationFailures.length > 0
      ? `Validation failures to fix exactly:\n- ${safeValidationFailures.join('\n- ')}`
      : 'Validation failures to fix exactly: unknown (must still satisfy full schema).',
    'Return exactly one JSON object in this shape (no markdown):',
    JSON.stringify(FOLLOWUP_RESPONSE_SHAPE_REFERENCE, null, 2),
    'assistant.content is required. followupHighlights is optional.',
    'Correct your answer and return only valid JSON.',
    'Previous invalid output:',
    String(previousOutput || '').slice(0, 3000),
  ].join('\n\n');

  return [
    ...buildFollowupCoachMessages({ handContext, history, message, historyWindowSize }),
    { role: 'user', content: repairInstruction },
  ];
}

export const buildCoachMessages = buildInitialCoachMessages;
export const buildCoachRepairMessages = buildInitialCoachRepairMessages;
