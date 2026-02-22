# AI Poker Coach — Poker Hand Tracker

A simple web app to log and review your poker hands. Everything runs in your browser and data is stored only on your computer (no server or account required).

---

## How to run it

1. **Open the app in your browser**
   - Double-click `index.html`, **or**
   - Right-click `index.html` → "Open With" → your browser (Chrome, Safari, Firefox, etc.)

2. **Use the form** to add a hand (your cards, position, action, outcome, optional opponent cards and notes), then click **Save hand**.

3. **View saved hands** in the list below the form. Each row shows one hand; use **Delete** to remove it.

Data is stored in your browser's **local storage**, so it stays even after you close the tab. Clearing your browser data for this site will remove the saved hands.

---

## What each file does

### `index.html`

This is the **page** the browser shows.

- **Head:** Sets the page title and loads **Tailwind CSS** from a CDN (a hosted stylesheet). Tailwind gives us utility classes like `rounded-lg`, `bg-white`, so we don't write custom CSS.
- **Body:**  
  - A **form** with inputs for: my cards (2), position, action, opponent cards (optional), outcome, notes (optional), and a "Save hand" button.  
  - A **section** where the list of saved hands will appear (`id="hand-list"`).  
  - A **script** tag that loads `app.js`, which runs after the page is loaded.

So: **HTML = structure and content** (labels, inputs, buttons, containers).

### `app.js`

This is the **logic** that makes the app work.

- **localStorage:** The browser's built-in way to store data on your machine. We use one key (e.g. `"pokerHands"`) and store a **JSON string** of an array of hand objects. When the page loads or when you save, we **read** or **write** that string.
- **getHands():** Reads the string from localStorage, parses it to an array, and returns it (or `[]` if empty or invalid).
- **saveHands(hands):** Takes the array of hands, turns it into a JSON string, and writes it to localStorage.
- **renderHandList():**  
  - Gets the current hands from storage.  
  - Clears the list area in the HTML.  
  - If there are no hands, shows "No hands saved yet…".  
  - Otherwise, for each hand (newest first), creates a small "card" block (your cards, position, action, outcome, optional villain cards and notes) and a **Delete** button, and appends it to the list.
- **Form submit handler:**  
  - Runs when you click "Save hand".  
  - Reads the form fields, checks that at least your two cards and outcome are set.  
  - Builds a **hand object** (with a unique `id`, `createdAt`, and all the form values).  
  - Appends it to the current array, calls `saveHands()`, then `renderHandList()` to refresh the list, and resets the form.
- **Delete:** Clicking Delete on a hand removes it from the array, saves, and re-renders the list.

So: **JavaScript = behavior** (saving, loading, displaying, deleting).

### `README.md` (this file)

Explains how to run the app and what each part of the project does.

---

## Tech summary

| Part            | Role |
|-----------------|------|
| **HTML**        | Structure: form fields, labels, buttons, list container. |
| **Tailwind CSS**| Styling via class names (no separate CSS file). |
| **JavaScript**  | Read/write localStorage, handle form submit, build and update the hand list. |
| **localStorage**| Persists your hands in the browser until you clear site data. |

No frameworks, no build step, no server. Just open `index.html` in a browser to use the app.
