import os from "node:os";
import path from "node:path";

import { CommandError } from "./index.mjs";
import {
  ERR_ARGS,
  ERR_DEACTIVATE_OPENCODE_REFUSED,
  ERR_DEACTIVATE_INVALID_SCOPE,
} from "../../core/errors.mjs";
import { removeAmbientFence, hasAmbientFence } from "../../core/ambient-fence.mjs";

// `nexel deactivate` verb (ADR-0017). Exact-invert of `activate`: removes the
// THIS-product ambient fence from a host file (CLAUDE.md for Claude Code,
// AGENTS.md for Codex). Other products' fences in the same host file are
// preserved byte-identically — the per-product isolation invariant locked at
// INTERLOCK LOCK 1 (per-product `productName` literal lookup via
// `removeAmbientFence`, never a wildcard sweep).
//
// Scope semantics mirror activate:
//   --scope=user     → home (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`)
//   --scope=project  → cwd (`./CLAUDE.md`, `./AGENTS.md`)
//   default          → project (cwd)
//
// `--target=opencode` is refused for symmetry with activate: OpenCode plugin
// lifecycle is owned by the OpenCode runtime entry, not by this verb.

const VALID_SCOPES = new Set(["user", "project"]);
const SUPPORTED_TARGETS = ["claude", "codex"];

function resolveScope(args) {
  const requested = args.scope ?? "project";
  if (!VALID_SCOPES.has(requested)) {
    throw new CommandError(
      `deactivate: unknown --scope=${requested}; expected one of: ${[...VALID_SCOPES].join(", ")}`,
      ERR_DEACTIVATE_INVALID_SCOPE,
      { scope: requested },
    );
  }
  return requested;
}

function resolveTargets(args, logger) {
  // Mirror activate's `--agent` + `--target` selector. `--target` is the
  // deprecated alias; both together union with a warning.
  const agentSet = Array.isArray(args.adapters) && args.adapters.length > 0;
  const targetSet = !!args.target;
  const fromTarget = targetSet
    ? args.target.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (agentSet && targetSet) {
    if (logger && typeof logger.warn === "function") {
      logger.warn(
        `deactivate: --target is a deprecated alias for --agent; both were provided. Deactivating the union: ${[...args.adapters, ...fromTarget].join(",")}. Use --agent only in new scripts.`,
      );
    }
    return [...new Set([...args.adapters, ...fromTarget])];
  }
  if (agentSet) return [...args.adapters];
  if (targetSet) return fromTarget;
  return [...SUPPORTED_TARGETS];
}

function targetClaudeMdFor(scope) {
  if (scope === "user") return path.join(os.homedir(), ".claude", "CLAUDE.md");
  return path.resolve(process.cwd(), "CLAUDE.md");
}

function targetAgentsMdFor(scope) {
  if (scope === "user") return path.join(os.homedir(), ".codex", "AGENTS.md");
  return path.resolve(process.cwd(), "AGENTS.md");
}

function refusedOpencodeEntry() {
  return {
    adapter: "opencode",
    status: "refused",
    code: ERR_DEACTIVATE_OPENCODE_REFUSED,
    details: {
      reason:
        "OpenCode deactivation happens at OpenCode boot via `nexel/adapters/opencode-plugin`. " +
        "Wire that plugin's lifecycle into your product's `.opencode/plugins/*.js` entry instead of running `nexel deactivate --target=opencode`.",
    },
  };
}

function dryRunEntry(adapter, targetPath, hasFence) {
  return {
    adapter,
    status: "would-deactivate",
    details: {
      targetPath,
      hasFence,
    },
  };
}

function deactivatedEntry(adapter, fenceResult) {
  const { action, changed, targetPath, reason } = fenceResult;
  const details = { action, changed, targetPath };
  if (reason) details.reason = reason;
  return {
    adapter,
    status: "deactivated",
    details,
  };
}

function failedEntry(adapter, error) {
  return {
    adapter,
    status: "failed",
    code: error?.code ?? "ERR_UNKNOWN",
    details: {
      message: error?.message ?? String(error),
    },
  };
}

/**
 * `nexel deactivate` core command. Pure-ish function from arguments to
 * envelope; `runDeactivate` (below) handles stdout rendering and exit-code
 * derivation.
 *
 * @param {Object} opts
 * @param {string} opts.repoRoot
 * @param {Object} opts.productConfig
 * @param {string} opts.scope        Resolved "user" or "project".
 * @param {string[]} opts.targets    Adapter ids to deactivate (claude / codex / opencode).
 * @param {boolean} opts.dryRun
 * @param {Object} [opts.logger]
 * @returns {{ ok: boolean, scope: string, productName: string, adapters: Array }}
 */
export function deactivateCommand({ repoRoot, productConfig, scope, targets, dryRun, logger } = {}) {
  if (!productConfig) {
    throw new CommandError("deactivate: productConfig is required", ERR_ARGS, {});
  }
  if (!repoRoot) {
    throw new CommandError("deactivate: repoRoot is required", ERR_ARGS, {});
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new CommandError("deactivate: targets[] is required", ERR_ARGS, {});
  }

  const productName = productConfig.productName ?? productConfig.pluginName ?? "nexel-product";
  const results = [];
  let okOverall = true;

  for (const target of targets) {
    if (target === "opencode") {
      results.push(refusedOpencodeEntry());
      okOverall = false;
      continue;
    }
    if (!SUPPORTED_TARGETS.includes(target)) {
      results.push({
        adapter: target,
        status: "failed",
        code: ERR_ARGS,
        details: { message: `unknown --target=${target}` },
      });
      okOverall = false;
      continue;
    }

    try {
      if (target === "claude") {
        const targetClaudeMd = targetClaudeMdFor(scope);
        if (dryRun) {
          const hasFence = hasAmbientFence(targetClaudeMd, productName);
          results.push(dryRunEntry("claude", targetClaudeMd, hasFence));
        } else {
          const fenceResult = removeAmbientFence({
            targetPath: targetClaudeMd,
            productName,
            logger,
          });
          results.push(deactivatedEntry("claude", fenceResult));
        }
      } else if (target === "codex") {
        const targetAgentsMd = targetAgentsMdFor(scope);
        if (dryRun) {
          const hasFence = hasAmbientFence(targetAgentsMd, productName);
          results.push(dryRunEntry("codex", targetAgentsMd, hasFence));
        } else {
          const fenceResult = removeAmbientFence({
            targetPath: targetAgentsMd,
            productName,
            logger,
          });
          results.push(deactivatedEntry("codex", fenceResult));
        }
      }
    } catch (e) {
      results.push(failedEntry(target, e));
      okOverall = false;
    }
  }

  return { ok: okOverall, scope, productName, adapters: results };
}

// Buffered logger — captures warnings so --json runs do not let `console.warn`
// contaminate the stdout JSON envelope (mirrors activate's P2-B pattern).
function createBufferedLogger() {
  const buf = [];
  return {
    warnings: buf,
    warn(message) { buf.push(String(message)); },
    info() { /* removeAmbientFence's info events are not surfaced */ },
  };
}

/**
 * CLI dispatcher entry (wired into KERNEL_HANDLERS as `deactivate`). Resolves
 * argv → deactivateCommand → stdout rendering.
 */
export async function runDeactivate(args, ctx) {
  const scope = resolveScope(args);
  const logger = createBufferedLogger();
  const targets = resolveTargets(args, logger);
  const dryRun = !!args.dryRun;

  const envelope = deactivateCommand({
    repoRoot: ctx.repoRoot,
    productConfig: ctx.productConfig,
    scope,
    targets,
    dryRun,
    logger,
  });

  if (args.json) {
    // ADR-0014 envelope shape — verb-shaped on success, standard
    // {ok:false, error, message, details} on failure (mirrors activate).
    if (envelope.ok) {
      process.stdout.write(JSON.stringify({
        ok: true,
        scope: envelope.scope,
        productName: envelope.productName,
        dryRun,
        adapters: envelope.adapters,
        warnings: logger.warnings,
      }, null, 2) + "\n");
      return;
    }
    const firstFailure = envelope.adapters.find((a) => a.status === "refused" || a.status === "failed");
    if (!firstFailure) {
      throw new Error(
        "deactivate contract violation: deactivateCommand returned ok:false with no refused/failed adapter entry; add the missing entry push in deactivateCommand.",
      );
    }
    const errorCode = firstFailure.code;
    const message = firstFailure.status === "refused"
      ? `deactivate: ${firstFailure.adapter} refused — ${firstFailure.details?.reason ?? "see details"}`
      : `deactivate: ${firstFailure.adapter} failed — ${firstFailure.details?.message ?? "see details"}`;
    process.stdout.write(JSON.stringify({
      ok: false,
      error: errorCode,
      message,
      details: {
        scope: envelope.scope,
        productName: envelope.productName,
        dryRun,
        adapters: envelope.adapters,
        warnings: logger.warnings,
      },
    }, null, 2) + "\n");
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`deactivate: scope=${envelope.scope} productName=${envelope.productName}${dryRun ? " (dry-run)" : ""}\n`);
  for (const entry of envelope.adapters) {
    const sym = entry.status === "deactivated" || entry.status === "would-deactivate" ? "✓" : entry.status === "refused" ? "✗" : "!";
    if (entry.status === "deactivated") {
      const reasonSuffix = entry.details.reason ? ` (${entry.details.reason})` : "";
      process.stdout.write(`  ${sym} ${entry.adapter}: ${entry.details.action} (changed=${entry.details.changed}) → ${entry.details.targetPath}${reasonSuffix}\n`);
    } else if (entry.status === "would-deactivate") {
      process.stdout.write(`  ${sym} ${entry.adapter}: would deactivate → ${entry.details.targetPath} (hasFence=${entry.details.hasFence})\n`);
    } else if (entry.status === "refused") {
      process.stdout.write(`  ${sym} ${entry.adapter}: refused (${entry.code}) — ${entry.details.reason}\n`);
    } else {
      process.stdout.write(`  ${sym} ${entry.adapter}: failed (${entry.code}) — ${entry.details.message}\n`);
    }
  }
  for (const w of logger.warnings) {
    process.stderr.write(`${w}\n`);
  }
  if (!envelope.ok) process.exitCode = 1;
}
