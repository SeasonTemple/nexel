import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

import writeFileAtomic from "write-file-atomic";
import lockfile from "proper-lockfile";

import {
  HASH_ALGO,
  HASH_NORMALIZATION,
  StateError,
  validateState,
} from "./state.mjs";
import {
  ERR_PATH,
  ERR_PATH_ESCAPE,
  ERR_SYMLINK,
  ERR_LOCKED,
  ERR_STATE_PARSE,
  ERR_INVALID_STATE,
} from "./errors.mjs";

export const TEXT_EXTENSIONS = Object.freeze([".md", ".json", ".mjs", ".js", ".yaml", ".yml", ".txt"]);
const TEXT_EXT_SET = new Set(TEXT_EXTENSIONS);

export const STATE_DIRNAME = ".nexel";
export const STATE_FILE = "state.json";
export const STATE_BAK = "state.json.bak";
export const STATE_TMP = "state.json.tmp";
export const STATE_BAK_TMP = "state.json.bak.tmp";
export const LOCK_FILE = ".lock";
export const STAGING_PREFIX = ".staging-";
export const STALE_LOCK_MS = 60_000;

export class FsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "FsError";
    this.code = code;
  }
}

export function isLikelyText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXT_SET.has(ext);
}

export function looksLikeBinary(buf) {
  for (let i = 0; i < Math.min(buf.length, 8000); i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export function normalizeTextBytes(buf) {
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    start = 3;
  }
  const out = [];
  for (let i = start; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0d) {
      if (i + 1 < buf.length && buf[i + 1] === 0x0a) continue;
      out.push(0x0a);
      continue;
    }
    out.push(b);
  }
  return Buffer.from(out);
}

export function hashBytes(buf, { extension, forceByteExact } = {}) {
  if (forceByteExact || (extension !== undefined && !TEXT_EXT_SET.has(extension.toLowerCase()))) {
    return {
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      algo: HASH_ALGO,
      normalization: "byte-exact",
      bytes: buf.length,
    };
  }
  if (looksLikeBinary(buf)) {
    return {
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      algo: HASH_ALGO,
      normalization: "byte-exact",
      bytes: buf.length,
    };
  }
  const normalized = normalizeTextBytes(buf);
  return {
    sha256: crypto.createHash("sha256").update(normalized).digest("hex"),
    algo: HASH_ALGO,
    normalization: HASH_NORMALIZATION,
    bytes: buf.length,
  };
}

export function hashFile(absPath) {
  const buf = fs.readFileSync(absPath);
  return hashBytes(buf, { extension: path.extname(absPath) });
}

export async function hashFileAsync(absPath) {
  const buf = await fsp.readFile(absPath);
  return hashBytes(buf, { extension: path.extname(absPath) });
}

export function assertPathInsideRoot(root, target) {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(target);
  const rel = path.relative(absRoot, absTarget);
  if (rel === "" || rel === "." || (!rel.startsWith("..") && !path.isAbsolute(rel))) return absTarget;
  throw new FsError(`path escapes root: ${target} (root: ${root})`, ERR_PATH_ESCAPE);
}

export function assertNoSymlinkOnPath(absPath, root) {
  assertPathInsideRoot(root, absPath);
  const segments = path.relative(root, absPath).split(path.sep).filter(Boolean);
  let cur = path.resolve(root);
  for (const seg of segments) {
    cur = path.join(cur, seg);
    if (!fs.existsSync(cur)) return;
    const stat = fs.lstatSync(cur);
    if (stat.isSymbolicLink()) {
      throw new FsError(`symlink not allowed in target path: ${cur}`, ERR_SYMLINK);
    }
  }
}

export function stateDirFor(targetRoot) {
  return path.join(targetRoot, STATE_DIRNAME);
}

export function ensureStateDir(targetRoot) {
  const dir = stateDirFor(targetRoot);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function acquireLock(targetRoot, { staleMs = STALE_LOCK_MS, command = "unknown", installerVersion = "0.0.0" } = {}) {
  const dir = ensureStateDir(targetRoot);
  let release;
  try {
    release = await lockfile.lock(dir, {
      stale: staleMs,
      retries: { retries: 0 },
      lockfilePath: path.join(dir, LOCK_FILE),
    });
  } catch (e) {
    if (e.code === "ELOCKED") {
      throw new FsError(`target already locked by another run; lockfile at ${path.join(dir, LOCK_FILE)}`, ERR_LOCKED);
    }
    throw e;
  }
  try {
    fs.writeFileSync(
      path.join(dir, LOCK_FILE + ".meta"),
      JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), command, installerVersion }, null, 2)
    );
  } catch {}
  return async () => {
    try {
      fs.unlinkSync(path.join(dir, LOCK_FILE + ".meta"));
    } catch {}
    await release();
  };
}

export function readState(targetRoot) {
  const dir = stateDirFor(targetRoot);
  const file = path.join(dir, STATE_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(stripBom(raw));
  } catch (e) {
    throw new FsError(`failed to parse state.json: ${e.message}`, ERR_STATE_PARSE);
  }
}

function stripBom(s) {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export async function writeStateAtomic(targetRoot, state) {
  const findings = validateState(state);
  if (findings.length > 0) {
    throw new StateError(`refusing to write invalid state: ${findings[0].path} — ${findings[0].message}`, ERR_INVALID_STATE);
  }
  const dir = ensureStateDir(targetRoot);
  const file = path.join(dir, STATE_FILE);
  const payload = JSON.stringify(state, null, 2) + "\n";
  await writeFileAtomic(file, payload, { mode: 0o600, fsync: true });
}

export function snapshotStateBak(targetRoot) {
  const dir = stateDirFor(targetRoot);
  const file = path.join(dir, STATE_FILE);
  const bak = path.join(dir, STATE_BAK);
  const bakTmp = path.join(dir, STATE_BAK_TMP);
  if (!fs.existsSync(file)) return null;
  fs.copyFileSync(file, bakTmp);
  const fd = fs.openSync(bakTmp, "r");
  try {
    fs.fsyncSync(fd);
  } catch {}
  fs.closeSync(fd);
  fs.renameSync(bakTmp, bak);
  return bak;
}

export function recoverySweep(targetRoot) {
  const dir = stateDirFor(targetRoot);
  if (!fs.existsSync(dir)) return { actions: [], orphans: [] };
  const actions = [];
  const orphans = [];

  const stateFile = path.join(dir, STATE_FILE);
  const tmp = path.join(dir, STATE_TMP);
  const bak = path.join(dir, STATE_BAK);

  if (fs.existsSync(tmp) && !fs.existsSync(stateFile)) {
    try {
      const raw = fs.readFileSync(tmp, "utf8");
      const parsed = JSON.parse(stripBom(raw));
      const findings = validateState(parsed);
      if (findings.length === 0) {
        fs.renameSync(tmp, stateFile);
        actions.push({ type: "promote-tmp", path: stateFile });
      } else if (fs.existsSync(bak)) {
        fs.copyFileSync(bak, stateFile);
        fs.unlinkSync(tmp);
        actions.push({ type: "restore-from-bak", path: stateFile });
      } else {
        fs.unlinkSync(tmp);
        actions.push({ type: "discard-bad-tmp", path: tmp });
      }
    } catch (e) {
      if (fs.existsSync(bak)) {
        fs.copyFileSync(bak, stateFile);
        fs.unlinkSync(tmp);
        actions.push({ type: "restore-from-bak", path: stateFile, reason: e.message });
      }
    }
  }

  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(STAGING_PREFIX)) {
      const orphan = path.join(dir, entry);
      try {
        fs.rmSync(orphan, { recursive: true, force: true });
        actions.push({ type: "delete-staging", path: orphan });
      } catch (e) {
        actions.push({ type: "staging-cleanup-failed", path: orphan, reason: e.message });
      }
    }
  }

  if (fs.existsSync(bak) && fs.existsSync(stateFile)) {
    try {
      fs.unlinkSync(bak);
      actions.push({ type: "delete-stale-bak", path: bak });
    } catch {}
  }

  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(stripBom(fs.readFileSync(stateFile, "utf8")));
      const recordedSet = new Set((state.managedFiles || []).map((f) => f.relPath));
      // walk for orphans is intentionally skipped — auto-walk is unsafe. Reported via list command only.
      void recordedSet;
    } catch {}
  }

  return { actions, orphans };
}

export function makeStagingDir(targetRoot, runId = process.pid + "-" + Date.now()) {
  const dir = ensureStateDir(targetRoot);
  const staging = path.join(dir, `${STAGING_PREFIX}${runId}`);
  fs.mkdirSync(staging, { recursive: true });
  return staging;
}

export function stageWrite(stagingDir, relPath, content) {
  if (path.isAbsolute(relPath)) throw new FsError(`relPath must be relative: ${relPath}`, ERR_PATH);
  if (relPath.split(/[\\/]/).includes("..")) throw new FsError(`relPath traversal blocked: ${relPath}`, ERR_PATH_ESCAPE);
  const dest = path.join(stagingDir, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  const fd = fs.openSync(dest, "r");
  try {
    fs.fsyncSync(fd);
  } catch {}
  fs.closeSync(fd);
  return dest;
}

export function promoteStagedFiles(stagingDir, targetRoot, relPaths) {
  const promoted = [];
  for (const rel of relPaths) {
    const src = path.join(stagingDir, rel);
    const dst = path.join(targetRoot, rel);
    assertPathInsideRoot(targetRoot, dst);
    assertNoSymlinkOnPath(path.dirname(dst), targetRoot);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    promoted.push(dst);
  }
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch {}
  return promoted;
}

export function deleteFiles(targetRoot, relPaths) {
  const deleted = [];
  for (const rel of relPaths) {
    const dst = path.join(targetRoot, rel);
    try {
      assertPathInsideRoot(targetRoot, dst);
    } catch {
      continue;
    }
    if (fs.existsSync(dst)) {
      fs.unlinkSync(dst);
      deleted.push(dst);
      pruneEmptyDirs(targetRoot, path.dirname(dst));
    }
  }
  return deleted;
}

function pruneEmptyDirs(root, dir) {
  try {
    let cur = dir;
    while (cur && cur !== root && cur.startsWith(root)) {
      const items = fs.readdirSync(cur);
      if (items.length > 0) break;
      fs.rmdirSync(cur);
      cur = path.dirname(cur);
    }
  } catch {}
}
