// Public API surface for the installer kernel.
//
// External consumers (npm package users) import only from this file. Internal
// modules under core/, cli/, and adapters/ are implementation details and
// may move or change between minor versions.
//
// Symbols re-exported here are the SPI v1 stability contract.
// Adding new exports here is backward-compatible. Removing or renaming is
// a breaking change.

// ---------- createCli factory (public entry for npm consumers) ----------
export { createCli } from "./cli/cli.mjs";
export { parseArgs } from "./cli/argv.mjs";
export { printHelp, renderHelp } from "./cli/help.mjs";
export { handleError, formatSkipNote } from "./cli/error-format.mjs";
export {
  resolveSelections,
  runList,
  runAgents,
  runValidate,
  runExport,
  runImport,
  runRepair,
  runDoctor,
  runPlan,
  runInstall,
  runUninstall,
  runUpdate,
} from "./cli/run.mjs";
export { dispatchVerb, KERNEL_HANDLERS } from "./cli/dispatch.mjs";
export { strings } from "./cli/strings.mjs";

// ---------- ProductConfig ----------
export { defineProductConfig } from "./core/product-config.mjs";

// ---------- Adapter registry + SPI ----------
export {
  ADAPTERS,
  getAdapter,
  listAdapterStatus,
  assertSupportsDirect,
  assertCliPresent,
  createAdapterRegistry,
  SPI_REQUIRED,
  SPI_DEFAULTS,
  validateAdapter,
  applyDefaults as applyAdapterDefaults,
} from "./adapters/index.mjs";

// ---------- Asset types ----------
export { assetTypes, getAssetType } from "./core/asset-types.mjs";

// ---------- Plan-time utilities for adapter authors ----------
export { defaultTargetMapping, buildInstallPlan, resolveSelection, transitiveAssets, formatPlanText, PlanError } from "./core/plan.mjs";
export { whichSync } from "./core/which.mjs";

// ---------- Manifest (split into schema/loader/validator/drift) ----------
export { loadManifest, defaultManifestPath, defaultPaths } from "./core/manifest/loader.mjs";
export { validateManifest, exitCodeFor, formatFindings } from "./core/manifest/validator.mjs";
export { SCHEMA_VERSION, PROFILES, CATEGORIES, HOSTS } from "./core/manifest/schema.mjs";
export { detectDrift } from "./core/manifest/drift.mjs";

// ---------- v0.7: marketplace lockstep helper ----------
export { verifyMarketplaceLockstep } from "./core/marketplace-lockstep.mjs";

// ---------- v0.7: scaffold-plugin (opt-in via createCli({enablePluginScaffolder: true})) ----------
export { scaffoldPlugin, dispatchScaffold } from "./cli/commands/scaffold-plugin.mjs";

// ---------- CLI command entry points (re-exported for advanced consumers; Unit 7 introduces createCli) ----------
export {
  install,
  installMulti,
  uninstall,
  uninstallMulti,
  update,
  updateMulti,
  repair,
  exportCommand,
  importCommand,
  listCommand,
  agentsCommand,
  doctorCommand,
  planCommandText,
  planSelection,
  CommandError,
} from "./cli/commands/index.mjs";

// ---------- Error classes ----------
export {
  AdapterError,
  ProductConfigError,
  // ERR_* constants
  ERR_ARGS,
  ERR_UNKNOWN,
  ERR_MANIFEST_MISSING,
  ERR_MANIFEST_INVALID,
  ERR_INVALID_PROFILE,
  ERR_NO_TARGET,
  ERR_NO_SELECTION,
  ERR_NO_STATE,
  ERR_NOT_INSTALLED,
  ERR_SCHEMA,
  ERR_STATE_INVALID,
  ERR_UNKNOWN_SELECTION,
  ERR_REPO_ONLY,
  ERR_SOURCE_MISSING,
  ERR_UNKNOWN_AGENT,
  ERR_UNKNOWN_RULE,
  ERR_ASSET_TYPE,
  ERR_PARSE,
  ERR_SCHEMA_TOO_NEW,
  ERR_NO_MIGRATION,
  ERR_BAD_MIGRATION,
  ERR_ALREADY_INSTALLED,
  ERR_HASH_CONFLICT,
  ERR_LOCKED,
  ERR_PATH,
  ERR_PATH_ESCAPE,
  ERR_SYMLINK,
  ERR_STATE_PARSE,
  ERR_INVALID_STATE,
  ERR_UNKNOWN_ADAPTER,
  ERR_DIRECT_UNSUPPORTED,
  ERR_AGENT_CLI_MISSING,
  ERR_ADAPTER_ID_COLLISION,
  ERR_ADAPTER_INVALID,
  ERR_NO_ADAPTERS,
  ERR_TRANSFORM_FAILED,
  ERR_CANCELLED,
  ERR_INVALID_PRODUCT_CONFIG,
  ERR_MISSING_PRODUCT_CONFIG,
  ERR_ACTIVATE_OPENCODE_REFUSED,
  ERR_ACTIVATE_INVALID_SCOPE,
  ERR_DEACTIVATE_OPENCODE_REFUSED,
  ERR_DEACTIVATE_INVALID_SCOPE,
} from "./core/errors.mjs";

// FsError lives in filesystem.mjs; StateError in state.mjs; CancelledError in prompts.mjs.
// These are surfaced for consumers that need typed catches.
export { FsError } from "./core/filesystem.mjs";
export { StateError } from "./core/state.mjs";
export { CancelledError } from "./cli/prompts.mjs";
