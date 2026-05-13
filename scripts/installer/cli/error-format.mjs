// CLI-level error formatting helpers. Reads structured errors from the
// kernel (CommandError, AdapterError, FsError, etc.) and renders to
// stdout/stderr in the shape the user (or a JSON consumer) expects.
//
// Pure: no env reads, no I/O beyond writing to the supplied streams.
// productConfig is not needed here — error codes and messages are
// product-agnostic kernel concepts.

import { CommandError } from "./commands/index.mjs";
import { strings } from "./strings.mjs";

/**
 * Render a single error to the appropriate stream. JSON mode writes a
 * structured envelope to stdout; text mode writes a one-liner to stderr.
 *
 * @param {Error} e                   Any error thrown by main() / runX
 * @param {Object} args               Parsed args; reads `json` flag
 * @param {Object} [streams]          Override for tests
 * @param {NodeJS.WriteStream} [streams.stdout=process.stdout]
 * @param {NodeJS.WriteStream} [streams.stderr=process.stderr]
 * @param {NodeJS.ProcessEnv} [streams.env=process.env]  Reads DEBUG to print stack
 */
export function handleError(e, args, { stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  if (e instanceof CommandError) {
    if (args.json) {
      stdout.write(JSON.stringify({ ok: false, error: e.code, message: e.message, details: e.details }) + "\n");
    } else {
      stderr.write(strings.errors.code({ code: e.code, message: e.message }) + "\n");
    }
    return;
  }
  if (e?.code === "ERR_DIRECT_UNSUPPORTED") {
    stderr.write(strings.errors.pluginInstructions({ message: e.message, instructions: e.pluginInstallInstructions }) + "\n");
    return;
  }
  if (e?.code === "ERR_AGENT_CLI_MISSING") {
    if (args.json) {
      stdout.write(JSON.stringify({ ok: false, error: e.code, adapterId: e.adapterId, cliBinary: e.cliBinary, cliInstallUrl: e.cliInstallUrl, message: e.message }) + "\n");
    } else {
      stderr.write(strings.errors.code({ code: e.code, message: e.message }) + "\n");
    }
    return;
  }
  if (e?.code === "ERR_LOCKED") {
    stderr.write(strings.errors.plain({ message: e.message }) + "\n");
    return;
  }
  stderr.write(strings.errors.plain({ message: e?.message || e }) + "\n");
  if (e?.stack && env.DEBUG) stderr.write(`${e.stack}\n`);
}

/**
 * One-line summary of asset types skipped by the target adapter
 * (e.g. opencode skips agent assets). Returns "" when nothing skipped.
 *
 * @param {Object} plan  Install plan object with optional skippedUnsupported array
 * @returns {string}
 */
export function formatSkipNote(plan) {
  if (!plan?.skippedUnsupported?.length) return "";
  const byType = new Map();
  for (const s of plan.skippedUnsupported) byType.set(s.assetType, (byType.get(s.assetType) || 0) + 1);
  const summary = [...byType.entries()].map(([t, n]) => `${n} ${t}(s)`).join(", ");
  return `  [skipped: ${summary} — not supported by this adapter]`;
}
