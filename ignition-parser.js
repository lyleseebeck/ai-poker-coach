/**
 * Parses Ignition Casino hand history text into a structured hand object.
 * Hand history is expected to be pasted from Ignition (table format with
 * Start/End, Player Information, and Hand Session sections).
 */

function parseIgnitionHandHistory(rawText) {
  const lines = rawText
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim());
  const result = {
    handId: null,
    start: null,
    end: null,
    potSize: null,
    rake: null,
    gameType: null,
    playMode: null,
    tableName: null,
    communityCards: [],
    players: [],
    actions: [],
  };

  let i = 0;

  // --- Header: key: value lines ---
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }
    // Hand ID on its own line: #4867060675
    const handIdMatch = line.match(/^#(\d+)$/);
    if (handIdMatch) {
      result.handId = handIdMatch[1];
      i++;
      continue;
    }
    // Key: value (same line can have multiple pairs like "Pot Size:  $14.61 Rake:  $0.73")
    const pairRegex = /(\w[\w\s]*?):\s*([$\d.,\w\s-]+?)(?=\s{2,}\w|$)/g;
    let match;
    while ((match = pairRegex.exec(line)) !== null) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (key === 'Start') result.start = value;
      else if (key === 'End') result.end = value;
      else if (key === 'Pot Size') result.potSize = parseMoney(value);
      else if (key === 'Rake') result.rake = parseMoney(value);
      else if (key === 'Game Type') result.gameType = value;
      else if (key === 'Play Mode') result.playMode = value;
      else if (key === 'Table Name') result.tableName = value;
    }
    // Stop header when we hit "Community cards" or "Player Information"
    if (line === 'Community cards' || line === 'Player Information') break;
    i++;
  }

  // --- Community cards ---
  while (i < lines.length) {
    const line = lines[i];
    if (line === 'Community cards') {
      i++;
      if (i < lines.length && lines[i].startsWith(':')) {
        const rest = lines[i].replace(/^:\s*/, '').trim();
        if (rest) result.communityCards = parseCardList(rest);
      }
      i++;
      break;
    }
    i++;
  }

  // --- Player Information table ---
  while (i < lines.length) {
    const line = lines[i];
    if (line === 'Player Information') {
      i++;
      // Next line is header: Position	Seat	Start/End	Total Bet	Win/Loss	Cards Dealt
      if (i < lines.length && lines[i].includes('Position')) i++;
      while (i < lines.length) {
        const row = lines[i];
        if (!row || row === 'Hand Session') break;
        const cols = row.split(/\t/).map((c) => c.trim());
        if (cols.length >= 5) {
          const position = cols[0] || '';
          const isMe = position.includes('[ME]');
          const positionClean = position.replace(/\s*\[ME\]\s*$/, '').trim();
          const seat = parseInt(cols[1], 10) || null;
          const startEnd = (cols[2] || '').split('/').map((s) => parseMoney(s.trim()));
          const totalBet = parseMoney(cols[3]);
          const winLoss = parseMoney(cols[4]);
          const cards = cols[5] ? parseCardList(cols[5]) : null;
          result.players.push({
            position: positionClean,
            seat,
            startStack: startEnd[0],
            endStack: startEnd[1],
            totalBet,
            winLoss,
            cards,
            isMe,
          });
        }
        i++;
      }
      break;
    }
    i++;
  }

  // --- Hand Session: action list ---
  while (i < lines.length) {
    const line = lines[i];
    if (line === 'Hand Session') {
      i++;
      if (i < lines.length && lines[i].includes('Position') && lines[i].includes('Action')) i++;
      let lastAction = null;
      while (i < lines.length) {
        const row = lines[i];
        if (!row) {
          i++;
          continue;
        }
        // Line that is only a dollar amount -> attach to previous action
        const onlyMoney = row.match(/^\$?([\d.]+)$/);
        if (onlyMoney && lastAction) {
          lastAction.amount = parseFloat(onlyMoney[1], 10);
          i++;
          continue;
        }
        // Split on tab or two+ spaces so we handle both Ignition copy formats
        const cols = row.split(/\t|\s{2,}/).map((c) => c.trim());
        if (cols.length >= 2) {
          const position = cols[0] || '';
          const action = cols[1] || '';
          const timestamp = cols[2] || '';
          const amountRaw = cols[3];
          lastAction = {
            position,
            action,
            timestamp,
            amount: amountRaw != null && amountRaw !== '' ? parseMoney(amountRaw) : null,
          };
          result.actions.push(lastAction);
        }
        i++;
      }
      break;
    }
    i++;
  }

  return result;
}

function parseMoney(s) {
  if (s == null || s === '') return null;
  const n = parseFloat(String(s).replace(/[$,]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

function parseCardList(s) {
  if (!s || !s.trim()) return [];
  return s.trim().split(/\s+/).filter(Boolean);
}
