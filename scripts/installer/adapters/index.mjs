// Adapter registry — built-in singleton + factory.
//
// The default registry is built from the three built-in adapters (Claude
// Code / Codex / OpenCode). The legacy top-level functions (ADAPTERS,
// getAdapter, listAdapterStatus, assertSupportsDirect, assertCliPresent)
// are bound to that default registry — every existing call site in
// commands.mjs / prompts.mjs continues to work unchanged.
//
// New consumers (Unit 7 createCli, external npm package users) should
// instead call `createAdapterRegistry([...])` with their own adapter set
// and call `.get(id)` / `.list()` / `.assertSupportsDirect(id)` /
// `.assertCliPresent(id, {env})` on the resulting registry.

import * as claude from "./claude.mjs";
import * as codex from "./codex.mjs";
import * as opencode from "./opencode.mjs";

import {
  createAdapterRegistry,
  SPI_REQUIRED,
  SPI_DEFAULTS,
  validateAdapter,
  applyDefaults,
} from "./spi.mjs";

export { createAdapterRegistry, SPI_REQUIRED, SPI_DEFAULTS, validateAdapter, applyDefaults };

/**
 * The default registry built from the three built-in adapters.
 * Exported via the legacy free-function API below for backward
 * compatibility. Unit 7's createCli factory creates its own registry
 * from the adapters[] supplied by the thin bin / external consumer.
 */
const DEFAULT_REGISTRY = createAdapterRegistry([claude, codex, opencode]);

export const ADAPTERS = DEFAULT_REGISTRY.ids;

export function getAdapter(adapterId) {
  return DEFAULT_REGISTRY.get(adapterId);
}

export function listAdapterStatus({ override, env } = {}) {
  return DEFAULT_REGISTRY.list({ override, env });
}

export function assertSupportsDirect(adapterId, opts) {
  return DEFAULT_REGISTRY.assertSupportsDirect(adapterId, opts);
}

export function assertCliPresent(adapterId, { env = process.env } = {}) {
  return DEFAULT_REGISTRY.assertCliPresent(adapterId, { env });
}
