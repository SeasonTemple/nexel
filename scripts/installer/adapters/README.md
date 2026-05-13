# Adapter SPI v1

Adapters are the pluggable boundary between the installer kernel and a specific Agent CLI (Claude Code, Codex, OpenCode, or any future CLI). This document is the **single source of truth** for the SPI v1 contract.

External adapter authors implement the required exports below, write zero-effect import-time code, and pass their module to `createAdapterRegistry([...adapters])` when constructing a CLI via `createCli({ adapters, productConfig })`.

## Required exports (the four-pack)

Every adapter **must** export these. `createAdapterRegistry` throws `AdapterError(ERR_ADAPTER_INVALID)` listing every missing field at registration time.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique adapter identifier (e.g., `"claude-code"`). Used as the `--agent <id>` flag value. |
| `displayName` | `string` | Human-readable name shown in banners and errors. |
| `detectTargetRoot` | `({ override, env }) => string` | Compute the absolute path where this adapter's CLI stores skills/agents/rules. Honor `override` (explicit `--target`) first, then env-var overrides (e.g., `CLAUDE_HOME`), then sensible OS default. |
| `detectStatus` | `({ override, env }) => StatusObject` | Probe the local environment. Return shape: `{ id, displayName, supportsDirect, targetRoot, exists, writable, cliBinary, cliPath, cliPresent, cliInstallUrl, notes }`. |

## Optional exports (six fields with kernel defaults)

If omitted, `createAdapterRegistry` injects the default. Adapters override only when they have specific behavior.

| Field | Kernel default | When to override |
|-------|----------------|------------------|
| `mapTargetPath(asset, manifest, productConfig)` | `defaultTargetMapping` from `core/plan.mjs` | When the CLI lays out installed files differently from the default `skills/<dirname>/`, `agents/<name>.md`, `rules/...` scheme. See `adapters/opencode.mjs` for a concrete override. |
| `supportedAssetTypes` | `["skill", "agent", "rule"]` | When the CLI cannot host one or more asset types. E.g., OpenCode skips `agent` because its agent schema is incompatible with Claude Code's frontmatter. |
| `pluginInstallInstructions()` | Returns `""` | Provide a multi-line user-facing instruction for installing this product as a plugin via the CLI's own plugin marketplace (vs `direct` mode). |
| `supportsDirect` | `false` | Set `true` if the CLI tolerates third-party files being dropped into its `targetRoot` (vs requiring a plugin-marketplace install). |
| `cliBinary` / `cliInstallUrl` | `""` / `""` | Provide so doctor / install can detect whether the agent CLI is on PATH and suggest install URL when not. |
| `doctorProbes({ targetRoot, env, productConfig })` | `() => []` | Return adapter-specific health checks as `Array<{ name, ok, detail }>`. Used by `doctor` verb output alongside generic kernel checks (target writable, state schema valid, etc.). |

## Import side-effect ban

Adapter modules **must not** perform any IO at top level:

- No `process.env` reads outside `detectTargetRoot` / `detectStatus`.
- No `whichSync` / `fs.*` / `execSync` calls at top level.
- No network requests, no logger initialization, no module-scope state.

All IO must happen inside one of the exported functions, scoped to the `{ override, env }` arguments the caller passes in. This keeps `createCli` startup deterministic, makes adapter loading order irrelevant, and prevents flaky test behavior when adapter modules are re-imported (e.g., in `architecture.test.mjs`).

`architecture.test.mjs` and `adapters/spi.test.mjs` enforce this rule via load-order sensitivity tests.

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

- **Minor versions** add new **optional** fields only. Existing adapters continue to work without changes; the kernel provides defaults.
- **Major versions** may add new **required** fields. Existing adapters must update.
- ERR codes referenced here (`ERR_ADAPTER_INVALID`, `ERR_ADAPTER_ID_COLLISION`, `ERR_NO_ADAPTERS`, `ERR_UNKNOWN_ADAPTER`, `ERR_DIRECT_UNSUPPORTED`, `ERR_AGENT_CLI_MISSING`) are part of the public stability contract — their string values do not change between minor versions.

## What the SPI deliberately does NOT include (yet)

The following methods are **not** currently part of the SPI. They are reserved for the day a concrete adapter has a real need to implement them, at which point they will be added as optional exports with kernel defaults (per the minor-version evolution policy).

- `installPlugin?` — execute a plugin install via the CLI's own plugin marketplace
- `uninstallPlugin?` — symmetric uninstall
- `verifyAssetLoaded?(asset, ...)` — verify the agent CLI actually picked up an installed asset (post-install reality check)
- `discoverInstalled?({ targetRoot, env, ... })` — reverse scan: what does the agent CLI actually have installed right now

The grilling around plan Unit 4 deliberately chose **not** to preemptively declare these as optional placeholders. Declaring SPI surface area with no concrete consumer is documentation debt without behavior to validate it against.
