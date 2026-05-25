// U6 (plan 2026-05-25-001): verifyMarketplaceLockstep kernel helper.
//
// Covers spec resolution for plugin.json vs marketplace.json shapes,
// baseline-from-first semantics, explicit expectedVersion override,
// missing-file / malformed-JSON failure modes, and the pluginName
// selector for marketplace.json entry lookup.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { verifyMarketplaceLockstep } from "./marketplace-lockstep.mjs";

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-lockstep-"));
}

function writeJson(dir, name, payload) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(payload, null, 2));
  return p;
}

test("verifyMarketplaceLockstep: all-match baseline-from-first → ok", () => {
  const dir = makeTmp();
  try {
    const a = writeJson(dir, "a.json", { version: "1.0.0" });
    const b = writeJson(dir, "b.json", { version: "1.0.0" });
    const c = writeJson(dir, "c.json", { version: "1.0.0" });
    const r = verifyMarketplaceLockstep([{ path: a }, { path: b }, { path: c }]);
    assert.equal(r.ok, true);
    assert.equal(r.mismatches.length, 0);
    assert.equal(r.baseline, "1.0.0");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("verifyMarketplaceLockstep: one drifted version → mismatch with path + found + expected", () => {
  const dir = makeTmp();
  try {
    const a = writeJson(dir, "a.json", { version: "1.0.0" });
    const b = writeJson(dir, "b.json", { version: "1.0.1" });
    const r = verifyMarketplaceLockstep([{ path: a }, { path: b }]);
    assert.equal(r.ok, false);
    assert.equal(r.mismatches.length, 1);
    assert.equal(r.mismatches[0].found, "1.0.1");
    assert.equal(r.mismatches[0].expected, "1.0.0");
    assert.match(r.mismatches[0].path, /b\.json$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("verifyMarketplaceLockstep: explicit expectedVersion overrides baseline-from-first", () => {
  const dir = makeTmp();
  try {
    const a = writeJson(dir, "a.json", { version: "1.0.0" });
    const b = writeJson(dir, "b.json", { version: "1.0.0" });
    const r = verifyMarketplaceLockstep([
      { path: a, expectedVersion: "2.0.0" },
      { path: b, expectedVersion: "2.0.0" },
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.mismatches.length, 2);
    assert.ok(r.mismatches.every((m) => m.expected === "2.0.0" && m.found === "1.0.0"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("verifyMarketplaceLockstep: marketplace.json + pluginName selector reads plugins[].version", () => {
  const dir = makeTmp();
  try {
    const plugin = writeJson(dir, "plugin.json", { version: "1.0.0" });
    const marketplace = writeJson(dir, "marketplace.json", {
      name: "demo-marketplace",
      plugins: [
        { name: "other", version: "9.9.9" },
        { name: "demo", version: "1.0.0" },
      ],
    });
    const r = verifyMarketplaceLockstep([
      { path: plugin },
      { path: marketplace, pluginName: "demo" },
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.mismatches));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("verifyMarketplaceLockstep: marketplace.json with missing pluginName entry → mismatch with reason", () => {
  const dir = makeTmp();
  try {
    const marketplace = writeJson(dir, "marketplace.json", {
      name: "demo-marketplace",
      plugins: [{ name: "other", version: "1.0.0" }],
    });
    const r = verifyMarketplaceLockstep([
      { path: marketplace, pluginName: "demo", expectedVersion: "1.0.0" },
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.mismatches[0].found, null);
    assert.match(r.mismatches[0].reason, /not found/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("verifyMarketplaceLockstep: marketplace.json without selector → mismatch with helpful reason", () => {
  const dir = makeTmp();
  try {
    const marketplace = writeJson(dir, "marketplace.json", {
      plugins: [{ name: "demo", version: "1.0.0" }],
    });
    const r = verifyMarketplaceLockstep([{ path: marketplace, expectedVersion: "1.0.0" }]);
    assert.equal(r.ok, false);
    assert.match(r.mismatches[0].reason, /pluginName selector/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("verifyMarketplaceLockstep: missing file throws ERR_LOCKSTEP_FILE_MISSING with path annotation", () => {
  let err;
  try { verifyMarketplaceLockstep([{ path: "/no/such/file.json" }]); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.code, "ERR_LOCKSTEP_FILE_MISSING");
  assert.equal(err.path, "/no/such/file.json");
});

test("verifyMarketplaceLockstep: malformed JSON throws ERR_LOCKSTEP_JSON_PARSE with path annotation", () => {
  const dir = makeTmp();
  try {
    const p = path.join(dir, "bad.json");
    fs.writeFileSync(p, "{ not valid json");
    let err;
    try { verifyMarketplaceLockstep([{ path: p }]); } catch (e) { err = e; }
    assert.ok(err);
    assert.equal(err.code, "ERR_LOCKSTEP_JSON_PARSE");
    assert.equal(err.path, p);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("verifyMarketplaceLockstep: missing version field → mismatch with found: null", () => {
  const dir = makeTmp();
  try {
    const a = writeJson(dir, "a.json", { version: "1.0.0" });
    const b = writeJson(dir, "b.json", {}); // no version field
    const r = verifyMarketplaceLockstep([{ path: a }, { path: b }]);
    assert.equal(r.ok, false);
    assert.equal(r.mismatches[0].found, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("verifyMarketplaceLockstep: empty specs array throws", () => {
  assert.throws(() => verifyMarketplaceLockstep([]), /non-empty/);
});

test("verifyMarketplaceLockstep: non-array specs throws", () => {
  assert.throws(() => verifyMarketplaceLockstep(null), /non-empty/);
  assert.throws(() => verifyMarketplaceLockstep(undefined), /non-empty/);
});
