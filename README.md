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

## Coach feature (v3.1)

- In the **Coach** section, select a saved hand from the dropdown.
- Enter a question/prompt and submit.
- The app sends the selected hand plus your prompt to `/api/coach-hand`.
- The backend applies a master coaching prompt and calls OpenRouter with free-model fallback.
- First turn in a hand thread returns strict verdict-first analysis JSON.
- Followup turns return lightweight free-form JSON chat (optional short highlights).
- Chat is **ephemeral** (not persisted) and context is limited to the **last 8 messages**.

---

## Environment variables

Required:
- `COACH_PROVIDER=openrouter`
- `OPENROUTER_API_KEY=<your key>`
- `COACH_OPENROUTER_MODELS=<comma-separated model ids, each containing :free>`

Recommended quality-first model order:
- `openai/gpt-oss-120b:free`
- `meta-llama/llama-3.3-70b-instruct:free`
- `google/gemma-3-27b-it:free`
- `mistralai/mistral-small-3.1-24b-instruct:free`
- `openai/gpt-oss-20b:free`

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

Response (initial analysis mode):
```json
{
  "assistant": {
    "content": "string",
    "analysis": {
      "factCheck": {
        "heroCards": ["5d", "4d"],
        "heroHandCode": "54s",
        "heroPosition": "BB",
        "preflopLastAggressorPosition": "UTG+1",
        "heroWasPreflopAggressor": false,
        "heroCanCbetFlop": false,
        "heroPostflopPosition": "out_of_position"
      },
      "overallVerdict": "correct",
      "overallReason": "string",
      "streetVerdicts": [
        {
          "street": "preflop",
          "heroAction": "string",
          "verdict": "correct",
          "reason": "string",
          "gtoPreferredAction": "string"
        }
      ],
      "keyAdjustments": ["string"],
      "confidence": "low"
    }
  },
  "meta": {
    "provider": "openrouter",
    "model": "string",
    "fallbackUsed": true,
    "historyWindowUsed": 8,
    "truncatedHistory": false,
    "failedModelAttempts": [{ "model": "string", "reason": "string", "status": 429 }],
    "attemptSummary": "provider_retryable_status:429x1",
    "responseMode": "analysis"
  },
  "warnings": []
}
```

Response (followup mode):
```json
{
  "assistant": {
    "content": "free-form paragraph",
    "followupHighlights": ["optional bullet", "optional bullet"]
  },
  "meta": {
    "responseMode": "followup",
    "...": "same meta fields as above"
  },
  "warnings": []
}
```

Verdict rules:
- `analysis.factCheck` is required and validated server-side against derived hand facts.
- `overallVerdict` is server-derived from `streetVerdicts` using worst-street precedence:
  - `incorrect` if any street is `incorrect`
  - else `mixed` if any street is `mixed`
  - else `correct` if at least one graded street is `correct`
  - else `unclear`
- `streetVerdicts[].verdict` is limited to `correct|mixed|incorrect|unclear`.
- `streetVerdicts` must include every street where hero took an action.
- `keyAdjustments` is the single consolidated guidance section.
- Removed fields: `assumptions`, `nextSessionFocus`, `practiceDrills`, `streetPlan`, `topAlternatives`, `biggestLeaks`, `gtoCorrections`, `exploitativeAdjustments`.
- Numeric `%` frequencies are disallowed; model must use qualitative frequencies.

Error response details for strict failures:
- `error.details.validationFailures`: plain-language validation/fact-check failures.
- `error.details.failedModelAttempts`: failed model calls with reason/status.
- `error.details.attemptSummary`: summarized model-attempt outcomes.
- `error.details.lastModel`: most recent model id used.

---

## Deployment notes

- A deployable Vercel-style route is provided at `api/coach-hand.js`.
- Local dev and preview both expose `/api/coach-hand` through Vite middleware.
- Core coach logic lives in `server/coach/*` so route wrappers stay thin.

---

## Security hardening for public hosting (deferred)

Current status:
- For local testing, coach endpoint limits/auth are intentionally not enforced.
- This is acceptable for local/private development but not safe for an internet-exposed deployment.

Primary risk to address before public launch:
- `POST /api/coach-hand` is currently callable without user auth, so a public deployment could be abused to consume OpenRouter quota.

Hardening options (recommended order):
1. Protect the deployed app (password/access gate) for private beta.
2. Add real user authentication and require a valid session for `/api/coach-hand`.
3. Add endpoint rate limiting and abuse controls (per IP/user, burst + cooldown).
4. Redact internal error details returned to clients (keep detailed logs server-side only).
5. Keep provider budget caps/alerts and key rotation policy as blast-radius control.

Why this is deferred now:
- We are prioritizing fast local iteration/testing and will apply these controls once the app is hosted publicly.

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
