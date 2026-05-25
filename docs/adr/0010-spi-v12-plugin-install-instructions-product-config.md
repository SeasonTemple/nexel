---
status: accepted
date: 2026-05-25
---

# SPI v1.2 — `pluginInstallInstructions` accepts ProductConfig

## Context

Adapter SPI v1.1 (ADR-0002) defined `pluginInstallInstructions: () => string`
as an optional adapter export. The text was static — the three in-repo
adapters (Claude / Codex / OpenCode) returned placeholder strings like
`<your-product-marketplace-url>` because the adapter had no input that
named the downstream product's marketplace URL, plugin name, or
repository.

Static placeholders were a real defect. When a downstream product
selected plugin install mode in the interactive flow, the rendered
instructions either:

1. Showed the literal placeholder string to the user (worst case —
   uncopyable command), or
2. Forced the downstream to fork the adapter just to template a few
   strings into the output.

The v0.7 work to publish a sample-product plugin layout (U5 of plan
2026-05-25-001) made the gap acute: every adapter call site started
needing `productName`, `pluginName`, `marketplaceName`, and
`repositoryUrl` at the same time the scaffolder (U7) needed them.

## Decision

Widen `pluginInstallInstructions` from `() => string` to
`(productConfig) => string`. Treat the change as a **minor SPI revision
(v1.1 → v1.2)** because:

- JavaScript silently ignores extra arguments, so pre-v1.2 adapters
  that implement `pluginInstallInstructions()` keep working when the
  v1.2 caller hands them a `productConfig` they ignore.
- `SPI_DEFAULTS.pluginInstallInstructions` becomes
  `(_productConfig) => ""` — the identity default still returns `""`
  for any input.

The three in-repo adapters (`claude.mjs` / `codex.mjs` / `opencode.mjs`)
now interpolate `productName` / `pluginName` / `marketplaceName` /
`repositoryUrl` from the supplied `productConfig`. Each adapter
lazy-validates `productConfig.repositoryUrl` and returns an actionable
error string when the field is missing, pointing the user at
`agent-skills.config.mjs` rather than emitting a misleading
placeholder.

Call-site audit: `assertSupportsDirect` (in
`scripts/installer/adapters/spi.mjs` and its legacy free-function
wrapper) accepts an optional `{ productConfig }` opts bag and threads
it to the adapter call. `commands/index.mjs` install path forwards
`ctx.productConfig`. `prompts.mjs` `gatherInstallChoices` accepts
`productConfig` and forwards it to the plugin-mode adapter call.

## Consequences

- **Backward-compat (in-scope external adapters):** an adapter author
  who shipped `pluginInstallInstructions: () => "..."` keeps working
  unchanged. The rendered text no longer carries marketplace URLs the
  product owns, but the adapter is not broken.
- **Function-shape observation is NOT contract.** `SPI_DEFAULTS`
  reference identity and per-field `Function.length` are now
  documented as out-of-contract surface; adapter authors must not
  detect "no override" by comparing references or arity. The spi.mjs
  evolution policy section documents this explicitly.
- **ProductConfig field expansion is the natural dependency.** A
  new ProductConfig optional field set (`repositoryUrl`, `pluginName`,
  `marketplaceName`, `pluginAuthor`, `pluginDescription`) was added
  to support both this adapter widening AND the plan's U7 scaffolder.
  Field selection is documented in `defineProductConfig`'s
  `OPTIONAL_DEFAULTS` block; `repositoryUrl` is lazy-validated by
  consumers, not required at construction time, so pure-installer
  downstreams have a zero-burden upgrade path.
- **`repositoryUrl` is dual-purpose.** It serves as both the git
  source (for OpenCode's `git clone` step) AND the marketplace URL
  (for Claude / Codex `marketplace add`). A separate `marketplaceUrl`
  field was considered and rejected — every real product publishes
  one URL today, and a future split can be re-opened without breaking
  the v1.2 contract.

## References

- `docs/plans/2026-05-25-001-feat-absorb-netops-and-plugin-support-plan.md`
  (U4 specifies the SPI widening; U3 specifies the ProductConfig fields
  that flow into it)
- `docs/adr/0002-adapter-content-transform-via-spi-hook.md` (the v1.1
  baseline this revision builds on)
- `scripts/installer/adapters/spi.mjs` (SPI evolution policy header)
