---
date: 2026-05-29
item: toctou-defense
adr: 0019
pr: 11
research: docs/research/2026-05-29-toctou-defense-preflight.md
interlock: docs/plans/INTERLOCK.md
merge_order: 4
---

# Plan: TOCTOU lstat/lockSync cross-platform defense (ADR-0019)

## Decision summary

Close 3 lstat→mutation TOCTOU windows uniformly via post-lock re-lstat + inode pinning (memo §8 row 5). Cross-platform, no platform branching, no state-schema change, no `proper-lockfile` replacement. **Phase 4 P1 fix**: on `lockPath` specifically use symlink-only verify (proper-lockfile rmdir+mkdir stale-recovery would false-positive ino comparison).

## Trade-off resolution

| Approach | Linux | macOS | Windows | Pure JS | Verdict |
|---|---|---|---|---|---|
| O_NOFOLLOW + open-then-lock | ✓ | ✓ | ✗ | ✓ | Rejected — splits kernel by platform (memo §5) |
| fstatat(AT_SYMLINK_NOFOLLOW) | ✓ | ✓ | ✗ | ✗ | Rejected — N-API |
| Windows ACL + privilege | ✗ | ✗ | ✓ | ✗ | Rejected — addon |
| **Accept window + post-lock re-lstat/inode** | ✓ | ✓ | ✓ | ✓ | **WINNER** |
| proper-lockfile realpath:true | ✓ | ✓ | ✓ | ✓ | Rejected — silent acceptance |

Tie-breaker: cross-platform (3/3) + no new state field. LOCK 4.

## Implementation

1. **`core/symlink-safe.mjs`** (new) — `snapshotPreLockStats(path)` + `verifyPostLockIntegrity({targetPath, preLockStats, label, lockPathMode})`
2. **`ambient-fence.mjs:142-149`** (write target) — pre-lock snapshot + post-lock verify (full ino+dev+symlink)
3. **`ambient-fence.mjs:161-185`** (write lock-path) — pre-lock snapshot + post-lock verify with **`lockPathMode: true`** (symlink-only check, NOT ino — proper-lockfile manages this path's lifecycle)
4. **`filesystem.mjs` `assertNoSymlinkOnPath` + `promoteStagedFiles:308`** — capture parent-segment snapshots pre-lock; post-lock re-walk parents AND re-verify dst
5. **`errors.mjs`** — `ERR_TOCTOU_RACE_DETECTED`

**Phase 4 P1 fixes**:
- `verifyPostLockIntegrity` accepts `lockPathMode: boolean` flag; when true, only verifies symlink-ness (skips ino/dev pinning)
- `promoteStagedFiles` walks each parent segment with snapshot+verify, not just dst
- `snapshotPreLockStats` uses single `try { lstatSync } catch ENOENT { return null }` (eliminates own TOCTOU between existsSync and lstatSync)

**Critical scope**: PR 4 patches **3 EXISTING sites only**. PR 3 (deactivate) introduces `removeAmbientFence` with same TOCTOU class; patched in Phase 6 release cleanup.

## Test plan

- New `core/symlink-safe.test.mjs`: 9 cases (snapshot null/value, verify pass/throw on symlink/ino/dev change, lockPathMode bypasses ino check, null-preLock+still-missing OK)
- Extend `ambient-fence.test.mjs`: 4 TOCTOU cases (target swap, lock-path swap with stale-recovery accepted, ino swap, regression witness)
- New `core/filesystem.test.mjs`: 2 cases (staging-promote TOCTOU on dst, TOCTOU on parent segment)
- **Phase 4 P2 test**: stale-lock-recovery test on lockPath (proper-lockfile rmdir+mkdir → must NOT throw ERR_TOCTOU_RACE_DETECTED)

## ADR-0019 outline

1. Context — 3 lstat→mutation TOCTOU windows; v0.8.5 closed lock-path symlink-at-rest; race defense deferred
2. Decision — accept window + post-lock re-lstat + ino/dev pinning (EXCEPT lockPath: symlink-only); uniform cross-platform; no platform branch; no state-schema change
3. Rejected — O_NOFOLLOW (platform split); ACL (Windows addon); proper-lockfile replace (vendor swap unjustified); realpath:true (silent acceptance)
4. Consequences — `core/symlink-safe.mjs` joins kernel internal surface; `verifyPostLockIntegrity` NOT exported from `index.mjs`; `ERR_TOCTOU_RACE_DETECTED` joins error code surface; `proper-lockfile` retained; FAT32/exFAT degradation acknowledged (ino=0 → ino check silently disables; symlink check still fires)
5. Status — Accepted v0.9.0

## Stop-if (PR-specific)

- `process.platform` branch added to `core/filesystem.mjs` or `core/ambient-fence.mjs` → stop (memo §5)
- New field added to `<lock>.meta` → stop (LOCK 4)
- `proper-lockfile` replaced → stop
- Lock path location changed → stop (doctor:951 literal)
- `verifyPostLockIntegrity` exported from `index.mjs` → stop (internal only)
- `realpath: true` on proper-lockfile → stop
- `removeAmbientFence` patched in this PR → stop (PR 3 territory)
- LockPath ino pinned → stop (Phase 4 P1: stale-recovery false-positive)
