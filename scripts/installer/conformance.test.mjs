import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadManifest, defaultPaths } from "./core/manifest/loader.mjs";
import { validateManifest } from "./core/manifest/validator.mjs";
import { detectDrift } from "./core/manifest/drift.mjs";
import { buildInstallPlan, transitiveAssets, PlanError } from "./core/plan.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_ROOT = path.join(REPO_ROOT, "examples/conformance-product");
const MANIFEST = loadManifest(path.join(FIXTURE_ROOT, "install.json"));
const PATHS = defaultPaths(FIXTURE_ROOT);

test("conformance corpus validates at downstream scale", () => {
  const findings = validateManifest(MANIFEST, {
    ...PATHS,
    skillIdPrefix: "conf",
    agentNamePrefix: "conf-",
  });

  assert.deepEqual(findings, []);
  assert.equal(Object.keys(MANIFEST.skills).length, 36);
  assert.equal(Object.keys(MANIFEST.agents).length, 8);
  assert.equal(Object.keys(MANIFEST.rules).length, 8);
  assert.equal(Object.keys(MANIFEST.bundles).length, 6);
});

test("conformance corpus drift scan is clean", () => {
  const drift = detectDrift({ repoRoot: FIXTURE_ROOT, manifest: MANIFEST });
  assert.equal(drift.pass, true, JSON.stringify(drift, null, 2));
});

test("conformance planning resolves transitive assets and skill metadata stays inside skill asset files", () => {
  const assets = transitiveAssets(MANIFEST, ["conf-bundle-06"]);
  assert.ok(assets.skills.includes("conf:skill-06"));
  assert.ok(assets.skills.includes("conf:skill-12"));
  assert.ok(assets.agents.includes("agent-06"));
  assert.ok(assets.rules.includes("rules/rule-06.md"));

  const plan = buildInstallPlan(MANIFEST, ["conf:skill-05"], {
    repoRoot: FIXTURE_ROOT,
    targetRoot: path.join(FIXTURE_ROOT, ".tmp-target"),
  });

  assert.ok(plan.files.some((file) => file.sourcePath.endsWith("references/opencode-instructions.md")));
  assert.ok(plan.files.every((file) => ["skill", "agent", "rule"].includes(file.assetType)));
});

test("conformance host-specific skills cover all built-in hosts", () => {
  const hosts = new Set(Object.values(MANIFEST.skills).flatMap((skill) => skill.appliesTo ?? []));
  assert.deepEqual([...hosts].sort(), ["claude-code", "codex", "opencode"]);
});

test("conformance fixture keeps repo-only skills non-installable", () => {
  assert.throws(
    () => buildInstallPlan(MANIFEST, ["conf:skill-03"], {
      repoRoot: FIXTURE_ROOT,
      targetRoot: path.join(FIXTURE_ROOT, ".tmp-target"),
    }),
    (error) => error instanceof PlanError && error.code === "ERR_REPO_ONLY"
  );
});

test("conformance validator catches case-folded source path collisions", () => {
  const clone = JSON.parse(JSON.stringify(MANIFEST));
  clone.rules["rules/RULE-01.md"] = {
    sourcePath: "rules/RULE-01.md",
    description: "Synthetic case collision.",
  };

  const findings = validateManifest(clone, {
    repoRoot: null,
    skillsDirAbs: null,
  });

  assert.ok(findings.some((finding) => /case-folded path collision/.test(finding.message)));
});
