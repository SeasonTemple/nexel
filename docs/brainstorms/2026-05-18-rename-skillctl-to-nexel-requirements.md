---
date: 2026-05-18
topic: rename-skillctl-to-nexel
---

# Rename skillctl → nexel, supersede ADR-0005, and sequence the residual coverage sweep

## Summary

Rename the project from `skillctl` to `nexel` and record the decision in a new ADR that supersedes ADR-0005. The rename (2a) is the deliverable that resolves the maintainer's "provisional name" cognitive cost — zero production-code behavior change, with the one explicit exception of the `.skillctl` on-disk state-directory name, which is deliberately *not* renamed (see R8). Publish enablement (2b) and **Candidate 1** — the post-v0.4.0 residual test-coverage sweep, distinct from the already-completed plan-003 sweep (see R7) — are sequenced behind it, in that order. 2a is sequenced first because it is zero-code, pre-publish-cheap, and immediately closes the identity loop; it does not compete with Candidate 1 for resources, and Candidate 1 still gates 2b.

This document is intentionally dual-purpose: it is both the rename requirements (R1–R3, R8) and the durable record of the 2a → Candidate 1 → 2b sequencing decision (R4–R7). The sequencing requirements are deliberate scope, not creep.

---

## Problem Frame

The npm name `skillctl` is squatted by an unrelated third-party package, and `package.json` carries `"private": true` with distribution via git-tag/vendor. ADR-0005 deferred the name+publish decision and explicitly couples four things to that decision (name lock, contract-clock start, `private:true` removal, ADR supersede).

The maintainer wants to stop carrying the "provisional name" status as an open mental loop. There is no external consumer blocked on `npm install` — the driver is internal identity closure, and that closure lands the moment the real name is decided and written down, not when the package becomes npm-installable.

The squat was not bad luck: `skillctl` sits in npm's saturated descriptive namespace (`skill*`, `*ctl`). A rename that picks another descriptive compound re-enters the same namespace and the same failure mode. The kernel's most defensible asset is the cross-runtime ProductConfig/adapter SPI plus the managed-state/drift/repair model — a package-manager-class kernel, not an "installer." Its identity should be namespace-independent, which is why a coined mark (the `helm`/`nix`/`flux`/`terraform` lineage) is the durable choice and `nexel` (nexus + kernel) was selected.

---

## Requirements

**Identity rename**

- R1. The project's live identity is renamed `skillctl` → `nexel` across the actual live-identity carriers: the `package.json` name / bin / repository + homepage URLs, and forward-facing documentation (CLAUDE.md and any doc describing current state — subject to the mixed-file rule in R3). The `examples/sample-product/` ProductConfig prefixes are already product-agnostic (`skillIdPrefix: "sample"`, `agentNamePrefix: "sample-"`) and carry no `skillctl` token — they are NOT a rename surface; the earlier assumption that they were is dropped. The product-literal regression guards (the `/\b(skillctl|netops)\b/i` check in `strings.test.mjs` and the analogous `help.test.mjs` / `prompts.test.mjs` assertions) ARE in scope: after the rename their intent must be preserved as "kernel strings embed no product literal" — they must forbid `nexel` too, not merely swap the matched token. The `.skillctl` on-disk state-directory name is the single deliberate exception and is governed by R8. The rename is complete across the real carriers, not package-only.
- R2. A new ADR is added that supersedes ADR-0005 and records: name resolved = `nexel`; the public-API contract clock, `npm publish`, and `"private": true` removal remain deferred (decoupled from the name decision); rationale for the coined-mark axis over scope-it / wait / descriptive-compound; and the `.skillctl` state-dir decoupling (R8). The superseding ADR MUST explicitly quote and retract ADR-0005's clause "that decision starts the public-API contract clock and removes `private:true`" — recording that the name decision is hereby deliberately decoupled from the publish/clock decision, and why. Without this explicit retraction the ADR log self-contradicts: ADR-0005 states its own supersession entails clock-start + `private:true` removal, and this ADR supersedes it while doing neither.
- R3. Historical records (release-notes `v0.1.0`–`v0.4.0`, prior ADRs `0001`–`0006`, prior plans) are NOT rewritten to say `nexel`. They were true when written; the superseding ADR is the forward pointer. Only an annotation/pointer is acceptable where continuity matters. **Mixed-file rule (applies wherever one file is both current-state and historical reference — CLAUDE.md is the canonical case):** the partition is per-statement, not per-file. Rewrite live-identity statements ("this repo is `skillctl`", commands, layout, current package name) to `nexel`; preserve historical narration verbatim (provenance, "forked at v0.5.1", references to past release notes/ADRs by their original name) and add a forward pointer ("formerly `skillctl`; see the superseding ADR") rather than falsifying past-tense statements. This makes the boundary doc-resolved, not a plan-time judgment call.

**Sequencing & roadmap**

- R4. Execution order is fixed: (2a) rename + superseding ADR → (Candidate 1) residual coverage sweep → (2b) publish enablement. The order is a requirement, not a suggestion.
- R5. 2b (remove `"private": true`, `npm publish` under `nexel`, README/install rewrite to real npm, start the public-API contract clock, `pipeline.*` pre-publish cleanup) does not begin until Candidate 1 coverage has landed. Starting the contract clock before the moat surface is covered is explicitly disallowed.
- R6. Candidate 1 is reframed from "non-urgent additive insurance" to "regression-defense of the kernel's moat surface" (the SPI / managed-state / drift / repair / multi-agent core). This reprioritization is recorded so downstream planning does not treat it as optional polish.

**Candidate 1 coverage scope (carried for the downstream plan)**

- R7. **Candidate 1 is the post-v0.4.0 residual follow-up sweep — distinct from the plan-003 product-coupled sweep, which is `status: completed` and shipped in v0.4.0.** It targets the Tier-2 review residuals that plan-003 left correct-but-untested (not bugs): multi-agent fan-out commands (`installMulti`/`updateMulti`/`uninstallMulti`) okCount/failCount aggregation + per-adapter error wrapping; the remaining interactive prompt functions beyond plan-003's gather*/renderBanner scope (`confirmPlan`/`endInteractive`/`startSpinner`) via the existing DI seam; the `uninstall` ERR_NOT_INSTALLED / missing-on-disk branches; the `repair` tampered-needs-accept (`skippedTampered`) branch. The multi-agent HOME-override technique is **not an open question** — plan-003 already *resolved* it (multi-agent downscoped to okCount/failCount aggregation with `allowNoCli` + a temp `HOME`/env override, plus a pre-decided fallback: route to Deferred if the technique proves infeasible at implementation time). Candidate 1 carries that resolved scope forward; it does not reopen plan-003's decisions.

**On-disk state contract**

- R8. The `STATE_DIRNAME = ".skillctl"` constant in `scripts/installer/core/filesystem.mjs` (consumed by install/uninstall/repair/drift as the persisted on-disk state directory) is **deliberately decoupled from the brand and NOT renamed in 2a**. Rationale: renaming it would orphan every existing `.skillctl/` state directory on disk — a real production-behavior change with a migration cost — whereas freezing it is what a package-manager-class kernel does: the on-disk state contract is a stability surface independent of the product mark. The superseding ADR (R2) records this decoupling explicitly. Consequently the "zero production-code behavior change" claim is scoped to mean "no logic change and no on-disk-contract change"; the state-dir name intentionally retains `.skillctl`.

---

## Acceptance Examples

- AE1. **Covers R4, R5.** Given the rename and superseding ADR have shipped, when the contract clock / `npm publish` / `private:true` removal is considered, the answer is "blocked until Candidate 1 coverage lands" — 2a shipping does not unblock 2b.
- AE2. **Covers R3.** Given the rename ships, when a reader opens `docs/release-notes/v0.3.1.md`, it still says `skillctl` (historical truth preserved); the superseding ADR is where the `nexel` decision is recorded.

---

## Success Criteria

- The maintainer's "provisional name" open loop is closed: repo, package name, bin, sample-product identity, and forward-facing docs coherently say `nexel`; ADR-0005 is superseded by a written decision.
- No production-code behavior change attributable to 2a (rename is an identity/string/convention change, not a logic change), with the single scoped exception that the `.skillctl` on-disk state-directory name is deliberately retained per R8 — i.e., no logic change and no on-disk-contract change.
- A downstream agent can execute the rename rollout and the Candidate 1 plan from this doc + the referenced plan-003 without inventing scope, ordering, or the 2b gate.

---

## Scope Boundaries

- 2b publish enablement (remove `private:true`, `npm publish`, README/install rewrite to npm, start the public-API contract clock, `pipeline.*` dormant-namespace pre-publish cleanup) is deferred until after Candidate 1 — not in this work.
- Implementing Candidate 1's tests is sequenced here, not planned or written here — it is its own ce-plan → ce-work cycle after 2a.
- Rejected name strategies (scope as `@seasontemple/skillctl`, wait for / dispute the squatted `skillctl`, descriptive-compound rename) are closed, not revisitable without re-opening the durability rationale in R2's ADR.
- No rewrite of historical ADRs / release-notes / plans (R3).

---

## Key Decisions

- Rename over wait / descriptive-compound: the squat is a symptom of the saturated descriptive namespace; only a coined mark that leaves that axis is structurally unsquattable and durably ends the problem.
- Scope-it (`@seasontemple/skillctl`) is rejected on its own merits, NOT folded into the namespace argument: a scoped name does not re-enter the saturated namespace, and would at lower blast radius also resolve the squat and unblock publish. It is rejected because the maintainer wants a clean, unscoped, namespace-independent identity made firm before any publish — ADR-0005's actual stated reason was identity-firmness/timing, not a structural defect. Framing it as "scoping re-enters the namespace / leaves the problem latent" was a logic error and is corrected here.
- `nexel` (nexus + kernel): npm-unscoped-free (verified via `npm view`), zero famous collision, semantically aligned to the locked essence (the connecting kernel/seam across runtimes). `kohere` was rejected despite best semantic fit due to phonetic collision with Cohere (a major LLM company) in the same AI-tooling space.
- Decouple 2a (identity) from 2b (publish mechanics): ADR-0005 coupled them, but the maintainer's actual want is satisfied by 2a alone; coupling would force a premature contract-clock start before coverage exists.
- Full rename, not package-only: a half-rename leaves identity incoherent and the namespace pain half-solved; pre-publish is ADR-0005's explicitly cheap window (routine cleanup, no migration ceremony), so completeness is both correct and time-optimal now.
- Historical records annotated, not falsified (R3): rewriting past notes/ADRs to the new name would be dishonest archaeology; the superseding ADR is the forward pointer.
- Essence baseline locked as the kernel's identity: cross-runtime agent-capability lifecycle kernel (declare once via ProductConfig + content; kernel keeps it coherent across Claude Code / Codex / OpenCode — install/update/drift/repair/reconcile). "Installer" is the most visible entry verb, not the identity. This baseline drove both the naming axis and the Candidate 1 reprioritization.

---

## Dependencies / Assumptions

- The `examples/sample-product/` ProductConfig prefixes are already product-agnostic (`sample` / `sample-`) and carry no `skillctl` token, so there is no sample-product prefix rename and no Adapter SPI v1 contract-break risk on that axis (ADR-0001 froze the contract shape and prefix rules, not any literal value). The earlier assumption of a sample-product prefix cascade is withdrawn; the real live-identity carriers are `package.json`, the `.skillctl` STATE_DIRNAME constant (frozen per R8), and the product-literal test guards (R1).
- The test cascade is into the product-literal guards and any `package.json`-derived assertions, not into sample-product prefix fixtures (which don't carry `skillctl`). Magnitude is a planning concern, not a product blocker.
- `nexel` npm-unscoped availability verified 2026-05-18 via `npm view`; a re-check immediately before any future 2b publish is prudent but out of 2a scope.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Exact enumeration of the rename surface (every file/token carrying `skillctl` as live identity vs. historical reference) — a codebase sweep at plan time, not a product decision.
- [Affects R1][Technical] Exact set of files asserting `package.json`-derived identity (name/bin/URLs) needing updates alongside the product-literal guards — a codebase sweep at plan time (the sample-product prefix axis is withdrawn per R1/Dependencies).
- [Affects R7][Technical] Whether the multi-agent HOME-override temp-dir technique holds in practice, or the multi-agent clause routes to Deferred per plan-003's pre-decided fallback — a tactic question owned by the Candidate 1 plan.
