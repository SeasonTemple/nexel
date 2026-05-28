import test from "node:test";
import assert from "node:assert/strict";

import { dispatchVerb, KERNEL_HANDLERS } from "./dispatch.mjs";

test("KERNEL_HANDLERS: 12 built-in verbs", () => {
  const expected = [
    "list", "agents", "doctor", "repair", "export", "import",
    "validate", "plan", "install", "uninstall", "update", "activate",
  ];
  for (const v of expected) {
    assert.equal(typeof KERNEL_HANDLERS[v], "function", `missing handler: ${v}`);
  }
  assert.equal(Object.keys(KERNEL_HANDLERS).length, expected.length);
});

test("KERNEL_HANDLERS: frozen (cannot be mutated)", () => {
  assert.ok(Object.isFrozen(KERNEL_HANDLERS));
});

test("dispatchVerb: unknown verb returns false, no handler runs", async () => {
  let called = false;
  const res = await dispatchVerb({
    verb: "no-such-verb",
    args: {},
    ctx: { repoRoot: "/tmp", version: "0.0.0", productConfig: {} },
    extraHandlers: { "no-such-verb-extra": () => { called = true; } },
  });
  assert.equal(res, false);
  assert.equal(called, false);
});

test("dispatchVerb: extraHandlers add new verbs", async () => {
  let calledWith = null;
  const res = await dispatchVerb({
    verb: "custom",
    args: { json: true },
    ctx: { repoRoot: "/tmp", version: "1.2.3", productConfig: { binName: "x" } },
    extraHandlers: {
      custom: (args, ctx) => { calledWith = { args, ctx }; },
    },
  });
  assert.equal(res, true);
  assert.equal(calledWith.args.json, true);
  assert.equal(calledWith.ctx.version, "1.2.3");
});

test("dispatchVerb: kernel verbs cannot be shadowed by extraHandlers", async () => {
  let extraCalled = false;
  // extraHandlers includes a 'list' override; kernel 'list' should win.
  const fakeArgs = { adapter: null, target: null, json: true };
  // We can't easily call the real runList without a repo root, so just verify
  // the dispatch picks the kernel handler over the extra one by checking that
  // our extra handler is NOT the one invoked. We do this by routing via a
  // recognizable side-effect handler and asserting it didn't fire.
  try {
    await dispatchVerb({
      verb: "list",
      args: fakeArgs,
      ctx: { repoRoot: "/nonexistent-repo-root-for-test", version: "0.0.0", productConfig: {} },
      extraHandlers: {
        list: () => { extraCalled = true; },
      },
    });
  } catch {
    // Real runList will throw because /nonexistent-repo-root-for-test has no manifest.
    // We don't care about the exception — we only care that the *extra* handler
    // didn't get invoked.
  }
  assert.equal(extraCalled, false, "extra 'list' should not run; kernel handler must win");
});
