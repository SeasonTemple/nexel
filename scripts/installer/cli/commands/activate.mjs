import os from "node:os";
import path from "node:path";

import { CommandError } from "./index.mjs";
import {
  ERR_ARGS,
  ERR_ACTIVATE_OPENCODE_REFUSED,
  ERR_ACTIVATE_INVALID_SCOPE,
} from "../../core/errors.mjs";
import { activateClaude, discoverClaudeInstructions } from "../../adapters/claude-plugin.mjs";
import { activateCodex, discoverCodexInstructions } from "../../adapters/codex-plugin.mjs";

// `nexel activate` verb. Writes ambient-context fences into per-CLI files
// (CLAUDE.md for Claude Code, AGENTS.md for Codex) so the installed skills
// surface in the agent's default context.
//
// Scope semantics:
//   --scope=user     → home (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`)
//   --scope=project  → cwd (`./CLAUDE.md`, `./AGENTS.md`)
//   default          → project (cwd)
//
// State-derived scope inheritance is intentionally deferred to a follow-up
// release — explicit `--scope` keeps v0.8's surface narrow and unambiguous.
//
// `--target=opencode` is refused: OpenCode's plugin runtime mutates config at
// OpenCode boot via `./adapters/opencode-plugin`; nexel-driven activate would
// either be a no-op or double-write.

const VALID_SCOPES = new Set(["user", "project"]);
const SUPPORTED_TARGETS = ["claude", "codex"];

function resolveScope(args) {
  const requested = args.scope ?? "project";
  if (!VALID_SCOPES.has(requested)) {
    throw new CommandError(
      `activate: unknown --scope=${requested}; expected one of: ${[...VALID_SCOPES].join(", ")}`,
      ERR_ACTIVATE_INVALID_SCOPE,
      { scope: requested },
    );
  }
  return requested;
}

function resolveSkillsDir(args, ctx) {
  if (args.skillsDir) return path.resolve(ctx.repoRoot, args.skillsDir);
  const skillsDirName = ctx.productConfig?.defaultSkillsDir ?? "skills";
  return path.resolve(ctx.repoRoot, skillsDirName);
}

function resolveTargets(args) {
  if (!args.target) return [...SUPPORTED_TARGETS];
  return args.target.split(",").map((s) => s.trim()).filter(Boolean);
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
    code: ERR_ACTIVATE_OPENCODE_REFUSED,
    details: {
      reason:
        "OpenCode activation happens at OpenCode boot via `nexel/adapters/opencode-plugin`. " +
        "Wire that plugin into your product's `.opencode/plugins/*.js` entry instead of running `nexel activate --target=opencode`.",
    },
  };
}

function dryRunEntry(adapter, targetPath, discovered) {
  return {
    adapter,
    status: "would-activate",
    details: {
      targetPath,
      discoveredCount: discovered.length,
      discovered: discovered.map((d) => d.skillName),
    },
  };
}

function activatedEntry(adapter, fenceResult) {
  const { action, changed, targetPath, discovered = [] } = fenceResult;
  return {
    adapter,
    status: "activated",
    details: {
      action,
      changed,
      targetPath,
      discoveredCount: discovered.length,
      // P2-C: include per-skill names so live runs are as informative as
      // dry-run envelopes. Agents driving activation no longer need a
      // follow-up probe to learn which skills landed in the fence.
      discovered: discovered.map((d) => d.skillName),
    },
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
 * `nexel activate` core command. Pure-ish function from arguments to
 * envelope; `runActivate` (below) handles stdout rendering and exit-code
 * derivation.
 *
 * @param {Object} opts
 * @param {string} opts.repoRoot
 * @param {Object} opts.productConfig
 * @param {string} opts.scope        Resolved "user" or "project".
 * @param {string[]} opts.targets    Adapter ids to activate (claude / codex / opencode).
 * @param {string} opts.skillsDir    Absolute path to skills directory.
 * @param {boolean} opts.dryRun
 * @param {Object} [opts.logger]
 * @returns {{ ok: boolean, scope: string, skillsDir: string, productName: string, adapters: Array }}
 */
export function activateCommand({ repoRoot, productConfig, scope, targets, skillsDir, dryRun, logger } = {}) {
  if (!productConfig) {
    throw new CommandError("activate: productConfig is required", ERR_ARGS, {});
  }
  if (!repoRoot) {
    throw new CommandError("activate: repoRoot is required", ERR_ARGS, {});
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new CommandError("activate: targets[] is required", ERR_ARGS, {});
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
          const discovered = discoverClaudeInstructions(skillsDir, logger);
          results.push(dryRunEntry("claude", targetClaudeMd, discovered));
        } else {
          const fenceResult = activateClaude({
            skillsDir,
            targetClaudeMd,
            productName,
            logger,
          });
          results.push(activatedEntry("claude", fenceResult));
        }
      } else if (target === "codex") {
        const targetAgentsMd = targetAgentsMdFor(scope);
        if (dryRun) {
          const discovered = discoverCodexInstructions(skillsDir, logger);
          results.push(dryRunEntry("codex", targetAgentsMd, discovered));
        } else {
          const fenceResult = activateCodex({
            skillsDir,
            targetAgentsMd,
            productName,
            logger,
          });
          results.push(activatedEntry("codex", fenceResult));
        }
      }
    } catch (e) {
      results.push(failedEntry(target, e));
      okOverall = false;
    }
  }

  return { ok: okOverall, scope, skillsDir, productName, adapters: results };
}

// Buffered logger — captures discover warnings so --json runs do not let
// `console.warn` contaminate the stdout JSON envelope (P2-B). In text mode
// the buffered warnings are flushed to stderr after the envelope is rendered;
// in --json mode they are surfaced as a top-level `warnings` array.
function createBufferedLogger() {
  const buf = [];
  return {
    warnings: buf,
    warn(message) { buf.push(String(message)); },
    info() { /* discover layer does not emit info */ },
  };
}

/**
 * CLI dispatcher entry (wired into KERNEL_HANDLERS as `activate`). Resolves
 * argv → activateCommand → stdout rendering.
 */
export async function runActivate(args, ctx) {
  const scope = resolveScope(args);
  const targets = resolveTargets(args);
  const skillsDir = resolveSkillsDir(args, ctx);
  const dryRun = !!args.dryRun;
  const logger = createBufferedLogger();

  const envelope = activateCommand({
    repoRoot: ctx.repoRoot,
    productConfig: ctx.productConfig,
    scope,
    targets,
    skillsDir,
    dryRun,
    logger,
  });

  if (args.json) {
    process.stdout.write(JSON.stringify({
      ok: envelope.ok,
      scope: envelope.scope,
      skillsDir: envelope.skillsDir,
      productName: envelope.productName,
      dryRun,
      adapters: envelope.adapters,
      warnings: logger.warnings,
    }, null, 2) + "\n");
    if (!envelope.ok) process.exitCode = 1;
    return;
  }

  process.stdout.write(`activate: scope=${envelope.scope} skillsDir=${envelope.skillsDir} productName=${envelope.productName}${dryRun ? " (dry-run)" : ""}\n`);
  for (const entry of envelope.adapters) {
    const sym = entry.status === "activated" || entry.status === "would-activate" ? "✓" : entry.status === "refused" ? "✗" : "!";
    if (entry.status === "activated") {
      process.stdout.write(`  ${sym} ${entry.adapter}: ${entry.details.action} (changed=${entry.details.changed}) → ${entry.details.targetPath}\n`);
    } else if (entry.status === "would-activate") {
      process.stdout.write(`  ${sym} ${entry.adapter}: would activate → ${entry.details.targetPath} (${entry.details.discoveredCount} instruction(s))\n`);
    } else if (entry.status === "refused") {
      process.stdout.write(`  ${sym} ${entry.adapter}: refused (${entry.code}) — ${entry.details.reason}\n`);
    } else {
      process.stdout.write(`  ${sym} ${entry.adapter}: failed (${entry.code}) — ${entry.details.message}\n`);
    }
  }
  // Flush buffered warnings to stderr in text mode so stdout stays clean.
  for (const w of logger.warnings) {
    process.stderr.write(`${w}\n`);
  }
  if (!envelope.ok) process.exitCode = 1;
}
