# ADR-0019: TOCTOU lstat/lockSync cross-platform defense

- Status: Accepted (v0.9.0)
- Date: 2026-05-29
- Related: ADR-0001 (frozen invariants), ADR-0006 (kernel-generic boundary, portability), ADR-0008 (state dirname), ADR-0014 (--json envelope), ADR-0017 (deactivate)
- Implementation: PR #11 · `scripts/installer/core/symlink-safe.mjs` · `scripts/installer/core/ambient-fence.mjs` · `scripts/installer/core/filesystem.mjs`

## Context

v0.8.3 (adv-004) and v0.8.5 (adv-r5-C) closed the **at-rest**
symlink-attack windows by `lstat`-ing target and lock-paths before
mutation. The **race** window between the lstat and the mutation
itself (TOCTOU) was explicitly deferred — v0.8.5 release notes flag
"O_NOFOLLOW is Linux-only; cross-platform strategy needed".

Three production sites have the lstat→mutation TOCTOU class:

1. `ambient-fence.mjs:143` — write target symlink refusal vs
   `writeFileSync` (~50 lines window)
2. `ambient-fence.mjs:163` — write lock-path symlink refusal vs
   `lockSync` (~22 lines window, v0.8.5 patched at-rest)
3. `filesystem.mjs:126` — `assertNoSymlinkOnPath` per-segment walk
   vs `renameSync` in `promoteStagedFiles`

`scripts/installer/core/` contains no `process.platform` branches in
the lock/fs path. Cross-platform mitigation here would set the
precedent for the first such branch — concerning per ADR-0006
portability spirit.

## Decision

**Accept the lstat→lockSync window and close it via post-lock
re-lstat + inode/dev pinning.** Uniform cross-platform mitigation; no
platform branch; no state-schema change; no `proper-lockfile`
replacement.

1. New kernel-internal module `core/symlink-safe.mjs` exports
   `snapshotPreLockStats(path)` and
   `verifyPostLockIntegrity({targetPath, preLockStats, label, lockPathMode?})`.
   **Not** exported from `installer/index.mjs` — internal helper, not
   stability surface.

2. `snapshotPreLockStats` does a single `lstatSync` with ENOENT-as-null
   semantics. Phase 4 P3 fix: replaces an `existsSync + lstatSync`
   pair that was itself a tiny TOCTOU.

3. `verifyPostLockIntegrity` checks:
   - file disappeared (when pre-lock was present) → throw
   - became a symlink → throw
   - inode changed (file swapped via unlink+create) → throw
   - device changed (mount swap edge case) → throw

4. **lockPathMode flag (Phase 4 P1 fix)**: callers verifying
   `proper-lockfile`'s `<target>.lock` directory must pass
   `lockPathMode: true`. proper-lockfile's stale-recovery does
   `rmdir` + `mkdir` on the lock path, producing a new inode —
   pinning ino/dev there would surface as spurious
   `ERR_TOCTOU_RACE_DETECTED` every time a user recovers from a
   crashed prior `nexel activate`. In lockPathMode, only the
   symlink-ness check runs.

5. `promoteStagedFiles` walks **parent segments** post-lock (Phase 4
   P1 fix). The initial implementation only re-verified `dst`; an
   attacker could swap a parent directory with a symlink between
   the parent walk and `renameSync`. The fix re-walks
   `assertNoSymlinkOnPath(path.dirname(dst))` immediately before
   `renameSync`.

6. New error code `ERR_TOCTOU_RACE_DETECTED` joins the error code
   surface. Surfaced through ADR-0014 `--json` envelope.

## Rejected alternatives

| Approach | Linux | macOS | Windows | Pure JS | Verdict |
|---|---|---|---|---|---|
| `fs.openSync + O_NOFOLLOW + O_CREAT + O_EXCL` | ✓ | ✓ | ✗ | ✓ via `fs.constants.O_NOFOLLOW` | **Rejected** — introduces first `process.platform` branch in `core/` (per memo §5 precedent concern + ADR-0006 portability spirit) |
| `fstatat(AT_SYMLINK_NOFOLLOW)` after-the-fact verify | ✓ | ✓ | ✗ | N-API addon required | **Rejected** — addon dependency |
| Windows ACL deny-symlink + privilege | ✗ | ✗ | ✓ | ✗ | **Rejected** — addon, Windows-only |
| `proper-lockfile`'s `realpath: true` | ✓ | ✓ | ✓ | ✓ | **Rejected** — silent acceptance via `realpath` resolution, not defense |
| Move lock into `<stateDir>` | ✓ | ✓ | ✓ | ✓ | **Rejected** — breaks `doctor:951` hardcoded `".lock"` literal; changes ambient-fence lock-path contract |
| **Accept window + post-lock re-lstat + ino/dev pinning** | ✓ | ✓ | ✓ | ✓ | **WINNER** — uniform; zero platform branching; zero state-schema change |

Tie-breaker per Goal Stop-if #8: only the winner row scores
cross-platform 3/3 AND zero state-field cost (LOCK 4 preserved).

## Consequences

- `core/symlink-safe.mjs` becomes a kernel internal — NOT exported
  from `installer/index.mjs`. Stop-if #5 in `docs/plans/2026-05-29-toctou-defense-plan.md`.

- `proper-lockfile` retained as the lock primitive.

- No `<lock>.meta` field added — ADR-0008 unfreeze budget **not
  consumed**.

- **FAT32 / exFAT degradation acknowledged.** On filesystems that
  return `Stats.ino === 0` for every file (e.g., a FAT32-mounted
  `~/.claude/CLAUDE.md`), the inode check silently disables
  (preLock.ino === postLock.ino === 0). The symlink-ness check
  still fires, so the worst-case is reverting to the pre-ADR-0019
  defense baseline on those filesystems — no regression.

- Three sites patched in PR #11. The fourth site —
  `removeAmbientFence` introduced by PR #12 (ADR-0017) — inherits
  the same TOCTOU class and is patched in the v0.9.0
  release-cleanup commit (Phase 6 of
  `docs/goals/2026-05-29-backlog-clear.md`) using the same helper.

- Windows CI matrix expansion deferred (out of scope per goal
  doc Scope-OUT; theoretical Windows path verified via inode
  semantics, not actual CI runs).

## Implementation references

- `scripts/installer/core/symlink-safe.mjs` — helper module
- `scripts/installer/core/ambient-fence.mjs:147-151, 215-225` —
  write target + lock-path verify (lockPathMode: true)
- `scripts/installer/core/filesystem.mjs:303-333` —
  `promoteStagedFiles` snapshot + parent-walk
- `scripts/installer/core/errors.mjs` — `ERR_TOCTOU_RACE_DETECTED`
- Plan: `docs/plans/2026-05-29-toctou-defense-plan.md`
- Research: `docs/research/2026-05-29-toctou-defense-preflight.md`
