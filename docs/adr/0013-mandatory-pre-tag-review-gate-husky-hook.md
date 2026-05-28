---
status: accepted
date: 2026-05-29
---

# Mandatory pre-tag review gate enforced via husky pre-push hook + SHA-bound bless marker

## Context

Three consecutive `nexel` releases shipped without prior code review:

- **v0.7.0** — 16 review findings; round-1 fixup commit `c97ba1a`
- **v0.8.0** — 7 P1 findings including two live-verified exploits
  (writeAmbientFence symlink follow-through, unsafe productName injection);
  round-1 fixup commit `4bb979e`
- **v0.8.1** — closed 7 findings but introduced 2 new P1s of its own
  (sentinel substring bypass, locale-dependent sort breaching the
  byte-stable contract); round-2 fixup commit `a71e78e`

Each fixup landed AFTER `git push` had already published the unreviewed
release. The pattern repeated despite escalating intervention attempts:

1. Agent memory entry `feedback_review_before_push.md` written after v0.8.0
   → **violated immediately** on v0.8.1
2. `CLAUDE.md` "Mandatory release-time review gate" rule added in v0.8.2
   → **still ignored** when the next release was prepared until
   challenged by the operator
3. `docs/release-workflow.md` step 4 added in v0.8.2 → same outcome —
   prose rules are skippable

The shared failure mode: every intervention was **declarative** (a rule the
operator/agent should follow) rather than **enforced** (a check git
itself refuses to bypass without an explicit override).

The v0.8.3 round-2 pre-commit review (the first to actually run before a
commit) confirmed empirically that a file-existence-only marker check was
trivially bypassable (`touch .nexel/release-blessed-vX.Y.Z` defeats the
gate, marker is not bound to a commit SHA so amend/force-push slip past).

## Decision

Add a husky pre-push hook (`.husky/pre-push`) that refuses to push a tag
matching `refs/tags/v*` unless a SHA-bound bless marker exists at
`.nexel/release-blessed-<tag>` and contains a `commit=<sha>` line whose
value matches the local SHA being pushed for that tag.

The marker is created by `npm run release:bless -- vX.Y.Z`, which:

1. Refuses if the tag does not exist locally (must be created before bless)
2. Captures the commit SHA the tag points at via
   `git rev-parse <tag>^{commit}`
3. Writes `tag=<X>\ncommit=<sha>\nblessed_at=<iso>` to the marker file

The hook additionally:

- Allows tag DELETIONS (`local_sha = 0000…`) — nothing to review on a
  delete
- Rejects markers that are symlinks (`[ -L "$marker" ]`) — defends against
  `ln -s /etc/hosts marker` spoofs that would pass a bare `-f` test
- Rejects markers without a parseable `commit=<40-hex>` line as untrusted
- Documents emergency bypasses (`--no-verify`, `HUSKY=0`,
  `core.hooksPath=/dev/null`) in its error output so legitimate emergency
  releases have a known escape hatch that is auditable in shell history

The marker directory `.nexel/` is already gitignored, so markers are
session-local. CI runners and fresh clones perform their own bless step
or push with `--no-verify` — accepted trade-off (see Consequences).

## Consequences

- **Mechanical enforcement of the release-time review gate.** A future
  `release: cut vX.Y.Z` push without a corresponding ce-code-review pass
  + bless will be refused by git's own pre-push hook, not just by a
  reminder the agent may skim past. The trade-off is one additional
  step per release (`npm run release:bless -- vX.Y.Z`).
- **SHA binding closes the amend/force-push hole.** A bless captured
  against commit A is invalidated the moment the tag is moved to commit
  B. The push that would have shipped the amended-without-review tag
  fails with an actionable diff between marker SHA and local SHA.
- **Emergency bypass exists by design.** Three documented escape hatches
  (`--no-verify`, `HUSKY=0`, `git -c core.hooksPath=/dev/null`) are
  preserved because (a) shell history makes them auditable, (b) hard
  unavoidable enforcement would block legitimate hotfix paths.
  Discipline against habitual `--no-verify` lives in the post-mortem
  review for each release, not in the hook itself.
- **CI gap.** The marker lives in `.nexel/` which is `.gitignore`d, so a
  fresh CI runner will not have the marker. Three options for future
  work, none required here: (1) push tags from a maintainer machine
  only; (2) extend the hook to recognize a CI-signed token alongside the
  bless marker; (3) move the review pass entirely into CI workflow so
  the bless step happens server-side after `npm test`. v0.8.3 explicitly
  defers this design to a follow-up release.
- **Bypass surface is not zero.** An agent or human could still `touch
  .nexel/release-blessed-<tag>` with arbitrary content, but the SHA
  binding plus the `commit=<sha>` line requirement makes a meaningful
  bypass require non-trivial spoofing (writing a fake SHA that matches
  the pushed local_sha — which means the bypasser already knows the
  exact SHA, which is the SHA of the un-reviewed commit they're trying
  to push, which means they could just run release:bless against that
  tag and self-bless). The gate is not a security boundary against a
  hostile maintainer — it is a forcing function against agent
  forgetfulness, which is what the 3-release failure pattern empirically
  proved was needed.

## References

- `.husky/pre-push` — the hook this ADR introduces
- `scripts/release-bless.mjs` — the bless script
- `CLAUDE.md` — "Mandatory release-time review gate" (declarative rule
  added in v0.8.2)
- `docs/release-workflow.md` — step 4 references the gate; step 5 now
  references the bless command
- `docs/release-notes/v0.8.3.md` — release notes containing the rationale
  summary
- `docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md` D1 —
  the criteria this decision satisfies (hard-to-reverse + surprising +
  real trade-off)
