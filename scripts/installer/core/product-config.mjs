// ProductConfig — brand-identity + path/env config that scopes the installer
// kernel to a specific product (a team skills catalog, a personal toolset, etc.).
//
// Required identity fields (frozen in Adapter SPI v1):
//   - productName, skillIdPrefix, agentNamePrefix, defaultManifestFile, binName
//
// Optional fields (kernel-provided defaults; future-additive policy):
//   - defaultSkillsDir / defaultAgentsDir / defaultRulesDir
//   - targetPathLayout
//   - envProfile / envBannerTitle
//   - envLocale
//
// `defineProductConfig({...})` is the canonical constructor. It:
//   - Rejects missing required fields with ERR_INVALID_PRODUCT_CONFIG, listing
//     every missing field (not just the first — surface all gaps in one shot).
//   - Validates `skillIdPrefix` does not contain ":" (prevents double-colon
//     skill ids like "my::foo").
//   - Validates `agentNamePrefix` ends with "-".
//   - Fills optional fields with kernel defaults when omitted.
//
// Most kernel-internal callers accept productConfig as an options-bag field
// and forward it down the chain. Callers that omit productConfig get the
// generic kernel defaults documented in loader.mjs / validator.mjs.

import {
  ERR_INVALID_PRODUCT_CONFIG,
  ProductConfigError,
} from "./errors.mjs";

/**
 * @typedef {Object} ProductConfig
 * @property {string} productName
 * @property {string} skillIdPrefix
 * @property {string} agentNamePrefix
 * @property {string} defaultManifestFile
 * @property {string} binName
 * @property {string} defaultSkillsDir
 * @property {string} defaultAgentsDir
 * @property {string} defaultRulesDir
 * @property {{ skills: string, agents: string }} targetPathLayout
 * @property {string|undefined} envProfile
 * @property {string|undefined} envBannerTitle
 * @property {string|undefined} envLocale
 */

const REQUIRED_FIELDS = Object.freeze([
  "productName",
  "skillIdPrefix",
  "agentNamePrefix",
  "defaultManifestFile",
  "binName",
]);

const OPTIONAL_DEFAULTS = Object.freeze({
  defaultSkillsDir: "skills",
  defaultAgentsDir: "agents",
  defaultRulesDir: "rules",
  targetPathLayout: Object.freeze({ skills: "skills", agents: "agents" }),
  envProfile: undefined,
  envBannerTitle: undefined,
  envLocale: undefined,
});

/**
 * Construct a validated ProductConfig from a raw overrides object.
 * Throws ProductConfigError(ERR_INVALID_PRODUCT_CONFIG) on validation failure.
 *
 * Missing-field error reports ALL missing fields (not just the first).
 *
 * @param {Partial<ProductConfig>} overrides
 * @returns {ProductConfig}
 */
export function defineProductConfig(overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new ProductConfigError(
      "productConfig overrides must be an object",
      ERR_INVALID_PRODUCT_CONFIG,
      { received: overrides }
    );
  }

  const missing = [];
  const malformed = [];

  for (const field of REQUIRED_FIELDS) {
    const v = overrides[field];
    if (v === undefined || v === null || v === "") {
      missing.push(field);
    } else if (typeof v !== "string") {
      malformed.push({ field, reason: "must be a non-empty string" });
    }
  }

  if (missing.length > 0 || malformed.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing required field(s): ${missing.join(", ")}`);
    if (malformed.length > 0) {
      parts.push(
        `malformed field(s): ${malformed.map((m) => `${m.field} (${m.reason})`).join(", ")}`
      );
    }
    throw new ProductConfigError(parts.join("; "), ERR_INVALID_PRODUCT_CONFIG, {
      missing,
      malformed,
    });
  }

  // Identity-field semantic checks.
  if (overrides.skillIdPrefix.includes(":")) {
    throw new ProductConfigError(
      `skillIdPrefix must not contain ":" (got "${overrides.skillIdPrefix}")`,
      ERR_INVALID_PRODUCT_CONFIG,
      { field: "skillIdPrefix" }
    );
  }
  if (!overrides.agentNamePrefix.endsWith("-")) {
    throw new ProductConfigError(
      `agentNamePrefix must end with "-" (got "${overrides.agentNamePrefix}")`,
      ERR_INVALID_PRODUCT_CONFIG,
      { field: "agentNamePrefix" }
    );
  }

  // Required identity passes. Fill optional fields.
  return Object.freeze({
    productName: overrides.productName,
    skillIdPrefix: overrides.skillIdPrefix,
    agentNamePrefix: overrides.agentNamePrefix,
    defaultManifestFile: overrides.defaultManifestFile,
    binName: overrides.binName,
    defaultSkillsDir: overrides.defaultSkillsDir ?? OPTIONAL_DEFAULTS.defaultSkillsDir,
    defaultAgentsDir: overrides.defaultAgentsDir ?? OPTIONAL_DEFAULTS.defaultAgentsDir,
    defaultRulesDir: overrides.defaultRulesDir ?? OPTIONAL_DEFAULTS.defaultRulesDir,
    targetPathLayout: Object.freeze({
      skills: overrides.targetPathLayout?.skills ?? OPTIONAL_DEFAULTS.targetPathLayout.skills,
      agents: overrides.targetPathLayout?.agents ?? OPTIONAL_DEFAULTS.targetPathLayout.agents,
    }),
    envProfile: overrides.envProfile ?? OPTIONAL_DEFAULTS.envProfile,
    envBannerTitle: overrides.envBannerTitle ?? OPTIONAL_DEFAULTS.envBannerTitle,
    envLocale: overrides.envLocale ?? OPTIONAL_DEFAULTS.envLocale,
  });
}

export { REQUIRED_FIELDS, OPTIONAL_DEFAULTS };
