# ADR-0016: Pluggable Validator Rule Registry

- Status: Accepted (v0.9.0)
- Date: 2026-05-29
- Related: ADR-0001 (frozen invariants), ADR-0005 (deferred-publish stability), ADR-0006 (kernel/product boundary), ADR-0010 (SPI invariants), ADR-0013 (release gate)
- Implementation: PR #10 · `scripts/installer/core/registry.mjs` · `scripts/installer/core/manifest/validator.mjs`

## Context

Three finding envelope shapes coexist in the kernel today:
`{severity, section, id, message}` in `core/manifest/validator.mjs`,
`{file, severity, message}` in `scripts/lint-skills.mjs`, and
`{path, message}` in `core/state.mjs`. No unified `Finding` type binds
them. Downstream products and sister packages need a way to inject
custom validation rules without forking `validator.mjs` or extending
the closed Asset enum (skill/agent/rule, locked by CONTEXT.md and
`core/asset-types.mjs:22-41`).

The ideation document `docs/ideation/2026-05-28-...:74-101` (Idea 2)
identifies the kernel-generic affordance — **a registry**. The
sister-package `@nexel/governance` is out of scope; this ADR only
adds the kernel hook.

## Decision

1. Add additive public export `registerValidatorRule(rule)` from
   `scripts/installer/index.mjs`. Rule shape:

   ```js
   rule = {
     id: string,                  // unique, used in finding.id + dedupe
     appliesTo: "manifest" | "skill" | "agent" | "rule" | "bundle",
     check: (subject, ctx) => Finding[],
   }
   ```

2. `validateManifest` runs registered rules **after** all built-in
   checks, threading `ctx = Object.freeze({ productConfig })` (where
   `productConfig` is sourced from `cli/commands/index.mjs`
   `loadValidatedManifest`).

3. Findings emitted by rules use the **existing manifest validator
   envelope** (`{severity, section, id, message}`). The existing
   `formatFindings` + `exitCodeFor` consume them unchanged.

4. Rules whose `check` returns a non-array (Promise, single Finding,
   undefined) are **quarantined as `parse-error`** findings with
   `section: "registry"` and `id: rule.id`. Async rules are not
   supported in v0.9.0 (diagnostic surfaced rather than silently
   dropped).

5. Rules whose `check` throws synchronously are also quarantined as
   `parse-error`.

6. `_resetRegistryForTests` is internal — present in `core/registry.mjs`
   but NOT exported from `installer/index.mjs`.

## Rejected alternatives

- **Option A** — `ProductConfig.validatorRules?: ValidatorRule[]` field.
  Rejected: would expand the ADR-0001 D2 frozen identity surface (or
  the `OPTIONAL_DEFAULTS` table at `product-config.mjs:63-80`). Rules
  are runtime policy, not identity.

- **Option C** — SPI / adapter hook. Rejected: SPI is adapter-facing
  (ADR-0010); validator is in `core/manifest/`, not on SPI surface.
  Routing through SPI would breach the three-layer discipline
  enshrined in ADR-0001 D3.

- **Net-new unified `Diagnostic` shape**. Rejected: would require a
  translation contract for all three existing producers (validator,
  lint-skills, state). The contract itself becomes a hard-to-reverse
  surface — pure overhead until at least two sister packages
  consume it.

## Consequences

- `registerValidatorRule` joins SPI v1 stability surface (ADR-0005);
  the rule object shape is hard to reverse after first publish.
- Rules MAY introduce new `section` strings; the existing
  `formatFindings` template `[severity] section[:id] — message`
  accepts any string.
- Asset enum (skill/agent/rule) remains closed. The registry is the
  extension point that lives **outside** the enum.
- Phase 4 Review identified a P1 — silent non-array drop. Fixed by
  the quarantine mechanism above; tests cover Promise, single
  Finding, undefined, and other non-array returns.
- ProductConfig is unchanged. SPI is unchanged. No state schema
  change. No platform branching.

## Implementation references

- `scripts/installer/core/registry.mjs` — module-scope registry
- `scripts/installer/core/manifest/validator.mjs:76, 88-134` — rule
  invocation, quarantine logic
- `scripts/installer/index.mjs` — public exports `registerValidatorRule`,
  `listValidatorRules`
- `scripts/installer/architecture.test.mjs:220` — canary asserts new
  exports
- Plan: `docs/plans/2026-05-29-validator-registry-plan.md`
- Research: `docs/research/2026-05-29-validator-registry-preflight.md`
