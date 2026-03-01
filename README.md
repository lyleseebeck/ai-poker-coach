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

4. **Run unit tests**:
   ```bash
   npm test
   ```

---

## Tech stack

- **React 18** – UI components and state
- **Vite** – build tool and dev server
- **Tailwind CSS** – styling
- **localStorage** – persistence (V2 records only; legacy records are ignored)

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
  App.jsx           – main app, shared card state, picker targeting
  main.jsx          – React entry point
  index.css         – Tailwind + global styles
  lib/
    handSchema.js   – canonical V2 draft/validation/build utilities
    manualActionParser.js – deterministic parser + confidence/missing fields
    aiNormalizeClient.js – frontend adapter for /api/hand-normalize
    storage.js      – V2-only getHands/saveHands
    ignitionParser.js – Ignition hand history parser
  components/
    CardPicker.jsx  – rank + suit point-and-click picker
    HandDetailsForm.jsx – community card controls and no-flop toggle
    UnifiedHandForm.jsx – single hand capture flow (manual + import + AI proposal)
    HandList.jsx    – list of saved hands
    HandCard.jsx    – V2 saved-hand renderer with street/detail summary
    TrashList.jsx   – deleted hands retained for 30-day trash window
tests/
  *.test.js         – schema/parser/storage unit tests (Node test runner)
docs/
  manual-qa-checklist.md – step-by-step UI smoke checklist
```

Current UX is a unified "Hand capture" flow with one save button, optional import parse/prefill, optional manual action narrative parsing, saved-hand cards rendered from the canonical V2 schema, and soft-delete to 30-day trash.
