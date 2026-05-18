---
status: accepted
date: 2026-05-18
---

# Kernel-generic agent CLI contract doc: scope boundary vs the netops INSTALL-FOR-AGENTS

## Context

ADR-0004 recorded what the OSS kernel absorbed from the downstream
netops-agent-skills fork and what it deliberately did not. Among the
**excluded** items: netops's `INSTALL-FOR-AGENTS.md` content and its
"version-agnostic explainer" invariant, classified as netops-specific
product/agent-install contract, not kernel.

That exclusion left a real gap: the kernel ships a verb-scoped CLI
(`createCli` + 11 `KERNEL_HANDLERS` verbs, exit-code conventions, a
`--json` envelope, non-interactive flags) that agents will drive, but had
no product-agnostic document stating the behavioral contract those agents
can rely on. v0.3.0 adds verb-scoped progressive `--help`, which sharpens
the question: where is the stable, written contract an agent integrator
reads instead of scraping help text?

A framing correction is also recorded here. The work that produced
`docs/AGENT-CLI-CONTRACT.md` was initially described as "delivering a
deferred ADR-0004 follow-up." That is inaccurate: ADR-0004 records no such
kernel-generic deferral — it *excludes* the netops product contract
outright. The contract doc is **new, complementary kernel work**, not the
fulfilment of a recorded deferral. Anchoring future readers to the correct
provenance is the reason this ADR exists (mirroring ADR-0004's own
provenance-recording discipline).

## Decision

The kernel ships `docs/AGENT-CLI-CONTRACT.md`: a **product-agnostic**
behavioral contract for any `createCli`-derived bin — verbs, exit codes,
the `--json` envelope shape, non-interactive flags (`--yes` / `--json`),
and the help-affordance rules (including that `<bin> <verb> help`
reverse-order is *not* a help affordance).

Scope boundary, recorded so it cannot be re-conflated:

| In scope (kernel-generic) | Out of scope (product-private — see ADR-0004) |
|---|---|
| The 11 kernel verbs + their purpose | Which skills/agents a product ships |
| Exit-code contract (0 / typed non-zero / 130) | Distribution channel, release-tag resolution, `npx`/tarball flows |
| `--json` envelope shape | How an *installed* skill is triggered |
| Non-interactive flag requirements | Per-product onboarding / platform-depth narrative |
| `ProductConfig`-supplied identity (bin name never hardcoded) | netops's "version-agnostic explainer" invariant |

The doc borrows only the *structural skeleton* (Preconditions /
Non-interactive contract / Exit-code contract / Behavioral contract
headings) from netops's `INSTALL-FOR-AGENTS.md`; all content is
kernel-generic and carries an explicit non-port statement. The
`examples/sample-product/` bin is the worked instantiation it points to.

## Consequences

- The agent-facing contract gap left by ADR-0004's exclusion is closed
  with a kernel-level artifact, not by re-importing product-private
  netops content.
- The provenance is corrected on record: the contract doc is new
  complementary work, not a recovered ADR-0004 deferral. Future readers
  inheriting the earlier framing have an authoritative correction.
- The contract is documented while the kernel is still unpublished. Per
  ADR-0005 the public-API contract clock has not started; the document
  describes current behavior as a pre-1.0 contract, not a frozen one, and
  may iterate with the surface until first publish.

## References

- ADR-0004 (absorption provenance — excludes `INSTALL-FOR-AGENTS.md` /
  the version-agnostic-explainer invariant as product-private)
- ADR-0005 (release model — unpublished, no contract clock yet)
- `docs/AGENT-CLI-CONTRACT.md` (the artifact this ADR scopes)
- `docs/plans/2026-05-18-002-feat-verb-scoped-help-and-agent-cli-contract-plan.md`
