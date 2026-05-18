---
title: "refactor: Rename skillctl → nexel and supersede ADR-0005 (2a)"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-05-18-rename-skillctl-to-nexel-requirements.md
---

# refactor: Rename skillctl → nexel and supersede ADR-0005 (2a)

## Summary

Execute step 2a only: rename the project's live identity `skillctl` → `nexel`, write a new ADR that supersedes ADR-0005 (decoupling the name decision from publish/contract-clock), and ship it as a tagged `v0.5.0` release. The `.skillctl` on-disk state-directory name is deliberately frozen (R8). Candidate 1 and 2b are out of scope — sequenced behind this per the origin, not planned here.

---

## Problem Frame

The `skillctl` npm name is squatted and the maintainer wants the project identity firm without waiting on publish. The brainstorm resolved the WHAT (rename to the coined mark `nexel`, decouple identity from publish) and is the origin for this plan (see Sources & References). This plan is HOW 2a lands mechanically without a logic or on-disk-contract change.

---

## Requirements

- R1. Live identity renamed `skillctl` → `nexel` across the real carriers (`package.json` name/URLs/keywords, forward-facing docs under the R3 mixed-file rule), NOT package-only; sample-product prefixes are already product-agnostic and out of surface (origin R1).
- R2. New ADR supersedes ADR-0005, explicitly quotes and retracts its "supersession starts the contract clock and removes `private:true`" clause, and records the name decision, the `.skillctl` decoupling, and the coined-mark rationale (origin R2).
- R3. Historical records (prior release-notes, ADRs `0001`–`0006`, prior plans) NOT rewritten; mixed historical/forward files follow the per-statement partition rule (origin R3).
- R6. `STATE_DIRNAME = ".skillctl"` is frozen — not renamed in 2a; "zero production-code behavior change" scoped to "no logic change and no on-disk-contract change" (origin R8).
- R7. Product-literal regression guards extended so the invariant "kernel strings embed no product literal" survives the rename — they must forbid `nexel`, not merely swap the matched token (origin R1).
- R8. 2a ships as a tagged `v0.5.0` release with a release note; `lint:release-sync` stays green; full suite stays green with no behavioral delta (origin Success Criteria).

**Origin acceptance examples:** AE1 (covers the 2a-does-not-unblock-2b gate — honored here as a Scope Boundary, not an implemented behavior), AE2 (covers R3 — historical notes untouched, superseding ADR records `nexel`)

---

## Scope Boundaries

- No logic change, no on-disk-contract change. `STATE_DIRNAME` stays `.skillctl`; the `.skillctl/` explanatory comments in the command layer stay accurate and are not touched.
- ADR-0005 is NOT edited — it is superseded by the new ADR and left intact as a historical record.
- Historical records (prior release-notes `v0.1.0`–`v0.4.0`, ADRs `0001`–`0006`, prior plans, the origin brainstorm doc itself) are NOT rewritten to say `nexel`.
- No `npm publish`, no `"private": true` removal, no public-API contract-clock start, no `pipeline.*` cleanup, no README "real npm install" rewrite beyond the name string itself.
- No sample-product ProductConfig prefix change (already `sample`/`sample-`; not a `skillctl` carrier).

### Deferred to Follow-Up Work

- Candidate 1 (post-v0.4.0 residual coverage sweep): its own ce-plan → ce-work cycle after 2a (origin R7, R4).
- 2b publish enablement (remove `private:true`, `npm publish` as `nexel`, README npm-install rewrite, contract-clock start, `pipeline.*` cleanup): after Candidate 1 lands (origin R5).
- GitHub repository rename `skillctl` → `nexel`: an out-of-band maintainer action — see Dependencies / Prerequisites.

---

## Context & Research

### Relevant Code and Patterns

Surface map from a repo-wide `skillctl` literal sweep, categorized:

- **Live-identity carriers (rename → `nexel`):** `package.json` (name line 2; repository URL line 10; homepage line 12; bugs URL line 14; keywords line 25), `package-lock.json` (name — regenerate, do not hand-edit), `README.md`, `README.zh-CN.md`, `CONTEXT.md`, `docs/AGENT-CLI-CONTRACT.md`, `CLAUDE.md` (mixed-file — R3 rule).
- **Frozen per R6 (no change):** `scripts/installer/core/filesystem.mjs:28` (`STATE_DIRNAME = ".skillctl"`); `scripts/installer/cli/commands/index.mjs:177,519,624` (`.skillctl/` explanatory comments — stay accurate).
- **Production string hygiene:** `scripts/installer/core/filesystem.mjs:154` lock message embeds the literal `skillctl` — genericize to remove the brand entirely (not rename to `nexel`), consistent with the product-agnostic invariant the guards enforce.
- **Comment-level provenance refs (R3 mixed-file judgment):** `scripts/installer/cli/dispatch.mjs:2`, `scripts/installer/cli/run.mjs:7` ("pre-skillctl" historical narration); `scripts/lint-release-sync.mjs:4,19,21,23`; `scripts/installer/core/asset-types.test.mjs:24`; `examples/sample-product/bin.mjs:3,11,15`.
- **Product-literal guards (R7):** `scripts/installer/cli/strings.test.mjs:31` (`PRODUCT_LITERAL = /\b(skillctl|netops)\b/i`), `scripts/installer/cli/help.test.mjs:42` (inline regex), `scripts/installer/cli/prompts.test.mjs:50,53` (`renderBanner` hygiene assertion).
- **Historical records (NOT touched):** `docs/plans/2026-05-18-001/002/003-*.md`, `docs/adr/0001,0003,0004,0005-*.md`, `docs/release-notes/v0.2.0,v0.3.0,v0.4.0.md`.
- **Additional live-identity carriers (found in the full sweep — were missing from the first pass):** `LICENSE:3` ("skillctl contributors" — a live-identity legal/attribution string → rename under R1, see Documentation/Operational Notes for the copyright-attribution caveat); `.husky/pre-commit:2-3` ("skillctl repo pre-commit" — forward-facing narration → rename under R3). Both handled in U3.
- **Intentionally-untouched test scaffolding:** `scripts/lint-release-sync.test.mjs` synthetic `skillctl` fixtures (lines 46, 55–57, 127) are harness fixtures, NOT live identity — left as-is, like the sample-product `sample`/`sample-` prefixes. U6's `git diff` gate must NOT flag these as a leak.
- **README npm badge (NOT a rename surface):** `README.md:9` / `README.zh-CN.md:9` carry `shields.io/npm/v/skillctl` → `npmjs.com/package/skillctl`, which `scripts/lint-release-sync.mjs:23` documents as the **unrelated squatted third-party package** (ADR-0005). Mechanically renaming it to `nexel` would point it at yet another unowned package. It is explicitly NOT a live-identity carrier; its disposition belongs to 2b's README npm rewrite, out of scope here (see U3 carve-out).
- **Release discipline:** `scripts/lint-release-sync.mjs` enforces `package.json` version == newest `docs/release-notes/v*.md`; pattern to mirror for U6 (precedent: `docs/release-notes/v0.4.0.md`).

### Institutional Learnings

- No `docs/solutions/` directory in the repo; institutional context lives in ADRs. ADR-0005 (release model), ADR-0001 (frozen invariants — confirms no literal `skillctl` is frozen in the SPI contract, only field shape/prefix rules) are the load-bearing prior decisions.

### External References

- None. A literal rename within a known repo needs no external research; the surface is mechanically enumerable (done above).

---

## Key Technical Decisions

- **ADR-0007 supersedes ADR-0005 with an explicit retraction clause.** The new ADR must quote ADR-0005's "that decision starts the public-API contract clock and removes `private:true`" and explicitly retract it, recording the deliberate name/publish decoupling. Without the explicit retraction the ADR log self-contradicts (origin M6 finding). Next sequential number is 0007 (`docs/adr/` holds 0001–0006).
- **Lock message genericized, not renamed.** `filesystem.mjs:154` becomes brand-free ("another run" rather than "another `nexel` run") so it does not reintroduce a product literal the guards (U5) now forbid. Chosen over a `nexel` swap, which would immediately trip the extended guard and re-create the exact coupling the rename is escaping.
- **Guards gain `nexel`, keep `skillctl`/`netops`.** The invariant is "no product literal in kernel strings"; `skillctl`/`netops` stay as legacy-leak detectors and `nexel` is added — the guard is not a swap.
- **`package-lock.json` is regenerated, not hand-edited.** Its `name` derives from `package.json`; an `npm install` after U2 reproduces it deterministically.
- **2a ships as `v0.5.0`.** Vendor/git-tag consumers need the package-name change signalled; the repo's `lint:release-sync` discipline requires version == newest release note. User-confirmed at planning.

---

## Open Questions

### Resolved During Planning

- Release shape of 2a: tagged `v0.5.0` + release note (user-confirmed).
- `filesystem.mjs:154` lock message: genericize (remove literal), not rename to `nexel` (user-confirmed).
- ADR number: `0007` (next sequential).

### Deferred to Implementation

- Exact per-statement application of the R3 mixed-file rule inside `CLAUDE.md` / `CONTEXT.md` / READMEs (which sentences are live-identity vs historical narration) — a line-level judgment made while editing, governed by the origin R3 rule; not a structural unknown.
- Whether `examples/sample-product/bin.mjs` comments read as live-identity ("the `nexel` kernel") or historical — applied per R3 at edit time; low stakes (comments only).

---

## Implementation Units

### U1. Superseding ADR-0007

**Goal:** Write the ADR that locks the name and decouples identity from publish — the core 2a deliverable that closes the maintainer's "provisional name" loop.

**Requirements:** R2, R3, R6

**Dependencies:** None

**Files:**
- Create: `docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md`

**Approach:**
- Follow the existing ADR format (`docs/adr/0001-...` is the format reference). Record: name resolved = `nexel`; coined-mark rationale (saturated descriptive namespace, structural unsquattability) and the honest scope-it rejection (identity-firmness, not "re-enters namespace"); the `.skillctl` STATE_DIRNAME decoupling (R6); and that the public-API contract clock / `npm publish` / `"private": true` removal remain deferred.
- Include a verbatim quote of ADR-0005's clause "that decision starts the public-API contract clock and removes `private:true`" and an explicit retraction recording why the name decision is deliberately decoupled.
- Mark ADR-0005 superseded by pointer in 0007; do NOT edit `docs/adr/0005-*.md`.

**Patterns to follow:** `docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md` (ADR structure); ADR-0005 supersession-trigger language.

**Test scenarios:**
- Test expectation: none — documentation artifact, no behavioral change. Covered by U6 (`lint:manifest`/suite unaffected; ADR is prose). `Covers AE2.` (superseding ADR records `nexel`; ADR-0005 left intact.)

**Verification:**
- `docs/adr/0007-*.md` exists, supersedes 0005, contains the verbatim-quoted retraction clause; `docs/adr/0005-*.md` byte-unchanged.

---

### U2. package.json + lockfile identity rename

**Goal:** Rename the package's machine-readable identity.

**Requirements:** R1

**Dependencies:** U1 (the decision is recorded before its mechanical execution, per the brainstorm 2a ordering)

**Files:**
- Modify: `package.json` (name, repository url, homepage, bugs url, keywords entry)
- Modify: `package-lock.json` (regenerated via dependency install, not hand-edited)

**Approach:**
- `name`: `skillctl` → `nexel`. Repository/homepage/bugs URLs: `github.com/SeasonTemple/skillctl` → `…/nexel` (depends on the GitHub repo rename — see Dependencies / Prerequisites; GitHub redirects soften a temporary mismatch). Keywords: drop/rename the `skillctl` entry to `nexel`.
- `"private": true` stays (2b territory).
- Regenerate `package-lock.json` so its `name` matches.

**Patterns to follow:** existing `package.json` field shape.

**Test scenarios:**
- Test expectation: none — identity string change, no behavioral path. Covered by U6 full-suite regression + `lint:release-sync`.

**Verification:**
- `package.json` name is `nexel`; `npm test` still green; `package-lock.json` name matches; `"private": true` retained.

---

### U3. Forward-facing docs rename (R3 mixed-file rule)

**Goal:** Rename live-identity statements in forward-facing docs without falsifying historical narration.

**Requirements:** R1, R3

**Dependencies:** U1

**Files:**
- Modify: `README.md`, `README.zh-CN.md`, `CONTEXT.md`, `docs/AGENT-CLI-CONTRACT.md`, `CLAUDE.md`, `LICENSE`, `.husky/pre-commit`

**Approach:**
- Apply the origin R3 per-statement partition: rewrite live-identity statements ("this repo is `skillctl`", current package name, commands, layout) to `nexel`; preserve historical narration verbatim (provenance, "forked at v0.5.1", references to past release-notes/ADRs by original name) and add a forward pointer ("formerly `skillctl`; see ADR-0007") rather than rewriting past-tense statements.
- `LICENSE:3` ("skillctl contributors") and `.husky/pre-commit:2-3` ("skillctl repo pre-commit") are live-identity → rename to `nexel`. See Documentation/Operational Notes for the LICENSE copyright-attribution caveat (a maintainer/legal call, not an implementer guess).
- **Carve-out — README npm badge is NOT renamed:** the `shields.io/npm/v/skillctl` → `npmjs.com/package/skillctl` badge in both READMEs references the squatted third-party package per ADR-0005 / `scripts/lint-release-sync.mjs:23`. Do NOT rewrite it to `nexel` (that would point at another unowned package). Leave it untouched; its disposition belongs to 2b's README npm-install rewrite.
- Do NOT touch historical records (prior plans/ADRs/release-notes, the origin brainstorm doc) or the `lint-release-sync.test.mjs` synthetic fixtures.

**Patterns to follow:** origin R3 mixed-file rule (the canonical decision rule for this unit).

**Test scenarios:**
- Test expectation: none — documentation, no behavioral change. `Covers AE2.` (historical references preserved, not falsified.)

**Verification:**
- Forward-facing docs say `nexel` for current identity; any retained historical reference carries a forward pointer; historical record files are byte-unchanged.

---

### U4. Production-code string hygiene + R6 freeze

**Goal:** Remove the brand literal from the runtime lock message; apply R3 to comment-level provenance refs; explicitly leave the frozen state-dir untouched.

**Requirements:** R1, R6

**Dependencies:** U1

**Files:**
- Modify: `scripts/installer/core/filesystem.mjs` (line 154 lock message only — genericize; line 28 `STATE_DIRNAME` explicitly UNCHANGED)
- Modify: `scripts/installer/cli/dispatch.mjs`, `scripts/installer/cli/run.mjs`, `scripts/lint-release-sync.mjs`, `scripts/installer/core/asset-types.test.mjs`, `examples/sample-product/bin.mjs` (comment-level refs per R3)
- Unchanged (explicit): `scripts/installer/cli/commands/index.mjs` `.skillctl/` comments (accurate while STATE_DIRNAME frozen)

**Approach:**
- `filesystem.mjs:154`: rewrite the lock error message to carry no product literal (e.g. "target already locked by another run").
- Comment refs: apply R3 — "pre-skillctl" historical narration may stay (optionally "pre-`nexel`/formerly skillctl"); current-behavior comment refs ("skillctl's getAssetType…", "the skillctl kernel") → `nexel`. Low-stakes, comment-only.
- `STATE_DIRNAME = ".skillctl"` and the command-layer `.skillctl/` comments are deliberately NOT changed (R6).

**Execution note:** Characterize before editing the lock message — confirm the existing `ERR_LOCKED` message is asserted nowhere (grep test suite) so genericizing it is not a silent test break; if a test asserts the literal, update that assertion in the same unit.

**Patterns to follow:** the product-agnostic intent ADR-0001 records; `filesystem.mjs` error-construction style.

**Test scenarios:**
- Edge case: trigger `ERR_LOCKED` (existing lock present) → error message contains no `skillctl`/`nexel`/`netops` literal.
- Error path: existing `ERR_LOCKED` behavior (code, thrown type) unchanged — only the message string differs.

**Verification:**
- `STATE_DIRNAME` is still `.skillctl`; lock message brand-free; `npm test` green; no `ERR_LOCKED` logic change.

---

### U5. Product-literal guard extension

**Goal:** Make the "no product literal in kernel strings" invariant survive the rename by forbidding `nexel` too.

**Requirements:** R7

**Dependencies:** U1

**Files:**
- Modify: `scripts/installer/cli/strings.test.mjs` (line 31 `PRODUCT_LITERAL` — `/\b(skillctl|netops)\b/i`)
- Modify: `scripts/installer/cli/help.test.mjs` (line 42 inline regex — currently `/\b(skillctl|netops)\b/`, **no `/i` flag**)
- Modify: `scripts/installer/cli/prompts.test.mjs` (line 53 `renderBanner` assertion — currently `/NetOps|netops|skillctl/`, **no `/i`, no `\b`**; AND line 135 second intro-hygiene assertion `/NetOps|netops/` — both)

**Approach:**
- The three guards have **materially different shapes** — do not treat them as one regex. Normalize all to `/\b(skillctl|netops|nexel)\b/i`: this adds the missing `/i` (case-insensitive) to `help.test.mjs:42` and `prompts.test.mjs:53/135`, adds the missing `\b` word boundaries to the `prompts.test.mjs` assertions, and adds the `nexel` token everywhere. Without the `/i` normalization, capitalized `Nexel`/`NEXEL` would slip past `help.test.mjs` and `prompts.test.mjs` — the exact case the error-path scenario below requires to fail.
- `skillctl`/`netops` are retained as legacy-leak detectors; `nexel` is added — this is not a token swap. The guard intent comment should state: kernel strings must embed no product literal, old or new.
- `prompts.test.mjs:135` (`/NetOps|netops/.test(intros)`) is a second hygiene guard the first pass missed — it gets the same normalization.

**Execution note:** Add the failing assertion first (a synthetic kernel string containing `nexel` must fail the guard) before widening the regex, so the guard's new coverage is witnessed.

**Patterns to follow:** existing `PRODUCT_LITERAL` regex and the v0.4.0 `renderBanner` hygiene test (origin/plan-003 precedent).

**Test scenarios:**
- Happy path: a kernel string with no product literal → guard passes.
- Error path: a string embedding `nexel` (any case: `nexel`, `Nexel`, `NEXEL`) → guard fails.
- Error path (legacy retained): a string embedding `skillctl` or `netops` → guard still fails.
- Edge case: word-boundary respected (`nexel` as substring of an unrelated longer token behaves identically to the pre-existing `skillctl` boundary behavior — no new false positives vs. the current regex semantics).

**Verification:**
- `npm run test:strings`, the `help` and `prompts` suites green; an injected `nexel` literal demonstrably fails the guard; full suite green.

---

### U6. v0.5.0 release + zero-behavior-change verification

**Goal:** Ship 2a as a tagged release and prove no behavioral/contract delta.

**Requirements:** R8, R6

**Dependencies:** U1, U2, U3, U4, U5

**Files:**
- Create: `docs/release-notes/v0.5.0.md`
- Modify: `package.json` (version `0.4.0` → `0.5.0`)

**Approach:**
- `v0.5.0.md` (mirror `docs/release-notes/v0.4.0.md` shape): headline = identity rename `skillctl` → `nexel` + ADR-0007 supersedes ADR-0005; explicitly note `STATE_DIRNAME` frozen at `.skillctl` (no on-disk migration, zero behavior change); `"private": true` retained, publish still deferred; vendor/git-tag consumers must update the package name they pull.
- Final atomic unit: version bump + `v0.5.0.md` together so `lint:release-sync` stays green (version == newest note).
- Verify: full `npm test` green with the same test count as pre-rename modulo U5's added guard assertions; `STATE_DIRNAME` unchanged; no logic diff.

**Patterns to follow:** `docs/release-notes/v0.4.0.md`; `scripts/lint-release-sync.mjs` version==newest-note contract.

**Test scenarios:**
- Happy path: `npm run lint:release-sync` exit 0 (0.5.0 == newest note `v0.5.0`).
- Integration: full `npm test` green; suite count == prior + U5's net assertion delta only; no other behavioral diffs.
- Edge case: `lint:manifest` / `lint:drift` unaffected (no manifest/identity-token logic touched).

**Verification:**
- `lint:release-sync` green; `v0.5.0.md` present; `npm test` green; `git diff` shows only: identity strings (incl. `LICENSE`, `.husky/pre-commit`), the new ADR, the genericized lock message, guard widening, version+note — no logic changes, and explicitly NO change to `lint-release-sync.test.mjs` synthetic fixtures or the README npm badge; `STATE_DIRNAME` is `.skillctl`.

---

## System-Wide Impact

- **Interaction graph:** No runtime interaction change. The only production-code edit is the `filesystem.mjs` lock-message string (U4) — message text only, `ERR_LOCKED` code/flow unchanged.
- **Error propagation:** Unchanged. Lock error still throws the same `FsError`/`ERR_LOCKED`; only the human-readable message differs and is now brand-free.
- **State lifecycle risks:** None introduced. `STATE_DIRNAME` frozen at `.skillctl` (R6) — no orphaned-state-dir migration, the explicit reason it is frozen.
- **API surface parity:** `package.json` `name` is the external contract for git-tag/vendor consumers — the rename IS the intended contract change, signalled via the `v0.5.0` release note. No code API surface changes.
- **Integration coverage:** U6 full-suite regression is the cross-layer proof that a pure-identity change introduced no behavioral delta.
- **Unchanged invariants:** Z three-layer architecture guard, ProductConfig/Adapter-SPI-v1 contract (ADR-0001 froze shape/prefix rules, not the literal `skillctl`), `STATE_DIRNAME`, all command/exit-code behavior, `"private": true`.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Lock message literal is asserted by a test → genericizing silently breaks it | U4 execution note: grep the suite for the `ERR_LOCKED` message before editing; update the assertion in the same unit if found |
| A `nexel` literal leaks into kernel strings during the rename | U5 widens the guard to catch exactly this; U5 runs as part of 2a, not after |
| `STATE_DIRNAME` accidentally renamed by an over-broad sweep → orphaned state dirs, behavior change | R6 + U4 call it out explicitly as frozen; U6 verification asserts `.skillctl` unchanged |
| Historical records falsified by an over-broad rename | R3 mixed-file rule + U3 explicitly excludes historical files; U6 `git diff` review confirms historical files byte-unchanged |
| `package.json` URLs point to a not-yet-renamed GitHub repo | GitHub auto-redirects old repo URLs; rename is an out-of-band prerequisite (below); temporary mismatch is non-breaking |

### Dependencies / Prerequisites

- **GitHub repository rename `skillctl` → `nexel`**: an out-of-band maintainer action, not a code change. GitHub serves redirects from the old path so `package.json` URL updates (U2) do not hard-break before the repo is renamed, but the canonical repo should be renamed around the same time. Flagged, not blocking.

---

## Documentation / Operational Notes

- `CLAUDE.md` "What this repo is" and layout sections are forward-facing current-state → renamed under R3; provenance lines ("forked at v0.5.1 of the internal product") are historical narration → preserved with a forward pointer.
- Vendor/git-tag consumers: the `v0.5.0` release note must state the package name changed `skillctl` → `nexel` and that no behavior/on-disk-contract changed (state dir stays `.skillctl`), so consumers update only the name they pull.
- `LICENSE:3` copyright attribution ("skillctl contributors" → "nexel contributors"): renaming a copyright-attribution string mid-project is a maintainer/legal call, not an implementer default. U3 renames it for identity coherence, but flag it for maintainer confirmation rather than treating it as a silent mechanical edit.
- No runtime/rollout/monitoring impact — unpublished kernel, `"private": true` retained.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-18-rename-skillctl-to-nexel-requirements.md](docs/brainstorms/2026-05-18-rename-skillctl-to-nexel-requirements.md)
- Related ADRs: `docs/adr/0005-release-model-no-npm-provisional-name.md` (superseded by 0007), `docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md` (confirms no frozen `skillctl` literal in the SPI contract)
- Related code: `scripts/installer/core/filesystem.mjs` (`STATE_DIRNAME`, lock message), `scripts/installer/cli/{strings,help,prompts}.test.mjs` (product-literal guards), `package.json`, `scripts/lint-release-sync.mjs`
- Prior release-note pattern: `docs/release-notes/v0.4.0.md`
