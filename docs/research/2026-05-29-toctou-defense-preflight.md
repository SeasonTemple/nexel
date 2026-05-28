# TOCTOU lstat/lockSync cross-platform defense — preflight memo

> 2026-05-29 · read-only research · ADR-0019 candidate · NO design proposals

Scope: factual surface-mapping for round-7 deferred backlog item "TOCTOU window between lstat and lockSync — `O_NOFOLLOW` is Linux-only; cross-platform strategy needed" (`docs/release-notes/v0.8.5.md:125,57`).

## 1. Lock implementation location

Two lock surfaces, different `proper-lockfile` entry points + different paths.

| Lock | File:line | Entry point | Lock path | Sync? |
|---|---|---|---|---|
| State-dir | `core/filesystem.mjs:143-170` (`acquireLock`) | `lockfile.lock(dir, ...)` | `<targetRoot>/.nexel/.lock` | async |
| Ambient-fence | `core/ambient-fence.mjs:183-203` (inline in `writeAmbientFence`) | `lockfile.lockSync(targetPath, ...)` | `<targetPath>.lock` | sync |

`node:fs` methods near lock acquisition:
- `filesystem.mjs:139` `fs.mkdirSync(dir, {recursive: true, mode: 0o700})`
- `filesystem.mjs:147` `lockfile.lock(dir, {stale, retries:{retries:0}, lockfilePath})`
- `filesystem.mjs:159` `fs.writeFileSync(path.join(dir, LOCK_FILE + ".meta"), ...)`
- `ambient-fence.mjs:142-149` `fs.existsSync(targetPath)` + `fs.lstatSync(targetPath)` (adv-004)
- `ambient-fence.mjs:154` `fs.mkdirSync(path.dirname(targetPath), {recursive: true})`
- `ambient-fence.mjs:161-169` `fs.existsSync(lockPath)` + `fs.lstatSync(lockPath)` (adv-r5-C v0.8.5)
- `ambient-fence.mjs:185` `lockfile.lockSync(targetPath, {realpath: false, stale: 10000})`

**No use of `fs.open` with explicit flags. No `O_NOFOLLOW`. No `node:fs.constants.O_*` references anywhere in `scripts/installer/`.**

## 2. v0.8.5 symlink-at-lock fix

From `v0.8.5.md:75` (English):

> **adv-r5-C symlink-at-lock DOS defense** — `writeAmbientFence` lstats `<target>.lock` before lockSync; symlink → refuse with actionable error. A planted symlink at the lock path defeats proper-lockfile's stale cleanup and permanently DOS's every subsequent activate. v0.8.3 closed symlink-at-target; v0.8.5 closes lock-path variant.

Commit: `745bf28`. Fix at `ambient-fence.mjs:161-169`.

**TOCTOU window**: between `:163` lstatSync and `:185` lockSync (~22 lines synchronous, no fs ops between except `mkdirSync` of parent at `:154` which runs **before** lock-path lstat). Attacker who wins race between lstat and proper-lockfile's `mkdir` can still plant symlink. Fix narrows window but does not close it on platforms lacking `O_NOFOLLOW`.

## 3. Current `lstat` call sites in `scripts/installer/`

Exactly three production-code sites:

| File:line | Purpose | TOCTOU-relevant |
|---|---|---|
| `core/ambient-fence.mjs:143` | Target-symlink (adv-004) before `writeFileSync` | Yes — vs writeFileSync at :211/249/264 |
| `core/ambient-fence.mjs:163` | Lock-path-symlink (adv-r5-C v0.8.5) before `lockSync` | Yes — vs lockSync at :185 (round-7 item) |
| `core/filesystem.mjs:126` | `assertNoSymlinkOnPath` per-segment walk during `promoteStagedFiles` | Yes — vs `fs.renameSync` at :310 |

`assertNoSymlinkOnPath` (`filesystem.mjs:119-131`) lstats every segment from root toward absPath; called from `promoteStagedFiles:308` immediately before `fs.renameSync(src, dst):310`.

No `lstat` outside `scripts/installer/`.

## 4. Current lock-file path computation

| Lock | File:line | Path | Identity in path? |
|---|---|---|---|
| State lock | `filesystem.mjs:33` (`LOCK_FILE = ".lock"`) + `:150` `path.join(dir, LOCK_FILE)` | `<targetRoot>/.nexel/.lock` | None |
| Ambient-fence | `ambient-fence.mjs:161` (`${targetPath}.lock`) | `<targetPath>.lock` | None — `productName` NOT in path |

`STATE_DIRNAME = ".nexel"` frozen by ADR-0008. `LOCK_FILE = ".lock"` not ADR-pinned but referenced from doctor `cli/commands/index.mjs:951` as literal `".lock"`.

## 5. Platform-specific code paths existing

`grep process.platform / darwin / linux / win32` in production:

- `core/which.mjs:4` — `platform = process.platform` default
- `core/which.mjs:9` — `platform === "win32"` PATHEXT shim
- `core/skill-metadata.mjs:18` — `path.posix.isAbsolute || path.win32.isAbsolute` (validation only)

Tests: `core/which.test.mjs:25,28` fixtures.

**Finding**: NO existing `process.platform` branch in lock/fs/state code path. Cross-platform TOCTOU mitigation would be **first** platform-conditional branch in `core/filesystem.mjs` or `core/ambient-fence.mjs`. Concerning for ADR-0006 portability spirit.

## 6. State writes during lock-held window

`writeStateAtomic` + `snapshotStateBak` call sites bracketed inside `acquireLock` ... `release()`:

| Verb | acquire | snapshotStateBak | writeStateAtomic | release() |
|---|---|---|---|---|
| install | `cli/commands/index.mjs:248` | 322 | 359 | 388 |
| uninstall | 574 | 639 | 640 | 655 |
| update | 683 | 762 | 787 | 804 |
| repair | 1046 | 1095 | 1122 | 1138 |

- `filesystem.mjs:188-197` `writeStateAtomic` uses `write-file-atomic` (vendored) with `{mode: 0o600, fsync: true}`
- `filesystem.mjs:199-213` `snapshotStateBak` via `copyFileSync` + fsync + `renameSync`

`writeStateAtomic` called only while state-dir lock held. Ambient-fence lock does NOT wrap state write — orthogonal surfaces.

Lock-file meta sidecar (`<lock>.meta`) written at `filesystem.mjs:159` inside `acquireLock` (after lock succeeds, before returning release fn). Failed writes swallowed.

## 7. Hard-to-reverse invariants

- **ADR-0008** — `STATE_DIRNAME = ".nexel"` frozen post-adoption; D3 declares on-disk state directory is stability surface again post-adoption. Adding new fields to lock-meta extends on-disk schema under it
- **ADR-0006** — kernel must remain product-agnostic; `productName`-keyed lock path would push identity into lock contract
- **ADR-0014** — `--json` failure envelope; new TOCTOU error code must follow `{ok:false, error:"<CODE>", message, details:{}}` shape
- **No ADR currently locks lock-file path format** — changing breaks recovery tools + doctor literal at `cli/commands/index.mjs:951`
- **No ADR currently locks `proper-lockfile`** — replacement is vendor swap, observable via lock directory artifact (proper-lockfile uses dir, not file)

## 8. Trade-off options (NOT decisions)

Cross-platform defense approaches, by platform applicability:

| Approach | Linux | macOS | Windows | Pure JS |
|---|---|---|---|---|
| `fs.openSync(path, O_NOFOLLOW \| O_CREAT \| O_EXCL)` then lock fd | ✓ | ✓ | ✗ (`O_NOFOLLOW` absent) | ✓ via `fs.constants.O_NOFOLLOW` |
| `fstatat(AT_SYMLINK_NOFOLLOW)` post-fd verify | ✓ | ✓ | ✗ | ✗ (N-API addon required) |
| Directory fd + `openat` | ✓ | ✓ | ✗ | ✗ |
| Windows ACL deny-symlink + privilege | ✗ | ✗ | ✓ (Windows 10+) | ✗ |
| **Accept-window + post-lock re-lstat on resolved path** | ✓ | ✓ | ✓ | ✓ |
| **Hash/inode pinning: capture `lstat.ino` pre-lock, re-lstat post-lock, abort on mismatch** | ✓ | ✓ | ≈ (NTFS file-index ≠ POSIX inode but stable) | ✓ |
| Move lock into `<stateDir>` (already non-symlink-walkable) | ✓ | ✓ | ✓ | ✓; changes ambient-fence lock-path contract; touches doctor literal |
| `proper-lockfile` `realpath: true` (currently false at :186) | ✓ | ✓ | ✓ | ✓; silent acceptance, not defense |

Vendor note: `proper-lockfile` creates `<path>.lock` as **directory** via `mkdir` (POSIX-atomic on parent dir); planted-symlink DOS exploits that lstat in v0.8.5 runs before `mkdir`, and `mkdir` of path where symlink exists succeeds-silently or fails-EEXIST depending on what symlink points at.

## 9. Existing lock tests

| File:line | Total tests | Lock/symlink-relevant |
|---|---|---|
| `core/ambient-fence.test.mjs` | 20 | 2 explicitly: `:378` "refuses to lock through a symlinked .lock path (adv-r5-C v0.8.5 DOS defense)"; `:409` "refuses to write through a symlinked target (adv-004 fixup)" |

**No tests exercise concurrent `acquireLock` contention or lstat→lockSync race.** No `acquireLock` test file exists. `marketplace-lockstep.test.mjs` is unrelated (marketplace versioning, not file locking).

## 10. Risks specific to this item

- **Windows has no clean `O_NOFOLLOW`** — Linux/macOS-only defense splits kernel by platform for first time
- **`node:fs` flag set differs per platform** — `fs.constants.O_NOFOLLOW` exists on Linux+macOS, undefined on Windows. Any flag-based fix needs guarded reads + runtime detection
- **Lock-holder verification likely needs new state field** — `<lock>.meta` carries `{pid, host, startedAt, command, installerVersion}`; integrity field would extend schema (spends ADR-0008 budget)
- **Two unrelated lock surfaces** — fixing ambient-fence (v0.8.5 patched site) doesn't fix state-dir lock at `filesystem.mjs:147`. Third TOCTOU at `assertNoSymlinkOnPath → renameSync` on staging-promote. Consistent fix likely touches all three
- **`proper-lockfile`'s `<path>.lock` directory creation is the actual atomic primitive** — any defense layered above must reason about proper-lockfile's `mkdir` semantics. Direct `flock(2)` or `LockFileEx` would replace vendor, not augment
- **doctor verb hardcodes `".lock"`** at `cli/commands/index.mjs:951`. Any lock-path rename needs doctor probe update in lockstep
- **No ADR currently pins lock semantics** — this item, if landed, will produce ADR-0019 covering: (a) TOCTOU class scope (3 sites), (b) platform-conditional precedent decision, (c) any state-schema extension, (d) `proper-lockfile` retention vs replacement
