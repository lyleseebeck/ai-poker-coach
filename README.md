# AI Poker Coach — Poker Hand Tracker

A React web app to log and review poker hands. Data stays in your browser (`localStorage`).

Core features:
- Manual hand capture with schema validation
- Ignition hand history parsing
- AI-assisted manual action normalization
- Multi-turn GTO coaching chat per saved hand (session-only)

---

## How to run

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure coach environment variables:
   ```bash
   cp .env.example .env
   ```
   Fill in `OPENROUTER_API_KEY` and your free-model list.

3. Start dev server:
   ```bash
   npm run dev
   ```
   Open the local URL shown by Vite (usually `http://localhost:5173`).

4. Run tests:
   ```bash
   npm test
   ```

5. Build production assets:
   ```bash
   npm run build
   ```

---

## Coach feature (v1)

- In the **Coach** section, select a saved hand from the dropdown.
- Enter a question/prompt and submit.
- The app sends the selected hand plus your prompt to `/api/coach-hand`.
- The backend applies a master coaching prompt and calls OpenRouter with free-model fallback.
- Responses are strict JSON, rendered in structured sections on the frontend.
- Chat is **ephemeral** (not persisted) and context is limited to the **last 8 messages**.

---

## Environment variables

Required:
- `COACH_PROVIDER=openrouter`
- `OPENROUTER_API_KEY=<your key>`
- `COACH_OPENROUTER_MODELS=<comma-separated model ids, each containing :free>`

Optional:
- `COACH_REQUEST_TIMEOUT_MS=25000`
- `COACH_SITE_URL=http://localhost:5173`
- `COACH_APP_NAME=AI Poker Coach`

Free-only enforcement:
- Every configured model must include `:free`.
- Non-free model ids fail fast during provider initialization.

---

## API contracts

### `POST /api/hand-normalize`
Existing local deterministic/manual-action normalization endpoint.

### `POST /api/coach-hand`
Request:
```json
{
  "handId": "string",
  "hand": { "schemaVersion": 2 },
  "message": "string",
  "history": [
    { "role": "user", "content": "string" },
    { "role": "assistant", "content": "string" }
  ]
}
```

Response:
```json
{
  "assistant": {
    "content": "string",
    "analysis": {
      "situationSummary": "string",
      "biggestLeaks": ["string"],
      "gtoCorrections": ["string"],
      "streetPlan": {
        "preflop": "string",
        "flop": "string",
        "turn": "string",
        "river": "string"
      },
      "exploitativeAdjustments": ["string"],
      "practiceDrills": ["string"],
      "nextSessionFocus": "string",
      "confidence": "low",
      "assumptions": ["string"]
    }
  },
  "meta": {
    "provider": "openrouter",
    "model": "string",
    "fallbackUsed": true,
    "historyWindowUsed": 8,
    "truncatedHistory": false
  },
  "warnings": []
}
```

---

## Deployment notes

- A deployable Vercel-style route is provided at `api/coach-hand.js`.
- Local dev and preview both expose `/api/coach-hand` through Vite middleware.
- Core coach logic lives in `server/coach/*` so route wrappers stay thin.

---

## Project structure

```
src/
  App.jsx
  components/
    CoachPanel.jsx
  lib/
    coachClient.js
server/
  coach/
    coachService.js
    coachPrompt.js
    coachSchema.js
    handContext.js
    http.js
    providers/
      index.js
      openRouterProvider.js
api/
  coach-hand.js
tests/
  *.test.js
```

