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
import fs from "node:fs";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "bin.mjs");

function runBin(args = [], env = {}) {
  const result = spawnSync("node", [BIN, ...args], {
    encoding: "utf8",
    cwd: HERE,
    env: { ...process.env, ...env, FORCE_COLOR: "0" },
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
  // 3 skills declared in sample.install.json (host-context added in v0.8 to exercise host-instructions:).
  assert.equal(out.skills.length, 3);
  const ids = out.skills.map((s) => s.id).sort();
  assert.deepEqual(ids, ["sample:demo-bundle-skill", "sample:hello-world", "sample:sample-host-context"]);
  // 1 bundle declared
  assert.equal(out.bundles.length, 1);
  assert.equal(out.bundles[0].id, "sample-demo");
});

test("sample bin: list text mode shows skill flags", () => {
  const r = runBin(["list"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Skills \(3\):/);
  assert.match(r.stdout, /sample:hello-world/);
  assert.match(r.stdout, /sample:demo-bundle-skill/);
  assert.match(r.stdout, /sample:sample-host-context/);
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
  assert.equal(out.skills.length, 3);
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

test("sample bin: `help install` (positional order) renders the verb-scoped block", () => {
  // Exercises the cli.mjs gate's `args.verb === "help"` + positional[0]
  // branch through a real createCli bin — the help.mjs unit suite calls
  // renderHelp directly and cannot reach this composition.
  const r = runBin(["help", "install"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^sample-installer install — install selected skills\/bundles/);
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

// --- run.mjs verb-handler + cli.mjs composition E2E (plan 003 U3).
// Spawn is the only honest exit-code/branch coverage for process.exit
// code (no in-process unit path; refactor is out of scope). ---

test("run: list/agents/plan emit shaped --json envelopes, exit 0", () => {
  const cases = [
    { verb: ["list"], shape: (o) => Array.isArray(o.skills) && Array.isArray(o.bundles) },
    { verb: ["agents"], shape: (o) => Array.isArray(o.adapters ?? o.agents ?? o) },
    { verb: ["plan", "--agent", "codex", "--skill", "sample:hello-world"], shape: (o) => o && (o.plan || o.targetRoot || Array.isArray(o.assets)) },
  ];
  for (const { verb, shape } of cases) {
    const r = runBin([...verb, "--json"]);
    assert.equal(r.code, 0, `${verb[0]} --json exit 0: ${r.stderr}`);
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(r.stdout); }, `${verb[0]} --json is parseable`);
    assert.ok(shape(parsed), `${verb[0]} --json envelope has the expected shape, got: ${JSON.stringify(parsed).slice(0, 120)}`);
  }
});

test("run: list/agents text mode exit 0, output on stdout", () => {
  const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "sample-bin-agents-"));
  for (const binName of ["claude", "codex", "opencode"]) {
    const binPath = path.join(fakeBinDir, binName);
    fs.writeFileSync(binPath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(binPath, 0o755);
  }
  const env = { PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH || ""}` };

  try {
    for (const verb of ["list", "agents"]) {
      const r = runBin([verb], env);
    assert.equal(r.code, 0, `${verb} text exit 0`);
    assert.ok(r.stdout.length > 0, `${verb} writes stdout`);
    }
  } finally {
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("run: validate exit-code contract (v0.3.1) — 0 clean / 1 finding / 2 precondition", () => {
  // 0: a valid sample SKILL.md
  assert.equal(runBin(["validate", "skills/hello-world/SKILL.md"]).code, 0, "valid SKILL.md → 0");
  // 2: missing path argument (precondition failure)
  assert.equal(runBin(["validate"]).code, 2, "missing path arg → 2");
  // 2: file not found (precondition failure)
  assert.equal(runBin(["validate", "skills/does-not-exist/SKILL.md"]).code, 2, "file-not-found → 2");
  // 1: a malformed SKILL.md (a lint finding, not a precondition failure)
  const bad = path.join(HERE, ".u3-bad-SKILL.md");
  fs.writeFileSync(bad, "---\nname: nope\n---\nno valid frontmatter fields\n");
  try {
    assert.equal(runBin(["validate", ".u3-bad-SKILL.md"]).code, 1, "malformed SKILL.md → 1 (finding, not 2)");
  } finally { fs.rmSync(bad, { force: true }); }
});

test("run: install with no selection → uniform --json error envelope on stdout (v0.3.1 contract, E2E)", () => {
  const r = runBin(["install", "--agent", "codex", "-y", "--json"]);
  assert.notEqual(r.code, 0, "no-selection install fails");
  const env = JSON.parse(r.stdout);
  assert.equal(env.ok, false);
  assert.equal(env.error, "ERR_NO_SELECTION");
  assert.ok("details" in env, "uniform envelope carries details");
  assert.equal(r.stdout.trim().split("\n").length, 1, "exactly one JSON line on stdout");
});

test("run: --target combined with multiple --agent is rejected (exit 2)", () => {
  const r = runBin(["install", "--target", "/tmp/u3-x", "--agent", "codex", "--agent", "claude-code", "--skill", "sample:hello-world", "-y"]);
  assert.equal(r.code, 2, "multi-agent + --target is a precondition failure (exit 2)");
  assert.match(`${r.stdout}${r.stderr}`, /--target cannot be combined with multiple --agent/,
    "the exact conflict message, not a loose 'multi' match");
});

test("run: unknown verb falls through to full help, exit 0", () => {
  const r = runBin(["frobnicate"]);
  assert.equal(r.code, 0, "unknown verb → help, exit 0 (R2 fallback)");
  assert.match(r.stdout, /^sample-installer v/);
  assert.ok(r.stdout.includes("Common flags:"), "unknown verb renders the full body");
});

// --- U7: scaffold verb (opt-in via createCli({enablePluginScaffolder: true})) ---

test("sample bin scaffold: clean target writes 6 files, exit 0", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "scaf-bin-clean-"));
  try {
    const r = runBin(["scaffold", "--target", target]);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
    assert.match(r.stdout, /wrote\s+6 file/);
    for (const rel of [
      ".claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
      ".codex-plugin/plugin.json",
      ".agents/plugins/marketplace.json",
      ".opencode/INSTALL.md",
      ".opencode/plugins/sample-product.js",
    ]) {
      assert.ok(fs.existsSync(path.join(target, rel)), `scaffolder must create ${rel}`);
    }
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("sample bin scaffold: re-run on populated target skips every file, exit 0", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "scaf-bin-skip-"));
  try {
    runBin(["scaffold", "--target", target]);
    const r = runBin(["scaffold", "--target", target]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /wrote\s+0 file/);
    assert.match(r.stdout, /skipped\s+6 file/);
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("sample bin scaffold: --force overwrites every file, exit 0", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "scaf-bin-force-"));
  try {
    runBin(["scaffold", "--target", target]);
    const r = runBin(["scaffold", "--target", target, "--force"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /wrote\s+6 file/);
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("sample bin scaffold: --json envelope is a single parseable line", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "scaf-bin-json-"));
  try {
    const r = runBin(["scaffold", "--target", target, "--json"]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.written.length, 6);
    assert.equal(parsed.skipped.length, 0);
    assert.ok(Array.isArray(parsed.warnings));
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

// NOT covered by construction (documented, not asserted — plan 003 U3):
//   * CancelledError → exit 130: thrown only inside prompts.mjs, which the
//     kernel/sample bin never invoke non-interactively. No spawn vector
//     can raise it; faking a TTY is out of scope.
//   * --profile env-var / target-suffix: cli.mjs sets
//     process.env[productConfig.envProfile] in the CHILD; a parent spawn
//     cannot observe it, and `agents --print-path` does not apply the
//     profile suffix (verified empirically). No clean spawn-observable
//     assertion exists via the sample bin; the env-set is internal.
//   * extraHandlers / validVerbs override: createCli constructor options
//     the thin sample bin does not exercise (it passes neither). Covered
//     by construction at the createCli call site, not spawn-observable here.

// --- nexel activate verb E2E (U6) ---
//
// Spawns the sample bin to exercise the full argv → dispatch → activateCommand
// → ambient-fence chain. Each test pins `HOME` and runs `activate --scope=user`
// against a tmp HOME, OR runs `--scope=project` from a tmp cwd, so no real
// user dotfiles are touched.

function spawnActivate(args, { tmpHome, tmpCwd } = {}) {
  const env = { ...process.env, FORCE_COLOR: "0" };
  if (tmpHome) env.HOME = tmpHome;
  return spawnSync("node", [BIN, "activate", ...args], {
    encoding: "utf8",
    cwd: tmpCwd ?? HERE,
    env,
  });
}

test("sample bin activate: refuses --target=opencode with ERR_ACTIVATE_OPENCODE_REFUSED", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "activate-home-"));
  try {
    const r = spawnActivate(["--target", "opencode", "--scope", "user", "--json"], { tmpHome });
    assert.notEqual(r.status, 0, "opencode refusal must be non-zero exit");
    const parsed = JSON.parse(r.stdout);
    const opencodeEntry = parsed.adapters.find((a) => a.adapter === "opencode");
    assert.equal(opencodeEntry.status, "refused");
    assert.equal(opencodeEntry.code, "ERR_ACTIVATE_OPENCODE_REFUSED");
    assert.ok(opencodeEntry.details.reason.includes("opencode-plugin"));
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("sample bin activate: --scope=user writes fences under tmp HOME", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "activate-home-"));
  try {
    const r = spawnActivate(["--scope", "user", "--json"], { tmpHome });
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    // T-04 fixup: envelope must carry a warnings array even when empty so
    // agents can rely on the field being present.
    assert.ok(Array.isArray(parsed.warnings), "warnings field must exist on activate --json envelope");
    const claudeEntry = parsed.adapters.find((a) => a.adapter === "claude");
    const codexEntry = parsed.adapters.find((a) => a.adapter === "codex");
    assert.equal(claudeEntry.status, "activated");
    assert.equal(codexEntry.status, "activated");
    // T-05 fixup: live-run entries carry discovered skill names.
    assert.ok(Array.isArray(claudeEntry.details.discovered));
    assert.ok(claudeEntry.details.discovered.includes("sample-host-context"));
    assert.equal(claudeEntry.details.targetPath, path.join(tmpHome, ".claude", "CLAUDE.md"));
    assert.equal(codexEntry.details.targetPath, path.join(tmpHome, ".codex", "AGENTS.md"));
    assert.ok(fs.existsSync(path.join(tmpHome, ".claude", "CLAUDE.md")));
    assert.ok(fs.existsSync(path.join(tmpHome, ".codex", "AGENTS.md")));
    // Both fences mention the sample-host-context skill (exercises the unified host-instructions key end-to-end).
    const claudeBody = fs.readFileSync(path.join(tmpHome, ".claude", "CLAUDE.md"), "utf8");
    assert.ok(claudeBody.includes("<!-- nexel:sample-product:begin -->"));
    assert.ok(claudeBody.includes("sample-host-context"));
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("sample bin activate: --dry-run --json reports would-activate without writes", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "activate-dry-"));
  try {
    const r = spawnActivate(["--scope", "user", "--dry-run", "--json"], { tmpHome });
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.dryRun, true);
    for (const entry of parsed.adapters) {
      assert.equal(entry.status, "would-activate");
      assert.ok(entry.details.discoveredCount >= 1, "discovers at least the sample-host-context skill");
    }
    assert.equal(fs.existsSync(path.join(tmpHome, ".claude", "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(tmpHome, ".codex", "AGENTS.md")), false);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("sample bin activate: idempotent re-run is changed:false per adapter", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "activate-idem-"));
  try {
    spawnActivate(["--scope", "user"], { tmpHome });
    const r = spawnActivate(["--scope", "user", "--json"], { tmpHome });
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    for (const entry of parsed.adapters.filter((a) => a.adapter !== "opencode")) {
      assert.equal(entry.status, "activated");
      assert.equal(entry.details.changed, false, `${entry.adapter} should be idempotent on re-run`);
    }
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("sample bin activate: rejects unknown --scope with ERR_ACTIVATE_INVALID_SCOPE", () => {
  const r = spawnActivate(["--scope", "bogus", "--json"]);
  assert.notEqual(r.status, 0);
  const stderr = r.stderr;
  assert.ok(
    stderr.includes("ERR_ACTIVATE_INVALID_SCOPE") || r.stdout.includes("ERR_ACTIVATE_INVALID_SCOPE"),
    `expected ERR_ACTIVATE_INVALID_SCOPE in output, got stderr=${stderr} stdout=${r.stdout}`,
  );
});
