---
status: accepted
date: 2026-05-25
---

# Sample-product plugin layout as v0.7 downstream reference

## Context

Through v0.6.x, the `examples/sample-product/` directory was a
"canonical worked example" (per `CLAUDE.md` repo layout): one
manifest, one bin, one set of skills demonstrating ProductConfig +
the installer kernel. It did **not** ship the three-platform plugin
manifest layout (`.claude-plugin/`, `.codex-plugin/`,
`.agents/plugins/`, `.opencode/INSTALL.md`).

V0.7 of the absorption plan (U5 of `docs/plans/2026-05-25-001-...`)
added that layout. The decision is one-way in two senses:

1. **External downstream products will copy this layout.** Once
   nexel ships sample-product as a complete plugin reference,
   downstream authors will rsync the directory and rename. The
   layout becomes a de-facto contract whether or not nexel intends
   it to be one.
2. **The OpenCode plugin entry the scaffolder generates (U7) uses
   the same layout.** Changing the layout post-v0.7 also changes
   the scaffolder output, which produces drift between hand-edited
   and freshly-scaffolded downstreams.

The plan's U5 decision was to place every plugin asset under
`examples/sample-product/` rather than at the repo root, so the
nexel repo's first-impression on GitHub stays "kernel library" not
"plugin host."

## Decision

Treat the sample-product plugin layout as a **v0.7 release-window
reference**, not an eternal contract. Concretely:

- The on-disk shape `examples/sample-product/.{claude,codex}-plugin/`,
  `.agents/plugins/`, `.opencode/INSTALL.md`, and
  `.opencode/plugins/sample-product.js` is stable through the v0.7
  release window.
- Plugin identity uses `name: "sample-product"` everywhere (matches
  the directory name + `ProductConfig.productName`), so downstream
  rename is a single global find-replace of the literal string
  `sample-product`.
- Marketplace `source` paths use relative locations (`.` in the
  Claude marketplace; `../..` in the Codex marketplace) so the
  subtree is portable: a downstream that copies `examples/sample-product/`
  into its own repo root finds the same plugin layout without
  rewriting paths.
- The OpenCode plugin entry imports `nexel/adapters/opencode-plugin`
  via the public exports subpath, honoring ADR-0009 (the OpenCode
  runtime helper does NOT join the main `nexel` index surface).
- The `verifyMarketplaceLockstep` helper (U6 of the same plan) is
  invoked by the sample contract test on every CI run, so version
  drift between manifests is caught at PR time.

## Consequences

- **Kernel inherits a v0.7-window layout-stability obligation.**
  Downstream products that copy sample-product as a template depend
  on the layout shape (directory names, file names, plugin name
  field). Changes within the v0.7 window require an explicit
  migration note. Changes after v0.7 do not — but a future major
  version that reshapes the layout should add a release-note
  migration block.
- **Marketplace lockstep ties nexel to plugin-registry evolution.**
  The lockstep helper compares `version` fields across plugin /
  marketplace manifests. Future Claude / Codex marketplace
  conventions that change where `version` lives (e.g., schema
  rev that moves the field into an `interface` block) will require
  the helper to adapt. Scope is intentionally narrow today —
  `version` only.
- **Identity drift acknowledged.** Adding plugin-distribution
  scaffolding shifts nexel's positioning from "install kernel"
  toward "kernel + plugin-authoring reference." The library-only
  positioning is preserved at the `npm` layer (`package.json.main`
  still points at the kernel barrel, `package.json.bin` remains
  unset). The repo layout signals "kernel library that also
  demonstrates plugin authoring" rather than "plugin host."
- **Known evolution items inside the v0.7 window.** The Codex
  marketplace `interface` block fields used in
  `examples/sample-product/.codex-plugin/plugin.json` come from
  observation of netops's earlier instance and may need revision
  once the Codex plugin spec is confirmed against current
  official docs (deferred to implementation per plan U7's known
  Outstanding Question). Adjustments inside the v0.7 window
  do not require a major bump.

## References

- `docs/plans/2026-05-25-001-feat-absorb-netops-and-plugin-support-plan.md`
  (U5 specifies the sample-product layout; U6 wires the lockstep
  helper; U7 generates the same layout from ProductConfig)
- `docs/adr/0009-opencode-plugin-runtime-instructions.md` (OpenCode
  helper sub-path import discipline that U5's generated entry honors)
- `examples/sample-product/sample-marketplace-contract.test.mjs` (CI
  contract test consuming `verifyMarketplaceLockstep` against the
  layout)
