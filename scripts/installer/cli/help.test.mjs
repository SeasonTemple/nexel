import test from "node:test";
import assert from "node:assert/strict";

import { strings } from "./strings.mjs";
import { printHelp, renderHelp, hasVerbHelp } from "./help.mjs";

// The 11 production verbs (everything dispatchable except `help` itself).
const PRODUCTION_VERBS = [
  "install", "uninstall", "update", "list", "plan", "agents",
  "doctor", "repair", "export", "import", "validate",
  // v0.7: scaffold is opt-in (enablePluginScaffolder flag) but ships with
  // a per-verb help renderer so opt-in callers get --help coverage.
  "scaffold",
];

// Sentinel that appears only in the composed full body (flagsBlock), never
// in a focused per-verb block. nexel has NO monolithic strings.help.full
// key — the full body is composed at runtime by printHelp from the five
// strings.help.{header,usage,verbsBlock,flagsBlock,examplesBlock} blocks.
const FULL_ONLY = "Common flags:";

// Stub product identity — proves renderers are parameterized off
// productConfig (no hardcoded product literal — skillctl/netops/nexel).
const PC = { binName: "stub-bin", skillIdPrefix: "stub" };
const ADAPTERS = ["claude-code", "codex", "opencode"];

function capture(fn) {
  const original = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  try { fn(); } finally { process.stdout.write = original; }
  return chunks.join("");
}

test("strings.help.verb: every production verb has a parameterized renderer", () => {
  assert.ok(strings.help.verb, "strings.help.verb must exist");
  assert.ok(Object.isFrozen(strings.help.verb), "strings.help.verb must be frozen");
  assert.equal(Object.keys(strings.help.verb).length, PRODUCTION_VERBS.length);
  for (const v of PRODUCTION_VERBS) {
    assert.equal(typeof strings.help.verb[v], "function", `verb help for '${v}' must be a function`);
    const out = strings.help.verb[v]({ binName: "stub-bin", prefix: "stub", adapterList: "a | b" });
    assert.ok(out && out.length > 0, `verb help for '${v}' must be non-empty`);
    assert.match(out, new RegExp(v), `verb help for '${v}' must name the verb`);
    assert.ok(out.includes("stub-bin"), `verb help for '${v}' must render the passed binName`);
    assert.ok(!/\b(skillctl|netops|nexel)\b/i.test(out), `verb help for '${v}' must not embed a literal product name`);
    assert.ok(!out.includes(FULL_ONLY), `verb help for '${v}' must not embed the full flag table`);
  }
});

test("printHelp: composed full body still renders (no strings.help.full key exists)", () => {
  assert.equal(strings.help.full, undefined, "nexel must NOT have a monolithic strings.help.full key");
  const out = capture(() => printHelp({ productConfig: PC, version: "9.9.9", adapters: ADAPTERS }));
  assert.match(out, /stub-bin v9\.9\.9 — managed installer/);
  assert.match(out, /Verbs:/);
  assert.ok(out.includes(FULL_ONLY), "composed full body must contain the Common flags table");
});

test("renderHelp: `<verb> --help` form routes to verb help, not full", () => {
  const out = capture(() => renderHelp({
    args: { help: true, verb: "install", positional: [] },
    productConfig: PC, version: "0.0.0", adapters: ADAPTERS,
  }));
  assert.match(out, /stub-bin install —/);
  assert.ok(!out.includes(FULL_ONLY), "verb-help path must not emit the full flag table");
});

test("renderHelp: `help <verb>` form routes to verb help via positional[0]", () => {
  const out = capture(() => renderHelp({
    args: { help: false, verb: "help", positional: ["uninstall"] },
    productConfig: PC, version: "0.0.0", adapters: ADAPTERS,
  }));
  assert.match(out, /stub-bin uninstall —/);
  assert.ok(!out.includes(FULL_ONLY), "verb-help path must not emit the full flag table");
});

test("renderHelp: bare `help` (no verb) renders the composed full body", () => {
  const out = capture(() => renderHelp({
    args: { help: false, verb: "help", positional: [] },
    productConfig: PC, version: "0.0.0", adapters: ADAPTERS,
  }));
  assert.ok(out.includes(FULL_ONLY), "bare help must render the full body");
});

test("renderHelp: `--help` with no verb renders the composed full body", () => {
  const out = capture(() => renderHelp({
    args: { help: true, verb: null, positional: [] },
    productConfig: PC, version: "0.0.0", adapters: ADAPTERS,
  }));
  assert.ok(out.includes(FULL_ONLY), "--help with no verb must render the full body");
});

test("renderHelp: unknown `frobnicate --help` falls back to full body (no throw)", () => {
  // parseArgs never assigns a non-valid token to verb; it lands in positional.
  const out = capture(() => renderHelp({
    args: { help: true, verb: null, positional: ["frobnicate"] },
    productConfig: PC, version: "0.0.0", adapters: ADAPTERS,
  }));
  assert.ok(out.includes(FULL_ONLY), "unknown verb must fall back to the full body");
});

test("renderHelp: `help frobnicate` (unknown positional) falls back to full body", () => {
  const out = capture(() => renderHelp({
    args: { help: false, verb: "help", positional: ["frobnicate"] },
    productConfig: PC, version: "0.0.0", adapters: ADAPTERS,
  }));
  assert.ok(out.includes(FULL_ONLY), "unknown help target must fall back to the full body");
});

test("renderHelp verb path emits exactly strings.help.verb output (no wrapping)", () => {
  const direct = strings.help.verb.plan({
    binName: PC.binName, prefix: PC.skillIdPrefix, adapterList: ADAPTERS.join(" | "),
  });
  const printed = capture(() => renderHelp({
    args: { help: true, verb: "plan", positional: [] },
    productConfig: PC, version: "0.0.0", adapters: ADAPTERS,
  }));
  assert.equal(printed, direct);
});

test("renderHelp: threads an injected stream to the verb path (real threading guard)", () => {
  // Teeth: if renderHelp drops `stream` instead of threading it to
  // printVerbHelp, these writes never reach the injected sink and the
  // assertions fail. (A no-stream-key test alone is hollow — JS default
  // params mean printVerbHelp's own `= process.stdout` default would
  // absorb an undefined, so it passes whether or not renderHelp threads.)
  const writes = [];
  const sink = { write: (c) => { writes.push(String(c)); return true; } };
  renderHelp({
    args: { help: true, verb: "install", positional: [] },
    productConfig: PC, version: "0.0.0", adapters: ADAPTERS, stream: sink,
  });
  const out = writes.join("");
  assert.match(out, /stub-bin install —/, "verb block must reach the injected stream");
  assert.ok(!out.includes(FULL_ONLY));
});

test("renderHelp: threads an injected stream to the full-body fallback", () => {
  const writes = [];
  const sink = { write: (c) => { writes.push(String(c)); return true; } };
  renderHelp({
    args: { help: false, verb: "help", positional: [] },
    productConfig: PC, version: "0.0.0", adapters: ADAPTERS, stream: sink,
  });
  assert.ok(writes.join("").includes(FULL_ONLY), "full body must reach the injected stream");
});

test("renderHelp: no `stream` key (the exact cli.mjs call shape) does not throw and reaches stdout", () => {
  // The cli.mjs call site passes no stream. End-to-end this works via the
  // default chain (renderHelp's `= process.stdout`, and printVerbHelp's
  // own as defense-in-depth). This guards the call-shape contract; the
  // threading test above is what guards stream being honored when given.
  const out = capture(() => renderHelp({
    args: { help: true, verb: "install", positional: [] },
    productConfig: PC, version: "0.0.0", adapters: ADAPTERS,
  }));
  assert.match(out, /stub-bin install —/);
  assert.ok(!out.includes(FULL_ONLY));
});

test("hasVerbHelp: true for production verbs, false for `help`/null/unknown", () => {
  for (const v of PRODUCTION_VERBS) assert.equal(hasVerbHelp(v), true, `hasVerbHelp('${v}')`);
  assert.equal(hasVerbHelp("help"), false, "`help` itself is never verb-helped");
  assert.equal(hasVerbHelp(null), false);
  assert.equal(hasVerbHelp(undefined), false);
  assert.equal(hasVerbHelp("frobnicate"), false);
});

test("printHelp: unchanged full-render path (R2 byte-path regression guard)", () => {
  const out = capture(() => printHelp({ productConfig: PC, version: "1.2.3", adapters: ["codex"] }));
  assert.match(out, /stub-bin v1\.2\.3/);
  assert.ok(out.includes(FULL_ONLY));
});
