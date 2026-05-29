import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyAdapterTransform } from "./plan.mjs";
import { AdapterError, ERR_TRANSFORM_FAILED } from "./errors.mjs";

const baseAsset = (over = {}) => ({
  assetType: "agent",
  id: "sample-example-agent",
  sourceRelPath: "agents/sample-example-agent.md",
  sourceBuf: Buffer.from("---\nname: x\ndescription: a\n---\nbody\n", "utf8"),
  ...over,
});

// ---- applyAdapterTransform (SPI v1.3 contentPipeline fold primitive) ----
// 2nd arg is now a canonical Stage[] (`{id, run}`), not a single fn (ADR-0020).

const stage = (id, run) => ({ id, run });

test("applyAdapterTransform: undefined pipeline → identity, transformed:false, same Buffer ref", () => {
  const asset = baseAsset();
  const { resultBuf, transformed } = applyAdapterTransform(asset, undefined, { stage: "plan" });
  assert.equal(transformed, false);
  assert.equal(resultBuf, asset.sourceBuf, "identity must return the SAME Buffer instance");
});

test("applyAdapterTransform: empty-array pipeline → identity, transformed:false, same Buffer ref", () => {
  const asset = baseAsset();
  const { resultBuf, transformed } = applyAdapterTransform(asset, [], { adapterId: "x", stage: "stage" });
  assert.equal(transformed, false);
  assert.equal(resultBuf, asset.sourceBuf, "empty pipeline must return the SAME Buffer instance");
});

test("applyAdapterTransform: 1-stage identity pipeline → transformed:false (ref equality)", () => {
  const asset = baseAsset();
  const pipeline = [stage("id", (a, body) => body)];
  const { resultBuf, transformed } = applyAdapterTransform(asset, pipeline, { adapterId: "x", stage: "stage" });
  assert.equal(transformed, false);
  assert.equal(resultBuf, asset.sourceBuf);
});

test("applyAdapterTransform: 1-stage non-identity → transformed:true, new bytes", () => {
  const asset = baseAsset();
  const pipeline = [stage("bang", (a, body) => Buffer.concat([body, Buffer.from("!")]))];
  const { resultBuf, transformed } = applyAdapterTransform(asset, pipeline, { adapterId: "oc", stage: "stage" });
  assert.equal(transformed, true);
  assert.notEqual(resultBuf, asset.sourceBuf);
  assert.equal(resultBuf.toString("utf8"), asset.sourceBuf.toString("utf8") + "!");
});

test("applyAdapterTransform: multi-stage applies in declared order", () => {
  const asset = baseAsset({ sourceBuf: Buffer.from("x", "utf8") });
  const pipeline = [
    stage("a", (a, body) => Buffer.concat([body, Buffer.from("A")])),
    stage("b", (a, body) => Buffer.concat([body, Buffer.from("B")])),
  ];
  const { resultBuf, transformed } = applyAdapterTransform(asset, pipeline, { adapterId: "m", stage: "stage" });
  assert.equal(transformed, true);
  assert.equal(resultBuf.toString("utf8"), "xAB", "stage a runs before stage b");
});

test("applyAdapterTransform: net result is a new Buffer even when bytes equal source → transformed:true", () => {
  // Two stages that cancel out by value but allocate a fresh Buffer. The flag
  // is reference inequality vs the ORIGINAL, so this is transformed:true.
  const asset = baseAsset({ sourceBuf: Buffer.from("x", "utf8") });
  const pipeline = [
    stage("up", (a, body) => Buffer.from(body.toString("utf8").toUpperCase(), "utf8")),
    stage("down", (a, body) => Buffer.from(body.toString("utf8").toLowerCase(), "utf8")),
  ];
  const { resultBuf, transformed } = applyAdapterTransform(asset, pipeline, { adapterId: "m", stage: "stage" });
  assert.equal(resultBuf.toString("utf8"), "x");
  assert.notEqual(resultBuf, asset.sourceBuf);
  assert.equal(transformed, true, "reference inequality vs original source is the contract (ADR-0020 D3)");
});

test("applyAdapterTransform: stage run receives only {assetType,id,sourceRelPath}", () => {
  const asset = baseAsset();
  let seen;
  applyAdapterTransform(asset, [stage("s", (a, body) => { seen = a; return body; })], { stage: "plan" });
  assert.deepEqual(Object.keys(seen).sort(), ["assetType", "id", "sourceRelPath"]);
  assert.equal(seen.id, "sample-example-agent");
});

test("applyAdapterTransform: a throwing stage → ERR_TRANSFORM_FAILED with stageId + stage", () => {
  const asset = baseAsset();
  const boom = new Error("nope");
  const pipeline = [
    stage("ok", (a, body) => body),
    stage("explode", () => { throw boom; }),
  ];
  try {
    applyAdapterTransform(asset, pipeline, { adapterId: "oc", stage: "stage" });
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof AdapterError);
    assert.equal(e.code, ERR_TRANSFORM_FAILED);
    assert.equal(e.details.stage, "stage", "invocation-site provenance");
    assert.equal(e.details.stageId, "explode", "names the FAILING pipeline stage (ADR-0020 D4)");
    assert.equal(e.details.adapterId, "oc");
    assert.equal(e.details.assetId, "sample-example-agent");
    assert.equal(e.details.assetType, "agent");
    assert.equal(e.details.cause, boom);
  }
});

test("applyAdapterTransform: non-Buffer stage return → ERR_TRANSFORM_FAILED with stageId, cause null", () => {
  const asset = baseAsset();
  try {
    applyAdapterTransform(asset, [stage("bad", () => "i am a string")], { adapterId: "oc", stage: "plan" });
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof AdapterError);
    assert.equal(e.code, ERR_TRANSFORM_FAILED);
    assert.equal(e.details.stage, "plan");
    assert.equal(e.details.stageId, "bad");
    assert.equal(e.details.cause, null);
  }
});

test("applyAdapterTransform: in-place Buffer mutation returning same ref → transformed:false (hazard witness)", () => {
  // ADR-0020 / doc-review A4: stages MUST treat the threaded Buffer as
  // read-only. A stage that mutates in place and returns the SAME reference
  // makes `transformed` compute false even though bytes changed — which would
  // silently desync the staged bytes from the recorded hash. This test pins
  // that hazard so a future in-place stage is caught and the read-only contract
  // stays documented.
  const asset = baseAsset({ sourceBuf: Buffer.from("abc", "utf8") });
  const pipeline = [stage("mutate", (a, body) => { body[0] = 0x7a; return body; })]; // 'a' -> 'z'
  const { resultBuf, transformed } = applyAdapterTransform(asset, pipeline, { adapterId: "m", stage: "stage" });
  assert.equal(resultBuf, asset.sourceBuf, "same reference returned");
  assert.equal(transformed, false, "same-ref mutation defeats the transformed flag — the documented hazard");
});

test("applyAdapterTransform: reads sourceAbs when no sourceBuf provided", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
  try {
    const p = path.join(dir, "a.md");
    fs.writeFileSync(p, "disk-bytes");
    const asset = { assetType: "rule", id: "rules/x.md", sourceRelPath: "rules/x.md", sourceAbs: p };
    const { resultBuf, transformed } = applyAdapterTransform(asset, undefined, { stage: "plan" });
    assert.equal(transformed, false);
    assert.equal(resultBuf.toString("utf8"), "disk-bytes");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
