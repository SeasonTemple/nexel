# CI Bless Path Preflight (ADR-0013 → ADR-0018 candidate)

Read-only research memo. Facts only; no design proposals.

## 1. Current ADR-0013 enforcement

Local `pre-push` hook + session-local SHA-bound marker file.

- Hook: `.husky/pre-push:36-91` — reads `git push` stdin; only acts on `refs/tags/v*`
- Marker path literal: `.husky/pre-push:45` → `marker=".nexel/release-blessed-${tag}"`
- Marker writer: `scripts/release-bless.mjs:34,77` — writes to `.nexel/release-blessed-<tag>` via `MARKER_DIR = path.join(REPO_ROOT, ".nexel")`
- Marker format (3 lines from `release-bless.mjs:79-82`):
  ```
  tag=vX.Y.Z
  commit=<40-char hex SHA>
  blessed_at=<ISO-8601>
  ```
- Hook parse: `.husky/pre-push:61` extracts via `grep -E '^commit=[0-9a-f]{40}$'`
- SHA comparison: `:72,74` peels `local_sha^{commit}` to handle annotated tags
- npm wiring: `package.json:107` `release:bless`

**No other artifact records "review was run"**. Marker is sole record.

## 2. Husky hook list

`.husky/` contains: `_/`, `commit-msg`, `pre-commit`, `pre-push`, `pre-push.test.mjs`.

- `commit-msg`: `node scripts/lint-commit-msg.mjs "$1"`
- `pre-commit`: `npm run lint:release-sync` + `npm test`
- `pre-push`: tag-gate per §1
- `pre-push.test.mjs`: node test suite for hook (not itself a hook)

## 3. GitHub Actions workflows

`.github/workflows/`: `ci.yml`, `release.yml`.

- `ci.yml`: triggers on push to main + PR to main. Single job `test` on `ubuntu-latest` Node 24: checkout → `npm ci` → `npm test` → `npm run release:preflight` → `npm run package:smoke`
- `release.yml`: triggers on tag push `v*.*.*`. Single job `release` on `ubuntu-latest` Node 24: checkout (fetch-depth 0) → `npm ci` → `node scripts/verify-release-tag.mjs $GITHUB_REF_NAME` → `npm test` → `npm run release:preflight` → `npm run dist` → `gh release create` uploads `.tgz` + `.sha256`

**Neither workflow checks bless marker.** `.gitignore` excludes `.nexel/` ("Kernel managed-state dir" block) so marker cannot reach CI via checkout.

## 4. package.json scripts (release/lint/verify/tag/gate/review)

From `package.json:59-124`:
- `lint:skills`, `lint:manifest`, `lint:drift`, `lint:commit-msg`, `lint:release-sync`, `fix:drift`
- `test:lint`, `test:commit-msg`, `test:release-note-policy`, `test:release-sync`, `test:release-preflight`, `test:release-tag`, `test:release-prepare`
- `release:bless` → `node scripts/release-bless.mjs`
- `test:pre-push` → `node --test .husky/pre-push.test.mjs`
- `release:patch/minor/major` (npm version, no tag)
- `release:prepare` → `release-prepare.mjs`
- `release:preflight` → `release-preflight.mjs`
- `verify:baseline` → `verify-baseline.mjs`

**No script named `gate` or `review`.** No script verifies bless marker outside hook.

## 5. `scripts/verify-release-tag.mjs` current checks

- `:13` tagName required
- `:14` must match `/^v\d+\.\d+\.\d+$/`
- `:20-22` `tag === \`v${pkg.version}\``
- `:25-27` release note `docs/release-notes/<tag>.md` exists
- `:30-32` release note non-empty
- `:33-35` bilingual policy

**No marker / bless / SHA assertion.** Used in CI `release.yml:31`.

## 6. Existing marker file format

Present. Live examples: `.nexel/release-blessed-v0.8.3`, `v0.8.4`, `v0.8.5`. Content of `v0.8.5`:

```
tag=v0.8.5
commit=745bf28f81d9094fac17553870cdbe08d97f6ffa
blessed_at=2026-05-28T18:56:05.569Z
```

Hook only parses `commit=<40-hex>`. Tag/timestamp advisory.

## 7. Fresh-clone test path

**Not present.** `.husky/pre-push.test.mjs:22-35` (`makeFixture`) creates tmp git repo, copies hook in, runs locally — never `git clone`s nexel itself nor simulates CI runner without `.nexel/`. `grep "git clone"` across `scripts/`, `.husky/`, `.github/` matches only adapter strings.

## 8. Hard-to-reverse invariants

- **ADR-0013** (`:86-92`): CI gap. "The marker lives in `.nexel/` which is `.gitignore`d, so a fresh CI runner will not have the marker. Three options for future work: (1) push tags from a maintainer machine only; (2) extend the hook to recognize a CI-signed token alongside the bless marker; (3) move the review pass entirely into CI workflow so the bless step happens server-side after `npm test`. v0.8.3 explicitly defers."
- **ADR-0013 Decision** (`:56-67`): Hook allows tag DELETIONS; rejects symlink markers; rejects markers without parseable `commit=<40-hex>`; documents emergency bypasses
- **ADR-0013 Consequences** (`:80-85`): "Emergency bypass exists by design"; three documented escapes
- **ADR-0001 D1** (`:23-27`): ADR criteria
- **ADR-0008** — `.nexel/` canonical state-dirname
- **CLAUDE.md** — "Mandatory release-time review gate" rule
- **docs/release-workflow.md:43-67** — names ce-code-review + release:bless

## 9. Trade-off options (verbatim from ADR-0013 §"CI gap")

1. Push tags from maintainer machine only
2. Extend hook to recognize CI-signed token alongside marker
3. Move review pass entirely into CI workflow (server-side after npm test)

Original task seed also mentioned: GH Actions + marker push, server-side branch protection, encrypted/signed marker in repo, `--no-verify` as CI policy — only 1/2/3 in ADR.

## 10. Risks specific to this item

- **Cross-touch with deactivate verb (adv-009)**: both round-7 candidates; no shared marker today but `.nexel/` namespace shared
- **Marker-as-signing-material leak risk**: today marker contains only public SHA + timestamp; Option 2 would introduce secret. `release.yml:42-51` publishes `.tgz` + `.sha256`; `package.json:39-58` `files:` list does not include `.nexel/`
- **`--no-verify` bypass**: ADR-0013 documents three local bypasses; CI invocations of `git push` from workflow with `contents: write` naturally bypass any local hook because hooks don't exist in `actions/checkout@v5` workspace. Branch-protection on tag refs not currently configured
- **Annotated-tag SHA peeling regression class**: `.husky/pre-push.test.mjs:152-173` documents "round-4 bootstrap bug" where `local_sha` for annotated tags is tag object SHA not commit SHA. CI re-validation must replicate `git rev-parse <sha>^{commit}` peel
- **`verify-release-tag` has no marker contract**: runs in `release.yml:31` but currently no `.nexel/` view; extension requires un-ignoring or separate transport
- **v0.8.5 dogfood evidence**: gate has shipped 3 consecutive releases (v0.8.3/v0.8.4/v0.8.5) clean through local hook. Any CI bless path must not regress this dogfood baseline
