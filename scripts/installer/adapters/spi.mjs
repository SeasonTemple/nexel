// Adapter SPI v1 contract — single source of truth.
//
// Required-4 fields (every adapter must export these):
//   id            : string         unique identifier
//   displayName   : string         user-visible name (banner / errors)
//   detectTargetRoot : ({override, env}) => string   target dir on this OS
//   detectStatus  : ({override, env}) => StatusObject
//
// Optional-6 fields (kernel-provided defaults when missing):
//   mapTargetPath              : (asset, manifest, productConfig) => relPath
//   supportedAssetTypes        : ["skill", "agent", "rule"] subset
//   pluginInstallInstructions  : () => string
//   supportsDirect             : boolean
//   cliBinary                  : string ("" = skip CLI presence check)
//   cliInstallUrl              : string
//   doctorProbes               : ({targetRoot, env, productConfig}) =>
//                                  Array<{name, ok, detail}>
//
// SPI evolution policy:
//   - Minor versions: only add NEW optional fields with kernel defaults.
//     Existing adapters continue to work.
//   - Major versions: may add new REQUIRED fields. Existing adapters must
//     update to declare them.
//   - String values of ERR_ADAPTER_INVALID / ERR_ADAPTER_ID_COLLISION /
//     ERR_NO_ADAPTERS are part of the public stability contract.
//
// Import side-effect ban (enforced by spi.test.mjs):
//   Adapter modules must NOT perform any IO (env reads, whichSync calls,
//   filesystem operations) at top level. All IO belongs inside detectStatus
//   / detectTargetRoot / mapTargetPath. This keeps `createCli` startup
//   deterministic and makes adapter loading order irrelevant.

import path from "node:path";

import { defaultTargetMapping } from "../core/plan.mjs";
import {
  AdapterError,
  ERR_ADAPTER_INVALID,
  ERR_ADAPTER_ID_COLLISION,
  ERR_NO_ADAPTERS,
  ERR_UNKNOWN_ADAPTER,
  ERR_DIRECT_UNSUPPORTED,
  ERR_AGENT_CLI_MISSING,
} from "../core/errors.mjs";

export const SPI_REQUIRED = Object.freeze([
  "id",
  "displayName",
  "detectTargetRoot",
  "detectStatus",
]);

const FUNCTION_REQUIRED = new Set(["detectTargetRoot", "detectStatus"]);

/**
 * Kernel-provided defaults for optional adapter exports. When an adapter
 * does not provide one of these, `createAdapterRegistry` injects the
 * default so downstream callers can rely on the field being defined.
 */
export const SPI_DEFAULTS = Object.freeze({
  mapTargetPath: (asset, manifest /*, productConfig */) => defaultTargetMapping(manifest)(asset),
  supportedAssetTypes: Object.freeze(["skill", "agent", "rule"]),
  pluginInstallInstructions: () => "",
  supportsDirect: false,
  cliBinary: "",
  cliInstallUrl: "",
  doctorProbes: () => [],
});

const OPTIONAL_FIELDS = Object.freeze(Object.keys(SPI_DEFAULTS));

/**
 * Validate that the given adapter object exports the SPI required-4 fields.
 * Throws AdapterError(ERR_ADAPTER_INVALID) listing EVERY missing field
 * (not just the first), with adapter identity if recoverable.
 *
 * @returns {void}
 */
export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new AdapterError(
      `adapter must be an object (got ${adapter === null ? "null" : typeof adapter})`,
      ERR_ADAPTER_INVALID,
      { adapter }
    );
  }
  const missing = [];
  const malformed = [];
  for (const field of SPI_REQUIRED) {
    const v = adapter[field];
    if (v === undefined || v === null || v === "") {
      missing.push(field);
      continue;
    }
    if (FUNCTION_REQUIRED.has(field) && typeof v !== "function") {
      malformed.push({ field, reason: "must be a function" });
    } else if (!FUNCTION_REQUIRED.has(field) && typeof v !== "string") {
      malformed.push({ field, reason: "must be a non-empty string" });
    }
  }
  if (missing.length > 0 || malformed.length > 0) {
    const parts = [];
    if (adapter.id || adapter.displayName) {
      parts.push(`adapter ${adapter.id || "(no id)"} (${adapter.displayName || "no displayName"})`);
    }
    if (missing.length > 0) parts.push(`missing required: ${missing.join(", ")}`);
    if (malformed.length > 0) {
      parts.push(`malformed: ${malformed.map((m) => `${m.field} (${m.reason})`).join(", ")}`);
    }
    throw new AdapterError(parts.join(" — "), ERR_ADAPTER_INVALID, {
      adapterId: adapter.id ?? null,
      missing,
      malformed,
    });
  }
}

/**
 * Apply SPI_DEFAULTS for any optional field the adapter did not export.
 * Returns a *new* adapter-shaped object (the input is not mutated).
 */
export function applyDefaults(adapter) {
  const out = { ...adapter };
  for (const field of OPTIONAL_FIELDS) {
    if (out[field] === undefined || out[field] === null) {
      out[field] = SPI_DEFAULTS[field];
    }
  }
  return out;
}

/**
 * Build a registry from an explicit array of adapter modules. Each adapter
 * is validated; required-4 must be present, optional-6 are filled with
 * SPI_DEFAULTS. id collisions and empty arrays throw.
 *
 * The returned registry exposes methods that mirror the legacy module-level
 * functions (`getAdapter` / `listAdapterStatus` / `assertSupportsDirect` /
 * `assertCliPresent`) but scoped to the supplied adapter set. The legacy
 * top-level exports in adapters/index.mjs remain as a default singleton
 * built from the three built-in adapters.
 */
export function createAdapterRegistry(adapters) {
  if (!Array.isArray(adapters)) {
    throw new AdapterError(
      `adapters must be an array (got ${adapters === null ? "null" : typeof adapters})`,
      ERR_NO_ADAPTERS,
      { adapters }
    );
  }
  if (adapters.length === 0) {
    throw new AdapterError("at least one adapter is required", ERR_NO_ADAPTERS, {});
  }

  // Validate + apply defaults + detect id collisions.
  const byId = new Map();
  const order = [];
  for (const raw of adapters) {
    validateAdapter(raw);
    const prepared = applyDefaults(raw);
    if (byId.has(prepared.id)) {
      const prev = byId.get(prepared.id);
      throw new AdapterError(
        `adapter id collision: "${prepared.id}" used by both "${prev.displayName}" and "${prepared.displayName}"`,
        ERR_ADAPTER_ID_COLLISION,
        { id: prepared.id, displayNames: [prev.displayName, prepared.displayName] }
      );
    }
    byId.set(prepared.id, prepared);
    order.push(prepared.id);
  }

  const ids = Object.freeze([...order]);

  // The registry — methods mirror legacy free functions but operate on
  // this captured `byId` map. Caller composes its own registry via
  // createAdapterRegistry([...]) and passes it down explicitly when ready
  // (Unit 7's createCli factory). The default singleton in adapters/index.mjs
  // is built from createAdapterRegistry([claude, codex, opencode]).
  const registry = {
    ids,
    get(adapterId) {
      const a = byId.get(adapterId);
      if (!a) {
        const known = ids.join(", ");
        throw new AdapterError(
          `unknown adapter: ${adapterId} (known: ${known})`,
          ERR_UNKNOWN_ADAPTER,
          { adapterId, known: ids }
        );
      }
      return a;
    },
    list({ override, env } = {}) {
      return ids.map((id) => byId.get(id).detectStatus({ override, env }));
    },
    assertSupportsDirect(adapterId) {
      const a = registry.get(adapterId);
      if (!a.supportsDirect) {
        const e = new Error(
          `adapter does not support direct install in v1: ${adapterId}. Use plugin install instead.`
        );
        e.code = ERR_DIRECT_UNSUPPORTED;
        e.adapterId = adapterId;
        e.pluginInstallInstructions = a.pluginInstallInstructions();
        throw e;
      }
      return a;
    },
    assertCliPresent(adapterId, { env = process.env } = {}) {
      const a = registry.get(adapterId);
      const status = a.detectStatus({ env });
      if (!status.cliPresent) {
        const e = new Error(
          `${a.displayName} CLI ('${status.cliBinary}') not found in PATH. ` +
            `Install it first: ${status.cliInstallUrl}. ` +
            `Aborting install — would otherwise write files to ${status.targetRoot} that no agent can read.`
        );
        e.code = ERR_AGENT_CLI_MISSING;
        e.adapterId = adapterId;
        e.cliBinary = status.cliBinary;
        e.cliInstallUrl = status.cliInstallUrl;
        throw e;
      }
      return a;
    },
  };
  return Object.freeze(registry);
}
