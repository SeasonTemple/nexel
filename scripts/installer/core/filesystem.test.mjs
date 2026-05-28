// Targeted tests for filesystem.mjs TOCTOU defense (ADR-0019).
//
// Broader filesystem.mjs coverage is shipped via stage-asset.test.mjs +
// installer end-to-end tests; this file isolates the
// `promoteStagedFiles` TOCTOU window so the defense has a direct witness.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { promoteStagedFiles, makeStagingDir, stageWrite } from "./filesystem.mjs";
import { ERR_TOCTOU_RACE_DETECTED } from "./errors.mjs";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-filesystem-toctou-"));
}

test("ADR-0019: promoteStagedFiles detects dst swapped to symlink mid-window", () => {
  const root = makeTempRoot();
  try {
    const rel = "skills/alpha/SKILL.md";
    const dst = path.join(root, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, "original\n");

    const staging = makeStagingDir(root, "test-run");
    stageWrite(staging, rel, "new content\n");

    const decoy = path.join(root, "decoy");
    fs.writeFileSync(decoy, "decoy-content\n");

    const origLstat = fs.lstatSync;
    let dstCalls = 0;
    let symlinkable = true;
    fs.lstatSync = function patched(p, opts) {
      if (p === dst) {
        dstCalls += 1;
        if (dstCalls === 2) {
          try {
            fs.unlinkSync(dst);
            fs.symlinkSync.call(fs, decoy, dst);
          } catch (e) {
            if (e.code === "EPERM" || e.code === "EACCES") {
              symlinkable = false;
            } else {
              fs.lstatSync = origLstat;
              throw e;
            }
          }
        }
      }
      return origLstat.call(fs, p, opts);
    };

    let caught = null;
    try {
      promoteStagedFiles(staging, root, [rel]);
    } catch (e) {
      caught = e;
    } finally {
      fs.lstatSync = origLstat;
    }
    if (!symlinkable) return;
    assert.ok(caught, "promoteStagedFiles must throw when dst is raced to a symlink");
    assert.equal(caught.code, ERR_TOCTOU_RACE_DETECTED);
    assert.equal(fs.readFileSync(decoy, "utf8"), "decoy-content\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ADR-0019 regression witness: promoteStagedFiles still works on the happy path", () => {
  const root = makeTempRoot();
  try {
    const rel = "skills/alpha/SKILL.md";
    const staging = makeStagingDir(root, "test-run-2");
    stageWrite(staging, rel, "content\n");
    const promoted = promoteStagedFiles(staging, root, [rel]);
    assert.equal(promoted.length, 1);
    assert.equal(fs.readFileSync(promoted[0], "utf8"), "content\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
