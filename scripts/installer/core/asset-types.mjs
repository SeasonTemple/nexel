// Centralized asset type metadata.
//
// Adding a fourth asset type (e.g., "mcp-config", "prompt-template") = edit
// this file and add a manifest schema enum entry. No runtime registration
// API is exposed — that abstraction is YAGNI until a real runtime-extensible
// asset type emerges. See plan Unit 2 + debt #5.
//
// Each entry currently declares only the source→target path mapping. Future
// units may add `sourceWalk`, `hashStrategy`, `resolveInstalledName` as
// pipeline (Unit 5) and ProductConfig (Unit 8) wiring lands. Keep the
// surface narrow — only fields with concrete callers are exposed.

import path from "node:path";

/**
 * @typedef {Object} AssetType
 * @property {string} id - "skill" | "agent" | "rule" | future
 * @property {(asset, manifest) => string} defaultTargetMap
 *   Compute the relPath under targetRoot for a given asset. Mirrors the
 *   previous inline `defaultTargetMapping` in plan.mjs:70-83.
 */

/** @type {Record<string, AssetType>} */
export const assetTypes = Object.freeze({
  skill: Object.freeze({
    id: "skill",
    defaultTargetMap(asset /*, manifest */) {
      return path.posix.join("skills", asset.skillDirname, asset.relSourcePath);
    },
  }),
  agent: Object.freeze({
    id: "agent",
    defaultTargetMap(asset, manifest) {
      return path.posix.join("agents", manifest.agents[asset.id].installedName + ".md");
    },
  }),
  rule: Object.freeze({
    id: "rule",
    defaultTargetMap(asset /*, manifest */) {
      return asset.id;
    },
  }),
});

/**
 * Convenience accessor. Returns the AssetType entry or null if unknown.
 * Callers (e.g., `defaultTargetMapping` in plan.mjs) decide how to handle
 * an unknown type (typically throw with ERR_ASSET_TYPE).
 */
export function getAssetType(typeId) {
  return Object.prototype.hasOwnProperty.call(assetTypes, typeId)
    ? assetTypes[typeId]
    : null;
}
