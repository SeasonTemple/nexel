import fs from "node:fs";
import path from "node:path";

import {
  HOST_INSTRUCTIONS_KEY,
  OPENCODE_INSTRUCTIONS_KEY,
  isValidRelativeSkillPath,
  readHostInstructions,
} from "../core/skill-metadata.mjs";
import { FRONTMATTER_RE } from "../core/manifest/schema.mjs";
import { writeAmbientFence } from "../core/ambient-fence.mjs";

// Plugin Runtime helper for Codex.
//
// Mirrors `claude-plugin.mjs` in shape and intent — discovers skills declaring
// `host-instructions:` (or the legacy `opencode-instructions:` alias) and
// writes a product-named ambient-fence block into a target `AGENTS.md`. The
// fence machinery is shared via `core/ambient-fence.mjs`.
//
// Exported via `./adapters/codex-plugin` subpath; NOT re-exported from
// `scripts/installer/index.mjs` (per ADR-0009 D2).

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
    warn(logger, `codex plugin: instruction path escapes ${entry.name}; skipping`);
    return null;
  }
  if (!fs.existsSync(instructionPath)) {
    warn(logger, `codex plugin: instruction file not found for ${entry.name}: ${instructionPath}`);
    return null;
  }
  return instructionPath;
}

export function discoverCodexInstructions(skillsDir, logger = console) {
  if (!fs.existsSync(skillsDir)) return [];

  const out = [];
  // Sort entries by codepoint so fence body order is deterministic across
  // filesystems AND locales. v0.8.1 used `localeCompare` which leaks the
  // host's collation (e.g., tr_TR orders `İ` differently from en_US),
  // breaking the byte-stable idempotency contract across CI runners with
  // different `LANG`. v0.8.2 uses a codepoint comparator instead.
  const entries = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const frontmatter = readSkillFrontmatter(skillsDir, entry);
    if (!frontmatter) continue;

    const result = readHostInstructions(frontmatter);
    if (result === null) continue;
    const { value, source, duplicateDetected } = result;

    if (duplicateDetected) {
      warn(
        logger,
        `codex plugin: skill ${entry.name} declares both ${HOST_INSTRUCTIONS_KEY} and ${OPENCODE_INSTRUCTIONS_KEY}; using ${HOST_INSTRUCTIONS_KEY}`,
      );
    }

    if (!value) {
      const sourceKey = source === "host" ? HOST_INSTRUCTIONS_KEY : OPENCODE_INSTRUCTIONS_KEY;
      warn(logger, `codex plugin: empty ${sourceKey} in ${entry.name}; skipping`);
      continue;
    }
    if (!isValidRelativeSkillPath(value)) {
      const sourceKey = source === "host" ? HOST_INSTRUCTIONS_KEY : OPENCODE_INSTRUCTIONS_KEY;
      warn(
        logger,
        `codex plugin: unsupported ${sourceKey} value in ${entry.name}; use an unquoted single relative path`,
      );
      continue;
    }

    const absolute = resolveInstructionPath(skillsDir, entry, value, logger);
    if (absolute) out.push({ skillName: entry.name, instructionPath: absolute });
  }

  return out;
}

function composeCodexFenceBody({ skillsDir, instructions, productName }) {
  const lines = [
    `# ${productName} — nexel-installed skills (Codex)`,
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
 * Compose and write the Codex ambient fence for a product.
 *
 * Returns `{ action, changed, targetPath, discovered }`.
 *
 * @param {Object} opts
 * @param {string} opts.skillsDir       Absolute path to the product's installed skills dir.
 * @param {string} opts.targetAgentsMd  Absolute path of `AGENTS.md` to write.
 * @param {string} opts.productName     Identity for fence markers.
 * @param {Object} [opts.logger]
 */
export function activateCodex({ skillsDir, targetAgentsMd, productName, logger }) {
  const instructions = discoverCodexInstructions(skillsDir, logger);
  const contentBlock = composeCodexFenceBody({ skillsDir, instructions, productName });
  const fenceResult = writeAmbientFence({
    targetPath: targetAgentsMd,
    productName,
    contentBlock,
    logger,
  });
  return { ...fenceResult, discovered: instructions };
}
