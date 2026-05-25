import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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
// - agent: ✓ (SPI v1.1) — installed via transformAssetContent, which
//   rewrites the Claude Code agent frontmatter into OpenCode's agent schema.
//   Claude agents declare `tools:` as an ARRAY allowlist; OpenCode's schema
//   uses `tools: {…}` (object allow/deny) + `permission: {…}` + `mode`.
//   The shapes are not losslessly mappable, and OpenCode's startup validator
//   rejects Claude's shape (ConfigInvalidError). Investigated (grill Q5):
//   OpenCode has no per-agent ARRAY tool-allowlist equivalent that survives
//   its validator, so `tools:` is DROPPED (a partial/incorrect object map is
//   worse than a documented divergence). Consequence: an agent restricted on
//   Claude/Codex runs at OpenCode's DEFAULT subagent tool access — a named,
//   accepted capability divergence (ADR-0002 D4), surfaced by the
//   tool-posture test, revisitable if OpenCode adds an array-allowlist field.
export const supportedAssetTypes = ["skill", "agent", "rule"];

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
      ? "OpenCode global config detected. Direct install writes skills/, rules/, and agents (frontmatter translated to OpenCode's schema; per-agent tool restrictions do not survive — see ADR-0002 D4)."
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

// SPI v1.2 — see claude.mjs for the contract notes.
export function pluginInstallInstructions(productConfig) {
  if (!productConfig?.repositoryUrl) {
    return [
      "OpenCode plugin install unavailable — ProductConfig is missing `repositoryUrl`.",
      "Add `repositoryUrl: \"https://...\"` to your agent-skills.config.mjs to enable plugin instructions.",
    ].join("\n");
  }
  const productName = productConfig.productName;
  return [
    `OpenCode plugin install for ${productName} (alternative to direct mode):`,
    `  1. git clone --depth 1 ${productConfig.repositoryUrl} <plugin-dir>`,
    `  2. opencode plugin "<plugin-dir>" --global --force`,
    "Note: direct mode also installs rule reference files (cited by skills",
    "      via relative paths). AGENTS.md is never modified.",
  ].join("\n");
}

// ---------- SPI v1.1 transformAssetContent (ADR-0002) ----------
//
// Translate Claude Code agent frontmatter into OpenCode's agent schema:
// emit only { description, mode: "subagent" }; drop tools/model/color.
// Body bytes pass through UNCHANGED (ADR-0002 D3 — no body rewriting).
// Identity for skill / rule (their on-disk shapes already match OpenCode).
// MUST be pure (no env reads, no IO) per the SPI import side-effect ban.
//
// Why mode is always "subagent": Claude Code dispatches every agent via the
// Task tool (subagent role by construction); OpenCode's `mode: subagent` is
// the equivalent. model/color are dropped so OpenCode subagents inherit the
// parent session's provider (avoids ProviderModelNotFoundError). tools: is
// dropped — see the supportedAssetTypes note + ADR-0002 D4.
export function transformAssetContent(asset, body) {
  if (asset.assetType !== "agent") return body; // identity for skill/rule

  const text = body.toString("utf8");
  const fm = splitFrontmatter(text);
  if (!fm) return body; // no leading --- block; leave untouched

  let parsed;
  try {
    parsed = parseYaml(fm.yaml) ?? {};
  } catch {
    // Malformed YAML: pass through. It surfaces as ConfigInvalidError at
    // OpenCode boot — a real source problem, not masked by the adapter.
    return body;
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) return body;

  // Fail-fast on source defect: a missing/empty description would emit a
  // mute-but-valid degraded agent. Throw at install time so the user fixes
  // the source. applyAdapterTransform wraps this as
  // AdapterError(ERR_TRANSFORM_FAILED) with the adapter/asset/stage details.
  if (typeof parsed.description !== "string" || parsed.description.trim() === "") {
    const reason = parsed.description === undefined
      ? "missing `description` field"
      : `\`description\` must be a non-empty string (got ${typeof parsed.description})`;
    const err = new Error(`opencode: agent frontmatter ${reason} (${asset.id})`);
    err.code = "ERR_OPENCODE_AGENT_FRONTMATTER";
    throw err;
  }

  const out = { description: parsed.description, mode: "subagent" };
  const yamlOut = stringifyYaml(out);
  return Buffer.from(`---\n${yamlOut}---\n${fm.body}`, "utf8");
}

// Split a leading `---\n … \n---\n` YAML frontmatter block. Returns
// { yaml, body } or null when there is no well-formed leading block.
function splitFrontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return null;
  return {
    yaml: text.slice(4, end + 1),
    body: text.slice(end + 5),
  };
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
