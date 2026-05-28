---
date: 2026-05-29
item: validator-registry
adr: 0016
pr: 10
research: docs/research/2026-05-29-validator-registry-preflight.md
interlock: docs/plans/INTERLOCK.md
merge_order: 1
---

# Plan: Pluggable Validator Rule Registry (ADR-0016)

## Decision summary

Add kernel-generic in-process registry for custom validator rules. External packages call `registerValidatorRule(rule)` at process start; rules run during `validateManifest` after built-in checks. Asset enum stays closed. ProductConfig untouched. SPI untouched.

## Trade-off resolution

| Axis | Options | Winner | Cite |
|---|---|---|---|
| Registration API | A. ProductConfig field / B. imperative / C. SPI hook | **B** | INTERLOCK LOCK 3 (ADR-0001 D2 + ADR-0010) |
| Finding envelope | A. validator shape / B. lint-skills / C. state / D. unified | **A** | INTERLOCK LOCK 2 (reuse formatFindings/exitCodeFor) |
| Asset enum | stay closed | **closed** | ideation idea 2 + memo §5 |

## Implementation

1. New `core/registry.mjs` with `registerValidatorRule` + `listValidatorRules` (+ test-only `_resetRegistryForTests`)
2. `validator.mjs` runs registered rules after built-ins via `runRegisteredRules(manifest, ctx, findings)`; quarantines non-Finding / non-array returns as `parse-error` with `section: "registry"`
3. `cli/commands/index.mjs` threads `productConfig` into `validateOpts`
4. `index.mjs` exports 2 new public symbols
5. `architecture.test.mjs:220` asserts new exports

## Test plan

- New `core/registry.test.mjs`: 8 cases (validation, dedup, freeze, reset)
- Extend `validator.test.mjs`: 7 cases (no-rules regression, manifest scope, per-asset iteration, finding emission, parse-error, malformed quarantine, cleanup)
- All 471 existing tests pass unchanged

## Phase 4 fix (P1 quarantine)

In `runRegisteredRules`, when `out` is not an array (including Promise, single object, undefined): push `parse-error` finding with `section: "registry"`, `id: rule.id`, `message: "rule returned non-array"`. Cover async-rule case explicitly.

## ADR-0016 outline

1. Context — 3 finding envelopes coexist; ideation idea 2 routes principle-pack through frontmatter + sister package
2. Decision — additive `registerValidatorRule`; existing Finding shape; rules run after built-ins; ProductConfig as read-only ctx
3. Rejected — Option A (ADR-0001 D2 breach); Option C (ADR-0010 + ADR-0001 D3 breach)
4. Consequences — `registerValidatorRule` joins SPI v1 stability surface (ADR-0005); rules can introduce new `section` strings without breaking formatter
5. Status — Accepted v0.9.0

## Stop-if (PR-specific)

- Rule shape change beyond LOCK 2 → stop
- `formatFindings` template change → stop (LOCK 2)
- ProductConfig new field → stop (LOCK 3 Option A territory)
- New SPI version → stop (LOCK 3 Option C)
- `validateManifest` signature change → stop (Goal Stop-if #3)
