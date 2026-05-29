// Adapter SPI v1.3 contract — single source of truth.
//
// Required-4 fields (every adapter must export these):
//   id            : string         unique identifier
//   displayName   : string         user-visible name (banner / errors)
//   detectTargetRoot : ({override, env}) => string   target dir on this OS
//   detectStatus  : ({override, env}) => StatusObject
//
// Optional-8 fields (kernel-provided defaults when missing):
//   mapTargetPath              : (asset, manifest, productConfig) => relPath
//   supportedAssetTypes        : ["skill", "agent", "rule"] subset
//   pluginInstallInstructions  : (productConfig) => string         (v1.2)
//                                  Was () => string in v1.1. Old single-arg
//                                  adapter implementations remain forward-
//                                  compatible because JS ignores extra args;
//                                  v1.2 adapters interpolate productConfig
//                                  fields (productName / pluginName /
//                                  marketplaceName / repositoryUrl) into the
//                                  rendered output (see ADR-0010).
//   supportsDirect             : boolean
//   cliBinary                  : string ("" = skip CLI presence check)
//   cliInstallUrl              : string
//   doctorProbes               : ({targetRoot, env, productConfig}) =>
//                                  Array<{name, ok, detail}>
//   transformAssetContent      : (asset, body: Buffer) => Buffer   (v1.1)
//                                  Per-CLI content rewrite. Identity default.
//                                  MUST be pure (no env/IO). Identity paths
//                                  MUST return the input Buffer unchanged
//                                  (reference-equality is observed).
//   contentPipeline            : Array<{id, run}>                   (v1.3)
//                                  Ordered, stackable content transforms.
//                                  Default []. Each stage's run carries the
//                                  exact transformAssetContent contract (pure,
//                                  identity returns input Buffer by reference).
//                                  Resolved at registry build (applyDefaults):
//                                  a declared single transformAssetContent
//                                  auto-promotes to a 1-stage pipeline; an empty
//                                  pipeline + no hook is identity. Declaring
//                                  BOTH a non-empty pipeline and a hook is a
//                                  construction-time error (ERR_ADAPTER_INVALID).
//                                  Stages are synchronous and receive the
//                                  threaded Buffer as READ-ONLY. See ADR-0020.
//
// SPI evolution policy:
//   - Minor versions: add NEW optional fields with kernel defaults, OR
//     widen the signature of an existing optional field when old shapes
//     remain forward-compatible (e.g., v1.2 widened
//     pluginInstallInstructions from () to (productConfig); a v1.1 adapter
//     that ignores the new arg still satisfies the v1.2 contract).
//     (v1.1 added transformAssetContent; v1.2 widened
//     pluginInstallInstructions; v1.3 added contentPipeline.)
//   - Major versions: may add new REQUIRED fields. Existing adapters must
//     update to declare them.
//   - String values of ERR_ADAPTER_INVALID / ERR_ADAPTER_ID_COLLISION /
//     ERR_NO_ADAPTERS / ERR_TRANSFORM_FAILED are part of the public
//     stability contract.
//   - `SPI_DEFAULTS` reference identity and individual `Function.length`
//     are NOT part of the contract. Adapter authors must not rely on
//     either to detect "no override" — that needle reflects kernel-internal
//     defaults that can be tightened across minor versions.
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
  // v1.2 — accepts productConfig so adapter renderers can interpolate
  // marketplace URL, plugin name, etc. Identity default returns "" (empty
  // string) for any input so callers that ignore the result still work.
  pluginInstallInstructions: (_productConfig) => "",
  supportsDirect: false,
  cliBinary: "",
  cliInstallUrl: "",
  doctorProbes: () => [],
  // v1.1 — per-CLI content transform. Identity default returns the input
  // Buffer UNCHANGED (same reference) so callers can detect "transformed"
  // via reference equality. Adapters override only when the target CLI's
  // on-disk shape diverges from the source.
  transformAssetContent: (asset, body) => body,
  // v1.3 — ordered stackable content transforms. Default is the shared frozen
  // empty array (identity). applyDefaults resolves the canonical pipeline:
  // auto-promotes a declared transformAssetContent to a 1-stage pipeline, or
  // leaves this empty for no-hook adapters. See ADR-0020.
  contentPipeline: Object.freeze([]),
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
  // SPI v1.3 (ADR-0020): contentPipeline shape + mutual exclusion with
  // transformAssetContent. Validated on the RAW adapter, before applyDefaults
  // injects identity defaults — so a present transformAssetContent here is
  // unambiguously the author's, not the kernel default.
  if (adapter.contentPipeline !== undefined && adapter.contentPipeline !== null) {
    const cp = adapter.contentPipeline;
    if (!Array.isArray(cp)) {
      malformed.push({ field: "contentPipeline", reason: "must be an array of { id, run } stages" });
    } else {
      const seenIds = new Set();
      cp.forEach((stage, i) => {
        if (!stage || typeof stage !== "object") {
          malformed.push({ field: `contentPipeline[${i}]`, reason: "must be a { id, run } object" });
          return;
        }
        if (typeof stage.id !== "string" || stage.id === "") {
          malformed.push({ field: `contentPipeline[${i}].id`, reason: "must be a non-empty string" });
        } else if (seenIds.has(stage.id)) {
          malformed.push({ field: `contentPipeline[${i}].id`, reason: `duplicate stage id "${stage.id}"` });
        } else {
          seenIds.add(stage.id);
        }
        if (typeof stage.run !== "function") {
          malformed.push({ field: `contentPipeline[${i}].run`, reason: "must be a function" });
        }
      });
      // Fail loud when both a non-empty pipeline AND a hook are declared: a
      // single hook auto-promotes to a 1-stage pipeline, so declaring both is
      // almost certainly a half-migration or mistake.
      if (cp.length > 0 && typeof adapter.transformAssetContent === "function") {
        malformed.push({
          field: "contentPipeline + transformAssetContent",
          reason: "declare one or the other, not both (a single transformAssetContent auto-promotes to a 1-stage pipeline)",
        });
      }
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
  // SPI v1.3 (ADR-0020): resolve the canonical content pipeline. After the fill
  // loop, out.transformAssetContent is always a function (author's or the
  // injected identity default) and out.contentPipeline is always an array. The
  // `!== SPI_DEFAULTS.transformAssetContent` check below is LOAD-BEARING: it is
  // the sole guard stopping the kernel from auto-promoting its OWN injected
  // identity default into a spurious 1-stage pipeline, and it works only while
  // that default is shared by reference. Do NOT make SPI_DEFAULTS.transformAssetContent
  // a fresh per-call arrow — every no-hook adapter would silently gain a 1-stage
  // identity pipeline and lose the empty-pipeline / same-Buffer fast path.
  if (out.contentPipeline.length > 0) {
    // Author declared an explicit pipeline — keep it verbatim.
  } else if (out.transformAssetContent !== SPI_DEFAULTS.transformAssetContent) {
    // Auto-promote the single declared hook to a 1-stage pipeline.
    out.contentPipeline = Object.freeze([
      { id: "transformAssetContent", run: out.transformAssetContent },
    ]);
  } else {
    // No hook, no pipeline — canonical identity. Reuse the shared frozen empty
    // default so every no-hook adapter's empty pipeline is consistently frozen.
    out.contentPipeline = SPI_DEFAULTS.contentPipeline;
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
    assertSupportsDirect(adapterId, { productConfig } = {}) {
      const a = registry.get(adapterId);
      if (!a.supportsDirect) {
        const e = new Error(
          `adapter does not support direct install in v1: ${adapterId}. Use plugin install instead.`
        );
        e.code = ERR_DIRECT_UNSUPPORTED;
        e.adapterId = adapterId;
        // Render plugin install instructions defensively so a throwing
        // third-party adapter does not mask the underlying
        // ERR_DIRECT_UNSUPPORTED contract.
        try {
          e.pluginInstallInstructions = a.pluginInstallInstructions(productConfig);
        } catch (rendererError) {
          e.pluginInstallInstructions = "";
          e.pluginInstallInstructionsError = `adapter pluginInstallInstructions threw: ${rendererError.message}`;
        }
        // SPI v1.2 lazy-validate path: when productConfig is absent or
        // lacks repositoryUrl, the adapter returns an actionable error
        // string instead of real install instructions. Surface that as a
        // separate boolean+message so JSON envelope consumers can tell
        // "real instructions" apart from "config error rendered as text".
        if (!productConfig?.repositoryUrl) {
          e.pluginInstallInstructionsError = e.pluginInstallInstructionsError
            ?? "productConfig.repositoryUrl missing — pluginInstallInstructions content is a diagnostic, not real install steps";
        }
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
