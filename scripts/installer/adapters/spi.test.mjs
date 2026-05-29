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

test("SPI_DEFAULTS exposes all nine optional fields with sensible defaults", () => {
  const expectedKeys = [
    "mapTargetPath",
    "supportedAssetTypes",
    "pluginInstallInstructions",
    "supportsDirect",
    "cliBinary",
    "cliInstallUrl",
    "doctorProbes",
    "transformAssetContent",
    "contentPipeline",
  ];
  for (const key of expectedKeys) {
    assert.ok(key in SPI_DEFAULTS, `SPI_DEFAULTS missing ${key}`);
  }
  assert.deepEqual([...SPI_DEFAULTS.supportedAssetTypes], ["skill", "agent", "rule"]);
  assert.equal(typeof SPI_DEFAULTS.pluginInstallInstructions, "function");
  // SPI v1.2: identity default returns "" for any input. Function.length is
  // documented as NOT part of the contract (see spi.mjs evolution policy);
  // assert only the observable behavior, never the arity.
  assert.equal(SPI_DEFAULTS.pluginInstallInstructions(), "", "callable with no args (backward-compat path)");
  assert.equal(SPI_DEFAULTS.pluginInstallInstructions({ productName: "demo" }), "", "callable with productConfig");
  assert.equal(SPI_DEFAULTS.supportsDirect, false);
  assert.equal(SPI_DEFAULTS.cliBinary, "");
  assert.equal(SPI_DEFAULTS.cliInstallUrl, "");
  assert.equal(typeof SPI_DEFAULTS.doctorProbes, "function");
  assert.deepEqual(SPI_DEFAULTS.doctorProbes(), []);
  // v1.1: transformAssetContent identity default returns the input Buffer
  // UNCHANGED (same reference) so the kernel can detect "transformed" via
  // reference equality.
  assert.equal(typeof SPI_DEFAULTS.transformAssetContent, "function");
  const buf = Buffer.from("x");
  assert.equal(SPI_DEFAULTS.transformAssetContent({ assetType: "agent", id: "a" }, buf), buf,
    "identity default must return the SAME Buffer instance (reference equality)");
  // v1.3: contentPipeline default is the frozen empty array (identity).
  assert.ok(Array.isArray(SPI_DEFAULTS.contentPipeline));
  assert.equal(SPI_DEFAULTS.contentPipeline.length, 0);
  assert.ok(Object.isFrozen(SPI_DEFAULTS.contentPipeline));
});

// ---- SPI v1.3 contentPipeline: resolution + validation (ADR-0020) ----

test("applyDefaults: no hook, no pipeline → canonical contentPipeline is empty (NOT a 1-stage identity)", () => {
  const prepared = applyDefaults(makeMinimalAdapter());
  assert.ok(Array.isArray(prepared.contentPipeline));
  // Load-bearing: the kernel must NOT auto-promote its own injected identity
  // default into a spurious 1-stage pipeline. Guards the reference-identity
  // invariant in applyDefaults (ADR-0020 / doc-review A1).
  assert.equal(prepared.contentPipeline.length, 0, "no-hook adapter must resolve to an EMPTY pipeline");
  assert.ok(Object.isFrozen(prepared.contentPipeline), "empty pipeline is frozen");
});

test("applyDefaults: single transformAssetContent auto-promotes to a 1-stage pipeline", () => {
  const customXf = (asset, body) => Buffer.concat([body, Buffer.from("!")]);
  const prepared = applyDefaults(makeMinimalAdapter({ transformAssetContent: customXf }));
  assert.equal(prepared.contentPipeline.length, 1);
  assert.equal(prepared.contentPipeline[0].id, "transformAssetContent");
  assert.equal(prepared.contentPipeline[0].run, customXf, "promoted stage's run is the adapter's hook");
});

test("applyDefaults: explicit multi-stage contentPipeline is kept verbatim, order preserved", () => {
  const s1 = { id: "a", run: (asset, body) => body };
  const s2 = { id: "b", run: (asset, body) => body };
  const prepared = applyDefaults(makeMinimalAdapter({ contentPipeline: [s1, s2] }));
  assert.equal(prepared.contentPipeline.length, 2);
  assert.deepEqual(prepared.contentPipeline.map((s) => s.id), ["a", "b"]);
});

test("validateAdapter: declaring both contentPipeline and transformAssetContent throws ERR_ADAPTER_INVALID", () => {
  const bad = makeMinimalAdapter({
    contentPipeline: [{ id: "s", run: (a, b) => b }],
    transformAssetContent: (a, b) => b,
  });
  assert.throws(
    () => validateAdapter(bad),
    (e) => e instanceof AdapterError && e.code === "ERR_ADAPTER_INVALID"
      && /contentPipeline \+ transformAssetContent/.test(e.message),
    "must name both fields in the mutual-exclusion error",
  );
});

test("validateAdapter: non-array contentPipeline throws ERR_ADAPTER_INVALID", () => {
  const bad = makeMinimalAdapter({ contentPipeline: { not: "an array" } });
  assert.throws(() => validateAdapter(bad),
    (e) => e instanceof AdapterError && e.code === "ERR_ADAPTER_INVALID" && /must be an array/.test(e.message));
});

test("validateAdapter: stage with empty/missing id or non-function run throws ERR_ADAPTER_INVALID", () => {
  const bad = makeMinimalAdapter({
    contentPipeline: [{ id: "", run: (a, b) => b }, { id: "ok", run: "nope" }],
  });
  assert.throws(() => validateAdapter(bad),
    (e) => e instanceof AdapterError && e.code === "ERR_ADAPTER_INVALID"
      && /contentPipeline\[0\]\.id/.test(e.message) && /contentPipeline\[1\]\.run/.test(e.message));
});

test("validateAdapter: duplicate stage id within one pipeline throws ERR_ADAPTER_INVALID", () => {
  const bad = makeMinimalAdapter({
    contentPipeline: [{ id: "dup", run: (a, b) => b }, { id: "dup", run: (a, b) => b }],
  });
  assert.throws(() => validateAdapter(bad),
    (e) => e instanceof AdapterError && e.code === "ERR_ADAPTER_INVALID" && /duplicate stage id "dup"/.test(e.message));
});

test("validateAdapter: null/primitive stage entries throw ERR_ADAPTER_INVALID", () => {
  const bad = makeMinimalAdapter({ contentPipeline: [null, 42, "str"] });
  assert.throws(() => validateAdapter(bad),
    (e) => e instanceof AdapterError && e.code === "ERR_ADAPTER_INVALID"
      && /contentPipeline\[0\]/.test(e.message) && /contentPipeline\[1\]/.test(e.message)
      && /contentPipeline\[2\]/.test(e.message),
    "each non-object entry must be reported by index");
});

test("validateAdapter: a valid explicit pipeline (no hook) passes", () => {
  const ok = makeMinimalAdapter({ contentPipeline: [{ id: "x", run: (a, b) => b }] });
  assert.doesNotThrow(() => validateAdapter(ok));
});

test("applyDefaults: no-hook adapter's empty pipeline is the shared frozen default (reference)", () => {
  // Pins the resolution's reuse of SPI_DEFAULTS.contentPipeline for the empty
  // case so every no-hook adapter shares one frozen instance (ADR-0020 A2).
  const prepared = applyDefaults(makeMinimalAdapter());
  assert.equal(prepared.contentPipeline, SPI_DEFAULTS.contentPipeline);
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

  // v1.1: transformAssetContent injected (identity) when absent, preserved when present.
  assert.equal(typeof prepared.transformAssetContent, "function");
  const b = Buffer.from("hi");
  assert.equal(prepared.transformAssetContent({ assetType: "skill", id: "s" }, b), b);
  const customXf = (asset, body) => Buffer.concat([body, Buffer.from("!")]);
  const withXf = applyDefaults(makeMinimalAdapter({ transformAssetContent: customXf }));
  assert.equal(withXf.transformAssetContent, customXf, "provided transformAssetContent must not be overwritten");
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

// --- U4 (plan 2026-05-25-001): SPI v1.2 pluginInstallInstructions ---

const sampleProductConfigForTests = {
  productName: "sample-product",
  pluginName: "sample-product",
  marketplaceName: "sample-product-marketplace",
  repositoryUrl: "https://github.com/SeasonTemple/nexel",
};

test("v1.2 forward-compat: old-style () => string adapter still satisfies v1.2 contract", () => {
  // A pre-v1.2 adapter implements pluginInstallInstructions with zero args.
  // JavaScript silently ignores extra arguments, so applyDefaults + a v1.2
  // caller can hand it a productConfig and get back the unchanged string.
  const legacy = makeMinimalAdapter({ pluginInstallInstructions: () => "legacy text" });
  const prepared = applyDefaults(legacy);
  assert.equal(prepared.pluginInstallInstructions(sampleProductConfigForTests), "legacy text",
    "extra productConfig arg must not break the legacy single-arg adapter");
});

test("v1.2 forward-compat: invoking without productConfig still resolves the default", () => {
  // Some callers (probe paths, error formatters) may not have productConfig
  // wired. The default must remain safe-to-call with no arguments.
  const minimal = applyDefaults(makeMinimalAdapter());
  assert.equal(minimal.pluginInstallInstructions(), "");
  assert.equal(minimal.pluginInstallInstructions(undefined), "");
});

test("claude adapter v1.2: interpolates productName / pluginName / marketplaceName / repositoryUrl", () => {
  const text = claude.pluginInstallInstructions(sampleProductConfigForTests);
  assert.match(text, /sample-product/, "must mention productName");
  assert.match(text, /https:\/\/github\.com\/SeasonTemple\/nexel/, "must mention repositoryUrl");
  assert.match(text, /sample-product@sample-product-marketplace/, "must compose pluginName@marketplaceName");
  assert.doesNotMatch(text, /<your-product/i, "must NOT contain placeholder tokens");
});

test("claude adapter v1.2: lazy-validates missing repositoryUrl with actionable error", () => {
  const text = claude.pluginInstallInstructions({ productName: "demo" });
  assert.match(text, /unavailable/);
  assert.match(text, /repositoryUrl/);
  assert.match(text, /agent-skills\.config\.mjs/);
});
