# Release workflow

This repository publishes GitHub Releases from tags. Do not create release
assets manually from a local checkout except as an emergency repair.

## Normal path

1. Update `package.json` / `package-lock.json` with the next version:

   ```sh
   npm version patch -m "chore(release): %s"
   ```

   Use `minor` or `major` when the release scope warrants it.

2. Write `docs/release-notes/vX.Y.Z.md`.

3. Validate locally:

   ```sh
   npm test
   npm run release:preflight
   node scripts/verify-release-tag.mjs vX.Y.Z
   ```

4. Push `main`, then push the tag:

   ```sh
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
  `npm run release:preflight`.
- `Release` runs on `v*.*.*` tags. It verifies tag/package/release-note
  alignment, reruns tests and preflight, builds the tarball, and creates the
  GitHub Release with both assets.
- Release title is the tag by default. Human-friendly positioning belongs in
  the release note body.

## Emergency repair

If a release exists without assets, run:

```sh
npm run release:preflight
npm run dist
gh release upload vX.Y.Z nexel-X.Y.Z.tgz nexel-X.Y.Z.tgz.sha256
rm -f nexel-X.Y.Z.tgz nexel-X.Y.Z.tgz.sha256
```

Prefer fixing the workflow before publishing the next tag.

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
