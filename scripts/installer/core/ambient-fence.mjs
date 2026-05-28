import fs from "node:fs";
import path from "node:path";

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
// marker-shaped text. Trusted iff the managed-header sentinel appears between
// the markers. Round-2 P1#6 defense against adv-001 prose-marker collision.
function isFenceTrusted(fileText, productName) {
  const m = fileText.match(fenceRegex(productName));
  if (!m) return true; // No existing fence — nothing to overwrite, trivially safe.
  return m[0].includes(MANAGED_HEADER);
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
  // adv-004, retroactive fixup. Use lstat to detect the symlink without
  // following it.
  if (fs.existsSync(targetPath)) {
    const lstat = fs.lstatSync(targetPath);
    if (lstat.isSymbolicLink()) {
      throw new Error(
        `writeAmbientFence: refusing to write through symlink at ${targetPath}; resolve the symlink or move the file before activating`,
      );
    }
  }

  const fenceBlock = composeFenceBlock(productName, contentBlock);

  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, `${fenceBlock}\n`);
    if (logger?.info) logger.info(`ambient-fence: created ${targetPath}`);
    return { action: "created", changed: true, targetPath };
  }

  const before = fs.readFileSync(targetPath, "utf8");
  const re = fenceRegex(productName);

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
