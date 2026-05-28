---
name: sample:sample-host-context
category: setup
description: Demo skill exercising the unified `host-instructions:` Skill Metadata key used by `nexel activate`.
host-instructions: references/host-context.md
---

# Sample Host Context

This skill demonstrates the **unified `host-instructions:` frontmatter key**
introduced in v0.8 for cross-CLI ambient context. The same instruction
file referenced here is picked up by Claude Code, Codex, and OpenCode plugin
runtimes via their respective Plugin Runtime helpers.

`hello-world` in this same sample product retains the legacy
`opencode-instructions:` key as a back-compat alias — both skills coexist
in this sample tree precisely so the alias mechanism is exercised
end-to-end (R2, R7, AE5).

## When to Activate

- Verifying `nexel activate` writes ambient fences into `CLAUDE.md` /
  `AGENTS.md` containing this skill's instruction file path
- Validating the cross-helper round-trip: this skill's `host-instructions:`
  is discoverable by claude-plugin, codex-plugin, and opencode-plugin
  helpers without duplicate declarations
- Onboarding to v0.8 — the canonical example of the unified key

## Frontmatter Contract

Every `SKILL.md` MAY declare ambient instructions via one of two keys:

- `host-instructions: <relative-path>` (unified — recommended for v0.8+)
- `opencode-instructions: <relative-path>` (legacy alias, retained for back-compat)

When both are present in the same skill, `host-instructions:` wins and the
discover layer logs a single warning naming both keys.

Paths must be relative to the skill directory, single-token, unquoted,
and must not escape the skill directory (`..` rejected).
