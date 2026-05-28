import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";

import { ERR_LOCKED } from "./errors.mjs";

// CLI-agnostic ambient-context fence writer.
//
// Writes a marker-bracketed block into any text target file (typically
// `CLAUDE.md` or `AGENTS.md`), preserves fence blocks belonging to other
// products in the same file, and is byte-stable on idempotent re-run with
// identical content.
//
// Fence markers carry the product name so a single home `CLAUDE.md` can host
// fences from multiple coexisting nexel-managed products. The marker shape:
//
//   <!-- nexel:<productName>:begin -->
//   ...content...
//   <!-- nexel:<productName>:end -->
//
// Product names are matched literally — any regex metacharacter inside a
// product name is escaped before building the splice regex, so a product
// named `acme.skills` (or any other unusual but legal name) cannot inject
// regex behavior into another product's fence boundary.

const BEGIN_PREFIX = "<!-- nexel:";
const BEGIN_SUFFIX = ":begin -->";
const END_PREFIX = "<!-- nexel:";
const END_SUFFIX = ":end -->";

// Sentinel line written as the first line of every managed fence body. Its
// presence is verified before an existing fence is replaced — if the sentinel
// is missing, the fence is treated as user prose that happens to contain
// marker-shaped text and `writeAmbientFence` refuses to overwrite it. Defends
// against the adv-001 user-prose collision (round-2 P1#6 fixup).
const MANAGED_HEADER = "<!-- nexel-managed-fence v1; do not edit between markers -->";

// productName must be a single identifier-shaped token. Embedding newlines,
// whitespace, or shell-control chars in the fence marker `<!-- nexel:<name>:begin -->`
// would produce malformed HTML comment markers (review finding adv-005,
// retroactive fixup; mirrors the v0.7 ProductConfig field-validation pattern).
const PRODUCT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function assertSafeProductName(productName) {
  if (typeof productName !== "string" || !PRODUCT_NAME_PATTERN.test(productName)) {
    throw new TypeError(
      `writeAmbientFence: productName must match /${PRODUCT_NAME_PATTERN.source}/ (got: ${JSON.stringify(productName)})`,
    );
  }
}

function escapeRegex(literal) {
  return String(literal).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function beginMarker(productName) {
  return `${BEGIN_PREFIX}${productName}${BEGIN_SUFFIX}`;
}

function endMarker(productName) {
  return `${END_PREFIX}${productName}${END_SUFFIX}`;
}

function fenceRegex(productName) {
  const escaped = escapeRegex(productName);
  // Match the fence including surrounding optional newlines so a splice does
  // not leave double blank lines behind. Captures the entire fence including
  // markers for replacement.
  return new RegExp(
    `${escapeRegex(BEGIN_PREFIX)}${escaped}${escapeRegex(BEGIN_SUFFIX)}[\\s\\S]*?${escapeRegex(END_PREFIX)}${escaped}${escapeRegex(END_SUFFIX)}`,
  );
}

function composeFenceBlock(productName, contentBlock) {
  const trimmed = String(contentBlock ?? "").replace(/^\n+/, "").replace(/\n+$/, "");
  // MANAGED_HEADER is the first line of every fence body. Round-2 P1#6 defense.
  return `${beginMarker(productName)}\n${MANAGED_HEADER}\n${trimmed}\n${endMarker(productName)}`;
}

// Verify that an existing fence for `productName` in `fileText` was written
// by `writeAmbientFence` rather than being user prose that contains
// marker-shaped text. Trusted iff the managed-header sentinel appears as
// the FIRST line of the fence body (immediately after the begin marker).
//
// v0.8.1 shipped a substring (.includes) check which is bypassable: user
// prose containing the sentinel literal anywhere in the body would pass
// trust verification. v0.8.2 hardens to a positional check — the sentinel
// must occupy line 1 of the body. composeFenceBlock always emits it there.
function isFenceTrusted(fileText, productName) {
  const m = fileText.match(fenceRegex(productName));
  if (!m) return true; // No existing fence — nothing to overwrite, trivially safe.
  // Normalize CRLF → LF so editor-touched managed fences (e.g., opened in a
  // Windows editor that rewrote line endings) are still recognized as
  // trusted. v0.8.3 fix (#7 / C3): without this normalization the sentinel's
  // `\n` separator fails `startsWith` on CRLF files even though the
  // surrounding fence is structurally intact.
  const block = m[0].replace(/\r\n/g, "\n");
  // Expected shape inside the matched block:
  //   <begin-marker>\n<MANAGED_HEADER>\n...body...\n<end-marker>
  // Slice from the first newline after the begin marker; the sentinel must
  // be the immediate next line.
  const firstNewline = block.indexOf("\n");
  if (firstNewline < 0) return false;
  const afterBegin = block.slice(firstNewline + 1);
  return afterBegin.startsWith(`${MANAGED_HEADER}\n`);
}

/**
 * Idempotently inject or replace a fence block for `productName` in
 * `targetPath`. Other products' fences in the same file are preserved
 * byte-identically; surrounding user prose is preserved.
 *
 * Return shape: `{ action, changed, targetPath }` where action ∈ {
 *   "created" — target file did not exist; fence-only file was written
 *   "appended" — target file existed but had no fence for this product
 *   "updated" — target file already had a fence for this product (replaced)
 * }
 * `changed` is `true` whenever the file bytes differ post-write from
 * pre-write. For action "updated" with identical content the file is left
 * untouched (no `writeFileSync`) so file mtime stays stable on no-op runs.
 *
 * @param {Object} opts
 * @param {string} opts.targetPath   Absolute path to write into.
 * @param {string} opts.productName  Identifies the fence — must be non-empty.
 * @param {string} opts.contentBlock Inner content body (between markers).
 * @param {Object} [opts.logger]     Logger with optional `info` / `warn`.
 * @returns {{ action: "created"|"appended"|"updated", changed: boolean, targetPath: string }}
 */
export function writeAmbientFence({ targetPath, productName, contentBlock, logger }) {
  if (typeof targetPath !== "string" || !targetPath) {
    throw new TypeError("writeAmbientFence: targetPath must be a non-empty string");
  }
  assertSafeProductName(productName);
  if (typeof contentBlock !== "string") {
    throw new TypeError("writeAmbientFence: contentBlock must be a string");
  }

  // Refuse to mutate a symlinked target — writing through a symlink (e.g.,
  // `~/.claude/CLAUDE.md` → a sensitive file) would silently extend our
  // ambient-context fence into whatever the symlink points at. Review finding
  // adv-004. Use lstat to detect the symlink without following it.
  if (fs.existsSync(targetPath)) {
    const lstat = fs.lstatSync(targetPath);
    if (lstat.isSymbolicLink()) {
      throw new Error(
        `writeAmbientFence: refusing to write through symlink at ${targetPath}; resolve the symlink or move the file before activating`,
      );
    }
  }

  // Ensure parent dir exists before the lock — proper-lockfile creates a
  // sibling `<target>.lock` directory, which requires the parent dir of
  // targetPath to be present.
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  // v0.8.5 adv-r5-C symlink-at-lock DOS defense. If `<target>.lock` is a
  // symlink (typically a planted attack: ln -s /etc/hosts <target>.lock),
  // proper-lockfile's stale-cleanup never fires against it and every
  // subsequent activate is permanently blocked with ELOCKED. Mirror the
  // v0.8.3 symlink-at-target defense at the lock path before locking.
  const lockPath = `${targetPath}.lock`;
  if (fs.existsSync(lockPath)) {
    const lockLstat = fs.lstatSync(lockPath);
    if (lockLstat.isSymbolicLink()) {
      throw new Error(
        `writeAmbientFence: refusing to lock through a symlink at ${lockPath}; this is either a planted DOS or stale state. Remove the symlink manually and re-run.`,
      );
    }
  }

  // v0.8.4 #1 (adv-003) race defense: serialize concurrent activates
  // against the same target file. proper-lockfile (already a kernel dep,
  // used by core/filesystem.mjs for state.json locking) is the same lock
  // mechanism nexel uses elsewhere. realpath:false because targetPath may
  // not exist yet on first activation. No retries — sync API doesn't
  // support them; concurrent contention is rare (one user typing
  // `nexel activate`) and a clean error pointing at the lock file
  // (`<target>.lock`) is more actionable than silent backoff.
  //
  // v0.8.4 adv-r5-B: wrap vendor ELOCKED in typed ERR_LOCKED so the
  // failure surfaces through activate's --json envelope as ADR-0014
  // §3-aligned error code rather than leaking proper-lockfile's raw code.
  let release;
  try {
    release = lockfile.lockSync(targetPath, {
      realpath: false,
      stale: 10000, // ms — auto-release abandoned locks after 10s
    });
  } catch (e) {
    if (e && e.code === "ELOCKED") {
      const wrapped = new Error(
        `writeAmbientFence: another process is writing ${targetPath} (lock at ${targetPath}.lock); wait, or remove the lock dir if stale (>10s old)`,
      );
      wrapped.code = ERR_LOCKED;
      throw wrapped;
    }
    throw e;
  }
  try {
    return writeAmbientFenceLocked({ targetPath, productName, contentBlock, logger });
  } finally {
    release();
  }
}

function writeAmbientFenceLocked({ targetPath, productName, contentBlock, logger }) {
  const fenceBlock = composeFenceBlock(productName, contentBlock);

  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, `${fenceBlock}\n`);
    if (logger?.info) logger.info(`ambient-fence: created ${targetPath}`);
    return { action: "created", changed: true, targetPath };
  }

  const before = fs.readFileSync(targetPath, "utf8");
  const re = fenceRegex(productName);

  // adv-002 trusted-path orphan refusal (v0.8.3 #2). fenceRegex is non-global
  // and lazy — if the file contains, say, three BEGIN markers and one END
  // marker, the regex spans the FIRST BEGIN through the END, silently
  // engulfing the other two BEGINs (and the user prose between them) on
  // replace. v0.8.2 closed the orphan case on the append path; v0.8.3 closes
  // it on the trusted path by requiring exactly one BEGIN and exactly one
  // END marker for this product before allowing a splice.
  const beginCount = (before.match(new RegExp(escapeRegex(beginMarker(productName)), "g")) || []).length;
  const endCount = (before.match(new RegExp(escapeRegex(endMarker(productName)), "g")) || []).length;
  if (beginCount > 1 || endCount > 1 || beginCount !== endCount) {
    throw new Error(
      `writeAmbientFence: unbalanced fence markers for "${productName}" in ${targetPath} (${beginCount} BEGIN, ${endCount} END) — refusing to splice; would silently engulf prose between mismatched markers. Inspect and clean up the file manually before re-running.`,
    );
  }

  if (re.test(before)) {
    // P1#6 defense: refuse to overwrite a marker pair that lacks the
    // managed-header sentinel. The markers may be user prose copied from
    // documentation rather than a real prior `writeAmbientFence` output.
    if (!isFenceTrusted(before, productName)) {
      throw new Error(
        `writeAmbientFence: existing fence markers for "${productName}" in ${targetPath} lack the managed-header sentinel — refusing to overwrite what may be user prose. ` +
        `Inspect the file, remove the conflicting <!-- nexel:${productName}:begin/end --> markers manually, and re-run.`,
      );
    }
    const after = before.replace(re, fenceBlock);
    if (after === before) {
      if (logger?.info) logger.info(`ambient-fence: ${targetPath} unchanged (byte-identical)`);
      return { action: "updated", changed: false, targetPath };
    }
    fs.writeFileSync(targetPath, after);
    if (logger?.info) logger.info(`ambient-fence: updated fence for ${productName} in ${targetPath}`);
    return { action: "updated", changed: true, targetPath };
  }

  // adv-006 / v0.8.2 orphan-marker defense is now subsumed by the unbalanced-
  // marker count check above. By the time we reach this branch, beginCount
  // and endCount are both 0 — no orphan can exist for this product.

  // Append fence to end of file, ensuring exactly one blank line of
  // separation from any prior content. Always end with a single trailing
  // newline so subsequent appends remain well-formed.
  const trimmedExisting = before.replace(/\n+$/, "");
  const separator = trimmedExisting.length === 0 ? "" : "\n\n";
  const after = `${trimmedExisting}${separator}${fenceBlock}\n`;
  fs.writeFileSync(targetPath, after);
  if (logger?.info) logger.info(`ambient-fence: appended fence for ${productName} to ${targetPath}`);
  return { action: "appended", changed: true, targetPath };
}

// Exported for callers that need to detect a fence without rewriting.
export function hasAmbientFence(targetPath, productName) {
  if (!fs.existsSync(targetPath)) return false;
  const text = fs.readFileSync(targetPath, "utf8");
  return fenceRegex(productName).test(text);
}

/**
 * Idempotently remove the fence block written for `productName` from
 * `targetPath`. Exact-invert of `writeAmbientFence`: only THIS product's
 * fence is spliced; other products' fences in the same file remain
 * byte-identical (per-product isolation invariant, ADR-0017 / INTERLOCK
 * LOCK 1; locked by `ambient-fence.test.mjs` multi-product witnesses).
 *
 * Return shape mirrors `writeAmbientFence`: `{ action, changed, targetPath, reason? }`:
 *   action ∈ {
 *     "removed" — fence existed and was spliced out (changed: true)
 *     "noop"    — nothing to remove (file missing OR no fence for this product)
 *   }
 *   `reason` (string) accompanies `noop` to disambiguate the cause.
 *
 * Lock semantics: re-uses `<target>.lock` via proper-lockfile so concurrent
 * activate+deactivate against one target serialize through one lock.
 *
 * Symlink defenses mirror `writeAmbientFence` (adv-004 target-symlink refusal,
 * adv-r5-C v0.8.5 lock-symlink DOS defense). TOCTOU defense follow-up
 * (ADR-0019 / PR 4) will harden the lstat→lockSync race on both write and
 * remove paths uniformly.
 *
 * @param {Object} opts
 * @param {string} opts.targetPath   Absolute path to splice the fence out of.
 * @param {string} opts.productName  Identifies the fence — must be non-empty.
 * @param {Object} [opts.logger]     Logger with optional `info` / `warn`.
 * @returns {{ action: "removed"|"noop", changed: boolean, targetPath: string, reason?: string }}
 */
export function removeAmbientFence({ targetPath, productName, logger }) {
  if (typeof targetPath !== "string" || !targetPath) {
    throw new TypeError("removeAmbientFence: targetPath must be a non-empty string");
  }
  assertSafeProductName(productName);

  // Missing host file → nothing to remove. Symmetric with hasAmbientFence's
  // missing-file handling (returns false rather than throwing).
  if (!fs.existsSync(targetPath)) {
    return { action: "noop", changed: false, targetPath, reason: "host file does not exist" };
  }

  // Target-symlink refusal (adv-004 parity with writeAmbientFence:142-149).
  // Without this, deactivate through a symlink would mutate whatever the
  // symlink resolves to — same threat model as the activate side.
  const targetLstat = fs.lstatSync(targetPath);
  if (targetLstat.isSymbolicLink()) {
    throw new Error(
      `removeAmbientFence: refusing to write through symlink at ${targetPath}; resolve the symlink or move the file before deactivating`,
    );
  }

  // Lock-symlink defense (adv-r5-C parity with writeAmbientFence:161-169).
  // Mirror the v0.8.5 symlink-at-lock DOS defense on the remove path so a
  // planted lock symlink cannot permanently block deactivate either.
  const lockPath = `${targetPath}.lock`;
  if (fs.existsSync(lockPath)) {
    const lockLstat = fs.lstatSync(lockPath);
    if (lockLstat.isSymbolicLink()) {
      throw new Error(
        `removeAmbientFence: refusing to lock through a symlink at ${lockPath}; this is either a planted DOS or stale state. Remove the symlink manually and re-run.`,
      );
    }
  }

  // proper-lockfile reuse: same lock path as writeAmbientFence so concurrent
  // activate+deactivate against the same target serialize. realpath:false
  // because targetPath already exists at this point (no follow-symlink).
  let release;
  try {
    release = lockfile.lockSync(targetPath, {
      realpath: false,
      stale: 10000,
    });
  } catch (e) {
    if (e && e.code === "ELOCKED") {
      const wrapped = new Error(
        `removeAmbientFence: another process is writing ${targetPath} (lock at ${targetPath}.lock); wait, or remove the lock dir if stale (>10s old)`,
      );
      wrapped.code = ERR_LOCKED;
      throw wrapped;
    }
    throw e;
  }

  try {
    const before = fs.readFileSync(targetPath, "utf8");
    const re = fenceRegex(productName);
    const match = before.match(re);
    if (!match) {
      if (logger?.info) logger.info(`ambient-fence: ${targetPath} has no fence for ${productName} (noop)`);
      return { action: "noop", changed: false, targetPath, reason: "no fence for this product" };
    }

    // adv-002 parity: unbalanced-marker guard. writeAmbientFence:226-232
    // refuses to splice when begin/end counts diverge or exceed 1; the same
    // class of orphan markers is a data-loss landmine on the remove path —
    // a lazy fenceRegex match would silently engulf prose between the
    // mismatched markers. Mirror the refusal.
    const beginCount = (before.match(new RegExp(escapeRegex(beginMarker(productName)), "g")) || []).length;
    const endCount = (before.match(new RegExp(escapeRegex(endMarker(productName)), "g")) || []).length;
    if (beginCount > 1 || endCount > 1 || beginCount !== endCount) {
      throw new Error(
        `removeAmbientFence: unbalanced fence markers for "${productName}" in ${targetPath} (${beginCount} BEGIN, ${endCount} END) — refusing to splice; would silently engulf prose between mismatched markers. Inspect and clean up the file manually before re-running.`,
      );
    }

    // P1#6 parity: isFenceTrusted check. writeAmbientFence:238 refuses to
    // overwrite a marker pair lacking the managed-header sentinel, because
    // the markers may be user prose that coincidentally matches. Mirror on
    // the remove path so user prose enclosed in literal nexel-shaped
    // markers (e.g., a copy-pasted example) is not silently deleted.
    if (!isFenceTrusted(before, productName)) {
      throw new Error(
        `removeAmbientFence: fence for "${productName}" in ${targetPath} is missing the managed-header sentinel (${MANAGED_HEADER.trim()}) — refusing to splice; this fence was not written by writeAmbientFence and may be user prose. Inspect manually before re-running.`,
      );
    }

    // Splice the fence + the surrounding separator bytes the write path
    // emitted. writeAmbientFence's append branch emits "\n\n" before the
    // fence (when prior content exists) and "\n" after; the created branch
    // emits only "\n" after. Strip these to keep the file tidy.
    const fenceStart = match.index;
    const fenceEnd = fenceStart + match[0].length;

    let cutStart = fenceStart;
    if (fenceStart >= 2 && before.slice(fenceStart - 2, fenceStart) === "\n\n") {
      cutStart = fenceStart - 2;
    }
    let cutEnd = fenceEnd;
    if (before[fenceEnd] === "\n") {
      cutEnd = fenceEnd + 1;
    }

    // Phase 4 P1 fix: collapse only the seam left at cutStart, not globally.
    // The original global `replace(/\n{3,}/g, "\n\n")` mutated runs of 3+
    // newlines in unrelated user prose. Targeted normalization at the
    // splice site preserves byte-identity elsewhere in the file.
    let after = before.slice(0, cutStart) + before.slice(cutEnd);
    if (cutStart > 0 && cutStart < after.length) {
      const seamStart = Math.max(0, cutStart - 2);
      const seamEnd = Math.min(after.length, cutStart + 2);
      const seam = after.slice(seamStart, seamEnd);
      const normalized = seam.replace(/\n{3,}/g, "\n\n");
      if (normalized !== seam) {
        after = after.slice(0, seamStart) + normalized + after.slice(seamEnd);
      }
    }

    fs.writeFileSync(targetPath, after);
    if (logger?.info) logger.info(`ambient-fence: removed fence for ${productName} from ${targetPath}`);
    return { action: "removed", changed: true, targetPath };
  } finally {
    release();
  }
}
