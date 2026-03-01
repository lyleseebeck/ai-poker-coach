# AI Poker Coach — Poker Hand Tracker

A React web app to log and review your poker hands. Everything runs in your browser and data is stored only on your computer (localStorage). Supports importing full hand history from Ignition Casino and a point-and-click card picker.

---

## How to run it

1. **Install dependencies** (one time):
   ```bash
   npm install
   ```

2. **Start the dev server**:
   ```bash
   npm run dev
   ```
   Then open the URL shown (e.g. http://localhost:5173) in your browser.

3. **Or build for production**:
   ```bash
   npm run build
   ```
   Then serve the `dist` folder (e.g. with `npm run preview` or any static file server).

---

## Tech stack

- **React 18** – UI components and state
- **Vite** – build tool and dev server
- **Tailwind CSS** – styling
- **localStorage** – persistence (same key `pokerHands` as before, so existing data is compatible)

### Local API contract

During local development (`npm run dev`), the app exposes:

- `POST /api/hand-normalize`

Request body (JSON):

```json
{
  "manualActionText": "free-form hand narrative",
  "context": {
    "heroPosition": "BB",
    "boardCards": ["Ah", "Kd", "Tc"],
    "stakes": { "sb": 0.1, "bb": 0.25 },
    "currentFields": {}
  },
  "deterministicParse": {}
}
```

Response body (JSON):

```json
{
  "parsedFields": {},
  "confidenceByField": {},
  "evidenceSnippets": {},
  "missingRequired": [],
  "needsUserInput": [],
  "overallConfidence": 0.82,
  "model": "local-contract-v1"
}
```

---

## Project structure

```
src/
  App.jsx           – main app, state, card picker registration
  main.jsx          – React entry point
  index.css         – Tailwind + global styles
  lib/
    storage.js      – getHands, saveHands, generateId
    ignitionParser.js – Ignition hand history parser
  components/
    CardPicker.jsx  – rank + suit point-and-click picker
    CardInput.jsx   – card field that uses the picker when focused
    HandDetailsForm.jsx – my cards, “hand didn’t reach flop”, community cards
    ImportSection.jsx   – paste Ignition text, parse, preview, hand details, save
    QuickAddForm.jsx    – quick add hand form
    HandList.jsx    – list of saved hands
    HandCard.jsx    – single hand (imported with actions or simple)
```

The app keeps the same behavior as the original: import hand history (with required my cards and community cards or “hand didn’t reach flop”), quick-add form, saved hands list with expandable actions, and card picker for all card fields.
