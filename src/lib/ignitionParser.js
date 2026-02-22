/**
 * Parses Ignition Casino hand history text into a structured hand object.
 */

function parseMoney(s) {
  if (s == null || s === '') return null;
  const n = parseFloat(String(s).replace(/[$,]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

function parseCardList(s) {
  if (!s || !s.trim()) return [];
  return s.trim().split(/\s+/).filter(Boolean);
}

export function parseIgnitionHandHistory(rawText) {
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

  while (i < lines.length) {
    const line = lines[i];
    if (!line) { i++; continue; }
    const handIdMatch = line.match(/^#(\d+)$/);
    if (handIdMatch) {
      result.handId = handIdMatch[1];
      i++;
      continue;
    }
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
    if (line === 'Community cards' || line === 'Player Information') break;
    i++;
  }

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

  while (i < lines.length) {
    const line = lines[i];
    if (line === 'Player Information') {
      i++;
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
          result.players.push({
            position: positionClean,
            seat,
            startStack: startEnd[0],
            endStack: startEnd[1],
            totalBet: parseMoney(cols[3]),
            winLoss: parseMoney(cols[4]),
            cards: cols[5] ? parseCardList(cols[5]) : null,
            isMe,
          });
        }
        i++;
      }
      break;
    }
    i++;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line === 'Hand Session') {
      i++;
      if (i < lines.length && lines[i].includes('Position') && lines[i].includes('Action')) i++;
      let lastAction = null;
      while (i < lines.length) {
        const row = lines[i];
        if (!row) { i++; continue; }
        const onlyMoney = row.match(/^\$?([\d.]+)$/);
        if (onlyMoney && lastAction) {
          lastAction.amount = parseFloat(onlyMoney[1], 10);
          i++;
          continue;
        }
        const cols = row.split(/\t|\s{2,}/).map((c) => c.trim());
        if (cols.length >= 2) {
          lastAction = {
            position: cols[0] || '',
            action: cols[1] || '',
            timestamp: cols[2] || '',
            amount: cols[3] != null && cols[3] !== '' ? parseMoney(cols[3]) : null,
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
