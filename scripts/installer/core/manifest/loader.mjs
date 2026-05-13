// Manifest loader — JSON IO + path resolution. No validation logic.

import fs from "node:fs";
import path from "node:path";

// Generic kernel defaults applied when a ProductConfig leaves the
// corresponding optional field undefined. Downstream products that
// want full control supply every field via defineProductConfig().
const KERNEL_DEFAULTS = Object.freeze({
  defaultManifestFile: "install.json",
  defaultSkillsDir: "skills",
  defaultAgentsDir: "agents",
  defaultRulesDir: "rules",
});

export function stripBom(s) {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function loadManifest(manifestPath) {
  const text = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(stripBom(text));
}

/**
 * Resolve the manifest file path. Reads productConfig.defaultManifestFile
 * when provided; otherwise falls back to the generic kernel default
 * "install.json".
 *
 * @param {string} repoRoot
 * @param {{defaultManifestFile?: string} | undefined} [productConfig]
 * @returns {string} absolute manifest path
 */
export function defaultManifestPath(repoRoot, productConfig) {
  const file = productConfig?.defaultManifestFile ?? KERNEL_DEFAULTS.defaultManifestFile;
  return path.join(repoRoot, file);
}

/**
 * Resolve all canonical asset directory paths. Reads productConfig's
 * defaultSkillsDir / defaultAgentsDir / defaultRulesDir fields when provided;
 * otherwise falls back to generic kernel defaults.
 *
 * @param {string} repoRoot
 * @param {{defaultSkillsDir?: string, defaultAgentsDir?: string, defaultRulesDir?: string, defaultManifestFile?: string} | undefined} [productConfig]
 * @returns {{repoRoot: string, skillsDirAbs: string, agentsDirAbs: string, rulesDirAbs: string, manifestPath: string}}
 */
export function defaultPaths(repoRoot, productConfig) {
  const skillsDir = productConfig?.defaultSkillsDir ?? KERNEL_DEFAULTS.defaultSkillsDir;
  const agentsDir = productConfig?.defaultAgentsDir ?? KERNEL_DEFAULTS.defaultAgentsDir;
  const rulesDir = productConfig?.defaultRulesDir ?? KERNEL_DEFAULTS.defaultRulesDir;
  return {
    repoRoot,
    skillsDirAbs: path.join(repoRoot, skillsDir),
    agentsDirAbs: path.join(repoRoot, agentsDir),
    rulesDirAbs: path.join(repoRoot, rulesDir),
    manifestPath: defaultManifestPath(repoRoot, productConfig),
  };
}
