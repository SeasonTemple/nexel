---
date: 2026-05-29
item: ci-bless-path
adr: 0018
pr: 8
research: docs/research/2026-05-29-ci-bless-path-preflight.md
interlock: docs/plans/INTERLOCK.md
merge_order: 2
---

# Plan: CI bless path for ADR-0013 (ADR-0018)

## Decision summary

ADR-0013 enforces review gate via local `pre-push` hook reading session-local marker at `.nexel/release-blessed-<tag>` (gitignored). This PR adds CI-accessible enforcement path without breaking gitignore boundary or introducing secrets.

**Selected**: hybrid Option 1 (maintainer-machine) + Option 3 (server-side review-gate job in `release.yml`).

## Trade-off resolution

| Axis | Options (ADR-0013 §CI gap) | Winner | Cite |
|---|---|---|---|
| Enforcement transport | 1. maintainer only / 2. CI-signed token / 3. server-side gate | **1+3 hybrid** | ADR-0013:86-92 |
| Marker secret | Reject Option 2 | **no secret** | memo §10 |
| Branch protection | server-side | **DEFERRED** | gh repo settings, not code |

## Implementation

1. **`scripts/verify-release-tag.mjs`** — add CI bless gate after existing checks:
   - Marker present → verify `commit=<sha>` matches `HEAD^{commit}`
   - Marker absent + `GITHUB_ACTIONS=true` + `NEXEL_CI_BLESSED=true` → pass
   - Else → fail-closed
2. **`.github/workflows/release.yml`** — add `review-gate` job before `release`:
   - Re-runs deterministic checks (`npm test`, `release:preflight`, `lint:release-sync`)
   - Scans commit messages for `--no-verify` / `HUSKY=0` / `core.hooksPath=/dev/null` (advisory; defense-in-depth)
   - Sets `outputs.blessed: true` on green
   - `release` job: `needs: review-gate`, `if: needs.review-gate.outputs.blessed == 'true'`, `env: NEXEL_CI_BLESSED: "true"`
3. **`.husky/pre-push`** — doc comment referencing ADR-0018 (no behavior change)
4. **`docs/release-workflow.md`** — new "CI release flow" section

## Phase 4 P1 fixes

- **Scan robustness**: anchor regex (`grep -E '\\-\\-no-verify\\b|HUSKY=0\\b|core\\.hooksPath=/dev/null\\b'`); drop `-i` to reduce false-positive in docs commits
- **Fallback bound**: replace `HEAD~20..HEAD` with full ref-history traversal (`git rev-list --root` style)
- **Docs framing**: rewrite "branch protection on tag refs" → recommend CODEOWNERS on `.github/workflows/**` + required PR review on main (the actual mitigation for workflow-file-mutation bypass)

## Test plan

- Extend `scripts/verify-release-tag.test.mjs`: 6 ADR-0018 cases
- New `.github/workflows/release.yml.test.mjs`: YAML smoke test asserting `review-gate` job exists + `needs:` dep
- `.husky/pre-push.test.mjs` unchanged behavior — must still pass

## ADR-0018 outline

1. Context — ADR-0013 §CI gap deferred; v0.8.x shipped 3 releases through local hook only; CI runner has no `.nexel/` after fresh checkout (gitignore)
2. Decision — hybrid 1+3; CI re-runs deterministic checks (NOT full ce-code-review — explicit semantic gap); sets `NEXEL_CI_BLESSED=true`; verify-release-tag accepts either marker or CI env
3. Rejected — Option 2 (CI-signed token: adds key-management); branch protection alone (not code)
4. Consequences — CI gate materially weaker than local ce-code-review mandate (acknowledged); `NEXEL_CI_BLESSED` joins API surface; workflow-file mutation bypass exists (mitigated via CODEOWNERS recommendation)
5. Status — Accepted v0.9.0

## Stop-if (PR-specific)

- Signing key / rotatable secret added → stop (Option 2 rejected)
- Marker file format change → stop
- `.gitignore` change un-ignoring `.nexel/release-blessed-*` → stop (ADR-0008)
- Local pre-push hook removal → stop (maintainer path regression)
- Ambient-fence markers touched → stop (LOCK 1)
