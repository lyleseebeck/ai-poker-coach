function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
}

export function buildNormalizeMessages({ manualActionText, context, deterministicParse }) {
  const system = [
    'You normalize poker hand narratives into strict JSON for a hand-capture form.',
    'Return ONLY JSON. No markdown fences. No prose.',
    'Do not invent values you cannot infer. Use null/omit uncertain fields.',
    'Action enums must be one of: fold, check, call, bet, raise, all_in, none.',
    'Card format must be rank+suit like As, Td, 7c.',
    'If hand is given as shorthand like AA/AKo/76s, include hero.handCode.',
    'If exact hero cards are inferable, include hero.cards with 2 cards.',
    'Infer reasonable standard preflop sizes in BB when text is vague (for example open size, 3-bet size).',
    'Do not infer table BB/SB stake size unless explicitly stated.',
  ].join(' ');

  const schema = {
    parsedFields: {
      hero: {
        position: 'BTN',
        cards: ['As', 'Ah'],
        handCode: 'AA',
      },
      board: {
        didReachFlop: true,
        cards: ['Js', 'Th', '2d', '9c'],
      },
      heroStreetSummary: {
        preflop: { action: 'raise', amountBb: 3, amountChips: null },
        flop: { action: 'call', amountBb: null, amountChips: null },
        turn: { action: 'fold', amountBb: null, amountChips: null },
        river: { action: 'none', amountBb: null, amountChips: null },
      },
      result: {
        netBb: -20,
        netChips: null,
      },
    },
    confidenceByField: {
      heroPosition: 0.9,
      heroStreetSummary_preflop_action: 0.85,
      result_netBb: 0.4,
    },
    evidenceSnippets: {
      'hero.position': 'in the button',
      'heroStreetSummary.preflop.action': 'i 3bet',
    },
    missingRequired: ['result.netBb'],
    needsUserInput: ['result.netBb'],
  };

  const user = [
    'Manual action text:',
    manualActionText,
    '',
    'Current context JSON:',
    safeJson(context || {}),
    '',
    'Deterministic parse JSON:',
    safeJson(deterministicParse || {}),
    '',
    'Return JSON matching this shape (omit unknown fields instead of guessing):',
    safeJson(schema),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
