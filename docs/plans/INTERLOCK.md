---
date_created: 2026-05-29
goal: docs/goals/2026-05-29-backlog-clear.md
status: LOCKED (Phase 2 complete; Phase 4 fix-loop active)
---

# INTERLOCK — cross-PR shared decisions for v0.9.0 backlog

## ADR number assignment

| Item slug | ADR | PR | Research memo |
|---|---|---|---|
| `validator-registry` | **0016** | #10 | `docs/research/2026-05-29-validator-registry-preflight.md` |
| `deactivate-verb` | **0017** | #12 | `docs/research/2026-05-29-deactivate-verb-preflight.md` |
| `ci-bless-path` | **0018** | #8 | `docs/research/2026-05-29-ci-bless-path-preflight.md` |
| `toctou-defense` | **0019** | #11 | `docs/research/2026-05-29-toctou-defense-preflight.md` |

## LOCK 1 — Ambient-fence marker format

Frozen, inherited from v0.8.x:

```
<!-- nexel:<productName>:begin -->
<!-- nexel-managed-fence v1; do not edit between markers -->
...body...
<!-- nexel:<productName>:end -->
```

Source: `scripts/installer/core/ambient-fence.mjs:26-36`.

**Deactivate semantics**: exact-invert per-product. `removeAmbientFence` reuses `fenceRegex(productName)`. **MUST** also reuse `isFenceTrusted` check + unbalanced-marker guard from `writeAmbientFence` (Phase 4 P0 finding — security regression in initial implementation).

**Rejected:** unconditional sweep. Violates per-product isolation invariant (`ambient-fence.test.mjs:134,158`).

**`--all-products` flag:** DEFERRED — needs on-disk product registry; own ADR.

**CI-bless interaction:** marker namespaces orthogonal — release-bless marker at `.nexel/release-blessed-<tag>`, fence marker in host CLAUDE.md/AGENTS.md. No collision.

## LOCK 2 — Diagnostic envelope shape (Validator Registry)

Rules emit findings matching the existing manifest validator `Finding` shape:

```js
Finding = {
  severity: "error" | "parse-error",
  section:  "root" | "skills" | "agents" | "rules" | "bundles" | <rule-defined>,
  id:       string | null,
  message:  string,
}
```

Source: `validator.mjs:38-40` (writer) + `:311-318` (consumers).

Reused `formatFindings` + `exitCodeFor` unchanged.

**Rejected:** lint-skills shape (not on `installer/index.mjs`); state shape (no severity); net-new unified (translation contract = G8 hard-to-reverse).

## LOCK 3 — Validator Registry registration API

```js
export function registerValidatorRule(rule)
```

`rule = { id, appliesTo, check }` where `appliesTo ∈ "manifest"|"skill"|"agent"|"rule"|"bundle"` and `check(subject, ctx)` returns `Finding[]`.

**Rejected:** Option A (`ProductConfig.validatorRules?` field — breaks ADR-0001 D2); Option C (SPI hook — breaks ADR-0010).

Tie-breaker: ADR-0010 (SPI scope = adapters) + ADR-0001 D2 (ProductConfig frozen identity) both push to B.

**Phase 4 P1 fix**: `runRegisteredRules` MUST quarantine non-array return as `parse-error` (rules returning Promise / single Finding should not silently drop).

## LOCK 4 — State schema migration step assignment

| Item | State change? | Rationale |
|---|---|---|
| validator-registry (0016) | **No** | Rules in-memory only |
| deactivate-verb (0017) | **No** | Removes fence text only; parity with activate |
| ci-bless-path (0018) | **No** | Marker file already exists; adds CI transport only |
| toctou-defense (0019) | **No** | Post-lock re-lstat + inode pinning held in local var |

Zero schema changes. ADR-0008 unfreeze budget not consumed.

## LOCK 5 — PR merge order

| Order | Item | PR | Files touched | Conflict risk |
|---|---|---|---|---|
| 1 | validator-registry | #10 | core/manifest/validator.mjs, core/registry.mjs (new), index.mjs | None |
| 2 | ci-bless-path | #8 | .husky/, .github/workflows/, scripts/ | None — no overlap with kernel core |
| 3 | deactivate-verb | #12 | core/ambient-fence.mjs, cli/dispatch.mjs, cli/commands/deactivate.mjs (new), strings, errors | Conflict with #4 same file |
| 4 | toctou-defense | #11 | core/ambient-fence.mjs (3 sites), core/filesystem.mjs | Last; absorbs #3 changes |

## LOCK 6 — Mechanical Stop-if pre-commitments (Phase 3+ builders)

Each builder + reviewer enforces:
1. No ambient-fence marker byte changes
2. No ProductConfig identity / OPTIONAL_DEFAULTS field additions
3. No validator `Finding` shape change
4. No state.mjs schema change
5. No existing test case edit (strict-superset assertions only)
6. No `--no-verify` / `--no-gpg-sign` / `--amend` on pushed commits
7. **NEW (Phase 4)**: `removeAmbientFence` MUST port adv-002 unbalanced-marker guard + isFenceTrusted check from `writeAmbientFence` (security parity)
8. **NEW (Phase 4)**: TOCTOU defense on `lockPath` MUST NOT pin ino/dev (proper-lockfile rmdir+mkdir stale-recovery would false-positive); symlink-only check
9. **NEW (Phase 4)**: TOCTOU defense in promoteStagedFiles MUST walk parent segments post-lock (not just dst)

## Phase 3+ status snapshot

| PR | Status (post-Phase 4 review) |
|---|---|
| #8 (0018 CI bless) | Approve with P1 fixes (scan robustness + doc framing) |
| #10 (0016 validator) | Approve with P1 fixes (quarantine + ADR + docs) |
| #11 (0019 TOCTOU) | **Block until P1 fixed** (lockPath stale-recovery + parent walk) |
| #12 (0017 deactivate) | **Block until P0 fixed** (port 2 defenses to removeAmbientFence) |
