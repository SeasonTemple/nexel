import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { verifyReleaseTag } from "./verify-release-tag.mjs";

const BILINGUAL_NOTE = `# v1.2.3

## English

- Release note.

## 中文

- 发布说明。
`;

// Default env satisfies the ADR-0018 CI bless gate without writing a
// marker — most pre-ADR-0018 tests assert behavior orthogonal to the
// gate and we want their meaning preserved verbatim. Tests that exercise
// the gate itself override `env` explicitly.
const CI_BLESSED_ENV = { GITHUB_ACTIONS: "true", NEXEL_CI_BLESSED: "true" };

function makeFixture({ version = "1.2.3", note = BILINGUAL_NOTE } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-release-tag-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "nexel", version }, null, 2),
  );
  fs.mkdirSync(path.join(root, "docs", "release-notes"), { recursive: true });
  if (note !== null) {
    fs.writeFileSync(path.join(root, "docs", "release-notes", `v${version}.md`), note);
  }
  return root;
}

// Seed a tmp dir as a real git repo with one commit, so `git rev-parse
// HEAD^{commit}` resolves. Returns the commit SHA HEAD points at.
function seedGitRepo(root) {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "seed"],
    { cwd: root },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function writeMarker(root, tag, body) {
  fs.mkdirSync(path.join(root, ".nexel"), { recursive: true });
  fs.writeFileSync(path.join(root, ".nexel", `release-blessed-${tag}`), body);
}

test("verifyReleaseTag passes when tag, package version, and release note align", () => {
  const root = makeFixture();
  try {
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: root,
      env: CI_BLESSED_ENV,
    });
    assert.equal(result.ok, true, result.failures.join("\n"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyReleaseTag fails on malformed tags", () => {
  const root = makeFixture();
  try {
    const result = verifyReleaseTag({
      tagName: "release-1.2.3",
      repoRoot: root,
      env: CI_BLESSED_ENV,
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("vX.Y.Z")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyReleaseTag fails when tag does not match package version", () => {
  const root = makeFixture();
  try {
    const result = verifyReleaseTag({
      tagName: "v1.2.4",
      repoRoot: root,
      env: CI_BLESSED_ENV,
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("tag/package mismatch")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyReleaseTag fails when the matching release note is missing or empty", () => {
  const missing = makeFixture({ note: null });
  try {
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: missing,
      env: CI_BLESSED_ENV,
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("missing release note")));
  } finally {
    fs.rmSync(missing, { recursive: true, force: true });
  }

  const empty = makeFixture({ note: "  \n" });
  try {
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: empty,
      env: CI_BLESSED_ENV,
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("empty release note")));
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("verifyReleaseTag fails when the release note is not bilingual", () => {
  const root = makeFixture({ note: "# v1.2.3\n\n## English\n\n- English only.\n" });
  try {
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: root,
      env: CI_BLESSED_ENV,
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("Chinese")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- ADR-0018 CI bless gate cases ---

test("ADR-0018: marker present + SHA matches HEAD → pass", () => {
  const root = makeFixture();
  try {
    const head = seedGitRepo(root);
    writeMarker(
      root,
      "v1.2.3",
      `tag=v1.2.3\ncommit=${head}\nblessed_at=2026-05-29T00:00:00Z\n`,
    );
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: root,
      env: {}, // no CI env; gate must accept the marker
    });
    assert.equal(result.ok, true, result.failures.join("\n"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ADR-0018: marker present + SHA mismatches HEAD → fail", () => {
  const root = makeFixture();
  try {
    seedGitRepo(root);
    const wrong = "0".repeat(40);
    writeMarker(
      root,
      "v1.2.3",
      `tag=v1.2.3\ncommit=${wrong}\nblessed_at=2026-05-29T00:00:00Z\n`,
    );
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: root,
      env: {},
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.failures.some((f) => f.includes("does not match HEAD")),
      result.failures.join("\n"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ADR-0018: marker absent + GITHUB_ACTIONS + NEXEL_CI_BLESSED=true → pass", () => {
  const root = makeFixture();
  try {
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: root,
      env: { GITHUB_ACTIONS: "true", NEXEL_CI_BLESSED: "true" },
    });
    assert.equal(result.ok, true, result.failures.join("\n"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ADR-0018: marker absent + GITHUB_ACTIONS=true + NEXEL_CI_BLESSED unset → fail", () => {
  const root = makeFixture();
  try {
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: root,
      env: { GITHUB_ACTIONS: "true" },
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.failures.some((f) => f.includes("NEXEL_CI_BLESSED")),
      result.failures.join("\n"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ADR-0018: marker absent + no CI env → fail closed", () => {
  const root = makeFixture();
  try {
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: root,
      env: {},
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.failures.some((f) => f.includes("no bless marker")),
      result.failures.join("\n"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ADR-0018: malformed marker (no commit= line) → fail", () => {
  const root = makeFixture();
  try {
    seedGitRepo(root);
    writeMarker(root, "v1.2.3", `tag=v1.2.3\nblessed_at=2026-05-29T00:00:00Z\n`);
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: root,
      env: {},
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.failures.some((f) => f.includes("malformed commit=<sha>")),
      result.failures.join("\n"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ADR-0018: symlink marker → fail (parity with .husky/pre-push)", () => {
  const root = makeFixture();
  try {
    seedGitRepo(root);
    fs.mkdirSync(path.join(root, ".nexel"), { recursive: true });
    const real = path.join(root, "real-target.txt");
    fs.writeFileSync(real, `commit=${"a".repeat(40)}\n`);
    fs.symlinkSync(real, path.join(root, ".nexel", "release-blessed-v1.2.3"));
    const result = verifyReleaseTag({
      tagName: "v1.2.3",
      repoRoot: root,
      env: {},
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.failures.some((f) => f.includes("symlink")),
      result.failures.join("\n"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
