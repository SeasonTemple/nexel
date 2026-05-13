import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultTargetMapping } from "../core/plan.mjs";
import { whichSync } from "../core/which.mjs";

export const id = "claude-code";
export const displayName = "Claude Code";
export const supportsDirect = true;
export const cliBinary = "claude";
export const cliInstallUrl = "https://docs.claude.com/claude-code";
export const supportedAssetTypes = ["skill", "agent", "rule"];

export function detectTargetRoot({ override, env = process.env } = {}) {
  if (override) return path.resolve(override);
  if (env.CLAUDE_HOME) return path.resolve(env.CLAUDE_HOME);
  return path.join(os.homedir(), ".claude");
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
    notes: exists ? "Claude Code home detected" : "Claude Code home not present; would be created on first install",
  };
}

export function mapTargetPath(asset, manifest) {
  return defaultTargetMapping(manifest)(asset);
}

export function pluginInstallInstructions() {
  return [
    "Claude Code plugin install (recommended for full bundle):",
    "  1. In Claude Code, run: /install-plugin",
    "  2. Select marketplace source: your product's marketplace.json",
    "  3. Select the plugin name your product publishes",
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
