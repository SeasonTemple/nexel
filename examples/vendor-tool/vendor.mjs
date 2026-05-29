// @nexel/vendor — core library (MVP scaffold).
//
// Vendor skills from a LOCAL upstream path into a consuming product's skills
// dir, with a `.vendored.json` provenance sidecar that enables drift
// detection and safe re-pull.
//
// Design notes (see docs/plans/2026-05-29-002-...):
//   - `originHash` is a TOOL-PRIVATE sha256 over the *rewritten* payload, NOT
//     the kernel's content hash. This keeps the kernel public API surface
//     untouched (the headline "kernel zero changes" property). The sidecar
//     hash only ever compares sidecar↔origin (a different axis from the
//     kernel's state.json tamper hash), so parity is not needed.
//   - Frontmatter `name:` rewrite is SURGICAL (single-line regex), so every
//     other byte of the upstream SKILL.md is preserved verbatim. We do not
//     round-trip the YAML (which would reorder keys / drop comments).
//   - This module performs no kernel imports. For the local-path MVP it needs
//     nothing from `installer/index.mjs`; the consuming product's identity
//     (`skillIdPrefix`, skills dir) is supplied by the caller.
//
// Pure-ish layering: `planPull` / `planDiff` only READ; `applyPull` / `fork`
// WRITE. The CLI composes them and decides exit codes — the library returns
// data, never calls process.exit.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const SIDECAR_NAME = ".vendored.json";
export const SIDECAR_SCHEMA = 1;
export const DEFAULT_DIVERGENCE_POLICY = "manual-merge";

// ---------------------------------------------------------------------------
// Payload IO
// ---------------------------------------------------------------------------

/**
 * Recursively list a directory's files as {relpath, bytes}, with posix
 * relpaths, sorted lexicographically. Excludes the sidecar (self-reference).
 */
export function readPayload(dir) {
  const out = [];
  function walk(abs, rel) {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (childRel === SIDECAR_NAME) continue;
      out.push({ relpath: childRel, bytes: fs.readFileSync(childAbs) });
    }
  }
  walk(dir, "");
  out.sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0));
  return out;
}

/**
 * Tool-private deterministic content hash of a payload. Order-independent
 * (caller-sorted, but we re-sort defensively) and cross-platform (posix
 * relpaths). NOT the kernel hash.
 */
export function hashPayload(files) {
  const sorted = [...files]
    .filter((f) => f.relpath !== SIDECAR_NAME)
    .sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0));
  const h = crypto.createHash("sha256");
  for (const f of sorted) {
    h.update(`${f.relpath}\n`);
    h.update(f.bytes);
    h.update("\n");
  }
  return h.digest("hex");
}

/**
 * Replace the payload on disk under `dir` with `files`, preserving any
 * existing sidecar. Prunes on-disk payload files that are absent from the new
 * payload (true sync, so an upstream deletion propagates on fast-forward).
 */
export function writePayload(dir, files) {
  if (fs.existsSync(dir)) {
    for (const existing of readPayload(dir)) {
      fs.rmSync(path.join(dir, existing.relpath), { force: true });
    }
  }
  for (const f of files) {
    const dest = path.join(dir, f.relpath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.bytes);
  }
  pruneEmptyDirs(dir);
}

function pruneEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    pruneEmptyDirs(child);
    if (fs.readdirSync(child).length === 0) fs.rmdirSync(child);
  }
}

// ---------------------------------------------------------------------------
// Frontmatter name rewrite (surgical, byte-preserving elsewhere)
// ---------------------------------------------------------------------------

/**
 * Locate the frontmatter content (the text BETWEEN the opening and closing
 * `---` fences) as a raw [start, end) byte range, or null when there is no
 * well-formed frontmatter block. EOL-agnostic (LF or CRLF). Operating on the
 * raw range — rather than split/join on "\n" — is what lets rewriteName
 * preserve every byte outside the single `name:` line (CRLF, blank lines, the
 * separator after the closing fence).
 */
function frontmatterRange(text) {
  const open = text.match(/^---[ \t]*\r?\n/);
  if (!open) return null;
  const start = open[0].length;
  // Closing fence: a line that is exactly `---` (with optional trailing
  // spaces), at start-of-content or after a newline, ending in a newline or EOF.
  const after = text.slice(start);
  const close = after.match(/(^|\r?\n)---[ \t]*(\r?\n|$)/);
  if (!close) return null;
  const end = start + close.index + (close[1] ? close[1].length : 0);
  return { start, end };
}

/** Read the `name:` value from a frontmatter block (or null). Tolerates
 * surrounding quotes, internal apostrophes, and a trailing CR. */
export function readName(frontmatter) {
  const m = frontmatter.match(/^name:[ \t]*(.*?)[ \t\r]*$/m);
  if (!m) return null;
  let v = m[1];
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v || null;
}

/**
 * Surgically rewrite the `name:` frontmatter value to `fullName`, leaving
 * every other byte unchanged (line endings, blank lines, body). Throws if
 * there is no frontmatter or no `name:`.
 */
export function rewriteName(text, fullName) {
  const range = frontmatterRange(text);
  if (!range) {
    throw new VendorError("ERR_NO_FRONTMATTER", "SKILL.md has no YAML frontmatter block");
  }
  const fm = text.slice(range.start, range.end);
  if (readName(fm) === null) {
    throw new VendorError("ERR_NO_NAME", "SKILL.md frontmatter has no `name:` field");
  }
  // Replace only the name line's value; preserve the line's own CR (CRLF).
  const newFm = fm.replace(/^(name:)[ \t]*[^\r\n]*(\r?)$/m, `$1 ${fullName}$2`);
  return text.slice(0, range.start) + newFm + text.slice(range.end);
}

/**
 * Apply the consuming product's prefix rewrite to a payload's SKILL.md.
 * Returns a NEW payload array; non-SKILL.md files pass through untouched.
 */
export function rewritePayload(files, { skillIdPrefix, as }) {
  const fullName = `${skillIdPrefix}:${as}`;
  return files.map((f) => {
    if (f.relpath !== "SKILL.md") return f;
    const rewritten = rewriteName(f.bytes.toString("utf8"), fullName);
    return { relpath: f.relpath, bytes: Buffer.from(rewritten, "utf8") };
  });
}

// ---------------------------------------------------------------------------
// Sidecar
// ---------------------------------------------------------------------------

export function sidecarPath(targetDir) {
  return path.join(targetDir, SIDECAR_NAME);
}

export function readSidecar(targetDir) {
  const p = sidecarPath(targetDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    throw new VendorError("ERR_BAD_SIDECAR", `corrupt ${SIDECAR_NAME}: ${e.message}`);
  }
}

export function writeSidecar(targetDir, sidecar) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(sidecarPath(targetDir), `${JSON.stringify(sidecar, null, 2)}\n`);
}

function buildSidecar(entry, ctx, originHash, vendoredAt) {
  return {
    schema: SIDECAR_SCHEMA,
    originUri: originUriOf(entry),
    originHash,
    vendoredAt,
    divergencePolicy: entry.divergencePolicy || DEFAULT_DIVERGENCE_POLICY,
    supersedes: entry.supersedes ?? null,
    rewrite: { namePrefix: ctx.skillIdPrefix, as: entry.as },
  };
}

function originUriOf(entry) {
  const abs = path.resolve(entry.source);
  return `file://${abs}#${entry.path}`;
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/** Resolve `child` under `root` and assert it stays inside `root`. */
function resolveContained(root, child, label) {
  const r = path.resolve(root);
  const resolved = path.resolve(r, child);
  if (resolved !== r && !resolved.startsWith(r + path.sep)) {
    throw new VendorError("ERR_UNSAFE_PATH", `${label} escapes ${root}: ${child}`);
  }
  return resolved;
}

function originDirOf(entry) {
  if (path.isAbsolute(entry.path)) {
    throw new VendorError("ERR_UNSAFE_PATH", `entry.path must be relative to source: ${entry.path}`);
  }
  // Defense-in-depth even though source/path are config-authored: a typo or a
  // pasted-in third-party vendorFrom entry must not read outside the upstream.
  return resolveContained(entry.source, entry.path, "entry.path");
}

function targetDirOf(entry, ctx) {
  // `as` is a single skill dirname — never a path. Reject separators / traversal
  // so it cannot escape targetSkillsDir on write/delete (path.join does NOT
  // contain `..`).
  if (!entry.as || /[\\/]/.test(entry.as) || entry.as === "." || entry.as === "..") {
    throw new VendorError("ERR_UNSAFE_AS", `entry.as must be a single dirname: ${entry.as}`);
  }
  return resolveContained(ctx.targetSkillsDir, entry.as, "entry.as");
}

/** Read + rewrite the origin payload, returning {files, originHash}. */
function resolveOrigin(entry, ctx) {
  const originDir = originDirOf(entry);
  if (!fs.existsSync(originDir)) {
    throw new VendorError("ERR_NO_ORIGIN", `origin path does not exist: ${originDir}`);
  }
  const raw = readPayload(originDir);
  if (!raw.some((f) => f.relpath === "SKILL.md")) {
    throw new VendorError("ERR_NO_SKILL_MD", `origin has no SKILL.md: ${originDir}`);
  }
  const files = rewritePayload(raw, { skillIdPrefix: ctx.skillIdPrefix, as: entry.as });
  return { files, originHash: hashPayload(files) };
}

// ---------------------------------------------------------------------------
// pull
// ---------------------------------------------------------------------------

/**
 * Compute the pull decision WITHOUT writing. Returns:
 *   { as, action, originHash, files, sidecar?, localChanged?, originChanged?,
 *     attribution?, diff? }
 * action ∈ "fresh" | "up-to-date" | "fast-forward" | "conflict"
 */
export function planPull(entry, ctx) {
  const as = entry.as;
  const { files, originHash } = resolveOrigin(entry, ctx);
  const targetDir = targetDirOf(entry, ctx);
  const sidecar = readSidecar(targetDir);

  if (!sidecar) {
    // No provenance. If the target dir already holds content (e.g. an
    // interrupted earlier pull, or a hand-placed skill), refuse rather than
    // silently clobber it — a "fresh" overwrite here is the crash-orphan
    // data-loss hole.
    if (fs.existsSync(targetDir) && readPayload(targetDir).length > 0) {
      return { as, action: "untracked", originHash, files };
    }
    return { as, action: "fresh", originHash, files };
  }

  const onDiskFiles = readPayload(targetDir);
  const onDiskHash = hashPayload(onDiskFiles);

  // On-disk already equals the new origin (re-converged, or a prior FF whose
  // sidecar is stale). Not a conflict — at most refresh the sidecar.
  if (onDiskHash === originHash) {
    return sidecar.originHash === originHash
      ? { as, action: "up-to-date", originHash, files, sidecar }
      : { as, action: "fast-forward", originHash, files, sidecar, originChanged: true };
  }

  const localChanged = onDiskHash !== sidecar.originHash;
  const originChanged = originHash !== sidecar.originHash;

  if (!localChanged) {
    // on-disk == sidecar, and on-disk != origin ⇒ origin moved ⇒ fast-forward.
    return { as, action: "fast-forward", originHash, files, sidecar, originChanged };
  }

  // localChanged and on-disk != origin ⇒ genuine divergence (manual-merge).
  const attribution = originChanged ? "both" : "local-only";
  const diff = diffPayloads(onDiskFiles, files);
  return {
    as,
    action: "conflict",
    originHash,
    files,
    sidecar,
    localChanged,
    originChanged,
    attribution,
    policy: sidecar.divergencePolicy || DEFAULT_DIVERGENCE_POLICY,
    diff,
  };
}

/** Execute a non-conflict pull decision (writes payload + sidecar). */
export function applyPull(entry, ctx, decision, vendoredAt) {
  const targetDir = targetDirOf(entry, ctx);
  if (decision.action === "up-to-date") return decision;
  if (decision.action === "conflict") {
    throw new VendorError("ERR_CONFLICT", `refusing to overwrite local changes in ${entry.as}`);
  }
  if (decision.action === "untracked") {
    throw new VendorError(
      "ERR_UNTRACKED",
      `${entry.as} exists but is not vendored; refusing to overwrite (remove it or fork first)`,
    );
  }
  writePayload(targetDir, decision.files);
  writeSidecar(targetDir, buildSidecar(entry, ctx, decision.originHash, vendoredAt));
  return decision;
}

// Decisions that never write.
const NON_APPLYING = new Set(["up-to-date", "conflict", "untracked"]);

/** Convenience: plan + (unless dryRun / non-applying) apply. */
export function pull(entry, ctx, { dryRun = false, vendoredAt } = {}) {
  const decision = planPull(entry, ctx);
  if (dryRun || NON_APPLYING.has(decision.action)) {
    return decision;
  }
  return applyPull(entry, ctx, decision, vendoredAt ?? new Date().toISOString());
}

// ---------------------------------------------------------------------------
// diff (read-only: origin-new vs on-disk-local)
// ---------------------------------------------------------------------------

export function planDiff(entry, ctx) {
  const as = entry.as;
  const { files, originHash } = resolveOrigin(entry, ctx);
  const targetDir = targetDirOf(entry, ctx);
  if (!fs.existsSync(targetDir) || !fs.existsSync(sidecarPath(targetDir))) {
    return { as, action: "not-vendored", originHash };
  }
  const onDisk = readPayload(targetDir);
  const diff = diffPayloads(onDisk, files);
  return { as, action: diff ? "differs" : "clean", diff, originHash };
}

// ---------------------------------------------------------------------------
// fork (cut the umbilical: remove sidecar, keep payload)
// ---------------------------------------------------------------------------

export function fork(entry, ctx) {
  const targetDir = targetDirOf(entry, ctx);
  // Existence check (not readSidecar): fork must succeed even when the sidecar
  // is corrupt — cutting the umbilical is exactly what you want then.
  if (!fs.existsSync(sidecarPath(targetDir))) {
    throw new VendorError("ERR_NOT_VENDORED", `${entry.as} is not vendored (no ${SIDECAR_NAME})`);
  }
  fs.rmSync(sidecarPath(targetDir), { force: true });
  return { as: entry.as, action: "forked" };
}

// ---------------------------------------------------------------------------
// Diff rendering (self-contained LCS line diff; no npm dep, no git shell-out)
// ---------------------------------------------------------------------------

/** Unified-ish diff of two payloads keyed by relpath. Returns null if equal. */
export function diffPayloads(localFiles, originFiles) {
  const byPath = (arr) => new Map(arr.map((f) => [f.relpath, f.bytes]));
  const local = byPath(localFiles);
  const origin = byPath(originFiles);
  const paths = [...new Set([...local.keys(), ...origin.keys()])].sort();
  const chunks = [];
  for (const p of paths) {
    const a = local.has(p) ? local.get(p).toString("utf8") : null;
    const b = origin.has(p) ? origin.get(p).toString("utf8") : null;
    if (a === b) continue;
    if (a === null) {
      chunks.push(`--- ${p} (local: absent)\n+++ ${p} (origin)\n` + addAll(b));
    } else if (b === null) {
      chunks.push(`--- ${p} (local)\n+++ ${p} (origin: absent)\n` + removeAll(a));
    } else {
      chunks.push(`--- ${p} (local)\n+++ ${p} (origin)\n` + diffLines(a, b));
    }
  }
  return chunks.length ? chunks.join("\n") : null;
}

function addAll(s) {
  return s.split("\n").map((l) => `+${l}`).join("\n");
}
function removeAll(s) {
  return s.split("\n").map((l) => `-${l}`).join("\n");
}

/** Minimal LCS-based line diff. */
export function diffLines(aText, bText) {
  const a = aText.split("\n");
  const b = bText.split("\n");
  const n = a.length;
  const m = b.length;
  // LCS length table.
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`-${a[i++]}`);
    } else {
      out.push(`+${b[j++]}`);
    }
  }
  while (i < n) out.push(`-${a[i++]}`);
  while (j < m) out.push(`+${b[j++]}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class VendorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VendorError";
    this.code = code;
  }
}
