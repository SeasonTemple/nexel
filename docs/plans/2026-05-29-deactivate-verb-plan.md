---
date: 2026-05-29
item: deactivate-verb
adr: 0017
pr: 12
research: docs/research/2026-05-29-deactivate-verb-preflight.md
interlock: docs/plans/INTERLOCK.md
merge_order: 3
---

# Plan: deactivate verb (ADR-0017, adv-009)

## Decision summary

Add `deactivate` verb that removes THIS product's ambient fence from host file (exact-invert of `activate`). Adds `removeAmbientFence` core function. Reuses `fenceRegex(productName)` per-product literal. **MUST** also reuse `isFenceTrusted` + unbalanced-marker guard from `writeAmbientFence` (Phase 4 P0 finding — security parity required).

## Trade-off resolution

| Axis | Options | Winner | Cite |
|---|---|---|---|
| Removal scope | A. exact-invert / B. unconditional | **A** | INTERLOCK LOCK 1; multi-product isolation |
| `--all-products` flag | include / defer | **defer** | LOCK 1; no on-disk product registry |
| Idempotency | throw / noop / removed-no-change | **noop** | activate parity (`action:"updated"`, `changed:false`) |
| OpenCode | refuse / allow | **refuse** | `ERR_DEACTIVATE_OPENCODE_REFUSED` parallel |
| Lock semantics | reuse `<target>.lock` | **reuse** | concurrent activate+deactivate serialize |

## Implementation

1. **`core/ambient-fence.mjs`** — add `removeAmbientFence({targetPath, productName, logger})` after line 270. **MUST** include:
   - Target-symlink refusal (adv-004 parity)
   - Lock-path symlink refusal (adv-r5-C parity)
   - proper-lockfile `lockSync` + finally `release()`
   - **Phase 4 P0 — unbalanced-marker guard** (parallel to write-path adv-002 at `:226-232`): count begin and end markers; refuse with structured error if not exactly 1 each
   - **Phase 4 P0 — isFenceTrusted check** (parallel to write-path P1#6 at `:isFenceTrusted call site`): refuse to remove fence pair lacking the managed-header sentinel
   - Return `{action: "removed" | "noop", changed, targetPath, reason?}`
2. **`cli/commands/deactivate.mjs`** — mirror `activate.mjs`; runDeactivate / deactivateCommand / deactivateClaude / deactivateCodex
3. **Dispatch** — `dispatch.mjs:41` add `deactivate: runDeactivate`
4. **Errors** — `errors.mjs` add `ERR_DEACTIVATE_OPENCODE_REFUSED` + `ERR_DEACTIVATE_INVALID_SCOPE`
5. **Strings en + zh** — verb one-liners + scoped help renderer

## Test plan

- `commands/deactivate.test.mjs`: 7 cases mirroring activate.test.mjs
- Extend `ambient-fence.test.mjs`: 7 cases for `removeAmbientFence` (only-this-product, missing-file noop, no-fence noop, target-symlink refusal, lock-symlink refusal, idempotency, TypeError)
- **Phase 4 P0 tests**: unbalanced-marker refusal; untrusted-fence refusal (parallel to write-path tests)
- **Phase 4 P2 tests**: byte-exact post-remove file content (not just `.includes`); concurrent-lock contention; trailing-newline preservation
- Extend `dispatch.test.mjs` + `help.test.mjs` for verb registry

## Phase 4 P1 — seam-collapse fix

Replace global `text.replace(/\n{3,}/g, "\n\n")` with targeted seam-only normalization at splice site. Global replace mutates user prose with 3+ consecutive newlines anywhere in file.

## ADR-0017 outline

1. Context — adv-009 backlog; deactivate counterpart to activate; multi-product isolation; multi-product enumeration unsolved
2. Decision — `removeAmbientFence` additive; exact-invert per-product; reuse `fenceRegex(productName)`; SAME defenses as writeAmbientFence (unbalanced + trusted)
3. Rejected — unconditional sweep (breaks multi-product isolation); `--all-products` (needs registry, own ADR)
4. Consequences — `removeAmbientFence` joins SPI v1; multi-product host enumeration remains user responsibility
5. Status — Accepted v0.9.0

## Stop-if (PR-specific)

- Marker bytes change → stop (LOCK 1)
- Wildcard regex / product enumeration → stop (LOCK 1 deferred clause)
- state.mjs reads/writes → stop (LOCK 4)
- removeAmbientFence return shape diverges from writeAmbientFence → stop
- OpenCode allowed → stop (asymmetry)
- Missing adv-002 / isFenceTrusted in remove path → stop (Phase 4 P0)
