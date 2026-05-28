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
  return `${beginMarker(productName)}\n${trimmed}\n${endMarker(productName)}`;
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
  if (typeof productName !== "string" || !productName) {
    throw new TypeError("writeAmbientFence: productName must be a non-empty string");
  }
  if (typeof contentBlock !== "string") {
    throw new TypeError("writeAmbientFence: contentBlock must be a string");
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
