---
status: accepted
date: 2026-05-18
---

# Absorption provenance: what Tier 1+2 was taken from the netops fork, and what was not

## Context

skillctl forked from the netops-agent-skills internal product at its v0.5.1.
This plan absorbed the product-agnostic, kernel-level subset of that
downstream's *terminal v0.10.0 state* — not a mid-vintage snapshot. The
single most important provenance correction: netops ADR-0003 (defer the
`pipeline.*` fate) is **superseded by netops ADR-0004 (delete `pipeline.*`,
single-tier)**. The terminal downstream decision is *delete*, and skillctl
adopts it (see skillctl ADR-0003). Future readers must not anchor on the
superseded deferral.

## Decision

### Absorbed (kernel-level, product-agnostic)

| Item | Where | skillctl record |
|---|---|---|
| SPI v1.0 → v1.1: optional `transformAssetContent` hook (identity default), `ERR_TRANSFORM_FAILED` | `adapters/spi.mjs`, `core/errors.mjs`, `adapters/README.md` | ADR-0002 |
| `applyAdapterTransform` compose primitive (core-internal) | `core/plan.mjs` | ADR-0002 D2 |
| `core/stage-asset.mjs` (`stageAsset` + `hashTransformed`) dedup of the staging triplet | new module | ADR-0002 D2 |
| Single-tier installer — **delete dormant `pipeline.*`** (adopting netops ADR-0004, not the superseded ADR-0003) | `core/pipeline.mjs` removed; `pipeline`/`ERR_PIPELINE_*` dropped from public surface | ADR-0003 |
| `repair` re-hash bug fix (records the staged hash) | `cli/commands/index.mjs` | ADR-0003 D3 |
| opencode `transformAssetContent` (Claude→OpenCode agent frontmatter) + `agent` re-admitted | `adapters/opencode.mjs` | ADR-0002 D4 |
| `lint-release-sync` (semver, non-lexical) + release-discipline spec | `scripts/lint-release-sync.mjs`, ADR-0001 D4 | ADR-0001 |
| ADR practice + `docs/adr/` + `docs/release-notes/` scaffold | `docs/`, CLAUDE.md | ADR-0001 D1 |
| Layered test-suite rebuild bound to `examples/sample-product/` | `*.test.mjs` (errors/asset-types/which/validator/drift + SPI-bearing units) | this plan U8 |

### Deliberately NOT absorbed (netops product privates / out of scope)

| Excluded | Why |
|---|---|
| `skill-collector` / `skill-analyzer` / `skill-absorber` / `skill-forge` lifecycle, `PROVENANCE.md` / `ABSORBED.md`, promotion checklist | netops product content (vendoring external skills); stripped at the OSS fork |
| netops four-manifest version lockstep (`marketplace.json` + `plugin.json` ×2) | skillctl ships no plugin manifests — nothing to lockstep |
| `INSTALL-FOR-AGENTS.md` content, the "version-agnostic explainer" invariant | netops-specific product/agent-install contract, not kernel |
| `verify-baseline.mjs` byte-baseline oracle | Tier-2-deferred: coupled to a fixed command list + bin name; lower value pre-CLI-stability. Follow-up |
| Product-coupled test rebuild (extended `loader`/`commands`/`cli`/`help`/`strings`/`prompts`) | **Discharged v0.4.0** (`help`/`error-format` earlier in v0.3.0/v0.3.1; see `docs/release-notes/v0.4.0.md` and `docs/plans/2026-05-18-003-...`). Two narrow items remain deferred: a typed-error loader layer and `renderNextSteps`' product-specific bin-path literal. |

### Recorded deviations from the netops blueprint

- **`lint-release-sync` badge check dropped (not ported).** netops asserts a
  static `releases-vX.Y.Z` README badge == package version. skillctl has no
  such static badge — its only version-bearing badge is the *dynamic* npm
  badge (`shields.io/npm/v/skillctl`), which (a) cannot drift (it is fetched,
  not hardcoded) and (b) points at an unrelated third-party npm package (see
  ADR-0005). A badge check would be inapplicable and misleading, so it is
  omitted; rationale also recorded inline in `scripts/lint-release-sync.mjs`.
- **`lint-release-sync` D1 contract compressed into ADR-0001.** netops
  ADR-0006 D1 uses a separate `docs/release-process.md`; skillctl's assertion
  set is small enough that the spec lives in ADR-0001 D4 (recorded
  D1-compression, not a silent D2-without-D1).
- **Plan-side transformed hash composed locally, not via `hashTransformed`.**
  Avoids a `plan.mjs ↔ stage-asset.mjs` import cycle (ADR-0003 D4).
- **Pre-existing `update`/`repair` `productConfig` wiring bug fixed.** The
  command functions referenced a `productConfig` not threaded through their
  signatures / `run.mjs` calls — never exercised E2E before the U5
  characterization test. Fixed as a root-cause correction (in scope: the
  repair re-hash behavior cannot function otherwise).

## Consequences

- Provenance is anchored to the downstream's terminal state; the
  superseded-ADR trap is named explicitly.
- The public surface lost `pipeline` + `ERR_PIPELINE_*` (internal cleanup —
  the kernel is unpublished, ADR-0005); the SPI gained one optional field.
- Test coverage rebuilt to 159 passing, bound to `examples/sample-product/`,
  with no upstream-product-private assertions.

## References

- ADR-0001 (practice + freeze/layer + release-discipline spec)
- ADR-0002 (content-transform hook + D4 tool-restriction divergence)
- ADR-0003 (adopt downstream single-tier; `pipeline.*` delete; repair fix)
- ADR-0005 (release model — unpublished, provisional name)
- netops ADR-0003 (superseded) → netops ADR-0004 (the adopted pipeline decision)
- `docs/plans/2026-05-18-001-feat-absorb-netops-spi-v11-and-release-discipline-plan.md`
