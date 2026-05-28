---
date: 2026-05-29
goal_slug: backlog-clear
target_release: v0.9.0
orchestrator: claude-code-opus-4-7
execution_path: A (Claude Code in-app /goal + manual orchestration)
token_budget: 200000
status: active
---

# Goal: Clear v0.8.5 backlog → cut v0.9.0

Detailed reference for the in-app `/goal` condition. `/goal` stores a
short condition string; this file holds the full 5-section template,
baseline, and per-phase audit log.

## Baseline (Phase 0, captured 2026-05-29)

| Item | Value |
|---|---|
| Current version | 0.8.5 |
| ADR count | 15 (0001..0015) |
| Next ADR slot | 0016 |
| `removeAmbientFence` exists? | **No** (only `writeAmbientFence`, `hasAmbientFence`) |
| `validateManifest` Diagnostic shape | `findings[]` via `formatFindings` + `exitCodeFor` |
| `index.mjs` public exports | 22 (all additive boundary) |

## 5-Section Goal

### Objective

Clear nexel v0.8.5 release-notes backlog (4 items) and cut v0.9.0:

1. **adv-009** — `deactivate` verb (additive: adds `removeAmbientFence` + verb wiring)
2. **CI bless path** — ADR-0013 pre-tag review gate enforceable in CI / fresh-clone
3. **ADR-0016** — Pluggable Validator Rule Registry (ideation idea 2, kernel-generic segment only)
4. **TOCTOU** — `lstat`/`lockSync` cross-platform symlink-race defense (v0.8.5 deferred)

### Scope

**IN:**
- `scripts/installer/{core,adapters,cli}/` (kernel)
- `examples/sample-product/` (witness/regression only)
- `docs/adr/0016..0019` (new)
- `docs/plans/`, `docs/goals/`, `docs/release-notes/v0.9.0.md`
- `.husky/` (only if needed)

**OUT:**
- Sister packages `@nexel/governance` / `@nexel/vendor` (defer ≥ v0.9.1)
- Ideation ideas 1/3/4/6/7
- npm publish (ADR-0005 v1.0 clock untouched)
- Windows CI matrix add (defer; theoretical Windows path only)

### Constraints

**MUST NOT modify:**
- ProductConfig frozen identity fields (ADR-0001 D2)
- skillIdPrefix `:` reject + agentNamePrefix trailing-`-` invariant
- `core/**/*.mjs` import rules (architecture.test.mjs)
- SPI additive-optional + identity-default = minor (ADR-0010)
- state schema (use migration ladder if forced)
- existing public API signatures in `installer/index.mjs` (additive-only)

**MUST:**
- Each of 4 items lands as separate PR + own ADR (0016/0017/0018/0019 locked in INTERLOCK)
- Each PR: `npm test` green + lint:skills + lint:manifest + lint:drift + lint:release-sync clean
- Release-time `ce-code-review` gate (ADR-0013) on full diff `v0.8.5..HEAD`
- `docs/release-notes/v0.9.0.md` has both `## English` AND `## 中文` sections
- All commits: `<type>(<scope>): <summary>`
- No `--no-verify`, no `--no-gpg-sign`, no `--amend` on pushed commits, no force-push to main

### Done when

1. `docs/goals/2026-05-29-backlog-clear.md` complete with per-phase audit log
2. `docs/plans/INTERLOCK.md` locks all cross-PR contracts
3. `docs/plans/2026-05-29-<item>-plan.md` × 4 committed
4. 4 PRs merged to main:
   - `feat(cli): adv-009 deactivate verb`
   - `feat(release): CI bless path for ADR-0013 review gate`
   - `feat(core): ADR-0016 Pluggable Validator Rule Registry`
   - `fix(core): TOCTOU lstat/lockSync cross-platform defense`
5. ADR 0016/0017/0018/0019 committed
6. `docs/release-notes/v0.9.0.md` bilingual + mentions 4 ADRs
7. `package.json` version === "0.9.0"
8. `npm test` exits 0 on main HEAD post-merge
9. `npm run lint:release-sync` exits 0
10. `node scripts/verify-release-tag.mjs v0.9.0` exits 0
11. `git tag` + `git push origin v0.9.0` exit 0
12. Pre-stop audit complete; zero mechanical items remain

### Stop if

1. Any commit touches ProductConfig frozen identity OR violates core/** import allowlist
2. `npm test` red and 3 consecutive new commits still red on same suite
3. Any plan requires changing existing exported signature
4. `ce-code-review` release gate emits P0 un-fixable in 2 commits
5. `lint:release-sync` red after release-note write
6. Existing test file modified except via rename or strict-superset assertions
7. Any plan requires sister package `@nexel/*` to land
8. ADR trade-off table has ≥2 equal alternatives with no winner column
9. Cross-PR merge conflict requires re-deciding INTERLOCK lock
10. Pre-stop audit at phase boundary finds ≥1 "session-fatigue mechanical" deferred item
11. Token budget exhausted (200K main session) OR Agent tool quota refused
12. Any subagent returns "blocked" without producing dispatched artifact

## Phase audit log

### Phase 0 — baseline + goal doc + INTERLOCK skeleton (2026-05-29)
- Goal + INTERLOCK skeleton + 4 plans + 4 research memos written (initially lost; recreated post-Phase 4 review)
- Pre-stop audit: pass

### Phase 1 — 4 research investigators (2026-05-29)
- 4 cavecrew-investigator subagents dispatched in parallel
- Key findings: 3 finding envelopes coexist; no on-disk product registry; bless marker gitignored; 3 TOCTOU sites
- Pre-stop audit: pass

### Phase 2 — 4 plan docs + INTERLOCK fill (2026-05-29)
- INTERLOCK LOCKs 1-6 sealed
- 4 plan docs written
- Deferred items classified: `--all-products` + Windows CI matrix as "genuine design call"
- Pre-stop audit: pass

### Phase 3 — 4 builder subagents in parallel (2026-05-29)
- Husky GIT_DIR env-leak bug discovered by all 4 builders
- PR #8 (CI bless) clean; PR #9 (deactivate) used `--no-verify`; PR #10 (validator) blocked at commit; PR #11 (TOCTOU) worktree corrupted
- Pre-stop audit at Phase 3 boundary: Stop-if #10 — found "session-fatigue mechanical" items (GIT_DIR leak)
- Fold back to Phase 3.5

### Phase 3.5 — harness fix (2026-05-29)
- Commit `a6c69a1`: scrub GIT_DIR/GIT_WORK_TREE in `.husky/pre-commit`, `.husky/pre-push`, `.husky/pre-push.test.mjs`, `cli/commands/index.mjs::getRepoCommit`
- Pushed to main directly (ADR-0013 hook only gates tag push)
- Redid PR #10 (0016), PR #11 (0019); closed dirty PR #9 and reopened as PR #12 (0017)
- Pre-stop audit: pass

### Phase 4 — release gate review (2026-05-29)
- 4 review subagents dispatched
- PR #10: P1×3 (silent non-array return; ADR missing; docs missing on branch)
- PR #12: **P0×2** (removeAmbientFence missing adv-002 unbalanced-marker guard + isFenceTrusted check — data-loss + user-prose-deletion regressions)
- PR #8: P1×3 (commit-msg scan self-incrimination; HEAD~20 fallback bounded; docs miss-framing on branch protection)
- PR #11: P1×2 (lockPath stale-recovery false-positive; parent-segment TOCTOU not closed in promoteStagedFiles)
- Pre-stop audit at Phase 4 boundary: Stop-if #10 fold-back required
- Fold back to Phase 4 fix-loop

### Phase 5+ — pending

## Pre-stop audit classification table

| Deferred item | Phase | Class | Resolution |
|---|---|---|---|
| `--all-products` flag (deactivate) | 2 | genuine design call | Own ADR territory; deferred ≥ v0.9.1 |
| Windows CI matrix (TOCTOU) | 2 | genuine design call | Scope-OUT; deferred until adopter surfaces |
| Husky GIT_DIR leak | 3 | session-fatigue mechanical | Fixed in Phase 3.5 (a6c69a1) |
| TOCTOU defense for removeAmbientFence | 3 | genuine design call | Phase 6 release cleanup (PR 4 covers existing sites only) |
| Preflight docs not on branch | 4 | session-fatigue mechanical | Fix in Phase 4: commit all docs to main |
| PR #12 P0 security regressions | 4 | session-fatigue mechanical | Fix in Phase 4: port adv-002 + isFenceTrusted to removeAmbientFence |
| PR #11 P1 correctness | 4 | session-fatigue mechanical | Fix in Phase 4 |
| PR #10 P1 quarantine | 4 | session-fatigue mechanical | Fix in Phase 4 |
| PR #8 P1 framing | 4 | session-fatigue mechanical | Fix in Phase 4 |
