import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { runPackageSmoke } from "./package-smoke.mjs";

test("package smoke passes for the real repo and cleans generated artifacts", () => {
  const result = runPackageSmoke();
  assert.equal(result.ok, true, result.missing.join("\n"));
  assert.equal(fs.existsSync(path.join(process.cwd(), result.artifact)), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), result.checksum)), false);
});

test("package smoke reports missing required package files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-package-smoke-"));
  try {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "tiny",
      version: "1.0.0",
      files: ["README.md"],
    }, null, 2));
    fs.writeFileSync(path.join(root, "README.md"), "# tiny\n");

    const result = runPackageSmoke({ repoRoot: root });
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes("package/assets/install-uninstall-flow.gif"));
    assert.equal(fs.existsSync(path.join(root, result.artifact)), false);
    assert.equal(fs.existsSync(path.join(root, result.checksum)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("package smoke CLI exits 0 and cleans artifacts", () => {
  const result = spawnSync(process.execPath, ["scripts/package-smoke.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /package-smoke: PASS/);
  assert.equal(fs.existsSync(path.join(process.cwd(), "nexel-0.6.1.tgz")), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), "nexel-0.6.1.tgz.sha256")), false);
});
