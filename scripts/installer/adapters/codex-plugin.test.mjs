import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import {
  discoverCodexInstructions,
  activateCodex,
} from "./codex-plugin.mjs";
import { discoverClaudeInstructions } from "./claude-plugin.mjs";
import { discoverOpenCodeInstructions } from "./opencode-plugin.mjs";
import * as installerIndex from "../index.mjs";

function makeSkillsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-codex-plugin-"));
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

test("discoverCodexInstructions accepts host-instructions: and resolves absolute paths", () => {
  const skillsDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "host-only",
      "name: sample:host-only\ncategory: setup\nhost-instructions: references/host.md\ndescription: host only",
      { "references/host.md": "host body" },
    );

    const discovered = discoverCodexInstructions(skillsDir);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].skillName, "host-only");
    assert.equal(discovered[0].instructionPath, path.join(skillsDir, "host-only", "references/host.md"));
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("activateCodex writes a fence into a fresh AGENTS.md with instruction listing", () => {
  const skillsDir = makeSkillsDir();
  const targetDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "alpha",
      "name: sample:alpha\nhost-instructions: references/alpha.md\ndescription: alpha",
      { "references/alpha.md": "alpha body" },
    );
    const target = path.join(targetDir, "AGENTS.md");

    const result = activateCodex({
      skillsDir,
      targetAgentsMd: target,
      productName: "sample-product",
    });

    assert.equal(result.action, "created");
    assert.equal(result.changed, true);
    assert.equal(result.discovered.length, 1);

    const text = fs.readFileSync(target, "utf8");
    assert.ok(text.includes("<!-- nexel:sample-product:begin -->"));
    assert.ok(text.includes("<!-- nexel:sample-product:end -->"));
    assert.ok(text.includes("Codex"));
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("activateCodex is byte-stable on identical re-run", () => {
  const skillsDir = makeSkillsDir();
  const targetDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "alpha",
      "name: sample:alpha\nhost-instructions: references/alpha.md\ndescription: alpha",
      { "references/alpha.md": "alpha body" },
    );
    const target = path.join(targetDir, "AGENTS.md");

    activateCodex({ skillsDir, targetAgentsMd: target, productName: "sample-product" });
    const before = fs.readFileSync(target, "utf8");
    const second = activateCodex({ skillsDir, targetAgentsMd: target, productName: "sample-product" });
    const after = fs.readFileSync(target, "utf8");

    assert.equal(second.action, "updated");
    assert.equal(second.changed, false);
    assert.equal(after, before);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("discoverCodexInstructions returns entries in codepoint-sorted order (T-03 fixup)", () => {
  const skillsDir = makeSkillsDir();
  try {
    // Write skills out of alphabetical order so any readdir-natural ordering
    // would surface as a test failure on this assertion.
    writeSkill(skillsDir, "zebra",  "name: sample:zebra\nhost-instructions: r/z.md\ndescription: z", { "r/z.md": "z" });
    writeSkill(skillsDir, "alpha",  "name: sample:alpha\nhost-instructions: r/a.md\ndescription: a", { "r/a.md": "a" });
    writeSkill(skillsDir, "middle", "name: sample:middle\nhost-instructions: r/m.md\ndescription: m", { "r/m.md": "m" });

    const order = discoverCodexInstructions(skillsDir).map((d) => d.skillName);
    assert.deepEqual(order, ["alpha", "middle", "zebra"]);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("three-way round-trip: host-instructions skill discovered by claude, codex, AND opencode helpers (R22)", () => {
  const skillsDir = makeSkillsDir();
  try {
    writeSkill(
      skillsDir,
      "unified",
      "name: sample:unified\ncategory: setup\nhost-instructions: references/unified.md\ndescription: unified field promise",
      { "references/unified.md": "unified body" },
    );

    const expectedAbsolute = path.join(skillsDir, "unified", "references/unified.md");

    const claudeDiscovered = discoverClaudeInstructions(skillsDir);
    const codexDiscovered = discoverCodexInstructions(skillsDir);
    const opencodeDiscovered = discoverOpenCodeInstructions(skillsDir);

    assert.equal(claudeDiscovered[0].instructionPath, expectedAbsolute);
    assert.equal(codexDiscovered[0].instructionPath, expectedAbsolute);
    assert.deepEqual(opencodeDiscovered, [expectedAbsolute]);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("package exports codex-plugin via subpath but not through the main index", () => {
  const require = createRequire(import.meta.url);
  const pkg = require("../../../package.json");

  assert.equal(pkg.exports["./adapters/codex-plugin"], "./scripts/installer/adapters/codex-plugin.mjs");
  assert.equal("activateCodex" in installerIndex, false);
  assert.equal("discoverCodexInstructions" in installerIndex, false);
});
