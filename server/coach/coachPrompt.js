import { HISTORY_WINDOW_SIZE } from './coachSchema.js';

const RESPONSE_SHAPE_REFERENCE = {
  assistant: {
    content: 'Short plain-language summary for the user.',
    analysis: {
      situationSummary: 'What happened in this hand and why it matters.',
      biggestLeaks: ['Leak 1', 'Leak 2'],
      gtoCorrections: ['Correction 1', 'Correction 2'],
      streetPlan: {
        preflop: 'Preflop guidance',
        flop: 'Flop guidance',
        turn: 'Turn guidance',
        river: 'River guidance',
      },
      exploitativeAdjustments: ['Adjustment 1', 'Adjustment 2'],
      practiceDrills: ['Drill 1', 'Drill 2'],
      nextSessionFocus: 'One focus for the next session.',
      confidence: 'low',
      assumptions: ['Assumption 1'],
    },
  },
};

const SYSTEM_PROMPT = [
  'You are an elite poker coach and Game Theory Optimal (GTO) specialist.',
  'You explain advanced strategy in accessible, beginner-friendly language without dumbing down key concepts.',
  'Use concrete recommendations tied to the exact hand context provided.',
  'Never claim certainty when data is missing; list assumptions explicitly.',
  'Respond with JSON only. No markdown, no prose outside JSON, no code fences.',
  'Return exactly one JSON object matching this structure and field types:',
  JSON.stringify(RESPONSE_SHAPE_REFERENCE, null, 2),
  'Rules:',
  '- Keep assistant.content concise (2-5 sentences).',
  '- Ensure every required field is present.',
  '- confidence must be one of: low, medium, high.',
  '- biggestLeaks/gtoCorrections/exploitativeAdjustments/practiceDrills/assumptions must always be arrays of strings.',
  '- If the hand lacks detail, provide best-practice defaults and clearly state assumptions.',
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
