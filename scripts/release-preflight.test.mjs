import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { runPreflight } from "./release-preflight.mjs";

const BILINGUAL_NOTE = `# v0.9.0

## English

- Release note.

## 中文

- 发布说明。
`;

function makeRepo({ version = "0.9.0", lockVersion = version, noteVersion = version, noteBody = BILINGUAL_NOTE } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-preflight-"));
  spawnSync("git", ["init"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "nexel", version }, null, 2));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({
    name: "nexel",
    version: lockVersion,
    packages: { "": { name: "nexel", version: lockVersion } },
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
