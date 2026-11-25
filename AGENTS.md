# AI Poker Coach

## Shared workflow portability

Keep shared workflows, instructions, and deliverables agent- and tool-agnostic whenever a provider-neutral approach can meet the same intent and quality. Do not make canonical development behavior depend unnecessarily on Claude, Codex, or another provider-specific feature.

Use provider-specific mechanics only when Lyle explicitly requests them or no credible portable equivalent exists. State why they are necessary, preserve the strongest portable fallback, and keep those mechanics separate from the canonical workflow.

OpenRouter, Upstash, and Resend are application integrations, not agent-workflow requirements. Preserve their provider adapters where the product needs them without making the repository's development workflow depend on a particular coding agent.

`CLAUDE.md` exists only as a runtime entrypoint for tools that read that filename; `AGENTS.md` remains the portable source of repository instructions.

## How to QA here

Before opening or updating a PR, run the `qa` skill. GitHub Actions CI (`.github/workflows/ci.yml`) reruns `npm test` and `npm run build` and scans new commits for secrets, but QA is still the main pre-PR check. Level 1 is `bash scripts/qa.sh`: `npm test`, `npm run build`, then a `vite preview` smoke check that the page returns HTTP 200. Read only the exit code and the last ~20 lines.

- Fresh worktree: run `npm install` first (Node.js via `brew install node`).
- Level 2 (user-facing changes only): open the changed screen once in the browser and confirm the expected result. Use at most about 10 actions, and make no live coaching or model calls unless Lyle asks.
- Never print `.env` contents.
