// Product-coupled coverage of the kernel command functions, called
// DIRECTLY in-process (every commands/index.mjs fn takes productConfig +
// installerVersion as explicit params — the repair-rehash.test.mjs
// "not callable standalone" header describes that test's spawn-runner
// choice, not a constraint; verified by this suite passing). Real-fs:
// temp target dir + the examples/sample-product/ fixture; CLI-presence
// gate bypassed via target + allowNoCli. (Plan 2026-05-18-003 U1.)

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  install, uninstall, update, repair,
  installMulti, updateMulti, uninstallMulti,
  listCommand, agentsCommand, doctorCommand,
  exportCommand, importCommand, planSelection, planCommandText,
  getRepoCommit,
  assertValidExistingState, assertStateSelectionsKnown,
} from "./index.mjs";
import { writeStateAtomic, stateDirFor } from "../../core/filesystem.mjs";
import { loadManifest } from "../../core/manifest/loader.mjs";
import { readState, STATE_DIRNAME } from "../../core/filesystem.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const SAMPLE = path.join(REPO, "examples/sample-product");
const MANIFEST = path.join(SAMPLE, "sample.install.json");
const productConfig = (await import(path.join(SAMPLE, "agent-skills.config.mjs"))).default;
const manifest = loadManifest(MANIFEST);

function tmp(pfx) { return fs.mkdtempSync(path.join(os.tmpdir(), pfx)); }
function base(extra = {}) {
  return {
    repoRoot: SAMPLE, adapterId: "claude-code", productConfig, manifest,
    installerVersion: "test", allowNoCli: true, env: process.env, ...extra,
  };
}

test("install: fresh install writes file + state, returns ok shape", async () => {
  const target = tmp("u1-inst-");
  try {
    const r = await install(base({ target, selectionIds: ["sample:hello-world"] }));
    assert.equal(r.ok, true);
    assert.equal(r.writtenCount, 2);
    const st = readState(target);
    assert.equal(st.managedFiles.length, 2);
    const rels = st.managedFiles.map((file) => file.relPath).sort();
    assert.deepEqual(rels, [
      "skills/hello-world/SKILL.md",
      "skills/hello-world/references/opencode-instructions.md",
    ]);
    for (const rel of rels) assert.ok(fs.existsSync(path.join(target, rel)), `${rel} on disk`);
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("install: re-install is already-installed skip (idempotent)", async () => {
  const target = tmp("u1-idem-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const r2 = await install(base({ target, selectionIds: ["sample:hello-world"] }));
    assert.equal(r2.ok, true);
    assert.equal(r2.writtenCount, 0, "nothing re-written");
    assert.ok((r2.alreadyInstalled?.length ?? 0) >= 1, "reported already-installed");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("install: --dry-run plans without writing", async () => {
  const target = tmp("u1-dry-");
  try {
    const r = await install(base({ target, selectionIds: ["sample:hello-world"], dryRun: true }));
    assert.equal(r.dryRun, true);
    assert.ok(r.plan, "plan returned");
    assert.equal(readState(target), null, "dry-run persists no state");
    assert.deepEqual(fs.readdirSync(target), [], "dry-run writes nothing to the target");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("install: empty selection throws ERR_NO_SELECTION (correct behavior)", async () => {
  const target = tmp("u1-empty-");
  try {
    await assert.rejects(
      () => install(base({ target, selectionIds: [] })),
      (e) => e?.code === "ERR_NO_SELECTION",
      "empty selection must be rejected with ERR_NO_SELECTION, not silently succeed",
    );
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: state-aware delete removes file + state entry", async () => {
  const target = tmp("u1-uninst-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const rel = readState(target).managedFiles[0].relPath;
    const r = await uninstall(base({ target, selectionIds: ["sample:hello-world"], yes: true }));
    assert.equal(r.ok, true);
    assert.ok(!fs.existsSync(path.join(target, rel)), "file removed");
    const st = readState(target);
    assert.equal(st?.managedFiles?.length ?? 0, 0, "state entry cleared");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: locally-modified managed file blocks without --force", async () => {
  const target = tmp("u1-block-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const abs = path.join(target, readState(target).managedFiles[0].relPath);
    fs.appendFileSync(abs, "\nedited by test\n");
    const r = await uninstall(base({ target, selectionIds: ["sample:hello-world"], yes: true }));
    assert.equal(r.ok, false, "modified file blocks uninstall");
    assert.ok(fs.existsSync(abs), "modified file preserved on block");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("update: clean install then update is an up-to-date no-op", async () => {
  const target = tmp("u1-upd-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const r = await update(base({ target }));
    assert.notEqual(r.ok, false, `update must not block a clean tree: ${JSON.stringify(r)}`);
    assert.notEqual(r.reason, "modification-blocks");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("repair: scan on a pristine installed tree reports zero missing/tampered", async () => {
  const target = tmp("u1-rep-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const r = await repair(base({ target, apply: false }));
    assert.notEqual(r.ok, false, `pristine repair scan should be clean: ${JSON.stringify(r)}`);
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("repair --apply: restores a deleted managed file", async () => {
  const target = tmp("u1-repap-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const abs = path.join(target, readState(target).managedFiles[0].relPath);
    fs.rmSync(abs);
    const r = await repair(base({ target, apply: true }));
    assert.notEqual(r.ok, false, `repair --apply failed: ${JSON.stringify(r)}`);
    assert.ok(fs.existsSync(abs), "deleted file restored by repair --apply");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("listCommand: returns the sample manifest skills + bundles", () => {
  const out = listCommand({ repoRoot: SAMPLE, productConfig, env: process.env });
  const skills = out.skills ?? out.assets?.filter?.((a) => a.type === "skill") ?? [];
  assert.ok(JSON.stringify(out).includes("sample:hello-world"), "hello-world listed");
  assert.ok(JSON.stringify(out).includes("sample-demo"), "sample-demo bundle listed");
  assert.ok(skills.length >= 1 || JSON.stringify(out).includes("hello-world"));
});

test("agentsCommand: reports the built-in adapter targets", () => {
  const out = agentsCommand({ repoRoot: SAMPLE, env: process.env });
  const s = JSON.stringify(out);
  assert.ok(s.includes("claude") && s.includes("codex") && s.includes("opencode"),
    "all three built-in adapters reported");
});

test("doctorCommand: returns a structured health report with reports + counts", () => {
  const out = doctorCommand({ repoRoot: SAMPLE, adapterId: "claude-code", env: process.env });
  assert.ok(Array.isArray(out.reports), "reports is an array");
  assert.equal(typeof out.okCount, "number", "okCount is numeric");
  assert.equal(typeof out.failCount, "number", "failCount is numeric");
});

test("doctorCommand: built-in adapters add no adapter-probes checks (empty SPI default doesn't pollute)", () => {
  const out = doctorCommand({ repoRoot: SAMPLE, adapterId: "claude-code", env: process.env });
  const probeChecks = out.reports.flatMap((r) => r.checks).filter((c) => c.name === "adapter-probes");
  assert.equal(probeChecks.length, 0, "no built-in adapter defines doctorProbes today");
});

test("doctorCommand: folds a passing adapter probe into the report", () => {
  const fakeAdapter = {
    doctorProbes: ({ targetRoot }) => [{ name: "plugin-config", ok: true, detail: `checked ${targetRoot}` }],
  };
  const out = doctorCommand({
    repoRoot: SAMPLE, adapterId: "claude-code", env: process.env,
    getAdapterFn: () => fakeAdapter,
  });
  const check = out.reports[0].checks.find((c) => c.name === "plugin-config");
  assert.ok(check, "probe check is present in the report");
  assert.equal(check.ok, true);
  assert.ok(check.detail.includes("checked"), "probe detail string is forwarded into the report");
});

test("doctorCommand: a failing adapter probe flips report.ok to false", () => {
  const fakeAdapter = {
    doctorProbes: () => [{ name: "plugin-config", ok: false, detail: "config missing" }],
  };
  const out = doctorCommand({
    repoRoot: SAMPLE, adapterId: "claude-code", env: process.env,
    getAdapterFn: () => fakeAdapter,
  });
  assert.equal(out.reports[0].ok, false, "failing probe propagates to report.ok");
  assert.equal(out.failCount, 1);
});

test("doctorCommand: a throwing adapter probe is surfaced as a failed check, not a crash", () => {
  const fakeAdapter = {
    doctorProbes: () => { throw new Error("boom"); },
  };
  const out = doctorCommand({
    repoRoot: SAMPLE, adapterId: "claude-code", env: process.env,
    getAdapterFn: () => fakeAdapter,
  });
  const check = out.reports[0].checks.find((c) => c.name === "adapter-probes");
  assert.ok(check && check.ok === false, "throwing probe yields a failed adapter-probes check");
  assert.ok(check.detail.includes("boom"), "probe error message is preserved");
});

test("doctorCommand: a non-array doctorProbes return is surfaced as a failed check", () => {
  const fakeAdapter = { doctorProbes: () => ({ not: "an array" }) };
  const out = doctorCommand({
    repoRoot: SAMPLE, adapterId: "claude-code", env: process.env,
    getAdapterFn: () => fakeAdapter,
  });
  const check = out.reports[0].checks.find((c) => c.name === "adapter-probes");
  assert.ok(check && check.ok === false, "malformed return yields a failed adapter-probes check");
  assert.ok(check.detail.includes("did not return an array"), "diagnostic text present in detail");
});

test("doctorCommand: --target override scopes the health report to the requested sandbox", () => {
  const target = tmp("doctor-target-");
  try {
    const out = doctorCommand({ repoRoot: SAMPLE, adapterId: "codex", target, env: process.env });
    assert.equal(out.reports.length, 1);
    const report = out.reports[0];
    assert.equal(report.targetRoot, path.resolve(target));
    assert.ok(report.checks.some((check) => check.name === "target-exists" && check.ok === true));
    assert.ok(report.checks.some((check) => check.name === "target-writable" && check.ok === true));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("export -> import round-trips the installed selection set", async () => {
  const target = tmp("u1-exp-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const exp = exportCommand({ repoRoot: SAMPLE, adapterId: "claude-code", target, productConfig, env: process.env });
    const envelope = typeof exp === "string" ? exp : JSON.stringify(exp);
    assert.ok(envelope.includes("sample:hello-world"), "export envelope carries the selection");
    const target2 = tmp("u1-imp-");
    try {
      const parsed = typeof exp === "string" ? JSON.parse(exp) : exp;
      const r = await importCommand(base({ target: target2, envelope: parsed, yes: true }));
      assert.notEqual(r.ok, false, `import from export must succeed: ${JSON.stringify(r)}`);
      assert.ok(readState(target2)?.managedFiles?.length >= 1, "import re-installed the selection");
    } finally { fs.rmSync(target2, { recursive: true, force: true }); }
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("planSelection / planCommandText: preview without writing", async () => {
  const target = tmp("u1-plan-");
  try {
    const p = await planSelection({ repoRoot: SAMPLE, adapterId: "claude-code", target, selectionIds: ["sample:hello-world"], productConfig, env: process.env, manifest });
    assert.ok(p && typeof p === "object", "planSelection returns a plan object");
    for (const k of ["plan", "manifest", "state", "targetRoot", "adapterId"]) {
      assert.ok(k in p, `planSelection result has '${k}'`);
    }
    const txt = planCommandText({ repoRoot: SAMPLE, adapterId: "claude-code", target, selectionIds: ["sample:hello-world"], productConfig, env: process.env });
    assert.ok(txt !== undefined && txt !== null, "planCommandText returns a value (no throw)");
    assert.equal(readState(target), null, "plan never writes state");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("getRepoCommit: in-repo returns a 40-hex sha; non-git cwd returns null", () => {
  const sha = getRepoCommit(REPO);
  assert.match(sha, /^[0-9a-f]{40}$/, "in-repo HEAD is a 40-hex sha");
  const nongit = tmp("u1-nogit-");
  try {
    assert.equal(getRepoCommit(nongit), null, "non-git cwd → catch→null");
  } finally { fs.rmSync(nongit, { recursive: true, force: true }); }
});

// --- plan 003 U1 committed-scope error/failure paths (added per
// Tier-2 ce-code-review: the focused suite skipped these explicitly
// enumerated R1 scenarios). ---

test("install: unmanaged target-file conflict blocks; overwriteUnmanaged bypasses", async () => {
  const target = tmp("u1-ovr-");
  try {
    // Establish the real install rel-path, then make it an UNMANAGED file
    // (file present, no managing state) to trigger the conflict branch.
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const rel = readState(target).managedFiles[0].relPath;
    await uninstall(base({ target, selectionIds: ["sample:hello-world"], yes: true }));
    fs.mkdirSync(path.dirname(path.join(target, rel)), { recursive: true });
    fs.writeFileSync(path.join(target, rel), "unmanaged pre-existing content\n");

    const blocked = await install(base({ target, selectionIds: ["sample:hello-world"] }));
    assert.equal(blocked.ok, false, "unmanaged file must block install");
    assert.equal(blocked.reason, "unmanaged-files-block");

    const forced = await install(base({ target, selectionIds: ["sample:hello-world"], overwriteUnmanaged: true }));
    assert.equal(forced.ok, true, "overwriteUnmanaged must bypass the conflict");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("update: source-drifted + locally-edited managed file blocks (modification-blocks)", async () => {
  // update() only acts when the SOURCE changed; the tamper-block fires
  // when a refresh WOULD clobber a locally-edited on-disk file. So this
  // needs a writable fixture copy (drift the source there) — editing
  // only the on-disk target with an unchanged source is a correct no-op,
  // not a block (verified). Mirrors repair-rehash.test.mjs's setup.
  const fixture = tmp("u1-updfx-");
  const target = tmp("u1-updblk-");
  try {
    for (const e of ["sample.install.json", "skills", "agents", "rules"]) {
      fs.cpSync(path.join(SAMPLE, e), path.join(fixture, e), { recursive: true });
    }
    const fixManifest = loadManifest(path.join(fixture, "sample.install.json"));
    const fb = (x) => ({ repoRoot: fixture, adapterId: "claude-code", productConfig, manifest: fixManifest, installerVersion: "test", allowNoCli: true, env: process.env, ...x });
    await install(fb({ target, selectionIds: ["sample:hello-world"] }));
    const mf = readState(target).managedFiles[0];
    // Drift the SOURCE so update wants to refresh, AND locally edit the
    // on-disk file so the refresh would clobber a local edit → block.
    fs.appendFileSync(path.join(fixture, mf.sourceRelPath), "\n<!-- source drift -->\n");
    fs.appendFileSync(path.join(target, mf.relPath), "\nlocal edit\n");
    const r = await update(fb({ target }));
    assert.equal(r.ok, false, "source-drifted + locally-edited file must block update");
    assert.equal(r.reason, "modification-blocks");
    assert.ok(Array.isArray(r.blockedByModification) && r.blockedByModification.length >= 1,
      "blockedByModification names the edited file");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("uninstall: --force + --accept-modified bypasses the hash-mismatch block", async () => {
  const target = tmp("u1-fbyp-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const rel = readState(target).managedFiles[0].relPath;
    const abs = path.join(target, rel);
    fs.appendFileSync(abs, "\nedited\n");
    // Without force → blocked (the existing block test covers ok:false).
    const forced = await uninstall(base({ target, selectionIds: ["sample:hello-world"], yes: true, force: true, acceptModified: [rel] }));
    assert.equal(forced.ok, true, "force + accept-modified must bypass the block");
    assert.ok(!fs.existsSync(abs), "forced uninstall removes the edited file");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("importCommand: malformed envelope (bad schemaVersion) throws ERR_SCHEMA", async () => {
  const target = tmp("u1-imperr-");
  try {
    await assert.rejects(
      () => importCommand(base({ target, envelope: { schemaVersion: 99, selections: [] }, yes: true })),
      (e) => e?.code === "ERR_SCHEMA",
      "a bad-schema import envelope must be rejected with ERR_SCHEMA",
    );
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

// --- multiMulti aggregation (plan 2026-05-18-005 U1) ---
// Target redirection via the adapters' designed env seam: claude.mjs reads
// env.CLAUDE_HOME, codex.mjs reads env.CODEX_HOME (NOT a speculative
// "HOME-override"). assertCliPresent is satisfied for ALL THREE via a
// PATH-stub: whichSync only checks isFile(), so an empty file named after
// each adapter's cliBinary on env.PATH passes. updateMulti AND
// uninstallMulti have no `allowNoCli` param (only installMulti does), so
// the PATH-stub — not allowNoCli — is the uniform gate-bypass.

function multiEnv() {
  const claudeHome = tmp("u1m-cl-");
  const codexHome = tmp("u1m-cx-");
  const binDir = tmp("u1m-bin-");
  fs.writeFileSync(path.join(binDir, "claude"), "");
  fs.writeFileSync(path.join(binDir, "codex"), "");
  const env = {
    ...process.env,
    CLAUDE_HOME: claudeHome,
    CODEX_HOME: codexHome,
    PATH: binDir + path.delimiter + (process.env.PATH || ""),
  };
  return {
    env, claudeHome, codexHome,
    cleanup() { for (const d of [claudeHome, codexHome, binDir]) fs.rmSync(d, { recursive: true, force: true }); },
  };
}
function multiBase(m, extra = {}) {
  return {
    repoRoot: SAMPLE, productConfig, installerVersion: "test",
    selectionIds: ["sample:hello-world"], env: m.env, ...extra,
  };
}

test("installMulti: all-ok aggregation across two real adapters (env seam)", async () => {
  const m = multiEnv();
  try {
    const r = await installMulti(multiBase(m, { adapterIds: ["claude-code", "codex"], allowNoCli: true }));
    assert.deepEqual(r.adapterIds, ["claude-code", "codex"]);
    assert.equal(r.okCount, 2);
    assert.equal(r.failCount, 0);
    assert.equal(r.results.length, 2);
    assert.ok(r.results.every((x) => x.ok === true));
    assert.ok(readState(m.claudeHome)?.managedFiles.length >= 1, "claude target written under CLAUDE_HOME");
    assert.ok(readState(m.codexHome)?.managedFiles.length >= 1, "codex target written under CODEX_HOME");
  } finally { m.cleanup(); }
});

test("installMulti: duplicate adapter ids collapse to unique", async () => {
  const m = multiEnv();
  try {
    const r = await installMulti(multiBase(m, { adapterIds: ["claude-code", "claude-code", "codex"], allowNoCli: true }));
    assert.deepEqual(r.adapterIds, ["claude-code", "codex"], "deduped");
    assert.equal(r.results.length, 2);
    assert.equal(r.okCount, 2);
  } finally { m.cleanup(); }
});

test("installMulti: a per-adapter failure is wrapped into failCount, not propagated", async () => {
  const m = multiEnv();
  try {
    const r = await installMulti(multiBase(m, { adapterIds: ["claude-code", "no-such-adapter"], allowNoCli: true }));
    assert.equal(r.okCount, 1, "the valid adapter still succeeds");
    assert.equal(r.failCount, 1, "the unknown adapter is counted as a failure");
    const bad = r.results.find((x) => x.adapterId === "no-such-adapter");
    assert.equal(bad.ok, false);
    assert.ok(bad.error?.code, "the per-adapter error is captured in results, not thrown");
  } finally { m.cleanup(); }
});

test("uninstallMulti: round-trips installMulti state across both adapters (no allowNoCli param)", async () => {
  const m = multiEnv();
  try {
    await installMulti(multiBase(m, { adapterIds: ["claude-code", "codex"], allowNoCli: true }));
    const r = await uninstallMulti(multiBase(m, { adapterIds: ["claude-code", "codex"], yes: true, force: true }));
    assert.equal(r.okCount, 2);
    assert.equal(r.failCount, 0);
    const cl = readState(m.claudeHome);
    assert.ok(!cl || cl.managedFiles.length === 0, "claude managed files removed");
  } finally { m.cleanup(); }
});

test("updateMulti: okCount path reachable via PATH-stub (updateMulti has no allowNoCli)", async () => {
  const m = multiEnv();
  try {
    await installMulti(multiBase(m, { adapterIds: ["claude-code", "codex"], allowNoCli: true }));
    const r = await updateMulti(multiBase(m, { adapterIds: ["claude-code", "codex"] }));
    assert.equal(r.adapterIds.length, 2);
    assert.equal(r.failCount, 0, "assertCliPresent satisfied by the PATH-stub, not allowNoCli");
    assert.equal(r.okCount, 2);
  } finally { m.cleanup(); }
});

// --- uninstall/repair residual branches (plan 2026-05-18-005 U3) ---
// missing-on-disk recopy is already covered by "repair --apply: restores a
// deleted managed file" above — NOT duplicated here (origin R7 "extend,
// do not duplicate"). U3 covers only the genuinely-uncovered residuals.

test("uninstall: never-installed selection (state exists) → ERR_NOT_INSTALLED", async () => {
  const target = tmp("u3-noti-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    await assert.rejects(
      () => uninstall(base({ target, selectionIds: ["sample:demo-bundle-skill"], yes: true })),
      (e) => e?.code === "ERR_NOT_INSTALLED" && /selection not installed: sample:demo-bundle-skill/.test(e.message),
      "uninstalling a selection that was never installed (state present) must throw ERR_NOT_INSTALLED",
    );
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("repair --apply: tampered file without --accept-modified is reported in skippedTampered, not overwritten", async () => {
  const target = tmp("u3-tamp-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const rel = readState(target).managedFiles[0].relPath;
    const abs = path.join(target, rel);
    fs.appendFileSync(abs, "\nTAMPERED\n");
    const tamperedBytes = fs.readFileSync(abs, "utf8");
    const r = await repair(base({ target, apply: true, acceptModified: [] }));
    assert.equal(r.ok, true);
    assert.equal(r.applied, false, "nothing recopied — the only drift is a non-accepted tamper");
    assert.ok(r.skippedTampered.includes(rel), "tampered relPath surfaced in skippedTampered");
    assert.match(r.message, /tampered file\(s\) not repaired; pass --accept-modified <relPath> per file/);
    assert.equal(fs.readFileSync(abs, "utf8"), tamperedBytes, "tampered file left untouched without accept-modified");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

// --- STATE_DIRNAME value guard (ADR-0008 / plan 2026-05-18-006) ---
// The .skillctl→.nexel rename is a DELIBERATE breaking on-disk-contract
// change. Without this assertion the rename is only protected by
// self-consistency of the stateDirFor indirection — a typo'd or reverted
// constant would keep the whole suite green (the writer and reader share
// the constant). This locks the intended on-disk name explicitly.
test("STATE_DIRNAME is .nexel (locks the deliberate ADR-0008 rename)", () => {
  assert.equal(STATE_DIRNAME, ".nexel");
  assert.notEqual(STATE_DIRNAME, ".skillctl", "must not regress to the pre-rename name");
});

// --- U1: state health helpers (plan 2026-05-25-001) ---
// assertValidExistingState / assertStateSelectionsKnown are bound at every
// read-state command path that can act on a clean source-of-truth manifest.
// Recovery paths (uninstall/update/repair) bind only the structural check so
// stale selection entries do not deadlock cleanup.

function writeRawState(target, payload) {
  fs.mkdirSync(stateDirFor(target), { recursive: true });
  fs.writeFileSync(path.join(stateDirFor(target), "state.json"), JSON.stringify(payload, null, 2));
}

// Inject a stale selection into a valid post-install state — both as
// installations[] entry AND as managedFiles[].referencedBy so validateState
// accepts it. Lets us test assertStateSelectionsKnown in isolation from
// assertValidExistingState's orphaned-selection check.
function injectStaleSelection(state, selectionId) {
  state.installations.push({
    selectionId,
    selectionKind: "skill",
    installMode: "direct",
    installerVersion: "test",
    installedAt: state.updatedAt,
  });
  if (state.managedFiles.length > 0) {
    state.managedFiles[0].referencedBy.push(selectionId);
  }
  return state;
}

test("assertValidExistingState: passes on a valid state object", async () => {
  const target = tmp("u1-helper-valid-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const state = readState(target);
    assert.doesNotThrow(() => assertValidExistingState(state));
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("assertValidExistingState: throws CommandError(ERR_STATE_INVALID) with findings on bad shape", () => {
  let err;
  try { assertValidExistingState({ schemaVersion: 99, managedFiles: "nope" }); } catch (e) { err = e; }
  assert.ok(err, "did not throw");
  assert.equal(err.name, "CommandError");
  assert.equal(err.code, "ERR_STATE_INVALID");
  assert.ok(Array.isArray(err.details.findings), "details.findings must be an array");
  assert.ok(err.details.findings.length >= 1, "must accumulate at least one finding");
  assert.match(err.message, /existing state\.json invalid/);
});

test("assertStateSelectionsKnown: passes when every selectionId is in manifest", () => {
  const state = {
    installations: [{ selectionId: "sample:hello-world", selectionKind: "skill", installMode: "direct", installerVersion: "test", installedAt: "now" }],
  };
  assert.doesNotThrow(() => assertStateSelectionsKnown(state, manifest));
});

test("assertStateSelectionsKnown: accumulates every unknown selectionId in one error", () => {
  const state = {
    installations: [
      { selectionId: "sample:hello-world", selectionKind: "skill", installMode: "direct", installerVersion: "test", installedAt: "now" },
      { selectionId: "sample:retired-a", selectionKind: "skill", installMode: "direct", installerVersion: "test", installedAt: "now" },
      { selectionId: "sample:retired-b", selectionKind: "bundle", installMode: "direct", installerVersion: "test", installedAt: "now" },
    ],
  };
  let err;
  try { assertStateSelectionsKnown(state, manifest); } catch (e) { err = e; }
  assert.ok(err, "did not throw");
  assert.equal(err.code, "ERR_NOT_INSTALLED");
  assert.deepEqual(err.details.unknownSelections, ["sample:retired-a", "sample:retired-b"]);
  assert.match(err.message, /retired-a, sample:retired-b/);
  assert.match(err.message, /clean reinstall/);
});

test("install: stale state.json (unknown selectionId) blocks install with ERR_NOT_INSTALLED", async () => {
  const target = tmp("u1-install-stale-");
  try {
    writeRawState(target, {
      schemaVersion: 1,
      installerVersion: "test",
      agentId: "claude-code",
      targetRoot: target,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
      managedFiles: [],
      installations: [
        { selectionId: "sample:retired-skill", selectionKind: "skill", installMode: "direct", installerVersion: "test", installedAt: "2025-01-01T00:00:00Z" },
      ],
    });
    await assert.rejects(
      () => install(base({ target, selectionIds: ["sample:hello-world"] })),
      (e) => e.code === "ERR_NOT_INSTALLED" && e.details.unknownSelections.includes("sample:retired-skill"),
      "install must surface stale state selection before proceeding",
    );
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("export: stale state.json blocks with actionable error", async () => {
  const target = tmp("u1-export-stale-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const state = injectStaleSelection(readState(target), "sample:retired-x");
    writeRawState(target, state);
    assert.throws(
      () => exportCommand({ repoRoot: SAMPLE, adapterId: "claude-code", target, productConfig, env: process.env }),
      (e) => e.code === "ERR_NOT_INSTALLED" && e.details.unknownSelections.includes("sample:retired-x"),
      "export must refuse to emit stale selections",
    );
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: stale state.json does NOT block (recovery semantics)", async () => {
  const target = tmp("u1-uninstall-stale-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const state = injectStaleSelection(readState(target), "sample:retired-y");
    writeRawState(target, state);
    // Uninstalling a known selection must still work even when state has stale entries.
    const r = await uninstall(base({ target, selectionIds: ["sample:hello-world"] }));
    assert.equal(r.ok, true, "uninstall must complete on stale state to allow recovery");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: structurally-invalid state.json IS blocked by assertValidExistingState", async () => {
  const target = tmp("u1-uninstall-invalid-");
  try {
    writeRawState(target, { schemaVersion: 1, managedFiles: "broken", installations: [] });
    await assert.rejects(
      () => uninstall(base({ target, selectionIds: ["sample:hello-world"] })),
      (e) => e.code === "ERR_STATE_INVALID",
      "uninstall must surface structural state corruption",
    );
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("update: structurally-invalid state.json IS blocked", async () => {
  const target = tmp("u1-update-invalid-");
  try {
    writeRawState(target, { schemaVersion: 1, managedFiles: [], installations: "nope" });
    await assert.rejects(
      () => update(base({ target })),
      (e) => e.code === "ERR_STATE_INVALID",
    );
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("repair: structurally-invalid state.json IS blocked (both scan and apply paths)", async () => {
  const target = tmp("u1-repair-invalid-");
  try {
    writeRawState(target, { schemaVersion: 99, managedFiles: [], installations: [] });
    await assert.rejects(
      () => repair(base({ target, apply: false })),
      (e) => e.code === "ERR_STATE_INVALID",
    );
    await assert.rejects(
      () => repair(base({ target, apply: true })),
      (e) => e.code === "ERR_STATE_INVALID",
    );
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("doctorCommand: reports state-selections-known check when manifest loads", async () => {
  const target = tmp("u1-doctor-stale-");
  try {
    await install(base({ target, selectionIds: ["sample:hello-world"] }));
    const state = injectStaleSelection(readState(target), "sample:retired-z");
    writeRawState(target, state);
    const out = doctorCommand({ repoRoot: SAMPLE, adapterId: "claude-code", target, productConfig, env: process.env });
    const check = out.reports[0].checks.find((c) => c.name === "state-selections-known");
    assert.ok(check, "doctor must include state-selections-known check");
    assert.equal(check.ok, false, "stale selection must fail the check");
    assert.match(check.detail, /sample:retired-z/);
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});
