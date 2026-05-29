// stage-asset.mjs — transform-and-write primitives for the kernel.
//
// Naming: "stage-asset" is a noun ("an asset that gets staged") and is
// deliberately distinct from filesystem.mjs's staging-*dir* verbs
// (STAGING_PREFIX / makeStagingDir / stageWrite / promoteStagedFiles).
//
// Two primitives compose applyAdapterTransform (core/plan.mjs) + hashBytes
// (core/filesystem.mjs):
//
//   * stageAsset      — transform + hash + stageWrite. The three commands-
//                        side staging stations (install / update persist /
//                        repair) used to inline this triplet. Hardcodes
//                        stage:"stage" because it always writes.
//   * hashTransformed  — transform + hash, NO write. The plan-side path
//                        (buildInstallPlan) used to inline hashFile(source);
//                        it must hash the *transformed* bytes so the
//                        recorded sha256 matches what stageAsset later
//                        writes. Caller passes the stage discriminator.
//
// Cross-stage hash invariant (ADR-0002 D2): stageAsset hashes exactly the
// bytes stageWrite persists, so the returned sha256 == hashFile(stagedPath).
// stage-asset.test.mjs carries an independent witness for this; a sample-bin
// E2E carries the integration witness. There is no pipeline-side witness —
// pipeline.* is deleted in U5 (single-tier, matching the downstream).
//
// Errors are passed through unchanged: AdapterError(ERR_TRANSFORM_FAILED)
// from applyAdapterTransform, FsError (path validation) / raw fs errors
// from stageWrite. No new error class is introduced here. Core-internal:
// NOT re-exported via index.mjs.

import path from "node:path";

import { applyAdapterTransform } from "./plan.mjs";
import { hashBytes, stageWrite } from "./filesystem.mjs";

/**
 * Transform-and-stage a single asset (always writes; stage:"stage").
 *
 * @param {Object}  params
 * @param {{assetType:string,id:string,sourceRelPath?:string,sourceAbs:string,sourceBuf?:Buffer}} params.asset
 * @param {Object?} params.adapter      adapter object (or undefined for identity); only `id` + resolved `contentPipeline` consulted
 * @param {string}  params.stagingDir   absolute staging dir (caller created via makeStagingDir)
 * @param {string}  params.targetRel    relative path the staged bytes will promote to
 * @returns {{sha256:string,algo:string,normalization:string,bytes:number,transformed:boolean}}
 */
export function stageAsset({ asset, adapter, stagingDir, targetRel }) {
  const { resultBuf, transformed } = applyAdapterTransform(
    asset,
    adapter?.contentPipeline,
    { adapterId: adapter?.id ?? null, stage: "stage" }
  );
  const hash = hashBytes(resultBuf, { extension: path.extname(asset.sourceAbs) });
  stageWrite(stagingDir, targetRel, resultBuf);
  return {
    sha256: hash.sha256,
    algo: hash.algo,
    normalization: hash.normalization,
    bytes: hash.bytes,
    transformed,
  };
}

/**
 * Transform an asset and hash the result WITHOUT writing. Used by the
 * plan-side path so the recorded sha256 is the transformed hash (which
 * stageAsset will later reproduce on disk). Caller supplies `stage`
 * ("plan") for AdapterError provenance.
 *
 * @param {Object}  params
 * @param {{assetType:string,id:string,sourceRelPath?:string,sourceAbs:string,sourceBuf?:Buffer}} params.asset
 * @param {Object?} params.adapter
 * @param {"plan"|"stage"} params.stage
 * @returns {{sha256:string,algo:string,normalization:string,bytes:number,transformed:boolean}}
 */
export function hashTransformed({ asset, adapter, stage }) {
  const { resultBuf, transformed } = applyAdapterTransform(
    asset,
    adapter?.contentPipeline,
    { adapterId: adapter?.id ?? null, stage }
  );
  const hash = hashBytes(resultBuf, { extension: path.extname(asset.sourceAbs) });
  return {
    sha256: hash.sha256,
    algo: hash.algo,
    normalization: hash.normalization,
    bytes: hash.bytes,
    transformed,
  };
}
