import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { activateCommand, runActivate } from "./activate.mjs";
import { CommandError } from "./index.mjs";
import {
  ERR_ARGS,
  ERR_ACTIVATE_OPENCODE_REFUSED,
  ERR_ACTIVATE_INVALID_SCOPE,
} from "../../core/errors.mjs";

function makeSkillsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-activate-cmd-"));
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

const STUB_PRODUCT = {
  productName: "stub-product",
  skillIdPrefix: "stub",
  agentNamePrefix: "stub-",
  binName: "stub-installer",
  defaultManifestFile: "stub.install.json",
  pluginName: "stub-product",
  defaultSkillsDir: "skills",
};

test("activateCommand returns refused entry for opencode target", () => {
  const dir = makeSkillsDir();
  try {
    const result = activateCommand({
      repoRoot: dir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["opencode"],
      skillsDir: dir,
      dryRun: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.adapters.length, 1);
    const entry = result.adapters[0];
    assert.equal(entry.adapter, "opencode");
    assert.equal(entry.status, "refused");
    assert.equal(entry.code, ERR_ACTIVATE_OPENCODE_REFUSED);
    assert.ok(entry.details.reason.includes("opencode-plugin"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("activateCommand activates claude + codex with default targets (no --target)", () => {
  const skillsDir = makeSkillsDir();
  const cwdDir = makeSkillsDir();
  const originalCwd = process.cwd();
  try {
    writeSkill(
      skillsDir,
      "alpha",
      "name: stub:alpha\ncategory: setup\nhost-instructions: references/alpha.md\ndescription: alpha",
      { "references/alpha.md": "alpha body" },
    );
    process.chdir(cwdDir);
    const result = activateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude", "codex"],
      skillsDir,
      dryRun: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.adapters.length, 2);
    for (const entry of result.adapters) {
      assert.equal(entry.status, "activated");
      assert.equal(entry.details.action, "created");
    }
    assert.ok(fs.existsSync(path.join(cwdDir, "CLAUDE.md")));
    assert.ok(fs.existsSync(path.join(cwdDir, "AGENTS.md")));
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(cwdDir, { recursive: true, force: true });
  }
});

test("activateCommand is idempotent on identical re-run (changed: false)", () => {
  const skillsDir = makeSkillsDir();
  const cwdDir = makeSkillsDir();
  const originalCwd = process.cwd();
  try {
    writeSkill(
      skillsDir,
      "alpha",
      "name: stub:alpha\nhost-instructions: references/alpha.md\ndescription: alpha",
      { "references/alpha.md": "alpha body" },
    );
    process.chdir(cwdDir);
    activateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude"],
      skillsDir,
      dryRun: false,
    });
    const result = activateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude"],
      skillsDir,
      dryRun: false,
    });
    assert.equal(result.ok, true);
    const claudeEntry = result.adapters.find((a) => a.adapter === "claude");
    assert.equal(claudeEntry.details.action, "updated");
    assert.equal(claudeEntry.details.changed, false);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(cwdDir, { recursive: true, force: true });
  }
});

test("activateCommand dry-run reports would-activate without writing files", () => {
  const skillsDir = makeSkillsDir();
  const cwdDir = makeSkillsDir();
  const originalCwd = process.cwd();
  try {
    writeSkill(
      skillsDir,
      "alpha",
      "name: stub:alpha\nhost-instructions: references/alpha.md\ndescription: alpha",
      { "references/alpha.md": "alpha body" },
    );
    process.chdir(cwdDir);
    const result = activateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude", "codex"],
      skillsDir,
      dryRun: true,
    });
    assert.equal(result.ok, true);
    for (const entry of result.adapters) {
      assert.equal(entry.status, "would-activate");
      assert.equal(entry.details.discoveredCount, 1);
      assert.deepEqual(entry.details.discovered, ["alpha"]);
    }
    assert.equal(fs.existsSync(path.join(cwdDir, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(cwdDir, "AGENTS.md")), false);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(cwdDir, { recursive: true, force: true });
  }
});

test("activateCommand reports failed entry for unknown --target", () => {
  const dir = makeSkillsDir();
  try {
    const result = activateCommand({
      repoRoot: dir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["bogus"],
      skillsDir: dir,
      dryRun: false,
    });
    assert.equal(result.ok, false);
    const entry = result.adapters[0];
    assert.equal(entry.status, "failed");
    assert.equal(entry.code, ERR_ARGS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("activateCommand throws CommandError(ERR_ARGS) without productConfig", () => {
  const dir = makeSkillsDir();
  try {
    assert.throws(
      () => activateCommand({
        repoRoot: dir,
        scope: "project",
        targets: ["claude"],
        skillsDir: dir,
        dryRun: false,
      }),
      (err) => err instanceof CommandError && err.code === ERR_ARGS,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runActivate throws on invalid --scope", async () => {
  const dir = makeSkillsDir();
  try {
    await assert.rejects(
      runActivate({ scope: "bogus", target: null, dryRun: false, json: false, skillsDir: null }, {
        repoRoot: dir,
        productConfig: STUB_PRODUCT,
      }),
      (err) => err instanceof CommandError && err.code === ERR_ACTIVATE_INVALID_SCOPE,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
