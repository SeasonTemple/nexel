// Centralized error codes and error classes for the installer kernel.
//
// All ERR_* string constants used as `CommandError`/`PlanError`/`StateError`/
// `FsError`/`AdapterError`/`ProductConfigError` `.code` values live here.
// String values are intentionally stable — downstream callers (CLI exit
// handling, tests) match on the literal string, so renaming a
// constant is a breaking change.
//
// Existing error classes (CommandError, PlanError, StateError, FsError,
// CancelledError) remain co-located with their owning module. This file
// adds AdapterError + ProductConfigError as new classes introduced by the
// pluggable-architecture refactor.

// ---------- ERR_* constants (single source of truth) ----------

// Generic argument validation.
export const ERR_ARGS = "ERR_ARGS";
export const ERR_UNKNOWN = "ERR_UNKNOWN";

// CLI command errors.
export const ERR_MANIFEST_MISSING = "ERR_MANIFEST_MISSING";
export const ERR_MANIFEST_INVALID = "ERR_MANIFEST_INVALID";
export const ERR_INVALID_PROFILE = "ERR_INVALID_PROFILE";
export const ERR_NO_TARGET = "ERR_NO_TARGET";
export const ERR_NO_SELECTION = "ERR_NO_SELECTION";
export const ERR_NO_STATE = "ERR_NO_STATE";
export const ERR_NOT_INSTALLED = "ERR_NOT_INSTALLED";
export const ERR_SCHEMA = "ERR_SCHEMA";
export const ERR_STATE_INVALID = "ERR_STATE_INVALID";

// Plan errors.
export const ERR_UNKNOWN_SELECTION = "ERR_UNKNOWN_SELECTION";
export const ERR_REPO_ONLY = "ERR_REPO_ONLY";
export const ERR_SOURCE_MISSING = "ERR_SOURCE_MISSING";
export const ERR_UNKNOWN_AGENT = "ERR_UNKNOWN_AGENT";
export const ERR_UNKNOWN_RULE = "ERR_UNKNOWN_RULE";
export const ERR_ASSET_TYPE = "ERR_ASSET_TYPE";

// State errors.
export const ERR_PARSE = "ERR_PARSE";
export const ERR_SCHEMA_TOO_NEW = "ERR_SCHEMA_TOO_NEW";
export const ERR_NO_MIGRATION = "ERR_NO_MIGRATION";
export const ERR_BAD_MIGRATION = "ERR_BAD_MIGRATION";
export const ERR_ALREADY_INSTALLED = "ERR_ALREADY_INSTALLED";
export const ERR_HASH_CONFLICT = "ERR_HASH_CONFLICT";

// Filesystem errors.
export const ERR_LOCKED = "ERR_LOCKED";
export const ERR_PATH = "ERR_PATH";
export const ERR_PATH_ESCAPE = "ERR_PATH_ESCAPE";
export const ERR_SYMLINK = "ERR_SYMLINK";
export const ERR_STATE_PARSE = "ERR_STATE_PARSE";
export const ERR_INVALID_STATE = "ERR_INVALID_STATE";

// Adapter errors.
export const ERR_UNKNOWN_ADAPTER = "ERR_UNKNOWN_ADAPTER";
export const ERR_DIRECT_UNSUPPORTED = "ERR_DIRECT_UNSUPPORTED";
export const ERR_AGENT_CLI_MISSING = "ERR_AGENT_CLI_MISSING";
// Predeclared for Unit 4 (adapter registry factory + SPI validation).
export const ERR_ADAPTER_ID_COLLISION = "ERR_ADAPTER_ID_COLLISION";
export const ERR_ADAPTER_INVALID = "ERR_ADAPTER_INVALID";
export const ERR_NO_ADAPTERS = "ERR_NO_ADAPTERS";
// SPI v1.1: an adapter's transformAssetContent hook threw or returned a
// non-Buffer. Part of the public stability contract.
export const ERR_TRANSFORM_FAILED = "ERR_TRANSFORM_FAILED";

// Prompt errors (interactive cancellation).
export const ERR_CANCELLED = "ERR_CANCELLED";

// Product config errors (new in Unit 2; ERR_MISSING_PRODUCT_CONFIG used by Unit 8).
export const ERR_INVALID_PRODUCT_CONFIG = "ERR_INVALID_PRODUCT_CONFIG";
export const ERR_MISSING_PRODUCT_CONFIG = "ERR_MISSING_PRODUCT_CONFIG";

// Activate verb errors (v0.8).
// ERR_ACTIVATE_OPENCODE_REFUSED — `--target=opencode` is intentionally refused
// because OpenCode's plugin runtime mutates config at OpenCode boot via
// `./adapters/opencode-plugin`; nexel-driven activate has no work to do for it.
export const ERR_ACTIVATE_OPENCODE_REFUSED = "ERR_ACTIVATE_OPENCODE_REFUSED";
// ERR_ACTIVATE_INVALID_SCOPE — `--scope` must be one of `user`, `project`.
export const ERR_ACTIVATE_INVALID_SCOPE = "ERR_ACTIVATE_INVALID_SCOPE";
// ERR_ACTIVATE_FAILED — fallback code for the standard error envelope when
// a `nexel activate --json` run has ok:false but no first failure carries a
// more specific code (e.g., aggregate failure). Per ADR-0014.
export const ERR_ACTIVATE_FAILED = "ERR_ACTIVATE_FAILED";

// ---------- Error classes (new ones; existing classes stay in their owning modules) ----------

/**
 * Raised by adapter registry / SPI validation. Used by `createAdapterRegistry`
 * to report unknown adapter ids, missing required exports, id collisions, and
 * empty adapter arrays. See Unit 4.
 */
export class AdapterError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Raised by `defineProductConfig` when required identity fields are missing
 * or malformed. See Unit 2; also used by Unit 8's kernel-internal callers
 * when they receive no productConfig argument (ERR_MISSING_PRODUCT_CONFIG).
 */
export class ProductConfigError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "ProductConfigError";
    this.code = code;
    this.details = details;
  }
}
