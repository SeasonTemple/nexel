import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import * as opencode from "./opencode.mjs";
import { applyDefaults } from "./spi.mjs";
import { applyAdapterTransform } from "../core/plan.mjs";
import { stageAsset } from "../core/stage-asset.mjs";
import { hashFile, makeStagingDir } from "../core/filesystem.mjs";
import { AdapterError, ERR_TRANSFORM_FAILED } from "../core/errors.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_AGENT = path.resolve(HERE, "../../../examples/sample-product/agents/sample-example-agent.md");

const agentAsset = { assetType: "agent", id: "example-agent", sourceRelPath: "agents/sample-example-agent.md" };

function split(buf) {
  const t = buf.toString("utf8");
  const end = t.indexOf("\n---\n", 4);
  return { fm: parseYaml(t.slice(4, end + 1)), body: t.slice(end + 5) };
}

test("opencode: supportedAssetTypes re-admits agent (SPI v1.1)", () => {
  assert.deepEqual([...opencode.supportedAssetTypes], ["skill", "agent", "rule"]);
});

test("opencode.transformAssetContent: sample agent → description + mode:subagent, drops tools/model/color, body byte-identical", () => {
  const input = fs.readFileSync(SAMPLE_AGENT);
  const out = opencode.transformAssetContent(agentAsset, input);
  const inParsed = split(input);
  const outParsed = split(out);

  assert.deepEqual(Object.keys(outParsed.fm).sort(), ["description", "mode"]);
  assert.equal(outParsed.fm.mode, "subagent");
  assert.equal(outParsed.fm.description, inParsed.fm.description, "description preserved verbatim");
  assert.equal(outParsed.body, inParsed.body, "body bytes must be byte-identical (ADR-0002 D3)");
});

test("opencode tool-posture (grill Q5 / ADR-0002 D4): sample tools:[Read,Grep,Glob] does NOT survive", () => {
  const input = fs.readFileSync(SAMPLE_AGENT);
  const inParsed = split(input);
  // Precondition: the sample agent is deliberately restricted on Claude.
  assert.deepEqual(inParsed.fm.tools, ["Read", "Grep", "Glob"]);

  const out = opencode.transformAssetContent(agentAsset, input);
  const outParsed = split(out);
  // Documented divergence: tools/model absent in the OpenCode output, so the
  // agent runs at OpenCode's DEFAULT subagent tool access. This is the named,
  // accepted capability divergence recorded in ADR-0002 D4 — asserted here so
  // it is visible/regression-guarded, not silent.
  assert.equal("tools" in outParsed.fm, false, "tools: dropped (no OpenCode array-allowlist equivalent — ADR-0002 D4)");
  assert.equal("model" in outParsed.fm, false, "model: dropped (subagent inherits parent provider)");
});

test("opencode.transformAssetContent: skill/rule asset → identity (same Buffer ref)", () => {
  const buf = Buffer.from("---\nname: x\n---\nbody\n", "utf8");
  assert.equal(opencode.transformAssetContent({ assetType: "skill", id: "s" }, buf), buf);
  assert.equal(opencode.transformAssetContent({ assetType: "rule", id: "rules/r.md" }, buf), buf);
});

test("opencode.transformAssetContent: agent without leading frontmatter → identity", () => {
  const buf = Buffer.from("no frontmatter here\n", "utf8");
  assert.equal(opencode.transformAssetContent(agentAsset, buf), buf);
});

test("opencode.transformAssetContent: agent with malformed YAML → pass-through (surfaces at OpenCode boot)", () => {
  const buf = Buffer.from("---\n: : : not yaml : :\n---\nbody\n", "utf8");
  const out = opencode.transformAssetContent(agentAsset, buf);
  assert.equal(out, buf);
});

test("opencode.transformAssetContent: missing description → throws (fail-fast on source defect)", () => {
  const buf = Buffer.from("---\nname: x\ntools: [\"Read\"]\n---\nbody\n", "utf8");
  assert.throws(() => opencode.transformAssetContent(agentAsset, buf), /missing `description`/);
});

test("opencode.transformAssetContent: empty description → throws", () => {
  const buf = Buffer.from("---\nname: x\ndescription: \"  \"\n---\nbody\n", "utf8");
  assert.throws(() => opencode.transformAssetContent(agentAsset, buf), /non-empty string/);
});

test("opencode via applyAdapterTransform: throw surfaces as AdapterError(ERR_TRANSFORM_FAILED)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-"));
  try {
    const p = path.join(dir, "bad.md");
    fs.writeFileSync(p, "---\nname: x\n---\nbody\n"); // no description
    const asset = { assetType: "agent", id: "bad", sourceRelPath: "agents/bad.md", sourceAbs: p };
    try {
      // SPI v1.3: applyAdapterTransform folds a canonical pipeline. The hook
      // auto-promotes to a 1-stage pipeline (ADR-0020); pass that shape. (F2)
      const pipeline = [{ id: "transformAssetContent", run: opencode.transformAssetContent }];
      applyAdapterTransform(asset, pipeline, { adapterId: "opencode", stage: "stage" });
      assert.fail("should throw");
    } catch (e) {
      assert.ok(e instanceof AdapterError);
      assert.equal(e.code, ERR_TRANSFORM_FAILED);
      assert.equal(e.details.adapterId, "opencode");
      assert.equal(e.details.stage, "stage");
      assert.equal(e.details.stageId, "transformAssetContent");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("opencode via stageAsset: transformed agent staged, cross-stage invariant holds", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc-st-"));
  try {
    const stagingDir = makeStagingDir(root, "ocrun");
    const asset = { assetType: "agent", id: "example-agent", sourceRelPath: "agents/sample-example-agent.md", sourceAbs: SAMPLE_AGENT };
    // Resolve the adapter through applyDefaults so its transformAssetContent
    // auto-promotes to a 1-stage contentPipeline (SPI v1.3, ADR-0020) — the
    // shape stageAsset now consumes. Regression guard for auto-promotion.
    const r = stageAsset({ asset, adapter: applyDefaults(opencode), stagingDir, targetRel: "agent/sample-example-agent.md" });
    assert.equal(r.transformed, true, "non-identity transform on an agent");
    const staged = path.join(stagingDir, "agent/sample-example-agent.md");
    assert.equal(r.sha256, hashFile(staged).sha256, "ADR-0002 D2 invariant: sha256 == hashFile(staged)");
    const outParsed = split(fs.readFileSync(staged));
    assert.deepEqual(Object.keys(outParsed.fm).sort(), ["description", "mode"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
