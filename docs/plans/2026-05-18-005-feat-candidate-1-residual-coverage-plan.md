---
title: "feat: Candidate 1 — post-v0.4.0 residual test-coverage sweep"
type: feat
status: completed
date: 2026-05-18
origin: docs/brainstorms/2026-05-18-rename-skillctl-to-nexel-requirements.md
---

# feat: Candidate 1 — post-v0.4.0 residual test-coverage sweep

## Summary

Cover the Tier-2 review residuals that the completed plan-003 (v0.4.0 product-coupled sweep) left correct-but-untested — not bugs: multi-agent fan-out aggregation, the three remaining interactive prompt functions, and the uninstall/repair branches adjacent to what v0.4.0 already covered. Extends the two existing v0.4.0 test suites; test-authoring only. Ships as additive patch **v0.5.1**. This is the **R5-gate**: 2b publish enablement does not begin until this lands (origin R5; this work is reframed as moat regression-defense per origin R6, not optional polish). R5-gate is satisfied by **full** R7 coverage; the multiMulti-defer contingency (U1, now established as near-impossible — see Key Technical Decisions) would leave R5-gate only partially satisfied and must be explicitly re-evaluated before 2b rather than silently treated as "gate met".

---

## Problem Frame

plan-003 (`docs/plans/2026-05-18-003-feat-product-coupled-test-sweep-plan.md`, `status: completed`, v0.4.0) delivered the main product-coupled sweep but its pre-decided fallbacks and scope bounds left a residual: multi-agent fan-out commands took the deferred path, prompts coverage was bounded to gather*/renderBanner, and certain uninstall/repair sub-branches were not reached. The rename requirements doc carries this residual as R7 (see origin) and reprioritizes it from "non-urgent insurance" to regression-defense of the kernel's moat surface (origin R6). Shipped code has no known defect — this closes the coverage gap before 2b freezes more of the surface.

---

## Requirements

- R7. The residual coverage sweep targets the Tier-2 residuals correct-but-untested: `installMulti`/`updateMulti`/`uninstallMulti` okCount/failCount aggregation + per-adapter error wrapping; the remaining interactive prompt functions beyond plan-003's gather*/renderBanner scope (`confirmPlan`/`endInteractive`/`startSpinner`) via the existing DI seam; the `uninstall` ERR_NOT_INSTALLED branch; the `repair` tampered-needs-accept (`skippedTampered`) and missing-on-disk-recopy branches (origin R7).
- R5-gate. Landing this sweep is the precondition that unblocks 2b (origin R5 — recorded so the sequencing dependency is explicit; not implemented here).
- Rel. Ships as `v0.5.1` patch with `docs/release-notes/v0.5.1.md`; `lint:release-sync` stays green; full suite stays green with no production behavior change (test-authoring; genuine root-cause bugs surfaced are fixed in-scope — v0.2.0 precedent).

**Origin acceptance examples:** AE1 (covers the 2a-does-not-unblock-2b gate — this plan landing is the R5 gate condition that *does* unblock 2b; verification anchors to "Candidate 1 coverage landed").

---

## Scope Boundaries

- Test-authoring only. No production logic change except genuine root-cause bugs the new tests surface (unlikely — these are correct-but-untested paths).
- Extends `scripts/installer/cli/commands/index.test.mjs` and `scripts/installer/cli/prompts.test.mjs` — no new test framework, no new harness, no synthesized adapter.
- Bound to `examples/sample-product/` only (post-rename: prefixes are `sample`/`sample-`; product-literal guards now forbid `skillctl|netops|nexel` — new test strings must stay product-agnostic).
- Does NOT implement 2b or any publish/contract-clock work — this plan only *unblocks* it by satisfying the R5 gate.

### Deferred to Follow-Up Work

- **multiMulti coverage ONLY in the near-impossible contingency that the `CLAUDE_HOME`/`CODEX_HOME` env seam is somehow unusable** — plan-003's pre-decided "route to Deferred" fallback, retained but explicitly downgraded: feasibility verified `detectTargetRoot` reads these dedicated env vars by design, so this contingency is not expected to fire. If it somehow does, route multiMulti to Deferred-to-Follow-Up (no synthesized adapter, no scope expansion) AND flag that R5-gate is only partially satisfied (Summary). Not a likely retreat; the implementer should not plan around hitting it.
- 2b publish enablement (`npm publish` as `nexel`, `private:true` removal, contract-clock start, README npm rewrite, `pipeline.*` cleanup) — sequenced after this sweep lands (origin R5).

---

## Context & Research

### Relevant Code and Patterns

- `scripts/installer/cli/commands/index.mjs` — `installMulti`/`updateMulti`/`uninstallMulti` (~L352/411/457): each loops `adapterIds`, accumulates `okCount`/`failCount`, wraps per-adapter errors, returns `{ adapterIds: unique, okCount, failCount, results }`. Accept `allowNoCli` (L352 etc.); single-agent commands gate `assertCliPresent` behind `if (!target && !allowNoCli)` (L172) — multi-agent has no `target` param, hence redirection via the `CLAUDE_HOME`/`CODEX_HOME` env seam (`installMulti`/`uninstallMulti` also accept `allowNoCli`; `updateMulti` does NOT and `update()` gates `assertCliPresent` at ~L621). `uninstall` throws `ERR_NOT_INSTALLED` (`selection not installed`, L542). `repair` builds `skippedTampered` (L963/972), returns the `--accept-modified` guidance message (L983), and re-copies missing-on-disk files from `sourceRelPath` (L919/926).
- `scripts/installer/cli/prompts.mjs` — `confirmPlan` (L415, async, `{ prompts = clack }`), `endInteractive` (L425, `{ prompts = clack }`), `startSpinner` (L466, `{ prompts = clack }`): all carry the injectable DI seam plan-003 U2 used for gather*/renderBanner.
- `scripts/installer/cli/commands/index.test.mjs` (19 tests, v0.4.0) and `scripts/installer/cli/prompts.test.mjs` (14 tests, v0.4.0) — the suites this sweep EXTENDS. The v0.4.0 in-process-call + temp-target + DI-stub patterns are the templates; mirror them.
- `docs/plans/2026-05-18-003-...-plan.md` Open Questions → Resolved — the prior resolved tactics (multi-agent target redirection + pre-decided fallback; prompts DI-stub; in-process callability). This plan carries the DI-stub/callability resolutions verbatim but **corrects** plan-003's "speculative HOME-override that may prove infeasible" framing to the codebase reality (the designed `CLAUDE_HOME`/`CODEX_HOME` env seam), downgrading the Deferred fallback accordingly.

### Institutional Learnings

- No `docs/solutions/`. plan-003 (resolved tactics) + ADR-0005/0007 (release posture: pre-publish additive coverage is routine, contract clock not started) are the load-bearing prior decisions.

### External References

- None. plan-003 is the in-repo pattern authority; the residual is mechanically enumerable. No external research warranted.

---

## Key Technical Decisions

- **multiMulti via the adapters' designed per-adapter env seam.** plan-003 framed this as a speculative "temp-`HOME`/env override that may prove infeasible"; that framing is corrected here against the codebase: `detectTargetRoot` reads dedicated per-adapter env vars — `CLAUDE_HOME` (`scripts/installer/adapters/claude.mjs`) and `CODEX_HOME` (`scripts/installer/adapters/codex.mjs`) — the adapters' *documented, designed* redirection seam (`scripts/installer/adapters/README.md`), threaded straight through `installMulti`/`updateMulti`/`uninstallMulti` → `install`/`update`/`uninstall` → `resolveAdapterAndTarget` → `detectTargetRoot({ env })`. A test sets `env.CLAUDE_HOME`/`env.CODEX_HOME` to per-test temp dirs and passes a custom `env` object. okCount/failCount aggregation + per-adapter error wrapping asserted with `claude-code`+`codex`. The "route multiMulti to Deferred if infeasible" fallback from plan-003 is retained ONLY as a near-impossible contingency (a one-line env injection against a designed seam), explicitly downgraded from plan-003's "likely retreat" framing — it is NOT a STOP gate the implementer should expect to hit.
- **`updateMulti` needs a different gate-bypass than install/uninstall.** `installMulti`/`uninstallMulti` accept `allowNoCli` (passed through to bypass `assertCliPresent`). `updateMulti` does NOT have an `allowNoCli` param, and `update()` unconditionally calls `assertCliPresent(adapter.id, { env })` whenever `adapter && !target` (`scripts/installer/cli/commands/index.mjs` ~L621) with no escape hatch. So the uniform "`allowNoCli:true` across all three" assumption is false for `updateMulti`: its okCount path is unreachable on a CLI-less PATH. U1 covers `updateMulti`'s okCount path by pre-installing into the temp targets AND satisfying `assertCliPresent` via a stub adapter binary on a temp `PATH` (env override) — not by `allowNoCli`. (`installMulti`/`uninstallMulti` keep the `allowNoCli:true` path.)
- **prompts residuals via the existing DI seam** — inject the fake `prompts` stub into `confirmPlan`/`endInteractive`/`startSpinner` exactly as plan-003 U2 did for gather*. No `@clack` mock, no TTY.
- **uninstall/repair residuals extend, not duplicate.** v0.4.0's commands suite already covers force+accept-modified / hash-block / missing-recopy for the single-agent paths; this adds the adjacent sub-branches (ERR_NOT_INSTALLED; skippedTampered + its accept-modified message; missing-on-disk recopy) — extend the same suite, do not re-assert covered branches.
- **v0.5.1 patch.** Additive coverage; ADR-0007 pre-publish "routine cleanup" posture (contract clock not started); `lint:release-sync` requires version == newest note (atomic bump+note).

---

## Open Questions

### Resolved During Planning

- multiMulti tactic + fallback: resolved by plan-003, carried verbatim (user-confirmed at the 5.1.5 synthesis).
- prompts coverage technique: existing DI stub (resolved by plan-003 U2 precedent).
- Release shape: v0.5.1 patch (user-confirmed).

### Deferred to Implementation

- Exact reachable set of `confirmPlan`/`endInteractive`/`startSpinner` coverable purely via the `prompts` stub vs. needing a state stub — determined against the actual signatures at U2 time (mirrors plan-003 U2's same deferred-to-impl note).
- Exact shape of the `updateMulti` `assertCliPresent` bypass (temp-`PATH` stub binary vs. another env mechanism) — a tactic detail settled at U1 implementation; the decision THAT updateMulti needs a non-`allowNoCli` path is resolved (Key Technical Decisions), only the precise stub form is deferred.

---

## Implementation Units

### U1. multiMulti aggregation coverage

**Goal:** Cover `installMulti`/`updateMulti`/`uninstallMulti` okCount/failCount aggregation + per-adapter error wrapping — the deferred residual from plan-003.

**Requirements:** R7

**Dependencies:** None

**Files:**
- Modify: `scripts/installer/cli/commands/index.test.mjs` (extend; already in the `test` aggregate — no package.json change)

**Approach:**
- Redirect adapter targets via the designed per-adapter env seam: set `env.CLAUDE_HOME` and `env.CODEX_HOME` to per-test temp dirs and pass that custom `env` object — `detectTargetRoot` reads these by design (no real `~/.codex`/`~/.claude` writes). This is the adapters' documented redirection mechanism, not a speculative hack.
- `installMulti`/`uninstallMulti`: call in-process with `adapterIds: ["claude-code","codex"]`, `allowNoCli:true`, the env override. Assert `{ adapterIds, okCount, failCount, results }`: all-ok aggregation, mixed ok/fail (one target made unwritable), per-adapter throw wrapped into `failCount` + a `results` entry (not propagated), `adapterIds` deduped.
- `updateMulti`: has NO `allowNoCli` param and `update()` unconditionally gates `assertCliPresent` when `adapter && !target`. Cover its okCount path by (a) pre-installing into the temp targets so `update` has managed state, and (b) putting a stub `claude`/`codex` binary on a temp `PATH` (env) so `assertCliPresent` passes — then assert the same aggregation contract. Do NOT assume `allowNoCli` works for `updateMulti`.
- Mirror the v0.4.0 commands-suite temp-dir + teardown pattern.

**Execution note:** The env-seam redirection (`CLAUDE_HOME`/`CODEX_HOME`) is the adapters' designed mechanism — a one-line injection, not a feasibility coin-flip. Do NOT treat it as a STOP gate. Only in the near-impossible event that the seam is genuinely unusable, route multiMulti to `### Deferred to Follow-Up Work`, record the retreat in the v0.5.1 note, and flag R5-gate as partially satisfied — but the implementer should not plan around hitting this.

**Patterns to follow:** `scripts/installer/cli/commands/index.test.mjs` v0.4.0 in-process-call + temp-target pattern; plan-003 U1 multi-agent resolved approach.

**Test scenarios:**
- Happy path: `installMulti(['claude-code','codex'], allowNoCli:true, env:{CLAUDE_HOME,CODEX_HOME→temp})` → `okCount===2, failCount===0`, `adapterIds` deduped, `results` length 2. Same shape for `uninstallMulti`.
- Happy path (updateMulti, distinct setup): pre-install into the two temp targets, stub `claude`/`codex` on a temp `PATH` (env) so `assertCliPresent` passes (NO `allowNoCli` for updateMulti), then `updateMulti` → `okCount===2, failCount===0`.
- Edge case: duplicate adapter ids collapse (`adapterIds` unique) across all three.
- Error/failure path: one adapter target unwritable → `failCount>=1`, failure captured in `results` (wrapped), no throw escapes; the same aggregation contract holds for all three (updateMulti via the pre-install+PATH-stub setup, not allowNoCli).
- Integration: `installMulti` then `uninstallMulti` over the same two adapters round-trips state per adapter (state.json per temp target).

**Verification:** new multiMulti assertions (all three commands, incl. the distinct `updateMulti` pre-install+PATH-stub path) pass under `npm test`; teardown leaves no real `~/.claude`/`~/.codex` dir written (env-seam redirected to temp); the existing 19 commands tests still green. The near-impossible Deferred contingency is not expected to apply.

---

### U2. prompts confirmPlan / endInteractive / startSpinner coverage

**Goal:** Characterize the three interactive prompt functions plan-003 U2 left out of scope, via the existing DI seam.

**Requirements:** R7

**Dependencies:** None

**Files:**
- Modify: `scripts/installer/cli/prompts.test.mjs` (extend; already aggregated)

**Approach:**
- Inject a fake `prompts` stub (same shape plan-003 U2 used) into `confirmPlan` (assert it renders `planText`/`noteTitle`, returns the confirm/cancel decision, throws `CancelledError` on `isCancel`), `endInteractive` (ok vs failure message routed to the stub), `startSpinner` (start/stop lifecycle on the stub; no real TTY). New assertion strings stay product-agnostic — the widened guard forbids `skillctl|netops|nexel`.

**Execution note:** Characterize current output before asserting (these are caller-less interactive fns — value is downstream-consumer characterization, mirroring plan-003 U2's framing, not regression protection of an exercised path).

**Patterns to follow:** `scripts/installer/cli/prompts.test.mjs` v0.4.0 gather*/`renderBanner` DI-stub tests; `CancelledError` is exported from `prompts.mjs`.

**Test scenarios:**
- Happy path: `confirmPlan` with stub→confirm returns proceed; `endInteractive({ok:true})` / `{ok:false}` route the right message; `startSpinner` returns a handle whose stop is invoked.
- Edge case: `confirmPlan` default `message`/`noteTitle` used when omitted.
- Error/failure path: stub `isCancel→true` in `confirmPlan` → `CancelledError` (correct stage).
- Regression: none of the three emits a `skillctl`/`netops`/`nexel` literal (product-agnostic guard).

**Verification:** `npm run test:prompts` green; the 14 existing prompts tests still green; new fns covered.

---

### U3. uninstall / repair residual branches

**Goal:** Cover the uninstall ERR_NOT_INSTALLED branch and the repair tampered-needs-accept (`skippedTampered`) + missing-on-disk-recopy branches adjacent to what v0.4.0 covered.

**Requirements:** R7

**Dependencies:** None

**Files:**
- Modify: `scripts/installer/cli/commands/index.test.mjs` (extend)

**Approach:**
- `uninstall` against a temp target where the selection was never installed → `CommandError` with `ERR_NOT_INSTALLED` (`selection not installed: <id>`). `repair` with a tampered managed file (hash mismatch, no `--accept-modified`) → result carries `skippedTampered` listing the relPath + the "pass --accept-modified <relPath> per file" message; `repair` with a state-referenced file deleted from disk → missing-on-disk recopy from `sourceRelPath`. Extend the v0.4.0 commands suite; do not duplicate its already-covered force+accept-modified / hash-block assertions.

**Patterns to follow:** v0.4.0 `commands/index.test.mjs` uninstall/repair single-agent tests + `repair-rehash.test.mjs` temp-target pattern.

**Test scenarios:**
- Error/failure path: `uninstall` of a never-installed selection → `ERR_NOT_INSTALLED` (exact code + message shape).
- Edge case: `repair` tampered file without `--accept-modified` → `skippedTampered` includes the relPath, message names the per-file accept-modified flag, file NOT overwritten.
- Happy path: `repair` with a missing-on-disk managed file → file re-copied from `sourceRelPath`, state reconciled, `skippedTampered` empty.
- Integration: tampered + missing-on-disk in the same repair run → tampered skipped, missing recopied, aggregated result reflects both.

**Verification:** new uninstall/repair assertions pass; existing commands tests still green; no duplication of v0.4.0-covered branches.

---

### U4. v0.5.1 patch release + zero-regression verification

**Goal:** Ship the sweep as an additive patch, release-discipline-consistent; prove no production behavior change.

**Requirements:** R5-gate, Rel

**Dependencies:** U1, U2, U3

**Files:**
- Create: `docs/release-notes/v0.5.1.md`
- Modify: `package.json` (version `0.5.0` → `0.5.1`)

**Approach:**
- `v0.5.1.md` (mirror `v0.5.0.md`/`v0.4.0.md` shape): "Added — Candidate 1 residual coverage (multiMulti aggregation, prompts confirmPlan/endInteractive/startSpinner, uninstall/repair residual branches), closing the post-v0.4.0 R7 gap; satisfies the R5 gate that sequences 2b." If multiMulti routed to Deferred per the U1 fallback, the note records that retreat explicitly. Note: test-authoring, zero production behavior change, contract clock still not started (ADR-0007), `"private": true` retained.
- Final atomic unit: version bump + `v0.5.1.md` together (`lint:release-sync` green: 0.5.1 == newest note).

**Patterns to follow:** `docs/release-notes/v0.5.0.md`; `scripts/lint-release-sync.mjs` version==newest-note contract.

**Test scenarios:**
- Happy path: `npm run lint:release-sync` exit 0 (0.5.1 == v0.5.1).
- Integration: full `npm test` green with the new assertions; `git diff` shows only test files + version + note (no production logic, unless a genuine root-cause fix was needed and recorded).

**Verification:** `lint:release-sync` green; `v0.5.1.md` present; `npm test` green; the R5 gate is now satisfied (2b unblocked downstream — not done here).

---

## System-Wide Impact

- **Interaction graph:** test-only. No production code path changes (root-cause fixes, if any, are recorded explicitly and re-verified).
- **State lifecycle risks:** U1/U3 create temp target dirs and set `env.CLAUDE_HOME`/`env.CODEX_HOME` to temp paths — must clean up (mirror v0.4.0 teardown) to avoid worktree pollution. The env-seam redirection must never write to the real `~/.claude`/`~/.codex` (teardown asserts this).
- **API surface parity:** none. No `index.mjs` export change.
- **Unchanged invariants:** all public exports; `STATE_DIRNAME` `.skillctl`; Z-layer guard; product-literal guards (`skillctl|netops|nexel`); `lint:release-sync` semantics; `"private": true`.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `updateMulti` okCount path unreachable (no `allowNoCli`; `update()` gates `assertCliPresent`) | U1 covers `updateMulti` via a distinct setup: pre-install into temp targets + stub `claude`/`codex` on a temp `PATH` so `assertCliPresent` passes — explicitly NOT via `allowNoCli`. Recorded in Key Technical Decisions + U1 approach. |
| Test writes leak into real `~/.claude`/`~/.codex` | Redirect via the designed `CLAUDE_HOME`/`CODEX_HOME` env seam to temp dirs; teardown verifies no real adapter dir created. |
| (Near-impossible) `CLAUDE_HOME`/`CODEX_HOME` seam unusable → multiMulti uncoverable | Downgraded from plan-003's "likely retreat": the seam is the adapters' designed mechanism (feasibility-verified). If it somehow fails, route multiMulti to Deferred + flag R5-gate partial — not expected to fire. |
| New tests embed a product literal post-rename | Widened product-literal guard (`skillctl|netops|nexel`) catches it; U2 has an explicit regression assertion |
| A genuine bug surfaces in a "correct-but-untested" path | v0.2.0 precedent: fix at root in-scope, record in v0.5.1 note (test-authoring posture allows the in-scope fix) |
| Temp dirs leak into the worktree | Mirror v0.4.0 teardown; U4 verification includes a clean `git status` check |

---

## Documentation / Operational Notes

- No runtime/production impact (test-only). Unpublished kernel (ADR-0007); vendor consumers pull the `v0.5.1` tag.
- The CLAUDE.md "Test scope" note already records the ADR-0004/plan-003 deferred sweep as delivered; v0.5.1's release context should note Candidate 1 closed the residual and satisfied the R5 gate for 2b.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-18-rename-skillctl-to-nexel-requirements.md](docs/brainstorms/2026-05-18-rename-skillctl-to-nexel-requirements.md) — R7 (Candidate 1 scope), R5 (the gate this satisfies), R6 (moat-defense reprioritization)
- Resolved-tactics authority: `docs/plans/2026-05-18-003-feat-product-coupled-test-sweep-plan.md` (Open Questions → Resolved: prompts DI-stub, in-process callability — carried verbatim; its multi-agent "HOME-override may be infeasible" framing is corrected here against the codebase to the designed `CLAUDE_HOME`/`CODEX_HOME` env seam)
- Adapter env-seam: `scripts/installer/adapters/claude.mjs` / `codex.mjs` (`detectTargetRoot` reads `CLAUDE_HOME` / `CODEX_HOME`), `scripts/installer/adapters/README.md` (documented override seam)
- Related code: `scripts/installer/cli/commands/index.mjs` (multiMulti ~L352/411/457, uninstall ERR_NOT_INSTALLED L542, repair skippedTampered L963/missing-on-disk L919), `scripts/installer/cli/prompts.mjs` (confirmPlan L415 / endInteractive L425 / startSpinner L466)
- Pattern tests: `scripts/installer/cli/commands/index.test.mjs`, `scripts/installer/cli/prompts.test.mjs` (v0.4.0 suites this extends)
- Release posture: `docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md` (contract clock not started; pre-publish additive coverage is routine)
