import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultTargetMapping } from "../core/plan.mjs";
import { whichSync } from "../core/which.mjs";

export const id = "codex";
export const displayName = "Codex";
export const supportsDirect = true;
export const cliBinary = "codex";
export const cliInstallUrl = "https://github.com/openai/codex";
export const supportedAssetTypes = ["skill", "agent", "rule"];

export function detectTargetRoot({ override, env = process.env } = {}) {
  if (override) return path.resolve(override);
  if (env.CODEX_HOME) return path.resolve(env.CODEX_HOME);
  return path.join(os.homedir(), ".codex");
}

export function detectStatus({ override, env = process.env } = {}) {
  const root = detectTargetRoot({ override, env });
  const exists = fs.existsSync(root);
  const writable = exists ? canWriteTo(root) : canCreateAt(root);
  const cliPath = whichSync(cliBinary, { env });
  return {
    id,
    displayName,
    supportsDirect,
    targetRoot: root,
    exists,
    writable,
    cliBinary,
    cliPath,
    cliPresent: cliPath !== null,
    cliInstallUrl,
    notes: exists ? "Codex home detected" : "Codex home not present; would be created on first install",
  };
}

export function mapTargetPath(asset, manifest) {
  return defaultTargetMapping(manifest)(asset);
}

// SPI v1.2 — see claude.mjs for the contract notes.
export function pluginInstallInstructions(productConfig) {
  if (!productConfig?.repositoryUrl) {
    return [
      "Codex plugin install unavailable — ProductConfig is missing `repositoryUrl`.",
      "Add `repositoryUrl: \"https://...\"` to your agent-skills.config.mjs to enable plugin instructions.",
    ].join("\n");
  }
  // defineProductConfig eager-normalizes pluginName + marketplaceName.
  const { productName, pluginName, marketplaceName } = productConfig;
  return [
    `Codex plugin install for ${productName} (recommended for full bundle):`,
    `  1. Run: codex plugin marketplace add ${productConfig.repositoryUrl}`,
    `  2. Run: codex plugin install ${pluginName}@${marketplaceName}`,
    "Note: plugin install delivers skill content only.",
    "      Use direct mode if you need agents/ or rules/ alongside skills.",
  ].join("\n");
}

function canWriteTo(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function canCreateAt(dir) {
  let cur = dir;
  while (cur && cur !== path.dirname(cur)) {
    if (fs.existsSync(cur)) return canWriteTo(cur);
    cur = path.dirname(cur);
  }
  return false;
}
