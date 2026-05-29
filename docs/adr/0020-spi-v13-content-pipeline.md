---
status: proposed
date: 2026-05-29
---

# Optional staged content pipeline (SPI v1.3)

## Context

ADR-0002 added `transformAssetContent: (asset, body: Buffer) => Buffer` — a
single per-adapter content-rewrite hook, invoked at one chokepoint
(`applyAdapterTransform` in `core/plan.mjs`, composed by `stageAsset` /
`hashTransformed` in `core/stage-asset.mjs`). It serves exactly one shape: the
OpenCode agent-frontmatter translation (`adapters/opencode.mjs`). The hook has
**no composition seam** — an adapter (or a downstream product) cannot stack two
independent transforms (e.g. frontmatter-prefix rewrite + a cost-annotation
inject + a cross-CLI sanitizer) without hand-merging them into one opaque
function.

The SPI is at **v1.2**. Its evolution policy (ADR-0010, `spi.mjs` header)
allows a minor version to *add a new optional field with a kernel default* or
*widen an existing optional signature* as long as old adapter shapes stay
forward-compatible. We want composable transforms without breaking any v1.1/v1.2
adapter and without paying for machinery we cannot yet justify.

A scoping pass (5-way read-only fan-out, 2026-05-29) confirmed: no
`contentPipeline` token exists today; the single hook reaches adapters only;
the `transformed` flag is computed by Buffer **reference equality**
(`resultBuf !== sourceBuf`, `plan.mjs`); the only non-identity hook is
`adapters/opencode.mjs`. Backward-compat hinges entirely on the auto-promotion
rule below.

## Decision

### D1: Add optional `contentPipeline?: Stage[]` to the SPI; bump v1.2 → v1.3

`SPI_DEFAULTS` gains `contentPipeline` with default `[]` (empty pipeline =
identity). Minor version: additive optional field with a kernel default; every
existing adapter is unaffected. A `Stage` is:

```
{ id: string, run: (asset, body: Buffer) => Buffer }
```

`run` carries the exact contract of `transformAssetContent`: **pure** (no env,
no IO, subject to the import side-effect ban), and **identity stages MUST
return the input Buffer by reference**. `id` is a non-empty string, unique
within the pipeline, used solely for error attribution and debugging.

**No `when` phase concept.** Stages are an ordered list applied at the single
existing transform chokepoint. Phase tagging (`'plan' | 'stage' | 'lint'`),
lint-as-stage convergence, and the never-built self-improve hook are
**explicitly deferred** — they are added as a future minor *when a real second
phase exists*, not speculatively now.

**Sync-only.** Every stage is synchronous, matching today's fully-synchronous
staging path (`readFileSync` → sync hash → sync `stageWrite`). Async stages
would force the entire staging pipeline async — a large blast radius — and are
deferred to a later revision if a real need appears.

### D2: Resolve to a canonical `Stage[]` at registry build; fold at the existing chokepoint

`createAdapterRegistry` resolves each adapter to one canonical pipeline:

1. `contentPipeline` present and non-empty → use it verbatim.
2. else `transformAssetContent` is declared by the author (i.e.
   `typeof adapter.transformAssetContent === "function"`) → synthesize a 1-stage
   pipeline `[{ id: "transformAssetContent", run: hook }]`.
3. else → empty pipeline (identity).

**As-built note (reconciled post-review):** `applyDefaults` decides promotion by
inspecting the **raw** adapter (`typeof adapter.transformAssetContent === "function"`)
*before* the default-fill loop runs, so the kernel's injected
`SPI_DEFAULTS.transformAssetContent` is never present at the decision point — no
`SPI_DEFAULTS`-reference comparison is needed or performed. (The mutual-exclusion
guard is also intrinsic to `applyDefaults`, so a both-declared adapter fails loud
on every call path, not only through `validateAdapter`.) This is stricter and
simpler than the reference-identity wording originally drafted here; the code is
authoritative.

`applyAdapterTransform` becomes a fold over the resolved stages, threading the
Buffer stage → stage. The `transformed` flag is recomputed once against the
**original source Buffer** (`finalBuf !== originalSourceBuf`), never per-stage,
so the cross-stage hash invariant from ADR-0002 D2 (`state.json` sha256 ==
`hashFile(promoted file)`) holds unchanged for 0-, 1-, and N-stage pipelines.
`stageAsset` / `hashTransformed` keep their current signatures — they already
delegate to this primitive.

### D3: Declaring both `contentPipeline` and a non-default `transformAssetContent` fails loud

An adapter that sets `contentPipeline` (non-empty) **and** overrides
`transformAssetContent` is almost certainly a half-migration or a mistake.
`validateAdapter` throws `AdapterError(ERR_ADAPTER_INVALID)` at registry
construction naming both fields. This matches the kernel's documented
"misconfigured products fail loud at construction time" ethos (CLAUDE.md /
ProductConfig). Starting strict is reversible — we can loosen to a precedence
rule later; silently dropping a declared hook is not reversible after it has
masked a bug in the field.

### D4: Per-stage error attribution extends `ERR_TRANSFORM_FAILED`, not a new code

A stage that throws or returns a non-Buffer surfaces the existing
`AdapterError(ERR_TRANSFORM_FAILED)` (no new error identity). `.details` gains
**`stageId`** — the `id` of the failing pipeline stage — alongside the existing
`stage` field from ADR-0002 D1 (which discriminates *plan vs stage* origin).
The two are orthogonal: `stage` = which invocation site, `stageId` = which
pipeline step. `ERR_TRANSFORM_FAILED` remains part of the public stability
contract; adding a details key is additive.

## Consequences

- SPI evolution stays under the minor-version policy (ADR-0010). v1.1/v1.2
  adapters keep working: single-hook adapters auto-promote to a 1-stage
  pipeline; no-hook adapters resolve to the empty pipeline.
- Unlocks third-party / stacked transforms (translation, annotation,
  sanitization) and gives `lint`-as-stage and a future self-improve hook a
  landing point — *without* building that machinery now.
- `transformed`-flag and `state.json` hash semantics are preserved exactly;
  `update` / tamper-detection behave identically across 0/1/N stages.
- `ERR_TRANSFORM_FAILED.details.stageId` is the first per-stage diagnostic;
  the error *code* surface is unchanged.
- The both-declared fail-loud is a new construction-time rejection path — a
  deliberate, documented strictness, loosenable later.
- Scope explicitly excludes `when` phases, async stages, lint convergence, and
  self-improve. Those are separate future decisions, each its own minor + ADR.

## Alternatives considered

- **Replace `transformAssetContent` with a mandatory pipeline** — rejected.
  Removing an optional field is a major (breaks the v1.1 contract); the additive
  auto-promotion path delivers composition at minor cost.
- **Introduce `when: 'plan'|'stage'|'lint'` phases now** — rejected as
  speculative. Today there is exactly one application point; lint-as-stage is a
  separable design with its own weight and self-improve was never built. Adding
  phase machinery for unproven needs is the over-design this backlog round
  repeatedly caught.
- **Async stages** — rejected for v1.3. The staging path is fully synchronous;
  allowing `async run` forces the whole pipeline async. Defer until a concrete
  async transform need exists.
- **Pipeline-wins-silently when both declared** (the original scoping
  suggestion) — rejected in favor of D3 fail-loud: a silently-ignored hook
  hides the author's mistake and contradicts the fail-at-construction ethos.
- **`transformAssetContent` appended as the final stage when both declared** —
  rejected: muddies ordering semantics and the "which wins" question without a
  real use case.

## References

- `docs/adr/0002-adapter-content-transform-via-spi-hook.md` — the single hook this evolves
- `docs/adr/0010-spi-v12-plugin-install-instructions-product-config.md` — additive-minor SPI policy + the forbidden no-override detections
- `docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md` — Z-layer + frozen invariants
- `scripts/installer/adapters/spi.mjs` — SPI contract, `SPI_DEFAULTS`, `validateAdapter`
- `scripts/installer/core/plan.mjs`, `core/stage-asset.mjs` — `applyAdapterTransform` fold site + hash invariant
- `scripts/installer/adapters/opencode.mjs` — the lone non-identity transform (auto-promotes to 1 stage)
- `docs/backlog/v0.9.x-candidates.md` — Verified-remaining set (Idea 3); note: this ADR is **0020**, not the backlog's stale "likely ADR-0022" (0020/0021 were never claimed by the now-shipped Idea 4a / Idea 5-ladder)
