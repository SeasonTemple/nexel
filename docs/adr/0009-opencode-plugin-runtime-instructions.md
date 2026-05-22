---
status: accepted
date: 2026-05-22
---

# OpenCode plugin runtime instructions via Skill Metadata

## Context

The OpenCode Adapter already handles direct install: target-path mapping and
agent frontmatter transformation happen through Adapter SPI v1.1. The
downstream NetOps product also proved a separate OpenCode plugin-runtime need:
when OpenCode loads a product plugin, the plugin can append installed skill
paths and ambient instruction files to `config.skills.paths` and
`config.instructions`.

Putting `config.instructions` discovery into `transformAssetContent` would
break that SPI hook's purity: it would need filesystem discovery and config
mutation rather than byte transformation. Putting it in `core/` would also
make the **Kernel** know OpenCode runtime config details. Leaving it as a deep
import would force downstream products to depend on internal paths.

## Decision

OpenCode `config.instructions` support is modeled as **Plugin Runtime**, not
Adapter SPI. The product-agnostic helper lives at
`scripts/installer/adapters/opencode-plugin.mjs` and is exported as
`./adapters/opencode-plugin`; downstream OpenCode plugin files import that
subpath rather than deep-importing internals. The helper is intentionally not
re-exported from `scripts/installer/index.mjs`, keeping the main **Kernel**
Interface free of OpenCode runtime-specific surface.

Skills may declare `opencode-instructions: <relative-path>` as **Skill
Metadata** in `SKILL.md` frontmatter. That metadata is category/profile
agnostic, does not create a new **Asset**, does not add manifest visibility, and
does not participate in setup routing. It only lets an OpenCode **Plugin
Runtime** find an instruction file inside an already-visible skill directory.

## Consequences

- Direct install behavior remains unchanged.
- Adapter SPI v1.1 remains pure; `transformAssetContent` still cannot read env,
  discover files, or mutate host config.
- OpenCode plugin products get a stable public subpath for config wiring.
- Invalid runtime metadata warning-skips during OpenCode plugin load, while
  lint/manifest validation catches defects before release.

## References

- `CONTEXT.md`
- `scripts/installer/adapters/opencode.mjs`
- `scripts/installer/adapters/opencode-plugin.mjs`
- `docs/adr/0002-adapter-content-transform-via-spi-hook.md`
