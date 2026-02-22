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
// We use this single key in localStorage to store our array of hands.
const STORAGE_KEY = 'pokerHands';

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
      'flex items-start justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/50';
    card.dataset.id = hand.id;

    const rankLabel = { win: 'Won', loss: 'Lost', tie: 'Tie' }[hand.outcome] || hand.outcome;
    const outcomeClass =
      hand.outcome === 'win'
        ? 'text-emerald-600'
        : hand.outcome === 'loss'
          ? 'text-red-600'
          : 'text-slate-500';

    card.innerHTML = `
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
    `;

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

// --- ON PAGE LOAD ---
// When the page first opens, we load and display any saved hands.
renderHandList();
