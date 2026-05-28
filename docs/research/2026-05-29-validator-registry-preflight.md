---
date: 2026-05-29
topic: pluggable-validator-rule-registry-preflight
mode: read-only-research
scope: nexel kernel surface only; no design proposals
---

# Preflight memo — Pluggable Validator Rule Registry (ADR-0016 candidate)

Read-only inventory of code surface, invariants, and tests at commit `745bf28` (v0.8.5).

## 1. Current validation surface

### Exports of `validator.mjs`

| Export | File:line | Signature |
|---|---|---|
| `validateManifest` | `core/manifest/validator.mjs:42` | `(manifest, options) → Finding[]` |
| `exitCodeFor` | `:311` | `(findings) → 0|1|2` |
| `formatFindings` | `:316` | `(findings, mode) → string` |

CLI entry at `:336` via `import.meta.url` check.

### Call sites of `validateManifest`

- Public re-export: `installer/index.mjs:59`
- Architecture canary: `architecture.test.mjs:220`
- Conformance: `conformance.test.mjs:7,17,73`
- Drift: `drift.mjs:6,14`
- CLI command pipeline: `cli/commands/index.mjs:6,134` (`loadValidatedManifest` builds `validateOpts` with `skillIdPrefix` + `agentNamePrefix`)

### `lint-skills.mjs` — separate validator

Standalone npm script. Exports `validateSkill`, `lintSkillsDir`, etc. Imports `FRONTMATTER_RE` from schema.mjs and skill-metadata helpers. **NOT** exported through `installer/index.mjs`.

### Three coexisting envelope shapes

| Producer | File:line | Shape |
|---|---|---|
| `pushError` (manifest validator) | `validator.mjs:38-40` | `{severity, section, id, message}` |
| `lintSkillsDir` per-file | `lint-skills.mjs:117` | `{file, severity, message}` |
| `validateState` | `state.mjs:76-128` | `{path, message}` |

No unified `Finding` type. Registry MUST pick one or carry translation contract.

## 2. ProductConfig current shape

- `defineProductConfig` at `product-config.mjs:91`
- `REQUIRED_FIELDS = ["productName", "skillIdPrefix", "agentNamePrefix", "defaultManifestFile", "binName"]` at `:55-61` (ADR-0001 D2 frozen)
- `OPTIONAL_DEFAULTS` table at `:63-80`
- `skillIdPrefix` `:` reject at `:127-133`
- `agentNamePrefix` trailing `-` at `:134-140`
- No `validatorRules` field present

## 3. Finding envelope (manifest validator)

```js
Finding = {
  severity: "error" | "parse-error",
  section: "root" | "skills" | "agents" | "rules" | "bundles",
  id: string | null,
  message: string,
}
```

`formatFindings(findings, "text")`: `[${severity}] ${section}${id ? `:${id}` : ""} — ${message}`
`formatFindings(findings, "json")`: `{pass: findings.length === 0, findings}`
`exitCodeFor`: 0/1/2.

No producer in current code emits `"parse-error"` — constant consumed only.

## 4. Hard-to-reverse invariants

- **ADR-0001 D2** — ProductConfig identity frozen (5 fields)
- **ADR-0001 D3** — three-layer import discipline; `core/` only imports `core/`
- **ADR-0006** — kernel-generic vs product-private boundary table
- **ADR-0010** — SPI revision minor only when additive-optional + identity-default preserved
- **CONTEXT.md Asset closure** — "Exactly one of: skill, agent, rule. Not a generic file."

## 5. Asset enum closure sites

| Site | File:line | Form |
|---|---|---|
| Asset-type table | `core/asset-types.mjs:22-41` | `Object.freeze({skill, agent, rule})` |
| State `ASSET_TYPES` | `state.mjs:18` | `["skill", "agent", "rule", "shared"]` |
| Plan inline | `plan.mjs:31, 191-274` | hard-coded per asset arm |
| Manifest sections | `validator.mjs:62` | loop over `["skills","agents","rules","bundles"]` |
| CONTEXT.md | `CONTEXT.md:25-27` | "Exactly one of" |

Enum closed at multiple sites. Ideation Idea 2 (`ideation:74-101`) keeps enum closed; registry is the extension point.

## 6. Trade-off options surfaced (no decisions)

From `ideation:74-101`:
- **Shape A** — `ProductConfig.validatorRules?: ValidatorRule[]` field
- **Shape B** — imperative `register()` from `installer/index.mjs`
- **Shape C** — plugin hook via SPI / adapter

G8 risk ledger (`ideation:87, 319-322`): "validator rule registry 一旦 public 几乎不可改" — Open ADR Candidate.

## 7. Test files needing extension

- `core/manifest/validator.test.mjs:1-143`
- `architecture.test.mjs:220`
- `conformance.test.mjs:7-79` (36 skills / 8 agents / 8 rules / 6 bundles)
- `core/manifest/drift.test.mjs`
- `cli/commands/index.test.mjs`
- `lint-skills.test.mjs:1-435`

## 8. Risks specific to this item

- **G8 registry-is-public-API**: shape becomes stability surface (ADR-0005)
- **Three envelopes**: no unifying type today
- **Asset-enum closure pressure**: registry granting new asset semantics (vs new checks on existing) re-opens closure
- **Cross-touch with v0.8.5 backlog**: deactivate / CI bless / TOCTOU do NOT touch validator.mjs / product-config.mjs / index.mjs exports
- **ADR-0010 minor-bump**: SPI-routed registration requires additive-optional + identity-default; Shape A skirts SPI but lands on D2 identity; Shape B skirts both freezes but adds public surface
