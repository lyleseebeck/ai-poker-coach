/**
 * Poker Hand Tracker - app.js
 *
 * This file handles:
 * 1. Saving new hands when you submit the form
 * 2. Reading saved hands from the browser's localStorage
 * 3. Showing the list of hands on the page
 * 4. Deleting a hand when you click delete
 *
 * localStorage is a built-in browser feature: data stays on your computer
 * and persists after you close the tab. It's key-value storage (like a
 * simple dictionary). We use one key, "pokerHands", and store a JSON
 * string of all hands.
 */

// --- STORAGE KEY ---
const STORAGE_KEY = 'pokerHands';

// --- PARSED IMPORT (held until user clicks Save) ---
let lastParsedHand = null;

// --- GET ALL HANDS FROM STORAGE ---
// Returns an array of hand objects. If nothing is saved yet, returns [].
function getHands() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// --- SAVE HANDS TO STORAGE ---
// Takes an array of hands and writes it to localStorage as a JSON string.
function saveHands(hands) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hands));
}

// --- RENDER THE LIST OF HANDS ---
// Clears the list area and then adds one block per hand.
function renderHandList() {
  const listEl = document.getElementById('hand-list');
  const emptyMsg = document.getElementById('empty-message');
  const hands = getHands();

  // Remove the "no hands" message if we had it as a direct child (see HTML).
  if (emptyMsg && emptyMsg.parentElement === listEl) {
    emptyMsg.remove();
  }

  // Clear existing list content (so we can re-build it from scratch).
  listEl.innerHTML = '';

  if (hands.length === 0) {
    const p = document.createElement('p');
    p.id = 'empty-message';
    p.className = 'text-slate-400 text-sm';
    p.textContent = 'No hands saved yet. Add one above.';
    listEl.appendChild(p);
    return;
  }

  // Newest first.
  const sorted = [...hands].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  sorted.forEach((hand) => {
    const card = document.createElement('div');
    card.className =
      'rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden';
    card.dataset.id = hand.id;

    if (hand.actions && hand.actions.length > 0) {
      // Imported hand: show table, hand ID, pot, my cards, board, and action list
      const tableName = hand.tableName || 'Imported hand';
      const handId = hand.handId ? '#' + hand.handId : '';
      const potStr = hand.potSize != null ? `Pot $${hand.potSize.toFixed(2)}` : '';
      const mePlayer = (hand.players || []).find((p) => p.isMe);
      const myResult = mePlayer && mePlayer.winLoss != null ? (mePlayer.winLoss >= 0 ? '+' : '') + '$' + mePlayer.winLoss.toFixed(2) : '';
      const resultClass = mePlayer && mePlayer.winLoss != null ? (mePlayer.winLoss >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-slate-500';
      const myCardsStr = (hand.myCards && hand.myCards.length >= 2) ? escapeHtml(hand.myCards[0]) + ' ' + escapeHtml(hand.myCards[1]) : '';
      const boardStr = (hand.communityCards && hand.communityCards.length > 0) ? hand.communityCards.map(escapeHtml).join(' ') : (hand.handDidNotReachFlop ? '— (pre-flop)' : '');
      const actionsHtml = hand.actions
        .map(
          (a) =>
            `<tr class="border-b border-slate-100 last:border-0">
              <td class="py-1 pr-2 text-slate-600">${escapeHtml(a.position)}</td>
              <td class="py-1 pr-2">${escapeHtml(a.action)}</td>
              <td class="py-1 pr-2 text-slate-500 text-xs">${escapeHtml(a.timestamp || '')}</td>
              <td class="py-1 text-slate-600">${a.amount != null ? '$' + a.amount.toFixed(2) : ''}</td>
            </tr>`
        )
        .join('');
      card.innerHTML = `
        <div class="p-3 flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-slate-800">${escapeHtml(tableName)}</span>
              ${handId ? `<span class="text-slate-400 text-sm">${escapeHtml(handId)}</span>` : ''}
              ${potStr ? `<span class="text-slate-500 text-sm">${potStr}</span>` : ''}
              ${myResult ? `<span class="text-sm font-medium ${resultClass}">${myResult}</span>` : ''}
            </div>
            <p class="text-xs text-slate-500 mt-1">${escapeHtml(hand.start || '')}${hand.end ? ' – ' + escapeHtml(hand.end) : ''}</p>
            ${myCardsStr ? `<p class="text-xs text-slate-600 mt-1"><span class="text-slate-500">My cards:</span> <span class="font-mono">${myCardsStr}</span></p>` : ''}
            ${boardStr !== undefined && boardStr !== '' ? `<p class="text-xs text-slate-600 mt-0.5"><span class="text-slate-500">Board:</span> <span class="font-mono">${boardStr}</span></p>` : ''}
          </div>
          <button type="button" class="delete-hand shrink-0 text-slate-400 hover:text-red-600 text-sm" title="Delete">Delete</button>
        </div>
        <div class="border-t border-slate-200 bg-white/60">
          <details class="group">
            <summary class="px-3 py-2 text-sm text-slate-600 cursor-pointer list-none flex items-center gap-1">
              <span class="group-open:rotate-90 transition-transform">▶</span>
              <span>${hand.actions.length} actions</span>
            </summary>
            <div class="px-3 pb-3 overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-slate-500 border-b border-slate-200">
                    <th class="py-1 pr-2 font-medium">Position</th>
                    <th class="py-1 pr-2 font-medium">Action</th>
                    <th class="py-1 pr-2 font-medium">Time</th>
                    <th class="py-1 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>${actionsHtml}</tbody>
              </table>
            </div>
          </details>
        </div>
      `;
    } else {
      // Simple hand (manual entry)
      const rankLabel = { win: 'Won', loss: 'Lost', tie: 'Tie' }[hand.outcome] || hand.outcome;
      const outcomeClass =
        hand.outcome === 'win'
          ? 'text-emerald-600'
          : hand.outcome === 'loss'
            ? 'text-red-600'
            : 'text-slate-500';
      card.innerHTML = `
        <div class="flex items-start justify-between gap-3 p-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono font-medium text-slate-800">${escapeHtml(hand.card1 || '')} ${escapeHtml(hand.card2 || '')}</span>
              <span class="text-slate-400">·</span>
              <span class="text-slate-600 text-sm">${escapeHtml(hand.position || '—')}</span>
              <span class="text-slate-400">·</span>
              <span class="text-slate-600 text-sm">${escapeHtml(hand.action || '—')}</span>
              <span class="text-slate-400">·</span>
              <span class="text-sm font-medium ${outcomeClass}">${escapeHtml(rankLabel)}</span>
            </div>
            ${hand.opponentCards ? `<p class="text-xs text-slate-500 mt-1">Villain: ${escapeHtml(hand.opponentCards)}</p>` : ''}
            ${hand.notes ? `<p class="text-xs text-slate-500 mt-1">${escapeHtml(hand.notes)}</p>` : ''}
          </div>
          <button type="button" class="delete-hand shrink-0 text-slate-400 hover:text-red-600 text-sm" title="Delete">Delete</button>
        </div>
      `;
    }

    card.querySelector('.delete-hand').addEventListener('click', () => deleteHand(hand.id));
    listEl.appendChild(card);
  });
}

// --- ESCAPE HTML ---
// Prevents XSS if someone typed <script> in a note. We show text as text, not as HTML.
function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- DELETE A HAND ---
function deleteHand(id) {
  const hands = getHands().filter((h) => h.id !== id);
  saveHands(hands);
  renderHandList();
}

// --- GENERATE A SIMPLE UNIQUE ID ---
function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

// --- HANDLE FORM SUBMIT ---
// When you click "Save hand", we read the form, build a hand object,
// add it to the list, save to localStorage, re-render, and clear the form.
document.getElementById('hand-form').addEventListener('submit', (e) => {
  e.preventDefault();

  const card1 = document.getElementById('card1').value.trim();
  const card2 = document.getElementById('card2').value.trim();
  const position = document.getElementById('position').value.trim();
  const action = document.getElementById('action').value.trim();
  const opponentCards = document.getElementById('opponent-cards').value.trim();
  const outcome = document.getElementById('outcome').value.trim();
  const notes = document.getElementById('notes').value.trim();

  if (!card1 || !card2) {
    alert('Please enter both of your cards.');
    return;
  }
  if (!outcome) {
    alert('Please select an outcome (Win / Loss / Tie).');
    return;
  }

  const hand = {
    id: generateId(),
    card1,
    card2,
    position,
    action,
    opponentCards: opponentCards || undefined,
    outcome,
    notes: notes || undefined,
    createdAt: Date.now(),
  };

  const hands = getHands();
  hands.push(hand);
  saveHands(hands);
  renderHandList();

  // Reset form
  document.getElementById('hand-form').reset();
});

// --- IMPORT HAND HISTORY (Ignition) ---
const importRawEl = document.getElementById('import-raw');
const importParseBtn = document.getElementById('import-parse-btn');
const importSaveBtn = document.getElementById('import-save-btn');
const importPreviewEl = document.getElementById('import-preview');
const importPreviewContent = document.getElementById('import-preview-content');
const importErrorEl = document.getElementById('import-error');

function showImportError(msg) {
  importErrorEl.textContent = msg || '';
  importErrorEl.classList.toggle('hidden', !msg);
}

function buildPreviewHtml(parsed) {
  const lines = [];
  if (parsed.tableName) lines.push(`<strong>Table:</strong> ${escapeHtml(parsed.tableName)}`);
  if (parsed.handId) lines.push(`<strong>Hand:</strong> #${escapeHtml(parsed.handId)}`);
  if (parsed.potSize != null) lines.push(`<strong>Pot:</strong> $${parsed.potSize.toFixed(2)}`);
  if (parsed.start) lines.push(`<strong>Start:</strong> ${escapeHtml(parsed.start)}`);
  lines.push(`<strong>Actions:</strong> ${parsed.actions.length} recorded`);
  const me = (parsed.players || []).find((p) => p.isMe);
  if (me && me.winLoss != null) {
    const wl = me.winLoss >= 0 ? '+' : '';
    lines.push(`<strong>Your result:</strong> <span class="${me.winLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}">${wl}$${me.winLoss.toFixed(2)}</span>`);
  }
  return lines.join(' · ');
}

const importHandDetailsEl = document.getElementById('import-hand-details');
const importNoFlopCheckbox = document.getElementById('import-no-flop');
const importCommunityCardsWrap = document.getElementById('import-community-cards-wrap');

function setImportCommunityCardsVisible(visible) {
  importCommunityCardsWrap.classList.toggle('hidden', !visible);
}

importNoFlopCheckbox.addEventListener('change', () => {
  setImportCommunityCardsVisible(!importNoFlopCheckbox.checked);
});

importParseBtn.addEventListener('click', () => {
  const raw = importRawEl.value.trim();
  showImportError('');
  lastParsedHand = null;
  importSaveBtn.disabled = true;
  importPreviewEl.classList.add('hidden');
  importHandDetailsEl.classList.add('hidden');
  if (!raw) {
    showImportError('Paste hand history text first.');
    return;
  }
  try {
    const parsed = parseIgnitionHandHistory(raw);
    if (!parsed.actions || parsed.actions.length === 0) {
      showImportError('Could not find any actions. Make sure you pasted the full Ignition hand (including "Hand Session" and the action table).');
      return;
    }
    lastParsedHand = parsed;
    importPreviewContent.innerHTML = buildPreviewHtml(parsed);
    importPreviewEl.classList.remove('hidden');
    importHandDetailsEl.classList.remove('hidden');
    // Reset hand details
    document.getElementById('import-my-card1').value = '';
    document.getElementById('import-my-card2').value = '';
    importNoFlopCheckbox.checked = false;
    setImportCommunityCardsVisible(true);
    document.getElementById('import-flop1').value = '';
    document.getElementById('import-flop2').value = '';
    document.getElementById('import-flop3').value = '';
    document.getElementById('import-turn').value = '';
    document.getElementById('import-river').value = '';
    importSaveBtn.disabled = false;
  } catch (err) {
    showImportError('Parse error: ' + (err.message || String(err)));
  }
});

importSaveBtn.addEventListener('click', () => {
  if (!lastParsedHand) return;
  const card1 = document.getElementById('import-my-card1').value.trim();
  const card2 = document.getElementById('import-my-card2').value.trim();
  const noFlop = importNoFlopCheckbox.checked;
  const flop1 = document.getElementById('import-flop1').value.trim();
  const flop2 = document.getElementById('import-flop2').value.trim();
  const flop3 = document.getElementById('import-flop3').value.trim();
  const turn = document.getElementById('import-turn').value.trim();
  const river = document.getElementById('import-river').value.trim();

  showImportError('');
  if (!card1 || !card2) {
    showImportError('Please enter both of your hole cards.');
    return;
  }
  if (!noFlop) {
    if (!flop1 || !flop2 || !flop3) {
      showImportError('Please enter at least the 3 flop cards, or check "Hand didn\'t reach flop".');
      return;
    }
  }

  const communityCards = [];
  if (!noFlop) {
    if (flop1) communityCards.push(flop1);
    if (flop2) communityCards.push(flop2);
    if (flop3) communityCards.push(flop3);
    if (turn) communityCards.push(turn);
    if (river) communityCards.push(river);
  }

  const hand = {
    id: generateId(),
    source: 'ignition',
    handId: lastParsedHand.handId,
    start: lastParsedHand.start,
    end: lastParsedHand.end,
    potSize: lastParsedHand.potSize,
    rake: lastParsedHand.rake,
    gameType: lastParsedHand.gameType,
    playMode: lastParsedHand.playMode,
    tableName: lastParsedHand.tableName,
    myCards: [card1, card2],
    communityCards,
    handDidNotReachFlop: noFlop,
    players: lastParsedHand.players || [],
    actions: lastParsedHand.actions || [],
    createdAt: Date.now(),
  };
  const hands = getHands();
  hands.push(hand);
  saveHands(hands);
  renderHandList();
  lastParsedHand = null;
  importRawEl.value = '';
  importPreviewEl.classList.add('hidden');
  importHandDetailsEl.classList.add('hidden');
  importSaveBtn.disabled = true;
  showImportError('');
});

// --- ON PAGE LOAD ---
renderHandList();
