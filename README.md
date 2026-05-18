<div align="center">

<img src="./assets/hero-banner.webp" alt="nexel" width="100%" />

# nexel

**A product-agnostic kernel for shipping one agent-skill pack across Claude Code, Codex, and OpenCode.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-43853d?logo=node.js&logoColor=white)](./package.json)
[![Type: ESM](https://img.shields.io/badge/type-ESM-f7df1e?logo=javascript&logoColor=black)](./package.json)
[![Tests](https://img.shields.io/badge/tests-253%20passing-2ea44f)](./scripts/installer/architecture.test.mjs)

[English](./README.md) · [中文](./README.zh-CN.md) · [Why](#why-nexel) · [Core model](#core-model) · [Quick start](#quick-start) · [Reference](#reference) · [AI agents](#for-ai-agents) · [Examples](./examples/sample-product/)

</div>

---

## Why nexel

You maintain a pack of agent skills, subagents, and rules, and you want it
installed across Claude Code, Codex, and OpenCode. Each tool stores assets in
a different place and expects a different frontmatter shape — so "ship my pack
everywhere" decays into N install scripts, N state files, and N drift checks,
re-derived per tool and re-debugged on every change.

`nexel` is the kernel that absorbs that work. You author **one
`ProductConfig` and one manifest**; the kernel owns validation, planning,
install / uninstall / update, state tracking, drift detection, and per-adapter
dispatch. Nothing in the kernel knows your product — bin name, skill-id
prefix, agent-name prefix, manifest filename, and env namespace all come from
your config. Supporting a new CLI is adding an adapter, not a rewrite.

> Driving a nexel-derived bin from an agent rather than authoring one? Skip to
> [For AI agents](#for-ai-agents) — the behavioral contract is specified
> separately and is stable kernel surface.

## Core model

Five nouns. Internalize these and the rest of this document follows.

| Term | What it is |
|---|---|
| **Kernel** | The product-agnostic library in `scripts/installer/`. Owns install / uninstall / update / state / drift / plan. Knows nothing about any product's content. |
| **ProductConfig** | The frozen per-product identity you pass in (`productName`, `skillIdPrefix`, …). The kernel is inert without one. |
| **Adapter** | A per-CLI integration (Claude Code, Codex, OpenCode). Decides where assets land and how their content is transformed. |
| **Asset** | A unit the kernel installs — exactly one of **skill**, **agent**, or **rule**. Not a generic file. |
| **Manifest** | `install.json` — the single source of truth. An asset is visible to the kernel **iff** it has a manifest entry. |

> One **Kernel** is configured by one **ProductConfig** per consuming product;
> a **Manifest** declares which **Assets** exist; an **Adapter** maps and
> transforms those assets onto a target CLI.

## Quick start

The repo ships a complete, runnable example under
[`examples/sample-product/`](./examples/sample-product/) — see it work before
wiring your own:

```text
examples/sample-product/
├── agent-skills.config.mjs    # ProductConfig (the only product-identity surface)
├── sample.install.json        # Manifest
├── skills/  agents/  rules/   # Content
├── bin.mjs                    # Wraps createCli with the config above
└── sample-bin.test.mjs        # End-to-end spawnSync tests
```

```sh
node examples/sample-product/bin.mjs help
node examples/sample-product/bin.mjs list --json
node examples/sample-product/bin.mjs plan --agent codex --skill sample:hello-world
```

The bin is branded with whatever `productConfig.binName` you set; `nexel`
never appears in user-facing text once wired up.

## Install

Not on npm. Consume via a pinned git tag — clone, a git dependency, or
vendoring:

```sh
# git dependency (package.json), pinned to a release tag
npm install "git+https://github.com/<owner>/nexel.git#v0.3.0"
```

```sh
# or clone + pin
git clone https://github.com/<owner>/nexel.git && cd nexel && git checkout v0.3.0
```

Requires Node ≥ 18, ESM only. Per-tag release notes live in
[`docs/release-notes/`](./docs/release-notes/).

## ProductConfig

`defineProductConfig({...})` is the only product-identity surface. Required
fields fail loud at construction time:

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

Rules: `skillIdPrefix` may not contain `:`; `agentNamePrefix` must end with
`-`.

## Design principles

Why the kernel is shaped this way. Each of these is enforced or recorded, not
aspirational.

1. **Product-agnostic kernel.** Zero product knowledge; inert without a
   `ProductConfig`, which throws at `defineProductConfig` — not at first use —
   when misconfigured. ([ADR-0001](./docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md))
2. **Manifest is the only source of truth.** No manifest entry → the kernel
   cannot see the asset. There is no implicit filesystem discovery.
3. **Z three-layer, enforced by test.** `index.mjs` is the only public entry;
   the layer-direction guard is `architecture.test.mjs`, not convention.
   ([ADR-0001](./docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md))

   ```text
   scripts/installer/
   ├── core/      # pure logic; never imports adapters/ or cli/
   ├── adapters/  # platform integrations; never imports cli/
   └── cli/       # surface; may import core/ and adapters/
   ```

4. **Idempotent, state-tracked, drift-aware.** `install` / `update` /
   `repair` have defined semantics over recorded on-disk state; `repair`
   re-installs only what drifted from the manifest.
   ([ADR-0008](./docs/adr/0008-unfreeze-state-dirname-rename-to-nexel.md))
5. **Decoupling discipline.** npm publication and the public-API contract
   clock are deliberately decoupled from the name decision and sequenced
   later — pre-publish internal API churn is cleanup, not a contract break.
   ([ADR-0007](./docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md))
6. **ADR-recorded trade-offs.** Hard-to-reverse, surprising decisions are
   each recorded as one file in [`docs/adr/`](./docs/adr/).

## Reference

> Lookup material — skim past unless you need a specific export, verb, or
> flag.

### Public API

`scripts/installer/index.mjs` re-exports the v1 stability contract. Adding new
exports is backward-compatible; removing or renaming is a breaking change.

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

### Adapter SPI

Three built-in adapters ship out of the box: Claude Code, Codex, OpenCode.
Downstream products supply additional adapters via
`createCli({ adapters: [...] })`. Each adapter exports the SPI v1 contract:

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

Optional fields are filled from `SPI_DEFAULTS` when omitted. Canonical
contract: [`scripts/installer/adapters/spi.mjs`](./scripts/installer/adapters/spi.mjs).
Complete worked adapter: [`scripts/installer/adapters/claude.mjs`](./scripts/installer/adapters/claude.mjs).

### Verbs & flags

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

All verbs accept `--json`. The following flags apply to the state-mutating
verbs (`install`, `uninstall`, `update`, `repair`); `plan` also accepts the
selection subset:

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

Full reference: `node examples/sample-product/bin.mjs help`, dynamically
rendered with your `productConfig.binName`. Per-verb: `<bin> <verb> --help`
or `<bin> help <verb>`.

## For AI agents

Driving a nexel-derived bin programmatically? The product-agnostic
behavioral contract — every verb, the exit-code contract, the `--json`
envelope shape, the non-interactive flags (`--yes`, `--json`), and the
help-affordance rules — is specified in
[`docs/AGENT-CLI-CONTRACT.md`](./docs/AGENT-CLI-CONTRACT.md). It is stable
kernel surface, independent of any product's bin name or content.
[`examples/sample-product/bin.mjs`](./examples/sample-product/) is a runnable
instantiation to test against.

## Project

### Status

Pre-1.0. The name is resolved (`nexel`); npm publication and the public-API
contract clock are deliberately deferred and decoupled from the name decision
(see [ADR-0007](./docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md),
superseding [ADR-0005](./docs/adr/0005-release-model-no-npm-provisional-name.md)).
The public surface is still iterating — pin a tag.

### Roadmap

- **Next** — broader test coverage against the sample fixture, locale catalog
  plug-ins, additional adapter SPI implementations. Distribution stays
  git-tag / git-dependency / vendor; npm publication remains deferred.
- **v1.0.0** — when the API has survived ≥ one downstream adopter in
  production for a full quarter.

### Tests

```sh
npm test
```

`npm test` runs the full suite; the `test` script in `package.json` is the
authoritative, always-current list. Coverage is layered: per-module unit
(`errors`, `asset-types`, `which`, `plan`, `stage-asset`, `manifest`
loader/validator/drift), adapter conformance (`spi`, `opencode`), CLI surface
(`argv`, `dispatch`, `lint-skills`, `lint-release-sync`), the Z-layer guard
(`architecture`), and `examples/sample-product/` end-to-end (`sample-bin`,
`repair-rehash`).

### License

MIT — see [LICENSE](./LICENSE).

### Contributing

Issues and PRs welcome. For non-trivial changes — new adapters, new verbs,
public API additions, or architectural shifts — open a GitHub issue first so
the direction can be aligned before implementation. Bug fixes, documentation
improvements, and additions to the sample fixture can go straight to a PR.
