# Release workflow

This repository publishes GitHub Releases from tags. Do not create release
assets manually from a local checkout except as an emergency repair.

## Normal path

1. Prepare the next version and release-note stub:

   ```sh
   npm run release:prepare -- patch
   ```

   Use `minor` or `major` when the release scope warrants it. The helper updates
   `package.json` / `package-lock.json`, creates
   `docs/release-notes/vX.Y.Z.md` if missing, and prints the remaining manual
   commands. It does not commit, tag, or push.

2. Write `docs/release-notes/vX.Y.Z.md` with both required language sections:

   ```md
   ## English

   ...

   ## 中文

   ...
   ```

3. Validate locally:

   ```sh
   npm test
   npm run release:preflight
   node scripts/verify-release-tag.mjs vX.Y.Z
   npm run package:smoke
   ```

4. **Mandatory pre-tag code review** (per CLAUDE.md "Mandatory release-time
   review gate"). Run `compound-engineering:ce-code-review` against the diff
   from the previous tag. Fix or document every P1 finding in the release
   notes before proceeding. This step exists because three releases
   (v0.7.0, v0.8.0, v0.8.1) shipped without prior review and each required
   a round-1 fixup commit, including two live-verified exploits. `npm test`
   green is necessary but not sufficient — it catches regressions of
   asserted behavior, not un-asserted-yet contract claims (idempotency
   locale drift, sentinel substring bypass, etc.).

5. Push `main`, then push the tag:

   ```sh
   git add package.json package-lock.json docs/release-notes/vX.Y.Z.md
   git commit -m "release: vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   npm run release:bless -- vX.Y.Z   # required after step 4's review pass
   git push origin main
   git push origin vX.Y.Z
   ```

   The bless step (`npm run release:bless -- vX.Y.Z`) creates a
   SHA-bound marker at `.nexel/release-blessed-vX.Y.Z`. The husky
   pre-push hook (`.husky/pre-push`) refuses any tag push without a
   matching marker — this is the mechanical enforcement of step 4.
   Amending the commit or force-retagging after bless invalidates the
   marker (SHA mismatch); re-bless after fixing. Emergency bypass for
   broken-reviewer-chain hotfixes: `git push --no-verify origin
   vX.Y.Z` (audit any use of this in release retrospective). See
   ADR-0013 for the full design.

6. GitHub Actions creates the release and uploads:

   ```text
   nexel-X.Y.Z.tgz
   nexel-X.Y.Z.tgz.sha256
   ```

## CI release flow (ADR-0018)

The local `pre-push` hook and the bless marker at
`.nexel/release-blessed-<tag>` are the **maintainer-machine transport**
for the ADR-0013 review gate. A fresh CI runner does not have either:
git does not invoke `.husky/` hooks during workflow steps, and `.nexel/`
is gitignored (ADR-0008) so the marker cannot reach the runner via
`actions/checkout`.

The CI transport is the `review-gate` job in
`.github/workflows/release.yml`. When a `v*.*.*` tag is pushed:

1. `review-gate` re-runs the deterministic portions of the release-time
   review (`npm test`, `npm run release:preflight`,
   `npm run lint:release-sync`) and refuses to advance if any commit
   message in the tag range advertises a hook bypass
   (`--no-verify`, `HUSKY=0`, `core.hooksPath=/dev/null`).
2. On green, `review-gate` emits `blessed=true`. The `release` job gates
   on `needs.review-gate.outputs.blessed == 'true'` and sets
   `NEXEL_CI_BLESSED=true` on its env.
3. `scripts/verify-release-tag.mjs` accepts EITHER a SHA-bound marker
   (maintainer path: `commit=<sha>` line matches `git rev-parse HEAD^{commit}`)
   OR the `NEXEL_CI_BLESSED=true` env signal when `GITHUB_ACTIONS=true`.
   Absent both, it fails closed.

`NEXEL_CI_BLESSED` is a workflow-local env signal, not a secret — no
rotatable signing key is introduced (Option 2 from ADR-0013's CI gap
section is explicitly rejected). The marker file format
(`tag=` / `commit=` / `blessed_at=`) is unchanged from ADR-0013.

Branch protection on tag refs would be a complementary defense (it
prevents the CI workflow from being bypassed by a direct push that
disables the `review-gate` job dependency), but it lives in GitHub repo
settings, not in code. It is a deferred ADR-0018 follow-up.

## Guardrails

- `CI` runs on `main` and pull requests: `npm ci`, `npm test`, and
  `npm run release:preflight`, and `npm run package:smoke`.
- `Release` runs on `v*.*.*` tags. It verifies tag/package/release-note
  alignment and the bilingual release-note requirement, reruns tests and
  preflight, builds the tarball, and creates the GitHub Release with both
  assets.
- Release title is the tag by default. Human-friendly positioning belongs in
  the release note body. When a release includes installer UX changes, keep the
  visual demo link visible in the release note:
  `https://github.com/SeasonTemple/nexel/blob/main/assets/install-uninstall-flow.gif`.
- Commit messages must match `<type>(<scope>): <summary>` or `release:
  vX.Y.Z`. The `.gitmessage` file is installed as the local git commit
  template by `npm install`, and `.husky/commit-msg` enforces the format.
- Prefer signed release commits and tags so GitHub shows `Verified`
  provenance. Use `git commit -S` and `git tag -s` when your GitHub account has
  a registered GPG/SSH signing key. This is recommended, not hook-enforced,
  until every release-capable maintainer and automation path has signing
  configured.

## Emergency repair

If a release exists without assets, run:

```sh
npm run release:preflight
npm run dist
gh release upload vX.Y.Z nexel-X.Y.Z.tgz nexel-X.Y.Z.tgz.sha256
rm -f nexel-X.Y.Z.tgz nexel-X.Y.Z.tgz.sha256
```

Prefer fixing the workflow before publishing the next tag.

## Local setup checks

`npm install` configures the local commit template. To check or repair it:

```sh
git config --get commit.template
git config commit.template .gitmessage
```

To inspect local commit/tag signing state and GitHub `Verified` readiness:

```sh
git log --show-signature --oneline -12
git tag -v vX.Y.Z
git config --get commit.gpgsign
git config --get tag.gpgsign
git config --get gpg.format
git config --get user.signingkey
```

## Repository settings

GitHub Actions needs permission to create releases and upload assets with the
default `GITHUB_TOKEN`.

Check once in GitHub:

1. Repository `Settings` -> `Actions` -> `General`.
2. `Workflow permissions` should allow read and write permissions, or at least
   allow the workflow's `contents: write` permission to create releases.
3. Keep `Allow GitHub Actions to create and approve pull requests` off unless a
   future workflow explicitly needs it.

No additional secret is required for the current release workflow.
