import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const BIN = "scripts/install-skills.mjs";

function runDemo(args = []) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test("install-skills demo: --help documents the safe sample-product flow", () => {
  const r = runDemo(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^nexel sample-product install demo/);
  assert.match(r.stdout, /node scripts\/install-skills\.mjs --demo --yes --json --cleanup/);
  assert.match(r.stdout, /not to ~\/\.codex, ~\/\.claude, or ~\/\.config\/opencode/);
});

test("install-skills demo: non-interactive run installs into temp target and cleans it", () => {
  const r = runDemo(["--demo", "--yes", "--json", "--cleanup"]);
  assert.equal(r.code, 0, r.stderr);

  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.cleaned, true);
  assert.deepEqual(out.selectionIds, ["sample-demo"]);
  assert.equal(out.writtenCount, 3);
  assert.ok(out.targetRoot.includes("nexel-demo-"));
  assert.equal(fs.existsSync(out.targetRoot), false, "cleanup removes the temporary target");
  assert.deepEqual(out.files.sort(), [
    ".nexel/state.json",
    "agents/sample-example-agent.md",
    "rules/sample-rule.md",
    "skills/demo-bundle-skill/SKILL.md",
  ]);
});

test("install-skills demo: ordinary verbs are forwarded to the sample bin", () => {
  const r = runDemo(["list", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.skills.length, 2);
  assert.equal(out.bundles[0].id, "sample-demo");
});
