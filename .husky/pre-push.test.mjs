// Integration test for .husky/pre-push — spawns the hook with realistic
// stdin fixtures and asserts exit code + stderr per case.
//
// Round-4 of the v0.8.x review cycle discovered a bootstrap bug in the
// hook (annotated-tag SHA vs commit SHA mismatch) that the shape-only
// pre-commit review did not catch. This test executes the hook as a real
// process so future regressions of that class — and tag deletion, symlink,
// missing/malformed marker, SHA mismatch — fail loudly.

// Harness hardening: when this test runs under a husky hook context
// (the recursive case where pre-commit fires npm test which runs this
// suite), GIT_DIR et al. are inherited from the hook and would cause
// fixture `git init` + `git commit` calls below to write into the
// parent worktree's refs. Scrub them at module top so fixture-git ops
// stay confined to their tmpdirs.
delete process.env.GIT_DIR;
delete process.env.GIT_WORK_TREE;
delete process.env.GIT_INDEX_FILE;
delete process.env.GIT_OBJECT_DIRECTORY;
delete process.env.GIT_COMMON_DIR;

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(REPO_ROOT, ".husky", "pre-push");
const ZERO_SHA = "0".repeat(40);

function makeFixture() {
  // Init a tmp git repo so the hook's `git rev-parse <sha>^{commit}` peels
  // against a real object database with at least one commit.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-prepush-fix-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "seed"], { cwd: dir });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  // Copy the hook into the fixture so the hook's git invocations resolve
  // against the fixture's repo, not nexel's main repo.
  const fixtureHook = path.join(dir, "pre-push");
  fs.copyFileSync(HOOK, fixtureHook);
  fs.chmodSync(fixtureHook, 0o755);
  return { dir, sha, hook: fixtureHook };
}

function runHook(fixture, stdin) {
  return spawnSync(fixture.hook, [], {
    cwd: fixture.dir,
    encoding: "utf8",
    input: stdin,
    env: { ...process.env },
  });
}

function cleanup(fixture) {
  fs.rmSync(fixture.dir, { recursive: true, force: true });
}

function blessMarker(fixture, tag, commitSha) {
  const markerDir = path.join(fixture.dir, ".nexel");
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(
    path.join(markerDir, `release-blessed-${tag}`),
    `tag=${tag}\ncommit=${commitSha}\nblessed_at=2026-05-29T00:00:00Z\n`,
  );
}

test("pre-push: passes branch push without checking marker", () => {
  const fx = makeFixture();
  try {
    const r = runHook(fx, `refs/heads/main ${fx.sha} refs/heads/main ${ZERO_SHA}\n`);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status} stderr=${r.stderr}`);
  } finally { cleanup(fx); }
});

test("pre-push: refuses tag push with no marker", () => {
  const fx = makeFixture();
  try {
    const r = runHook(fx, `refs/tags/v0.0.1 ${fx.sha} refs/tags/v0.0.1 ${ZERO_SHA}\n`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no bless marker/);
    assert.match(r.stderr, /release:bless -- v0\.0\.1/);
  } finally { cleanup(fx); }
});

test("pre-push: passes tag push with matching SHA marker", () => {
  const fx = makeFixture();
  try {
    blessMarker(fx, "v0.0.1", fx.sha);
    const r = runHook(fx, `refs/tags/v0.0.1 ${fx.sha} refs/tags/v0.0.1 ${ZERO_SHA}\n`);
    assert.equal(r.status, 0, `expected pass, got ${r.status} stderr=${r.stderr}`);
  } finally { cleanup(fx); }
});

test("pre-push: refuses tag push with marker SHA mismatch", () => {
  const fx = makeFixture();
  try {
    const wrongSha = "1".repeat(40);
    blessMarker(fx, "v0.0.1", wrongSha);
    const r = runHook(fx, `refs/tags/v0.0.1 ${fx.sha} refs/tags/v0.0.1 ${ZERO_SHA}\n`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /bless marker bound to/);
    assert.match(r.stderr, /amended or rewritten/);
  } finally { cleanup(fx); }
});

test("pre-push: refuses tag push when marker is a symlink", () => {
  const fx = makeFixture();
  try {
    const realMarker = path.join(fx.dir, "real-marker");
    fs.writeFileSync(realMarker, `tag=v0.0.1\ncommit=${fx.sha}\n`);
    const markerDir = path.join(fx.dir, ".nexel");
    fs.mkdirSync(markerDir, { recursive: true });
    const symlinkPath = path.join(markerDir, "release-blessed-v0.0.1");
    try {
      fs.symlinkSync(realMarker, symlinkPath);
    } catch (e) {
      if (e.code === "EPERM" || e.code === "EACCES") return; // Windows w/o privilege
      throw e;
    }
    const r = runHook(fx, `refs/tags/v0.0.1 ${fx.sha} refs/tags/v0.0.1 ${ZERO_SHA}\n`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /marker is a symlink/);
  } finally { cleanup(fx); }
});

test("pre-push: refuses tag push when marker has no commit= line (empty file)", () => {
  const fx = makeFixture();
  try {
    fs.mkdirSync(path.join(fx.dir, ".nexel"), { recursive: true });
    fs.writeFileSync(path.join(fx.dir, ".nexel", "release-blessed-v0.0.1"), "");
    const r = runHook(fx, `refs/tags/v0.0.1 ${fx.sha} refs/tags/v0.0.1 ${ZERO_SHA}\n`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing or malformed commit=<sha> line/);
  } finally { cleanup(fx); }
});

test("pre-push: refuses tag push when marker has malformed commit line", () => {
  const fx = makeFixture();
  try {
    fs.mkdirSync(path.join(fx.dir, ".nexel"), { recursive: true });
    fs.writeFileSync(
      path.join(fx.dir, ".nexel", "release-blessed-v0.0.1"),
      "tag=v0.0.1\ncommit=not-a-valid-sha\nblessed_at=2026-05-29\n",
    );
    const r = runHook(fx, `refs/tags/v0.0.1 ${fx.sha} refs/tags/v0.0.1 ${ZERO_SHA}\n`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing or malformed commit=<sha> line/);
  } finally { cleanup(fx); }
});

test("pre-push: passes tag deletion regardless of marker presence (local_sha all-zeros)", () => {
  const fx = makeFixture();
  try {
    // No marker created — tag deletion should not require bless.
    const r = runHook(fx, `(delete) ${ZERO_SHA} refs/tags/v0.0.1 ${fx.sha}\n`);
    assert.equal(r.status, 0, `expected exit 0 for tag delete, got ${r.status} stderr=${r.stderr}`);
  } finally { cleanup(fx); }
});

test("pre-push: passes annotated tag push (local_sha is tag object, peels to commit) — round-4 bootstrap-bug regression guard", () => {
  const fx = makeFixture();
  try {
    // Create an annotated tag in the fixture pointing at fx.sha (the commit).
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "tag", "-a", "v0.0.1", fx.sha, "-m", "annotated"],
      { cwd: fx.dir },
    );
    const tagObjectSha = execFileSync("git", ["rev-parse", "refs/tags/v0.0.1"], { cwd: fx.dir, encoding: "utf8" }).trim();
    // The annotated-tag object SHA must differ from the commit SHA — this
    // is the round-4 bootstrap-bug condition. If git ever returned the
    // commit SHA from `rev-parse refs/tags/<annotated>`, this assert would
    // catch the underlying assumption change.
    assert.notEqual(tagObjectSha, fx.sha, "annotated tag object SHA must differ from commit SHA");
    // Bless against the COMMIT SHA (what release-bless.mjs writes).
    blessMarker(fx, "v0.0.1", fx.sha);
    // Push the TAG OBJECT SHA (what `git push` sends as local_sha).
    const r = runHook(fx, `refs/tags/v0.0.1 ${tagObjectSha} refs/tags/v0.0.1 ${ZERO_SHA}\n`);
    assert.equal(r.status, 0, `expected exit 0 for valid annotated tag, got ${r.status} stderr=${r.stderr}`);
  } finally { cleanup(fx); }
});

test("pre-push: refuses one tag and passes another in same push (multi-line stdin)", () => {
  const fx = makeFixture();
  try {
    blessMarker(fx, "v0.0.1", fx.sha);
    // v0.0.1 has a marker, v0.0.2 does not. Pushing both → exit 1 with
    // failure for v0.0.2 only.
    const stdin =
      `refs/tags/v0.0.1 ${fx.sha} refs/tags/v0.0.1 ${ZERO_SHA}\n` +
      `refs/tags/v0.0.2 ${fx.sha} refs/tags/v0.0.2 ${ZERO_SHA}\n`;
    const r = runHook(fx, stdin);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /v0\.0\.2/);
    // v0.0.1 should NOT appear in the failure list.
    assert.ok(!/v0\.0\.1: /.test(r.stderr), `v0.0.1 should not be in failure list, got: ${r.stderr}`);
  } finally { cleanup(fx); }
});

test("pre-push: documents emergency bypass options in failure message", () => {
  const fx = makeFixture();
  try {
    const r = runHook(fx, `refs/tags/v0.0.1 ${fx.sha} refs/tags/v0.0.1 ${ZERO_SHA}\n`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--no-verify/);
  } finally { cleanup(fx); }
});
