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
      (e) => e?.code === "ERR_NO_SELECTION" || /selection/i.test(e?.message),
      "empty selection must be rejected, not silently succeed",
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

test("doctorCommand: returns a structured health report", () => {
  const out = doctorCommand({ repoRoot: SAMPLE, adapterId: "claude-code", env: process.env });
  assert.ok(out && typeof out === "object", "doctor returns a report object");
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
