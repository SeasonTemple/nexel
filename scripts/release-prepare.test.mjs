import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { prepareRelease } from "./release-prepare.mjs";

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-release-prepare-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "nexel",
    version: "1.2.3",
  }, null, 2));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({
    name: "nexel",
    version: "1.2.3",
    packages: { "": { name: "nexel", version: "1.2.3" } },
  }, null, 2));
  return root;
}

test("prepareRelease bumps version and creates bilingual release-note stub", () => {
  const root = makeFixture();
  try {
    const result = prepareRelease({ bump: "patch", repoRoot: root });
    assert.equal(result.version, "1.2.4");
    assert.equal(result.tag, "v1.2.4");
    assert.equal(result.releaseNote, "docs/release-notes/v1.2.4.md");
    assert.equal(result.createdNote, true);

    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    const note = fs.readFileSync(path.join(root, "docs/release-notes/v1.2.4.md"), "utf8");
    assert.equal(pkg.version, "1.2.4");
    assert.equal(lock.version, "1.2.4");
    assert.match(note, /## English/);
    assert.match(note, /## 中文/);
    assert.ok(result.nextCommands.some((command) => command.includes("npm run package:smoke")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("prepareRelease rejects unsupported bump types before mutating", () => {
  const root = makeFixture();
  try {
    assert.throws(() => prepareRelease({ bump: "banana", repoRoot: root }), /patch\|minor\|major/);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.version, "1.2.3");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
