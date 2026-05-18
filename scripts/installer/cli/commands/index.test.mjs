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
  listCommand, agentsCommand, doctorCommand,
  exportCommand, importCommand, planSelection, planCommandText,
  getRepoCommit,
} from "./index.mjs";
import { loadManifest } from "../../core/manifest/loader.mjs";
import { readState } from "../../core/filesystem.mjs";

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
    assert.equal(r.writtenCount, 1);
    const st = readState(target);
    assert.equal(st.managedFiles.length, 1);
    assert.ok(fs.existsSync(path.join(target, st.managedFiles[0].relPath)), "skill on disk");
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
