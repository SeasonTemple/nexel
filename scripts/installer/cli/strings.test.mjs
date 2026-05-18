// Catalog-completeness guard for the strings i18n seam (plan 003 U4):
// every namespace leaf is a callable function rendering a non-empty
// string with no hardcoded product literal; namespaces are frozen.
// Extends the v0.3.0 help.verb assertions to the whole catalog.

import test from "node:test";
import assert from "node:assert/strict";

import { strings } from "./strings.mjs";

// Broad superset of params any catalog function might destructure.
// Functions ignore params they don't use; the point is that calling
// each leaf never throws and yields a non-empty string.
const PARAMS = {
  binName: "stub-bin", prefix: "stub", version: "9.9.9",
  adapterList: "a | b", adapterId: "a", id: "stub:thing",
  count: 2, writtenCount: 1, skippedCount: 0, updatedCount: 1, deletedCount: 1,
  okCount: 1, failCount: 0, targetCount: 1, candidateCount: 1, upToDateCount: 0,
  sourceMissingCount: 0, managedFileCount: 1, missingCount: 0, tamperedCount: 0,
  reportCount: 1, alreadyInstalled: 1,
  relPath: "skills/x/SKILL.md", sourceRelPath: "skills/x/SKILL.md",
  message: "msg", code: "ERR_X", detail: "d", instructions: "do x",
  stage: "stage", reason: "reason", selectionId: "stub:thing", hint: "h",
  targetRoot: "/tmp/t", managed: true, text: "t", basename: "SKILL.md",
  dirname: "x", target: "/tmp/t", severity: "error", oldSha: "0".repeat(40),
  newSha: "1".repeat(40), recorded: "0".repeat(40), onDisk: "1".repeat(40),
  tamperedFlag: "", sourceNote: "n", sourceCommit: "abc1234", skipNote: "",
  displayName: "Stub", sym: "✓", name: "check",
};

const PRODUCT_LITERAL = /\b(skillctl|netops)\b/i;

function walk(ns, nsName) {
  for (const [key, val] of Object.entries(ns)) {
    if (typeof val === "object" && val !== null) {
      // Nested namespace (e.g. help.verb).
      assert.ok(Object.isFrozen(val), `${nsName}.${key} must be frozen`);
      walk(val, `${nsName}.${key}`);
      continue;
    }
    assert.equal(typeof val, "function", `${nsName}.${key} must be a function`);
    const out = val(PARAMS);
    assert.equal(typeof out, "string", `${nsName}.${key}() must return a string`);
    assert.ok(out.length > 0, `${nsName}.${key}() must be non-empty`);
    assert.ok(!PRODUCT_LITERAL.test(out),
      `${nsName}.${key}() must not embed a product literal: ${out.slice(0, 80)}`);
  }
}

test("strings: top-level namespaces are help, errors, run — all frozen", () => {
  assert.deepEqual(Object.keys(strings).sort(), ["errors", "help", "run"]);
  for (const ns of Object.keys(strings)) {
    assert.ok(Object.isFrozen(strings[ns]), `strings.${ns} must be frozen`);
  }
});

test("strings.help: every key (incl. nested help.verb) is a non-empty product-agnostic function", () => {
  walk(strings.help, "help");
});

test("strings.errors: every key is a non-empty product-agnostic function", () => {
  walk(strings.errors, "errors");
});

test("strings.run: every key is a non-empty product-agnostic function", () => {
  walk(strings.run, "run");
});

test("strings: frozen catalog rejects post-freeze mutation", () => {
  assert.throws(() => { strings.help.injected = 1; }, TypeError);
  assert.throws(() => { strings.help.verb.injected = 1; }, TypeError);
  assert.throws(() => { strings.run.injected = 1; }, TypeError);
});

// Scoped reference check (plan 003 U4, the J doc-review correction):
// run.mjs emits MOST user-facing output as inline literals and uses
// strings.run.* only sparsely. A blanket "every run.* key is referenced"
// guard would be vacuous for rename-protection. So assert only the keys
// run.mjs actually calls resolve — that is the real rename surface;
// catalog coverage of run.mjs is partial-by-construction (the code
// bypasses the catalog for the rest, by design).
test("strings.run: the keys run.mjs actually calls all resolve (scoped rename guard)", () => {
  const REFERENCED_BY_RUN = [
    "agentsHeader", "agentsNoCli", "agentsUnknown",
    "listBundlesHeader", "listLegend", "listSkillsHeader", "listTarget",
  ];
  for (const k of REFERENCED_BY_RUN) {
    assert.equal(typeof strings.run[k], "function",
      `run.mjs calls strings.run.${k} — a rename here would undefined-render at runtime`);
  }
  // Documented non-claim: the other strings.run.* keys are catalog
  // entries not wired into run.mjs (it uses inline literals); this guard
  // intentionally does NOT assert broad rename protection it can't deliver.
});
