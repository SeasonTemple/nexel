// ADR-0018 smoke test for `.github/workflows/release.yml`.
//
// We can't spin up GitHub Actions locally without `act`, but we can pin
// the structural invariants the CI bless path depends on:
//
//   1. The workflow parses as valid YAML.
//   2. Both `review-gate` and `release` jobs exist.
//   3. `release` declares `needs: review-gate`.
//   4. `release` advances only when the gate output is "true".
//   5. The `release` job sets `NEXEL_CI_BLESSED: "true"` on its env so
//      `scripts/verify-release-tag.mjs` accepts the tag push.
//   6. The `review-gate` step re-runs the deterministic review checks
//      (`npm test`, `npm run release:preflight`, `npm run lint:release-sync`)
//      AND blocks hook-bypass markers in commit messages.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(HERE, "release.yml");

test("release.yml parses as YAML", () => {
  const text = fs.readFileSync(WORKFLOW, "utf8");
  assert.doesNotThrow(() => parseYaml(text));
});

test("release.yml declares review-gate and release jobs", () => {
  const wf = parseYaml(fs.readFileSync(WORKFLOW, "utf8"));
  assert.ok(wf.jobs, "expected jobs map");
  assert.ok(wf.jobs["review-gate"], "expected review-gate job");
  assert.ok(wf.jobs.release, "expected release job");
});

test("release.yml: release job needs review-gate and gates on blessed output", () => {
  const wf = parseYaml(fs.readFileSync(WORKFLOW, "utf8"));
  const release = wf.jobs.release;
  assert.equal(release.needs, "review-gate");
  assert.match(
    release.if,
    /needs\.review-gate\.outputs\.blessed\s*==\s*'true'/,
    `release.if must gate on review-gate.outputs.blessed == 'true'; got: ${release.if}`,
  );
});

test("release.yml: release job sets NEXEL_CI_BLESSED=true on env", () => {
  const wf = parseYaml(fs.readFileSync(WORKFLOW, "utf8"));
  assert.ok(wf.jobs.release.env, "expected release.env to be defined");
  assert.equal(wf.jobs.release.env.NEXEL_CI_BLESSED, "true");
});

test("release.yml: review-gate re-runs the deterministic review checks", () => {
  const wf = parseYaml(fs.readFileSync(WORKFLOW, "utf8"));
  const steps = wf.jobs["review-gate"].steps;
  const script = steps.map((s) => s.run || "").join("\n");
  for (const cmd of ["npm test", "npm run release:preflight", "npm run lint:release-sync"]) {
    assert.ok(script.includes(cmd), `review-gate must run ${cmd}`);
  }
});

test("release.yml: review-gate blocks hook-bypass markers in commit messages", () => {
  const wf = parseYaml(fs.readFileSync(WORKFLOW, "utf8"));
  const script = wf.jobs["review-gate"].steps
    .map((s) => s.run || "")
    .join("\n");
  // Match the documented escape hatches from ADR-0013 (lines 80-85).
  for (const needle of ["no-verify", "HUSKY=0", "core\\.hooksPath=/dev/null"]) {
    assert.ok(
      script.includes(needle),
      `review-gate must scan commit messages for ${needle}`,
    );
  }
});

test("release.yml: review-gate emits blessed=true output the release job consumes", () => {
  const wf = parseYaml(fs.readFileSync(WORKFLOW, "utf8"));
  const gate = wf.jobs["review-gate"];
  assert.ok(gate.outputs, "expected review-gate.outputs");
  assert.match(
    String(gate.outputs.blessed || ""),
    /steps\.gate\.outputs\.blessed/,
    "review-gate.outputs.blessed must read from the gate step's outputs",
  );
  const script = gate.steps.map((s) => s.run || "").join("\n");
  assert.match(
    script,
    /blessed=true"?\s*>>\s*"?\$GITHUB_OUTPUT"?/,
    "gate step must write blessed=true to GITHUB_OUTPUT",
  );
});
