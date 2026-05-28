# ADR-0017: deactivate verb (adv-009)

- Status: Accepted (v0.9.0)
- Date: 2026-05-29
- Related: ADR-0001 (frozen invariants), ADR-0006 (kernel/product boundary), ADR-0012 (host instructions key), ADR-0014 (--json envelope), ADR-0015 (error codes), ADR-0019 (TOCTOU)
- Implementation: PR #12 · `scripts/installer/core/ambient-fence.mjs` · `scripts/installer/cli/commands/deactivate.mjs`

## Context

v0.8.x shipped `activate` (verb wiring around `writeAmbientFence`) but
left `deactivate` deferred. Backlog item adv-009 (v0.8.5 release
notes). `removeAmbientFence` was not exported from `core/ambient-fence.mjs`
prior to v0.9.0. Three sister-product features have been waiting on
this: clean uninstall, reinstall-without-fence-drift, and the
`nexel doctor` repair path.

## Decision

1. Add additive `removeAmbientFence({targetPath, productName, logger})`
   to `core/ambient-fence.mjs`. Return shape mirrors `writeAmbientFence`:
   `{action: "removed" | "noop", changed, targetPath, reason?}`.

2. **Exact-invert per-product semantics**: removes only the fence
   matched by `fenceRegex(productName)` (per-product literal lookup,
   `ambient-fence.mjs:64-71`). Other products' fences in the same
   host file are preserved byte-identically — locked invariant from
   `ambient-fence.test.mjs:134, 158`.

3. **Security parity with writeAmbientFence** (Phase 4 P0 fix):
   - Target-symlink refusal (adv-004 parity)
   - Lock-path-symlink refusal (adv-r5-C / v0.8.5 parity)
   - **adv-002 unbalanced-marker guard** — count begin/end markers,
     refuse if not exactly 1 each (lazy fenceRegex would otherwise
     engulf prose between mismatched markers)
   - **P1#6 isFenceTrusted check** — refuse to splice a marker pair
     lacking the managed-header sentinel (defends against user-prose
     collision where the user wrote literal nexel-shaped markers)

4. **OpenCode parity**: refuse with `ERR_DEACTIVATE_OPENCODE_REFUSED`
   (parallel to `ERR_ACTIVATE_OPENCODE_REFUSED`).

5. **Idempotency on no-fence**: return `{action: "noop", changed: false,
   reason: "no fence for this product"}` rather than throwing —
   mirrors activate's `action:"updated", changed:false` byte-identical
   re-run pattern.

6. **Lock semantics**: reuse `<target>.lock` via `lockfile.lockSync`
   (same path as `writeAmbientFence`). Concurrent activate+deactivate
   against the same target serialize through one lock.

7. **Seam normalization (Phase 4 P1)**: collapse seam at splice site
   only, not globally. The initial implementation's
   `text.replace(/\n{3,}/g, "\n\n")` mutated unrelated user prose;
   targeted normalization preserves byte-identity outside the seam.

## Rejected alternatives

- **Unconditional sweep of all `<!-- nexel:*:begin -->` markers**.
  Rejected: violates the per-product isolation invariant locked by
  `ambient-fence.test.mjs:134, 158` and the multi-product coexistence
  design intent at `ambient-fence.mjs:14-15`.

- **`--all-products` flag**. **Deferred** (own ADR territory). No
  on-disk product registry exists today; enumerating products would
  require a wildcard regex over begin-markers, plus a policy for
  partial failure when one product's removal succeeds and another
  fails. Out of scope for v0.9.0.

## Consequences

- `removeAmbientFence` joins SPI v1 stability surface (ADR-0005).
- Multi-product host enumeration remains the user's responsibility.
- The deferred `--all-products` flag is logged as a candidate ADR
  topic in `docs/goals/2026-05-29-backlog-clear.md`.
- TOCTOU defense for the new `removeAmbientFence` is patched in the
  v0.9.0 release-cleanup commit (Phase 6). ADR-0019 (PR #11) covers
  the three pre-existing TOCTOU sites; the new function inherits the
  same class and uses the same `verifyPostLockIntegrity` helper.

## Implementation references

- `scripts/installer/core/ambient-fence.mjs:304-395` — `removeAmbientFence`
- `scripts/installer/cli/commands/deactivate.mjs` — verb runtime
- `scripts/installer/cli/dispatch.mjs:41` — `deactivate: runDeactivate`
- `scripts/installer/core/errors.mjs` — `ERR_DEACTIVATE_OPENCODE_REFUSED`,
  `ERR_DEACTIVATE_INVALID_SCOPE`
- Plan: `docs/plans/2026-05-29-deactivate-verb-plan.md`
- Research: `docs/research/2026-05-29-deactivate-verb-preflight.md`
