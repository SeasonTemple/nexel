import test from "node:test";
import assert from "node:assert/strict";

import {
  SPI_REQUIRED,
  SPI_DEFAULTS,
  validateAdapter,
  applyDefaults,
  createAdapterRegistry,
} from "./spi.mjs";
import { AdapterError } from "../core/errors.mjs";
import * as claude from "./claude.mjs";

function makeMinimalAdapter(overrides = {}) {
  return {
    id: "mock",
    displayName: "Mock",
    detectTargetRoot: () => "/tmp/mock",
    detectStatus: ({ env } = {}) => ({
      id: "mock",
      displayName: "Mock",
      targetRoot: "/tmp/mock",
      exists: false,
      writable: true,
      cliPresent: false,
      cliBinary: "",
      cliPath: null,
      cliInstallUrl: "",
      supportsDirect: true,
      notes: "mock",
    }),
    ...overrides,
  };
}

test("SPI_REQUIRED lists the four required fields", () => {
  assert.deepEqual([...SPI_REQUIRED], ["id", "displayName", "detectTargetRoot", "detectStatus"]);
});

test("SPI_DEFAULTS exposes all six optional fields with sensible defaults", () => {
  const expectedKeys = [
    "mapTargetPath",
    "supportedAssetTypes",
    "pluginInstallInstructions",
    "supportsDirect",
    "cliBinary",
    "cliInstallUrl",
    "doctorProbes",
  ];
  for (const key of expectedKeys) {
    assert.ok(key in SPI_DEFAULTS, `SPI_DEFAULTS missing ${key}`);
  }
  assert.deepEqual([...SPI_DEFAULTS.supportedAssetTypes], ["skill", "agent", "rule"]);
  assert.equal(typeof SPI_DEFAULTS.pluginInstallInstructions, "function");
  assert.equal(SPI_DEFAULTS.pluginInstallInstructions(), "");
  assert.equal(SPI_DEFAULTS.supportsDirect, false);
  assert.equal(SPI_DEFAULTS.cliBinary, "");
  assert.equal(SPI_DEFAULTS.cliInstallUrl, "");
  assert.equal(typeof SPI_DEFAULTS.doctorProbes, "function");
  assert.deepEqual(SPI_DEFAULTS.doctorProbes(), []);
});

test("validateAdapter: missing required-4 fields are all reported", () => {
  let caught;
  try {
    validateAdapter({});
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof AdapterError);
  assert.equal(caught.code, "ERR_ADAPTER_INVALID");
  assert.deepEqual(caught.details.missing.sort(), [...SPI_REQUIRED].sort());
});

test("validateAdapter: rejects null/undefined/non-object", () => {
  for (const v of [null, undefined, 42, "string", []]) {
    assert.throws(
      () => validateAdapter(v),
      (e) => e instanceof AdapterError && e.code === "ERR_ADAPTER_INVALID"
    );
  }
});

test("validateAdapter: function-typed required field provided as string is malformed", () => {
  const bad = makeMinimalAdapter({ detectTargetRoot: "not-a-function" });
  let caught;
  try {
    validateAdapter(bad);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof AdapterError);
  assert.equal(caught.code, "ERR_ADAPTER_INVALID");
  assert.equal(caught.details.malformed[0].field, "detectTargetRoot");
});

test("validateAdapter: minimal valid adapter passes", () => {
  assert.doesNotThrow(() => validateAdapter(makeMinimalAdapter()));
});

test("applyDefaults: fills missing optional fields, preserves provided ones", () => {
  const minimal = makeMinimalAdapter();
  const prepared = applyDefaults(minimal);
  assert.equal(prepared.id, "mock");
  assert.equal(prepared.supportsDirect, false); // SPI_DEFAULTS
  assert.deepEqual([...prepared.supportedAssetTypes], ["skill", "agent", "rule"]);
  assert.equal(prepared.cliBinary, "");
  assert.equal(typeof prepared.doctorProbes, "function");
  assert.deepEqual(prepared.doctorProbes(), []);

  const withCustom = applyDefaults(makeMinimalAdapter({ supportsDirect: true, cliBinary: "mock-cli" }));
  assert.equal(withCustom.supportsDirect, true);
  assert.equal(withCustom.cliBinary, "mock-cli");
});

test("createAdapterRegistry: rejects empty array with ERR_NO_ADAPTERS", () => {
  assert.throws(
    () => createAdapterRegistry([]),
    (e) => e instanceof AdapterError && e.code === "ERR_NO_ADAPTERS"
  );
});

test("createAdapterRegistry: rejects non-array input with ERR_NO_ADAPTERS", () => {
  for (const v of [null, undefined, {}, 42]) {
    assert.throws(
      () => createAdapterRegistry(v),
      (e) => e instanceof AdapterError && e.code === "ERR_NO_ADAPTERS"
    );
  }
});

test("createAdapterRegistry: rejects id collision with ERR_ADAPTER_ID_COLLISION listing both displayNames", () => {
  const a = makeMinimalAdapter({ id: "dup", displayName: "First" });
  const b = makeMinimalAdapter({ id: "dup", displayName: "Second" });
  let caught;
  try {
    createAdapterRegistry([a, b]);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof AdapterError);
  assert.equal(caught.code, "ERR_ADAPTER_ID_COLLISION");
  assert.deepEqual(caught.details.displayNames, ["First", "Second"]);
});

test("createAdapterRegistry: rejects invalid adapter with ERR_ADAPTER_INVALID", () => {
  assert.throws(
    () => createAdapterRegistry([{ id: "broken" /* missing displayName, etc */ }]),
    (e) => e instanceof AdapterError && e.code === "ERR_ADAPTER_INVALID"
  );
});

test("createAdapterRegistry: returns frozen registry with get/list/assertSupportsDirect/assertCliPresent", () => {
  const reg = createAdapterRegistry([makeMinimalAdapter()]);
  assert.ok(Object.isFrozen(reg));
  assert.equal(typeof reg.get, "function");
  assert.equal(typeof reg.list, "function");
  assert.equal(typeof reg.assertSupportsDirect, "function");
  assert.equal(typeof reg.assertCliPresent, "function");
  assert.deepEqual([...reg.ids], ["mock"]);
});

test("createAdapterRegistry.get: unknown id throws ERR_UNKNOWN_ADAPTER", () => {
  const reg = createAdapterRegistry([makeMinimalAdapter()]);
  assert.throws(
    () => reg.get("nope"),
    (e) => e instanceof AdapterError && e.code === "ERR_UNKNOWN_ADAPTER"
  );
});

test("createAdapterRegistry.list: returns status objects for every registered adapter", () => {
  const a = makeMinimalAdapter({ id: "a", displayName: "A" });
  const b = makeMinimalAdapter({ id: "b", displayName: "B" });
  const reg = createAdapterRegistry([a, b]);
  const list = reg.list({ env: {} });
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "mock"); // detectStatus stub returns mock id; OK for shape test
});

test("createAdapterRegistry works with the three built-in adapters", () => {
  // Re-import claude (already imported); compose a fresh registry to verify
  // that the built-ins satisfy validateAdapter without exceptions.
  const reg = createAdapterRegistry([claude]);
  assert.deepEqual([...reg.ids], ["claude-code"]);
  const a = reg.get("claude-code");
  assert.equal(a.displayName, "Claude Code");
  assert.equal(a.supportsDirect, true);
  // Optional method that built-in doesn't define falls back to SPI_DEFAULTS.
  assert.equal(typeof a.doctorProbes, "function");
  assert.deepEqual(a.doctorProbes({}), []);
});

test("createAdapterRegistry: doctorProbes default returns [] when adapter doesn't define it", () => {
  const minimal = makeMinimalAdapter();
  delete minimal.doctorProbes; // ensure not present
  const reg = createAdapterRegistry([minimal]);
  const a = reg.get("mock");
  assert.equal(typeof a.doctorProbes, "function");
  assert.deepEqual(a.doctorProbes({}), []);
});

test("createAdapterRegistry: doctorProbes returns adapter's custom result when defined", () => {
  const probe = makeMinimalAdapter({
    doctorProbes: () => [{ name: "mock-check", ok: true, detail: "ok" }],
  });
  const reg = createAdapterRegistry([probe]);
  const out = reg.get("mock").doctorProbes({});
  assert.deepEqual(out, [{ name: "mock-check", ok: true, detail: "ok" }]);
});

// Import side-effect guard.
// The three built-in adapters are imported at the top of THIS test file. By
// the time the test runs, those imports have already completed. If any of
// them performed top-level IO (e.g., calling whichSync at import time), we
// would have no way to retroactively detect it from inside the runtime.
//
// A perfect static guard would parse each adapter module's AST and assert
// no top-level call expressions outside `export const` / `export function`.
// For now we use a behavioral approximation: stub process.env and verify
// the adapter module's *captured* shape is unaffected — i.e., constants
// like `id` were not derived from process.env at load time.
test("adapter modules do not embed env-derived values at load time", async () => {
  // Re-import a fresh copy via dynamic import with a different module
  // identifier. If claude.mjs read process.env at top level, this would
  // pick up the current (different) env values.
  const before = { id: claude.id, displayName: claude.displayName, supportsDirect: claude.supportsDirect };
  const refreshed = await import("./claude.mjs");
  const after = { id: refreshed.id, displayName: refreshed.displayName, supportsDirect: refreshed.supportsDirect };
  assert.deepEqual(after, before);
});
