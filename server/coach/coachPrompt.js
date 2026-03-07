import { HISTORY_WINDOW_SIZE } from './coachSchema.js';

const RESPONSE_SHAPE_REFERENCE = {
  assistant: {
    content: 'Short plain-language summary for the user.',
    analysis: {
      overallVerdict: 'mixed',
      overallReason: 'The preflop call is defendable, but flop passivity misses EV.',
      streetVerdicts: [
        {
          street: 'preflop',
          heroAction: 'Call BB versus open',
          verdict: 'correct',
          reason: 'Defending this combo at this stack depth is standard.',
          gtoPreferredAction: 'Mix call and occasional 3-bet at low frequency.',
        },
        {
          street: 'flop',
          heroAction: 'Check back',
          verdict: 'incorrect',
          reason: 'This board favors your range enough to c-bet more often.',
          gtoPreferredAction: 'Use a small c-bet at higher frequency.',
        },
      ],
      biggestLeaks: ['Leak 1', 'Leak 2'],
      gtoCorrections: ['Correction 1', 'Correction 2'],
      topAlternatives: ['Alternative line 1', 'Alternative line 2'],
      exploitativeAdjustments: ['Adjustment 1', 'Adjustment 2'],
      confidence: 'medium',
    },
  },
};

const SYSTEM_PROMPT = [
  'You are an elite poker coach and Game Theory Optimal (GTO) specialist.',
  'You explain advanced strategy in accessible, beginner-friendly language without dumbing down key concepts.',
  'Use concrete recommendations tied to the exact hand context provided.',
  'Judge whether each hero action is correct, mixed, incorrect, or unclear, and explain why.',
  'Respond with JSON only. No markdown, no prose outside JSON, no code fences.',
  'Return exactly one JSON object matching this structure and field types:',
  JSON.stringify(RESPONSE_SHAPE_REFERENCE, null, 2),
  'Rules:',
  '- Keep assistant.content concise (2-4 sentences).',
  '- Ensure every required field is present.',
  '- overallVerdict and each streetVerdicts[].verdict must be one of: correct, mixed, incorrect, unclear.',
  '- confidence must be one of: low, medium, high.',
  '- biggestLeaks/gtoCorrections/topAlternatives/exploitativeAdjustments must always be arrays of strings.',
  '- topAlternatives must contain exactly 2 items.',
  '- streetVerdicts must include each street where heroStreetSummary in context has a non-null action.',
  '- For each street verdict, reason must explicitly evaluate the hero action (for example: "Flop check is incorrect because...").',
  '- Avoid vague filler phrases and avoid generic advice that is not tied to the hand.',
  '- If details are missing, use verdict "unclear" and state what is missing in overallReason or street reason.',
].join('\n');

function createContextMessage(handContext, message, historyWindowSize = HISTORY_WINDOW_SIZE) {
  return [
    'Analyze this poker hand context and user request.',
    `Only the last ${historyWindowSize} prior chat messages are included for context.`,
    'Hand context JSON:',
    JSON.stringify(handContext, null, 2),
    'User request:',
    message,
  ].join('\n\n');
}

export function buildCoachMessages({ handContext, history, message, historyWindowSize = HISTORY_WINDOW_SIZE }) {
  const priorHistory = Array.isArray(history)
    ? history
        .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
        .map((item) => ({ role: item.role, content: String(item.content || '').trim() }))
        .filter((item) => item.content)
    : [];

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: createContextMessage(handContext, message, historyWindowSize),
    },
    ...priorHistory,
    {
      role: 'user',
      content: message,
    },
  ];
}

export function buildCoachRepairMessages({
  handContext,
  history,
  message,
  previousOutput,
  validationError,
  historyWindowSize = HISTORY_WINDOW_SIZE,
}) {
  const repairInstruction = [
    'Your previous answer was invalid JSON or did not match the required schema.',
    `Validation issue: ${validationError || 'Unknown schema issue.'}`,
    'Correct your answer and return only valid JSON matching the required schema.',
    'Do not include markdown or extra commentary.',
    'Previous invalid output:',
    String(previousOutput || '').slice(0, 3000),
  ].join('\n\n');

  return [
    ...buildCoachMessages({ handContext, history, message, historyWindowSize }),
    { role: 'user', content: repairInstruction },
  ];
}
