import fs from "node:fs";
import path from "node:path";

import {
  HOST_INSTRUCTIONS_KEY,
  OPENCODE_INSTRUCTIONS_KEY,
  isValidRelativeSkillPath,
  readHostInstructions,
} from "../core/skill-metadata.mjs";
import { writeAmbientFence } from "../core/ambient-fence.mjs";

// Plugin Runtime helper for Claude Code.
//
// Discovers skills declaring `host-instructions:` (or the legacy
// `opencode-instructions:` alias) under a skills directory and writes a
// product-named ambient-fence block into a target `CLAUDE.md`. The fence
// markers come from `core/ambient-fence.mjs`, so multi-product coexistence
// + byte-stable idempotency are inherited from the shared writer.
//
// This module is exported via the `./adapters/claude-plugin` package subpath
// and is intentionally NOT re-exported from `scripts/installer/index.mjs`
// (per ADR-0009 D2 — the main kernel interface stays free of host-specific
// activation surface).

const FRONTMATTER_RE = /^---\r?\n([\s\S]+?)\r?\n---/;

function warn(logger, message) {
  if (logger && typeof logger.warn === "function") {
    logger.warn(message);
  }
}

function readSkillFrontmatter(skillsDir, entry) {
  const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
  if (!fs.existsSync(skillMd)) return null;
  const text = fs.readFileSync(skillMd, "utf8");
  return text.match(FRONTMATTER_RE)?.[1] ?? null;
}

function resolveInstructionPath(skillsDir, entry, relativeInstructionPath, logger) {
  const skillDir = path.resolve(skillsDir, entry.name);
  const instructionPath = path.resolve(skillDir, relativeInstructionPath);
  if (!instructionPath.startsWith(`${skillDir}${path.sep}`)) {
    warn(logger, `claude plugin: instruction path escapes ${entry.name}; skipping`);
    return null;
  }
  if (!fs.existsSync(instructionPath)) {
    warn(logger, `claude plugin: instruction file not found for ${entry.name}: ${instructionPath}`);
    return null;
  }
  return instructionPath;
}

/**
 * Walk `skillsDir`, return absolute paths of declared ambient-instruction
 * files. Recognizes both `host-instructions:` and (legacy)
 * `opencode-instructions:` via the shared structured reader; emits a single
 * duplicate-declaration warning per skill when both are present.
 */
export function discoverClaudeInstructions(skillsDir, logger = console) {
  if (!fs.existsSync(skillsDir)) return [];

  const out = [];
  const entries = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  for (const entry of entries) {
    const frontmatter = readSkillFrontmatter(skillsDir, entry);
    if (!frontmatter) continue;

    const result = readHostInstructions(frontmatter);
    if (result === null) continue;
    const { value, source, duplicateDetected } = result;

    if (duplicateDetected) {
      warn(
        logger,
        `claude plugin: skill ${entry.name} declares both ${HOST_INSTRUCTIONS_KEY} and ${OPENCODE_INSTRUCTIONS_KEY}; using ${HOST_INSTRUCTIONS_KEY}`,
      );
    }

    if (!value) {
      const sourceKey = source === "host" ? HOST_INSTRUCTIONS_KEY : OPENCODE_INSTRUCTIONS_KEY;
      warn(logger, `claude plugin: empty ${sourceKey} in ${entry.name}; skipping`);
      continue;
    }
    if (!isValidRelativeSkillPath(value)) {
      const sourceKey = source === "host" ? HOST_INSTRUCTIONS_KEY : OPENCODE_INSTRUCTIONS_KEY;
      warn(
        logger,
        `claude plugin: unsupported ${sourceKey} value in ${entry.name}; use an unquoted single relative path`,
      );
      continue;
    }

    const absolute = resolveInstructionPath(skillsDir, entry, value, logger);
    if (absolute) out.push({ skillName: entry.name, instructionPath: absolute });
  }

  return out;
}

function composeClaudeFenceBody({ skillsDir, instructions, productName }) {
  const lines = [
    `# ${productName} — nexel-installed skills`,
    "",
    `Skills directory: ${skillsDir}`,
  ];
  if (instructions.length > 0) {
    lines.push("", "Ambient instructions:");
    for (const { skillName, instructionPath } of instructions) {
      lines.push(`- ${skillName}: ${instructionPath}`);
    }
  }
  return lines.join("\n");
}

/**
 * Compose and write the Claude Code ambient fence for a product.
 *
 * Returns the `writeAmbientFence` envelope (`{ action, changed, targetPath }`)
 * extended with `discovered` (the per-skill instruction list).
 *
 * @param {Object} opts
 * @param {string} opts.skillsDir        Absolute path to the product's installed skills dir.
 * @param {string} opts.targetClaudeMd   Absolute path of `CLAUDE.md` to write.
 * @param {string} opts.productName      Identity for fence markers.
 * @param {Object} [opts.logger]
 */
export function activateClaude({ skillsDir, targetClaudeMd, productName, logger }) {
  const instructions = discoverClaudeInstructions(skillsDir, logger);
  const contentBlock = composeClaudeFenceBody({ skillsDir, instructions, productName });
  const fenceResult = writeAmbientFence({
    targetPath: targetClaudeMd,
    productName,
    contentBlock,
    logger,
  });
  return { ...fenceResult, discovered: instructions };
}
