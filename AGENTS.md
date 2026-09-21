# AI Poker Coach

## Shared workflow portability

Keep shared workflows, instructions, and deliverables agent- and tool-agnostic whenever a provider-neutral approach can meet the same intent and quality. Do not make canonical development behavior depend unnecessarily on Claude, Codex, or another provider-specific feature.

Use provider-specific mechanics only when Lyle explicitly requests them or no credible portable equivalent exists. State why they are necessary, preserve the strongest portable fallback, and keep those mechanics separate from the canonical workflow.

OpenRouter, Upstash, and Resend are application integrations, not agent-workflow requirements. Preserve their provider adapters where the product needs them without making the repository's development workflow depend on a particular coding agent.

`CLAUDE.md` exists only as a runtime entrypoint for tools that read that filename; `AGENTS.md` remains the portable source of repository instructions.
