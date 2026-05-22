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

4. Push `main`, then push the tag:

   ```sh
   git add package.json package-lock.json docs/release-notes/vX.Y.Z.md
   git commit -m "release: vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

5. GitHub Actions creates the release and uploads:

   ```text
   nexel-X.Y.Z.tgz
   nexel-X.Y.Z.tgz.sha256
   ```

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
