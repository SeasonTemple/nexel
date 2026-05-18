<div align="center">

<img src="./assets/hero-banner.webp" alt="nexel" width="100%" />

# nexel

**Product-agnostic kernel library for managing AI agent skills, agents, and rules across Claude Code, Codex, and OpenCode.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-43853d?logo=node.js&logoColor=white)](./package.json)
[![Type: ESM](https://img.shields.io/badge/type-ESM-f7df1e?logo=javascript&logoColor=black)](./package.json)
[![Tests](https://img.shields.io/badge/tests-159%20passing-2ea44f)](./scripts/installer/architecture.test.mjs)

[English](./README.md) · [中文](./README.zh-CN.md) · [Quick start](#30-second-quick-start) · [API](#public-api) · [Examples](./examples/sample-product/)

</div>

---

## Overview

`nexel` is a kernel library. Downstream products supply a `ProductConfig` plus a manifest, and `nexel` handles validation, planning, install / uninstall / update, state tracking, drift detection, and multi-adapter dispatch. The library itself is product-agnostic — your product's bin name, skill-id prefix, agent name prefix, manifest filename, and env var namespace all come from `ProductConfig`.

> **Status:** pre-1.0. Name resolved to `nexel`; not published to npm yet — publish and the public-API contract clock are deliberately decoupled from the name decision and sequenced later (see [ADR-0007](./docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md), which supersedes [ADR-0005](./docs/adr/0005-release-model-no-npm-provisional-name.md)). The public surface is still iterating; pin a tag.

## Install

Not on npm. Consume via a pinned git tag — clone, a git dependency, or vendoring:

```sh
# git dependency (package.json), pinned to a release tag
npm install "git+https://github.com/<owner>/nexel.git#v0.3.0"
```

```sh
# or clone + pin
git clone https://github.com/<owner>/nexel.git && cd nexel && git checkout v0.3.0
```

Release notes per tag live in [`docs/release-notes/`](./docs/release-notes/). Requires Node ≥ 18. ESM only.

## 30-Second Quick Start

The repo ships a complete worked example under [`examples/sample-product/`](./examples/sample-product/):

```text
examples/sample-product/
├── agent-skills.config.mjs    # ProductConfig (only product-identity surface)
├── sample.install.json        # Manifest
├── skills/  agents/  rules/   # Content
├── bin.mjs                    # Wraps createCli with the config above
└── sample-bin.test.mjs        # End-to-end spawnSync tests
```

Run it:

```sh
node examples/sample-product/bin.mjs help
node examples/sample-product/bin.mjs list --json
node examples/sample-product/bin.mjs plan --agent codex --skill sample:hello-world
```

The bin is branded with whatever `productConfig.binName` you set. `nexel` itself never appears in user-facing text once wired up.

## ProductConfig

`defineProductConfig({...})` is the only product-identity surface. Required fields fail loud at construction time:

```js
import { defineProductConfig } from "nexel";

export default defineProductConfig({
  productName: "my-skills",
  skillIdPrefix: "my", // skill ids must start with "my:"
  agentNamePrefix: "my-", // agent installedName must start with "my-"
  defaultManifestFile: "my.install.json",
  binName: "my-skills",

  // Optional (kernel defaults shown):
  defaultSkillsDir: "skills",
  defaultAgentsDir: "agents",
  defaultRulesDir: "rules",
  targetPathLayout: { skills: "skills", agents: "agents" },
  envProfile: "MY_SKILLS_PROFILE", // for sandbox/profile isolation
  envBannerTitle: "MY_SKILLS_BANNER_TITLE",
});
```

Rules: `skillIdPrefix` may not contain `:`; `agentNamePrefix` must end with `-`.

## Public API

`scripts/installer/index.mjs` re-exports the v1 stability contract. Adding new exports is backward-compatible; removing or renaming is a breaking change.

| Category | Exports |
|---|---|
| **Factories** | `createCli`, `createAdapterRegistry`, `defineProductConfig` |
| **CLI primitives** | `parseArgs`, `printHelp`, `renderHelp`, `handleError`, `formatSkipNote`, `dispatchVerb`, `KERNEL_HANDLERS`, `strings` |
| **Verb handlers** | `runList`, `runAgents`, `runValidate`, `runExport`, `runImport`, `runRepair`, `runDoctor`, `runPlan`, `runInstall`, `runUninstall`, `runUpdate`, `resolveSelections` |
| **Manifest pipeline** | `loadManifest`, `validateManifest`, `defaultManifestPath`, `defaultPaths`, `detectDrift`, `exitCodeFor`, `formatFindings`, `SCHEMA_VERSION`, `PROFILES`, `CATEGORIES`, `HOSTS` |
| **Adapter SPI** | `SPI_REQUIRED`, `SPI_DEFAULTS`, `validateAdapter`, `applyAdapterDefaults`, `ADAPTERS`, `getAdapter`, `listAdapterStatus`, `assertSupportsDirect`, `assertCliPresent` |
| **Asset model** | `assetTypes`, `getAssetType`, `defaultTargetMapping`, `whichSync` |
| **Plan-time utilities** | `buildInstallPlan`, `resolveSelection`, `transitiveAssets`, `formatPlanText` |
| **Kernel commands** | `install`, `installMulti`, `uninstall`, `uninstallMulti`, `update`, `updateMulti`, `repair`, `exportCommand`, `importCommand`, `listCommand`, `agentsCommand`, `doctorCommand`, `planCommandText`, `planSelection` |
| **Errors** | `CommandError`, `AdapterError`, `ProductConfigError`, `StateError`, `FsError`, `PlanError`, `CancelledError`, all `ERR_*` codes |

## Architecture

`nexel` enforces a **Z three-layer** kernel via `architecture.test.mjs`:

```
scripts/installer/
├── core/          # Pure logic; never imports from cli/ or adapters/
├── adapters/      # Platform integrations; never imports from cli/
└── cli/           # Surface; may import from core/ and adapters/
```

The public API barrel (`index.mjs`) is the only entry point downstream consumers should touch.

## Adapter SPI

Three built-in adapters ship out of the box: Claude Code, Codex, OpenCode. Downstream products supply additional adapters by passing modules to `createCli({ adapters: [...] })`.

Each adapter exports the following SPI v1 contract:

| Field | Required | Type / signature |
|---|---|---|
| `id` | yes | `string` — unique identifier |
| `displayName` | yes | `string` — user-visible name |
| `detectTargetRoot` | yes | `({ override, env }) => string` |
| `detectStatus` | yes | `({ override, env }) => StatusObject` |
| `mapTargetPath` | no | `(asset, manifest, productConfig) => relPath` |
| `supportedAssetTypes` | no | `Array<"skill" \| "agent" \| "rule">` |
| `pluginInstallInstructions` | no | `() => string` |
| `supportsDirect` | no | `boolean` |
| `cliBinary` | no | `string` (`""` skips CLI presence check) |
| `cliInstallUrl` | no | `string` |
| `doctorProbes` | no | `({ targetRoot, env, productConfig }) => Array<{ name, ok, detail }>` |

Optional fields are filled with kernel defaults from `SPI_DEFAULTS` when omitted. See [`scripts/installer/adapters/spi.mjs`](./scripts/installer/adapters/spi.mjs) for the canonical contract and [`scripts/installer/adapters/claude.mjs`](./scripts/installer/adapters/claude.mjs) for a complete worked example.

## Verbs

| Verb | Purpose |
|---|---|
| `install` | Install skills / agents / rules into one or more adapter targets |
| `uninstall` | Remove previously installed assets |
| `update` | Re-install assets, preserving user-modified files unless `--overwrite` |
| `repair` | Re-install only assets that have drifted from the manifest |
| `plan` | Preview what `install` / `update` would do, without writing |
| `list` | Print skills and bundles from the manifest |
| `agents` | Print known adapter targets and their status |
| `validate` | Lint a single `SKILL.md` file against frontmatter rules |
| `export` | Archive installed state to a portable file |
| `import` | Restore state from an exported archive |
| `doctor` | Check adapter health and installed-asset integrity |
| `help` | Print usage (handled in the CLI shell, not dispatched as a kernel verb) |

All verbs accept `--json` for machine-readable output. The following flags apply to the state-mutating verbs (`install`, `uninstall`, `update`, `repair`); `plan` also accepts the selection subset:

| Flag | Argument | Purpose |
|---|---|---|
| `--agent` | `<id>` (repeatable) | Limit to specific adapter target(s) |
| `--skill` | `<id>` | Select a single skill |
| `--bundle` | `<id>` | Select a bundle |
| `--all` | — | Select every manifest entry |
| `--target` | `<path>` | Override the adapter target root |
| `--profile` | `<name>` | Activate a sandbox / env profile |
| `--dry-run` | — | Preview changes without writing |
| `--yes` | — | Skip confirmation prompts |
| `--overwrite` | — | Overwrite user-modified files |
| `--force` | — | Bypass safety checks |
| `--accept-modified` | `<relPath>` | Mark a specific file as intentionally modified |

Run `node examples/sample-product/bin.mjs help` for the full reference, dynamically rendered with your `productConfig.binName`. Per-verb usage: `<bin> <verb> --help` or `<bin> help <verb>`.

## For LLM Agents

Driving a nexel-derived bin programmatically? The product-agnostic behavioral contract — every verb, the exit-code contract, the `--json` envelope shape, the non-interactive flags (`--yes`, `--json`), and the help-affordance rules — is specified in [`docs/AGENT-CLI-CONTRACT.md`](./docs/AGENT-CLI-CONTRACT.md). It is stable kernel surface, independent of any product's bin name or content. [`examples/sample-product/bin.mjs`](./examples/sample-product/) is a runnable instantiation to test against.

## Tests

```sh
npm test
```

7 test suites covering parser, dispatch, manifest loader, adapter SPI conformance, architecture-layer guards, skill linter, and an end-to-end sample bin smoke test. Individual suites:

```sh
npm run test:lint           # SKILL.md frontmatter validator
npm run test:loader         # manifest path resolution
npm run test:argv           # CLI arg parser
npm run test:dispatch       # verb -> handler dispatch table
npm run test:spi            # adapter SPI v1 contract
npm run test:architecture   # Z three-layer dependency guard
npm run test:sample-bin     # examples/sample-product end-to-end
```

## Roadmap

- **Next** — the name decision has landed (`nexel`, [ADR-0007](./docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md)); npm publication remains deliberately deferred (decoupled from the name decision, sequenced after the residual coverage sweep); distribution stays git-tag / git-dependency / vendor. Ongoing: broader test coverage against the sample fixture, locale catalog plug-ins, additional adapter SPI implementations
- **v1.0.0** — when the API has survived ≥ one downstream adopter in production for a full quarter

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

Issues and PRs welcome. For non-trivial changes — new adapters, new verbs, public API additions, or architectural shifts — open a GitHub issue first so the direction can be aligned before implementation work starts. Bug fixes, documentation improvements, and additions to the sample fixture can go straight to a PR.
