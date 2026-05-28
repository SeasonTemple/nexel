import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import {
  discoverClaudeInstructions,
  activateClaude,
} from "./claude-plugin.mjs";
import * as installerIndex from "../index.mjs";

function makeSkillsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-claude-plugin-"));
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

test("discoverClaudeInstructions accepts host-instructions: and resolves absolute paths", () => {
  const skillsDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "host-only",
      "name: sample:host-only\ncategory: setup\nhost-instructions: references/host.md\ndescription: host only",
      { "references/host.md": "host body" },
    );
    writeSkill(skillsDir, "plain", "name: sample:plain\ncategory: tool\ndescription: nothing");

    const discovered = discoverClaudeInstructions(skillsDir);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].skillName, "host-only");
    assert.equal(discovered[0].instructionPath, path.join(skillsDir, "host-only", "references/host.md"));
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("discoverClaudeInstructions falls back to opencode-instructions: alias", () => {
  const skillsDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "legacy",
      "name: sample:legacy\ncategory: setup\nopencode-instructions: references/alias.md\ndescription: legacy alias",
      { "references/alias.md": "alias body" },
    );

    const discovered = discoverClaudeInstructions(skillsDir);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].instructionPath, path.join(skillsDir, "legacy", "references/alias.md"));
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("discoverClaudeInstructions emits a single duplicate warning when both keys are present", () => {
  const skillsDir = makeSkillsDir();
  const logger = makeLogger();
  try {
    writeSkill(
      skillsDir,
      "both",
      "name: sample:both\ncategory: setup\nhost-instructions: references/host.md\nopencode-instructions: references/legacy.md\ndescription: both",
      {
        "references/host.md": "host body",
        "references/legacy.md": "legacy body",
      },
    );

    const discovered = discoverClaudeInstructions(skillsDir, logger);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].instructionPath, path.join(skillsDir, "both", "references/host.md"));
    const duplicateWarnings = logger.warnings.filter((w) =>
      w.includes("declares both") && w.includes("host-instructions") && w.includes("opencode-instructions"),
    );
    assert.equal(duplicateWarnings.length, 1);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("discoverClaudeInstructions skips invalid values with warnings", () => {
  const skillsDir = makeSkillsDir();
  const logger = makeLogger();
  try {
    writeSkill(skillsDir, "missing-file", "name: sample:missing\nhost-instructions: references/missing.md\ndescription: file missing");
    writeSkill(skillsDir, "empty", "name: sample:empty\nhost-instructions:\ndescription: empty value");
    writeSkill(skillsDir, "escape", "name: sample:escape\nhost-instructions: ../outside.md\ndescription: escape");
    writeSkill(skillsDir, "quoted", "name: sample:quoted\nhost-instructions: \"references/x.md\"\ndescription: quoted");

    const discovered = discoverClaudeInstructions(skillsDir, logger);
    assert.equal(discovered.length, 0);
    assert.ok(logger.warnings.length >= 4, `expected >=4 warnings, got ${logger.warnings.length}`);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("activateClaude writes a fence into a fresh CLAUDE.md with instruction listing", () => {
  const skillsDir = makeSkillsDir();
  const targetDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "alpha",
      "name: sample:alpha\nhost-instructions: references/alpha.md\ndescription: alpha",
      { "references/alpha.md": "alpha body" },
    );
    const target = path.join(targetDir, "CLAUDE.md");

    const result = activateClaude({
      skillsDir,
      targetClaudeMd: target,
      productName: "sample-product",
    });

    assert.equal(result.action, "created");
    assert.equal(result.changed, true);
    assert.equal(result.discovered.length, 1);

    const text = fs.readFileSync(target, "utf8");
    assert.ok(text.includes("<!-- nexel:sample-product:begin -->"));
    assert.ok(text.includes("<!-- nexel:sample-product:end -->"));
    assert.ok(text.includes("Skills directory:"));
    assert.ok(text.includes("alpha:"));
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("activateClaude is byte-stable on identical re-run", () => {
  const skillsDir = makeSkillsDir();
  const targetDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "alpha",
      "name: sample:alpha\nhost-instructions: references/alpha.md\ndescription: alpha",
      { "references/alpha.md": "alpha body" },
    );
    const target = path.join(targetDir, "CLAUDE.md");

    activateClaude({ skillsDir, targetClaudeMd: target, productName: "sample-product" });
    const before = fs.readFileSync(target, "utf8");
    const second = activateClaude({ skillsDir, targetClaudeMd: target, productName: "sample-product" });
    const after = fs.readFileSync(target, "utf8");

    assert.equal(second.action, "updated");
    assert.equal(second.changed, false);
    assert.equal(after, before);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("activateClaude preserves other products' fences in the same target file", () => {
  const skillsDir = makeSkillsDir();
  const targetDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "alpha",
      "name: sample:alpha\nhost-instructions: references/alpha.md\ndescription: alpha",
      { "references/alpha.md": "alpha body" },
    );
    const target = path.join(targetDir, "CLAUDE.md");

    fs.writeFileSync(
      target,
      "user prose\n\n<!-- nexel:other-product:begin -->\nother body\n<!-- nexel:other-product:end -->\n",
    );

    const result = activateClaude({ skillsDir, targetClaudeMd: target, productName: "sample-product" });
    assert.equal(result.action, "appended");

    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes("<!-- nexel:other-product:begin -->\nother body\n<!-- nexel:other-product:end -->"));
    assert.ok(after.includes("<!-- nexel:sample-product:begin -->"));
    assert.ok(after.includes("user prose"));
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("package exports claude-plugin via subpath but not through the main index", () => {
  const require = createRequire(import.meta.url);
  const pkg = require("../../../package.json");

  assert.equal(pkg.exports["./adapters/claude-plugin"], "./scripts/installer/adapters/claude-plugin.mjs");
  assert.equal("activateClaude" in installerIndex, false);
  assert.equal("discoverClaudeInstructions" in installerIndex, false);
});
