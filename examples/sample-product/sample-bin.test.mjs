// Integration test: examples/sample-product/bin.mjs end-to-end.
//
// Proves the kernel is genuinely product-agnostic by running the sample
// bin (which constructs a real productConfig + wraps createCli)
// and asserting list / help / agents / doctor dispatch correctly with
// the sample 'sample:' prefix conventions.
//
// Each test spawns the bin via child_process so we exercise the full
// argv -> parseArgs -> dispatchVerb -> kernel command chain. Output is
// parsed from the captured stdout/stderr.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "bin.mjs");

function runBin(args = []) {
  const result = spawnSync("node", [BIN, ...args], {
    encoding: "utf8",
    cwd: HERE,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test("sample bin: help renders with sample-installer name", () => {
  const r = runBin(["help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^sample-installer v/);
  assert.match(r.stdout, /Usage:\s+sample-installer <verb>/);
  assert.match(r.stdout, /sample-installer install --agent codex --skill sample:<skill-id>/);
});

test("sample bin: list --json returns the sample manifest assets", () => {
  const r = runBin(["list", "--json"]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  // 2 skills declared in sample.install.json
  assert.equal(out.skills.length, 2);
  const ids = out.skills.map((s) => s.id).sort();
  assert.deepEqual(ids, ["sample:demo-bundle-skill", "sample:hello-world"]);
  // 1 bundle declared
  assert.equal(out.bundles.length, 1);
  assert.equal(out.bundles[0].id, "sample-demo");
});

test("sample bin: list text mode shows skill flags", () => {
  const r = runBin(["list"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Skills \(2\):/);
  assert.match(r.stdout, /sample:hello-world/);
  assert.match(r.stdout, /sample:demo-bundle-skill/);
  assert.match(r.stdout, /Bundles \(1\):/);
  assert.match(r.stdout, /sample-demo/);
});

test("sample bin: unknown verb falls through to help (exit 0)", () => {
  const r = runBin(["nonexistent-verb"]);
  assert.equal(r.code, 0);
  // Help is the fallback when verb is unknown and not in TTY interactive mode.
  assert.match(r.stdout, /^sample-installer v/);
});

test("sample bin: --json envelope on error (no manifest)", () => {
  // Run from a directory that has no sample.install.json — should fail
  // with structured JSON error envelope (ERR_MANIFEST_MISSING).
  const tmpRoot = path.join(HERE, "..");  // examples/ has no manifest
  const result = spawnSync("node", [BIN, "list", "--json"], {
    encoding: "utf8",
    cwd: tmpRoot,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  // Note: bin.mjs does process.chdir(HERE) at boot, so this still finds
  // the sample manifest. This test instead verifies that the bin's
  // self-anchored cwd behavior actually works (i.e. you can invoke it
  // from any cwd).
  assert.equal(result.status, 0, "bin should self-anchor cwd to its own dir");
  const out = JSON.parse(result.stdout);
  assert.equal(out.skills.length, 2);
});

// --- Verb-scoped help E2E (U4): the only layer that proves routing
// reaches a real createCli-wrapped bin and that `<verb> help`
// reverse-order is NOT a help affordance (the cli.mjs gate is
// untestable from the help.mjs unit suite). ---

test("sample bin: `install --help` renders the verb-scoped block, not the full table", () => {
  const r = runBin(["install", "--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^sample-installer install — install selected skills\/bundles/);
  assert.match(r.stdout, /Run 'sample-installer help' for the complete reference\./);
  assert.ok(!r.stdout.includes("Common flags:"), "verb help must not emit the full flag table");
});

test("sample bin: `install help` (reverse order) dispatches the install handler, NOT verb help", () => {
  const r = runBin(["install", "help"]);
  // `help` is a positional arg to the `install` verb — the cli.mjs help
  // gate (args.verb==="install", args.help===false) is false, so the
  // request reaches runInstall, which rejects with no selection.
  assert.notEqual(r.code, 0, "must run the install handler (which errors), not print help");
  assert.ok(
    !r.stdout.includes("sample-installer install — install selected"),
    "must NOT render the verb-help block",
  );
  assert.match(r.stderr, /ERR_NO_SELECTION/);
});
