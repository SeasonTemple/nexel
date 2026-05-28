---
date: 2026-05-28
topic: plugin-runtime-expansion
---

# Plugin Runtime Expansion — claude-plugin + codex-plugin + nexel activate

## Summary

Add `nexel activate` verb plus two new Plugin Runtime helpers (`claude-plugin.mjs`, `codex-plugin.mjs`) that mirror the existing `opencode-plugin.mjs` subpath pattern (ADR-0009). Skills declare a unified `host-instructions:` frontmatter field. Activation runs as an explicit verb that writes ambient context fences into `CLAUDE.md` / `AGENTS.md` and synchronizes per-CLI marketplace JSON, with target scope inherited from install (`--target=user` → home; `--target=project` → cwd).

## Problem Frame

`nexel` v0.7.0 installs files for all three target CLIs (Claude Code, Codex, OpenCode), but only OpenCode has a Plugin Runtime helper (`opencode-plugin.mjs`) that wires installed skills into the agent's runtime context. Downstream products targeting Claude Code or Codex must currently hand-edit:

- ambient context files (home `~/.claude/CLAUDE.md`, project `./CLAUDE.md`, equivalent `AGENTS.md` for Codex) so the agent's default context loads the installed skills
- per-CLI marketplace JSON (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, marketplace registry entries) so the CLI's plugin layer knows what was installed

Hand-editing is fragile, drift-prone, and re-invented per product. The ideation surfaced this as Idea 4a (post-grill split) — the gap is "install-plane / activation-plane separation has only landed for OpenCode", and the fix is to fill the Claude / Codex coverage using the same Plugin Runtime + subpath-export pattern that ADR-0009 established. The grill pass corrected the original framing (which proposed a separate `@nexel/activate` sister package) — sister packages duplicate existing concepts; subpath exports inside the kernel package are the established pattern.

## Key Decisions

**D1. Unified `host-instructions:` frontmatter key with `opencode-instructions:` alias.**
One skill metadata key serves all three CLIs (the underlying file is a markdown fragment usable as ambient context by every host). Existing `opencode-instructions:` is retained as a back-compat alias so installed NAS skills do not need rewriting. When both are present in one skill, `host-instructions:` wins and the reader emits a duplicate-declaration warning. Per-CLI keys (rejected) would force skill authors to declare the same path three times; an `ambient + filter` schema (rejected) added complexity without value.

**D2. Activation is an independent `nexel activate` verb, never auto-run on install.**
`nexel install` continues to do file-placement only (current behavior). `nexel activate` is a separate, explicit step that writes ambient fences and synchronizes marketplace metadata. This preserves the install-plane / activation-plane separation that motivates the whole Idea 4a thread, keeps install non-intrusive (no surprise mutations to files outside the skills tree), and lets CI pipelines decide when activation runs.

**D3. Fence target scope follows install target.**
`nexel activate --target=user` writes fences to home (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`); `--target=project` writes to cwd (`./CLAUDE.md`, `./AGENTS.md`). Inheriting from install scope prevents the "installed to home, activated in project" cross-scope confusion. No new scope vocabulary is introduced.

**D4. Shared `core/ambient-fence.mjs` + per-CLI helpers for the rest.**
The fence write logic (read target file, locate / insert idempotent fence markers, write back) is CLI-agnostic and lives in `core/ambient-fence.mjs`. The per-CLI helpers (`claude-plugin.mjs`, `codex-plugin.mjs`) call it for ambient injection and own their per-CLI marketplace JSON schemas (Claude marketplace.json, Codex plugin.json — different shapes, not shareable). `opencode-plugin.mjs` remains unchanged in structure (its runtime config mutation pattern is distinct and is not refactored in this scope).

**D5. Fence markers carry product name to support multi-product coexistence.**
Fence blocks are wrapped in markers like `<!-- nexel:<productName>:begin -->` / `<!-- nexel:<productName>:end -->` so a single home `CLAUDE.md` can host fences from multiple products without collision. This decision pre-aligns with Idea 4b's multi-tenant install plane work — the marker convention is forward-compatible with the host-registry.

**D6. Activation steps are best-effort + idempotent in this scope; transactional later.**
Each activation step (fence write, marketplace sync per CLI) is written idempotently and produces stable output. If Idea 4b (`runTransactional` public primitive) ships, activate steps will be refactored into transactional steps; in this scope they are not wrapped, and crash recovery relies on idempotency alone.

## Requirements

### Skill Metadata

R1. `core/skill-metadata.mjs` exposes a `HOST_INSTRUCTIONS_KEY` constant (`host-instructions`) and `readHostInstructions(frontmatterText)` that returns the declared relative path, `null` when absent, or `null` with a warning when the value is invalid.

R2. The existing `OPENCODE_INSTRUCTIONS_KEY` (`opencode-instructions`) is retained verbatim as a back-compat alias. `readHostInstructions` falls back to it when `host-instructions:` is absent. When both keys are present in the same skill frontmatter, `host-instructions:` takes precedence and a warning is emitted naming the duplicate declaration.

R3. Path validation for `host-instructions:` matches the existing `opencode-instructions:` rules (single relative path, no quote characters, must not escape the skill directory, must exist on disk).

R4. `nexel validate` (single-file lint) reports `host-instructions:` violations alongside other frontmatter violations with the same severity and exit-code conventions as today.

### Plugin Runtime helpers

R5. `scripts/installer/adapters/claude-plugin.mjs` exports the per-CLI helpers Claude Code activation needs: `discoverClaudeInstructions(skillsDir, logger)`, `activateClaude({skillsDir, targetScope, productConfig, logger})`. The module is exported via subpath (`./adapters/claude-plugin`) and is **not** re-exported from `scripts/installer/index.mjs` (per ADR-0009 D2).

R6. `scripts/installer/adapters/codex-plugin.mjs` exports the analogous functions for Codex: `discoverCodexInstructions`, `activateCodex`. Same subpath-export discipline.

R7. `scripts/installer/adapters/opencode-plugin.mjs` retains its current API surface and behavior unchanged. Its readers update to consume `host-instructions:` via `core/skill-metadata.mjs` so a skill that declares only `host-instructions:` activates correctly in OpenCode.

### Ambient fence

R8. `core/ambient-fence.mjs` exports `writeAmbientFence({targetPath, productName, contentBlock, logger})` which idempotently injects or replaces a fence block in the target file. Fence markers are `<!-- nexel:<productName>:begin -->` and `<!-- nexel:<productName>:end -->`.

R9. Fence write is idempotent: re-running on a file with an existing fence for the same product replaces the inner content and leaves the rest of the file untouched. Re-running with identical content produces a byte-identical file.

R10. When the target file does not exist, `writeAmbientFence` creates it with only the fence block. When the target file exists but contains no fence for this product, the fence is appended.

R11. Fence blocks from other products (different `productName` inside the markers) are preserved untouched. This satisfies the multi-product coexistence requirement.

### Marketplace JSON sync

R12. `claude-plugin.mjs` activation reads installed skills and the `.claude-plugin/plugin.json` at the install target. It updates the `plugin.json` fields that describe the installed skill set (exact field surface is per Claude Code's plugin manifest schema; subject to verification during planning) and leaves all other fields untouched.

R13. `codex-plugin.mjs` performs the analogous sync against `.codex-plugin/plugin.json` (and any Codex marketplace registry path that applies; subject to verification during planning).

R14. Marketplace sync is idempotent: re-running with no changes produces byte-identical JSON output (stable key ordering, no whitespace drift).

R15. Marketplace sync does **not** overlap with the v0.7.0 U6 `verifyMarketplaceLockstep` helper — that helper checks version consistency *across* manifests; this requirement updates the *contents* of one manifest based on installed skills. Both can coexist.

### Verb interface

R16. `nexel activate` is a new top-level kernel verb. Without arguments it activates every adapter that has a Plugin Runtime helper. `--target=<adapterId>` scopes activation to one adapter (`claude`, `codex`, `opencode`).

R17. `--scope=user|project` is honored but defaults to inheriting from the most recent install's recorded scope (read from `<target>/.nexel/state.json`). When state is absent or ambiguous, the verb refuses with a non-zero exit and an actionable error.

R18. `--json` returns a structured envelope listing per-adapter outcomes (`{adapter, status: "activated"|"skipped"|"failed", details}`). Exit code 0 when every requested adapter activated cleanly, non-zero when any failed.

R19. `--dry-run` reports what `activate` would do without writing any file. Output shape matches `--json` envelope.

### Testing

R20. `claude-plugin.test.mjs` and `codex-plugin.test.mjs` mirror the existing `opencode-plugin.test.mjs` shape (per-helper unit coverage of read / discover / activate; round-trip + idempotency assertions).

R21. `ambient-fence.test.mjs` covers fence creation, fence update, multi-product coexistence preservation, idempotent re-run byte equality, and missing-target-file creation.

R22. A cross-helper test asserts that a skill declaring only `host-instructions:` is correctly discovered by all three Plugin Runtime helpers (the unified-field promise).

R23. `examples/sample-product/` gains a sample skill that declares `host-instructions:` (additive — does not break ADR-0011 sample-product reference window). The existing `opencode-instructions:` sample skill remains so back-compat is also exercised E2E.

## Acceptance Examples

**AE1.** **Covers R2, R10.** A skill declares both `host-instructions: docs/skill-context.md` and `opencode-instructions: docs/skill-context.md`. Activation succeeds; `host-instructions:` is the source of truth; a single warning is logged naming the duplicate; no behavior change vs declaring only `host-instructions:`.

**AE2.** **Covers R8, R9, R11.** Home `~/.claude/CLAUDE.md` contains an existing fence for product `acme-skills` and free-form user text below it. `nexel activate --target=user` for product `nexel-sample` appends a second fence (markers carry `nexel-sample`). The `acme-skills` fence and the user text are byte-identical to before; only the new fence block is added.

**AE3.** **Covers R16, R17.** Product was installed with `--target=user`. The user runs `nexel activate` (no args). Activate inherits user scope from state, writes fences to home for all three adapters, syncs marketplace JSON in the user-scope plugin layout, and exits 0.

**AE4.** **Covers R9, R14, R19.** Running `nexel activate --dry-run` followed by `nexel activate` followed by `nexel activate` again produces: dry-run reports the planned writes; first real run writes them; second real run is a no-op and exits 0 with the `--json` `status: "skipped"` per adapter (or `"activated"` with empty `details.changed`).

**AE5.** **Covers R7.** A skill declares only `host-instructions: docs/ambient.md`. Installing and then loading the product as an OpenCode plugin produces the same `config.instructions` entry it would have produced under `opencode-instructions: docs/ambient.md`. Back-compat is not regressed.

## Scope Boundaries

### Deferred for later

- **`runTransactional` wrap of activate steps** (Idea 4b). Activate uses idempotent best-effort steps in this scope; transactional wrap arrives when Idea 4b lands.
- **Multi-tenant host-registry** (Idea 4b). Fence markers carry product name so they are forward-compatible with the registry, but the registry itself ships separately.
- **Schema migration ladder** (Idea 5c). The `opencode-instructions:` → `host-instructions:` alias mechanism is a one-time back-compat seam in this scope; future schema migrations will use the ladder.
- **Marketplace lockstep cross-check** (already shipped as v0.7 U6 `verifyMarketplaceLockstep`). This work updates manifests; the lockstep check verifies them. Both run independently.

### Outside this product's identity

- **ProductConfig changes.** ADR-0001 D2's frozen identity invariant holds; no new required field on `ProductConfig` and no change to the existing five.
- **Per-CLI runtime config mutation for Claude / Codex.** Claude Code and Codex do not expose a runtime config object that nexel can mutate at agent boot. Activation in this scope is install-time post-processing only.
- **Per-skill tool-restriction parity across CLIs.** ADR-0002 D4's named divergence (Claude `tools:` restriction does not survive OpenCode transform) is unchanged.
- **New `principle-pack` semantics** (Idea 2). The `host-instructions:` field is for ambient context only, not for principle-pack metadata.

## Dependencies / Assumptions

- **ADR-0009 stands.** Plugin Runtime + subpath-export pattern remains the established mechanism for post-install host wiring. This work extends it; it does not re-open it.
- **Claude Code and Codex plugin manifest shapes will be confirmed during planning.** The exact field surface that `claude-plugin.mjs` and `codex-plugin.mjs` write into `plugin.json` is read from the installed CLI's plugin schema at planning time. R12 / R13 deliberately leave that detail to `ce-plan`.
- **`<target>/.nexel/state.json` records install scope.** R17 reads the install scope from state. State schema already carries enough information; if planning discovers it does not, that becomes a state-schema dependency to resolve.
- **No NAS upstream change required.** Existing NAS skills using `opencode-instructions:` continue to work unchanged via R2's alias.

## Outstanding Questions

### Resolve before planning

- **None.** All product-level decisions are pinned above.

### Deferred to planning

- The exact `.claude-plugin/plugin.json` field set that `activateClaude` writes (R12) — read from Claude Code's current plugin manifest schema during planning.
- Same for `.codex-plugin/plugin.json` (R13).
- Whether `--target=opencode` should refuse or no-op on a system without OpenCode runtime present (today OpenCode's helper is called at agent runtime, not by `nexel activate`). Planning chooses between: (a) `activate --target=opencode` is a synonym for syncing OpenCode marketplace JSON only, since the runtime config mutation still happens at OpenCode boot; (b) refuse with a message pointing the user at the OpenCode plugin entry.
- Test fixture layout for cross-helper round-trip test (R22) — likely a shared `tests/fixtures/host-instructions/` directory consumed by all three plugin tests.

## Sources / Research

- ADR-0001 — frozen ProductConfig identity invariant (D2) constrains R-set
- ADR-0002 — SPI v1.1 content transform; this work's helpers are install-time post-processing, not SPI hooks
- ADR-0009 — Plugin Runtime + subpath-export pattern (the precedent this work extends)
- ADR-0011 — sample-product as downstream reference (R23 additive, does not break)
- `scripts/installer/adapters/opencode-plugin.mjs` — working precedent for helper shape
- `scripts/installer/adapters/opencode-plugin.test.mjs` — test pattern to mirror
- `scripts/installer/core/skill-metadata.mjs` — host of `OPENCODE_INSTRUCTIONS_KEY`; `HOST_INSTRUCTIONS_KEY` lands here
- `docs/ideation/2026-05-28-netops-skills-absorption-ideation.md` — Idea 4a (Plugin Runtime横向扩展) post-grill scope
