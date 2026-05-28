---
status: accepted
date: 2026-05-29
---

# Remove `ERR_ACTIVATE_FAILED` — unreachable fallback from ADR-0014

## Context

ADR-0014 (v0.8.4) introduced `ERR_ACTIVATE_FAILED` as the public error
code used in the unified `--json` failure envelope when no per-adapter
code was available. The intent was defensive — guard against a hypothetical
future path where `activateCommand` flips `ok:false` without populating an
adapter entry's `code`.

The v0.8.4 round-2 pre-commit review (correctness reviewer CR-R4) noted
the fallback was unreachable under current `activateCommand` semantics
and recommended evaluating it for removal. v0.8.5's round-6 audit of
`activateCommand` confirmed: every code path that sets `okOverall = false`
also pushes a `refused` or `failed` adapter entry carrying a specific
typed code (`ERR_ACTIVATE_OPENCODE_REFUSED` for the `opencode` refusal,
`ERR_ARGS` for unknown-target, or the original error's `code` for
adapter throws). The `firstFailure` lookup in `runActivate` was therefore
guaranteed non-undefined whenever `envelope.ok === false`.

## Decision

`ERR_ACTIVATE_FAILED` is removed from the public exports:

- Deleted from `scripts/installer/core/errors.mjs`
- Removed from the re-export block in `scripts/installer/index.mjs`
- Removed from `runActivate`'s `?? "ERR_ACTIVATE_FAILED"` fallback in
  `scripts/installer/cli/commands/activate.mjs`

In its place, `runActivate` adds an explicit contract assertion: if
`envelope.ok === false` AND no `refused`/`failed` adapter entry exists,
throw an explanatory `Error` naming the contract violation. This
surfaces any future `activateCommand` change that flips `ok:false`
without pushing an entry as a loud failure with actionable context,
rather than as a silent `TypeError` masked as `ERR_UNKNOWN`.

`docs/AGENT-CLI-CONTRACT.md` activate-subsection updated to drop the
"`ERR_ACTIVATE_FAILED` is used" sentence and assert that `error` is
always populated from a specific per-adapter code. ADR-0014 itself is
left as a historical record (its References block still mentions
`ERR_ACTIVATE_FAILED` because that ADR's decision was correct at
v0.8.4 — this ADR records the v0.8.5 revision, supersedes nothing).

## Consequences

- **Back-to-back public-API churn (v0.8.4 add → v0.8.5 remove) is
  documented.** Pre-1.0 surface; zero-adoption premise (ADR-0005,
  ADR-0008) still holds. Downstream consumers who pinned v0.8.4 and
  imported `ERR_ACTIVATE_FAILED` see a missing-export when upgrading.
  v0.8.5 release notes flag the breaking change.
- **Strict contract is now enforced at the runActivate boundary.**
  Future contributors adding a new `okOverall = false` trigger without
  populating an adapter entry hit the new assertion and see the
  actionable message naming the two valid remediation paths (push the
  entry or restore the fallback).
- **Test surface.** No new test added specifically for the contract
  assertion — exercising it would require constructing an artificial
  `activateCommand` state that violates the contract, which can only be
  done via test-double or by deliberately patching the function. The
  existing `runActivate` tests cover the happy and refused/failed
  paths; if a future contract violation is introduced, the existing
  E2E tests will fail at that path with the new explanatory error.
- **ADR-0014 stays accurate as the v0.8.4 record.** Its References
  block still mentions `ERR_ACTIVATE_FAILED` because that was the
  v0.8.4 decision. This ADR is the v0.8.5 amendment.

## References

- [ADR-0014](0014-activate-json-envelope-unification.md) — introduced
  `ERR_ACTIVATE_FAILED` in v0.8.4 as the unification fallback; v0.8.5
  removed the unreachable fallback per this ADR
- `scripts/installer/cli/commands/activate.mjs` — `runActivate`
  failure path + new contract assertion
- `scripts/installer/core/errors.mjs` — constant removed
- `scripts/installer/index.mjs` — export removed
- `docs/AGENT-CLI-CONTRACT.md` activate subsection — updated to drop
  the `ERR_ACTIVATE_FAILED` mention
- v0.8.4 pre-commit review CR-R4 finding — the original "unreachable"
  flag
