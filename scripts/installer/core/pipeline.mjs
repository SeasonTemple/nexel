// Pipeline — explicit five-stage API for install / uninstall / update.
//
// Stages: plan -> validate -> stage -> commit -> persist.
//   - install / uninstall / update each have their own plan, validate,
//     and persist (verb-specific logic).
//   - stage and commit are shared across all three (just filesystem ops).
//
// Pipeline functions are PURE: no env reads, no console.log, no events bus.
// All inputs come from the caller; all outputs are returned as plain data.
// Locking and orchestration belong to the caller (today
// cli/commands.mjs; Unit 6 will split that into per-verb cli/commands/*.mjs
// files that directly invoke this pipeline).
//
// Error contract:
//   - Expected errors (conflicts, modification blocks, source missing,
//     not-installed): functions return `{ ok: false, reason, ... }` and let
//     the caller decide how to render. They DO NOT throw.
//   - Unexpected errors (fs failure, hash failure, staging promotion fail):
//     functions throw FsError / PlanError / StateError. Callers should
//     try/catch.

import fs from "node:fs";
import path from "node:path";

import { buildInstallPlan } from "./plan.mjs";
import {
  applyInstall,
  applyUninstall,
  validateState,
} from "./state.mjs";
import {
  makeStagingDir,
  stageWrite,
  promoteStagedFiles,
  deleteFiles,
  hashFile,
  snapshotStateBak,
  writeStateAtomic,
  stateDirFor,
  STATE_BAK,
} from "./filesystem.mjs";

// ---------- install ----------

/**
 * Compute an install plan from a selection. Pure: no IO beyond reading
 * source files for hashing (already performed by buildInstallPlan).
 *
 * @param {Object} args
 * @param {Object} args.manifest
 * @param {Object} args.adapterRegistry  Built via createAdapterRegistry().
 * @param {string} args.adapterId        id of the target adapter (may be null
 *                                       when --target was given without --agent)
 * @param {string[]} args.selectionIds   skill / bundle ids to install
 * @param {string} args.targetRoot       resolved target root path
 * @param {Object|null} args.currentState Existing state.json or null
 * @param {Object} [args.options]
 * @param {Object} [args.productConfig]  Reserved for Unit 8 wiring; ignored today
 * @returns {InstallPlan} Same shape as plan.mjs:buildInstallPlan output.
 */
function installPlanStage({ manifest, adapterRegistry, adapterId, selectionIds, targetRoot, currentState, options = {} /*, productConfig */ }) {
  const adapter = adapterId && adapterRegistry ? adapterRegistry.get(adapterId) : null;
  const mapTargetPath = adapter ? (asset) => adapter.mapTargetPath(asset, manifest) : undefined;
  return buildInstallPlan(manifest, selectionIds, {
    repoRoot: options.repoRoot,
    targetRoot,
    mapTargetPath,
    currentState,
    supportedAssetTypes: adapter?.supportedAssetTypes ?? null,
  });
}

/**
 * Validate an install plan against state + caller options.
 * Returns { ok: true } on success, { ok: false, reason, ... } on
 * predictable failures.
 *
 * @param {Object} args
 * @param {InstallPlan} args.plan
 * @param {Object|null} args.currentState
 * @param {Object} [args.options]
 * @param {boolean} [args.options.overwriteUnmanaged]
 * @returns {ValidationResult}
 */
function installValidateStage({ plan, currentState, options = {} }) {
  const { overwriteUnmanaged = false } = options;

  // State schema sanity (predictable, expected error)
  if (currentState) {
    const stateFindings = validateState(currentState);
    if (stateFindings.length > 0) {
      return {
        ok: false,
        reason: "state-invalid",
        findings: stateFindings,
        message: `existing state.json invalid: ${stateFindings[0].path} — ${stateFindings[0].message}`,
      };
    }
  }

  if (plan.conflicts.length > 0 && !overwriteUnmanaged) {
    return {
      ok: false,
      reason: "unmanaged-files-block",
      conflicts: plan.conflicts,
      message: `${plan.conflicts.length} unmanaged file(s) at target paths; pass --overwrite to replace`,
    };
  }

  return { ok: true };
}

/**
 * Apply install plan to the prior state, producing the next state. Pure
 * data transformation; no IO.
 *
 * @param {Object} args
 * @param {Object} args.prevState
 * @param {InstallPlan} args.plan
 * @param {string[]} args.selectionIds        Selections this run is committing
 * @param {Object} args.selectionKindOverrides {selectionId: "skill"|"bundle"}
 * @param {Object} args.manifest
 * @param {string} args.installerVersion
 * @param {string|null} args.sourceCommit
 * @param {string} args.installMode           "direct" | "plugin"
 * @param {string} args.now                   ISO timestamp
 * @param {string} [args.requestedBy="cli"]
 * @returns {Object} Next state
 */
function installPersistStage({ prevState, plan, selectionIds, selectionKindOverrides = {}, manifest, installerVersion, sourceCommit, installMode = "direct", now, requestedBy = "cli" }) {
  const grouped = groupFilesBySelection(plan, manifest, selectionIds);
  let postState = prevState;
  for (const [selectionId, files] of grouped) {
    const kind = selectionKindOverrides[selectionId] || (selectionId in manifest.bundles ? "bundle" : "skill");
    postState = applyInstall(postState, {
      selectionId,
      selectionKind: kind,
      installMode,
      installerVersion,
      files: files.map((f) => ({
        relPath: f.targetRel,
        sha256: f.sha256,
        algo: f.algo,
        normalization: f.normalization,
        bytes: f.bytes,
        mode: f.mode,
        sourceRelPath: f.sourcePath,
        sourceCommit,
        assetType: f.assetType,
        bundleMembership: kind === "bundle" ? [selectionId] : undefined,
      })),
      now,
      requestedBy,
    });
  }
  return postState;
}

// Helper retained here (also used by Unit 6 split). Mirrors the same fn
// in cli/commands.mjs:462; that copy will be removed when commands.mjs is
// split in Unit 6.
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

// ---------- uninstall ----------

/**
 * Compute an uninstall plan from existing state + selectionIds.
 * Returns the list of managed files implicated for each selection so the
 * caller can perform on-disk hashing to detect user modifications.
 *
 * Pure: reads no filesystem; consumes only state + selectionIds.
 */
function uninstallPlanStage({ state, selectionIds }) {
  const filesPerSelection = new Map();
  for (const selectionId of selectionIds) {
    const installed = state.installations.some((i) => i.selectionId === selectionId);
    if (!installed) {
      filesPerSelection.set(selectionId, { installed: false, files: [] });
      continue;
    }
    const files = state.managedFiles.filter((f) => f.referencedBy.includes(selectionId));
    filesPerSelection.set(selectionId, { installed: true, files });
  }
  return { selectionIds: [...selectionIds], filesPerSelection };
}

/**
 * Validate uninstall: walks selectionIds, performs on-disk hashing via
 * the caller-supplied hashFile-like function (so the stage stays pure
 * wrt direct fs access), invokes applyUninstall, and accumulates blocked
 * selections.
 *
 * Caller supplies `onDiskHashes: { [selectionId]: { [relPath]: sha256 } }`.
 * Caller computes this from disk before invoking validate.
 *
 * Returns the result equivalent to commands.mjs:483-540's accumulation.
 */
function uninstallValidateStage({ state, selectionIds, onDiskHashesPerSelection, force = false, acceptModified = [], now }) {
  let postState = state;
  const allDeletes = [];
  const blockedSelections = [];

  for (const selectionId of selectionIds) {
    if (!postState.installations.some((i) => i.selectionId === selectionId)) {
      return {
        ok: false,
        reason: "not-installed",
        selectionId,
        message: `selection not installed: ${selectionId}`,
      };
    }
    const onDiskHashes = onDiskHashesPerSelection?.[selectionId] || {};
    const result = applyUninstall(postState, { selectionId, onDiskHashes, force, acceptModified, now });
    if (result.blocked) {
      blockedSelections.push({
        selectionId,
        blockedByModification: result.blockedByModification,
        blockedByMissingHash: result.blockedByMissingHash,
      });
      continue;
    }
    postState = result.state;
    allDeletes.push(...result.toDelete);
  }

  if (blockedSelections.length > 0) {
    const flatMods = blockedSelections.flatMap((b) => b.blockedByModification);
    const flatMissing = blockedSelections.flatMap((b) => b.blockedByMissingHash);
    return {
      ok: false,
      reason: "modification-blocks",
      selectionId: blockedSelections.length === 1 ? blockedSelections[0].selectionId : null,
      blockedSelections,
      blockedByModification: flatMods,
      blockedByMissingHash: flatMissing,
    };
  }

  return { ok: true, postState, toDelete: allDeletes };
}

/**
 * Persist the uninstall — postState is the new state to write; the caller
 * is responsible for actually deleting files (pipeline.commit handles
 * file IO so this stage stays pure).
 */
function uninstallPersistStage({ postState /*, now, productConfig */ }) {
  // Today the post-state IS the persistable state. Future:
  // augment with productConfig-driven metadata if needed.
  return postState;
}

// ---------- update ----------

/**
 * Compute an update plan: for each managed file in state, determine
 * whether re-copying the source would change content. Pure: reads source
 * files via hashFile (filesystem read is required by the algorithm) but
 * not env / not network.
 */
function updatePlanStage({ state, repoRoot, force = false, acceptModified = [] }) {
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
    const newHash = hashFile(sourceAbs);
    if (newHash.sha256 === mf.sha256) continue;

    const targetAbs = path.resolve(state.targetRoot, mf.relPath);
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

  return { candidates, tampered, sourceMissing };
}

function updateValidateStage({ plan }) {
  if (plan.tampered.length > 0) {
    return {
      ok: false,
      reason: "modification-blocks",
      blockedByModification: plan.tampered,
      message: `${plan.tampered.length} target file(s) modified locally. Pass --force --accept-modified <relPath> per file to overwrite.`,
    };
  }
  return { ok: true };
}

function updatePersistStage({ prevState, plan, sourceCommit, now }) {
  const candidateMap = new Map(plan.candidates.map((c) => [c.mf.relPath, c]));
  return {
    ...prevState,
    updatedAt: now,
    managedFiles: prevState.managedFiles.map((mf) => {
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
}

// ---------- shared stage / commit ----------

/**
 * Materialize plan files into a staging directory. Pure-IO: writes files
 * but does not modify state, does not promote.
 *
 * @returns {StagingHandle} { stagingDir, stagedFiles: [{relPath, sourceAbs}] }
 */
function stageStage({ plan, targetRoot, stagingRunId }) {
  const stagingDir = makeStagingDir(targetRoot, stagingRunId);
  const stagedFiles = [];
  const filesToWrite = plan.files.filter(
    (f) => f.action === "create" || f.action === "overwrite-managed" || f.action === "conflict-unmanaged"
  );
  for (const f of filesToWrite) {
    const buf = fs.readFileSync(f.sourceAbs);
    stageWrite(stagingDir, f.targetRel, buf);
    stagedFiles.push({ relPath: f.targetRel, sourceAbs: f.sourceAbs });
  }
  return { stagingDir, stagedFiles };
}

/**
 * Promote staged files atomically into targetRoot. Returns the list of
 * relPaths that were written.
 *
 * @returns {CommitResult} { writtenFiles: string[] }
 */
function commitStage({ stagingHandle, targetRoot }) {
  const writeRels = stagingHandle.stagedFiles.map((f) => f.relPath);
  promoteStagedFiles(stagingHandle.stagingDir, targetRoot, writeRels);
  return { writtenFiles: writeRels };
}

/**
 * Delete files for uninstall. Symmetric counterpart of commit's writes.
 * (Uninstall does not stage; it goes directly from validate to a "commit"
 * that performs deletion.)
 */
function commitUninstallStage({ targetRoot, toDelete }) {
  deleteFiles(targetRoot, toDelete);
  return { deletedFiles: [...toDelete] };
}

// ---------- pipeline namespace ----------

export const pipeline = Object.freeze({
  install: Object.freeze({
    plan: installPlanStage,
    validate: installValidateStage,
    persist: installPersistStage,
  }),
  uninstall: Object.freeze({
    plan: uninstallPlanStage,
    validate: uninstallValidateStage,
    persist: uninstallPersistStage,
    commit: commitUninstallStage,
  }),
  update: Object.freeze({
    plan: updatePlanStage,
    validate: updateValidateStage,
    persist: updatePersistStage,
  }),
  stage: stageStage,
  commit: commitStage,
});

// Re-export helpers commonly used alongside the pipeline. Callers can
// orchestrate snapshotStateBak / writeStateAtomic / stateDirFor / STATE_BAK
// either via these direct imports or via filesystem.mjs.
export { snapshotStateBak, writeStateAtomic, stateDirFor, STATE_BAK };
