# Adapter SPI v1.3

Adapters are the pluggable boundary between the installer kernel and a specific Agent CLI (Claude Code, Codex, OpenCode, or any future CLI). This document is the **single source of truth** for the SPI v1.3 contract.

**v1.1 (additive)** — adds the optional `transformAssetContent` hook for per-CLI content rewriting (e.g. frontmatter translation). Identity default; existing adapters work unchanged.
**v1.2 (additive)** — widens `pluginInstallInstructions` to receive `productConfig` (old `() => string` adapters stay forward-compatible). See ADR-0010.
**v1.3 (additive)** — adds the optional `contentPipeline` (ordered, stackable content transforms). A declared single `transformAssetContent` auto-promotes to a 1-stage pipeline, so existing adapters work unchanged. See ADR-0020.

External adapter authors implement the required exports below, write zero-effect import-time code, and pass their module to `createAdapterRegistry([...adapters])` when constructing a CLI via `createCli({ adapters, productConfig })`.

## Required exports (the four-pack)

Every adapter **must** export these. `createAdapterRegistry` throws `AdapterError(ERR_ADAPTER_INVALID)` listing every missing field at registration time.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique adapter identifier (e.g., `"claude-code"`). Used as the `--agent <id>` flag value. |
| `displayName` | `string` | Human-readable name shown in banners and errors. |
| `detectTargetRoot` | `({ override, env }) => string` | Compute the absolute path where this adapter's CLI stores skills/agents/rules. Honor `override` (explicit `--target`) first, then env-var overrides (e.g., `CLAUDE_HOME`), then sensible OS default. |
| `detectStatus` | `({ override, env }) => StatusObject` | Probe the local environment. Return shape: `{ id, displayName, supportsDirect, targetRoot, exists, writable, cliBinary, cliPath, cliPresent, cliInstallUrl, notes }`. |

## Optional exports (nine fields with kernel defaults)

If omitted, `createAdapterRegistry` injects the default. Adapters override only when they have specific behavior.

| Field | Kernel default | When to override |
|-------|----------------|------------------|
| `mapTargetPath(asset, manifest, productConfig)` | `defaultTargetMapping` from `core/plan.mjs` | When the CLI lays out installed files differently from the default `skills/<dirname>/`, `agents/<name>.md`, `rules/...` scheme. See `adapters/opencode.mjs` for a concrete override. |
| `supportedAssetTypes` | `["skill", "agent", "rule"]` | When the CLI cannot host one or more asset types. (OpenCode hosts all three: its `agent` frontmatter is translated via `transformAssetContent` — see ADR-0002 D4 for the tool-restriction divergence that translation accepts.) |
| `pluginInstallInstructions()` | Returns `""` | Provide a multi-line user-facing instruction for installing this product as a plugin via the CLI's own plugin marketplace (vs `direct` mode). |
| `supportsDirect` | `false` | Set `true` if the CLI tolerates third-party files being dropped into its `targetRoot` (vs requiring a plugin-marketplace install). |
| `cliBinary` / `cliInstallUrl` | `""` / `""` | Provide so doctor / install can detect whether the agent CLI is on PATH and suggest install URL when not. |
| `doctorProbes({ targetRoot, env, productConfig })` | `() => []` | Return adapter-specific health checks as `Array<{ name, ok, detail }>`. Used by `doctor` verb output alongside generic kernel checks (target writable, state schema valid, etc.). |
| `transformAssetContent(asset, body)` *(v1.1)* | `(asset, body) => body` (identity, returns the **input Buffer unchanged** — reference equality is observed by the kernel's `transformed` flag) | When the target CLI's on-disk shape diverges from the source. Receives `{ assetType, id, sourceRelPath }` and a UTF-8 `Buffer`; must return a `Buffer`. MUST be pure (no env reads, no IO). A throw or non-Buffer return surfaces as `AdapterError(ERR_TRANSFORM_FAILED)`. See `adapters/opencode.mjs` (Claude→OpenCode agent frontmatter) and ADR-0002. **Declaring this AND a non-empty `contentPipeline` is a construction-time error** — use one or the other. |
| `contentPipeline` *(v1.3)* | `[]` (frozen empty — identity) | Ordered, stackable content transforms: `Array<{ id, run }>`. Use when you need to compose more than one transform. See the `contentPipeline` section below. |

## `contentPipeline` *(v1.3)*

An ordered array of stages, each `{ id: string, run: (asset, body: Buffer) => Buffer }`. Stages run in declared order, threading the Buffer from one stage's output into the next stage's input. Each `run` carries the **exact** `transformAssetContent` contract: pure (no env reads, no IO), and identity stages return the **input Buffer by reference** so the kernel's `transformed` flag (reference equality) stays correct.

```js
export const contentPipeline = [
  { id: "prefix-rewrite", run: (asset, body) => /* return a new Buffer */ },
  { id: "annotate",       run: (asset, body) => /* return a new Buffer */ },
];
```

Rules:

- **Auto-promotion.** Declaring a single `transformAssetContent` is equivalent to a 1-stage pipeline — the kernel resolves it to `[{ id: "transformAssetContent", run: <hook> }]` at registry build. Existing v1.1/v1.2 adapters need no change.
- **Mutual exclusion.** Declaring a non-empty `contentPipeline` AND a `transformAssetContent` hook is a construction-time error (`AdapterError(ERR_ADAPTER_INVALID)`). Pick one.
- **Read-only Buffer.** A stage's `run` receives the threaded Buffer as **read-only**. Return a new Buffer (or the input by reference for identity). In-place mutation that returns the same reference is undefined behavior: it defeats the `transformed` flag and can desync staged bytes from the recorded hash.
- **Pure across invocations.** A stage MUST return the same bytes for the same input every time — no counters/closure state threaded across calls, no `Date.now()`, no randomness. The kernel runs the pipeline twice per asset (once to hash the dry-run plan, once to stage to disk); a stage that returns different bytes per invocation makes the plan preview hash diverge from what is actually written. The recorded `state.json` hash uses the staged bytes (so tamper-detection stays correct), but the dry-run plan would lie. This is stronger than "no in-place mutation."
- **Bounded output.** Stages thread Buffers with no kernel-imposed size ceiling; a pipeline that grows content multiplicatively across stages can exhaust memory during staging. Keep per-stage output proportional to input.
- **Sync only.** Stages are synchronous. The staging path is synchronous end to end; async stages are out of scope for v1.3.
- **Stage `id`s** must be non-empty and unique within the pipeline. A failing stage surfaces `AdapterError(ERR_TRANSFORM_FAILED)` with `.details.stageId` naming the stage.

Out of scope for v1.3 (deliberate, may arrive in a later minor): `when` phase tagging (`plan` / `stage` / `lint`), async stages, lint-as-a-stage, and a self-improve hook. See ADR-0020.

## Import side-effect ban

Adapter modules **must not** perform any IO at top level:

- No `process.env` reads outside `detectTargetRoot` / `detectStatus`.
- No `whichSync` / `fs.*` / `execSync` calls at top level.
- No network requests, no logger initialization, no module-scope state.

All IO must happen inside one of the exported functions, scoped to the `{ override, env }` arguments the caller passes in. This keeps `createCli` startup deterministic, makes adapter loading order irrelevant, and prevents flaky test behavior when adapter modules are re-imported (e.g., in `architecture.test.mjs`).

`architecture.test.mjs` and `adapters/spi.test.mjs` enforce this rule via load-order sensitivity tests.

## OpenCode direct install vs plugin runtime

OpenCode has two separate seams:

- **Direct install** uses the Adapter SPI in this document. The OpenCode
  adapter maps skills to `skills/`, agents to `agent/` with frontmatter
  translation, and rule reference files to their declared paths. Its
  `transformAssetContent` hook remains pure and direct-install only: no env
  reads, no filesystem discovery, and no mutation of OpenCode runtime config.
- **Plugin Runtime** runs inside an OpenCode plugin after product files are
  present. Products import the public subpath
  `nexel/adapters/opencode-plugin` and call `configureOpenCode(config,
  skillsDir)`. That helper adds `skillsDir` to `config.skills.paths` and
  appends skill-declared `opencode-instructions` files to
  `config.instructions`.

`opencode-instructions` is **Skill Metadata** in `SKILL.md` frontmatter. It is
not a Manifest field, not an Asset, and not part of Adapter SPI v1.1.
Instruction files stay inside their declaring skill directory and are consumed
only by OpenCode plugin runtime. The Kernel core does not know OpenCode.

## Minimal adapter template

```js
// my-agent-adapter.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { whichSync } from "agent-skills-installer"; // or wherever the kernel lives

export const id = "my-agent";
export const displayName = "MyAgent";
export const supportsDirect = true;
export const cliBinary = "myagent";
export const cliInstallUrl = "https://myagent.example/install";
export const supportedAssetTypes = ["skill", "rule"];

export function detectTargetRoot({ override, env = process.env } = {}) {
  if (override) return path.resolve(override);
  if (env.MYAGENT_HOME) return path.resolve(env.MYAGENT_HOME);
  return path.join(os.homedir(), ".myagent");
}

export function detectStatus({ override, env = process.env } = {}) {
  const targetRoot = detectTargetRoot({ override, env });
  const exists = fs.existsSync(targetRoot);
  const cliPath = whichSync(cliBinary, { env });
  return {
    id, displayName, supportsDirect,
    targetRoot, exists,
    writable: exists, // simplified — real adapters should test write permission
    cliBinary, cliPath,
    cliPresent: cliPath !== null,
    cliInstallUrl,
    notes: exists ? "MyAgent home detected" : "MyAgent home not present; will be created",
  };
}

// Optional — only declare if MyAgent has product-specific health probes
export function doctorProbes({ targetRoot, env, productConfig }) {
  return [
    // { name: "myagent-config-valid", ok: true, detail: "config parses" }
  ];
}

export function pluginInstallInstructions() {
  return "Run: myagent plugin install <package>";
}
```

## SPI evolution policy

- **Minor versions** add new **optional** fields only. Existing adapters continue to work without changes; the kernel provides defaults. (v1.1 added `transformAssetContent`; v1.2 widened `pluginInstallInstructions`; v1.3 added `contentPipeline`.)
- **Major versions** may add new **required** fields. Existing adapters must update.
- ERR codes referenced here (`ERR_ADAPTER_INVALID`, `ERR_ADAPTER_ID_COLLISION`, `ERR_NO_ADAPTERS`, `ERR_UNKNOWN_ADAPTER`, `ERR_DIRECT_UNSUPPORTED`, `ERR_AGENT_CLI_MISSING`, `ERR_TRANSFORM_FAILED`) are part of the public stability contract — their string values do not change between minor versions.

### Pre-1.0 minor-bump removal allowance

Forward hygiene for the eventual first publish (the kernel is currently unpublished — see ADR-0005). A public symbol or contract-bound ERR code MAY be removed in a pre-1.0 **minor** bump only when **all three** hold:

1. it has zero non-test, non-re-export runtime consumers in-repo (verified by grep);
2. no code path documents it as a thrown/returned contract;
3. the release note carries a Breaking Changes section disclosing the removal with migration guidance.

This allowance exists so the policy is in place *when* publishing starts; it is not a precondition for pre-publish internal cleanup (which is not a contract break — there is no published contract yet).

## What the SPI deliberately does NOT include (yet)

The following methods are **not** currently part of the SPI. They are reserved for the day a concrete adapter has a real need to implement them, at which point they will be added as optional exports with kernel defaults (per the minor-version evolution policy).

- `installPlugin?` — execute a plugin install via the CLI's own plugin marketplace
- `uninstallPlugin?` — symmetric uninstall
- `verifyAssetLoaded?(asset, ...)` — verify the agent CLI actually picked up an installed asset (post-install reality check)
- `discoverInstalled?({ targetRoot, env, ... })` — reverse scan: what does the agent CLI actually have installed right now

The grilling around plan Unit 4 deliberately chose **not** to preemptively declare these as optional placeholders. Declaring SPI surface area with no concrete consumer is documentation debt without behavior to validate it against.
