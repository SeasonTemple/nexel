import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { stageAsset, hashTransformed } from "./stage-asset.mjs";
import { hashFile, makeStagingDir, FsError } from "./filesystem.mjs";
import { AdapterError, ERR_TRANSFORM_FAILED } from "./errors.mjs";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "stageasset-"));
}

function writeSource(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

// SPI v1.3: stageAsset/hashTransformed read the adapter's RESOLVED
// contentPipeline (ADR-0020). These fixtures are shaped like post-applyDefaults
// adapters — they declare contentPipeline directly rather than the legacy
// transformAssetContent hook (which only matters pre-resolution). doc-review F1.
const idAdapter = { id: "id-adapter", contentPipeline: [] }; // empty → identity
const bangAdapter = {
  id: "bang",
  contentPipeline: [{ id: "bang", run: (a, body) => Buffer.concat([body, Buffer.from("!")]) }],
};
const twoStageAdapter = {
  id: "two",
  contentPipeline: [
    { id: "a", run: (x, body) => Buffer.concat([body, Buffer.from("A")]) },
    { id: "b", run: (x, body) => Buffer.concat([body, Buffer.from("B")]) },
  ],
};

test("stageAsset: identity adapter → staged == source, sha256 == hashFile(source), transformed:false", () => {
  const root = tmpRoot();
  try {
    const src = writeSource(root, "src/a.md", "hello\n");
    const stagingDir = makeStagingDir(root, "run1");
    const asset = { assetType: "skill", id: "s", sourceRelPath: "src/a.md", sourceAbs: src };
    const r = stageAsset({ asset, adapter: idAdapter, stagingDir, targetRel: "a.md" });
    assert.equal(r.transformed, false);
    const staged = path.join(stagingDir, "a.md");
    assert.equal(fs.readFileSync(staged, "utf8"), "hello\n");
    assert.equal(r.sha256, hashFile(src).sha256);
    assert.equal(r.sha256, hashFile(staged).sha256, "cross-stage invariant: sha256 == hashFile(staged)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stageAsset: non-identity adapter → staged == transformed, sha256 != source, transformed:true", () => {
  const root = tmpRoot();
  try {
    const src = writeSource(root, "src/b.md", "body\n");
    const stagingDir = makeStagingDir(root, "run2");
    const asset = { assetType: "agent", id: "g", sourceRelPath: "src/b.md", sourceAbs: src };
    const r = stageAsset({ asset, adapter: bangAdapter, stagingDir, targetRel: "b.md" });
    assert.equal(r.transformed, true);
    const staged = path.join(stagingDir, "b.md");
    assert.equal(fs.readFileSync(staged, "utf8"), "body\n!");
    assert.notEqual(r.sha256, hashFile(src).sha256);
    assert.equal(r.sha256, hashFile(staged).sha256, "invariant holds for transformed bytes");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stageAsset: multi-stage pipeline applies in order, cross-stage hash invariant holds", () => {
  const root = tmpRoot();
  try {
    const src = writeSource(root, "src/m.md", "x");
    const stagingDir = makeStagingDir(root, "run-multi");
    const asset = { assetType: "agent", id: "m", sourceRelPath: "src/m.md", sourceAbs: src };
    const r = stageAsset({ asset, adapter: twoStageAdapter, stagingDir, targetRel: "m.md" });
    assert.equal(r.transformed, true);
    const staged = path.join(stagingDir, "m.md");
    assert.equal(fs.readFileSync(staged, "utf8"), "xAB", "stage a before stage b");
    assert.equal(r.sha256, hashFile(staged).sha256, "invariant holds through a 2-stage pipeline");
    // plan-side hashTransformed reproduces the same hash without writing.
    const planSide = hashTransformed({ asset, adapter: twoStageAdapter, stage: "plan" });
    assert.equal(planSide.sha256, r.sha256, "plan-side multi-stage hash == stage-side");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stageAsset: empty source → empty staged, sha256 == empty-buffer hash", () => {
  const root = tmpRoot();
  try {
    const src = writeSource(root, "src/empty.md", "");
    const stagingDir = makeStagingDir(root, "run3");
    const asset = { assetType: "rule", id: "rules/e.md", sourceRelPath: "src/empty.md", sourceAbs: src };
    const r = stageAsset({ asset, adapter: idAdapter, stagingDir, targetRel: "e.md" });
    assert.equal(r.bytes, 0);
    assert.equal(r.sha256, EMPTY_SHA256);
    assert.equal(fs.readFileSync(path.join(stagingDir, "e.md")).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stageAsset: binary/non-text extension → normalization byte-exact", () => {
  const root = tmpRoot();
  try {
    const src = writeSource(root, "src/x.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    const stagingDir = makeStagingDir(root, "run4");
    const asset = { assetType: "rule", id: "rules/x.png", sourceRelPath: "src/x.png", sourceAbs: src };
    const r = stageAsset({ asset, adapter: idAdapter, stagingDir, targetRel: "x.png" });
    assert.equal(r.normalization, "byte-exact");
    assert.equal(r.sha256, hashFile(path.join(stagingDir, "x.png")).sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stageAsset: throwing adapter → AdapterError(ERR_TRANSFORM_FAILED) .details.stage=stage", () => {
  const root = tmpRoot();
  try {
    const src = writeSource(root, "src/c.md", "x");
    const stagingDir = makeStagingDir(root, "run5");
    const asset = { assetType: "agent", id: "boom", sourceRelPath: "src/c.md", sourceAbs: src };
    const adapter = { id: "oc", contentPipeline: [{ id: "kaput", run: () => { throw new Error("kaput"); } }] };
    try {
      stageAsset({ asset, adapter, stagingDir, targetRel: "c.md" });
      assert.fail("should throw");
    } catch (e) {
      assert.ok(e instanceof AdapterError);
      assert.equal(e.code, ERR_TRANSFORM_FAILED);
      assert.equal(e.details.stage, "stage");
      assert.equal(e.details.stageId, "kaput", "names the failing pipeline stage (ADR-0020 D4)");
      assert.equal(e.details.adapterId, "oc");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stageAsset: stageWrite path validation (traversal) → FsError passthrough", () => {
  const root = tmpRoot();
  try {
    const src = writeSource(root, "src/d.md", "x");
    const stagingDir = makeStagingDir(root, "run6");
    const asset = { assetType: "rule", id: "r", sourceRelPath: "src/d.md", sourceAbs: src };
    assert.throws(
      () => stageAsset({ asset, adapter: idAdapter, stagingDir, targetRel: "../escape.md" }),
      (e) => e instanceof FsError
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hashTransformed: same result as stageAsset, writes NO file", () => {
  const root = tmpRoot();
  try {
    const src = writeSource(root, "src/e.md", "shared\n");
    const stagingDir = makeStagingDir(root, "run7");
    const asset = { assetType: "agent", id: "g2", sourceRelPath: "src/e.md", sourceAbs: src };
    const planSide = hashTransformed({ asset, adapter: bangAdapter, stage: "plan" });
    const stageSide = stageAsset({ asset, adapter: bangAdapter, stagingDir, targetRel: "e.md" });
    assert.equal(planSide.sha256, stageSide.sha256, "plan-side hash must equal stage-side hash");
    assert.equal(planSide.transformed, stageSide.transformed);
    assert.equal(planSide.bytes, stageSide.bytes);
    // hashTransformed must not have created any file of its own.
    assert.equal(fs.existsSync(path.join(stagingDir, "plan-side-marker")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stage-asset is core-internal: not re-exported from index.mjs", async () => {
  const idx = await import("../index.mjs");
  assert.equal("stageAsset" in idx, false);
  assert.equal("hashTransformed" in idx, false);
  assert.equal("applyAdapterTransform" in idx, false);
});
