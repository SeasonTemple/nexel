---
date_created: 2026-05-29
status: completed
idea_ref: "Idea 7 — Manifest from filesystem (docs/backlog/v0.9.x-candidates.md §Verified-remaining #2)"
adr_required: no (dev-tool policy, single-file reversible, validator name+category precedent; revisit if kernel-side manifestMode enforcement ever lands)
revision: "v2 — tightened after ce-adversarial-document-reviewer pass (keystone tautology, dangling-ref drop, regex corruption, manifestMode no-op all addressed)"
---

# Plan: `rebuild-manifest` — derive install.json from the filesystem

## Why

Adding a skill today is double-encoded: you write `name` / `category` /
`description` in `SKILL.md` **and** repeat `id` / `dirname` / `sourcePath` /
`category` in `install.json`. They drift; only `name` + `category` are
cross-checked. `rebuild-manifest` walks `<skillsDir>/*/SKILL.md` and
regenerates the canonical `install.json`, so frontmatter is the single source
of truth for the derivable fields and adding a skill is "create the dir, run
rebuild".

## Placement (revised)

This is a **dev/CI tool**, exactly like `scripts/lint-skills.mjs` /
`scripts/install-skills.mjs` — not part of the runtime kernel. So it lives at
**`scripts/rebuild-manifest.mjs`**, NOT in `core/` and NOT exported from
`index.mjs`. Consequences:
- It may `import { parse } from "yaml"` (scripts/ has no layer restriction;
  lint-skills already does). Robust frontmatter parsing — no line-regex
  corruption class.
- No public-API surface added, no `core` dependency change, no ADR weight.
- Downstream products consume it the same way they consume the linter (run it,
  or fork it). No `ProductConfig` change.

## Key design insight (drives the approach)

The frontmatter-match validator (`validator.mjs:validateSkillFrontmatterMatch`,
~line 303) checks **only `name` + `category`** — not `description`. The sample
proves this is deliberate (`hello-world`'s manifest description is a hand-trimmed
shorter form). So `description` / `profile` / `dependencies` are **authored**,
intentionally allowed to diverge.

⇒ **Derive only the cleanly-derivable fields; merge-preserve everything
authored, verbatim, never reconstructing authored objects.**

| Skill entry field | Source on rebuild |
|---------------------|-------------------|
| `id` (map key)      | frontmatter `name` (yaml-parsed, validated) |
| `dirname`           | directory name |
| `sourcePath`        | `<skillsDirName>/<dirname>` |
| `category`          | frontmatter `category` (must be in `CATEGORY_SET`) |
| `description`       | **preserve**; NEW skill → seed from frontmatter `description` |
| `profile`           | **preserve**; NEW skill → `"standalone"` |
| `dependencies`      | **preserve verbatim** (object spread; sub-keys never reordered) |
| any other field     | **preserve verbatim** |
| `agents`/`rules`/`bundles`/`$schemaDescription`/`schemaVersion` | **preserve verbatim** |

## Non-destructive contract (revised — was the big hole)

- Skill **on disk, not in manifest** → **added** (new entry, frontmatter-seeded).
- Skill **in manifest, dir gone on disk** → **hard error**, listing the
  orphaned ids. Derive NEVER silently drops, because dropping a skill still
  referenced by a `bundle` or another skill's `dependencies` would emit a
  manifest that fails the repo's own `validateBundles` /
  `validateDependencies`. Removal stays a manual manifest edit. (Resolves the
  dangling-reference + dependencies-reconstruction findings — authored objects
  are never rebuilt, only spread.)
- Two dirs whose frontmatter declares the **same `name`** → **hard error**
  (duplicate derived id; would silently overwrite otherwise).
- frontmatter `name` / `category` missing, malformed, or `category` not in the
  enum → **hard error** (a generator must refuse to persist garbage, unlike the
  validator which safely skips). `--id-prefix` (optional, mirrors lint-skills)
  asserts every derived id starts with `<prefix>:`.

## `--check` mode (regen-and-diff, done right)

`scripts/rebuild-manifest.mjs --manifest=<path> [--check]`:
- default: write the regenerated manifest to `<path>`.
- `--check`: regenerate in memory, then in this order
  1. run `validateManifest(regenerated, paths)` — catches schema / dangling
     cross-references in the *generated* output (NOT just a byte diff),
  2. byte-compare against on-disk,
  3. exit `0` only if validation clean AND bytes identical; else exit nonzero
     and print the diff / findings.

This does NOT replace `lint:manifest` (validate authored) — it is the
opt-in check a product using the derived workflow runs in CI. Authored
products keep `lint:manifest` / `lint:drift` unchanged. (Resolves the
"--check conflated with lint" finding.)

## Canonical serialization (idempotent, locale-safe)

- top-level key order: `$schemaDescription`, `schemaVersion`, `skills`,
  `agents`, `rules`, `bundles` (only present keys).
- skill-entry field order: `id`, `dirname`, `sourcePath`, `category`,
  `profile`, `description`, `dependencies` (only present fields).
- **existing map keys keep their on-disk order; new skills inserted by
  codepoint sort** (`a < b`, NOT `localeCompare` — guards the prior
  locale-leak regression noted in memory).
- `dependencies` and all preserved objects are spread verbatim — sub-key order
  is whatever `JSON.parse` retained; never reconstructed.
- 2-space indent, `\n`, single trailing newline (matches the sample
  byte-for-byte).

## Files

- `scripts/rebuild-manifest.mjs` (new) + `scripts/rebuild-manifest.test.mjs`
- `package.json` (+ `rebuild:manifest`, `test:rebuild`; add the test to `test`)
- `examples/sample-product/`: dogfood — a `rebuild:manifest --check` invocation
  proving the committed `sample.install.json` is already in derived-canonical
  form (and stays so).
- CLAUDE.md (Commands table row).
- No ADR, no ProductConfig field, no index.mjs change.

## Tests

- **Serializer canonical-form (the real keystone, not a tautology):** derive
  from a manifest whose skill entries are in a *deliberately scrambled* field
  order and assert the output is in canonical order — proves the serializer
  reorders, which the already-canonical sample cannot prove.
- **Idempotency regression guard:** `serialize(derive(load(sample))) ===
  readFile(sample)` byte-for-byte (kept as a guard, no longer the sole proof).
- New skill dir, no manifest entry → added; other entries' authored
  `description`/`profile`/`deps` untouched; new entry `profile: "standalone"`,
  description from frontmatter.
- Manifest skill with missing dir → **error** (listing the id), nothing written.
- Two dirs same `name` → **error**.
- frontmatter `category` not in enum / quoted-with-colon value → **error** (not
  silently persisted) — the yaml-parse + enum-check path.
- `--check`: clean → exit 0; add a dir (drift) → nonzero + diff; a regenerated
  manifest with a dangling bundle ref → nonzero via `validateManifest` step.
- CRLF SKILL.md frontmatter parses identically to LF.
- `--id-prefix=sample` passes on sample; a wrong prefix → error.

## Verification

`npm test` green incl. the scrambled-order serializer test. Manual: add a
throwaway skill dir under sample-product/skills, `npm run rebuild:manifest`,
confirm the entry appears canonical; `--check` flips nonzero before regen, 0
after; delete a committed skill dir → `--check` errors (no silent drop).

## Deferred (genuine)

- Runtime CLI verb `nexel rebuild-manifest` (friction is dev/CI-time).
- `ProductConfig.manifestMode` + kernel-side enforcement (an unenforced field
  is dead contract surface today; revisit with an ADR if/when enforcement is
  built — that is the decision that would clear the ADR bar).
- Deriving `agents` from `agents/*.md` (installedName mapping is authored).
- Moving `profile` / `dependencies` into frontmatter.
