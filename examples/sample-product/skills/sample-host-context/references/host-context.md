# Sample Host Context — ambient instructions

This file is the ambient context payload referenced by
`sample-host-context/SKILL.md` via `host-instructions:`. When `nexel
activate` runs, each Plugin Runtime helper (claude-plugin, codex-plugin)
includes the absolute path of this file in the fence body it writes into
`CLAUDE.md` / `AGENTS.md`, surfacing the skill's intent to the agent's
default context.

## What this exercise demonstrates

- The unified `host-instructions:` frontmatter key resolves to this file
  through `core/skill-metadata.mjs`.
- All three Plugin Runtime helpers (claude / codex / opencode) discover
  this file via the same code path — the cross-helper round-trip
  enforced by R22 in the requirements document.
- Re-running `nexel activate` with no other state changes produces
  byte-identical `CLAUDE.md` and `AGENTS.md` files (idempotency, R9).
