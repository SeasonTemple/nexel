---
title: "feat: absorb necessary netops runtime, locale, baseline, and release capabilities"
type: feat
status: completed
date: 2026-05-22
origin: direct user request
---

# feat: absorb necessary netops runtime, locale, baseline, and release capabilities

## Summary

Absorb the remaining necessary **Kernel**-level capabilities proven in the
`netops-agent-skills` downstream product without importing product-private
NetOps content. The work covers OpenCode plugin runtime instructions,
Skill Metadata validation, a sample-product proof, locale catalogs,
baseline verification, distribution/release helpers, and a downstream-scale
conformance corpus.

This plan treats the existing `netops-agent-skills` implementation as a
blueprint, not a source dump. Concrete NetOps skills, agents, GitLab workflow
content, provider setup content, and hardcoded GitLab release publishing remain
out of scope. The **Absorption** target is product-agnostic behavior that
belongs in `nexel`.

---

## Problem Frame

`nexel` already absorbed the major installer-kernel pieces from the downstream
fork: Adapter SPI v1.1, OpenCode agent frontmatter transform, single-tier
install lifecycle, release-sync lint, ADR practice, and product-coupled tests.
The remaining gap is not basic install support. It is the surrounding runtime
and release surface a real downstream product now relies on:

- OpenCode plugin mode can load ambient instruction files into
  `config.instructions` using `opencode-instructions:` frontmatter.
- CLI output can be localized without letting host locale make tests or
  baselines nondeterministic.
- Baseline verification can byte-freeze contract-bearing output.
- Distribution helpers can produce tarballs and checksums for git/vendor
  consumers.
- Real downstream manifests are much larger than the sample fixture and expose
  validator/drift assumptions the sample cannot.

These are necessary **Kernel** capabilities because they make the kernel usable
as a product foundation across real agent CLIs. They must be designed as deep
**Module**s with product-specific content supplied through **ProductConfig**,
sample fixtures, or downstream products.

---

## Requirements

- R1. OpenCode plugin mode supports a product-agnostic `opencode-instructions`
  metadata path from installed skill frontmatter into OpenCode
  `config.instructions`, while direct install semantics remain unchanged.
- R2. `opencode-instructions` validation is narrow and explicit: single-line,
  non-empty, unquoted relative path; no absolute path; no `..`; target file
  must exist when validating against a repo root.
- R3. A sample product proves the OpenCode plugin runtime path without importing
  NetOps GitLab workflow content.
- R4. Documentation distinguishes the OpenCode direct-install **Seam** from the
  OpenCode plugin-runtime **Seam** and states that the Kernel core does not know
  OpenCode.
- R5. Locale catalog support is absorbed in product-agnostic form, with English
  and Chinese catalogs and deterministic locale isolation.
- R6. Baseline verification is absorbed in product-agnostic form, driven by the
  sample product / config rather than NetOps command names or paths.
- R7. Distribution/release helpers are absorbed in product-agnostic form:
  tarball + sha256 creation, release-note/tag/version preflight, and clean-tree
  checks. Hardcoded GitLab project publishing is not absorbed.
- R8. A downstream-scale conformance corpus is established using a sanitized or
  generated large manifest shaped after `netops.install.json`; the corpus
  stresses the Kernel without copying product-private NetOps content.
- R9. Release discipline stays coherent: version bump, release note,
  `lint:release-sync`, full test suite, manifest/drift lint, and diff whitespace
  checks all pass before completion.

---

## Scope Limits

- Do not copy NetOps skills, agents, rules, GitLab workflow text, provider
  setup scripts, plugin manifests, or release project identity into `nexel`.
- Do not put OpenCode plugin runtime behavior into `core/`.
- Do not put `config.instructions` behavior into `transformAssetContent`; that
  SPI hook must remain a pure content-transform **Interface** for direct install
  staging.
- Do not make `opencode-instructions` a new **Asset** type. It is metadata on a
  skill and resolves to a file consumed by OpenCode plugin runtime.
- Do not start npm publication, remove `"private": true`, or start the public
  contract clock. This plan may improve distribution helpers, not publish the
  package.
- Do not introduce a product-literal dependency on `netops`, `skillctl`, or
  downstream GitLab hosts.

### Deferred to Follow-Up Work

- Real npm publication of `nexel`.
- Generic remote release publishing adapters for GitHub/GitLab/Nexus. This plan
  may define preflight and local artifacts; remote publishing remains separate
  unless the design naturally fits without product host assumptions.
- Installing or managing OpenCode providers. That remains downstream product
  content; `nexel` only handles skill/agent/rule install and plugin config
  instruction discovery.

---

## Context & Research

### Current `nexel` Shape

- `CONTEXT.md` defines the core language: **Kernel**, **ProductConfig**,
  **Adapter**, **Asset**, **Manifest**, **Absorption**, **Release model**.
- `scripts/installer/adapters/opencode.mjs` already supports OpenCode direct
  install and `transformAssetContent` for agent frontmatter translation.
- `scripts/installer/adapters/README.md` defines the Adapter SPI and purity
  expectations.
- `scripts/installer/core/manifest/validator.mjs` validates manifest structure,
  skill frontmatter name/category matches, dependencies, host-specific
  applicability, and path safety.
- `examples/sample-product/` is the canonical product fixture for Kernel tests.
- `scripts/installer/architecture.test.mjs` enforces the Z-layer import rule.

### Downstream Blueprint

- `netops-agent-skills` v0.13.x has:
  - `opencode-instructions:` frontmatter metadata on a setup skill.
  - An OpenCode plugin file that scans skill `SKILL.md` frontmatter and appends
    discovered instruction files to `config.instructions`.
  - Locale catalogs (`strings.en.mjs`, `strings.zh.mjs`) and locale isolation
    tests.
  - `verify-baseline.mjs` for byte-baseline verification.
  - `build-dist.mjs` for `npm pack` + sha256.
  - `publish-release.mjs`, which is useful only as a product-specific reference
    because it hardcodes GitLab host/project identity.
  - `netops.install.json`, a real downstream-scale manifest with dozens of
    skills, agents, rules, bundles, profiles, and categories.

### Institutional Memory

- In `netops-agent-skills`, `netops.install.json` is the source of truth for
  installer visibility. Adding skill directories without manifest registration
  is invalid.
- `setup-help` routes skills that mutate agent-CLI runtime instruction/config
  surfaces. `gitlab-issue-workflow` needed `setup-config-target:
  agent-instructions`; OpenCode plugin mode still uses `opencode-instructions`
  to load ambient instruction files through `config.instructions`.
- Release validation in the downstream product includes skill lint, manifest
  lint, drift lint, release-sync lint, tests, and whitespace diff checks.

---

## Key Technical Decisions

- **Two OpenCode seams.** Direct install stays in the existing Adapter
  **Seam**: map target paths and transform staged asset content. Plugin runtime
  config gets a separate **Module** that mutates OpenCode's `config` object at
  plugin load. This preserves SPI purity and keeps `core/` product-agnostic.
- **OpenCode Plugin Runtime gets a subpath export.** The helper is public for
  downstream OpenCode plugin files, but not part of the main Kernel export.
  Downstream products import `nexel/adapters/opencode-plugin` instead of deep
  importing `scripts/installer/...`.
- **Metadata, not Asset.** `opencode-instructions` is frontmatter metadata on a
  skill, pointing at a skill-relative instruction file. It does not make the
  instruction file independently installable, selectable, drift-managed, or
  visible as an **Asset**.
- **Category/profile agnostic.** `opencode-instructions` is OpenCode
  **Plugin Runtime** activation metadata, not setup routing. It may appear on
  any visible skill category/profile. Downstream setup routing, when present,
  remains separate product metadata such as `setup-config-target`.
- **Strict parser by design.** Follow the downstream narrow parser: single
  frontmatter line, plain relative path, no quotes or spaces. This avoids
  committing to full YAML expression support before the Kernel has a real need.
- **Warnings at plugin runtime, findings at validation time.** OpenCode plugin
  runtime should warning-skip bad metadata so one bad skill does not break all
  plugin loading. Manifest/lint validation should report findings so product
  maintainers catch defects pre-release.
- **Locale must not change contracts.** Locale affects human-facing strings,
  not JSON envelope keys, exit codes, manifest schema, or **Public API
  contract**.
- **Baseline command set is product-supplied or sample-derived.** `nexel` must
  not hardcode NetOps commands. Baselines should be captured from
  `examples/sample-product/` or a config object.
- **Release helper stops before remote publication identity.** Local artifact
  generation and preflight are Kernel-appropriate. Posting to a specific GitLab
  project is downstream product behavior.
- **Release preflight and dist stay separate.** `release:preflight` is read-only
  and suitable for PR/CI checks. `dist` generates tarball/checksum artifacts and
  is a publishing step.

---

## Open Questions

### Resolved During Planning

- `config.instructions` should be included: yes. It is necessary OpenCode
  plugin-runtime behavior, separate from direct install.
- Product content should be copied: no. Only the mechanism is absorbed.
- All necessary capabilities should be in this plan: yes. The plan covers
  OpenCode plugin runtime, metadata validation, sample proof, docs, locale,
  baseline, release helpers, and conformance corpus.

---

## Implementation Units

This remains one governing plan so cross-unit constraints stay visible. The
implementation may still split review/PRs by phase: U1-U5 OpenCode Plugin
Runtime and **Skill Metadata**, U6-U7 locale and baseline, U8-U9 release
helpers, and U10-U11 conformance plus release.

### U1. Record the OpenCode Plugin Runtime Seam

**Goal:** Make the architecture decision explicit before adding runtime plugin
behavior.

**Requirements:** R1, R4

**Dependencies:** None

**Files:**
- Create: `docs/adr/0009-opencode-plugin-runtime-instructions.md` or a
  similar next-number ADR if `0009` is already used at implementation time
- Modify: `CONTEXT.md`
- Modify: `scripts/installer/adapters/README.md`

**Approach:**
- Record that direct install and plugin runtime are separate **Seam**s.
- State that `transformAssetContent` remains pure, direct-install only, and
  cannot discover files or mutate OpenCode config.
- Record that OpenCode `config.instructions` belongs to **Plugin Runtime**, not
  Adapter SPI.
- Record the public surface decision: export the helper as
  `./adapters/opencode-plugin`, do not deep-import it from downstream products,
  and do not re-export it from the main `index.mjs`.
- Record that `opencode-instructions` is **Skill Metadata**, not a **Manifest**
  field or **Asset** declaration, and is category/profile agnostic.
- Keep the `CONTEXT.md` **Plugin Runtime** term aligned with the ADR and helper
  implementation.
- Update Adapter docs to explain that plugin runtime helpers may exist beside
  adapters but are not part of the core Adapter SPI unless a future ADR expands
  the SPI.

**Test Scenarios:**
- Documentation-only. Covered by later architecture tests and full suite.

**Verification:**
- ADR scopes the **Seam** correctly.
- `CONTEXT.md` uses existing vocabulary and does not introduce alternate terms
  for **Seam**.
- No production code changes in this unit.

---

### U2. Add OpenCode Plugin Runtime Helper

**Goal:** Provide a product-agnostic **Module** that appends installed skill
paths and discovered instruction files to OpenCode plugin config.

**Requirements:** R1, R3

**Dependencies:** U1

**Files:**
- Create: `scripts/installer/adapters/opencode-plugin.mjs`
- Create: `scripts/installer/adapters/opencode-plugin.test.mjs`
- Modify: `package.json` (`exports["./adapters/opencode-plugin"]` and test
  script / aggregate)
- Modify: `scripts/installer/architecture.test.mjs` if public-subpath import
  checks need to recognize the sample plugin fixture

**Approach:**
- Implement functions equivalent in role to:
  - `readOpenCodeInstructions(frontmatterText, skillName, logger)`
  - `discoverOpenCodeInstructions(skillsDir, logger)`
  - `configureOpenCode(config, skillsDir, logger)`
- `configureOpenCode` ensures `config.skills.paths` includes `skillsDir`.
- It discovers declared instruction files and ensures `config.instructions`
  contains each absolute path once.
- Runtime invalid metadata warnings must not throw.
- Path resolution must guarantee declared instruction paths stay inside the
  declaring skill directory.
- Export the helper as `./adapters/opencode-plugin` in `package.json`. Do not
  re-export it from `scripts/installer/index.mjs`; it is OpenCode
  **Plugin Runtime** surface, not the main Kernel **Interface**.
- README/sample plugin imports should use the subpath export when showing
  downstream usage, not a deep `scripts/installer/...` path.

**Test Scenarios:**
- Happy path: two skills declare instruction files; `config.skills.paths` and
  `config.instructions` are populated.
- Idempotency: calling `configureOpenCode` twice does not duplicate paths.
- Missing metadata: skill without `opencode-instructions` leaves instructions
  unchanged.
- Failure paths: empty value, quoted value, path with spaces, absolute path,
  `..`, and missing target file all warning-skip.
- Safety: a path that normalizes outside the skill directory is skipped.
- Empty skills directory returns no instruction paths.
- Public surface: package `exports` includes `./adapters/opencode-plugin`, and
  main `index.mjs` does not grow OpenCode plugin runtime exports.

**Verification:**
- `npm run test:opencode-plugin` or equivalent per-suite script passes.
- `npm test` includes the new test file.
- `scripts/installer/architecture.test.mjs` still passes.

---

### U3. Validate `opencode-instructions` Skill Metadata

**Goal:** Catch malformed OpenCode instruction metadata across the skill-lint
and manifest-validation surfaces while keeping it metadata, not a new
**Asset** type.

**Requirements:** R2

**Dependencies:** U2

**Files:**
- Modify: `scripts/installer/core/manifest/schema.mjs`
- Modify: `scripts/installer/core/manifest/validator.mjs`
- Modify: `scripts/installer/core/manifest/validator.test.mjs`
- Modify: `scripts/lint-skills.mjs`
- Modify: `scripts/lint-skills.test.mjs`

**Approach:**
- Extend `scripts/lint-skills.mjs` to recognize `opencode-instructions` as
  **Skill Metadata** and validate its syntax shape:
  - value present and non-empty
  - string value
  - no quotes
  - no whitespace
  - relative path
  - no `..` path segment
- Extend `manifest/validator.mjs` only for repo-aware validation: when
  `repoRoot` and skill `sourcePath` are available, confirm the metadata path
  stays inside that skill directory and the target file exists.
- Preserve current unknown-frontmatter behavior. This unit recognizes one known
  metadata key; it does not introduce a global frontmatter allow-list.
- Do not add the instruction file to manifest `rules`, `skills`, `agents`, or
  `bundles`.
- Do not restrict `opencode-instructions` to `category: setup` or any specific
  `profile`; validator logic must keep setup routing concerns separate.

**Test Scenarios:**
- Legal skill frontmatter with existing `references/opencode-instructions.md`
  passes both lint and manifest validation.
- Empty, non-string, quoted, whitespace-containing, absolute, and `..` values
  fail skill lint.
- Missing target files fail manifest validation when `repoRoot` is supplied.
- No `opencode-instructions` remains valid.
- Metadata does not affect dependency resolution or `transitiveAssets`.
- Host-specific skills can declare metadata without changing `appliesTo`
  validation.
- Non-setup skills can declare metadata; category/profile do not affect the
  metadata validation result.

**Verification:**
- `npm run test:lint` passes.
- `npm run test:validator` passes.
- `npm run lint:skills` and `npm run lint:manifest` pass.

---

### U4. Add Sample Product Proof

**Goal:** Demonstrate how a downstream product uses OpenCode plugin runtime
instructions without copying NetOps content.

**Requirements:** R3

**Dependencies:** U2, U3

**Files:**
- Modify: `examples/sample-product/sample.install.json`
- Modify or create: `examples/sample-product/skills/<sample-skill>/SKILL.md`
- Create: `examples/sample-product/skills/<sample-skill>/references/opencode-instructions.md`
- Create: `examples/sample-product/.opencode/plugins/sample-product.js`
- Modify: `examples/sample-product/sample-bin.test.mjs` or add a focused
  sample plugin test

**Approach:**
- Add a small sample skill that declares
  `opencode-instructions: references/opencode-instructions.md`.
- The instruction body must be generic and short; no GitLab or NetOps workflow
  content.
- Wire a sample OpenCode plugin fixture to call the product-agnostic helper from
  U2. This fixture is a real downstream-product example, not a test-only copy.
- Keep the sample plugin thin: import the public
  `nexel/adapters/opencode-plugin` helper (or the repo-local equivalent that
  represents that subpath before package resolution) and delegate config
  mutation to it.
- Keep sample manifest visibility intact: the skill remains visible only via
  manifest registration.

**Test Scenarios:**
- Sample plugin config adds sample skills path and the sample instruction path.
- Sample plugin config is idempotent.
- Existing sample install/plan/list tests still pass.
- The instruction file is not treated as a separate **Asset** in plan output.
- Architecture/public-surface test: the sample plugin does not deep import
  Kernel internals.

**Verification:**
- `npm run test:sample-bin` and the new sample plugin test pass.
- `npm run lint:manifest` and `npm run lint:drift` pass.

---

### U5. Document OpenCode Direct vs Plugin Mode

**Goal:** Make user-facing and integrator docs reflect both OpenCode paths.

**Requirements:** R4

**Dependencies:** U2, U4

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `scripts/installer/adapters/README.md`
- Modify: `docs/AGENT-CLI-CONTRACT.md` or create a focused OpenCode plugin doc

**Approach:**
- Explain:
  - direct install writes `skills/`, `agent/`, and rule reference files under
    the OpenCode config root
  - plugin mode adds `config.skills.paths`
  - plugin mode may add `config.instructions` from declared skill metadata
  - OpenCode Adapter does not write `AGENTS.md`
- Keep the docs product-agnostic and sample-based.
- Update `pluginInstallInstructions()` only if its generic text should mention
  `opencode-instructions`; do not add product URLs.

**Test Scenarios:**
- README examples remain valid for sample product.
- Product-literal guard tests do not fail on new docs if those tests scan docs.

**Verification:**
- `rg "netops|skillctl" README.md README.zh-CN.md scripts/installer/adapters/README.md docs/AGENT-CLI-CONTRACT.md`
  only shows intentional historical references, if any.

---

### U6. Absorb Locale Catalog Support

**Goal:** Add product-agnostic locale catalogs and deterministic locale
selection.

**Requirements:** R5

**Dependencies:** U5 can run in parallel conceptually, but implementation should
settle docs wording first if doc strings move into catalogs.

**Files:**
- Modify: `scripts/installer/cli/strings.mjs`
- Create: `scripts/installer/cli/strings.en.mjs`
- Create: `scripts/installer/cli/strings.zh.mjs`
- Create: `scripts/installer/cli/locale.mjs` if locale resolution is separated
- Create: `scripts/installer/cli/locale-isolation.test.mjs`
- Modify: `scripts/installer/cli/strings.test.mjs`
- Modify: `scripts/installer/cli/run.mjs`, `help.mjs`, `error-format.mjs`,
  `prompts.mjs`, and command output callers as needed
- Modify: `package.json`

**Approach:**
- Extract the current English strings as the default catalog.
- Add Chinese catalog only for strings owned by the catalog; avoid half-moving
  unrelated inline literals unless they are part of the CLI contract surface.
- Locale resolution order should be explicit and testable. Prefer a
  product-configured env var when present, then generic env if already used,
  then default English.
- JSON envelope keys and error codes stay language-independent.
- Tests should pin locale and prove host `LANG`/`LC_ALL` cannot make baseline
  output drift unexpectedly.

**Test Scenarios:**
- English default output matches existing expected shape.
- Chinese locale renders Chinese text for representative help/error/run strings.
- JSON output keys remain unchanged across locales.
- Host locale is isolated when an explicit env override is supplied.
- Missing catalog key fails a completeness test.
- Catalog functions do not render `undefined`, `NaN`, or product literals.

**Verification:**
- `npm run test:strings` passes.
- `npm run test:locale-isolation` passes.
- Existing help/error/prompt tests pass.

---

### U7. Add Product-Agnostic Baseline Verification

**Goal:** Add a Kernel-level byte-baseline verifier for contract-bearing CLI
output.

**Requirements:** R6

**Dependencies:** U6, because baseline output should be locale-pinned.

**Files:**
- Create: `scripts/verify-baseline.mjs`
- Create: `examples/sample-product/.baseline/help.txt`
- Create: `examples/sample-product/.baseline/list.json`
- Create: `examples/sample-product/.baseline/agents.json`
- Create: `examples/sample-product/.baseline/doctor.json`
- Create: `examples/sample-product/.baseline/validate.json`
- Create: `scripts/verify-baseline.test.mjs` if helper logic is factored
- Modify: `package.json`
- Modify: `README.md` and `README.zh-CN.md` only if exposing the command

**Approach:**
- Use `examples/sample-product/bin.mjs` as the default baseline subject.
- Command list should be declared in one place and not mention NetOps.
- Commit the initial baseline files under `examples/sample-product/.baseline/`
  because the sample product is the baseline subject.
- Keep the frozen command set small and stable: `help`, `list --json`,
  `agents --json`, `doctor --json`, and `validate --json`.
- Pin locale to English for byte baselines.
- Capture stderr/stdout consistently.
- Diff output should show concise added/removed lines, including duplicate-line
  counts.
- Treat baseline updates as contract-output changes that require review and a
  release-note mention; do not treat them as incidental snapshot churn.

**Test Scenarios:**
- Matching baseline passes.
- Missing baseline fails with a capture hint.
- Changed output fails and reports added/removed lines.
- Duplicate-line removal is detected.
- Locale pin makes output stable when host `LANG` is Chinese.
- Default verifier path reads `examples/sample-product/.baseline/`.

**Verification:**
- `npm run verify:baseline` or equivalent passes when baselines are current.
- `npm test` passes.

---

### U8. Add Distribution Artifact Helper

**Goal:** Provide local release artifacts for git/vendor consumers.

**Requirements:** R7

**Dependencies:** None, but final release unit depends on this.

**Files:**
- Create: `scripts/build-dist.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md` and `README.zh-CN.md` if documenting the command

**Approach:**
- Wrap `npm pack`.
- Write `<package>-<version>.tgz.sha256`.
- Print artifact names, sizes, sha256, and generic next steps.
- Do not mention internal mirrors or NetOps hosts except as placeholder
  examples, if examples are needed at all.
- Ensure generated tarballs/checksum files are ignored by git if they are not
  intended for commit.
- Add ignore entries for `nexel-*.tgz` and `nexel-*.tgz.sha256`.

**Test Scenarios:**
- Running the helper produces a tarball and matching sha256 file.
- Missing tarball after `npm pack` fails clearly.
- The helper reads package name/version from `package.json`.
- Artifact names contain `nexel`, not `netops-agent-skills` or `skillctl`.
- Generated artifacts are ignored by git.

**Verification:**
- `npm run dist` produces expected artifacts locally.
- `git status --short` shows only ignored/generated artifacts after cleanup, not
  accidental tracked files.

---

### U9. Add Release Preflight Helper

**Goal:** Absorb product-agnostic release checks without hardcoding remote
publication.

**Requirements:** R7, R9

**Dependencies:** U8

**Files:**
- Create: `scripts/release-preflight.mjs`
- Modify: `package.json`
- Modify: `docs/release-notes/` only in final release unit

**Approach:**
- Validate:
  - working tree clean unless an explicit local override is passed for testing
  - `package.json` version has matching `docs/release-notes/vX.Y.Z.md`
  - newest release note matches package version
  - optional local tag exists or does not exist depending on mode
  - `package-lock.json` version matches package version
  - release note body is non-empty
- Keep remote push and release-object creation out of scope.
- If future remote publishing is needed, define an Adapter-like seam later.

**Test Scenarios:**
- Clean matching version/note passes.
- Missing release note fails.
- Empty release note fails.
- Package-lock mismatch fails.
- Dirty tree fails.
- Version/newest-note mismatch fails.

**Verification:**
- `npm run release:preflight` passes at final release state.
- Existing `npm run lint:release-sync` remains the lower-level version-note
  guard.

---

### U10. Establish Downstream-Scale Conformance Corpus

**Goal:** Stress Kernel behavior against a large, realistic downstream manifest
shape without copying NetOps product content.

**Requirements:** R8

**Dependencies:** U3, U6 if locale affects output in corpus tests

**Files:**
- Create: `examples/conformance-product/` or
  `test/fixtures/conformance-product/`
- Create: a generated or sanitized large manifest fixture
- Create: conformance tests under `scripts/installer/` or `examples/`
- Modify: `package.json`

**Approach:**
- Model scale after `netops.install.json`: dozens of skills, agents, rules,
  bundles, multiple profiles, categories, host-specific items, dependencies,
  and `opencode-instructions` metadata.
- Use generic names and content.
- Keep the fixture small enough to review but large enough to catch O(N)
  assumptions and path/category/profile drift.
- If generated, commit the generator or document how the fixture was produced.

**Test Scenarios:**
- Large manifest validates.
- Drift detection reports no false positives on a clean fixture.
- Plan resolution handles transitive skill/agent/rule dependencies.
- Host-specific filtering behaves for OpenCode / Claude Code / Codex.
- `opencode-instructions` metadata in many skills validates and resolves.
- Case-folded path collisions are still caught.

**Verification:**
- New conformance test passes.
- Runtime is acceptable for normal `npm test`.

---

### U11. Final Release Unit

**Goal:** Ship the absorption work with coherent release discipline.

**Requirements:** R9

**Dependencies:** U1 through U10

**Files:**
- Create: `docs/release-notes/v<next>.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Approach:**
- Choose patch/minor based on actual shipped surface. Expected: minor, because
  OpenCode plugin runtime instructions, locale support, baseline verification,
  and release helpers are new features.
- Release note should state:
  - OpenCode plugin mode can discover `opencode-instructions`
  - direct install behavior is unchanged
  - locale support added without changing JSON contract
  - baseline and release helpers added
  - conformance corpus added
  - product-private NetOps content was not imported
- Keep `"private": true` unless a separate publish decision supersedes current
  ADRs.

**Test Scenarios:**
- `npm test`
- `npm run lint:skills`
- `npm run lint:manifest`
- `npm run lint:drift`
- `npm run lint:release-sync`
- `npm run release:preflight`
- `npm run verify:baseline` if baselines are committed
- `npm run dist` after preflight passes
- `git diff --check`

**Verification:**
- All commands pass.
- Release note and package versions match.
- No tracked generated tarball/checksum remains unless explicitly intended.

---

## System-Wide Impact

- **OpenCode runtime:** New plugin-runtime **Module** can mutate OpenCode config
  in plugin mode. Direct install remains unchanged.
- **Manifest semantics:** Skill metadata surface grows by one known key,
  `opencode-instructions`. **Asset** visibility still comes only from
  manifest entries.
- **Adapter SPI:** No change unless implementation discovers a real need. The
  default plan is a helper beside the OpenCode Adapter, not a SPI field.
- **CLI output:** Locale catalogs may change human-facing output; JSON contract
  remains stable.
- **Release workflow:** Adds local artifact/preflight tools; remote publication
  remains downstream-specific.
- **Test surface:** Full suite grows to include OpenCode plugin runtime, locale
  isolation, baseline verification, distribution helper, release preflight, and
  conformance corpus.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| OpenCode plugin helper leaks into `core/` | U1 ADR + architecture test; keep helper under adapter/plugin runtime layer |
| `opencode-instructions` becomes an accidental Asset model | U3 tests assert it does not affect `transitiveAssets` or plan files |
| Runtime plugin warnings hide release defects | U3 validation produces findings pre-release; runtime warning-skip is only for OpenCode load resilience |
| Locale changes break baselines | U6 lands before U7; baseline verifier pins locale |
| Release helper accidentally hardcodes NetOps GitLab | U9 excludes remote publishing and tests names/URLs for product literals |
| Conformance fixture copies private product content | Use generated/sanitized generic content; no NetOps skill bodies, agents, or GitLab workflow text |
| Plan becomes too large for one PR | Units are independently reviewable. If split, preserve order: U1-U5 OpenCode, U6 locale, U7 baseline, U8-U9 release, U10 corpus, U11 release |

---

## Documentation / Operational Notes

- The OpenCode plugin helper should be usable by downstream products that build
  an OpenCode plugin around `nexel`; direct install users do not need it.
- Product maintainers adding ambient OpenCode instructions should declare the
  path in the skill frontmatter and keep the target file inside that skill dir.
- Baseline files, if committed, become intentional contract artifacts. Updating
  them should be reviewed like a behavior change, not treated as mechanical
  test churn.
- Release helper output should remain generic enough for git tag, vendored, or
  internal mirror consumers.

---

## Sources & References

- `CONTEXT.md`
- `docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md`
- `docs/adr/0002-adapter-content-transform-via-spi-hook.md`
- `docs/adr/0004-absorption-provenance-netops-tier-1-2.md`
- `scripts/installer/adapters/opencode.mjs`
- `scripts/installer/adapters/README.md`
- `scripts/installer/core/manifest/validator.mjs`
- `examples/sample-product/`
- Downstream reference only: `netops-agent-skills` OpenCode plugin runtime,
  locale catalogs, baseline verifier, dist helper, release preflight, and
  large manifest shape.
