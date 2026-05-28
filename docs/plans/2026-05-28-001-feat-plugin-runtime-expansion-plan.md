---
status: active
origin: docs/brainstorms/2026-05-28-plugin-runtime-expansion-requirements.md
date: 2026-05-28
---

# feat: Plugin Runtime expansion — claude-plugin + codex-plugin + nexel activate

## Summary

Add a new `nexel activate` verb plus two Plugin Runtime helpers (`claude-plugin.mjs`, `codex-plugin.mjs`) that follow the established ADR-0009 subpath-export pattern. Introduce a unified `host-instructions:` Skill Metadata field with `opencode-instructions:` retained as a back-compat alias. `nexel activate` writes idempotent ambient context fences into `CLAUDE.md` / `AGENTS.md` at the install target scope. Marketplace JSON synchronization (R12/R13 in the origin) is deferred — sample plugin JSON inspection at plan time showed no dynamic content to sync beyond what `verifyMarketplaceLockstep` already covers.

## Problem Frame

nexel v0.7.0 has three target-CLI adapters (Claude Code, Codex, OpenCode) but only one Plugin Runtime helper (`opencode-plugin.mjs`). Downstream products installing into Claude Code or Codex must hand-edit ambient context files (`CLAUDE.md`, `AGENTS.md`) to surface installed skills to the agent's default context — fragile, drift-prone, re-invented per product. The origin requirements doc (see origin: `docs/brainstorms/2026-05-28-plugin-runtime-expansion-requirements.md`) frames this as Idea 4a from the netops-skills absorption ideation (post-grill split): the Plugin Runtime concept already exists per ADR-0009; the gap is its lateral coverage.

The grill pass corrected the original "sister package" framing — sister packages would duplicate the established concept; subpath exports inside the kernel package are the existing precedent and stay.

---

## Key Technical Decisions

### KD1. Unified `host-instructions:` Skill Metadata key with `opencode-instructions:` alias

One frontmatter key serves all three CLIs because the underlying file is a markdown fragment usable as ambient context by every host. `opencode-instructions:` is retained as a precedence-yielding alias so existing NAS skills work unchanged. When both are present, `host-instructions:` wins and a warning names the duplicate (see origin KD1).

### KD2. Independent `nexel activate` verb — never auto-run on install

Activation is a separate explicit step. `nexel install` continues to do file-placement only. This preserves the install-plane / activation-plane separation, keeps install non-intrusive, and lets CI pipelines decide when activation runs (see origin KD2).

### KD3. Fence target scope inherits from install

`nexel activate --target=user` writes to home (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`); `--target=project` writes to cwd. `--scope` defaults to the most recent install's recorded scope (read from `<target>/.nexel/state.json`), and is overridable with an explicit flag (see origin KD3).

### KD4. Shared `core/ambient-fence.mjs` + per-CLI helpers

CLI-agnostic fence-write logic (read target file, locate / insert marker block, write back, preserve other-product fences, byte-stable idempotency) lives in `core/ambient-fence.mjs`. Per-CLI helpers (`claude-plugin.mjs`, `codex-plugin.mjs`) call it; `opencode-plugin.mjs` keeps its runtime config-mutation pattern unchanged (see origin KD4).

### KD5. Fence markers carry product name

Fence blocks use `<!-- nexel:<productName>:begin -->` / `<!-- nexel:<productName>:end -->`. A home `CLAUDE.md` can host multiple product fences without collision. Forward-compatible with future multi-tenant host-registry work (Idea 4b) (see origin KD5).

### KD6. Activation steps are best-effort + idempotent in this scope

Each activate step is idempotent. If Idea 4b's `runTransactional` public primitive ships later, activate steps refactor into transactional steps; in this scope crash recovery relies on idempotency alone (see origin KD6).

### KD7. Marketplace JSON sync deferred (plan-time scope correction)

Origin R12 / R13 (claude/codex marketplace JSON sync via `activateClaude` / `activateCodex`) are deferred to follow-up work. Plan-time inspection of `examples/sample-product/.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` showed no dynamic content for `activate` to mutate — `skills: ["./skills/"]` is a static directory pointer, and `version` synchronization is already covered by v0.7 U6 `verifyMarketplaceLockstep`. Re-open when real dynamic content emerges.

### KD8. `nexel activate --target=opencode` refuses with pointer

OpenCode's plugin runtime already mutates `config` at OpenCode boot via `configureOpenCode` in `scripts/installer/adapters/opencode-plugin.mjs`. A nexel-driven activate for opencode would be either no-op or a double-write; silent no-op hides semantics. Activate refuses with a typed error code pointing the user at the OpenCode plugin entry. `--target=claude` and `--target=codex` activate normally.

---

## Requirements Traceability

Origin R-IDs honored in this plan: R1-R11 in full; R12-R15 deferred (see KD7); R16-R23 in full. Mapping per unit appears under each U-step's **Requirements** field.

---

## Implementation Units

### U1. Add `HOST_INSTRUCTIONS_KEY` + reader to `core/skill-metadata.mjs`

**Goal:** Expose the unified `host-instructions:` Skill Metadata key as a kernel primitive, with `opencode-instructions:` back-compat resolution semantics.

**Requirements:** R1, R2, R3.

**Dependencies:** none.

**Files:**
- `scripts/installer/core/skill-metadata.mjs` (modify)
- `scripts/installer/core/skill-metadata.test.mjs` (new — currently no dedicated test file; behavior covered indirectly via `opencode-plugin.test.mjs`. Extract to make the unified-field semantics first-class.)

**Approach:**
- Add `HOST_INSTRUCTIONS_KEY = "host-instructions"` constant
- Add `isValidHostInstructionsPath(value)` that delegates to the same predicate body as the existing `isValidOpenCodeInstructionsPath` (single relative path, no quotes, no whitespace, no `..` segments, not absolute on either platform). Consider extracting the shared validator into a private `isValidRelativeSkillPath(value)` and re-exporting under both names for back-compat.
- Add `readHostInstructions(frontmatterText)` that:
  - First scans for a `host-instructions:` line; if found and valid, returns its value
  - Otherwise scans for `opencode-instructions:`; if found and valid, returns its value (alias fallback)
  - When both are present in the same frontmatter, returns the `host-instructions:` value (precedence). The duplicate-warning emission is a caller concern (per the existing pattern where the reader returns the raw value and the discover-layer warns); ensure the reader exposes enough information for callers to detect both-present.
- One option: change the reader to return `{value, source: "host" | "opencode" | null, duplicateDetected: boolean}`. Update existing callers (`opencode-plugin.mjs`) to consume the structured return; legacy `readOpenCodeInstructions(frontmatterText)` stays as a thin wrapper returning just the value for back-compat callers (test file currently imports it).

**Patterns to follow:** Mirror the shape of the existing `OPENCODE_INSTRUCTIONS_KEY` / `isValidOpenCodeInstructionsPath` / `readOpenCodeInstructions` block; same line-scan strategy; same validator predicate set.

**Test scenarios:**
- `isValidHostInstructionsPath` accepts plain relative path; rejects empty, leading-space, quoted, escape-via-`..`, absolute POSIX, absolute Windows, UNC, non-string. (Mirror the existing opencode validator scenarios verbatim with the renamed predicate.)
- `readHostInstructions` returns the declared path when only `host-instructions:` present.
- `readHostInstructions` returns the declared path when only `opencode-instructions:` present (alias fallback).
- `readHostInstructions` returns the `host-instructions:` value when both are present (precedence) AND signals duplicate detection in the structured return.
- `readHostInstructions` returns `null` (or the structured `null` shape) when neither key present.
- Legacy `readOpenCodeInstructions` wrapper continues to return raw string value for back-compat.
- **Covers AE1** (precedence + duplicate warning) — once the discover-layer warning fires in U2.

**Verification:** All scenarios above pass under `node --test`. Existing `opencode-plugin.test.mjs` keeps passing without modification (back-compat wrapper intact).

---

### U2. Update `opencode-plugin.mjs` to consume `host-instructions:` via the structured reader

**Goal:** Existing OpenCode helper accepts skills that declare only `host-instructions:` (no `opencode-instructions:`), emits warnings on duplicate declarations, retains current API surface.

**Requirements:** R2, R7. **Covers AE5.**

**Dependencies:** U1.

**Files:**
- `scripts/installer/adapters/opencode-plugin.mjs` (modify)
- `scripts/installer/adapters/opencode-plugin.test.mjs` (modify — add tests for host-instructions discovery + duplicate warning)

**Approach:**
- Replace internal call to `readOpenCodeInstructions` (legacy wrapper) with the structured `readHostInstructions` reader from U1
- When the structured return signals `duplicateDetected: true`, emit a `warn(logger, ...)` naming both keys and the skill name. Format: `opencode plugin: skill <name> declares both host-instructions and opencode-instructions; using host-instructions`
- Public exports unchanged: `configureOpenCode`, `discoverOpenCodeInstructions`, `readOpenCodeInstructions` (legacy thin wrapper now), `isValidOpenCodeInstructionsPath` (back-compat alias for `isValidHostInstructionsPath`)
- The package.json `./adapters/opencode-plugin` subpath export does not change.

**Patterns to follow:** Existing `warn(logger, ...)` invocations in the file. `discoverOpenCodeInstructions` already iterates skills directory; just swap the per-skill reader.

**Test scenarios:**
- Skill with only `host-instructions: references/host.md` is discovered (file exists at that path inside the skill dir).
- Skill with only `opencode-instructions: references/opencode.md` continues to be discovered (alias still works — back-compat).
- Skill with both keys uses `host-instructions:`, file at that path is discovered, AND exactly one warning is emitted mentioning both keys and the skill name.
- `configureOpenCode` idempotency test continues passing with mixed-key skills in the same skills dir.
- **Covers AE5** (back-compat: skill declaring only `host-instructions:` activates in OpenCode equivalently to legacy `opencode-instructions:`).

**Verification:** New tests pass; all existing tests in `opencode-plugin.test.mjs` continue passing without modification.

---

### U3. New `core/ambient-fence.mjs` — idempotent CLI-agnostic fence writer

**Goal:** A reusable kernel utility that writes a marker-bracketed fence block into any target file, preserves other products' fences, and is byte-stable on repeat invocation with identical content.

**Requirements:** R8, R9, R10, R11. **Covers AE2** (multi-product coexistence on home `CLAUDE.md`) and **AE4** (idempotency under re-run).

**Dependencies:** none (can land in parallel with U1).

**Files:**
- `scripts/installer/core/ambient-fence.mjs` (new)
- `scripts/installer/core/ambient-fence.test.mjs` (new)

**Approach:**
- Exported function: `writeAmbientFence({targetPath, productName, contentBlock, logger})`
- Fence markers: `<!-- nexel:<productName>:begin -->\n` and `\n<!-- nexel:<productName>:end -->` (newline-padded so the fence sits cleanly between user prose). Use a stable regex keyed off escaped productName for replace-in-place — never a global "first/last `<!-- nexel:` marker" match (would clobber other products' fences).
- Algorithm:
  1. If target file does not exist, write `<begin>\n<contentBlock>\n<end>\n` and return `{action: "created"}`.
  2. If target file exists and contains a fence for this product (regex match on the exact marker pair), splice the new contentBlock between markers, leaving every byte outside the marker block untouched. Return `{action: "updated", changed: <bool>}` where `changed` is `true` only if the file's bytes differ post-splice.
  3. If target file exists but no fence for this product, append the fence block to end of file (preceded by exactly one blank line if file doesn't already end with `\n`). Return `{action: "appended"}`.
- Idempotency property: step (2) with byte-identical `contentBlock` produces a byte-identical file (no whitespace drift, no marker re-emission). Step (3) followed by another invocation should hit step (2), not append again.
- Logger usage: `info`-level for action taken (so `--json` envelope can include it); no warnings except on unwritable target.

**Technical design (directional, not implementation specification):**
```
Layout of a multi-product CLAUDE.md after activate:

  [user free-form prose]

  <!-- nexel:product-a:begin -->
  ... product A skill paths / instructions ...
  <!-- nexel:product-a:end -->

  <!-- nexel:product-b:begin -->
  ... product B skill paths / instructions ...
  <!-- nexel:product-b:end -->

Re-running `nexel activate` for product-b with identical contentBlock:
  → reads file, regex-matches product-b fence, splices identical content
  → file bytes unchanged, exit 0
```

**Patterns to follow:** Existing `core/` modules (`stage-asset.mjs`, `filesystem.mjs`) for IO discipline. No top-level IO side effects. Use `fs.readFileSync` / `fs.writeFileSync` from `node:fs`; no async fs.

**Test scenarios:**
- Missing target file: function creates it with only the fence block; `action: "created"`.
- Empty target file: function appends fence; result is `<begin>\n<content>\n<end>\n` with no leading blank line.
- Target file with prose but no fence for product: fence appended at end; existing bytes untouched; `action: "appended"`.
- Target file with existing fence for THIS product + identical content: byte-identical output; `action: "updated", changed: false`.
- Target file with existing fence for THIS product + different content: marker block content replaces inline; bytes outside markers unchanged; `action: "updated", changed: true`.
- Target file with fence for DIFFERENT product (`<!-- nexel:other:begin -->...`): other product's fence preserved byte-identically; this product's fence appended.
- Target file with fences for THIS and ANOTHER product: only this product's fence is rewritten; other preserved byte-identically.
- ProductName containing regex metacharacters (e.g., `acme.skills`): treated literally in marker matching, no regex injection.
- Re-running twice in succession after a first append: second run is `action: "updated", changed: false`.
- **Covers AE2** (multi-product coexistence) **and AE4** (idempotent byte equality).

**Verification:** All scenarios pass under `node --test`; `node scripts/installer/architecture.test.mjs` continues passing (the new file imports only `node:fs` / `node:path`, no adapter / cli reach-up).

---

### U4. New `adapters/claude-plugin.mjs` — Claude Code Plugin Runtime helper

**Goal:** Discover skills with `host-instructions:` in a skills directory and write a Claude Code ambient fence into the target `CLAUDE.md` (home or project per scope).

**Requirements:** R5. Indirectly **R8-R11** via shared `ambient-fence.mjs`. **Covers AE2** when invoked via `activate` (U6).

**Dependencies:** U1 (for the reader), U3 (for the fence writer).

**Files:**
- `scripts/installer/adapters/claude-plugin.mjs` (new)
- `scripts/installer/adapters/claude-plugin.test.mjs` (new)
- `package.json` (add `./adapters/claude-plugin` subpath export pointing at `./scripts/installer/adapters/claude-plugin.mjs`)

**Approach:**
- Exports:
  - `discoverClaudeInstructions(skillsDir, logger)` — walks `skillsDir`, returns absolute paths of instruction files declared by `host-instructions:` (alias-aware via U1's reader). Same shape as `discoverOpenCodeInstructions`.
  - `activateClaude({skillsDir, targetCladeMd, productName, logger})` — composes the Claude fence body from discovered instructions + skills path, calls `writeAmbientFence` with `productName` and the composed content block. Returns the `writeAmbientFence` result envelope.
- Fence body shape for Claude (directional sketch):
  ```
  <!-- nexel:<productName>:begin -->
  # nexel-installed skills (<productName>)
  Skills directory: <skillsDir>
  Ambient instructions:
  - <skill-name>: <instruction-file-path>
  - ...
  <!-- nexel:<productName>:end -->
  ```
  Final exact shape settled during implementation; the contract is "deterministic byte-identical output for identical input" so any agreed shape works.
- `targetClaudeMd` is `~/.claude/CLAUDE.md` for `--scope=user`, `./CLAUDE.md` (process cwd) for `--scope=project`. Resolution happens in U6 (the verb); this helper takes the resolved path.
- Module is exported **only** via the package.json subpath; NOT re-exported from `scripts/installer/index.mjs`. The architecture test will confirm.

**Patterns to follow:** Mirror `opencode-plugin.mjs` file-level layout. Use `core/ambient-fence.mjs` and `core/skill-metadata.mjs` only — no `adapters/` reach-across.

**Test scenarios:**
- Empty skills directory → `activateClaude` writes a fence containing the skills path but no per-skill lines (or no-op if the policy is "skip when nothing declared" — choose at implementation time and assert).
- Two skills declare `host-instructions:`; one declares neither key → fence body includes the two skills' instruction lines, omits the third.
- Skill declares `host-instructions:` but the file does not exist on disk → discover skips with a warning; fence body omits it.
- Skill declares `opencode-instructions:` only (alias) → fence body includes it (verifies U1 alias works in this helper too).
- Re-running `activateClaude` with identical skills tree produces a byte-identical `CLAUDE.md`.
- Adding a new skill between two `activateClaude` invocations changes the fence body but preserves the surrounding user prose and any other product's fence (verifies multi-product coexistence end-to-end with the new helper).
- `package.json` `exports["./adapters/claude-plugin"]` points at the correct file path.
- `installer/index.mjs` does NOT re-export `activateClaude` or `discoverClaudeInstructions` (per ADR-0009 D2).
- **Covers AE2.**

**Verification:** All scenarios pass; architecture test continues passing.

---

### U5. New `adapters/codex-plugin.mjs` — Codex Plugin Runtime helper

**Goal:** Same shape as U4, targeting `AGENTS.md` for Codex.

**Requirements:** R6. Indirectly **R8-R11**. **Covers AE2** when invoked via `activate`.

**Dependencies:** U1, U3.

**Files:**
- `scripts/installer/adapters/codex-plugin.mjs` (new)
- `scripts/installer/adapters/codex-plugin.test.mjs` (new)
- `package.json` (add `./adapters/codex-plugin` subpath export)

**Approach:** Identical structure to U4 with these differences:
- `targetAgentsMd` is `~/.codex/AGENTS.md` for `--scope=user`, `./AGENTS.md` (cwd) for `--scope=project`
- Fence body shape parallels U4's; substitute "Codex" / Codex-conventional language where it improves readability
- Exports: `discoverCodexInstructions`, `activateCodex`

**Patterns to follow:** U4 verbatim, with the path substitution.

**Test scenarios:** Mirror U4 with `AGENTS.md` substituted for `CLAUDE.md`. Cross-helper round-trip (R22) — a skill declaring only `host-instructions:` is correctly discovered by both `claude-plugin` and `codex-plugin` and OpenCode (after U2). Add this round-trip assertion in `codex-plugin.test.mjs` (it's the last helper to land, so it's the natural place for the three-way assertion).

**Verification:** All scenarios pass; architecture test continues passing; package.json subpath export resolves.

---

### U6. New `nexel activate` verb — CLI surface + dispatch + JSON envelope + flag handling

**Goal:** Top-level verb that orchestrates per-adapter activation; reads install state to inherit scope; honors `--target`, `--scope`, `--dry-run`, `--json`; refuses `--target=opencode` with a typed error pointing at `opencode-plugin`.

**Requirements:** R16, R17, R18, R19. Also operationalizes R5 / R6.

**Dependencies:** U4, U5 (calls the helpers). Reads state.json via existing `core/filesystem.mjs` `readState`.

**Files:**
- `scripts/installer/cli/commands/activate.mjs` (new)
- `scripts/installer/cli/commands/activate.test.mjs` (new — unit test for the command function)
- `scripts/installer/cli/dispatch.mjs` (modify — add `activate` route)
- `scripts/installer/cli/argv.mjs` (modify — recognize `activate` verb + its flags `--target`, `--scope`, `--dry-run`, `--json`)
- `scripts/installer/cli/help.mjs` (modify — add verb-scoped help entry per the v0.3.0 progressive help pattern)
- `scripts/installer/cli/strings.mjs` (modify — `strings.en.mjs` and `strings.zh.mjs` for verb summary, flag descriptions, error messages)
- `scripts/installer/cli/commands/index.mjs` (modify — export `activateCommand`; add to `KERNEL_HANDLERS`)
- `scripts/installer/core/errors.mjs` (modify — add `ERR_ACTIVATE_OPENCODE_REFUSED` + any other new typed errors needed)

**Approach:**
- `activateCommand({repoRoot, manifest, productConfig, target, scope, dryRun, json, env, logger})`:
  1. Resolve `target` list: `[]` (default → all adapters with Plugin Runtime helpers, currently `claude`, `codex`); `[id]` if `--target=<id>` provided
  2. For each `target` in list:
     - If `target === "opencode"`: throw `CommandError(ERR_ACTIVATE_OPENCODE_REFUSED, "opencode runtime activation happens at OpenCode boot via the opencode-plugin entry; nexel activate does not apply")`. With `--json`, emit a structured per-adapter result with this status instead of bailing on the whole envelope; exit code is non-zero overall but each adapter is reported.
     - If `target === "claude"`: import `./adapters/claude-plugin.mjs` (or its subpath), resolve `targetClaudeMd` from scope, call `activateClaude` (or no-op when `--dry-run`), collect result envelope
     - Same shape for `target === "codex"` via `./adapters/codex-plugin.mjs`
  3. Resolve `scope`:
     - If `--scope=user|project` provided, use it
     - Otherwise, read `<repoRoot>/.nexel/state.json` via existing `readState`; inspect `installations[]` most recent; use its recorded `mode`/`profile` to derive scope. If state is missing or ambiguous, throw `CommandError(ERR_NO_STATE, ...)` listing the actionable next step
  4. Compose final envelope: `{adapters: [{adapter, status: "activated"|"refused"|"skipped"|"failed", details: {...}}], exitCode}`
  5. With `--dry-run`, run discovery + scope resolution + plan composition but do not call `writeAmbientFence`. Envelope `status` becomes `"would-activate"` per adapter and `details` includes the planned `contentBlock` summary.
- `--json` envelope shape matches existing kernel verbs (`{ok, exitCode, data}` per AGENT-CLI-CONTRACT.md)
- Exit codes: `0` when every requested adapter activated cleanly; non-zero when any failed or refused; specific codes per `core/errors.mjs`

**Technical design (directional, not specification):**
```
Argv:
  nexel activate                              # all helpers, scope from state
  nexel activate --target=claude              # claude only
  nexel activate --scope=user                 # force home scope
  nexel activate --target=opencode            # refused with typed error
  nexel activate --dry-run --json             # JSON envelope, no writes
  nexel activate --json                       # JSON envelope, writes

JSON envelope (per CONTRACT, per-adapter results inside data):
  {
    "ok": true,
    "exitCode": 0,
    "data": {
      "scope": "user",
      "adapters": [
        {"adapter": "claude", "status": "activated", "details": {"action": "updated", "changed": true, "targetPath": "~/.claude/CLAUDE.md"}},
        {"adapter": "codex",  "status": "activated", "details": {"action": "created", "targetPath": "~/.codex/AGENTS.md"}}
      ]
    }
  }
```

**Patterns to follow:**
- Verb implementation: `cli/commands/scaffold.mjs` (v0.7 U7) is the most recent precedent for a new top-level verb. Mirror its (a) command function shape, (b) `--json` envelope construction, (c) `--dry-run` flag handling
- Help registration: existing verb-scoped help entries in `cli/help.mjs`
- Argv parsing: existing `--target`, `--profile`-style flag parsers in `cli/argv.mjs`
- Strings: `cli/strings.en.mjs` and `cli/strings.zh.mjs` parallel entries — every new user-facing string lands in both
- Typed error: `cli/error-format.mjs` already converts `CommandError` to envelope; just add the new `ERR_*` constant and matching string entries
- State read: `cli/commands/index.mjs` `assertValidExistingState` precedent — wrap `readState` with structural validation

**Test scenarios:**
- `activate` with no args + state showing user-scope install: invokes both `claude` and `codex` helpers with home target paths; envelope shows both `"activated"`; exit 0
- `activate --target=claude` with state showing project-scope install: only claude helper invoked with cwd target; envelope shows one adapter
- `activate --target=opencode`: returns envelope with `{adapter: "opencode", status: "refused", details: {...}}`; exit code is the `ERR_ACTIVATE_OPENCODE_REFUSED` code; stderr (text mode) contains the actionable message
- `activate --scope=user` overrides state (e.g., state says project, flag says user): home paths used
- `activate` with no state on disk: throws `ERR_NO_STATE` with actionable message
- `activate --dry-run --target=claude`: no file is created or modified; envelope shows `"would-activate"` with planned content summary
- `activate --json` envelope is a single parseable line on stdout (matches AGENT-CLI-CONTRACT.md)
- `activate --json --dry-run` envelope is a single parseable line, no files touched
- Re-running `activate` is a no-op (`"updated"` action, `changed: false` per adapter) — exit 0
- Help: `nexel activate --help` renders the verb-scoped block (per v0.3.0 contract); reverse order `nexel help activate` also renders it
- Strings: every user-facing string used in the new verb has both EN and ZH entries; ZH strings render under `NETOPS_LANG=zh` or system locale
- **Covers AE3** (no-args inherits scope from state, all adapters activate) **and AE4** (dry-run + idempotency surface).

**Execution note:** Test-first for the `activateCommand` function and the `--target=opencode` refuse path — both have non-trivial behavioral conditions that benefit from RED-first authoring. Plumbing changes (dispatch / argv / help) follow.

**Verification:** All command-level unit tests pass; existing `sample-bin.test.mjs` continues passing without modification (U7 adds new sample-bin scenarios separately).

---

### U7. Sample-product demo skill + cross-helper sample-bin E2E

**Goal:** Demonstrate `host-instructions:` end-to-end through the existing `examples/sample-product/` reference; exercise install + activate + back-compat in one E2E.

**Requirements:** R20, R22, R23.

**Dependencies:** U4, U5, U6.

**Files:**
- `examples/sample-product/skills/sample-host-context/SKILL.md` (new — demo skill declaring `host-instructions:`)
- `examples/sample-product/skills/sample-host-context/references/host-context.md` (new — the ambient instruction body)
- `examples/sample-product/sample.install.json` (modify — register the new skill in the manifest)
- `examples/sample-product/sample-bin.test.mjs` (modify — add `activate` scenarios; assert fences land and are idempotent)
- `examples/sample-product/.baseline/list.json` (modify — list output now includes one more skill; regenerate baseline)
- `examples/sample-product/.baseline/validate.json` (potentially modify if list-level changes affect it; verify)

**Approach:**
- New sample skill `sample-host-context` declares only `host-instructions: references/host-context.md` (no `opencode-instructions:`) — exercises the unified-field promise
- Keep the existing `opencode-instructions:` sample skill (if one exists in the sample-product) untouched so back-compat is also exercised E2E. (Audit during implementation: list current sample skills and decide whether to leave / extend / add a second alias-only skill explicitly.)
- New sample-bin scenarios:
  - `sample bin: activate --target=claude writes a CLAUDE.md fence in a temp HOME`
  - `sample bin: activate --target=codex writes an AGENTS.md fence in a temp HOME`
  - `sample bin: activate --target=opencode refuses with the expected error code`
  - `sample bin: activate --json envelope shape`
  - `sample bin: activate idempotency — second run is changed:false per adapter`
  - `sample bin: activate after install honors recorded scope`
- Use `os.tmpdir()` + `mkdtempSync` for the HOME / cwd override (same pattern as existing scaffold E2E tests)
- Baseline regen: run `npm run baseline:regen` (or the v0.7 equivalent) for sample-product after the manifest change settles. If a `baseline:regen` script does not exist in the sample-product, regenerate by running the affected canonical commands and committing the new `.baseline/*.json` content; flag this as an implementation-time check

**Patterns to follow:** Existing scaffold E2E tests in `sample-bin.test.mjs` for tmpdir + HOME override pattern. Existing baseline regen flow (see CLAUDE.md for the conventions).

**Test scenarios:** Enumerated above. Each runs the actual `sample-bin` binary (per existing `sample-bin.test.mjs` precedent — child process spawn, parse stdout / stderr / exit code).

**Verification:** All sample-bin scenarios pass; baseline files updated and the baseline regression gate (if any in nexel) passes.

---

### U8. Release notes + version bump + ADR draft

**Goal:** Cut v0.8.0 with dual-language release notes and an ADR documenting the unified `host-instructions:` Skill Metadata alias decision.

**Requirements:** Release-discipline (ADR-0001 D4); honors the dual-language `lint-release-sync` invariant.

**Dependencies:** U1-U7.

**Files:**
- `docs/release-notes/v0.8.0.md` (new — `## English` and `## 中文` sections; covers the new verb, the new Skill Metadata key + alias semantics, the deferred marketplace-sync scope, the refused `--target=opencode` semantics)
- `package.json` (modify — bump `version` from `0.7.0` to `0.8.0`; minor bump because the new verb + Skill Metadata key are additive)
- `docs/adr/0012-host-instructions-unified-skill-metadata-alias.md` (new ADR — records the unified-key decision per the brainstorm's Open ADR Candidate; satisfies grill-with-docs Open ADR list "ADR-XX: Pluggable Validator Rule Registry — kernel-generic affordance, Asset enum 闭合"? No — that one is for Idea 2. This ADR is the *Plugin Runtime expansion* + alias mechanism record. Phrase as: "Plugin Runtime expansion + host-instructions Skill Metadata with opencode-instructions alias")

**Approach:**
- Version bump justification: additive (new verb, new optional Skill Metadata key, alias mechanism preserves back-compat) — minor bump per existing conventions
- ADR content: 1-2 page record of (a) why one unified key vs three per-CLI keys, (b) alias precedence semantics, (c) deferral of marketplace JSON sync (KD7 here) with the reason ("plan-time inspection found no dynamic content"), (d) `--target=opencode` refuse-with-pointer rationale (KD8 here). Reference origin requirements doc and this plan.
- Release notes: brief, user-facing language; both sections cover the same content; `lint-release-sync` passes on both presence and version match
- Run `npm run lint:release-sync` before commit; address any failures before merging

**Patterns to follow:** Most recent release note `docs/release-notes/v0.7.0.md` for shape and dual-language structure. Recent ADRs `0010-spi-v12-...` and `0011-sample-product-...` for ADR format.

**Test scenarios:**
- `npm run lint:release-sync` passes
- `node scripts/verify-release-tag.mjs v0.8.0` would pass (run after tag, not as part of this unit's CI; verify here that the script's expectations would be met)
- Manual review: ADR satisfies ADR-0001 D1's three triggers (hard-to-reverse: alias semantics are sticky once shipped; surprising-without-context: future readers will ask why two keys; real-trade-off: unified vs per-CLI was a real choice with documented alternatives)

**Verification:** Lint passes; ADR present; package.json version is `0.8.0`; release notes carry both `## English` and `## 中文` sections covering all material changes from U1-U7.

---

## Scope Boundaries

### Active (in this plan)

- Unified `host-instructions:` Skill Metadata key with `opencode-instructions:` alias (KD1)
- `nexel activate` verb with `--target` / `--scope` / `--dry-run` / `--json` flags (KD2, KD3)
- `core/ambient-fence.mjs` shared writer (KD4)
- `claude-plugin.mjs` + `codex-plugin.mjs` (subpath-exported helpers, KD4)
- Product-named fence markers for multi-product coexistence (KD5)
- Idempotent best-effort activate steps (KD6)
- `--target=opencode` refuses with typed error (KD8)

### Deferred to Follow-Up Work

- **Marketplace JSON sync** (origin R12, R13). Plan-time inspection found no dynamic content; revisit when real per-skill manifest fields emerge. Tracking note: link this plan from any future marketplace-sync proposal.
- **`runTransactional` wrap of activate steps** (origin Scope Boundaries — Deferred for later). Lands when Idea 4b's transactional primitive ships.
- **Multi-tenant host-registry consumption** (origin Scope Boundaries — Deferred for later). Fence markers are already forward-compatible.
- **Schema migration ladder for `opencode-instructions:` → `host-instructions:` migration** (origin — Deferred for later). The alias mechanism is sufficient for back-compat in this scope; full migration to a single key is a ladder-driven future change.

### Outside this product's identity (carried from origin)

- ProductConfig schema changes (ADR-0001 D2 invariant)
- Per-CLI runtime config mutation for Claude / Codex (those CLIs don't expose a runtime config object; activation is install-time post-processing only)
- Per-skill tool-restriction parity across CLIs (ADR-0002 D4 named divergence)
- Principle-pack / Validator Rule Registry semantics (Idea 2 territory — separate ideation thread)

---

## System-Wide Impact

- **CLI surface gains one verb.** `nexel activate` is the first new top-level verb since v0.7 `scaffold`. `AGENT-CLI-CONTRACT.md` is not modified by this plan because the verb conforms to the existing contract; downstream agent integrators benefit without re-reading the contract.
- **State.json read path widens.** `activate` reads `state.json` to inherit scope (R17). The existing `assertValidExistingState` / `assertStateSelectionsKnown` helpers should apply; no schema change.
- **package.json `exports` grows two subpaths.** `./adapters/claude-plugin` and `./adapters/codex-plugin` join `./adapters/opencode-plugin`. Main `index.mjs` surface unchanged (ADR-0009 D2).
- **Skill Metadata vocabulary expands by one key.** `host-instructions:` joins `opencode-instructions:`. Validator and discover behavior changes are bounded to U1 / U2.
- **Architecture-test gate.** New files in `core/` and `adapters/` are auto-walked by `architecture.test.mjs`. No expected impact; verify per-unit.
- **No ProductConfig changes.** Frozen identity invariant (ADR-0001 D2) holds.

---

## Risks & Dependencies

### Risks

- **R-A. Fence marker collision with user prose.** If a user manually wrote text matching the `<!-- nexel:<product>:begin -->` pattern, `writeAmbientFence` would treat it as an existing fence. Mitigation: marker pattern is sufficiently distinctive (`<!-- nexel:...` prefix + `:end -->` suffix); document the convention in the v0.8.0 release notes so users avoid the collision. Severity: low (unlikely user-text collision).
- **R-B. Cross-product fence preservation regex correctness.** A buggy regex could clobber other products' fences. Mitigation: U3 has explicit test scenarios for "other product fence preserved" — both creation and re-run. Severity: medium (silent data loss if undetected).
- **R-C. State.json missing during activate.** Users who skip `install` and run `activate` get `ERR_NO_STATE`; the error message must be actionable. Mitigation: explicit error string in U6 strings entries.
- **R-D. Baseline regen drift in sample-product.** Adding a new sample skill changes baseline files; missing the regen step would break the baseline regression gate. Mitigation: U7 calls this out explicitly.
- **R-E. ZH string drift.** Forgetting to add ZH strings for new error messages would fail `lint-release-sync`. Mitigation: U6's checklist requires every EN string have a ZH counterpart; CI gate catches the rest.
- **R-F. Architecture test failure on new helper imports.** A claude-plugin or codex-plugin accidentally importing from `cli/` would break the Z three-layer invariant. Mitigation: per-unit verification step explicitly runs `architecture.test.mjs`.

### Dependencies

- No external dependencies (no new npm packages)
- Depends on existing kernel primitives: `core/skill-metadata.mjs`, `core/filesystem.mjs` (`readState`), `cli/argv.mjs` / `cli/dispatch.mjs` / `cli/help.mjs` / `cli/strings.{en,zh}.mjs`, `core/errors.mjs`
- Forward dependency: Idea 4b (`runTransactional`) eventually consumes this work via U6's activate steps being refactored into transactional steps. Not blocking.

---

## Open Questions

### Resolve before planning

- None remaining; all blockers were resolved during Phase 5.1.5 synthesis.

### Deferred to implementation

- **Fence body shape (Claude vs Codex).** U4 and U5 sketch directional shapes; the exact byte layout is settled during implementation. Constraint: deterministic, byte-stable for identical input.
- **Per-skill instruction discovery aggregation.** Should fence body list each skill+instruction pair separately, or just point at the skills directory and let the agent walk? Probably both (directory + per-skill list) — settled with code in hand.
- **`readHostInstructions` structured return shape.** Plan sketched `{value, source, duplicateDetected}`; final shape may be simpler (e.g., return value + a separate `hasDuplicate` boolean from a sibling function). Settled at U1.
- **Baseline regen mechanism for sample-product.** If a `baseline:regen` script does not exist, regen procedure is manual. Verify at U7.
- **Sample-product home-override hook for E2E tests.** Spawning the sample bin with `HOME` and `CLAUDE_HOME` / `CODEX_HOME` env overrides — verify the existing `cli/which.mjs` honors these overrides for the new helpers; if not, add the seam. Existing test infra for opencode-plugin should already have this pattern.

---

## Sources / Research

- **Origin requirements doc** — `docs/brainstorms/2026-05-28-plugin-runtime-expansion-requirements.md` (six Key Decisions, 23 R-IDs, 5 Acceptance Examples)
- **ADR-0009** — Plugin Runtime + subpath export pattern (the precedent this plan extends)
- **ADR-0011** — sample-product as downstream reference (U7 is additive, does not break reference window)
- **ADR-0001 D2** — frozen ProductConfig identity (no new ProductConfig fields)
- **ADR-0002 / ADR-0010** — SPI evolution invariants (this plan does not touch SPI; no risk)
- `scripts/installer/adapters/opencode-plugin.mjs` — working precedent for helper shape
- `scripts/installer/adapters/opencode-plugin.test.mjs` — test pattern to mirror in U4 / U5
- `scripts/installer/core/skill-metadata.mjs` — host of `OPENCODE_INSTRUCTIONS_KEY`; `HOST_INSTRUCTIONS_KEY` lands here in U1
- `scripts/installer/cli/commands/scaffold.mjs` (or its equivalent in v0.7) — most recent new-verb precedent for U6
- `examples/sample-product/sample-bin.test.mjs` — sample-bin E2E pattern to mirror in U7
- `examples/sample-product/.claude-plugin/plugin.json` / `.codex-plugin/plugin.json` / `.claude-plugin/marketplace.json` / `.agents/plugins/marketplace.json` — plan-time inspection that drove KD7 (marketplace sync deferral)
- Phase 0.5 grill pass (in `docs/ideation/2026-05-28-netops-skills-absorption-ideation.md`) — KD1 / KD2 / KD3 / KD4 / KD5 rationale
