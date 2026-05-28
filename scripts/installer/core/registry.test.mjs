// Unit tests for the Pluggable Validator Rule Registry (ADR-0016).
//
// The registry is a module-scope singleton; every test resets it via
// `_resetRegistryForTests()` (also documented in registry.mjs as
// test-only — NOT re-exported from installer/index.mjs).

import test from "node:test";
import assert from "node:assert/strict";

import {
  registerValidatorRule,
  listValidatorRules,
  _resetRegistryForTests,
} from "./registry.mjs";

function reset() {
  _resetRegistryForTests();
}

test("registry: registerValidatorRule rejects non-object input → TypeError", () => {
  reset();
  assert.throws(() => registerValidatorRule(null), TypeError);
  assert.throws(() => registerValidatorRule(undefined), TypeError);
  assert.throws(() => registerValidatorRule("rule"), TypeError);
  assert.throws(() => registerValidatorRule(42), TypeError);
  assert.throws(() => registerValidatorRule([]), TypeError);
});

test("registry: registerValidatorRule rejects missing/empty id → TypeError", () => {
  reset();
  assert.throws(
    () => registerValidatorRule({ appliesTo: "manifest", check: () => [] }),
    TypeError,
  );
  assert.throws(
    () => registerValidatorRule({ id: "", appliesTo: "manifest", check: () => [] }),
    TypeError,
  );
  assert.throws(
    () => registerValidatorRule({ id: 123, appliesTo: "manifest", check: () => [] }),
    TypeError,
  );
});

test("registry: registerValidatorRule rejects invalid appliesTo → TypeError", () => {
  reset();
  assert.throws(
    () => registerValidatorRule({ id: "r1", appliesTo: "bogus", check: () => [] }),
    TypeError,
  );
  assert.throws(
    () => registerValidatorRule({ id: "r1", appliesTo: "skills", check: () => [] }),
    TypeError,
  );
  assert.throws(
    () => registerValidatorRule({ id: "r1", check: () => [] }),
    TypeError,
  );
});

test("registry: registerValidatorRule rejects non-function check → TypeError", () => {
  reset();
  assert.throws(
    () => registerValidatorRule({ id: "r1", appliesTo: "manifest" }),
    TypeError,
  );
  assert.throws(
    () => registerValidatorRule({ id: "r1", appliesTo: "manifest", check: "not a fn" }),
    TypeError,
  );
});

test("registry: registerValidatorRule rejects duplicate id → Error", () => {
  reset();
  registerValidatorRule({ id: "dup", appliesTo: "manifest", check: () => [] });
  assert.throws(
    () => registerValidatorRule({ id: "dup", appliesTo: "skill", check: () => [] }),
    /duplicate rule id dup/,
  );
});

test("registry: successful registration appears in listValidatorRules()", () => {
  reset();
  const rule = { id: "r-ok", appliesTo: "skill", check: () => [] };
  registerValidatorRule(rule);
  const listed = listValidatorRules();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "r-ok");
  assert.equal(listed[0].appliesTo, "skill");
  assert.equal(typeof listed[0].check, "function");
  // Iteration order = registration order.
  registerValidatorRule({ id: "r-ok-2", appliesTo: "manifest", check: () => [] });
  assert.deepEqual(
    listValidatorRules().map((r) => r.id),
    ["r-ok", "r-ok-2"],
  );
});

test("registry: registered rule object is frozen (mutation throws in strict mode)", () => {
  reset();
  registerValidatorRule({ id: "r-frozen", appliesTo: "manifest", check: () => [] });
  const [stored] = listValidatorRules();
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => {
    "use strict";
    stored.id = "mutated";
  }, TypeError);
});

test("registry: _resetRegistryForTests empties the array", () => {
  reset();
  registerValidatorRule({ id: "a", appliesTo: "manifest", check: () => [] });
  registerValidatorRule({ id: "b", appliesTo: "skill", check: () => [] });
  assert.equal(listValidatorRules().length, 2);
  _resetRegistryForTests();
  assert.deepEqual(listValidatorRules(), []);
  // After reset, re-registering the same id MUST succeed.
  registerValidatorRule({ id: "a", appliesTo: "manifest", check: () => [] });
  assert.equal(listValidatorRules().length, 1);
});
