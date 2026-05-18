---
title: "refactor: complete the nexel rename — unfreeze STATE_DIRNAME + drop misleading badge"
type: refactor
status: completed
date: 2026-05-18
---

# refactor: complete the nexel rename — unfreeze STATE_DIRNAME + drop misleading badge

## Summary

Finish the `skillctl`→`nexel` identity rename now that the project has **zero users**, which voids the only reason ADR-0007 D4 / origin R6 froze the on-disk state directory. Two changes: rename `STATE_DIRNAME` `.skillctl`→`.nexel` (a deliberate breaking on-disk-contract change, safe pre-adoption) with a superseding **ADR-0008** recording the rationale reversal, and remove the misleading third-party npm badge from both READMEs. Ships **v0.5.2**, sequenced after Candidate 1 (PR #2) merges.

---

## Problem Frame

ADR-0007 D4 froze `STATE_DIRNAME` at `.skillctl` *specifically because* renaming it "would orphan every existing `.skillctl/` state directory on disk — a real production-behavior change with a migration cost". That rationale is entirely premised on existing adoption. The project has no users (no published npm package, git-tag/vendor distribution, no known consumers), so there are no on-disk `.skillctl/` directories to orphan — the freeze constraint is void. Leaving `.skillctl` is now pure identity incoherence with no offsetting benefit. Separately, both READMEs carry an npm-version badge that renders the **unrelated third-party squatted `skillctl` package's** version — active misinformation to any reader today. This is the deliberate completion of the identity rename, not 2b (publish) and not Candidate 1 (coverage).

---

## Requirements

- R1. `STATE_DIRNAME` is renamed `.skillctl` → `.nexel` in `scripts/installer/core/filesystem.mjs`, and every consumer is reconciled: the `stateDirFor` join already abstracts it (sole functional consumer), and the now-inaccurate `.skillctl/` explanatory comments in `scripts/installer/cli/commands/index.mjs` are corrected to `.nexel/`. The full test suite stays green.
- R2. A new **ADR-0008** supersedes **ADR-0007 D4 only** (not all of 0007): it quotes D4's freeze rationale, records that the orphaning premise is void at zero adoption, and decides the rename for full identity coherence (the pre-adoption cheap window, consistent with ADR-0007's own pre-publish-cleanup reasoning). ADR-0007's other decisions (name=`nexel`, scope-it rejection, the ADR-0005 clause retraction, deferred publish) remain in force.
- R3. The misleading npm-version badge (its HTML comment + the badge line) is removed from `README.md` and `README.zh-CN.md`. It is NOT repointed at `nexel` (unpublished); the correct badge is 2b's additive work, out of scope.
- R4. Explicitly unchanged (retention reasons independent of user count): historical records (`docs/release-notes/v0.1.0`–`v0.4.0`, `docs/adr/0001`–`0006`, `docs/plans/2026-05-18-001/002/003`); the product-literal test guards' `skillctl` token (`/\b(skillctl|netops|nexel)\b/i` — it is the legacy-leak detector); ADR-0007 + `v0.5.0`/`v0.5.1` notes (they document the rename); `pre-skillctl` historical comments in `run.mjs`/`dispatch.mjs`; `lint-release-sync.test.mjs` synthetic fixtures. **One concomitant exception** (NOT a retained-verbatim item): `scripts/lint-release-sync.mjs`'s lines ~22-28 comment that *documents* the badge is updated as part of U3 (the badge it describes is being deleted — leaving it unedited would make the comment factually false). This is a dependent doc-comment fix, in scope by necessity, distinct from the retained set above.
- R5. Ships `v0.5.2` with `docs/release-notes/v0.5.2.md`; `lint:release-sync` green; lockfile version synced (the AC-001 lesson from the 2a code review).

---

## Scope Boundaries

- This is a **deliberate breaking on-disk-contract change** — the "zero production-code behavior change" framing of 2a/Candidate 1 does NOT apply here. The state directory name changes by design; it is safe *only* because there is zero adoption (R2's ADR records exactly this).
- Not 2b (no `npm publish`, no `"private": true` removal, no contract-clock start, no README npm-install rewrite, no `pipeline.*` cleanup). Not Candidate 1 (no test-coverage work).
- The correct `nexel` npm badge is deferred to 2b (additive, when the package is actually published).
- No rewrite of historical records / guards / rename-documenting notes / historical comments / test fixtures (R4 — out of scope by reasoned decision, not omission).

### Deferred to Follow-Up Work

- The replacement `nexel` npm-version badge: added by 2b's README npm rewrite when `nexel` is published.

---

## Dependencies / Prerequisites

- **PR #2 (Candidate 1, `v0.5.1`) must be merged to `main` before this work starts.** This plan branches off post-merge `main` so it sees `v0.5.1` and bumps to `v0.5.2` (keeps `lint:release-sync` coherent; avoids forcing the already-reviewed PR #2 to renumber). If PR #2 is not yet merged at `ce-work` time, wait for the merge or rebase — do not branch off the current `v0.5.0` main and claim `v0.5.2`. (User-confirmed sequencing.)

---

## Context & Research

### Relevant Code and Patterns

- `scripts/installer/core/filesystem.mjs:28` — `export const STATE_DIRNAME = ".skillctl";` (the rename target). `:134` — `path.join(targetRoot, STATE_DIRNAME)` in `stateDirFor`, the **sole functional consumer**; `readState`/state writes all route through it, so renaming the constant is mechanically contained.
- `scripts/installer/cli/commands/index.mjs:177, 519, 624` — comments saying `.skillctl/` (dry-run / clean-target cleanup explanations). These become factually wrong after the rename → update to `.nexel/`.
- **No test asserts the literal `.skillctl` path** (verified: `grep -rn '\.skillctl' --include='*.test.mjs'` is empty). Tests exercise state via `readState`/`stateDirFor`, not the literal — so the rename should keep the suite green with no test edits. Re-verify at implementation; if a literal coupling is found, update that assertion in the same unit.
- `README.md:9-10` and `README.zh-CN.md:9-10` — the npm badge: line 9 is the explanatory HTML comment, line 10 is `[![npm version](https://img.shields.io/npm/v/skillctl...)](https://www.npmjs.com/package/skillctl)`. Both lines removed, both files.
- `docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md` D4 — the verbatim freeze text ADR-0008 must quote and supersede. ADR-0001 D1 (ADR practice) is the format reference; next sequential number is `0008`.
- `scripts/lint-release-sync.mjs` — version == newest `docs/release-notes/v*.md` (semver). Mirror the `v0.5.0`/`v0.5.1` note + atomic-bump pattern.

### Institutional Learnings

- ADR-0007 itself establishes the governing principle: pre-publish/pre-adoption identity changes are the *cheap window* and are routine, not breaking-with-ceremony. ADR-0008 invokes that same reasoning to reverse D4 specifically.
- 2a code-review AC-001: a version bump without regenerating `package-lock.json` breaks `npm ci` for git-tag/vendor consumers. U4 syncs the lockfile proactively.

### External References

- None. Fully internal mechanical rename + ADR; the surface is enumerated above.

---

## Key Technical Decisions

- **ADR-0008 supersedes ADR-0007 D4 only.** Scoped supersession: quote D4's "would orphan every existing `.skillctl/` state directory" rationale, record that zero adoption voids it, decide the rename. The rest of ADR-0007 stays in force. This keeps the ADR log coherent (no "code says `.nexel`, accepted ADR says frozen-`.skillctl`-by-design" contradiction) — the exact incoherence prior doc-reviews flagged elsewhere.
- **Breaking change, honestly framed.** Unlike 2a/Candidate 1, this DOES change the on-disk contract. The release note and ADR-0008 state it plainly; safety rests entirely on the zero-adoption premise, recorded as the load-bearing assumption.
- **Badge removed, not repointed.** Repointing at `nexel` would link an unpublished/empty package. Removing eliminates today's misinformation; the correct badge is 2b's additive work.
- **Sequenced after PR #2.** Branch off post-merge `main` (has `v0.5.1`) → `v0.5.2`. Avoids renumbering the open, already-reviewed Candidate-1 PR. (User-confirmed.)

---

## Open Questions

### Resolved During Planning

- Freeze reversal justified? Yes — ADR-0007 D4's sole rationale (orphaning existing state dirs) is void at zero adoption (user-confirmed premise). Recorded via ADR-0008.
- Version/branch base: `v0.5.2` off post-merge `main`, sequenced after PR #2 (user-confirmed).
- Badge: remove, not repoint (user-confirmed, option 1).

### Deferred to Implementation

- Whether any non-test code path beyond `stateDirFor` string-embeds `.skillctl` (e.g., a log line) — swept at U2 time; the grep found only the constant + comments, but re-verify against the live tree post-PR#2-merge.

---

## Implementation Units

### U1. Superseding ADR-0008

**Goal:** Record the decision to unfreeze and rename `STATE_DIRNAME`, superseding ADR-0007 D4 only.

**Requirements:** R2

**Dependencies:** None (but the whole plan is gated on the PR #2 prerequisite)

**Files:**
- Create: `docs/adr/0008-unfreeze-state-dirname-rename-to-nexel.md`

**Approach:**
- Mirror the ADR format (`docs/adr/0001` reference; `docs/adr/0007` as the document being partially superseded). Quote ADR-0007 D4's freeze rationale verbatim ("would orphan every existing `.skillctl/` state directory on disk…"). Record: the project has zero adoption → no on-disk `.skillctl/` dirs exist → the orphaning premise is void → `STATE_DIRNAME` renamed `.skillctl`→`.nexel` for full identity coherence, taken now as the pre-adoption cheap window (ADR-0007's own pre-publish-cleanup principle). State explicitly: this supersedes **D4 only**; ADR-0007's other decisions remain in force. Frontmatter `supersedes: 0007 (D4 only)` style note.
- ADR-0007 D4 also carries a Consequences clause ("the on-disk state directory they already have stays `.skillctl` and needs no migration"). ADR-0008 must explicitly neutralize that too, not just the rationale: under zero adoption there is no "they already have" — the rename ships with **no migration shim by design** (nothing to migrate), which is a different basis than D4's "frozen, so no migration". Make ADR-0008 leave no part of D4 reading as still-in-force.

**Patterns to follow:** `docs/adr/0007-...` (supersession + verbatim-quote-then-retract structure), `docs/adr/0001` (ADR practice).

**Test scenarios:**
- Test expectation: none — documentation artifact, no behavioral change. Covered by U4's `npm test` + `lint:release-sync`.

**Verification:** `docs/adr/0008-*.md` exists, quotes D4 verbatim, scopes supersession to D4 only, `docs/adr/0007-*.md` byte-unchanged.

---

### U2. Rename STATE_DIRNAME .skillctl → .nexel

**Goal:** Change the on-disk state directory name and reconcile all consumers; suite stays green.

**Requirements:** R1

**Dependencies:** U1 (decision recorded before its execution — mirrors 2a's ADR→rename ordering)

**Files:**
- Modify: `scripts/installer/core/filesystem.mjs` (line 28 constant)
- Modify: `scripts/installer/cli/commands/index.mjs` (the `.skillctl/` comments at ~L177/519/624 → `.nexel/`)

**Approach:**
- Change `STATE_DIRNAME = ".skillctl"` → `".nexel"`. `stateDirFor` (`:134`) already composes via the constant — no other functional edit needed. Update the three explanatory comments in `commands/index.mjs` so they remain accurate (`.skillctl/` → `.nexel/`).

**Execution note:** Characterize-first — before editing, re-run the literal sweep (`grep -rn '\.skillctl' scripts/ --include='*.mjs'` excluding tests) on the post-PR#2 tree to confirm no functional path beyond `stateDirFor` + the three comments embeds the literal. If a hidden coupling (e.g., a log string, a test assertion) appears, fix it in this unit. This is a deliberate breaking on-disk change — not "zero behavior change"; the suite staying green proves *internal* consistency, the ADR-0008 zero-adoption premise is what makes the *external* break safe.

**Patterns to follow:** the 2a `filesystem.mjs` lock-message edit (single-constant change, suite-green verification).

**Test scenarios:**
- Happy path: install → `stateDirFor(targetRoot)` resolves to `<root>/.nexel`; `readState` round-trips through the new dir; the existing commands/multiMulti suites (which create temp targets and read state) stay green unchanged.
- Edge case: a fresh target has no `.skillctl` AND no `.nexel` until first write — dry-run still leaves neither (the comments' invariant, now about `.nexel/`).
- Integration: install → uninstall round-trip writes/removes `<root>/.nexel/` state; repair reconciles against `<root>/.nexel/`.
- Regression: full `npm test` green with **no test-file edits** (proves the literal was never test-coupled); if any edit was needed, it is recorded as a found coupling.

**Verification:** `STATE_DIRNAME === ".nexel"`; `grep -rn '\.skillctl' scripts/ --include='*.mjs'` (excluding tests) returns only any deliberately-retained historical comments, none functional; full suite green.

---

### U3. Remove the misleading npm badge

**Goal:** Stop rendering the unrelated third-party `skillctl` package's version on both READMEs.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `README.md` (remove the badge HTML comment + badge line, ~L9-10)
- Modify: `README.zh-CN.md` (same, ~L9-10)
- Modify: `scripts/lint-release-sync.mjs` (the lines ~22-28 comment block that *documents* the now-removed badge as "the only version-bearing badge … points at the third-party package on purpose — see ADR-0007")

**Approach:**
- Delete both the explanatory HTML comment and the `[![npm version]...skillctl...]` line in each README. Leave the surrounding badge row (License / Node / Type / Tests) intact. Do not add a `nexel` badge (2b territory — package unpublished).
- `scripts/lint-release-sync.mjs:~22-28` explains *why* there is no README-release-badge check, citing the dynamic npm badge that this unit deletes. After removal that comment is factually false (there is no npm badge at all). Update it to state the README npm badge was removed in this cleanup (ADR-0008; the correct `nexel` badge is deferred to 2b) so the rationale stays accurate. This is a comment-only edit — `lint-release-sync`'s logic is untouched.

**Patterns to follow:** the existing badge block in each README (remove cleanly, keep the others aligned).

**Test scenarios:**
- Test expectation: none — documentation, no behavioral change. (`lint:release-sync`'s advisory README heuristic must still pass — U4 verifies.)

**Verification:** neither README contains `npm/v/skillctl`; the other badges still render; no dangling empty comment line.

---

### U4. v0.5.2 release + zero-regression verification

**Goal:** Ship as an additive patch (atop Candidate 1's v0.5.1), prove internal consistency.

**Requirements:** R5

**Dependencies:** U1, U2, U3; plan-level prerequisite PR #2 merged

**Files:**
- Create: `docs/release-notes/v0.5.2.md`
- Modify: `package.json` (version `0.5.1` → `0.5.2`), `package-lock.json` (regenerate — version sync)

**Approach:**
- `v0.5.2.md` (mirror `v0.5.0`/`v0.5.1` shape): headline = completed the identity rename — `STATE_DIRNAME` `.skillctl`→`.nexel` (**a deliberate breaking on-disk-contract change, safe because zero adoption**, ADR-0008 supersedes ADR-0007 D4) + removed the misleading third-party npm badge. State plainly this is NOT zero-behavior (the state dir name changed); contract clock still not started (ADR-0007), `"private": true` retained. Note for any future consumer: there is no migration shim — pre-adoption by design.
- Bump `package.json` 0.5.1 → 0.5.2; regenerate `package-lock.json` (AC-001 lesson). Atomic version+note.

**Patterns to follow:** `docs/release-notes/v0.5.1.md`; `scripts/lint-release-sync.mjs` version==newest-note contract; the 2a U6 lockfile-sync step.

**Test scenarios:**
- Happy path: `npm run lint:release-sync` exit 0 (0.5.2 == newest note v0.5.2; v0.5.1 present from the merged PR #2).
- Integration: full `npm test` green; `git diff` shows only `filesystem.mjs` (1 line) + `commands/index.mjs` (3 comments) + 2 READMEs (badge removed) + `lint-release-sync.mjs` (badge-doc comment updated, logic untouched) + ADR-0008 + v0.5.2 note + version + lockfile — no other production logic, no historical-record/guard/fixture edits.
- Edge case: `lint:manifest`/`lint:drift` unaffected (no manifest logic touched).

**Verification:** `lint:release-sync` green; `v0.5.2.md` present; `npm test` green; lockfile version == 0.5.2; diff scope matches R4 (nothing out-of-scope touched).

---

## System-Wide Impact

- **Interaction graph:** the only functional production change is `STATE_DIRNAME`'s value, consumed solely via `stateDirFor` → all state read/write paths transparently use `.nexel/` after the change. No call-signature or logic change.
- **State lifecycle risks:** the on-disk state directory name changes. **There is intentionally no migration** — any pre-existing `.skillctl/` dir (there are none: zero adoption) would simply be ignored by the new code. This is the deliberate break ADR-0008 authorizes.
- **API surface parity:** none — `STATE_DIRNAME` is not a public export; `index.mjs` surface unchanged.
- **Unchanged invariants:** all public exports; Z-layer guard; product-literal guards (still forbid `skillctl|netops|nexel`); `lint:release-sync` semantics; `"private": true`; ADR-0007's non-D4 decisions; every historical record.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| PR #2 not merged when ce-work starts → version/branch-base collision | Plan-level prerequisite (Dependencies): wait for PR #2 merge or rebase; do NOT branch off v0.5.0 main and claim v0.5.2 |
| A hidden `.skillctl` literal coupling outside `stateDirFor`/comments | U2 execution note: characterize-first literal sweep on the post-merge tree before editing; fix any coupling in-unit |
| The breaking change is mistaken for zero-behavior (like 2a) | ADR-0008 + v0.5.2 note state plainly it IS an on-disk-contract break, safe only by the zero-adoption premise |
| Over-broad cleanup creeps into history/guards/fixtures | R4 + Scope Boundaries enumerate the out-of-scope retention set with reasons; U4 diff-scope verification asserts nothing else changed |
| Removing the badge leaves a malformed badge row | U3 verification: other badges still render, no dangling comment/blank line |

---

## Documentation / Operational Notes

- No runtime/rollout impact beyond the deliberate state-dir rename (unpublished kernel; zero adoption). Vendor/git-tag consumers (none known) pull the `v0.5.2` tag; the release note states there is no migration by design.
- After this lands, the identity rename `skillctl`→`nexel` is functionally complete; remaining `skillctl` occurrences are 100% by-design (historical records, legacy-leak guards, rename-documenting ADR/notes) — recorded in R4 so a future reader does not re-flag them.

---

## Sources & References

- Prior decisions (referenced, not carried-forward origin): `docs/brainstorms/2026-05-18-rename-skillctl-to-nexel-requirements.md` (R6/R8 froze STATE_DIRNAME — this plan reverses that on the changed no-users premise), `docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md` (D4 superseded by ADR-0008; rest in force), `docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md` (ADR practice + D2 on-disk-identity reasoning)
- Related code: `scripts/installer/core/filesystem.mjs` (`STATE_DIRNAME`, `stateDirFor`), `scripts/installer/cli/commands/index.mjs` (`.skillctl/` comments), `README.md` / `README.zh-CN.md` (badge), `scripts/lint-release-sync.mjs`
- Sequencing: PR #2 (Candidate 1, `v0.5.1`) must merge first; this ships `v0.5.2`
