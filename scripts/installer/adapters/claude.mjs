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

// SPI v1.2: accepts productConfig and interpolates productName / pluginName /
// marketplaceName / repositoryUrl into the rendered text. Lazy-validates
// `repositoryUrl` — missing field returns an actionable error string rather
// than a misleading placeholder so the user fixes the config, not the
// rendered output.
export function pluginInstallInstructions(productConfig) {
  if (!productConfig?.repositoryUrl) {
    return [
      "Claude Code plugin install unavailable — ProductConfig is missing `repositoryUrl`.",
      "Add `repositoryUrl: \"https://...\"` to your agent-skills.config.mjs to enable plugin instructions.",
    ].join("\n");
  }
  const productName = productConfig.productName;
  const pluginName = productConfig.pluginName ?? productName;
  const marketplaceName = productConfig.marketplaceName ?? `${productName}-marketplace`;
  return [
    `Claude Code plugin install for ${productName} (recommended for full bundle):`,
    `  1. Run: claude plugin marketplace add ${productConfig.repositoryUrl}`,
    `  2. Run: claude plugin install ${pluginName}@${marketplaceName}`,
    `  3. Refresh: claude plugin marketplace update ${marketplaceName}`,
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
