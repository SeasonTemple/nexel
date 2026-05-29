import fs from "node:fs";
import path from "node:path";

import { hashBytes, isLikelyText } from "./filesystem.mjs";
import { findManagedFile } from "./state.mjs";
import { getAssetType } from "./asset-types.mjs";
import {
  AdapterError,
  ERR_ARGS,
  ERR_UNKNOWN_SELECTION,
  ERR_REPO_ONLY,
  ERR_SOURCE_MISSING,
  ERR_UNKNOWN_AGENT,
  ERR_UNKNOWN_RULE,
  ERR_ASSET_TYPE,
  ERR_TRANSFORM_FAILED,
} from "./errors.mjs";

export class PlanError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "PlanError";
    this.code = code;
    this.details = details;
  }
}

export function resolveSelection(manifest, selectionId) {
  if (selectionId in manifest.skills) {
    return {
      kind: "skill",
      skills: [selectionId],
      agents: [],
      rules: [],
      bundles: [],
    };
  }
  if (selectionId in manifest.bundles) {
    const b = manifest.bundles[selectionId];
    return {
      kind: "bundle",
      skills: [...(b.skills || [])],
      agents: [...(b.agents || [])],
      rules: [...(b.rules || [])],
      bundles: [selectionId],
    };
  }
  throw new PlanError(`unknown selection id: ${selectionId}`, ERR_UNKNOWN_SELECTION);
}

export function transitiveAssets(manifest, selectionIds) {
  const skillSet = new Set();
  const agentSet = new Set();
  const ruleSet = new Set();
  const bundleSet = new Set();
  for (const sid of selectionIds) {
    const r = resolveSelection(manifest, sid);
    for (const x of r.skills) skillSet.add(x);
    for (const x of r.agents) agentSet.add(x);
    for (const x of r.rules) ruleSet.add(x);
    for (const x of r.bundles) bundleSet.add(x);
  }
  for (const sid of [...skillSet]) {
    const skill = manifest.skills[sid];
    if (!skill) continue;
    if (skill.profile === "repo-only") {
      throw new PlanError(`cannot install repo-only skill via direct mode: ${sid}`, ERR_REPO_ONLY, { skillId: sid });
    }
    const deps = skill.dependencies || {};
    for (const a of deps.agents || []) agentSet.add(a);
    for (const r of deps.rules || []) ruleSet.add(r);
    for (const s of deps.skills || []) skillSet.add(s);
  }
  return {
    skills: [...skillSet].sort(),
    agents: [...agentSet].sort(),
    rules: [...ruleSet].sort(),
    bundles: [...bundleSet].sort(),
  };
}

export function defaultTargetMapping(manifest /*, repoRoot */) {
  return function map(asset) {
    const t = getAssetType(asset.assetType);
    if (!t) throw new PlanError(`unsupported asset type: ${asset.assetType}`, ERR_ASSET_TYPE);
    return t.defaultTargetMap(asset, manifest);
  };
}

/**
 * SPI v1.3 content-pipeline fold primitive (core-internal — NOT re-exported
 * via index.mjs; production callers go through core/stage-asset.mjs, which
 * composes this).
 *
 * Folds the adapter's resolved canonical `contentPipeline` (an ordered array
 * of `{ id, run }` stages) over the asset's source bytes, threading the Buffer
 * stage → stage. The `transformed` flag is computed ONCE by Buffer reference
 * equality against the ORIGINAL source buffer (never per-stage): an empty
 * pipeline — or a pipeline whose net result returns the input by reference —
 * yields `transformed: false`. Stages receive the threaded Buffer as
 * read-only; in-place mutation that returns the same reference is undefined
 * behavior that can corrupt the flag and the cross-stage hash invariant.
 *
 * A stage throw or a non-Buffer return surfaces as
 * `AdapterError(ERR_TRANSFORM_FAILED)` carrying
 * `.details = { adapterId, assetId, assetType, stage, stageId, cause }`.
 * `stage` ("plan" | "stage") is the caller-supplied invocation-site provenance;
 * `stageId` is the failing pipeline stage's `id`. Neither forks the error
 * identity. (ADR-0020 D4.)
 *
 * @param {{assetType:string,id:string,sourceRelPath?:string,sourceAbs?:string,sourceBuf?:Buffer}} asset
 * @param {Array<{id:string,run:(asset:object,body:Buffer)=>Buffer}>|undefined} pipeline  canonical resolved pipeline (adapter.contentPipeline)
 * @param {{adapterId?:string|null, stage:"plan"|"stage"}} opts
 * @returns {{resultBuf:Buffer, transformed:boolean}}
 */
export function applyAdapterTransform(asset, pipeline, { adapterId = null, stage } = {}) {
  const sourceBuf = asset.sourceBuf ?? fs.readFileSync(asset.sourceAbs);
  // Identity fast-path covers BOTH undefined/null (no adapter supplied) and a
  // resolved empty pipeline (no-hook adapter). Returns the source Buffer BY
  // REFERENCE so reference-equality "transformed" detection holds (ADR-0020 D3).
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return { resultBuf: sourceBuf, transformed: false };
  }
  const hookAsset = {
    assetType: asset.assetType,
    id: asset.id,
    sourceRelPath: asset.sourceRelPath,
  };
  let buf = sourceBuf;
  for (const stageDef of pipeline) {
    let out;
    try {
      out = stageDef.run(hookAsset, buf);
    } catch (cause) {
      throw new AdapterError(
        `adapter ${adapterId ?? "(unknown)"} contentPipeline stage "${stageDef.id}" threw for ${asset.assetType} ${asset.id}`,
        ERR_TRANSFORM_FAILED,
        { adapterId, assetId: asset.id, assetType: asset.assetType, stage, stageId: stageDef.id, cause }
      );
    }
    if (!Buffer.isBuffer(out)) {
      throw new AdapterError(
        `adapter ${adapterId ?? "(unknown)"} contentPipeline stage "${stageDef.id}" returned a non-Buffer (${typeof out}) for ${asset.assetType} ${asset.id}`,
        ERR_TRANSFORM_FAILED,
        { adapterId, assetId: asset.id, assetType: asset.assetType, stage, stageId: stageDef.id, cause: null }
      );
    }
    buf = out;
  }
  // Net change vs the ORIGINAL source buffer — not per-stage.
  return { resultBuf: buf, transformed: buf !== sourceBuf };
}

function walkSkillDir(skillDirAbs) {
  const out = [];
  const stack = [{ rel: "" }];
  while (stack.length > 0) {
    const { rel } = stack.pop();
    const abs = rel === "" ? skillDirAbs : path.join(skillDirAbs, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : path.posix.join(rel, entry.name);
      if (entry.isDirectory()) {
        stack.push({ rel: childRel });
        continue;
      }
      if (!entry.isFile()) continue;
      out.push(childRel);
    }
  }
  return out.sort();
}

export function buildInstallPlan(manifest, selectionIds, options) {
  const {
    repoRoot,
    targetRoot,
    mapTargetPath = defaultTargetMapping(manifest, repoRoot),
    currentState = null,
    supportedAssetTypes = null, // null = all supported (backward-compat)
    adapter = null,             // SPI v1.1: when present, plan-side hash is the TRANSFORMED hash
  } = options;
  if (!repoRoot || !targetRoot) throw new PlanError("repoRoot and targetRoot required", ERR_ARGS);

  // Plan-side transformed hash. Composes the in-module applyAdapterTransform
  // + hashBytes (NOT stage-asset.mjs's hashTransformed — that would create a
  // plan.mjs ↔ stage-asset.mjs import cycle; see ADR-0003). Identity when no
  // adapter / empty pipeline, so the recorded sha256 equals what stageAsset
  // later writes (cross-stage invariant, ADR-0002 D2). Passes the adapter's
  // resolved contentPipeline (SPI v1.3, ADR-0020).
  const hashSource = (assetType, id, sourceRelPath, sourceAbs) => {
    const { resultBuf } = applyAdapterTransform(
      { assetType, id, sourceRelPath, sourceAbs },
      adapter?.contentPipeline,
      { adapterId: adapter?.id ?? null, stage: "plan" }
    );
    return hashBytes(resultBuf, { extension: path.extname(sourceAbs) });
  };

  const transitive = transitiveAssets(manifest, selectionIds);
  const files = [];
  const conflicts = [];
  const skippedUnsupported = [];
  const isSupported = (assetType) => !supportedAssetTypes || supportedAssetTypes.includes(assetType);

  if (!isSupported("skill")) {
    for (const skillId of transitive.skills) {
      skippedUnsupported.push({ assetType: "skill", id: skillId });
    }
  } else for (const skillId of transitive.skills) {
    const skill = manifest.skills[skillId];
    const skillDirAbs = path.resolve(repoRoot, skill.sourcePath);
    if (!fs.existsSync(skillDirAbs)) {
      throw new PlanError(`skill source not found: ${skill.sourcePath}`, ERR_SOURCE_MISSING, { skillId });
    }
    const inner = walkSkillDir(skillDirAbs);
    for (const relSourcePath of inner) {
      const sourcePath = path.posix.join(skill.sourcePath, relSourcePath);
      const sourceAbs = path.resolve(repoRoot, sourcePath);
      const hash = hashSource("skill", skillId, sourcePath, sourceAbs);
      const targetRel = mapTargetPath({ assetType: "skill", id: skillId, skillDirname: skill.dirname, relSourcePath });
      files.push({
        sourcePath,
        sourceAbs,
        targetRel,
        assetType: "skill",
        ownerSelection: skillId,
        sha256: hash.sha256,
        algo: hash.algo,
        normalization: hash.normalization,
        bytes: hash.bytes,
        mode: "0644",
      });
    }
  }

  if (!isSupported("agent")) {
    for (const agentId of transitive.agents) {
      skippedUnsupported.push({ assetType: "agent", id: agentId });
    }
  } else for (const agentId of transitive.agents) {
    const agent = manifest.agents[agentId];
    if (!agent) {
      throw new PlanError(`agent not in manifest: ${agentId}`, ERR_UNKNOWN_AGENT);
    }
    const sourceAbs = path.resolve(repoRoot, agent.sourcePath);
    if (!fs.existsSync(sourceAbs)) {
      throw new PlanError(`agent source not found: ${agent.sourcePath}`, ERR_SOURCE_MISSING, { agentId });
    }
    const hash = hashSource("agent", agentId, agent.sourcePath, sourceAbs);
    const targetRel = mapTargetPath({ assetType: "agent", id: agentId });
    files.push({
      sourcePath: agent.sourcePath,
      sourceAbs,
      targetRel,
      assetType: "agent",
      ownerSelection: selectionIds.find((s) => {
        const sk = manifest.skills[s];
        if (sk?.dependencies?.agents?.includes(agentId)) return true;
        const bd = manifest.bundles[s];
        if (bd?.agents?.includes(agentId)) return true;
        return false;
      }) || selectionIds[0],
      sha256: hash.sha256,
      algo: hash.algo,
      normalization: hash.normalization,
      bytes: hash.bytes,
      mode: "0644",
    });
  }

  if (!isSupported("rule")) {
    for (const ruleKey of transitive.rules) {
      skippedUnsupported.push({ assetType: "rule", id: ruleKey });
    }
  } else for (const ruleKey of transitive.rules) {
    const rule = manifest.rules[ruleKey];
    if (!rule) throw new PlanError(`rule not in manifest: ${ruleKey}`, ERR_UNKNOWN_RULE);
    const sourceAbs = path.resolve(repoRoot, rule.sourcePath);
    if (!fs.existsSync(sourceAbs)) {
      throw new PlanError(`rule source not found: ${rule.sourcePath}`, ERR_SOURCE_MISSING, { ruleKey });
    }
    const hash = hashSource("rule", ruleKey, rule.sourcePath, sourceAbs);
    const targetRel = mapTargetPath({ assetType: "rule", id: ruleKey });
    files.push({
      sourcePath: rule.sourcePath,
      sourceAbs,
      targetRel,
      assetType: "rule",
      ownerSelection: selectionIds.find((s) => {
        const sk = manifest.skills[s];
        if (sk?.dependencies?.rules?.includes(ruleKey)) return true;
        const bd = manifest.bundles[s];
        if (bd?.rules?.includes(ruleKey)) return true;
        return false;
      }) || selectionIds[0],
      sha256: hash.sha256,
      algo: hash.algo,
      normalization: hash.normalization,
      bytes: hash.bytes,
      mode: "0644",
    });
  }

  for (const f of files) {
    const targetAbs = path.resolve(targetRoot, f.targetRel);
    const existing = currentState ? findManagedFile(currentState, f.targetRel) : null;
    f.targetAbs = targetAbs;
    if (!fs.existsSync(targetAbs)) {
      f.action = "create";
    } else if (existing) {
      f.action = existing.sha256 === f.sha256 ? "skip" : "overwrite-managed";
    } else {
      f.action = "conflict-unmanaged";
      conflicts.push({
        relPath: f.targetRel,
        reason: "unmanaged file exists at target path",
        targetAbs,
      });
    }
  }

  return {
    selectionIds: [...selectionIds],
    transitive,
    files,
    conflicts,
    skippedUnsupported,
    summary: summarize(files, conflicts),
  };
}

export function summarize(files, conflicts) {
  const counts = { create: 0, skip: 0, "overwrite-managed": 0, "conflict-unmanaged": 0 };
  let totalBytes = 0;
  for (const f of files) {
    counts[f.action] = (counts[f.action] || 0) + 1;
    totalBytes += f.bytes || 0;
  }
  return {
    fileCount: files.length,
    totalBytes,
    counts,
    conflictCount: conflicts.length,
  };
}

export function formatPlanText(plan) {
  const lines = [];
  lines.push(`Plan for selection(s): ${plan.selectionIds.join(", ")}`);
  lines.push(`Transitive: ${plan.transitive.skills.length} skill(s), ${plan.transitive.agents.length} agent(s), ${plan.transitive.rules.length} rule(s)`);
  lines.push(`Files: ${plan.summary.fileCount} (create=${plan.summary.counts.create}, skip=${plan.summary.counts.skip}, overwrite-managed=${plan.summary.counts["overwrite-managed"]}, conflict-unmanaged=${plan.summary.counts["conflict-unmanaged"]})`);
  lines.push(`Total bytes: ${plan.summary.totalBytes}`);
  if (plan.skippedUnsupported?.length > 0) {
    const byType = new Map();
    for (const s of plan.skippedUnsupported) byType.set(s.assetType, (byType.get(s.assetType) || 0) + 1);
    const summary = [...byType.entries()].map(([t, n]) => `${n} ${t}(s)`).join(", ");
    lines.push(`Skipped (target adapter does not support these asset types): ${summary}`);
    for (const s of plan.skippedUnsupported.slice(0, 5)) lines.push(`  - ${s.assetType}: ${s.id}`);
    if (plan.skippedUnsupported.length > 5) lines.push(`  ... and ${plan.skippedUnsupported.length - 5} more`);
  }
  if (plan.conflicts.length > 0) {
    lines.push(`Conflicts (${plan.conflicts.length}):`);
    for (const c of plan.conflicts) lines.push(`  - ${c.relPath}: ${c.reason}`);
  }
  for (const f of plan.files) {
    lines.push(`  [${f.action}] ${f.assetType} ${f.targetRel}  (sha256=${f.sha256.slice(0, 12)}…, ${f.bytes}B)`);
  }
  return lines.join("\n");
}
