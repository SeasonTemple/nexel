---
status: accepted
date: 2026-05-18
supersedes: 0005
---

# Rename to `nexel`; decouple the name decision from the publish/contract-clock decision

## Context

ADR-0005 deferred the npm name + publish decision and **coupled four things** to
whenever that decision is made: name lock, public-API contract-clock start,
`"private": true` removal, and its own supersession. It closed with:

> Supersede this ADR when the name + publish decision is made (that decision
> starts the public-API contract clock and removes `"private": true`).

That coupling assumed the name decision and the publish decision would land
together. They do not. The maintainer's actual driver is internal identity
closure — ending the "provisional name" open loop — with **no external consumer
blocked on `npm install`**. The value the maintainer wants lands the moment the
real name is decided and written down, not when the package becomes
npm-installable. Coupling the name decision to publish would force a premature
contract-clock start before the kernel's moat surface has regression coverage
(the post-v0.4.0 residual sweep, sequenced after this).

The squat that motivated the rename was not bad luck: `skillctl` sits in npm's
saturated descriptive namespace (`skill*`, `*ctl`). A rename to another
descriptive compound re-enters the same namespace and the same failure mode.

This ADR supersedes ADR-0005. It is recorded per ADR-0001 D1 (hard to reverse,
surprising without context, the result of a real trade-off) and mirrors
ADR-0006's provenance-correction discipline.

## Decision

### D1: Name resolved — `nexel`

The project is renamed `skillctl` → `nexel` (nexus + kernel). A coined mark was
chosen over the alternatives because only a name that **leaves the saturated
descriptive namespace** is structurally unsquattable and durably ends the
problem; `nexel` is npm-unscoped-free (verified 2026-05-18 via `npm view`), has
no famous collision, and is semantically aligned with the kernel's identity (the
connecting kernel/seam across runtimes — install is the most visible entry verb,
not the identity). `kohere` was rejected despite the best semantic fit due to
phonetic collision with Cohere (a major LLM company) in the same AI-tooling
space.

### D2: Scope-it rejected on its own merits, not by the namespace argument

`@seasontemple/skillctl` (scoping) was reconsidered and rejected. The rejection
is **not** "scoping re-enters the namespace" — a scoped name does not, and
framing it that way would be a logic error. A scoped name would, at lower blast
radius, also resolve the squat. It is rejected because the maintainer wants a
clean, unscoped, namespace-independent identity made firm before any publish —
ADR-0005's actual stated reason ("the maintainer wants the name unsettled until
the project identity is firm") was identity-firmness/timing, not a structural
defect. The identity is now being made firm; this is the decision.

### D3: Explicit retraction of ADR-0005's coupling clause

ADR-0005's clause — quoted verbatim:

> that decision starts the public-API contract clock and removes
> `"private": true`

— **is hereby explicitly retracted.** The name decision (this ADR) is
deliberately decoupled from the publish/contract-clock decision. Superseding
ADR-0005 on the name decision alone does **not** start the public-API contract
clock and does **not** remove `"private": true`. This is a deliberate amendment
of ADR-0005's own terms, recorded so the ADR log shows an intentional
decoupling, not a silent contradiction.

### D4: `.skillctl` on-disk state directory is decoupled from the brand

`STATE_DIRNAME = ".skillctl"` (`scripts/installer/core/filesystem.mjs`) is
**deliberately NOT renamed**. Renaming it would orphan every existing
`.skillctl/` state directory on disk — a real production-behavior change with a
migration cost. Freezing it is what a package-manager-class kernel does: the
on-disk state contract is a stability surface independent of the product mark
(consistent with ADR-0001 D2's reasoning that identity woven into on-disk state
must stay stable across a lifetime). Consequently the rename's "zero
production-code behavior change" claim is scoped to mean "no logic change and no
on-disk-contract change."

### D5: Publish posture remains deferred

`npm publish`, `"private": true` removal, the public-API contract-clock start,
the README real-npm-install rewrite, and the `pipeline.*` pre-publish cleanup
are **not** done here. They are sequenced after the post-v0.4.0 residual
coverage sweep ("Candidate 1"), which is itself sequenced after this rename.
This ADR does not start the contract clock; pre-publish internal API changes
remain routine cleanup recorded in release notes for vendor consumers, exactly
as ADR-0005 established (that part of ADR-0005's reasoning survives its
supersession).

## Consequences

- The "provisional name" open loop is closed: the project's live identity is
  `nexel`, recorded here as the authoritative decision; historical records that
  say `skillctl` were true when written and are not falsified (the superseding
  ADR is the forward pointer).
- The contract clock is still **not** started. Deleting/changing internal
  exports before first publish remains routine cleanup, not a breaking change
  requiring a major bump or migration ceremony.
- `"private": true` is retained as the accidental-`npm publish` guard until the
  separately-sequenced 2b publish decision.
- Vendor / git-tag consumers must update the package name they pull
  (`skillctl` → `nexel`); the on-disk state directory they already have stays
  `.skillctl` and needs no migration.
- ADR-0005 is superseded but left intact as a historical record; this ADR is
  the forward pointer.

## References

- [ADR-0005](0005-release-model-no-npm-provisional-name.md) — superseded by this ADR
- [ADR-0001](0001-adopt-adr-practice-and-record-frozen-invariants.md) — D2 (on-disk identity stability rationale), D1 (ADR practice), D4 (release discipline)
- `docs/brainstorms/2026-05-18-rename-skillctl-to-nexel-requirements.md` — the requirements doc this decision implements
- `docs/plans/2026-05-18-004-refactor-rename-skillctl-to-nexel-plan.md` — the 2a implementation plan
