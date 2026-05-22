import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { verifyReleaseTag } from "./verify-release-tag.mjs";

function makeFixture({ version = "1.2.3", note = "release note\n" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-release-tag-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "nexel", version }, null, 2));
  fs.mkdirSync(path.join(root, "docs", "release-notes"), { recursive: true });
  if (note !== null) {
    fs.writeFileSync(path.join(root, "docs", "release-notes", `v${version}.md`), note);
  }
  return root;
}

test("verifyReleaseTag passes when tag, package version, and release note align", () => {
  const root = makeFixture();
  try {
    const result = verifyReleaseTag({ tagName: "v1.2.3", repoRoot: root });
    assert.equal(result.ok, true, result.failures.join("\n"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyReleaseTag fails on malformed tags", () => {
  const root = makeFixture();
  try {
    const result = verifyReleaseTag({ tagName: "release-1.2.3", repoRoot: root });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("vX.Y.Z")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyReleaseTag fails when tag does not match package version", () => {
  const root = makeFixture();
  try {
    const result = verifyReleaseTag({ tagName: "v1.2.4", repoRoot: root });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("tag/package mismatch")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyReleaseTag fails when the matching release note is missing or empty", () => {
  const missing = makeFixture({ note: null });
  try {
    const result = verifyReleaseTag({ tagName: "v1.2.3", repoRoot: missing });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("missing release note")));
  } finally {
    fs.rmSync(missing, { recursive: true, force: true });
  }

  const empty = makeFixture({ note: "  \n" });
  try {
    const result = verifyReleaseTag({ tagName: "v1.2.3", repoRoot: empty });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("empty release note")));
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
