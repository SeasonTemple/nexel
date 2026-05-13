# CLAUDE.md

Guidance for Claude Code (and any agent) working in this repo.

## What this repo is

`skillctl` — an OSS kernel library for managing AI agent skills, agents, and rules across Claude Code, Codex, and OpenCode. The library is product-agnostic; downstream products supply a `ProductConfig` and content, and the kernel handles install / uninstall / update / state tracking / drift detection / planning / etc.

The repo previously hosted Lenovo's internal NetOps team-skills product. The OSS line forked at v0.5.1 of that internal product, dropped all internal content, and restarted at v0.1.0. The internal product line is no longer present in this repository — only the kernel library and a single worked example under `examples/sample-product/`.

## Bootstrap

```bash
npm install
```

Installs `yaml` + `husky` (auto-activated via the `prepare` script). Run once after a fresh clone.

## Repository layout

```
skillctl/
├── scripts/
│   ├── installer/          # The kernel library — Z three-layer
│   │   ├── core/           # Pure logic: manifest, validator, plan, state, pipeline
│   │   ├── adapters/       # Platform integrations: claude, codex, opencode, SPI
│   │   ├── cli/            # CLI surface: argv, help, dispatch, run, strings, prompts
│   │   ├── index.mjs       # Public API barrel (the only entry point downstream consumes)
│   │   └── architecture.test.mjs  # Layer-direction guard
│   ├── lint-skills.mjs     # SKILL.md frontmatter linter (with optional --id-prefix)
│   └── install-husky.mjs   # husky bootstrap helper
├── examples/
│   └── sample-product/     # Canonical worked example: ProductConfig + manifest + content + bin
└── docs/
    └── release-notes/      # Per-release notes (one .md per tag)
```

## Commands

| Command | What |
|---------|------|
| `npm test` | Run the full test suite |
| `npm run lint:skills` | Lint SKILL.md frontmatter (use `--dir=<path>` and `--id-prefix=<prefix>` to target a product) |
| `npm run lint:manifest` | Validate `install.json` against the schema |
| `npm run lint:drift` | Detect drift between manifest and disk |

## Architecture invariants (enforced by `architecture.test.mjs`)

- `core/**/*.mjs` may import only from `core/**`, `node:**`, or npm packages
- `adapters/**/*.mjs` may import from `core/**`, `node:**`, or npm packages (never `cli/`)
- `cli/**/*.mjs` may import from `core/`, `adapters/`, `node:**`, or npm packages
- `index.mjs` is the only public entry — composes everything
- Downstream consumer bins (incl. `examples/sample-product/bin.mjs`) may import only from `installer/index.mjs` or named adapter modules

Don't break these. If a change feels like it requires breaking them, refactor first.

## ProductConfig contract

`defineProductConfig({...})` returns a frozen `ProductConfig`. Required identity fields are frozen in Adapter SPI v1:

```
productName, skillIdPrefix, agentNamePrefix, defaultManifestFile, binName
```

Optional fields fall back to generic kernel defaults: `defaultSkillsDir` = "skills", `defaultAgentsDir` = "agents", `defaultRulesDir` = "rules", `defaultManifestFile` = "install.json".

`skillIdPrefix` may not contain `:`; `agentNamePrefix` must end with `-`. Misconfigured products fail loud at construction time.

## Test scope

v0.1.0 ships with a deliberately lean test suite:

- `scripts/lint-skills.test.mjs`                    — Frontmatter linter unit tests
- `scripts/installer/core/manifest/loader.test.mjs` — Path resolution
- `scripts/installer/cli/argv.test.mjs`             — CLI arg parser
- `scripts/installer/cli/dispatch.test.mjs`         — Verb dispatch table
- `scripts/installer/adapters/spi.test.mjs`         — Adapter SPI conformance
- `scripts/installer/architecture.test.mjs`         — Z-layer dependency guard
- `examples/sample-product/sample-bin.test.mjs`     — End-to-end smoke via `child_process.spawnSync`

Tests that were tightly coupled to the legacy product fixture were dropped during the OSS strip. They will be rebuilt against `examples/sample-product/` as that fixture stabilizes.

## Adding a new skill (when working inside a downstream product, not this repo)

1. Create `<product>/skills/<dirname>/SKILL.md` with frontmatter:
   ```yaml
   ---
   name: <prefix>:<dirname>     # where <prefix> matches ProductConfig.skillIdPrefix
   category: <enum>             # product-defined
   description: <one-line>
   ---
   ```
2. Register the skill in the product's `install.json` manifest
3. Run the product's bin: `<binName> validate <path-to-SKILL.md>` to lint a single file, or `<binName> list` to confirm the manifest sees it
4. Commit — pre-commit hook in this skillctl repo runs `npm test`; downstream products configure their own hooks

## Frontmatter category enum (lint default)

The bundled `lint-skills.mjs` recognizes these six category values out of the box:

| Category | Meaning |
|----------|---------|
| `principle` | Methodology / book-derived principles |
| `best-practice` | Language / framework conventions |
| `test` | Test strategy + workflow |
| `review` | Code / security review patterns |
| `tool` | Skill-management tooling |
| `setup` | Platform / environment setup |

Downstream products can fork the linter (`scripts/lint-skills.mjs`) if they want a different taxonomy; the kernel itself does not constrain category values beyond what the lint flags enforce.

## Conventions

- ESM (`type: module`); use `.mjs` for new scripts
- No CHANGELOG.md — release context lives in `docs/release-notes/<tag>.md` and tag annotations
- Plugin versioning is manual — there is no automatic semver tool
- Don't add ts/tsx; this is a pure JS kernel
- New tests run via `node --test`; no Jest / Vitest dependency
