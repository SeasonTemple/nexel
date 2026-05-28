---
status: accepted
date: 2026-05-28
---

# Unified `host-instructions:` Skill Metadata key + `opencode-instructions:` alias precedence + `--target=opencode` refuse semantics

## Context

ADR-0009 established the Plugin Runtime concept and the subpath-export pattern
(`./adapters/opencode-plugin`) for post-install host wiring. At that point only
OpenCode had a Plugin Runtime helper, and skills declared their ambient
instructions through `opencode-instructions:` frontmatter — a key whose name
hard-coded one specific CLI even though the underlying file (a markdown
fragment) is usable as ambient context by any host that loads `CLAUDE.md`,
`AGENTS.md`, or equivalent.

v0.8 extends Plugin Runtime laterally to Claude Code and Codex
(`./adapters/claude-plugin`, `./adapters/codex-plugin`) and introduces a new
top-level verb `nexel activate` that writes ambient-context fences into
target host files. This raised three sticky decisions that warrant ADR-level
capture:

1. **Skill Metadata key shape.** Three CLIs now consume the same per-skill
   instruction file. A per-CLI key triplet (`claude-instructions:` /
   `codex-instructions:` / `opencode-instructions:`) duplicates a single fact
   in three places; existing skills that already declare
   `opencode-instructions:` would either need rewriting or per-CLI
   parallels.
2. **Alias precedence semantics.** Allowing both an old key and a new key to
   coexist requires a deterministic rule for which wins and what happens
   when both are present — silent precedence is a bug breeder.
3. **`nexel activate --target=opencode` behavior.** OpenCode already has a
   runtime hook (`configureOpenCode` called from the OpenCode plugin entry
   at OpenCode boot) that mutates `config.instructions[]`. A nexel-driven
   activate for OpenCode is either a no-op or a double-write; silent no-op
   hides the divergence.

## Decision

### D1: Unified `host-instructions:` Skill Metadata key

A new frontmatter key `host-instructions: <relative-path>` is introduced as
the **preferred** way for a skill to declare an ambient-context instruction
file. The value is the relative path to a markdown fragment inside the
skill directory. All three Plugin Runtime helpers (claude-plugin,
codex-plugin, opencode-plugin) resolve the same key through the structured
reader in `scripts/installer/core/skill-metadata.mjs`.

The semantic claim of `host-instructions:` is "this file is usable as
ambient context by any CLI that loads a per-host markdown file
(`CLAUDE.md`, `AGENTS.md`, or the OpenCode config.instructions list)." It
does NOT create a new Asset type (CONTEXT.md `Asset` enum stays closed at
skill / agent / rule per ADR-0001 D2's spirit) and it does NOT enter the
manifest — it is Skill Metadata.

### D2: `opencode-instructions:` retained as back-compat alias with `host-instructions:` taking precedence

Skills that declared `opencode-instructions:` in v0.6 / v0.7 continue to
work unchanged. The structured reader
(`readHostInstructions(frontmatterText)`) returns a value from either key,
with `host-instructions:` winning when both are present:

- Only `host-instructions:` present → returned with `source: "host"`,
  `duplicateDetected: false`
- Only `opencode-instructions:` present → returned with `source: "opencode"`,
  `duplicateDetected: false`
- Both present → `host-instructions:` value returned with `source: "host"`,
  `duplicateDetected: true`. The discover layer of each Plugin Runtime
  helper emits exactly one warning per skill naming both keys and the
  resolved choice.

The legacy free function `readOpenCodeInstructions` is preserved as a
back-compat wrapper that delegates to the structured reader and returns
just the raw value. Callers importing the old name (including any
downstream code) see no behavioral change.

This alias is **not** intended as permanent dual-key support. Future schema
migration work (Idea 5c in the ideation artifact) may collapse to a single
key via the schema-migration ladder; until that ladder exists, the alias
is the back-compat mechanism.

### D3: `nexel activate --target=opencode` refuses with `ERR_ACTIVATE_OPENCODE_REFUSED`

OpenCode activation already happens at OpenCode boot via
`nexel/adapters/opencode-plugin` — the OpenCode plugin entry imports
`configureOpenCode` and mutates `config.instructions[]` directly. A
nexel-driven activate for OpenCode would be either a no-op (if the
OpenCode plugin entry is correctly wired) or a double-write (if it
weren't). Either outcome is worse than refusing explicitly.

`nexel activate --target=opencode` therefore exits non-zero with a typed
`ERR_ACTIVATE_OPENCODE_REFUSED` error code, surfacing a structured
`details.reason` that points the operator at
`nexel/adapters/opencode-plugin`. The default `nexel activate` (no
`--target`) activates `claude` and `codex` only, skipping OpenCode
silently because OpenCode is not in the default target set.

### D4: Scope is explicit (`--scope=user|project`), default `project`; state-derived inheritance deferred

`nexel activate --scope=user` writes fences under home
(`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`); `--scope=project` writes to
cwd. The brainstorm doc's R17 (state-derived scope inheritance) is
deferred to a follow-up release — each adapter has its own state, and
cross-adapter scope inference adds significant complexity for v0.8.

## Consequences

- **Backward compatibility is preserved.** Existing skills declaring
  `opencode-instructions:` and existing OpenCode plugin entries continue
  to work without modification (verified end-to-end by the v0.8 sample
  product's `hello-world` skill, which retains the legacy key alongside
  the new `sample-host-context` skill that uses `host-instructions:`).
- **The Skill Metadata vocabulary grows by exactly one key.** No new Asset
  type; no manifest schema change; no ProductConfig field change. ADR-0001
  D2's identity invariant is preserved.
- **Two keys for one concept is a temporary state.** The alias mechanism
  documents a back-compat seam, not a permanent dual surface. A future
  schema-migration ladder (Idea 5c in the absorption ideation) will be
  the mechanism for collapsing back to one key when adoption permits.
  Until then, both work.
- **Adapter authors gain a stable convention.** Any future Plugin Runtime
  helper (e.g. a hypothetical Cursor helper) consumes the same
  `host-instructions:` key through `readHostInstructions`. The Skill
  Metadata reader is the contract; per-CLI keys are not.
- **`nexel activate` exit codes are stable.** Two new public error codes
  (`ERR_ACTIVATE_OPENCODE_REFUSED`, `ERR_ACTIVATE_INVALID_SCOPE`) join the
  kernel error catalog. Code constants follow the existing stable-string
  convention (`code === name`) per ADR-0001 D4-adjacent practice.
- **Fence markers carry product name.** Multi-product host coexistence in
  `~/.claude/CLAUDE.md` is a v0.8 design goal even though v0.8 itself
  ships only single-product semantics — the marker convention is
  forward-compatible with Idea 4b's multi-tenant host-registry. Editing
  any fence pair preserves every other product's fence byte-identically.

## References

- `docs/ideation/2026-05-28-netops-skills-absorption-ideation.md` — Idea 4a
  post-grill scope; G2 boundary correction (no new Asset type)
- `docs/brainstorms/2026-05-28-plugin-runtime-expansion-requirements.md` —
  origin requirements doc (R1-R23, AE1-AE5, six Key Decisions)
- `docs/plans/2026-05-28-001-feat-plugin-runtime-expansion-plan.md` — the
  plan this ADR records the outcomes of (KD7 + KD8 plan-time scope
  corrections feed back into D1 / D3 here)
- [ADR-0009](0009-opencode-plugin-runtime-instructions.md) — Plugin
  Runtime concept and subpath-export pattern (this ADR extends, does not
  re-open)
- [ADR-0001](0001-adopt-adr-practice-and-record-frozen-invariants.md) — D2
  frozen ProductConfig identity invariant (not touched by this work);
  Asset enum closure spirit (not extended)
- [ADR-0002](0002-adapter-content-transform-via-spi-hook.md) /
  [ADR-0010](0010-spi-v12-plugin-install-instructions-product-config.md) —
  SPI evolution policy (this ADR does not touch SPI; `nexel activate` is
  install-time post-processing, not an SPI hook)
- `scripts/installer/core/skill-metadata.mjs` — the structured reader
  contract
- `scripts/installer/core/ambient-fence.mjs` — shared fence writer
- `scripts/installer/adapters/claude-plugin.mjs` /
  `scripts/installer/adapters/codex-plugin.mjs` — Plugin Runtime helpers
- `scripts/installer/cli/commands/activate.mjs` — verb implementation
