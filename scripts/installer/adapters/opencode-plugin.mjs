import fs from "node:fs";
import path from "node:path";

import {
  OPENCODE_INSTRUCTIONS_KEY,
  isValidOpenCodeInstructionsPath,
  readOpenCodeInstructions as readOpenCodeInstructionsValue,
} from "../core/skill-metadata.mjs";

const FRONTMATTER_RE = /^---\r?\n([\s\S]+?)\r?\n---/;

function warn(logger, message) {
  if (logger && typeof logger.warn === "function") {
    logger.warn(message);
  }
}

export { isValidOpenCodeInstructionsPath };

export function readOpenCodeInstructions(frontmatterText, skillName, logger = console) {
  const value = readOpenCodeInstructionsValue(frontmatterText);
  if (value === null) return null;
  if (!value) {
    warn(logger, `opencode plugin: empty ${OPENCODE_INSTRUCTIONS_KEY} in ${skillName}; skipping`);
    return null;
  }
  if (!isValidOpenCodeInstructionsPath(value)) {
    warn(logger, `opencode plugin: unsupported ${OPENCODE_INSTRUCTIONS_KEY} value in ${skillName}; use an unquoted single relative path`);
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
      warn(logger, `opencode plugin: ${OPENCODE_INSTRUCTIONS_KEY} path escapes ${entry.name}; skipping`);
      continue;
    }
    if (!fs.existsSync(instructionPath)) {
      warn(logger, `opencode plugin: ${OPENCODE_INSTRUCTIONS_KEY} file not found for ${entry.name}: ${instructionPath}`);
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
