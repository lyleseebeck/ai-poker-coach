# AI Poker Coach — Poker Hand Tracker

A React web app to log and review poker hands. Data stays in your browser (`localStorage`).

Core features:
- Manual hand capture with schema validation
- Ignition hand history parsing
- AI-assisted manual action normalization
- Multi-turn GTO coaching chat per saved hand (session-only)
- Bottom-of-page feedback form with optional screenshot attachments

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
   Fill in `OPENROUTER_API_KEY` (model list is optional).

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
- `UPSTASH_REDIS_REST_URL=<your upstash redis rest url>` (**required in production**)
- `UPSTASH_REDIS_REST_TOKEN=<your upstash redis rest token>` (**required in production**)
- `RESEND_API_KEY=<your resend api key>` (**required for feedback form delivery**)
- `FEEDBACK_TO_EMAIL=<your personal inbox>`
- `FEEDBACK_FROM_EMAIL=<verified sender email>`

Optional:
- `COACH_OPENROUTER_MODELS=<comma-separated model ids, each containing :free>`
  If omitted/partial, the server auto-appends a built-in free fallback chain.
- `COACH_OPENROUTER_DISCOVER_FREE_MODELS=false`
  Optional opt-out. By default, the server also discovers current OpenRouter `:free` models and appends them to the retry pool.
- `COACH_OPENROUTER_DISCOVERY_TTL_MS=3600000`
  Optional cache TTL for discovered free models.
- `COACH_REQUEST_TIMEOUT_MS=25000`
- `COACH_SITE_URL=http://localhost:5173`
- `COACH_APP_NAME=AI Poker Coach`
- `RATE_LIMIT_COACH_PER_MINUTE=5`
- `RATE_LIMIT_NORMALIZE_PER_MINUTE=12`
- `RATE_LIMIT_FEEDBACK_PER_MINUTE=3`

Recommended compatibility-first model order:
- `nvidia/nemotron-3-super-120b-a12b:free`
- `stepfun/step-3.5-flash:free`
- `arcee-ai/trinity-large-preview:free`

Free-only enforcement:
- Every configured model must include `:free` unless you explicitly use `openrouter/free`.
- Non-free model ids fail fast during provider initialization.
- If a model returns `404` with `settings/privacy`, update OpenRouter privacy filters or remove that model from the list.

Dynamic free-model discovery:
- The app keeps trying models until it finds a valid response or exhausts the full free-model pool.
- The pool includes your configured free models, the built-in fallbacks, newly discovered OpenRouter `:free` models, and `openrouter/free` as a last-resort free router.
- Discovery is cached in-process for 1 hour by default.

Rate-limit enforcement:
- `POST /api/coach-hand` and `POST /api/hand-normalize` are IP rate-limited with Upstash Redis.
- In production, missing Upstash env vars return `503` so the app cannot launch unprotected.
- Throttled requests return `429` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

---

## API contracts

### `POST /api/hand-normalize`
LLM-backed manual-action normalization endpoint with deterministic fallback.

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

### `POST /api/feedback`
Request:
```json
{
  "message": "The import button did nothing.",
  "replyEmail": "player@example.com",
  "attachments": [
    {
      "filename": "import-issue.jpg",
      "contentType": "image/jpeg",
      "contentBase64": "..."
    }
  ],
  "context": {
    "page": "/",
    "userAgent": "Mozilla/5.0"
  }
}
```

Response:
```json
{
  "ok": true
}
```

Validation rules:
- `message` is required and limited to 5,000 characters.
- `replyEmail` is optional but must be a valid email when present.
- `attachments` may include up to 3 screenshots.
- Screenshot types are limited to PNG, JPG, and WebP.
- Large screenshots are compressed client-side before submission.

---

## Deployment notes

- `vercel.json` configures Vercel build/output for this Vite app.
- A deployable Vercel-style route is provided at `api/coach-hand.js`.
- A deployable Vercel-style route is provided at `api/hand-normalize.js`.
- A deployable Vercel-style route is provided at `api/feedback.js`.
- Local dev and preview both expose `/api/coach-hand` through Vite middleware.
- Local dev and preview both expose `/api/hand-normalize` through Vite middleware.
- Local dev and preview both expose `/api/feedback` through Vite middleware.
- Core coach logic lives in `server/coach/*` so route wrappers stay thin.
- Feedback email delivery lives in `server/feedback/*`.

---

## Security hardening for public hosting

Current status:
- IP rate limiting is enforced on both public API endpoints when Upstash is configured.
- In production, missing limiter config returns `503` (fail closed) to avoid accidental unprotected launch.

Remaining primary risk:
- `POST /api/coach-hand` is still unauthenticated, so shared/public links can consume OpenRouter quota.

Hardening options (recommended order):
1. Protect the deployed app (password/access gate) for private beta.
2. Add real user authentication and require a valid session for `/api/coach-hand`.
3. Add endpoint rate limiting and abuse controls (per IP/user, burst + cooldown).
4. Redact internal error details returned to clients (keep detailed logs server-side only).
5. Keep provider budget caps/alerts and key rotation policy as blast-radius control.

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
  normalize/
    normalizeService.js
    normalizePrompt.js
    normalizeSchema.js
    http.js
  rateLimit/
    upstashRateLimit.js
api/
  coach-hand.js
  hand-normalize.js
tests/
  *.test.js
```
