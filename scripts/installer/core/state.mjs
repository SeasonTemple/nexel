import {
  ERR_ARGS,
  ERR_PARSE,
  ERR_SCHEMA_TOO_NEW,
  ERR_NO_MIGRATION,
  ERR_BAD_MIGRATION,
  ERR_ALREADY_INSTALLED,
  ERR_HASH_CONFLICT,
  ERR_NOT_INSTALLED,
} from "./errors.mjs";

export const STATE_SCHEMA_VERSION = 1;
export const MIN_SUPPORTED_SCHEMA = 1;
export const MAX_SUPPORTED_SCHEMA = 1;
export const HASH_ALGO = "sha256";
export const HASH_NORMALIZATION = "text-lf-v1";

export const ASSET_TYPES = Object.freeze(["skill", "agent", "rule", "shared"]);
export const SELECTION_KINDS = Object.freeze(["skill", "bundle"]);
export const INSTALL_MODES = Object.freeze(["plugin", "direct"]);
export const REQUESTERS = Object.freeze(["cli", "interactive", "ci"]);

const ASSET_TYPE_SET = new Set(ASSET_TYPES);
const SELECTION_KIND_SET = new Set(SELECTION_KINDS);
const INSTALL_MODE_SET = new Set(INSTALL_MODES);
const REQUESTER_SET = new Set(REQUESTERS);

export class StateError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "StateError";
    this.code = code;
  }
}

export function emptyState({ installerVersion, agentId, targetRoot, now }) {
  if (typeof installerVersion !== "string" || !installerVersion) throw new StateError("installerVersion required", ERR_ARGS);
  if (typeof agentId !== "string" || !agentId) throw new StateError("agentId required", ERR_ARGS);
  if (typeof targetRoot !== "string" || !targetRoot) throw new StateError("targetRoot required", ERR_ARGS);
  const ts = now || new Date().toISOString();
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    installerVersion,
    agentId,
    targetRoot,
    createdAt: ts,
    updatedAt: ts,
    managedFiles: [],
    installations: [],
  };
}

const MIGRATIONS = {};

export function migrateState(state) {
  if (!state || typeof state !== "object") throw new StateError("state must be an object", ERR_PARSE);
  if (typeof state.schemaVersion !== "number") throw new StateError("state.schemaVersion must be a number", ERR_PARSE);
  if (state.schemaVersion > MAX_SUPPORTED_SCHEMA) {
    throw new StateError(
      `state schema v${state.schemaVersion} newer than installer max v${MAX_SUPPORTED_SCHEMA}; upgrade the installer or run uninstall via the newer installer`,
      ERR_SCHEMA_TOO_NEW
    );
  }
  let cur = state;
  while (cur.schemaVersion < MAX_SUPPORTED_SCHEMA) {
    const fn = MIGRATIONS[cur.schemaVersion];
    if (!fn) throw new StateError(`no migration from schema v${cur.schemaVersion} to v${cur.schemaVersion + 1}`, ERR_NO_MIGRATION);
    cur = fn(cur);
    if (cur.schemaVersion <= state.schemaVersion) {
      throw new StateError(`migration v${state.schemaVersion} did not advance schemaVersion`, ERR_BAD_MIGRATION);
    }
  }
  return cur;
}

export function validateState(state) {
  const findings = [];
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    findings.push({ path: "$", message: "state must be an object" });
    return findings;
  }
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    findings.push({ path: "$.schemaVersion", message: `expected ${STATE_SCHEMA_VERSION}, got ${state.schemaVersion}` });
  }
  for (const k of ["installerVersion", "agentId", "targetRoot", "createdAt", "updatedAt"]) {
    if (typeof state[k] !== "string" || !state[k]) findings.push({ path: `$.${k}`, message: "must be a non-empty string" });
  }
  if (!Array.isArray(state.managedFiles)) findings.push({ path: "$.managedFiles", message: "must be an array" });
  if (!Array.isArray(state.installations)) findings.push({ path: "$.installations", message: "must be an array" });
  if (findings.length > 0) return findings;

  const seenRelPaths = new Set();
  for (let i = 0; i < state.managedFiles.length; i++) {
    const f = state.managedFiles[i];
    const p = `$.managedFiles[${i}]`;
    if (!f || typeof f !== "object") {
      findings.push({ path: p, message: "must be an object" });
      continue;
    }
    if (typeof f.relPath !== "string" || !f.relPath) findings.push({ path: `${p}.relPath`, message: "must be a non-empty string" });
    else if (seenRelPaths.has(f.relPath)) findings.push({ path: `${p}.relPath`, message: `duplicate relPath: ${f.relPath}` });
    else seenRelPaths.add(f.relPath);
    if (typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(f.sha256)) findings.push({ path: `${p}.sha256`, message: "must be 64-char lowercase hex" });
    if (f.algo !== HASH_ALGO) findings.push({ path: `${p}.algo`, message: `must be "${HASH_ALGO}"` });
    if (f.normalization !== HASH_NORMALIZATION && f.normalization !== "byte-exact") {
      findings.push({ path: `${p}.normalization`, message: `must be "${HASH_NORMALIZATION}" or "byte-exact"` });
    }
    if (typeof f.bytes !== "number" || f.bytes < 0) findings.push({ path: `${p}.bytes`, message: "must be a non-negative number" });
    if (typeof f.mode !== "string" || !/^0[0-7]{3}$/.test(f.mode)) findings.push({ path: `${p}.mode`, message: "must be octal string like \"0644\"" });
    if (typeof f.installedAt !== "string") findings.push({ path: `${p}.installedAt`, message: "must be a string" });
    if (typeof f.sourceRelPath !== "string") findings.push({ path: `${p}.sourceRelPath`, message: "must be a string" });
    if (f.sourceCommit !== null && typeof f.sourceCommit !== "string") findings.push({ path: `${p}.sourceCommit`, message: "must be a string or null" });
    if (!ASSET_TYPE_SET.has(f.assetType)) findings.push({ path: `${p}.assetType`, message: `must be one of {${ASSET_TYPES.join(", ")}}` });
    if (!Array.isArray(f.referencedBy) || f.referencedBy.length === 0) {
      findings.push({ path: `${p}.referencedBy`, message: "must be a non-empty array" });
    } else {
      const rb = new Set();
      for (const id of f.referencedBy) {
        if (typeof id !== "string" || !id) findings.push({ path: `${p}.referencedBy`, message: "entries must be non-empty strings" });
        else if (rb.has(id)) findings.push({ path: `${p}.referencedBy`, message: `duplicate selectionId: ${id}` });
        else rb.add(id);
      }
    }
    if (f.bundleMembership !== undefined && !Array.isArray(f.bundleMembership)) {
      findings.push({ path: `${p}.bundleMembership`, message: "must be an array if present" });
    }
  }

  const seenSelections = new Set();
  for (let i = 0; i < state.installations.length; i++) {
    const inst = state.installations[i];
    const p = `$.installations[${i}]`;
    if (!inst || typeof inst !== "object") {
      findings.push({ path: p, message: "must be an object" });
      continue;
    }
    if (typeof inst.selectionId !== "string" || !inst.selectionId) findings.push({ path: `${p}.selectionId`, message: "must be a non-empty string" });
    else if (seenSelections.has(inst.selectionId)) findings.push({ path: `${p}.selectionId`, message: `duplicate selectionId: ${inst.selectionId}` });
    else seenSelections.add(inst.selectionId);
    if (!SELECTION_KIND_SET.has(inst.selectionKind)) findings.push({ path: `${p}.selectionKind`, message: `must be one of {${SELECTION_KINDS.join(", ")}}` });
    if (!INSTALL_MODE_SET.has(inst.installMode)) findings.push({ path: `${p}.installMode`, message: `must be one of {${INSTALL_MODES.join(", ")}}` });
    if (typeof inst.installerVersion !== "string") findings.push({ path: `${p}.installerVersion`, message: "must be a string" });
    if (typeof inst.installedAt !== "string") findings.push({ path: `${p}.installedAt`, message: "must be a string" });
    if (inst.requestedBy !== undefined && !REQUESTER_SET.has(inst.requestedBy)) {
      findings.push({ path: `${p}.requestedBy`, message: `must be one of {${REQUESTERS.join(", ")}}` });
    }
  }

  for (const inst of state.installations) {
    if (!inst || typeof inst.selectionId !== "string") continue;
    const referenced = state.managedFiles.some((f) => Array.isArray(f.referencedBy) && f.referencedBy.includes(inst.selectionId));
    if (!referenced && state.managedFiles.length > 0) {
      const known = state.managedFiles.length > 0;
      if (known) findings.push({ path: `$.installations[?(@.selectionId=='${inst.selectionId}')]`, message: "selectionId installed but not present in any managedFiles.referencedBy" });
    }
  }

  for (let i = 0; i < state.managedFiles.length; i++) {
    const f = state.managedFiles[i];
    if (!f || !Array.isArray(f.referencedBy)) continue;
    for (const id of f.referencedBy) {
      if (!seenSelections.has(id)) {
        findings.push({ path: `$.managedFiles[${i}].referencedBy`, message: `references unknown installation: ${id}` });
      }
    }
  }

  return findings;
}

export function findManagedFile(state, relPath) {
  return state.managedFiles.find((f) => f.relPath === relPath) || null;
}

export function listInstallations(state) {
  return [...state.installations];
}

function ensureSelectionAbsent(state, selectionId) {
  if (state.installations.some((i) => i.selectionId === selectionId)) {
    throw new StateError(`selection already installed: ${selectionId}`, ERR_ALREADY_INSTALLED);
  }
}

export function applyInstall(state, request) {
  const {
    selectionId,
    selectionKind,
    installMode,
    installerVersion,
    files,
    now,
    requestedBy = "cli",
    bundleMembership = [],
  } = request;
  if (typeof selectionId !== "string" || !selectionId) throw new StateError("selectionId required", ERR_ARGS);
  if (!SELECTION_KIND_SET.has(selectionKind)) throw new StateError(`invalid selectionKind: ${selectionKind}`, ERR_ARGS);
  if (!INSTALL_MODE_SET.has(installMode)) throw new StateError(`invalid installMode: ${installMode}`, ERR_ARGS);
  if (!Array.isArray(files)) throw new StateError("files must be an array", ERR_ARGS);
  ensureSelectionAbsent(state, selectionId);

  const ts = now || new Date().toISOString();
  const next = {
    ...state,
    updatedAt: ts,
    managedFiles: state.managedFiles.map((f) => ({ ...f, referencedBy: [...f.referencedBy] })),
    installations: [...state.installations, {
      selectionId,
      selectionKind,
      installMode,
      installerVersion,
      installedAt: ts,
      requestedBy,
    }],
  };

  const conflicts = [];
  for (const file of files) {
    const existing = next.managedFiles.find((f) => f.relPath === file.relPath);
    if (existing) {
      if (existing.sha256 !== file.sha256) {
        conflicts.push({ relPath: file.relPath, recorded: existing.sha256, incoming: file.sha256 });
        continue;
      }
      if (!existing.referencedBy.includes(selectionId)) existing.referencedBy.push(selectionId);
      if (Array.isArray(file.bundleMembership)) {
        const merged = new Set([...(existing.bundleMembership || []), ...file.bundleMembership]);
        existing.bundleMembership = [...merged];
      }
    } else {
      next.managedFiles.push({
        relPath: file.relPath,
        sha256: file.sha256,
        algo: file.algo || HASH_ALGO,
        normalization: file.normalization || HASH_NORMALIZATION,
        bytes: file.bytes,
        mode: file.mode || "0644",
        installedAt: ts,
        sourceRelPath: file.sourceRelPath || "",
        sourceCommit: file.sourceCommit ?? null,
        assetType: file.assetType,
        referencedBy: [selectionId],
        bundleMembership: Array.isArray(file.bundleMembership) ? [...file.bundleMembership] : [...bundleMembership],
      });
    }
  }

  if (conflicts.length > 0) {
    throw new StateError(`hash conflict for ${conflicts.length} file(s): ${conflicts.map((c) => c.relPath).join(", ")}`, ERR_HASH_CONFLICT);
  }

  return next;
}

export function applyUninstall(state, request) {
  const {
    selectionId,
    onDiskHashes = {},
    force = false,
    acceptModified = [],
    now,
  } = request;
  if (typeof selectionId !== "string" || !selectionId) throw new StateError("selectionId required", ERR_ARGS);
  const acceptSet = new Set(acceptModified);
  const inst = state.installations.find((i) => i.selectionId === selectionId);
  if (!inst) throw new StateError(`selection not installed: ${selectionId}`, ERR_NOT_INSTALLED);

  const ts = now || new Date().toISOString();
  const next = {
    ...state,
    updatedAt: ts,
    managedFiles: state.managedFiles.map((f) => ({ ...f, referencedBy: [...f.referencedBy] })),
    installations: state.installations.filter((i) => i.selectionId !== selectionId),
  };

  const toDelete = [];
  const blockedByModification = [];
  const blockedByMissingHash = [];
  const filtered = [];
  for (const f of next.managedFiles) {
    const refs = f.referencedBy.filter((id) => id !== selectionId);
    if (refs.length === 0) {
      const onDisk = onDiskHashes[f.relPath];
      if (onDisk === undefined) {
        if (force) {
          toDelete.push(f.relPath);
        } else {
          blockedByMissingHash.push(f.relPath);
          filtered.push({ ...f, referencedBy: f.referencedBy });
        }
      } else if (onDisk !== f.sha256) {
        if (force && acceptSet.has(f.relPath)) {
          toDelete.push(f.relPath);
        } else {
          blockedByModification.push({ relPath: f.relPath, recordedSha256: f.sha256, onDiskSha256: onDisk });
          filtered.push({ ...f, referencedBy: f.referencedBy });
        }
      } else {
        toDelete.push(f.relPath);
      }
    } else {
      filtered.push({ ...f, referencedBy: refs });
    }
  }

  if (blockedByModification.length > 0 || blockedByMissingHash.length > 0) {
    return {
      blocked: true,
      state,
      toDelete: [],
      blockedByModification,
      blockedByMissingHash,
    };
  }

  next.managedFiles = filtered;

  return {
    blocked: false,
    state: next,
    toDelete,
    blockedByModification: [],
    blockedByMissingHash: [],
  };
}

export function reinstallIsIdempotent(state, request) {
  const inst = state.installations.find((i) => i.selectionId === request.selectionId);
  if (!inst) return false;
  return state.managedFiles.every((f) => {
    if (!f.referencedBy.includes(request.selectionId)) return true;
    const file = (request.files || []).find((x) => x.relPath === f.relPath);
    return !file || file.sha256 === f.sha256;
  });
}
