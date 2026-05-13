import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { whichSync } from "../core/which.mjs";
import { ERR_ASSET_TYPE } from "../core/errors.mjs";

export const id = "opencode";
export const displayName = "OpenCode";
export const supportsDirect = true;
export const cliBinary = "opencode";
export const cliInstallUrl = "https://opencode.ai";
// Asset support note:
// - skill: ✓ — opencode auto-discovers SKILL.md
// - rule:  ✓ — reference files cited by skills via relative paths (NOT
//   loaded via OpenCode's AGENTS.md ambient mechanism, which we deliberately
//   don't use)
// - agent: ✗ — our agents/*.md use Claude Code frontmatter (tools array,
//   model: "sonnet", Claude-specific tool names). OpenCode reads
//   ~/.config/opencode/agent/*.md at startup and validates against its OWN
//   schema (model: "<provider>/<id>", tools: {…}, mode: subagent|primary,
//   permission: {…}). Mismatch raises ConfigInvalidError on opencode boot.
//   We skip agent install on opencode and surface the skipped count in the
//   plan; users still get the agents on claude-code/codex.
export const supportedAssetTypes = ["skill", "rule"];

export function detectTargetRoot({ override, env = process.env } = {}) {
  if (override) return path.resolve(override);
  if (env.OPENCODE_CONFIG_DIR) return path.resolve(env.OPENCODE_CONFIG_DIR);
  const xdg = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdg, "opencode");
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
    notes: exists
      ? "OpenCode global config detected. Direct install writes skills/ and rules/. Subagents are skipped (Claude Code frontmatter incompatible with OpenCode's agent schema)."
      : "OpenCode global config not present; would be created on first install",
  };
}

export function mapTargetPath(asset, manifest) {
  if (asset.assetType === "skill") {
    return path.posix.join("skills", asset.skillDirname, asset.relSourcePath);
  }
  if (asset.assetType === "agent") {
    return path.posix.join("agent", manifest.agents[asset.id].installedName + ".md");
  }
  if (asset.assetType === "rule") {
    // Rules are reference files cited by skill prompts via relative paths.
    // Same target layout as claude/codex — file lives on disk; no ambient
    // loader involved. AGENTS.md is OpenCode's always-on mechanism and is
    // intentionally not touched here.
    return asset.id;
  }
  const e = new Error(`unsupported asset type for opencode adapter: ${asset.assetType}`);
  e.code = ERR_ASSET_TYPE;
  throw e;
}

export function pluginInstallInstructions() {
  return [
    "OpenCode plugin install (alternative to direct mode):",
    "  Add to your opencode.json:",
    "    {",
    "      \"plugins\": {",
    "        \"<your-product-name>\": {",
    "          \"git\": \"<your-product-git-url>\"",
    "        }",
    "      }",
    "    }",
    "Note: direct mode also installs rule reference files (cited by skills",
    "      via relative paths). AGENTS.md is never modified.",
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
