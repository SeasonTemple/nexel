import fs from "node:fs";

import { ERR_TOCTOU_RACE_DETECTED } from "./errors.mjs";

// Cross-platform TOCTOU defense for the lstat->lockSync window.
//
// Three production sites lstat a path before mutating it under a write lock:
//   1. ambient-fence.mjs target-symlink refusal (adv-004 / v0.8.3)
//   2. ambient-fence.mjs lock-path-symlink refusal (adv-r5-C / v0.8.5)
//   3. filesystem.mjs `assertNoSymlinkOnPath` walk before `promoteStagedFiles`
//
// All three lstat -> mutate windows can be raced by an attacker who plants a
// symlink between the lstat call and the subsequent mutation. v0.8.x narrowed
// each window with a pre-lock lstat; this module closes it by snapshotting
// the pre-lock lstat result and re-verifying after the lock is acquired.
//
// Cross-platform rationale (ADR-0019): post-lock re-lstat + inode/dev pinning
// uses only POSIX-ish lstat fields that are present on Linux, macOS, and
// Windows via node:fs. NTFS file-index is exposed through `Stats.ino` and is
// stable enough for swap detection within a lock window. No `O_NOFOLLOW`,
// no `process.platform` branch, no `proper-lockfile` replacement, no
// state-schema extension — see plan
// `docs/plans/2026-05-29-toctou-defense-plan.md` for the trade-off matrix.
//
// `verifyPostLockIntegrity` is a kernel internal — it is NOT exported from
// `installer/index.mjs` (LOCK 6 / Stop-if #5 in the plan).

/**
 * Capture a pre-lock lstat snapshot for later post-lock comparison.
 *
 * Returns `null` when the path does not exist. The null sentinel must be
 * passed unchanged to `verifyPostLockIntegrity`; it carries the
 * "did-not-exist-pre-lock" fact across the lock-acquisition window.
 *
 * @param {string} targetPath Absolute path to snapshot.
 * @returns {fs.Stats|null}
 */
export function snapshotPreLockStats(targetPath) {
  // Phase 4 P3 fix: single lstat with ENOENT handling eliminates the tiny
  // own TOCTOU between existsSync and lstatSync (file could disappear).
  try {
    return fs.lstatSync(targetPath);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Post-lock TOCTOU verification.
 *
 * Must be called after a write-lock has been acquired (e.g., `lockSync` or
 * `acquireLock` returned). Re-lstats `targetPath` and compares the post-lock
 * stat against the pre-lock snapshot. Throws (with `code =
 * ERR_TOCTOU_RACE_DETECTED`) when any of these race signals are detected:
 *
 *  - path became a symlink during the lock-acquisition window
 *  - inode changed (file swapped via unlink+create)
 *  - device changed (rare; covers mount-swap edge case)
 *  - file disappeared when the pre-lock snapshot saw it
 *
 * When `preLockStats` is `null` (path did not exist pre-lock) the post-lock
 * state is allowed to be either "still missing" (normal new-file install) or
 * "newly created" non-symlink — the latter case is acceptable because the
 * lockfile's own `mkdir`-based atomicity covers create-races against a
 * non-existent target; see plan section "Step 5" for the staging-promote
 * rationale.
 *
 * Phase 4 P1 fix: callers verifying `proper-lockfile`'s `<target>.lock`
 * directory must pass `lockPathMode: true`. proper-lockfile's stale-lock
 * recovery does `rmdir` + `mkdir` on the lock path, producing a NEW inode
 * — pinning ino/dev there would surface as a spurious
 * `ERR_TOCTOU_RACE_DETECTED` every time a user recovers from a crashed
 * prior `nexel activate`. In lockPathMode only the symlink-ness check
 * runs (the actual race signal); ino/dev pinning is delegated to
 * proper-lockfile's own lifecycle.
 *
 * @param {Object} opts
 * @param {string} opts.targetPath        Absolute path to verify.
 * @param {fs.Stats|null} opts.preLockStats Snapshot returned by `snapshotPreLockStats`.
 * @param {string} opts.label             Caller label for error messages.
 * @param {boolean} [opts.lockPathMode]   When true, skip ino/dev pinning;
 *                                        only check symlink-ness. Use when
 *                                        verifying a path whose lifecycle
 *                                        proper-lockfile owns.
 */
export function verifyPostLockIntegrity({ targetPath, preLockStats, label, lockPathMode = false }) {
  const postExists = fs.existsSync(targetPath);
  if (!postExists) {
    if (preLockStats === null) return;
    const err = new Error(
      `${label}: file disappeared during lock acquisition at ${targetPath}; aborting (TOCTOU defense)`,
    );
    err.code = ERR_TOCTOU_RACE_DETECTED;
    throw err;
  }
  const postLockStats = fs.lstatSync(targetPath);
  if (postLockStats.isSymbolicLink()) {
    const err = new Error(
      `${label}: target became a symlink during lock acquisition at ${targetPath}; aborting (TOCTOU defense)`,
    );
    err.code = ERR_TOCTOU_RACE_DETECTED;
    throw err;
  }
  // Phase 4 P1: skip ino/dev pinning in lockPathMode — proper-lockfile's
  // stale recovery (rmdir+mkdir) would false-positive here.
  if (lockPathMode || preLockStats === null) {
    return;
  }
  if (postLockStats.ino !== preLockStats.ino) {
    const err = new Error(
      `${label}: inode changed during lock acquisition at ${targetPath} ` +
        `(${preLockStats.ino} -> ${postLockStats.ino}); aborting (TOCTOU defense)`,
    );
    err.code = ERR_TOCTOU_RACE_DETECTED;
    throw err;
  }
  if (postLockStats.dev !== preLockStats.dev) {
    const err = new Error(
      `${label}: device changed during lock acquisition at ${targetPath}; aborting (TOCTOU defense)`,
    );
    err.code = ERR_TOCTOU_RACE_DETECTED;
    throw err;
  }
}
