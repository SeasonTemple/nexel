// prompts.mjs has NO kernel/sample caller — the interactive layer is
// product-bin territory (cli.mjs header). This suite is characterization
// for downstream consumers + a regression guard for the NetOps
// dead-literal hygiene swap (plan 2026-05-18-003 U2). It is not
// regression protection of an exercised kernel path.

import test from "node:test";
import assert from "node:assert/strict";

import {
  renderBanner, gatherActionChoice, gatherUninstallChoices,
  gatherInstallChoices, CancelledError,
} from "./prompts.mjs";

// Minimal injectable prompts stub. clack signals cancel via a sentinel
// the real isCancel() recognizes; the stub models that with an explicit
// CANCEL token and a matching isCancel.
const CANCEL = Symbol("cancel");
function stub(overrides = {}) {
  // Capture arrays live on the returned instance (not the stub function
  // object) so each stub() is a self-contained spy — no cross-test
  // accumulation regardless of test order/concurrency.
  const introCalls = [];
  const errCalls = [];
  return {
    select: async () => overrides.select ?? "install",
    multiselect: async () => overrides.multiselect ?? [],
    isCancel: (v) => v === CANCEL,
    intro: (...a) => { introCalls.push(a[0]); },
    outro: () => {},
    log: { error: (...a) => { errCalls.push(a[0]); }, info: () => {}, warn: () => {} },
    note: () => {},
    _intro: introCalls,
    _err: errCalls,
    ...overrides.extra,
  };
}

function captureStdout(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return chunks.join("");
}

// --- renderBanner: stdout-capture harness (no prompts param; writes
// directly via figlet). NOT the prompts-stub technique. ---

test("renderBanner: default title is product-agnostic — no NetOps/skillctl literal (R7 hygiene)", () => {
  const out = captureStdout(() => renderBanner({ enabled: true }));
  assert.ok(out.length > 0, "banner rendered when enabled");
  assert.ok(!/NetOps|netops|skillctl/.test(out), `banner must not embed a product literal: ${out.slice(0, 80)}`);
});

test("renderBanner: enabled=false suppresses all output", () => {
  const out = captureStdout(() => renderBanner({ enabled: false }));
  assert.equal(out, "", "disabled banner writes nothing");
});

test("renderBanner: version line renders when version supplied", () => {
  const out = captureStdout(() => renderBanner({ enabled: true, version: "9.9.9" }));
  assert.match(out, /v9\.9\.9/, "version echoed");
});

test("renderBanner: never throws even if figlet fails (decorative, non-blocking)", () => {
  assert.doesNotThrow(() => renderBanner({ enabled: true, title: "x".repeat(5000) }));
});

// --- gatherActionChoice: DI-stub path ---

test("gatherActionChoice: returns the selected action (happy)", async () => {
  const action = await gatherActionChoice({ prompts: stub({ select: "uninstall" }) });
  assert.equal(action, "uninstall");
});

test("gatherActionChoice: cancel → CancelledError('action')", async () => {
  const p = stub();
  p.select = async () => CANCEL;
  await assert.rejects(
    () => gatherActionChoice({ prompts: p }),
    (e) => e instanceof CancelledError && e.stage === "action" && !!e.code,
  );
});

// --- gatherUninstallChoices: DI-stub + injected readState ---

test("gatherUninstallChoices: missing readState throws a clear error", async () => {
  await assert.rejects(
    () => gatherUninstallChoices({ prompts: stub() }),
    /requires a readState/,
  );
});

test("gatherUninstallChoices: no managed installs → CancelledError('no-installs')", async () => {
  await assert.rejects(
    () => gatherUninstallChoices({
      prompts: stub(),
      adapters: [{ id: "claude-code", displayName: "Claude", targetRoot: "/tmp/x", supportsDirect: true }],
      readState: () => null, // nothing installed anywhere
    }),
    (e) => e instanceof CancelledError && e.stage === "no-installs",
  );
});

test("gatherUninstallChoices: adapter multiselect cancel → CancelledError('uninstall-adapter')", async () => {
  const p = stub();
  p.multiselect = async () => CANCEL;
  await assert.rejects(
    () => gatherUninstallChoices({
      prompts: p,
      adapters: [{ id: "claude-code", displayName: "Claude", targetRoot: "/tmp/x", supportsDirect: true }],
      readState: () => ({ installations: [{ selectionId: "sample:hello-world", selectionKind: "skill" }] }),
    }),
    (e) => e instanceof CancelledError && e.stage === "uninstall-adapter",
  );
});

// --- gatherInstallChoices: intro hygiene (R7) ---

test("gatherInstallChoices: intro text is product-agnostic — no NetOps literal (R7 hygiene)", async () => {
  const p = stub();
  // Drive only far enough to exercise the intro() call; a cancel right
  // after keeps the test from depending on the full picker flow.
  p.select = async () => CANCEL;
  try {
    await gatherInstallChoices({
      manifest: { skills: [], bundles: [] },
      prompts: p,
      adapters: [{ id: "claude-code", displayName: "Claude", targetRoot: "/tmp/x", supportsDirect: true }],
    });
  } catch { /* cancel/whatever — we only assert the intro literal */ }
  const intros = p._intro.join(" ");
  assert.ok(intros.length > 0, "intro was called");
  assert.ok(!/NetOps|netops/.test(intros), `intro must not embed a NetOps literal: ${intros}`);
});

test("gatherInstallChoices: plugin-mode happy path returns {mode,adapterId,instructions}", async () => {
  // plugin mode is the deterministic happy path: select→'plugin', then
  // select→adapter id; returns the adapter's plugin install instructions.
  const p = stub();
  const seq = ["plugin", "claude-code"];
  let i = 0;
  p.select = async () => seq[i++];
  const r = await gatherInstallChoices({
    manifest: { skills: [], bundles: [] },
    prompts: p,
    adapters: [{ id: "claude-code", displayName: "Claude", supportsDirect: true }],
  });
  assert.equal(r.mode, "plugin");
  assert.equal(r.adapterId, "claude-code");
  assert.equal(typeof r.instructions, "string");
  assert.ok(r.instructions.length > 0, "plugin install instructions returned");
});

// --- CancelledError shape ---

test("CancelledError: carries stage + ERR_CANCELLED code, is an Error", () => {
  const e = new CancelledError("some-stage");
  assert.ok(e instanceof Error);
  assert.equal(e.name, "CancelledError");
  assert.equal(e.stage, "some-stage");
  assert.ok(e.code, "has ERR_CANCELLED code");
  assert.match(e.message, /cancelled at some-stage/);
});
