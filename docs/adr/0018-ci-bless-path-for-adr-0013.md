# ADR-0018: CI bless path for ADR-0013 review gate

- Status: Accepted (v0.9.0)
- Date: 2026-05-29
- Related: ADR-0001 (frozen invariants), ADR-0008 (.nexel/ state-dirname), ADR-0013 (mandatory pre-tag review gate)
- Implementation: PR #8 · `scripts/verify-release-tag.mjs` · `.github/workflows/release.yml` · `docs/release-workflow.md`

## Context

ADR-0013 enforces the mandatory pre-tag review gate via a local
`pre-push` husky hook that reads a session-local marker at
`.nexel/release-blessed-<tag>`. ADR-0013 §"CI gap" explicitly defers
the question of how the gate is enforced in CI / fresh-clone, where
`.nexel/` is gitignored (ADR-0008) and therefore absent. Three
candidate solutions were listed:

1. push tags from a maintainer machine only
2. extend the hook to recognize a CI-signed token alongside the marker
3. move the review pass entirely into the CI workflow

v0.8.3 / v0.8.4 / v0.8.5 shipped three releases through the local hook
without addressing the gap; v0.9.0 closes it.

## Decision

Hybrid Option 1 + Option 3:

1. **Maintainer-machine path preserved unchanged.** Local
   `release:bless` writes `.nexel/release-blessed-<tag>` with `commit=<sha>`;
   `.husky/pre-push` verifies the SHA against the tag's `^{commit}`.
   Documented escape hatches (`--no-verify`, `HUSKY=0`,
   `core.hooksPath=/dev/null`) preserved per ADR-0013 Consequences.

2. **Server-side `review-gate` job added to `.github/workflows/release.yml`.**
   Runs before the existing `release` job, blocking it via
   `needs: review-gate` + `if: needs.review-gate.outputs.blessed == 'true'`.
   The gate re-runs deterministic checks (`npm test`,
   `release:preflight`, `lint:release-sync`) and emits
   `outputs.blessed: true` on green. The `release` job runs with
   `env: NEXEL_CI_BLESSED: "true"`.

3. **`verify-release-tag.mjs` accepts either signal.** Marker present →
   verify `commit=<sha>` matches `HEAD^{commit}`. Marker absent +
   `GITHUB_ACTIONS=true` + `NEXEL_CI_BLESSED=true` → pass. Otherwise
   fail closed.

4. **Defense-in-depth scan** of commit messages between previous tag
   and current tag for `--no-verify` / `HUSKY=0` /
   `core.hooksPath=/dev/null` strings. Phase 4 P1 hardening:
   anchored regex (`\b(\-\-no-verify|HUSKY=0|core\.hooksPath=/dev/null)\b`,
   no `-i`) to avoid false-positives on legitimate docs commits;
   full ref-history traversal when no prior tag exists (replaces
   `HEAD~20..HEAD` bounded fallback).

## Rejected alternatives

- **Option 2 (CI-signed token alongside the marker)**. Rejected:
  introduces a rotatable signing key as a new secret surface. The
  current marker contains only a public commit SHA + ISO timestamp
  (no secret), and `package.json` `files:` deliberately does not
  include `.nexel/`. Adding a key would require rotation policy,
  CI secret storage, and re-architecture of the marker writer —
  out of proportion to the gain.

- **Branch protection on tag refs as the sole defense**. Rejected:
  the actual bypass threat is an attacker with main-push access
  mutating `.github/workflows/release.yml` (removing
  `needs: review-gate`) and then pushing a tag from that commit.
  Tag-ref protection alone does not block this. The correct
  mitigations (CODEOWNERS on `.github/workflows/**`, required PR
  review on `main`) live in GitHub repo settings, not code, and
  are documented as deferred ADR-0018 follow-up in
  `docs/release-workflow.md`.

## Consequences

- **CI gate is materially weaker than the local
  `ce-code-review` mandate**, by design. The server-side job re-runs
  deterministic checks only — no LLM-driven review. ADR-0013's
  "mandatory ce-code-review" claim is preserved on the maintainer-
  machine path; the CI path is the audit-friendly fallback.

- `NEXEL_CI_BLESSED` env name joins the API surface and is hard to
  reverse.

- The commit-message scan is **defense-in-depth against
  self-incrimination only**. A silent `git push --no-verify` from a
  workstation leaves no string in commit history and is not caught
  by the scan. The marker-SHA binding remains the primary
  enforcement.

- Marker file format (`tag=` / `commit=` / `blessed_at=`) unchanged
  from ADR-0013. `.gitignore` boundary unchanged (ADR-0008
  preserved).

- Documented `--no-verify` / `HUSKY=0` escape hatches still work.
  CI runs of `git push` from a workflow with `contents: write`
  inherently lack a local hook — the new server-side gate provides
  the equivalent enforcement layer.

## Implementation references

- `scripts/verify-release-tag.mjs` — gate logic
- `.github/workflows/release.yml` — `review-gate` job
- `docs/release-workflow.md` — CI flow + mitigation framing
- Plan: `docs/plans/2026-05-29-ci-bless-path-plan.md`
- Research: `docs/research/2026-05-29-ci-bless-path-preflight.md`
