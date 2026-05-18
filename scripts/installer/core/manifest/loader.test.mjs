import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { defaultManifestPath, defaultPaths, stripBom, loadManifest } from "./loader.mjs";

const REPO_ROOT = "/repo";

test("stripBom: removes leading BOM", () => {
  assert.equal(stripBom("﻿hello"), "hello");
  assert.equal(stripBom("hello"), "hello");
  assert.equal(stripBom(""), "");
});

test("defaultManifestPath: generic kernel default when productConfig omitted", () => {
  assert.equal(defaultManifestPath(REPO_ROOT), path.join(REPO_ROOT, "install.json"));
});

test("defaultManifestPath: reads productConfig.defaultManifestFile when provided", () => {
  const cfg = { defaultManifestFile: "skills.json" };
  assert.equal(defaultManifestPath(REPO_ROOT, cfg), path.join(REPO_ROOT, "skills.json"));
});

test("defaultManifestPath: productConfig with all required identity fields still drives manifest file", () => {
  const cfg = {
    productName: "sample",
    skillIdPrefix: "sample",
    agentNamePrefix: "sample-",
    defaultManifestFile: "sample.install.json",
    binName: "sample",
    defaultSkillsDir: "skills",
    defaultAgentsDir: "agents",
    defaultRulesDir: "rules",
  };
  assert.equal(defaultManifestPath(REPO_ROOT, cfg), path.join(REPO_ROOT, "sample.install.json"));
});

test("defaultPaths: generic kernel defaults when productConfig omitted", () => {
  const p = defaultPaths(REPO_ROOT);
  assert.equal(p.repoRoot, REPO_ROOT);
  assert.equal(p.skillsDirAbs, path.join(REPO_ROOT, "skills"));
  assert.equal(p.agentsDirAbs, path.join(REPO_ROOT, "agents"));
  assert.equal(p.rulesDirAbs, path.join(REPO_ROOT, "rules"));
  assert.equal(p.manifestPath, path.join(REPO_ROOT, "install.json"));
});

test("defaultPaths: reads productConfig asset dirs when provided", () => {
  const cfg = {
    defaultManifestFile: "skills.json",
    defaultSkillsDir: "skills",
    defaultAgentsDir: "agents",
    defaultRulesDir: "rules",
  };
  const p = defaultPaths(REPO_ROOT, cfg);
  assert.equal(p.skillsDirAbs, path.join(REPO_ROOT, "skills"));
  assert.equal(p.agentsDirAbs, path.join(REPO_ROOT, "agents"));
  assert.equal(p.rulesDirAbs, path.join(REPO_ROOT, "rules"));
  assert.equal(p.manifestPath, path.join(REPO_ROOT, "skills.json"));
});

test("defaultPaths: partial productConfig falls back per-field for omitted dirs", () => {
  // Only skillsDir customized; others fall back to kernel defaults.
  const cfg = { defaultSkillsDir: "custom/skills" };
  const p = defaultPaths(REPO_ROOT, cfg);
  assert.equal(p.skillsDirAbs, path.join(REPO_ROOT, "custom/skills"));
  assert.equal(p.agentsDirAbs, path.join(REPO_ROOT, "agents")); // kernel default
  assert.equal(p.rulesDirAbs, path.join(REPO_ROOT, "rules")); // kernel default
  assert.equal(p.manifestPath, path.join(REPO_ROOT, "install.json")); // kernel default
});

test("defaultPaths: productConfig with nested layout (e.g. examples/sample-product/skills)", () => {
  // Demonstrates the examples/sample-product/ pattern where the
  // product's repoRoot is the example dir itself, and asset dirs are flat.
  const exampleRoot = "/repo/examples/sample-product";
  const cfg = {
    defaultManifestFile: "sample.install.json",
    defaultSkillsDir: "skills",
    defaultAgentsDir: "agents",
    defaultRulesDir: "rules",
  };
  const p = defaultPaths(exampleRoot, cfg);
  assert.equal(p.skillsDirAbs, path.join(exampleRoot, "skills"));
  assert.equal(p.manifestPath, path.join(exampleRoot, "sample.install.json"));
});

test("loadManifest: parses JSON + strips BOM", async () => {
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "loader-test-"));
  try {
    const file = path.join(tmp, "manifest.json");
    await writeFile(file, "﻿" + JSON.stringify({ schemaVersion: 1, skills: {} }));
    const m = loadManifest(file);
    assert.equal(m.schemaVersion, 1);
    assert.deepEqual(m.skills, {});
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// --- Edge-case extension (plan 003 U5). loader.mjs is intentionally
// "JSON IO + path resolution, no validation logic" (file header) — raw
// IO/parse errors are the upper validator/pipeline/CLI layer's job to
// type. These cases pin the loader's ACTUAL contract (asserting reality,
// not an imposed expectation); a typed-error loader layer is a layering
// decision flagged to Deferred-to-Follow-Up, out of this test sweep. ---

import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ldr-ext-"));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("loadManifest: BOM + CRLF combined still parses", () => {
  withTmp((dir) => {
    const file = path.join(dir, "m.json");
    fs.writeFileSync(file, "﻿{\r\n  \"schemaVersion\": 1,\r\n  \"skills\": {}\r\n}\r\n");
    const m = loadManifest(file);
    assert.equal(m.schemaVersion, 1);
  });
});

test("loadManifest: malformed JSON throws a SyntaxError (raw — typing is the upper layer's job)", () => {
  withTmp((dir) => {
    const file = path.join(dir, "bad.json");
    fs.writeFileSync(file, "{ not valid json ");
    assert.throws(() => loadManifest(file), SyntaxError,
      "loader is pure IO+parse; the validator/CLI layer converts this to a typed envelope");
  });
});

test("loadManifest: missing file throws an ENOENT error naming the path", () => {
  withTmp((dir) => {
    const missing = path.join(dir, "nope.json");
    assert.throws(() => loadManifest(missing), (e) => e.code === "ENOENT" && e.message.includes(missing),
      "ENOENT surfaces the resolved path for the upper layer to wrap");
  });
});

test("loadManifest: unknown top-level keys are tolerated (forward-compat)", () => {
  withTmp((dir) => {
    const file = path.join(dir, "fwd.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, skills: {}, futureField: { x: 1 } }));
    const m = loadManifest(file);
    assert.equal(m.schemaVersion, 1);
    assert.deepEqual(m.futureField, { x: 1 }, "loader does not strip unknown keys (validation is a separate layer)");
  });
});

test("loadManifest + defaultPaths: resolve the real examples/sample-product/ fixture", () => {
  const SAMPLE = path.resolve(HERE, "../../../../examples/sample-product");
  const cfg = { defaultManifestFile: "sample.install.json", defaultSkillsDir: "skills", defaultAgentsDir: "agents", defaultRulesDir: "rules" };
  const p = defaultPaths(SAMPLE, cfg);
  assert.equal(p.manifestPath, path.join(SAMPLE, "sample.install.json"));
  const m = loadManifest(p.manifestPath);
  assert.equal(m.schemaVersion, 1);
  for (const k of ["skills", "agents", "rules", "bundles"]) {
    assert.ok(k in m, `sample manifest has '${k}'`);
  }
});
