// U3 (plan 2026-05-25-001): ProductConfig plugin-metadata field expansion.
//
// Covers:
//   - Required-field validation (unchanged contract — REQUIRED_FIELDS not extended)
//   - Plugin-metadata fields added to OPTIONAL_DEFAULTS
//   - Derived defaults (pluginName, marketplaceName)
//   - Explicit overrides win over derived defaults
//   - Silent-drop canary: any unknown field in overrides must NOT round-trip
//     into the frozen result (catches the "I added a field to OPTIONAL_DEFAULTS
//     but forgot to enumerate it in the Object.freeze return block" regression)

import test from "node:test";
import assert from "node:assert/strict";

import { defineProductConfig, REQUIRED_FIELDS, OPTIONAL_DEFAULTS } from "./product-config.mjs";

function minimalRequired(extra = {}) {
  return {
    productName: "demo",
    skillIdPrefix: "demo",
    agentNamePrefix: "demo-",
    defaultManifestFile: "demo.install.json",
    binName: "demo-installer",
    ...extra,
  };
}

test("REQUIRED_FIELDS is frozen at the 5 identity fields (SPI v1 contract)", () => {
  assert.deepEqual([...REQUIRED_FIELDS], [
    "productName",
    "skillIdPrefix",
    "agentNamePrefix",
    "defaultManifestFile",
    "binName",
  ]);
});

test("defineProductConfig: minimal required input succeeds, returns frozen object", () => {
  const cfg = defineProductConfig(minimalRequired());
  assert.equal(cfg.productName, "demo");
  assert.equal(Object.isFrozen(cfg), true);
});

test("defineProductConfig: backward-compatible — no new required field added in v0.7", () => {
  // The pre-v0.7 minimal payload (no plugin metadata) must still construct
  // successfully. Adding repositoryUrl to REQUIRED_FIELDS would break every
  // existing downstream ProductConfig — explicit regression guard.
  assert.doesNotThrow(() => defineProductConfig(minimalRequired()));
});

test("defineProductConfig: missing required field throws ProductConfigError listing all missing", () => {
  let err;
  try {
    defineProductConfig({ productName: "demo" });
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.equal(err.code, "ERR_INVALID_PRODUCT_CONFIG");
  assert.match(err.message, /missing required field/);
  for (const field of ["skillIdPrefix", "agentNamePrefix", "defaultManifestFile", "binName"]) {
    assert.match(err.message, new RegExp(field), `must list ${field}`);
  }
});

test("defineProductConfig: pluginName defaults to productName when omitted", () => {
  const cfg = defineProductConfig(minimalRequired());
  assert.equal(cfg.pluginName, "demo");
});

test("defineProductConfig: marketplaceName defaults to `${productName}-marketplace` when omitted", () => {
  const cfg = defineProductConfig(minimalRequired());
  assert.equal(cfg.marketplaceName, "demo-marketplace");
});

test("defineProductConfig: explicit pluginName overrides derived default", () => {
  const cfg = defineProductConfig(minimalRequired({ pluginName: "custom-plugin" }));
  assert.equal(cfg.pluginName, "custom-plugin");
});

test("defineProductConfig: explicit marketplaceName overrides derived default", () => {
  const cfg = defineProductConfig(minimalRequired({ marketplaceName: "custom-marketplace" }));
  assert.equal(cfg.marketplaceName, "custom-marketplace");
});

test("defineProductConfig: repositoryUrl is undefined when omitted (lazy-validated at call site)", () => {
  const cfg = defineProductConfig(minimalRequired());
  assert.equal(cfg.repositoryUrl, undefined);
});

test("defineProductConfig: all plugin metadata fields round-trip when provided", () => {
  const cfg = defineProductConfig(minimalRequired({
    repositoryUrl: "https://example.com/my-product",
    pluginName: "my-plugin",
    marketplaceName: "my-marketplace",
    pluginAuthor: "Alice",
    pluginDescription: "What it does.",
  }));
  assert.equal(cfg.repositoryUrl, "https://example.com/my-product");
  assert.equal(cfg.pluginName, "my-plugin");
  assert.equal(cfg.marketplaceName, "my-marketplace");
  assert.equal(cfg.pluginAuthor, "Alice");
  assert.equal(cfg.pluginDescription, "What it does.");
});

test("defineProductConfig: pluginAuthor / pluginDescription default to undefined (omitted in plugin.json writes)", () => {
  const cfg = defineProductConfig(minimalRequired());
  assert.equal(cfg.pluginAuthor, undefined);
  assert.equal(cfg.pluginDescription, undefined);
});

// --- silent-drop canary ---
// defineProductConfig enumerates returned fields in its Object.freeze block
// instead of spreading overrides. Adding a new field to OPTIONAL_DEFAULTS
// without listing it in the return block causes the value to be silently
// dropped — this test asserts that EVERY OPTIONAL_DEFAULTS key round-trips.
// (Without this canary, the silent-drop bug pattern that already swallowed
// envTelemetry / telemetryDirName recurs for every future field add.)

test("silent-drop canary: every OPTIONAL_DEFAULTS field round-trips through defineProductConfig", () => {
  const overrides = minimalRequired();
  const sentinels = {};
  // Fields with charset validation accept only /^[a-zA-Z][a-zA-Z0-9_-]*$/
  // (pluginName / marketplaceName). Use sentinels that match that pattern.
  const validatedIdentifierFields = new Set(["pluginName", "marketplaceName"]);
  for (const field of Object.keys(OPTIONAL_DEFAULTS)) {
    if (field === "targetPathLayout") {
      sentinels[field] = { skills: "canarySkills", agents: "canaryAgents" };
    } else if (validatedIdentifierFields.has(field)) {
      sentinels[field] = `canary-${field}`;
    } else {
      sentinels[field] = `_canary_${field}_`;
    }
    overrides[field] = sentinels[field];
  }
  const cfg = defineProductConfig(overrides);
  for (const field of Object.keys(OPTIONAL_DEFAULTS)) {
    if (field === "targetPathLayout") {
      assert.equal(cfg.targetPathLayout.skills, sentinels[field].skills,
        `targetPathLayout.skills must round-trip (silent-drop guard)`);
      assert.equal(cfg.targetPathLayout.agents, sentinels[field].agents,
        `targetPathLayout.agents must round-trip (silent-drop guard)`);
    } else {
      assert.equal(cfg[field], sentinels[field],
        `field "${field}" must round-trip through defineProductConfig (silent-drop guard)`);
    }
  }
});

test("silent-drop canary: unknown fields in overrides are dropped (not retained)", () => {
  // Inverse guard — confirms the Object.freeze enumeration is the gate, not
  // a spread. Future maintainers who replace the enumeration with `...overrides`
  // will see this assertion fire.
  const cfg = defineProductConfig(minimalRequired({ _unknownField: "must-not-appear" }));
  assert.equal(cfg._unknownField, undefined,
    "defineProductConfig must enumerate fields explicitly — unknown overrides must NOT round-trip");
});

test("defineProductConfig: rejects skillIdPrefix containing ':'", () => {
  assert.throws(
    () => defineProductConfig(minimalRequired({ skillIdPrefix: "bad:prefix" })),
    (e) => e.code === "ERR_INVALID_PRODUCT_CONFIG",
  );
});

test("defineProductConfig: rejects agentNamePrefix not ending with '-'", () => {
  assert.throws(
    () => defineProductConfig(minimalRequired({ agentNamePrefix: "demoagent" })),
    (e) => e.code === "ERR_INVALID_PRODUCT_CONFIG",
  );
});
