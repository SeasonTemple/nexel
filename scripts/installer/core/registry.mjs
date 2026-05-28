// Pluggable Validator Rule Registry (ADR-0016).
//
// Kernel-generic, in-process registry for custom validator rules. External
// packages (a future `@nexel/governance`, or any product-private linter)
// call `registerValidatorRule(rule)` at process start; rules run during
// `validateManifest` and emit findings using the existing Finding envelope
// shape (see INTERLOCK LOCK 2, validator.mjs:38-40):
//
//   Finding = { severity, section, id, message }
//
// Rules share `formatFindings` / `exitCodeFor` without translation; new
// `section` strings are accepted by the existing template at
// validator.mjs:318.
//
// Registration API (INTERLOCK LOCK 3, Option B — imperative registration):
//
//   ValidatorRule = {
//     id: string,                    // unique; used in finding.id, dedupe key
//     appliesTo: "manifest" | "skill" | "agent" | "rule" | "bundle",
//     check: (subject, ctx) => Finding[],
//   }
//
// `ctx` exposes `productConfig` (read-only). Rules are registered once at
// process start; no deregistration is exposed in v0.9.0 scope. Rule ids
// must be globally unique to prevent silent shadowing.

const RULES = [];

const ALLOWED_APPLIES_TO = ["manifest", "skill", "agent", "rule", "bundle"];

export function registerValidatorRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new TypeError("registerValidatorRule: rule must be an object");
  }
  if (typeof rule.id !== "string" || rule.id.length === 0) {
    throw new TypeError("registerValidatorRule: rule.id must be a non-empty string");
  }
  if (!ALLOWED_APPLIES_TO.includes(rule.appliesTo)) {
    throw new TypeError(
      `registerValidatorRule: rule.appliesTo must be one of ${ALLOWED_APPLIES_TO.join("|")}`
    );
  }
  if (typeof rule.check !== "function") {
    throw new TypeError("registerValidatorRule: rule.check must be a function");
  }
  if (RULES.some((r) => r.id === rule.id)) {
    throw new Error(`registerValidatorRule: duplicate rule id ${rule.id}`);
  }
  RULES.push(Object.freeze({ ...rule }));
}

export function listValidatorRules() {
  return RULES.slice();
}

// Internal helper used by validator.test.mjs / registry.test.mjs only.
// NOT exported from installer/index.mjs.
export function _resetRegistryForTests() {
  RULES.length = 0;
}
