import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import {
  configureOpenCode,
  discoverOpenCodeInstructions,
  isValidOpenCodeInstructionsPath,
  readOpenCodeInstructions,
} from "./opencode-plugin.mjs";
import * as installerIndex from "../index.mjs";

function makeSkillsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-opencode-plugin-"));
}

function writeSkill(skillsDir, dirname, frontmatter, files = {}) {
  const skillDir = path.join(skillsDir, dirname);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# ${dirname}\n`);
  for (const [relativePath, body] of Object.entries(files)) {
    const filePath = path.join(skillDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body);
  }
}

function makeLogger() {
  const warnings = [];
  return {
    warnings,
    warn(message) {
      warnings.push(message);
    },
  };
}

test("isValidOpenCodeInstructionsPath accepts only plain relative paths", () => {
  assert.equal(isValidOpenCodeInstructionsPath("references/opencode-instructions.md"), true);
  assert.equal(isValidOpenCodeInstructionsPath(""), false);
  assert.equal(isValidOpenCodeInstructionsPath(" references/opencode-instructions.md"), false);
  assert.equal(isValidOpenCodeInstructionsPath("\"references/opencode-instructions.md\""), false);
  assert.equal(isValidOpenCodeInstructionsPath("references/open code.md"), false);
  assert.equal(isValidOpenCodeInstructionsPath("../outside.md"), false);
  assert.equal(isValidOpenCodeInstructionsPath("/tmp/outside.md"), false);
  assert.equal(isValidOpenCodeInstructionsPath("C:\\tmp\\outside.md"), false);
  assert.equal(isValidOpenCodeInstructionsPath("\\\\server\\share\\outside.md"), false);
  assert.equal(isValidOpenCodeInstructionsPath(42), false);
});

test("readOpenCodeInstructions returns declared relative instruction path", () => {
  const frontmatter = [
    "name: sample:workflow",
    "category: setup",
    "opencode-instructions: references/opencode-instructions.md",
    "description: test",
  ].join("\n");

  assert.equal(
    readOpenCodeInstructions(frontmatter, "workflow"),
    "references/opencode-instructions.md"
  );
});

test("discoverOpenCodeInstructions returns declared instruction files", () => {
  const skillsDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "workflow",
      "name: sample:workflow\ncategory: setup\nopencode-instructions: references/opencode-instructions.md\ndescription: test",
      { "references/opencode-instructions.md": "instructions" }
    );
    writeSkill(skillsDir, "plain", "name: sample:plain\ncategory: tool\ndescription: test");

    assert.deepEqual(discoverOpenCodeInstructions(skillsDir), [
      path.join(skillsDir, "workflow", "references/opencode-instructions.md"),
    ]);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("configureOpenCode appends skills path and instructions idempotently", () => {
  const skillsDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "one",
      "name: sample:one\ncategory: review\nopencode-instructions: references/opencode-instructions.md\ndescription: test",
      { "references/opencode-instructions.md": "one" }
    );
    writeSkill(
      skillsDir,
      "two",
      "name: sample:two\ncategory: tool\nopencode-instructions: references/opencode-instructions.md\ndescription: test",
      { "references/opencode-instructions.md": "two" }
    );

    const existing = path.join(skillsDir, "one", "references/opencode-instructions.md");
    const config = { instructions: [existing] };
    configureOpenCode(config, skillsDir);
    configureOpenCode(config, skillsDir);

    assert.deepEqual(config.skills.paths, [skillsDir]);
    assert.deepEqual(config.instructions.sort(), [
      existing,
      path.join(skillsDir, "two", "references/opencode-instructions.md"),
    ].sort());
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("discoverOpenCodeInstructions skips invalid values with warnings", () => {
  const skillsDir = makeSkillsDir();
  const logger = makeLogger();
  try {
    writeSkill(skillsDir, "missing", "name: sample:missing\ncategory: setup\nopencode-instructions: references/missing.md\ndescription: test");
    writeSkill(skillsDir, "empty", "name: sample:empty\ncategory: setup\nopencode-instructions:\ndescription: test");
    writeSkill(skillsDir, "absolute", `name: sample:absolute\ncategory: setup\nopencode-instructions: ${path.join(skillsDir, "x.md")}\ndescription: test`);
    writeSkill(skillsDir, "escape", "name: sample:escape\ncategory: setup\nopencode-instructions: ../outside.md\ndescription: test");
    writeSkill(skillsDir, "quoted", "name: sample:quoted\ncategory: setup\nopencode-instructions: \"references/opencode-instructions.md\"\ndescription: test");
    writeSkill(skillsDir, "space", "name: sample:space\ncategory: setup\nopencode-instructions: references/open code.md\ndescription: test");

    assert.deepEqual(discoverOpenCodeInstructions(skillsDir, logger), []);
    assert.equal(logger.warnings.length, 6);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("discoverOpenCodeInstructions handles an empty or missing skills directory", () => {
  const skillsDir = makeSkillsDir();
  try {
    assert.deepEqual(discoverOpenCodeInstructions(skillsDir), []);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
  assert.deepEqual(discoverOpenCodeInstructions(path.join(os.tmpdir(), "missing-nexel-skills")), []);
});

test("discoverOpenCodeInstructions accepts host-instructions: as the unified Skill Metadata key", () => {
  const skillsDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "host-only",
      "name: sample:host-only\ncategory: setup\nhost-instructions: references/host.md\ndescription: host only",
      { "references/host.md": "host body" },
    );
    writeSkill(
      skillsDir,
      "alias-only",
      "name: sample:alias-only\ncategory: setup\nopencode-instructions: references/alias.md\ndescription: alias only",
      { "references/alias.md": "alias body" },
    );

    const discovered = discoverOpenCodeInstructions(skillsDir).sort();
    assert.deepEqual(discovered, [
      path.join(skillsDir, "alias-only", "references/alias.md"),
      path.join(skillsDir, "host-only", "references/host.md"),
    ]);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("discoverOpenCodeInstructions emits a single duplicate warning and uses host-instructions when both keys are present", () => {
  const skillsDir = makeSkillsDir();
  const logger = makeLogger();
  try {
    writeSkill(
      skillsDir,
      "both",
      "name: sample:both\ncategory: setup\nhost-instructions: references/host.md\nopencode-instructions: references/legacy.md\ndescription: both declared",
      {
        "references/host.md": "host body",
        "references/legacy.md": "legacy body",
      },
    );

    const discovered = discoverOpenCodeInstructions(skillsDir, logger);
    assert.deepEqual(discovered, [
      path.join(skillsDir, "both", "references/host.md"),
    ]);
    const duplicateWarnings = logger.warnings.filter((w) =>
      w.includes("declares both") && w.includes("host-instructions") && w.includes("opencode-instructions"),
    );
    assert.equal(duplicateWarnings.length, 1, `expected exactly one duplicate warning, got: ${JSON.stringify(logger.warnings)}`);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("configureOpenCode picks up host-instructions skills end-to-end", () => {
  const skillsDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "modern",
      "name: sample:modern\ncategory: setup\nhost-instructions: references/host.md\ndescription: new key",
      { "references/host.md": "modern body" },
    );

    const config = {};
    configureOpenCode(config, skillsDir);

    assert.deepEqual(config.skills.paths, [skillsDir]);
    assert.deepEqual(config.instructions, [
      path.join(skillsDir, "modern", "references/host.md"),
    ]);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("package exports opencode plugin helper without growing main index", () => {
  const require = createRequire(import.meta.url);
  const pkg = require("../../../package.json");

  assert.equal(pkg.exports["./adapters/opencode-plugin"], "./scripts/installer/adapters/opencode-plugin.mjs");
  assert.equal("configureOpenCode" in installerIndex, false);
  assert.equal("discoverOpenCodeInstructions" in installerIndex, false);
});
