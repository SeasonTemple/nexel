---
title: "feat: ADR-0004-deferred product-coupled test sweep"
type: feat
status: completed
date: 2026-05-18
---

# feat: ADR-0004-deferred product-coupled test sweep

## Summary

Deliver the test-coverage sweep that ADR-0004 and the CLAUDE.md "Test scope" note explicitly deferred until the sample fixture stabilized (now done through v0.3.0/v0.3.1). Add focused, fixture-bound suites for the under-tested product-coupled surfaces — kernel command functions, interactive prompts, the strings catalog, loader edge cases — and expand the spawn-based E2E witnesses for the verb handlers and `createCli` composition whose `process.exit` calls make pure unit assertions impossible without a refactor (which is out of scope). Test-authoring only; genuine bugs the new tests surface are fixed at the root in-scope. Ships as additive minor **v0.4.0**.

---

## Problem Frame

ADR-0004 ("Deliberately NOT absorbed" table) parked the extended product-coupled test rebuild — `loader` / `commands` / `cli` / `help` / `strings` / `prompts` exercised against `examples/sample-product/` — as a follow-up "as the sample fixture stabilizes". `help` and `error-format` were since covered (v0.3.0/v0.3.1). The remaining gap: `scripts/installer/cli/commands/index.mjs` has 14 exported command functions but only `repair`'s re-hash path is tested; `scripts/installer/cli/run.mjs`'s 11 verb handlers are only smoke-covered via the `sample-bin` spawn (no state/drift/multi-agent/force/accept-modified/exit-code branch coverage); `scripts/installer/cli/prompts.mjs` interactive flow is untested; `scripts/installer/cli/strings.mjs` has no completeness/parameterization guard beyond `help.verb`; `scripts/installer/cli/cli.mjs` `createCli` composition (profile env, extraHandlers, validVerbs) is untested. A regression in the kernel-reachable surface ships green today. (`prompts.mjs` and `renderBanner` have no kernel/sample caller — the interactive layer is product-bin territory, `cli.mjs:12-13`; U2's value there is characterization for downstream consumers + dead-literal hygiene, not regression protection of an exercised path.)

---

## Requirements

- R1. `scripts/installer/cli/commands/index.mjs` command functions (`install`, `installMulti`, `update`, `updateMulti`, `uninstall`, `uninstallMulti`, `repair`, `listCommand`, `agentsCommand`, `doctorCommand`, `exportCommand`, `importCommand`, `planCommandText`, `planSelection`, `getRepoCommit`) have unit coverage against the `examples/sample-product/` fixture with real temp target dirs, beyond the existing `repair`-rehash test. (`getRepoCommit` shells `git rev-parse HEAD` with a catch→null; its only deterministic assertion is the catch→null path from a non-git temp cwd — the in-repo path returns live HEAD, asserted only as a 40-hex shape.)
- R2. `scripts/installer/cli/prompts.mjs` interactive surface is covered via its existing dependency-injection seam (the injectable `prompts` parameter) — selection/multiselect happy paths, `CancelledError` cancel paths, and `renderBanner`.
- R3. `scripts/installer/cli/run.mjs` verb-handler branches and `scripts/installer/cli/cli.mjs` `createCli` composition (profile→env, extraHandlers merge, validVerbs override, unknown-verb→help exit 0, error exit codes, `--target`+multi-agent conflict, repair scan-vs-apply, validate exit-code contract) are covered by spawn-based E2E witnesses extending `examples/sample-product/sample-bin.test.mjs`. The `CancelledError`→exit 130 branch is **provably unreachable via the spawn vector** (`CancelledError` is thrown only inside `prompts.mjs`, which has no non-interactive caller); it is documented as unreachable-by-construction, not asserted — explicitly out of R3's covered set.
- R4. `scripts/installer/cli/strings.mjs` has a catalog-completeness guard: every namespace key is a callable function, renders a non-empty string, and contains no hardcoded product literal (`skillctl`/`netops`).
- R5. `scripts/installer/core/manifest/loader.mjs` edge cases beyond the current `loader.test.mjs` are covered against the sample manifest.
- R6. Every new `*.test.mjs` is appended to the explicit `test` aggregate in `package.json` AND has a `test:<name>` per-suite script; `npm test` runs them; no kernel convention or architecture invariant is broken.
- R7. Genuine bugs surfaced by the new tests are fixed at the root in-scope (precedent: the v0.2.0 plan's `update`/`repair` `productConfig` wiring fix). **Known product-literal leaks in `prompts.mjs` (enumerated, not open-ended)** — `prompts.mjs` has **zero kernel/sample callers** (the interactive layer is product-bin territory, `cli.mjs:12-13`), so these are hygiene corrections of unreachable dead literals, **not** active root-cause bug fixes, and carry near-zero observable impact for this repo's consumers: (a) `renderBanner` default title `"NetOps Skills"`; (b) `gatherInstallChoices` `prompts.intro("NetOps Agent Skills installer")`. Both become a generic product-agnostic constant (NOT a threaded `ProductConfig` value — that needs a caller + signature change = architectural, out of scope; see Open Questions). (c) `renderNextSteps` hardcodes a product-specific bin path (`node scripts/install-skills.mjs ...`) — a *different class* (stale invocation path, not a product-name literal); this one is **flagged and routed to Deferred to Follow-Up Work**, not fixed here, because a correct replacement needs the product's real bin invocation which the kernel cannot know. The open clause is replaced by this enumeration: a *new* leak the sweep surfaces is fixed in-scope only if it is a same-class trivial constant swap; anything needing a signature/caller change or product knowledge is flagged to Deferred.
- R8. Version bumps to `0.4.0` with `docs/release-notes/v0.4.0.md`; `lint:release-sync` stays green.

---

## Scope Boundaries

- **Test-authoring only.** No production code changes except genuine root-cause bug fixes the new tests surface (R7). No refactor of `process.exit` call sites in `run.mjs`/`cli.mjs` to make them unit-testable — that is an architectural change outside this sweep; spawn-based E2E is the in-scope coverage path for exit-bearing code.
- Bound to `examples/sample-product/` only. No legacy/netops content (gone per ADR-0004).
- No new test framework, harness, or dependency. `node --test` only; mirror existing per-module suite patterns.
- No `verify-baseline.mjs` byte-baseline oracle — separately Tier-2-deferred (ADR-0004), not this sweep.
- Architecture Z-layer guard and `index.mjs`-only public-entry invariants must not change.

### Deferred to Follow-Up Work

- Coverage-percentage instrumentation / a coverage gate: this sweep targets behavioral gaps by module, not a coverage number (which is a gameable proxy). A coverage tool is a separate decision.
- `verify-baseline.mjs` full-help byte oracle: remains the ADR-0004 Tier-2 follow-up.
- `renderNextSteps`' hardcoded `node scripts/install-skills.mjs ...` bin-path literal in `prompts.mjs`: a stale product-specific invocation path (different class from the `"NetOps"` name literals U2 fixes). A correct replacement needs the product's real bin invocation, which the kernel cannot know — needs a `ProductConfig`/caller seam = architectural, its own plan.
- Multi-agent command coverage IF the `HOME`-override temp-dir technique proves infeasible at U1 implementation time (pre-decided fallback per Open Questions — not a scope expansion, a documented retreat).

---

## Context & Research

### Relevant Code and Patterns

- `scripts/installer/cli/commands/repair-rehash.test.mjs` (135 lines) — the canonical real-fs command-layer test pattern: builds a temp target, runs a kernel command against the sample fixture, asserts state.json/disk. U1 mirrors this.
- `scripts/installer/cli/error-format.test.mjs` (103 lines, v0.3.1) — the injected-stream / injected-dependency unit pattern. `handleError` takes `{stdout,stderr,env}`; the prompts seam is analogous.
- `scripts/installer/cli/prompts.mjs` — **already DI-designed**: `gatherActionChoice({ prompts = clack })`, `gatherUninstallChoices({ prompts, readState })`, etc. accept an injectable `prompts` object (defaulting to `@clack/prompts`). Tests pass a fake stub exposing `select`/`multiselect`/`isCancel`/`log`; `CancelledError` is thrown via `prompts.isCancel(value)` so the cancel path is reachable by stubbing `isCancel → true`. No `@clack` library mock, no TTY, no stream hack needed. `CancelledError` class is exported here.
- `examples/sample-product/sample-bin.test.mjs` — the `spawnSync` E2E pattern (`runBin([...])` → `{code,stdout,stderr}`). U3 extends this; it is the only honest way to assert `run.mjs`/`cli.mjs` `process.exit` codes without refactoring them.
- `scripts/installer/core/manifest/loader.test.mjs` (88 lines) — current loader coverage (stripBom, defaultManifestPath, defaultPaths, loadManifest basics). U5 extends the gaps, not rewrites.
- `scripts/installer/cli/strings.mjs` — 3 frozen namespaces: `help`, `errors`, `run`. U4 asserts completeness across all three.
- `package.json` `test` aggregate — hand-maintained explicit file list, no glob. Every new suite MUST be appended or it silently never runs (false-green; learned in the v0.3.0 work).

### Institutional Learnings

- ADR-0004 — this sweep is the recorded deferred follow-up; bind to `examples/sample-product/`, no netops content.
- ADR-0001 — frozen `ProductConfig` identity; the `renderBanner` / `gatherInstallChoices` `"NetOps"` literals (R7) violate the product-agnostic intent. They are *unreachable dead literals* (no kernel caller) → hygiene corrections, not active root-cause bug fixes; the framing distinction matters for v0.4.0 impact claims.
- v0.2.0 plan precedent — test-authoring that surfaced the `update`/`repair` `productConfig` wiring bug fixed it at root in the same effort; same posture here (R7).
- ADR-0005 — additive test coverage is a pre-publish change; `lint:release-sync` requires `package.json` version == newest release note (U6 atomicity).

### External References

- None. Strong local patterns (repair-rehash, error-format, sample-bin, loader test suites are >3 direct in-repo examples of every pattern this sweep needs). No external research warranted.

---

## Key Technical Decisions

- **Two coverage strategies split by `process.exit`.** `commands/index.mjs`, `strings.mjs`, `prompts.mjs`, `loader.mjs` return values / accept injectable deps → **pure `node --test` unit suites** (mirror repair-rehash / error-format / loader patterns). `run.mjs` + `cli.mjs` call `process.exit` directly and the scope forbids refactoring them → **spawn-based E2E** extending `sample-bin.test.mjs` is the only honest exit-code/branch coverage. This split is the structural spine of the plan.
- **prompts.mjs uses the existing DI seam, not a library mock.** The injectable `prompts` parameter already exists; tests inject a minimal stub. This resolves the pre-planning "interactive coverage is the hard part" concern — the codebase already designed for it. (User-confirmed scope call-out: resolved by research, not deferred.)
- **`prompts.mjs` NetOps literals are dead-literal hygiene, not root-cause bug fixes (R7).** `renderBanner`/`gatherInstallChoices` have no kernel/sample caller; the fix is a trivial generic-constant swap with near-zero observable impact for this repo (correct hygiene per ADR-0001, but framed honestly — v0.4.0 must not headline it as a behavioral bug fix). The `ProductConfig`-threaded variant is rejected: it needs a caller + signature change = architectural, out of scope. `renderNextSteps`' stale bin-path literal is a different class → Deferred, not fixed here.
- **No `process.exit` refactor.** Tempting (it would enable pure unit tests of run/cli) but it is an architectural change beyond a test sweep. Explicitly out of scope; spawn-E2E covers it instead.
- **v0.4.0 minor + release discipline.** Purely additive coverage + incidental root-cause fixes; bump + `v0.4.0.md` + tag in one atomic final unit, mirroring v0.3.0/v0.3.1 (`lint:release-sync` green requires version==newest-note in the same commit).
- **Per-suite aggregate wiring is part of each unit, not deferred.** Each new `*.test.mjs` is appended to the `package.json` explicit `test` list + given a `test:<name>` script within the unit that creates it (false-green guard).

---

## Open Questions

### Resolved During Planning

- prompts.mjs interactive testing strategy: **inject the existing `prompts` DI parameter with a fake stub.** Research found the seam already exists (`{ prompts = clack }`); no `@clack` mock, TTY emulation, or stream hack needed. (Pre-planning call-out — resolved.)
- Versioning: **v0.4.0 minor.** Keeps release-discipline consistent with v0.3.0/v0.3.1; additive coverage + root-cause fixes warrant a tagged release for vendor consumers (ADR-0005). (Pre-planning call-out — resolved.)
- run.mjs/cli.mjs unit-testability: **not unit-testable without a `process.exit` refactor** (out of scope) → spawn-E2E. Resolved against the codebase.
- `renderBanner` default: **commit to a generic product-agnostic constant** (e.g. `"Agent Skills"` or empty) — NOT a threaded `ProductConfig` value (that needs a caller + signature change = architectural; foreclosed by Scope Boundaries and System-Wide Impact "no caller signature change"). The earlier "generic vs threaded" fork is closed in the restrictive direction; the contradiction it created with System-Wide Impact is removed. (doc-review: feasibility + adversarial converged.)
- `commands/index.mjs` callability: the `repair-rehash.test.mjs` header comment ("not callable standalone — module-scoped productConfig") is **stale/describes that test's spawn-runner choice, not a constraint** — every `commands/index.mjs` function takes `productConfig` as an explicit destructured parameter. **U1 calls them directly in-process** (faster, asserts returned result objects per R1) rather than via a spawn runner. (doc-review: feasibility + scope-guardian converged against source.)
- Multi-agent (`installMulti`/`updateMulti`/`uninstallMulti`) coverage: resolved in-plan, **not deferred** — these take `adapterIds` with no `target` param, so the single-agent `--target` temp-dir escape is unavailable and `assertCliPresent` gates them. **R1's multi-agent clause is downscoped to `okCount`/`failCount` aggregation asserted with two real built-in adapter ids (`claude-code`+`codex`) + `allowNoCli:true` + a temp `HOME`/env override so `detectTargetRoot` resolves into a temp dir** (no synthesized adapter — that would be a forbidden new harness). If the `HOME`-override proves infeasible at U1 time, the multi-agent clause routes to Deferred to Follow-Up Work rather than expanding scope.

### Deferred to Implementation

- Exact reachable set of `prompts.mjs` functions coverable purely via the `prompts` stub vs. needing a `readState` stub too — determined when writing U2 against the actual signatures.
- Whether the multi-agent `HOME`-override temp-dir technique holds in practice (the fallback — route multi-agent to Deferred — is pre-decided above, so this is a tactic question, not a scope question).

---

## Implementation Units

### U1. commands/index.mjs unit suite

**Goal:** Cover the 15 kernel command functions against the sample fixture with real temp target dirs, beyond the existing repair-rehash test.

**Requirements:** R1, R6

**Dependencies:** None

**Files:**
- Create: `scripts/installer/cli/commands/index.test.mjs`
- Modify: `package.json` (add `test:commands` script + append to `test` aggregate)

**Approach:**
- **Direct in-process calls** (not a spawn runner): every `commands/index.mjs` function takes `productConfig` as an explicit destructured param, so they are callable standalone — the `repair-rehash.test.mjs` "not callable standalone" header comment describes that test's spawn-runner *choice*, not a constraint. Build a temp target dir, call the command directly against the `examples/sample-product/` manifest + content, assert returned result objects + state.json + on-disk files. Bypass the CLI-presence gate via the existing `target` (temp dir) + `allowNoCli` params (single-agent commands gate `assertCliPresent` behind `if (!target && !allowNoCli)`).
- Cover per function: `install` (fresh install, already-installed skip, `--overwrite` unmanaged conflict, dry-run plan), `uninstall` (state-aware delete, hash-mismatch block, `--force`+`--accept-modified` bypass, missing-on-disk), `update` (source-changed refresh, locally-edited block, up-to-date no-op), `repair` (scan vs `--apply`, missing-file recopy, tampered needs-accept — extend, do not duplicate repair-rehash), `listCommand` (skills/bundles + installed markers), `agentsCommand` (detected targets), `doctorCommand` (ok vs failing check counts), `exportCommand` (envelope shape) → `importCommand` (round-trip from export, blocked reason), `planSelection`/`planCommandText` (plan text + sha/bytes), `getRepoCommit`.
- Multi-agent (`installMulti`/`updateMulti`/`uninstallMulti`): these have **no `target` param** (the single-agent temp-dir escape is unavailable), so cover `okCount`/`failCount` aggregation with two real built-in adapter ids (`claude-code`+`codex`) + `allowNoCli:true` + a temp `HOME`/env override so `detectTargetRoot` resolves into a temp dir (per the resolved Open Question — no synthesized adapter). If the `HOME`-override is infeasible at implementation time, route the multi-agent clause to Deferred to Follow-Up Work rather than expanding scope or hitting real `~/.codex` paths.

**Patterns to follow:** `scripts/installer/cli/commands/repair-rehash.test.mjs` (temp-target + real-fs + sample fixture).

**Test scenarios:**
- Happy path: each command against the clean sample fixture returns the documented result shape; `install` then `listCommand` shows installed markers; `export`→`import` round-trips the selection set.
- Edge cases: empty selection; already-installed skip; up-to-date `update` no-op; `repair` scan on a pristine tree (0 missing/tampered).
- Error/failure paths: `uninstall` hash-mismatch block without `--force`; `update` locally-edited block; `import` blocked reason on a bad envelope; `--overwrite` required for an unmanaged target file.
- Integration: `install` writes state.json *before* disk promotion (crash-window invariant from v0.2.0); `repair --apply` then `update` is a clean no-op (the ADR-0003 D3 invariant, extended beyond repair-rehash).

**Verification:** `npm run test:commands` green; suite listed in `npm test` output; no regression in the existing 188.

---

### U2. prompts.mjs unit suite + NetOps dead-literal hygiene fix

**Goal:** Characterize the interactive prompt functions via the injectable `prompts` seam (these have no kernel caller — value is downstream-consumer characterization, not regression protection) and remove the two unreachable `"NetOps"` dead literals (R7 hygiene).

**Requirements:** R2, R7, R6

**Dependencies:** None

**Files:**
- Create: `scripts/installer/cli/prompts.test.mjs`
- Modify: `scripts/installer/cli/prompts.mjs` (R7 hygiene: `renderBanner` default title + `gatherInstallChoices` `prompts.intro` literal — generic-constant swap only, no signature change)
- Modify: `package.json` (`test:prompts` script + aggregate append)

**Approach:**
- **DI-stub path** (the seam is uniform for these): inject a fake `prompts` stub (`select`/`multiselect`/`isCancel`/`log.error`/`intro`) into `gatherActionChoice`, `gatherUninstallChoices`, **`gatherInstallChoices`** (the largest interactive fn — explicitly named, was implicit before), and the other `{ prompts = clack }` functions. Assert returned choices for happy selections; assert `CancelledError` (correct `stage`) when the stub's `isCancel` returns true; assert no-installs / no-selection guards throw `CancelledError`.
- `gatherUninstallChoices` requires a `readState` function — inject a stub returning synthesized state.
- **`renderBanner` needs a different harness, NOT the prompts stub**: it has no `prompts` param and writes directly via `process.stdout.write` (figlet) — assert it by capturing `process.stdout` (the error-format injected-stream technique applies here, the prompts-stub technique does not). Cover `enabled:false` (no-TTY → suppressed) and `version` rendering.
- **R7 hygiene (two literals, generic-constant swap, no signature change):** `renderBanner` default title `"NetOps Skills"` → a generic product-agnostic constant; `gatherInstallChoices`'s `prompts.intro("NetOps Agent Skills installer")` → generic constant (stub-coverable, so it gets a real regression assertion). Add regression assertions: neither emits `NetOps`/`netops`/`skillctl` by default. **NOT in scope:** `renderNextSteps`' hardcoded `node scripts/install-skills.mjs` bin-path literal — different class (needs product bin knowledge), flagged to Deferred to Follow-Up Work.

**Execution note:** Characterize current `renderBanner` + `gatherInstallChoices.intro` output before the swap, so the hygiene change is deliberate and witnessed. Frame it as dead-literal removal, not a behavioral bug fix (no kernel caller observes it).

**Patterns to follow:** `scripts/installer/cli/error-format.test.mjs` (injected-stream pattern — applies to `renderBanner`'s stdout capture AND the `prompts` stub); `CancelledError` is exported from `prompts.mjs`.

**Test scenarios:**
- Happy path: `gatherActionChoice`/`gatherInstallChoices` with a stub returning a valid selection returns that choice; `gatherUninstallChoices` with stub state + multiselect returns the chosen selections.
- Edge cases: `renderBanner` with `enabled:false` suppresses; with `version` renders it.
- Error/failure paths: stub `isCancel→true` → `CancelledError` with the expected `stage`; no managed installations → `CancelledError("no-installs")`; selected agents with no installs → `CancelledError`.
- Regression (R7): default `renderBanner` (via stdout capture) and `gatherInstallChoices` intro (via stub) emit no `NetOps`/`netops` literal.

**Verification:** `npm run test:prompts` green; the `NetOps Skills` literal is gone from `prompts.mjs`; no regression.

---

### U3. run.mjs + cli.mjs handler/exit-code E2E expansion

**Goal:** Cover verb-handler branches and `createCli` composition that are exit-code-bearing, via spawn E2E.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `examples/sample-product/sample-bin.test.mjs` (additional `runBin` witnesses)
- (No new `test:` script — extends an already-aggregated suite.)

**Approach:**
- Extend the existing `runBin` spawn harness. Each witness asserts `{code, stdout, stderr}` for a handler branch the smoke tests don't reach.
- `run.mjs`: `list`/`plan`/`agents`/`doctor`/`validate`/`export`/`import` in both `--json` and text mode with exit-code assertions; `validate` exit-code contract (0 clean / 1 any finding incl. parse error / 2 missing-arg or file-not-found — the v0.3.1-corrected contract); `repair` scan (exit 0, read-only) vs `--apply`; `install`/`uninstall` `ERR_NO_SELECTION`; `--target` + multiple `--agent` conflict (exit 2); `--json` error envelope uniformity (cross-check the v0.3.1 fix end-to-end).
- `cli.mjs`: `--profile` sets the `ProductConfig.envProfile` env var — assert the **env var is set** (observable without disk), NOT target-path isolation: `--profile` suffixing only applies when no `--target` is passed (`if (profileName && !target)`), so a temp-`--target` assertion and a profile-suffix assertion are mutually exclusive; assert the env-var path only. Unknown verb → help, exit 0; `extraHandlers` verb dispatches without shadowing a kernel verb; `validVerbs` override.
- **`CancelledError`→exit 130 is NOT a witness here** — provably unreachable via spawn (no non-interactive caller throws `CancelledError`; it originates only in `prompts.mjs`, which the kernel/sample never invoke). Documented as unreachable-by-construction in the suite as a comment, not asserted. Do not attempt to fake a TTY.

**Patterns to follow:** `examples/sample-product/sample-bin.test.mjs` (`runBin` spawnSync helper, `install --help`/`help install` witness shape).

**Test scenarios:**
- Happy path: each verb `--json` emits a parseable verb-shaped envelope, exit 0; text mode exit 0.
- Edge cases: `repair` with no drift → exit 0 scan; `plan` dry-run never writes.
- Error/failure paths: `--target`+multi-agent → exit 2; `install` no selection → ERR_NO_SELECTION non-zero; `validate` malformed SKILL.md → exit 1 (not 2); missing path arg → exit 2; `--json` error → uniform `{ok:false,...}` on stdout, stderr clean (v0.3.1 contract, E2E).
- Integration: `--profile dev` sets `process.env[productConfig.envProfile]` (assert the env var, not target-root isolation — see Approach); `extraHandlers` custom verb runs without shadowing a kernel verb.

**Verification:** new witnesses pass under `npm test`; `sample-bin.test.mjs` still in the aggregate; exit codes match the AGENT-CLI-CONTRACT.md §3 contract.

---

### U4. strings.mjs catalog-completeness guard

**Goal:** Guard every strings namespace against missing keys, non-function values, and product-literal leaks.

**Requirements:** R4, R6

**Dependencies:** None

**Files:**
- Create: `scripts/installer/cli/strings.test.mjs`
- Modify: `package.json` (`test:strings` script + aggregate append)

**Approach:**
- Walk all three frozen namespaces (`help`, `errors`, `run`) plus `help.verb`. Assert each leaf is a function; calling it with a representative params object returns a non-empty string; no rendered string contains a hardcoded `skillctl`/`netops` literal (parameterization guard — extends the `help.verb` assertion from v0.3.0 to the whole catalog).
- Assert the namespaces are frozen (post-freeze mutation throws).
- Scoped reference check: `run.mjs` emits most user-facing output as **inline literals**, using `strings.run.*` only sparsely (`runList`/`runAgents` headers/legend). So a blanket "every referenced key exists" check is largely vacuous for rename-protection — scope the assertion honestly to the keys `run.mjs`/`commands` *actually* call (enumerate the real call sites; assert those resolve), and state in the suite that catalog coverage of `run.mjs` is partial-by-construction (the code bypasses the catalog). Do not claim broad rename-protection the code structure can't deliver.

**Patterns to follow:** the v0.3.0 `help.test.mjs` `strings.help.verb` completeness assertions.

**Test scenarios:**
- Happy path: every namespace key is a function returning a non-empty string for representative params.
- Edge cases: namespaces frozen (mutation throws); no key renders `undefined`/`NaN` for minimal params.
- Error/failure paths: regression guard — no rendered string contains `skillctl` or `netops`.

**Verification:** `npm run test:strings` green; catalog leaks would fail it; no regression.

---

### U5. loader edge-case extension

**Goal:** Cover loader edge cases beyond the current `loader.test.mjs` against the sample manifest.

**Requirements:** R5, R6

**Dependencies:** None

**Files:**
- Modify: `scripts/installer/core/manifest/loader.test.mjs` (extend; no new file → no aggregate change needed, already listed)

**Approach:**
- Add gaps not in the current 9 cases: malformed JSON → typed error; missing manifest file → typed error with resolved path; CRLF + BOM combined; `defaultPaths` with a fully-specified vs partial `ProductConfig` against the actual `examples/sample-product/` layout; manifest with unknown top-level keys (forward-compat tolerance vs reject — assert actual behavior).

**Patterns to follow:** existing `scripts/installer/core/manifest/loader.test.mjs` cases.

**Test scenarios:**
- Happy path: sample manifest loads; `defaultPaths` resolves the sample's nested `skills/agents/rules`.
- Edge cases: BOM+CRLF; partial `ProductConfig` per-field fallback.
- Error/failure paths: malformed JSON → typed error (not raw `SyntaxError`); missing file → typed error naming the resolved path.

**Verification:** extended `loader.test.mjs` green within `npm test`; no regression.

---

### U6. v0.4.0 release (bump + note + tag)

**Goal:** Ship the sweep as an additive minor, release-discipline-consistent.

**Requirements:** R8

**Dependencies:** U1, U2, U3, U4, U5

**Files:**
- Create: `docs/release-notes/v0.4.0.md`
- Modify: `package.json` (`version` 0.3.1 → 0.4.0)

**Approach:**
- `v0.4.0.md` (mirror v0.3.1 shape): "Added — product-coupled test sweep (commands / prompts / strings / loader unit suites + run/cli E2E expansion), closing the ADR-0004-deferred coverage gap"; "Hygiene — removed two unreachable `NetOps` dead literals (`renderBanner`, `gatherInstallChoices` defaults) → generic constants; no caller, zero observable behavior change for skillctl consumers"; plus any same-class trivial leak the sweep surfaces. Vendor note: no public-surface change, purely additive coverage; the literal swaps are in caller-less internal `cli/` code (a downstream product that wraps these directly would see the new generic default). Do NOT frame the literal swaps as a behavioral bug fix.
- Bump `package.json` to `0.4.0`; `"private": true` stays.
- Final atomic commit: version bump + `v0.4.0.md` together (`lint:release-sync` green: 0.4.0 == newest note v0.4.0). The per-suite `package.json` aggregate edits from U1/U2/U4 are version-orthogonal and may commit with their units (lint only cares about version↔note — established in the v0.3.0 work).

**Patterns to follow:** `docs/release-notes/v0.3.1.md`; `scripts/lint-release-sync.mjs` version==newest-note contract.

**Test scenarios:**
- Happy path: `npm run lint:release-sync` exit 0 (0.4.0 == v0.4.0).
- Edge case: full `npm test` green with all new suites in the aggregate; pre-commit hook passes.

**Verification:** `lint:release-sync` green; `v0.4.0.md` present; `npm test` green with the expanded suite count.

---

## System-Wide Impact

- **Interaction graph:** test-only except the U2 R7 hygiene swaps (`renderBanner` + `gatherInstallChoices` default literals → generic constants; no signature change, no caller exists, `architecture.test.mjs` Z-layer unaffected). Zero observable impact for this repo's consumers (the functions have no kernel/sample caller).
- **Error propagation:** unchanged. New tests assert existing error/exit behavior; they do not alter it (except R7's banner default string).
- **State lifecycle risks:** U1/U3 create temp target dirs — must clean up (mirror repair-rehash.test teardown) to avoid worktree pollution. No production state path changes.
- **API surface parity:** none. No `index.mjs` export change. `renderBanner`/`gatherInstallChoices` are not public exports (internal `cli/`, no caller).
- **Integration coverage:** U1 (real-fs command layer) + U3 (spawn E2E) are the cross-layer proofs unit mocks can't give; this is the sweep's core value.
- **Unchanged invariants:** all public exports; `process.exit` call sites in run/cli (explicitly NOT refactored); the Z three-layer guard; ProductConfig contract; `lint:release-sync` semantics.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| R7 literal swaps perceived as a behavioral fix when they touch unreachable dead code → v0.4.0 overstates impact | Framed as dead-literal hygiene throughout (no kernel caller); v0.4.0 note says "hygiene: removed unreachable NetOps literals", not "fixed a bug"; characterize-before-swap execution note keeps it deliberate |
| Multi-agent commands (`installMulti` etc.) have no `target` param → can't redirect to a temp dir | Resolved in-plan (Open Questions): `HOME`-env override + `allowNoCli` for okCount/failCount aggregation; documented retreat to Deferred if infeasible at U1 time — not an in-unit surprise |
| Multi-agent command paths (`installMulti` etc.) not exercisable against a single fixture | U1 synthesizes a second adapter target if needed (deferred-to-impl, flagged) |
| `CancelledError`→exit 130 provably unreachable via spawn (only thrown in caller-less `prompts.mjs`) | Removed from R3's covered set; U3 documents it unreachable-by-construction as a comment, does not assert it, does not fake a TTY |
| New `*.test.mjs` not appended to the explicit `test` aggregate → silent false-green | Per-unit wiring is a Files-level requirement in U1/U2/U4 + R6; verification asserts the suite appears in `npm test` output |
| Temp target dirs from U1/U3 leak into the worktree | Mirror repair-rehash.test cleanup; verification includes a clean `git status` check |
| Sweep surfaces more leaks than the enumerated three, expanding scope | R7's open clause is replaced by an explicit enumeration (renderBanner + gatherInstallChoices fixed; renderNextSteps deferred); a *new* leak is in-scope only if it is a same-class trivial constant swap, else flagged to Deferred — no unbounded "fix anything" authorization |

---

## Documentation / Operational Notes

- No runtime/production impact (test-only + one internal banner-default correction). Unpublished kernel (ADR-0005); vendor consumers pull the `v0.4.0` tag.
- CLAUDE.md "Test scope" note should be updated by U6's release context to reflect that the ADR-0004 deferred sweep is now delivered (the note currently says it is a deferred follow-up).

---

## Sources & References

- Related ADRs: `docs/adr/0004-absorption-provenance-netops-tier-1-2.md` (the deferral this discharges), `docs/adr/0001-...` (ProductConfig identity / R7), `docs/adr/0005-...` (release model / U6)
- Related code: `scripts/installer/cli/{run,cli,prompts,strings}.mjs`, `scripts/installer/cli/commands/index.mjs`, `scripts/installer/core/manifest/loader.mjs`
- Pattern tests: `scripts/installer/cli/commands/repair-rehash.test.mjs`, `scripts/installer/cli/error-format.test.mjs`, `examples/sample-product/sample-bin.test.mjs`, `scripts/installer/core/manifest/loader.test.mjs`
- Prior plans: `docs/plans/2026-05-18-001-feat-absorb-netops-spi-v11-and-release-discipline-plan.md`, `docs/plans/2026-05-18-002-feat-verb-scoped-help-and-agent-cli-contract-plan.md`
