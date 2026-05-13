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
