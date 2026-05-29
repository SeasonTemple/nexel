import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

import { loadManifest, defaultManifestPath, defaultPaths } from "../../core/manifest/loader.mjs";
import { validateManifest } from "../../core/manifest/validator.mjs";
import { buildInstallPlan, resolveSelection, transitiveAssets, formatPlanText, PlanError } from "../../core/plan.mjs";
import { stageAsset, hashTransformed } from "../../core/stage-asset.mjs";
import {
  emptyState,
  applyInstall,
  applyUninstall,
  validateState,
  StateError,
} from "../../core/state.mjs";
import {
  acquireLock,
  readState,
  writeStateAtomic,
  snapshotStateBak,
  recoverySweep,
  makeStagingDir,
  promoteStagedFiles,
  deleteFiles,
  hashFile,
  stateDirFor,
  STATE_FILE,
  STATE_BAK,
  FsError,
} from "../../core/filesystem.mjs";
import { getAdapter, listAdapterStatus, assertSupportsDirect, assertCliPresent, ADAPTERS } from "../../adapters/index.mjs";
import {
  ERR_ARGS,
  ERR_UNKNOWN,
  ERR_MANIFEST_MISSING,
  ERR_MANIFEST_INVALID,
  ERR_INVALID_PROFILE,
  ERR_NO_TARGET,
  ERR_NO_SELECTION,
  ERR_NO_STATE,
  ERR_NOT_INSTALLED,
  ERR_SCHEMA,
  ERR_STATE_INVALID,
} from "../../core/errors.mjs";

export class CommandError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.details = details;
  }
}

// State health helpers — applied at every command path that reads state.json
// to convert structural problems and stale selection ids into actionable
// CommandError messages rather than downstream stack traces.
//
// `assertValidExistingState`: structural check via state.mjs `validateState`.
// Throws CommandError(ERR_STATE_INVALID) listing all findings in details.
//
// `assertStateSelectionsKnown`: cross-check `state.installations[].selectionId`
// against the manifest's known skills + bundles. Accumulates every unknown
// id (not short-circuit) so the operator sees the full cleanup list in one
// pass. Throws CommandError(ERR_NOT_INSTALLED) — reuses the existing not-
// installed error code to keep JSON envelope contracts stable.
//
// `import` is intentionally NOT bound to these checks because it seeds state
// from an external envelope into an (often empty) target — pre-validating
// would block legitimate first-import flows.

export function assertValidExistingState(state) {
  const findings = validateState(state);
  if (findings.length > 0) {
    throw new CommandError(
      `existing state.json invalid: ${findings[0].path} — ${findings[0].message}`,
      ERR_STATE_INVALID,
      { findings }
    );
  }
}

// Pure helper — returns the list of selectionIds in state.installations
// that the current manifest no longer knows. Non-throwing so callers
// (doctor diagnostics) can fold the result into multi-check reports.
export function staleSelectionIds(state, manifest) {
  const unknown = [];
  for (const inst of state.installations) {
    const sid = inst.selectionId;
    if (!manifest.skills[sid] && !manifest.bundles[sid]) {
      unknown.push(sid);
    }
  }
  return unknown;
}

export function assertStateSelectionsKnown(state, manifest) {
  const unknownSelections = staleSelectionIds(state, manifest);
  if (unknownSelections.length > 0) {
    throw new CommandError(
      `state.json references selection(s) absent from current manifest: ${unknownSelections.join(", ")}. ` +
        `Remove retired selections from state.json before this command, or run a clean reinstall.`,
      ERR_NOT_INSTALLED,
      { unknownSelections }
    );
  }
}

function nowIso() {
  return new Date().toISOString();
}

export function getRepoCommit(repoRoot) {
  try {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    delete env.GIT_OBJECT_DIRECTORY;
    delete env.GIT_COMMON_DIR;
    return execSync("git rev-parse HEAD", { cwd: repoRoot, env, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || null;
  } catch {
    return null;
  }
}

function loadValidatedManifest(repoRoot, productConfig) {
  const manifestPath = defaultManifestPath(repoRoot, productConfig);
  if (!fs.existsSync(manifestPath)) {
    throw new CommandError(`manifest not found: ${manifestPath}`, ERR_MANIFEST_MISSING);
  }
  const manifest = loadManifest(manifestPath);
  const validateOpts = {
    ...defaultPaths(repoRoot, productConfig),
    skillIdPrefix: productConfig?.skillIdPrefix,
    agentNamePrefix: productConfig?.agentNamePrefix,
    productConfig,
  };
  const findings = validateManifest(manifest, validateOpts);
  if (findings.length > 0) {
    throw new CommandError(
      `manifest validation failed (${findings.length} issue(s)): ${findings[0].message}`,
      ERR_MANIFEST_INVALID,
      { findings }
    );
  }
  return manifest;
}

// Profile name pattern: letters/digits/underscore/dash, 1-32 chars.
// Reject path separators (anti-traversal) and shell special chars (anti-injection).
const PROFILE_RE = /^[A-Za-z0-9_-]{1,32}$/;

function resolveProfile({ profile, env, productConfig }) {
  const envVar = productConfig?.envProfile;
  const raw = profile || (envVar ? env[envVar] : null) || null;
  if (!raw) return null;
  if (!PROFILE_RE.test(raw)) {
    throw new CommandError(
      `invalid profile name: ${raw} (allowed: letters/digits/underscore/dash, 1-32 chars)`,
      ERR_INVALID_PROFILE
    );
  }
  return raw;
}

function resolveAdapterAndTarget({ adapterId, target, env, profile, productConfig }) {
  const adapter = adapterId ? getAdapter(adapterId) : null;
  let targetRoot;
  if (target) {
    targetRoot = path.resolve(target);
  } else if (adapter) {
    targetRoot = adapter.detectTargetRoot({ env });
  } else {
    throw new CommandError("either --agent or --target must be provided", ERR_NO_TARGET);
  }
  // Profile suffix: when --profile X is given, or productConfig.envProfile is
  // set and that env var is non-empty, append .X to targetRoot so each
  // profile gets a wholly isolated state + skill tree.
  // Skipped when --target was given explicitly (user already chose the dir).
  const profileName = resolveProfile({ profile, env, productConfig });
  if (profileName && !target) {
    targetRoot = `${targetRoot}.${profileName}`;
  }
  return { adapter, targetRoot, profile: profileName };
}

export async function planSelection({ repoRoot, adapterId, target, selectionIds, productConfig, env, currentState, manifest } = {}) {
  if (!Array.isArray(selectionIds) || selectionIds.length === 0) {
    throw new CommandError("at least one --skill or --bundle required", ERR_NO_SELECTION);
  }
  const m = manifest || loadValidatedManifest(repoRoot, productConfig);
  const { adapter, targetRoot } = resolveAdapterAndTarget({ adapterId, target, env, productConfig });
  if (adapter && !adapter.supportsDirect) assertSupportsDirect(adapter.id, { productConfig });

  const mapTargetPath = adapter ? (asset) => adapter.mapTargetPath(asset, m) : undefined;
  const state = currentState !== undefined ? currentState : readState(targetRoot);

  const plan = buildInstallPlan(m, selectionIds, {
    repoRoot,
    targetRoot,
    mapTargetPath,
    currentState: state,
    supportedAssetTypes: adapter?.supportedAssetTypes ?? null,
    adapter, // SPI v1.1: plan-side hash = transformed hash (cross-stage invariant)
  });
  return { plan, manifest: m, state, targetRoot, adapterId: adapter?.id || null };
}

export async function install({
  repoRoot,
  adapterId,
  target,
  selectionIds,
  selectionKindOverrides = {},
  installerVersion,
  installMode = "direct",
  dryRun = false,
  overwriteUnmanaged = false,
  requestedBy = "cli",
  allowNoCli = false,
  productConfig,
  env = process.env,
  now = nowIso(),
} = {}) {
  if (!installerVersion) throw new CommandError("installerVersion required", ERR_ARGS);
  const manifest = loadValidatedManifest(repoRoot, productConfig);
  const { adapter, targetRoot } = resolveAdapterAndTarget({ adapterId, target, env, productConfig });
  if (adapter) {
    assertSupportsDirect(adapter.id, { productConfig });
    if (!target && !allowNoCli) assertCliPresent(adapter.id, { env });
  }

  if (dryRun) {
    // Dry-run is read-only — do NOT recoverySweep (writes) or acquireLock (creates state dir).
    // This keeps `--dry-run` from leaving empty .nexel/ directories in user $HOME.
    const initialState = readState(targetRoot) || emptyState({
      installerVersion,
      agentId: adapter?.id || "custom",
      targetRoot,
      now,
    });
    const { plan } = await planSelection({ repoRoot, adapterId: adapter?.id, target: targetRoot, selectionIds, env, currentState: initialState, manifest });
    if (plan.conflicts.length > 0 && !overwriteUnmanaged) {
      return { ok: false, dryRun: true, plan, reason: "unmanaged-files-block", conflicts: plan.conflicts,
        message: `${plan.conflicts.length} unmanaged file(s) at target paths; pass --overwrite to replace` };
    }
    return { ok: true, dryRun: true, plan };
  }

  recoverySweep(targetRoot);

  const release = await acquireLock(targetRoot, { command: "install", installerVersion });
  try {
    const initialState = readState(targetRoot) || emptyState({
      installerVersion,
      agentId: adapter?.id || "custom",
      targetRoot,
      now,
    });
    assertValidExistingState(initialState);
    assertStateSelectionsKnown(initialState, manifest);

    if (!Array.isArray(selectionIds) || selectionIds.length === 0) {
      throw new CommandError("at least one --skill or --bundle required", ERR_NO_SELECTION);
    }
    // Skip selections already recorded in state. Re-installing the same
    // selectionId is a no-op (files unchanged); explicit refresh path is
    // `update` command, which re-hashes sources against state.
    const alreadyInstalled = selectionIds.filter((sid) =>
      initialState.installations.some((i) => i.selectionId === sid)
    );
    const remainingSelections = selectionIds.filter((sid) => !alreadyInstalled.includes(sid));
    if (remainingSelections.length === 0) {
      return {
        ok: true,
        dryRun: false,
        plan: { selectionIds: [...selectionIds], files: [], conflicts: [], skippedUnsupported: [], summary: { fileCount: 0, counts: { create: 0, skip: 0, "overwrite-managed": 0, "conflict-unmanaged": 0 }, totalBytes: 0 } },
        writtenCount: 0,
        skippedCount: 0,
        alreadyInstalled,
        message: `all ${selectionIds.length} selection(s) already installed. Use 'update' to refresh.`,
        state: initialState,
      };
    }
    selectionIds = remainingSelections;

    const { plan } = await planSelection({ repoRoot, adapterId: adapter?.id, target: targetRoot, selectionIds, env, currentState: initialState, manifest });

    if (plan.conflicts.length > 0 && !overwriteUnmanaged) {
      return {
        ok: false,
        dryRun,
        plan,
        reason: "unmanaged-files-block",
        conflicts: plan.conflicts,
        message: `${plan.conflicts.length} unmanaged file(s) at target paths; pass --overwrite to replace`,
      };
    }

    // dryRun handled by early short-circuit above; never reach here.

    const grouped = groupFilesBySelection(plan, manifest, selectionIds);
    const stagingRunId = `${process.pid}-${Date.now()}`;
    const stagingDir = makeStagingDir(targetRoot, stagingRunId);
    const filesToWrite = plan.files.filter((f) => f.action === "create" || f.action === "overwrite-managed" || f.action === "conflict-unmanaged");
    // Capture each stageAsset result so state records the hash of the bytes
    // ACTUALLY written (stage-side), not just the plan-side hash. For a pure
    // transform these are identical (ADR-0002 D2); if a downstream adapter's
    // transform were impure, recording the stage-side hash keeps state
    // self-consistent with disk (tamper-detection stays correct) instead of
    // perpetually false-flagging. Symmetric with update/repair, which
    // already record their staged hash.
    const stagedHashes = new Map();
    for (const f of filesToWrite) {
      // stageAsset re-runs the same adapter transform the plan hashed, so the
      // staged bytes match plan.files[].sha256 (cross-stage invariant, ADR-0002 D2).
      const res = stageAsset({
        asset: { assetType: f.assetType, id: f.ownerSelection, sourceRelPath: f.sourcePath, sourceAbs: f.sourceAbs },
        adapter,
        stagingDir,
        targetRel: f.targetRel,
      });
      stagedHashes.set(f.targetRel, res);
    }

    snapshotStateBak(targetRoot);

    const sourceCommit = getRepoCommit(repoRoot);
    let postState = initialState;
    for (const [selectionId, files] of grouped) {
      const kind = selectionKindOverrides[selectionId] || (selectionId in manifest.bundles ? "bundle" : "skill");
      postState = applyInstall(postState, {
        selectionId,
        selectionKind: kind,
        installMode,
        installerVersion,
        files: files.map((f) => {
          const staged = stagedHashes.get(f.targetRel);
          return {
          relPath: f.targetRel,
          sha256: staged ? staged.sha256 : f.sha256,
          algo: staged ? staged.algo : f.algo,
          normalization: staged ? staged.normalization : f.normalization,
          bytes: staged ? staged.bytes : f.bytes,
          mode: f.mode,
          sourceRelPath: f.sourcePath,
          sourceCommit,
          assetType: f.assetType,
          bundleMembership: kind === "bundle" ? [selectionId] : undefined,
          };
        }),
        now,
        requestedBy,
      });
    }

    const writeRels = filesToWrite.map((f) => f.targetRel);
    // Write state BEFORE promoting to disk (same discipline as uninstall's
    // writeStateAtomic→deleteFiles). A crash between these leaves state
    // ahead of disk → doctor/repair reports the files as *missing*
    // (accurate, re-repairable) instead of *tampered* (false-block) — the
    // same state↔disk consistency the repair re-hash fix establishes.
    await writeStateAtomic(targetRoot, postState);
    promoteStagedFiles(stagingDir, targetRoot, writeRels);

    try {
      const bak = path.join(stateDirFor(targetRoot), STATE_BAK);
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
    } catch {}

    // Collect any postInstallHint strings declared in the manifest for the
    // freshly-installed selections (declarative; no shell execution).
    const postInstallHints = [];
    for (const sid of selectionIds) {
      const entry = manifest.skills[sid] || manifest.bundles[sid];
      if (entry?.postInstallHint && typeof entry.postInstallHint === "string") {
        postInstallHints.push({ selectionId: sid, hint: entry.postInstallHint });
      }
    }

    return {
      ok: true,
      dryRun: false,
      plan,
      writtenCount: writeRels.length,
      skippedCount: plan.files.filter((f) => f.action === "skip").length,
      alreadyInstalled,
      postInstallHints,
      state: postState,
    };
  } finally {
    await release();
  }
}

export async function installMulti({
  repoRoot,
  adapterIds,
  selectionIds,
  installerVersion,
  installMode = "direct",
  dryRun = false,
  overwriteUnmanaged = false,
  allowNoCli = false,
  requestedBy = "cli",
  productConfig,
  env = process.env,
  now = nowIso(),
} = {}) {
  if (!Array.isArray(adapterIds) || adapterIds.length === 0) {
    throw new CommandError("adapterIds required (one or more)", ERR_ARGS);
  }
  const unique = [...new Set(adapterIds)];
  const results = [];
  let okCount = 0;
  let failCount = 0;
  for (const aid of unique) {
    try {
      const result = await install({
        repoRoot,
        adapterId: aid,
        selectionIds,
        installerVersion,
        installMode,
        dryRun,
        overwriteUnmanaged,
        allowNoCli,
        requestedBy,
        productConfig,
        env,
        now,
      });
      results.push({ adapterId: aid, ok: result.ok !== false, result });
      if (result.ok !== false) okCount++; else failCount++;
    } catch (e) {
      results.push({
        adapterId: aid,
        ok: false,
        error: { code: e.code || ERR_UNKNOWN, message: e.message },
      });
      failCount++;
    }
  }
  return { adapterIds: unique, okCount, failCount, results };
}

export async function updateMulti({
  repoRoot,
  adapterIds,
  installerVersion,
  force = false,
  acceptModified = [],
  dryRun = false,
  productConfig,
  env = process.env,
  now = nowIso(),
} = {}) {
  if (!Array.isArray(adapterIds) || adapterIds.length === 0) {
    throw new CommandError("adapterIds required (one or more)", ERR_ARGS);
  }
  const unique = [...new Set(adapterIds)];
  const results = [];
  let okCount = 0;
  let failCount = 0;
  for (const aid of unique) {
    try {
      const result = await update({
        repoRoot,
        adapterId: aid,
        installerVersion,
        force,
        acceptModified,
        dryRun,
        productConfig,
        env,
        now,
      });
      results.push({ adapterId: aid, ok: result.ok !== false, result });
      if (result.ok !== false) okCount++; else failCount++;
    } catch (e) {
      results.push({
        adapterId: aid,
        ok: false,
        error: { code: e.code || ERR_UNKNOWN, message: e.message },
      });
      failCount++;
    }
  }
  return { adapterIds: unique, okCount, failCount, results };
}

export async function uninstallMulti({
  repoRoot,
  adapterIds,
  selectionIds,
  installerVersion,
  force = false,
  acceptModified = [],
  dryRun = false,
  productConfig,
  env = process.env,
  now = nowIso(),
} = {}) {
  if (!Array.isArray(adapterIds) || adapterIds.length === 0) {
    throw new CommandError("adapterIds required (one or more)", ERR_ARGS);
  }
  const unique = [...new Set(adapterIds)];
  const results = [];
  let okCount = 0;
  let failCount = 0;
  for (const aid of unique) {
    try {
      const result = await uninstall({
        repoRoot,
        adapterId: aid,
        selectionIds,
        installerVersion,
        force,
        acceptModified,
        dryRun,
        productConfig,
        env,
        now,
      });
      results.push({ adapterId: aid, ok: result.ok !== false, result });
      if (result.ok !== false) okCount++; else failCount++;
    } catch (e) {
      results.push({
        adapterId: aid,
        ok: false,
        error: { code: e.code || ERR_UNKNOWN, message: e.message },
      });
      failCount++;
    }
  }
  return { adapterIds: unique, okCount, failCount, results };
}

function groupFilesBySelection(plan, manifest, selectionIds) {
  const map = new Map();
  for (const sid of selectionIds) map.set(sid, []);
  for (const f of plan.files) {
    if (f.action === "skip") continue;
    const owner = selectionIds.includes(f.ownerSelection) ? f.ownerSelection : selectionIds[0];
    if (!map.has(owner)) map.set(owner, []);
    map.get(owner).push(f);
  }
  return map;
}

export async function uninstall({
  repoRoot,
  adapterId,
  target,
  selectionIds,
  force = false,
  acceptModified = [],
  dryRun = false,
  installerVersion,
  productConfig,
  env = process.env,
  now = nowIso(),
} = {}) {
  if (!installerVersion) throw new CommandError("installerVersion required", ERR_ARGS);
  if (!Array.isArray(selectionIds) || selectionIds.length === 0) {
    throw new CommandError("at least one --skill or --bundle required", ERR_NO_SELECTION);
  }
  const { adapter, targetRoot } = resolveAdapterAndTarget({ adapterId, target, env, productConfig });

  // Pre-check state.json existence BEFORE recoverySweep/acquireLock to avoid creating
  // empty .nexel/ dir in $HOME when uninstall is called on a clean target.
  if (!readState(targetRoot)) {
    throw new CommandError("no state.json at target; nothing to uninstall", ERR_NO_STATE);
  }

  recoverySweep(targetRoot);

  const release = await acquireLock(targetRoot, { command: "uninstall", installerVersion });
  try {
    const state = readState(targetRoot);
    if (!state) {
      throw new CommandError("no state.json at target; nothing to uninstall", ERR_NO_STATE);
    }
    assertValidExistingState(state);
    // Note: uninstall is a recovery path — does not bind assertStateSelectionsKnown.
    // If state holds entries for selections retired from the manifest, the user
    // should still be able to uninstall them; refusing would deadlock recovery.
    let postState = state;
    const allDeletes = [];
    // Accumulate blockers across all selections instead of stopping at the first.
    // Selections that block do not get applied (postState stays as it was before that selection);
    // selections that succeed get applied. At the end, if any selection blocked, we abort the
    // filesystem writes and report every blocker so the user can fix them all in one round-trip.
    const blockedSelections = [];

    for (const selectionId of selectionIds) {
      if (!postState.installations.some((i) => i.selectionId === selectionId)) {
        throw new CommandError(`selection not installed: ${selectionId}`, ERR_NOT_INSTALLED);
      }
      const filesToCheck = postState.managedFiles.filter((f) => f.referencedBy.includes(selectionId));
      const onDiskHashes = {};
      for (const mf of filesToCheck) {
        const abs = path.resolve(targetRoot, mf.relPath);
        if (fs.existsSync(abs)) {
          onDiskHashes[mf.relPath] = hashFile(abs).sha256;
        }
      }
      const result = applyUninstall(postState, { selectionId, onDiskHashes, force, acceptModified, now });
      if (result.blocked) {
        blockedSelections.push({
          selectionId,
          blockedByModification: result.blockedByModification,
          blockedByMissingHash: result.blockedByMissingHash,
        });
        // Do NOT advance postState — this selection is held back. Continue to next selection.
        continue;
      }
      postState = result.state;
      allDeletes.push(...result.toDelete);
    }

    if (blockedSelections.length > 0) {
      // Aggregate fields for back-compat with existing CLI / interactive callers that
      // read result.blockedByModification / result.blockedByMissingHash flat.
      const flatMods = blockedSelections.flatMap((b) => b.blockedByModification);
      const flatMissing = blockedSelections.flatMap((b) => b.blockedByMissingHash);
      return {
        ok: false,
        dryRun,
        reason: "modification-blocks",
        // selectionId field preserved for single-selection callers; null when multi
        selectionId: blockedSelections.length === 1 ? blockedSelections[0].selectionId : null,
        blockedSelections,
        blockedByModification: flatMods,
        blockedByMissingHash: flatMissing,
      };
    }

    if (dryRun) {
      return { ok: true, dryRun: true, toDelete: allDeletes, postState };
    }

    snapshotStateBak(targetRoot);
    await writeStateAtomic(targetRoot, postState);
    deleteFiles(targetRoot, allDeletes);

    try {
      const bak = path.join(stateDirFor(targetRoot), STATE_BAK);
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
    } catch {}

    return {
      ok: true,
      dryRun: false,
      toDelete: allDeletes,
      state: postState,
    };
  } finally {
    await release();
  }
}

export async function update({
  repoRoot,
  adapterId,
  target,
  force = false,
  acceptModified = [],
  dryRun = false,
  installerVersion,
  productConfig,
  env = process.env,
  now = nowIso(),
} = {}) {
  if (!installerVersion) throw new CommandError("installerVersion required", ERR_ARGS);
  const { adapter, targetRoot } = resolveAdapterAndTarget({ adapterId, target, env, productConfig });
  if (adapter && !target) assertCliPresent(adapter.id, { env });

  // Pre-check state.json existence BEFORE recoverySweep/acquireLock so a "no install" target
  // does not get an empty .nexel/ dir written into $HOME.
  if (!readState(targetRoot)) {
    throw new CommandError("no state.json at target; nothing to update", ERR_NO_STATE);
  }

  recoverySweep(targetRoot);

  const release = await acquireLock(targetRoot, { command: "update", installerVersion });
  try {
    const state = readState(targetRoot);
    if (!state) throw new CommandError("no state.json at target; nothing to update", ERR_NO_STATE);
    assertValidExistingState(state);
    // Note: update is a recovery / refresh path — does not bind assertStateSelectionsKnown.

    const acceptSet = new Set(acceptModified);
    const candidates = [];
    const tampered = [];
    const sourceMissing = [];

    for (const mf of state.managedFiles) {
      const sourceAbs = path.resolve(repoRoot, mf.sourceRelPath);
      if (!fs.existsSync(sourceAbs)) {
        sourceMissing.push(mf.relPath);
        continue;
      }
      // Transformed hash (identity when no adapter transform) so drift
      // detection compares against the same bytes stageAsset will write.
      const newHash = hashTransformed({
        asset: { assetType: mf.assetType, id: mf.relPath, sourceRelPath: mf.sourceRelPath, sourceAbs },
        adapter,
        stage: "plan",
      });
      if (newHash.sha256 === mf.sha256) continue;

      const targetAbs = path.resolve(targetRoot, mf.relPath);
      const targetHash = fs.existsSync(targetAbs) ? hashFile(targetAbs).sha256 : null;
      if (targetHash !== mf.sha256) {
        if (force && acceptSet.has(mf.relPath)) {
          candidates.push({ mf, newHash, sourceAbs, tampered: true });
        } else {
          tampered.push({ relPath: mf.relPath, recorded: mf.sha256, onDisk: targetHash });
        }
      } else {
        candidates.push({ mf, newHash, sourceAbs, tampered: false });
      }
    }

    if (tampered.length > 0) {
      return {
        ok: false,
        reason: "modification-blocks",
        blockedByModification: tampered,
        message: `${tampered.length} target file(s) modified locally. Pass --force --accept-modified <relPath> per file to overwrite.`,
      };
    }

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        candidates: candidates.map((c) => ({
          relPath: c.mf.relPath,
          oldSha: c.mf.sha256,
          newSha: c.newHash.sha256,
          tamperedOverridden: c.tampered,
        })),
        sourceMissing,
        upToDateCount: state.managedFiles.length - candidates.length - sourceMissing.length,
      };
    }

    if (candidates.length === 0) {
      return { ok: true, dryRun: false, updatedCount: 0, sourceMissing, message: "all managed files already up to date" };
    }

    const stagingRunId = `${process.pid}-${Date.now()}`;
    const stagingDir = makeStagingDir(targetRoot, stagingRunId);
    for (const c of candidates) {
      stageAsset({
        asset: { assetType: c.mf.assetType, id: c.mf.relPath, sourceRelPath: c.mf.sourceRelPath, sourceAbs: c.sourceAbs },
        adapter,
        stagingDir,
        targetRel: c.mf.relPath,
      });
    }

    snapshotStateBak(targetRoot);

    const sourceCommit = getRepoCommit(repoRoot);
    const updatedRels = candidates.map((c) => c.mf.relPath);
    const candidateMap = new Map(candidates.map((c) => [c.mf.relPath, c]));
    const nextState = {
      ...state,
      updatedAt: now,
      managedFiles: state.managedFiles.map((mf) => {
        const c = candidateMap.get(mf.relPath);
        if (!c) return mf;
        return {
          ...mf,
          sha256: c.newHash.sha256,
          algo: c.newHash.algo,
          normalization: c.newHash.normalization,
          bytes: c.newHash.bytes,
          installedAt: now,
          sourceCommit,
        };
      }),
    };

    // Write state before promote (crash → state-ahead-of-disk is the
    // recoverable failure mode; see install for rationale).
    await writeStateAtomic(targetRoot, nextState);
    promoteStagedFiles(stagingDir, targetRoot, updatedRels);

    try {
      const bak = path.join(stateDirFor(targetRoot), STATE_BAK);
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
    } catch {}

    return {
      ok: true,
      dryRun: false,
      updatedCount: updatedRels.length,
      updated: updatedRels,
      sourceMissing,
      sourceCommit,
    };
  } finally {
    await release();
  }
}

export function listCommand({ repoRoot, adapterId, target, productConfig, env = process.env } = {}) {
  const manifest = loadValidatedManifest(repoRoot, productConfig);
  let installed = null;
  let targetRoot = null;
  if (adapterId || target) {
    const resolved = resolveAdapterAndTarget({ adapterId, target, env, productConfig });
    targetRoot = resolved.targetRoot;
    installed = readState(targetRoot);
  }
  const installedSet = new Set(installed ? installed.installations.map((i) => i.selectionId) : []);
  const skills = Object.values(manifest.skills).map((s) => ({
    id: s.id,
    category: s.category,
    profile: s.profile,
    description: s.description,
    installable: s.profile !== "repo-only",
    installed: installedSet.has(s.id),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const bundles = Object.values(manifest.bundles).map((b) => ({
    id: b.id,
    description: b.description,
    skills: b.skills?.length || 0,
    agents: b.agents?.length || 0,
    rules: b.rules?.length || 0,
    installed: installedSet.has(b.id),
  }));
  return { skills, bundles, targetRoot, hasState: !!installed };
}

// Apply NETOPS_PROFILE suffix to each adapter's targetRoot. Validates the
// profile name; throws ERR_INVALID_PROFILE on bad input.
function applyProfileToAdapters(adapters, env) {
  const profile = resolveProfile({ env });
  if (!profile) return adapters;
  return adapters.map((a) => {
    const fs_ = fs; // capture for closure
    const newRoot = `${a.targetRoot}.${profile}`;
    const exists = fs_.existsSync(newRoot);
    let writable = a.writable;
    if (exists) {
      try { fs_.accessSync(newRoot, fs_.constants.W_OK); writable = true; } catch { writable = false; }
    }
    return { ...a, targetRoot: newRoot, exists, writable };
  });
}

export function agentsCommand({ repoRoot, env = process.env } = {}) {
  const adapters = applyProfileToAdapters(listAdapterStatus({ env }), env);
  return { adapters };
}

/**
 * Health-check the local installer environment for each direct-mode agent.
 * Returns a structured report; the CLI formats it as text or JSON.
 *
 * Checks per agent:
 *  - CLI binary on PATH
 *  - target root exists / writable / would-be-created
 *  - state.json present and parses
 *  - state.json schema validates
 *  - lock file age (stale lock detection)
 *  - per-managed-file existence + hash match (sampled — limit cost)
 */
export function doctorCommand({ repoRoot, adapterId, target, productConfig, env = process.env, getAdapterFn = getAdapter } = {}) {
  const adapters = applyProfileToAdapters(listAdapterStatus({ env }), env);
  const filtered = (adapterId
    ? adapters.filter((a) => a.id === adapterId)
    : adapters.filter((a) => a.supportsDirect))
    .map((a) => {
      if (!target) return a;
      const targetRoot = path.resolve(target);
      const exists = fs.existsSync(targetRoot);
      let writable = false;
      if (exists) {
        try {
          fs.accessSync(targetRoot, fs.constants.W_OK);
          writable = true;
        } catch {
          writable = false;
        }
      }
      return { ...a, targetRoot, exists, writable };
    });

  const reports = [];
  for (const a of filtered) {
    const report = {
      adapterId: a.id,
      displayName: a.displayName,
      targetRoot: a.targetRoot,
      checks: [],
      ok: true,
    };
    const add = (name, ok, detail) => {
      report.checks.push({ name, ok, detail });
      if (!ok) report.ok = false;
    };

    add("cli-present", a.cliPresent, a.cliPresent
      ? `${a.cliBinary} at ${a.cliPath}`
      : `${a.cliBinary} NOT in PATH; install: ${a.cliInstallUrl}`);
    add("target-exists", a.exists, a.exists ? a.targetRoot : `${a.targetRoot} absent (would be created on first install)`);
    add("target-writable", a.writable, a.writable ? "writable" : "NOT writable");

    let state = null;
    let stateParseError = null;
    try {
      state = readState(a.targetRoot);
    } catch (e) {
      stateParseError = e.message || String(e);
    }
    if (stateParseError) {
      add("state-readable", false, `state.json parse error: ${stateParseError}`);
    } else if (state === null) {
      add("state-readable", true, "no state.json (no managed installations yet)");
    } else {
      add("state-readable", true, `${state.installations.length} installation(s), ${state.managedFiles.length} managed file(s)`);
      const findings = validateState(state);
      if (findings.length > 0) {
        add("state-schema", false, `${findings.length} schema issue(s); first: ${findings[0].path} — ${findings[0].message}`);
      } else {
        add("state-schema", true, "valid");
      }

      // Stale-selection diagnostic — try loading manifest; if unavailable, skip
      // gracefully so doctor still reports on adapters with missing/bad manifest.
      try {
        const m = loadValidatedManifest(repoRoot, productConfig);
        const unknown = staleSelectionIds(state, m);
        if (unknown.length > 0) {
          add("state-selections-known", false,
            `${unknown.length} state selectionId(s) absent from manifest: ${unknown.join(", ")}; clean reinstall or remove retired entries`);
        } else {
          add("state-selections-known", true, "all selections match manifest");
        }
      } catch (e) {
        if (e.code === ERR_MANIFEST_MISSING || e.code === ERR_MANIFEST_INVALID) {
          add("state-selections-known", true, "skipped (manifest unavailable)");
        } else {
          throw e;
        }
      }

      const lockPath = path.join(stateDirFor(a.targetRoot), ".lock");
      if (fs.existsSync(lockPath)) {
        try {
          const lockStat = fs.statSync(lockPath);
          const ageMs = Date.now() - lockStat.mtimeMs;
          const ageSec = Math.floor(ageMs / 1000);
          const stale = ageMs > 60_000;
          add("lock-state", !stale, stale
            ? `stale lock detected (age ${ageSec}s > 60s) — next command will sweep it`
            : `held lock (age ${ageSec}s)`);
        } catch {
          add("lock-state", true, "lock file present but stat failed (rare)");
        }
      } else {
        add("lock-state", true, "no lock held");
      }

      const missing = [];
      const tampered = [];
      const sample = state.managedFiles.slice(0, 50);
      for (const mf of sample) {
        const abs = path.resolve(a.targetRoot, mf.relPath);
        if (!fs.existsSync(abs)) {
          missing.push(mf.relPath);
          continue;
        }
        try {
          const onDisk = hashFile(abs);
          if (onDisk.sha256 !== mf.sha256) tampered.push(mf.relPath);
        } catch (e) {
          tampered.push(`${mf.relPath} (hash error: ${e.message})`);
        }
      }
      const sampledNote = state.managedFiles.length > sample.length
        ? ` (sampled first ${sample.length} of ${state.managedFiles.length})`
        : "";
      if (missing.length === 0 && tampered.length === 0) {
        add("managed-files", true, `all ${sample.length} sampled files present and unmodified${sampledNote}`);
      } else {
        const parts = [];
        if (missing.length) parts.push(`${missing.length} missing`);
        if (tampered.length) parts.push(`${tampered.length} modified`);
        add("managed-files", false, `${parts.join(", ")}${sampledNote}; run 'repair --agent ${a.id}' to reconcile`);
      }
    }

    // Adapter-contributed health probes (SPI `doctorProbes`). Each adapter
    // may return extra `{name, ok, detail}` checks the kernel can't know
    // about (e.g. host-CLI plugin-runtime config presence). Folds them in
    // alongside the built-in checks. Adapters that don't define probes fall
    // through to the SPI `() => []` default and add nothing. A throwing or
    // malformed probe is surfaced as a failed check rather than crashing the
    // whole doctor run.
    try {
      const probes = getAdapterFn(a.id).doctorProbes({ targetRoot: a.targetRoot, env, productConfig });
      if (!Array.isArray(probes)) {
        add("adapter-probes", false, `adapter ${a.id} doctorProbes did not return an array`);
      } else {
        for (const p of probes) {
          if (p && typeof p.name === "string") {
            add(p.name, !!p.ok, p.detail);
          } else {
            add("adapter-probes", false, `adapter ${a.id} returned a malformed probe entry`);
          }
        }
      }
    } catch (e) {
      add("adapter-probes", false, `adapter ${a.id} doctorProbes threw: ${e.message || String(e)}`);
    }

    reports.push(report);
  }
  const okCount = reports.filter((r) => r.ok).length;
  return { reports, okCount, failCount: reports.length - okCount };
}

/**
 * Reconcile state.json's managedFiles against what's actually on disk.
 *
 * Detects three drift types:
 *  - missing-on-disk: state references a file that no longer exists at the target
 *  - tampered: file exists but its hash doesn't match the recorded sha256
 *  - source-missing: state references a sourceRelPath in the repo that no longer exists
 *    (no fix possible from this side; user must restore the source or uninstall the selection)
 *
 * Default mode is read-only (`apply=false`) and just reports.
 * With `apply=true`:
 *  - missing-on-disk files are re-copied from `sourceRelPath` in the repo
 *  - tampered files are re-copied only if their relPath is in `acceptModified`
 *  - source-missing entries are surfaced; the user must resolve manually
 */
export async function repair({
  repoRoot,
  adapterId,
  target,
  apply = false,
  acceptModified = [],
  installerVersion,
  productConfig,
  env = process.env,
  now = nowIso(),
} = {}) {
  if (apply && !installerVersion) throw new CommandError("installerVersion required for apply", ERR_ARGS);
  const { adapter, targetRoot } = resolveAdapterAndTarget({ adapterId, target, env, productConfig });
  if (!readState(targetRoot)) {
    throw new CommandError("no state.json at target; nothing to repair", ERR_NO_STATE);
  }

  const acceptSet = new Set(acceptModified);

  // Read-only scan (no recoverySweep / no lock) when apply=false.
  if (!apply) {
    const state = readState(targetRoot);
    assertValidExistingState(state);
    return scanForDrift(state, targetRoot, repoRoot);
  }

  // Apply mode: acquire lock and rewrite files atomically.
  recoverySweep(targetRoot);
  const release = await acquireLock(targetRoot, { command: "repair", installerVersion });
  try {
    const state = readState(targetRoot);
    assertValidExistingState(state);
    // Note: repair is the canonical recovery path — does not bind assertStateSelectionsKnown.
    const drift = scanForDrift(state, targetRoot, repoRoot);

    const toRecopy = [];
    const skippedTampered = [];

    for (const item of drift.missing) {
      if (item.sourceExists) toRecopy.push(item);
    }
    for (const item of drift.tampered) {
      if (item.sourceExists && acceptSet.has(item.relPath)) {
        toRecopy.push(item);
      } else if (item.sourceExists) {
        skippedTampered.push(item.relPath);
      }
    }

    if (toRecopy.length === 0) {
      return {
        ok: true,
        applied: false,
        recopied: [],
        skippedTampered,
        sourceMissing: drift.sourceMissing.map((s) => s.relPath),
        message: skippedTampered.length > 0
          ? `${skippedTampered.length} tampered file(s) not repaired; pass --accept-modified <relPath> per file to overwrite`
          : "nothing to repair",
      };
    }

    const mfByRel = new Map(state.managedFiles.map((m) => [m.relPath, m]));
    const stagingRunId = `${process.pid}-${Date.now()}`;
    const stagingDir = makeStagingDir(targetRoot, stagingRunId);
    const recopyResults = new Map();
    for (const item of toRecopy) {
      const mf = mfByRel.get(item.relPath);
      const res = stageAsset({
        asset: { assetType: mf?.assetType, id: item.relPath, sourceRelPath: item.sourceRelPath, sourceAbs: item.sourceAbs },
        adapter,
        stagingDir,
        targetRel: item.relPath,
      });
      recopyResults.set(item.relPath, res);
    }

    snapshotStateBak(targetRoot);

    // Bug fix (ADR-0003): record the freshly-staged (transformed) hash so
    // state.json matches the bytes repair just wrote. The old behavior kept
    // the prior sha256, leaving state describing neither disk nor current
    // source — which made the NEXT `update` false-flag the just-repaired
    // file as tampered and block. repair restores to CURRENT source (it
    // always did); recording the hash makes state honest about that.
    const nextState = {
      ...state,
      managedFiles: state.managedFiles.map((mf) => {
        const r = recopyResults.get(mf.relPath);
        if (!r) return mf;
        return {
          ...mf,
          sha256: r.sha256,
          algo: r.algo,
          normalization: r.normalization,
          bytes: r.bytes,
        };
      }),
    };

    // Write state before promote (crash → state-ahead-of-disk is the
    // recoverable failure mode; see install for rationale). This closes the
    // crash-window that would otherwise re-introduce the false-tamper this
    // very re-hash fix exists to remove.
    await writeStateAtomic(targetRoot, nextState);
    promoteStagedFiles(stagingDir, targetRoot, toRecopy.map((i) => i.relPath));

    try {
      const bak = path.join(stateDirFor(targetRoot), STATE_BAK);
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
    } catch {}

    return {
      ok: true,
      applied: true,
      recopied: toRecopy.map((i) => i.relPath),
      skippedTampered,
      sourceMissing: drift.sourceMissing.map((s) => s.relPath),
    };
  } finally {
    await release();
  }
}

function scanForDrift(state, targetRoot, repoRoot) {
  const missing = [];
  const tampered = [];
  const sourceMissing = [];

  for (const mf of state.managedFiles) {
    const targetAbs = path.resolve(targetRoot, mf.relPath);
    const sourceAbs = path.resolve(repoRoot, mf.sourceRelPath || "");
    const sourceExists = !!mf.sourceRelPath && fs.existsSync(sourceAbs);
    const targetExists = fs.existsSync(targetAbs);

    if (!targetExists) {
      missing.push({ relPath: mf.relPath, sourceRelPath: mf.sourceRelPath, sourceAbs, sourceExists });
      if (!sourceExists) sourceMissing.push({ relPath: mf.relPath, sourceRelPath: mf.sourceRelPath });
      continue;
    }
    try {
      const onDisk = hashFile(targetAbs);
      if (onDisk.sha256 !== mf.sha256) {
        tampered.push({ relPath: mf.relPath, sourceRelPath: mf.sourceRelPath, sourceAbs, sourceExists, recorded: mf.sha256, onDisk: onDisk.sha256 });
        if (!sourceExists) sourceMissing.push({ relPath: mf.relPath, sourceRelPath: mf.sourceRelPath });
      }
    } catch (e) {
      tampered.push({ relPath: mf.relPath, sourceRelPath: mf.sourceRelPath, sourceAbs, sourceExists, hashError: e.message });
    }
  }

  return {
    ok: missing.length === 0 && tampered.length === 0,
    targetRoot,
    missing,
    tampered,
    sourceMissing,
    summary: {
      managedFileCount: state.managedFiles.length,
      missingCount: missing.length,
      tamperedCount: tampered.length,
      sourceMissingCount: sourceMissing.length,
    },
  };
}

/**
 * Export the installed-selections list for a target so it can be re-applied
 * elsewhere. Returns a portable JSON envelope:
 *   { schemaVersion: 1, agentId, exportedAt, selections: [{id, kind}, ...] }
 *
 * Designed to be paired with importCommand: pipe export | import to clone an
 * install set across machines. Does NOT export managed-file content — only
 * selection ids. Re-applying runs `install` against the manifest, so the
 * target machine gets whatever the current repo manifest says, not a frozen
 * copy from the source machine.
 */
export function exportCommand({ repoRoot, adapterId, target, productConfig, env = process.env, now = nowIso() } = {}) {
  const { adapter, targetRoot } = resolveAdapterAndTarget({ adapterId, target, env, productConfig });
  const state = readState(targetRoot);
  if (!state) {
    throw new CommandError("no state.json at target; nothing to export", ERR_NO_STATE);
  }
  assertValidExistingState(state);
  // Export emits selectionIds for re-application elsewhere — must not export
  // selections that the target side will reject. Surface stale entries early.
  const manifest = loadValidatedManifest(repoRoot, productConfig);
  assertStateSelectionsKnown(state, manifest);
  return {
    schemaVersion: 1,
    agentId: adapter?.id || "custom",
    targetRoot,
    exportedAt: now,
    installerVersion: state.installerVersion,
    selections: state.installations.map((i) => ({
      id: i.selectionId,
      kind: i.selectionKind,
    })),
  };
}

/**
 * Apply an exported envelope to the current target. Loops over each selection
 * and runs `install` with the same selectionId set, deduped. Skips selections
 * already installed (install() short-circuits those naturally).
 *
 * The envelope's `agentId` is informational only — the import uses the
 * caller's `adapterId` / `target`, so you can re-apply across agents.
 */
export async function importCommand({
  repoRoot,
  adapterId,
  target,
  envelope,
  installerVersion,
  dryRun = false,
  overwriteUnmanaged = false,
  allowNoCli = false,
  productConfig,
  env = process.env,
  now = nowIso(),
} = {}) {
  if (!envelope || typeof envelope !== "object") {
    throw new CommandError("envelope (parsed JSON) required", ERR_ARGS);
  }
  if (envelope.schemaVersion !== 1) {
    throw new CommandError(`unsupported envelope schemaVersion: ${envelope.schemaVersion}`, ERR_SCHEMA);
  }
  if (!Array.isArray(envelope.selections) || envelope.selections.length === 0) {
    throw new CommandError("envelope.selections must be a non-empty array", ERR_ARGS);
  }
  const selectionIds = [...new Set(envelope.selections.map((s) => s.id))];
  return await install({
    repoRoot,
    adapterId,
    target,
    selectionIds,
    installerVersion,
    dryRun,
    overwriteUnmanaged,
    allowNoCli,
    requestedBy: "cli",
    productConfig,
    env,
    now,
  });
}

export function planCommandText({ repoRoot, adapterId, target, selectionIds, productConfig, env = process.env } = {}) {
  return planSelection({ repoRoot, adapterId, target, selectionIds, productConfig, env }).then(({ plan, targetRoot }) => ({
    targetRoot,
    text: formatPlanText(plan),
    plan,
  }));
}
