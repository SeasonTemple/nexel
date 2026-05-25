import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { runPreflight, rangeMinimum } from "./release-preflight.mjs";

const BILINGUAL_NOTE = `# v0.9.0

## English

- Release note.

## 中文

- 发布说明。
`;

function makeRepo({
  version = "0.9.0",
  lockVersion = version,
  noteVersion = version,
  noteBody = BILINGUAL_NOTE,
  enginesNode,
  dependencies = {},
  lockDepEngines = {},
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-preflight-"));
  spawnSync("git", ["init"], { cwd: root, stdio: "ignore" });
  const pkg = { name: "nexel", version };
  if (enginesNode) pkg.engines = { node: enginesNode };
  if (Object.keys(dependencies).length > 0) pkg.dependencies = dependencies;
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg, null, 2));
  const lockPackages = { "": { name: "nexel", version: lockVersion } };
  for (const [name, ranges] of Object.entries(lockDepEngines)) {
    lockPackages[`node_modules/${name}`] = { version: "0.0.0", engines: { node: ranges } };
  }
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({
    name: "nexel",
    version: lockVersion,
    packages: lockPackages,
  }, null, 2));
  fs.mkdirSync(path.join(root, "docs/release-notes"), { recursive: true });
  fs.writeFileSync(path.join(root, `docs/release-notes/v${noteVersion}.md`), noteBody);
  spawnSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  return root;
}

test("runPreflight passes clean matching fixture", () => {
  const root = makeRepo();
  try {
    const result = runPreflight({ repoRoot: root });
    assert.equal(result.ok, true, JSON.stringify(result.mismatches));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runPreflight fails package-lock mismatch", () => {
  const root = makeRepo({ lockVersion: "0.8.0" });
  try {
    const result = runPreflight({ repoRoot: root });
    assert.equal(result.ok, false);
    assert.ok(result.mismatches.some((m) => m.name === "package-lock-version-matches"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runPreflight fails missing current release note", () => {
  const root = makeRepo({ version: "0.9.1", noteVersion: "0.9.0" });
  try {
    const result = runPreflight({ repoRoot: root, allowDirty: true });
    assert.equal(result.ok, false);
    assert.ok(result.mismatches.some((m) => m.name === "release-note-exists"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runPreflight fails dirty tree unless allowed", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "dirty.txt"), "dirty");
    assert.equal(runPreflight({ repoRoot: root }).ok, false);
    assert.equal(runPreflight({ repoRoot: root, allowDirty: true }).mismatches.some((m) => m.name === "working-tree-clean"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runPreflight fails when current release note is not bilingual", () => {
  const root = makeRepo({ noteBody: "# v0.9.0\n\n## English\n\n- English only.\n" });
  try {
    const result = runPreflight({ repoRoot: root });
    assert.equal(result.ok, false);
    assert.ok(result.mismatches.some((m) => m.name === "release-note-bilingual"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- U2: runtime-deps engines.node floor check ---

test("rangeMinimum: parses common semver range shapes", () => {
  assert.equal(rangeMinimum(">=18"), "18.0.0");
  assert.equal(rangeMinimum(">=20.12.0"), "20.12.0");
  assert.equal(rangeMinimum("^22.22.2"), "22.22.2");
  assert.equal(rangeMinimum("~22.22.2"), "22.22.2");
  assert.equal(rangeMinimum("22.22.2"), "22.22.2");
  assert.equal(rangeMinimum(">22.22.2"), "22.22.3");
  assert.equal(rangeMinimum("^22.22.2 || ^24.15.0 || >=26.0.0"), "22.22.2");
  assert.equal(rangeMinimum("*"), null);
  assert.equal(rangeMinimum(""), null);
  assert.equal(rangeMinimum(undefined), null);
});

test("runPreflight: deps-engines check passes when all deps satisfied", () => {
  const root = makeRepo({
    enginesNode: ">=22.22.2",
    dependencies: { foo: "^1.0.0", bar: "^2.0.0" },
    lockDepEngines: { foo: ">=18", bar: "^20.0.0" },
  });
  try {
    const result = runPreflight({ repoRoot: root, allowDirty: true });
    const check = result.checks.find((c) => c.name === "runtime-deps-engines-compatible");
    assert.equal(check.ok, true, check.detail);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("runPreflight: deps-engines check fails when a dep floor exceeds host", () => {
  const root = makeRepo({
    enginesNode: ">=18",
    dependencies: { strict: "^1.0.0" },
    lockDepEngines: { strict: ">=22.22.2" },
  });
  try {
    const result = runPreflight({ repoRoot: root, allowDirty: true });
    assert.equal(result.ok, false);
    const check = result.checks.find((c) => c.name === "runtime-deps-engines-compatible");
    assert.equal(check.ok, false);
    assert.match(check.detail, /strict/);
    assert.match(check.detail, /22\.22\.2/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("runPreflight: deps-engines check reports every conflicting dep, not just first", () => {
  const root = makeRepo({
    enginesNode: ">=18",
    dependencies: { alpha: "^1", beta: "^1" },
    lockDepEngines: { alpha: ">=22.22.2", beta: "^20.12.0" },
  });
  try {
    const result = runPreflight({ repoRoot: root, allowDirty: true });
    const check = result.checks.find((c) => c.name === "runtime-deps-engines-compatible");
    assert.equal(check.ok, false);
    assert.match(check.detail, /alpha/);
    assert.match(check.detail, /beta/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("runPreflight: deps without engines.node are treated as compatible", () => {
  const root = makeRepo({
    enginesNode: ">=18",
    dependencies: { noeng: "^1.0.0" },
    lockDepEngines: {}, // dep present in pkg but no engines in lock
  });
  try {
    const result = runPreflight({ repoRoot: root, allowDirty: true });
    const check = result.checks.find((c) => c.name === "runtime-deps-engines-compatible");
    assert.equal(check.ok, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("runPreflight: host with no engines.node + dep with engines triggers strict fail", () => {
  const root = makeRepo({
    enginesNode: undefined,
    dependencies: { dep: "^1.0.0" },
    lockDepEngines: { dep: ">=22.22.2" },
  });
  try {
    const result = runPreflight({ repoRoot: root, allowDirty: true });
    const check = result.checks.find((c) => c.name === "runtime-deps-engines-compatible");
    assert.equal(check.ok, false);
    assert.match(check.detail, /host engines\.node not declared/);
    assert.match(check.detail, /dep/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("runPreflight: complex disjunctive range floor is correctly extracted", () => {
  const root = makeRepo({
    enginesNode: ">=22.22.2",
    dependencies: { wfa: "^8.0.0" },
    lockDepEngines: { wfa: "^22.22.2 || ^24.15.0 || >=26.0.0" }, // write-file-atomic@8 real shape
  });
  try {
    const result = runPreflight({ repoRoot: root, allowDirty: true });
    const check = result.checks.find((c) => c.name === "runtime-deps-engines-compatible");
    assert.equal(check.ok, true, `expected compat: ${check.detail}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
