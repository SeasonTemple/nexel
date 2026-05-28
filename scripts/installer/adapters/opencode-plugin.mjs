import fs from "node:fs";
import path from "node:path";

import {
  HOST_INSTRUCTIONS_KEY,
  OPENCODE_INSTRUCTIONS_KEY,
  isValidRelativeSkillPath,
  isValidHostInstructionsPath,
  isValidOpenCodeInstructionsPath,
  readHostInstructions,
} from "../core/skill-metadata.mjs";

const FRONTMATTER_RE = /^---\r?\n([\s\S]+?)\r?\n---/;

function warn(logger, message) {
  if (logger && typeof logger.warn === "function") {
    logger.warn(message);
  }
}

// Re-export validators so legacy callers continue to import them from this module.
export { isValidHostInstructionsPath, isValidOpenCodeInstructionsPath };

/**
 * Discover-time per-skill reader used by `discoverOpenCodeInstructions`.
 *
 * Returns the declared instruction path (string) when the skill carries a
 * valid `host-instructions:` or `opencode-instructions:` entry, or `null`
 * when the skill declares neither (or declares an invalid value, in which
 * case a warning is also emitted).
 *
 * Duplicate declarations (both keys present) are detected via the structured
 * reader and surfaced as a single warning — `host-instructions:` always wins.
 */
export function readOpenCodeInstructions(frontmatterText, skillName, logger = console) {
  const result = readHostInstructions(frontmatterText);
  if (result === null) return null;
  const { value, source, duplicateDetected } = result;

  if (duplicateDetected) {
    warn(
      logger,
      `opencode plugin: skill ${skillName} declares both ${HOST_INSTRUCTIONS_KEY} and ${OPENCODE_INSTRUCTIONS_KEY}; using ${HOST_INSTRUCTIONS_KEY}`,
    );
  }

  if (!value) {
    const sourceKey = source === "host" ? HOST_INSTRUCTIONS_KEY : OPENCODE_INSTRUCTIONS_KEY;
    warn(logger, `opencode plugin: empty ${sourceKey} in ${skillName}; skipping`);
    return null;
  }
  if (!isValidRelativeSkillPath(value)) {
    const sourceKey = source === "host" ? HOST_INSTRUCTIONS_KEY : OPENCODE_INSTRUCTIONS_KEY;
    warn(
      logger,
      `opencode plugin: unsupported ${sourceKey} value in ${skillName}; use an unquoted single relative path`,
    );
    return null;
  }

  return value;
}

export function discoverOpenCodeInstructions(skillsDir, logger = console) {
  if (!fs.existsSync(skillsDir)) return [];

  const instructionPaths = [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  for (const entry of entries) {
    const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;

    const text = fs.readFileSync(skillMd, "utf8");
    const frontmatter = text.match(FRONTMATTER_RE)?.[1];
    if (!frontmatter) continue;

    const relativeInstructionPath = readOpenCodeInstructions(frontmatter, entry.name, logger);
    if (!relativeInstructionPath) continue;

    const skillDir = path.resolve(skillsDir, entry.name);
    const instructionPath = path.resolve(skillDir, relativeInstructionPath);
    if (!instructionPath.startsWith(`${skillDir}${path.sep}`)) {
      warn(logger, `opencode plugin: instruction path escapes ${entry.name}; skipping`);
      continue;
    }
    if (!fs.existsSync(instructionPath)) {
      warn(logger, `opencode plugin: instruction file not found for ${entry.name}: ${instructionPath}`);
      continue;
    }

    instructionPaths.push(instructionPath);
  }

  return instructionPaths;
}

export function configureOpenCode(config, skillsDir, logger = console) {
  config.skills = config.skills || {};
  config.skills.paths = config.skills.paths || [];
  if (!config.skills.paths.includes(skillsDir)) {
    config.skills.paths.push(skillsDir);
  }

  const instructionPaths = discoverOpenCodeInstructions(skillsDir, logger);
  if (instructionPaths.length === 0) return;

  config.instructions = config.instructions || [];
  for (const instructionPath of instructionPaths) {
    if (!config.instructions.includes(instructionPath)) {
      config.instructions.push(instructionPath);
    }
  }
}
