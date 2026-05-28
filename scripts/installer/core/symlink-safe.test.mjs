import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { snapshotPreLockStats, verifyPostLockIntegrity } from "./symlink-safe.mjs";
import { ERR_TOCTOU_RACE_DETECTED } from "./errors.mjs";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-symlink-safe-"));
}

test("snapshotPreLockStats returns null for missing path", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "absent");
    assert.equal(snapshotPreLockStats(target), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("snapshotPreLockStats returns Stats for regular file", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "f");
    fs.writeFileSync(target, "x");
    const s = snapshotPreLockStats(target);
    assert.ok(s);
    assert.equal(s.isSymbolicLink(), false);
    assert.equal(typeof s.ino, "number");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyPostLockIntegrity passes when nothing changed", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "f");
    fs.writeFileSync(target, "x");
    const pre = snapshotPreLockStats(target);
    assert.doesNotThrow(() =>
      verifyPostLockIntegrity({ targetPath: target, preLockStats: pre, label: "t" }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyPostLockIntegrity throws ERR_TOCTOU_RACE_DETECTED when file became a symlink", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "f");
    fs.writeFileSync(target, "real");
    const pre = snapshotPreLockStats(target);
    const decoy = path.join(dir, "decoy");
    fs.writeFileSync(decoy, "decoy");
    fs.unlinkSync(target);
    try {
      fs.symlinkSync(decoy, target);
    } catch (e) {
      if (e.code === "EPERM" || e.code === "EACCES") return;
      throw e;
    }
    let caught = null;
    try {
      verifyPostLockIntegrity({ targetPath: target, preLockStats: pre, label: "t" });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught);
    assert.equal(caught.code, ERR_TOCTOU_RACE_DETECTED);
    assert.match(caught.message, /became a symlink/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyPostLockIntegrity throws ERR_TOCTOU_RACE_DETECTED when inode changed", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "f");
    fs.writeFileSync(target, "first");
    const pre = snapshotPreLockStats(target);
    fs.unlinkSync(target);
    fs.writeFileSync(target, "second");
    const post = fs.lstatSync(target);
    if (post.ino === pre.ino) {
      return;
    }
    let caught = null;
    try {
      verifyPostLockIntegrity({ targetPath: target, preLockStats: pre, label: "t" });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught);
    assert.equal(caught.code, ERR_TOCTOU_RACE_DETECTED);
    assert.match(caught.message, /inode changed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyPostLockIntegrity throws when file disappeared after a non-null snapshot", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "f");
    fs.writeFileSync(target, "x");
    const pre = snapshotPreLockStats(target);
    fs.unlinkSync(target);
    let caught = null;
    try {
      verifyPostLockIntegrity({ targetPath: target, preLockStats: pre, label: "t" });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught);
    assert.equal(caught.code, ERR_TOCTOU_RACE_DETECTED);
    assert.match(caught.message, /disappeared/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyPostLockIntegrity accepts null-preLock + still-missing post-lock", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "absent");
    assert.doesNotThrow(() =>
      verifyPostLockIntegrity({ targetPath: target, preLockStats: null, label: "t" }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyPostLockIntegrity accepts null-preLock + newly-created regular file post-lock", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "new");
    fs.writeFileSync(target, "x");
    assert.doesNotThrow(() =>
      verifyPostLockIntegrity({ targetPath: target, preLockStats: null, label: "t" }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyPostLockIntegrity rejects null-preLock + symlink post-lock", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "link");
    const decoy = path.join(dir, "decoy");
    fs.writeFileSync(decoy, "x");
    try {
      fs.symlinkSync(decoy, target);
    } catch (e) {
      if (e.code === "EPERM" || e.code === "EACCES") return;
      throw e;
    }
    let caught = null;
    try {
      verifyPostLockIntegrity({ targetPath: target, preLockStats: null, label: "t" });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught);
    assert.equal(caught.code, ERR_TOCTOU_RACE_DETECTED);
    assert.match(caught.message, /became a symlink/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
