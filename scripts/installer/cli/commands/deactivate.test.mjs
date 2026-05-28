import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { deactivateCommand, runDeactivate } from "./deactivate.mjs";
import { activateCommand } from "./activate.mjs";
import { CommandError } from "./index.mjs";
import {
  ERR_ARGS,
  ERR_DEACTIVATE_OPENCODE_REFUSED,
  ERR_DEACTIVATE_INVALID_SCOPE,
} from "../../core/errors.mjs";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-deactivate-cmd-"));
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

test("deactivateCommand returns refused entry for opencode target", () => {
  const dir = makeTempDir();
  try {
    const result = deactivateCommand({
      repoRoot: dir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["opencode"],
      dryRun: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.adapters.length, 1);
    const entry = result.adapters[0];
    assert.equal(entry.adapter, "opencode");
    assert.equal(entry.status, "refused");
    assert.equal(entry.code, ERR_DEACTIVATE_OPENCODE_REFUSED);
    assert.ok(entry.details.reason.includes("opencode-plugin"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deactivateCommand removes claude + codex fences with default targets", () => {
  const skillsDir = makeTempDir();
  const cwdDir = makeTempDir();
  const originalCwd = process.cwd();
  try {
    writeSkill(
      skillsDir,
      "alpha",
      "name: stub:alpha\ncategory: setup\nhost-instructions: references/alpha.md\ndescription: alpha",
      { "references/alpha.md": "alpha body" },
    );
    process.chdir(cwdDir);
    // First activate to lay down the fences.
    const activated = activateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude", "codex"],
      skillsDir,
      dryRun: false,
    });
    assert.equal(activated.ok, true);
    assert.ok(fs.existsSync(path.join(cwdDir, "CLAUDE.md")));
    assert.ok(fs.existsSync(path.join(cwdDir, "AGENTS.md")));

    const result = deactivateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude", "codex"],
      dryRun: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.adapters.length, 2);
    for (const entry of result.adapters) {
      assert.equal(entry.status, "deactivated");
      assert.equal(entry.details.action, "removed");
      assert.equal(entry.details.changed, true);
    }
    // Files still exist (created above) but should no longer contain a fence
    // for this product.
    const claudeAfter = fs.readFileSync(path.join(cwdDir, "CLAUDE.md"), "utf8");
    const agentsAfter = fs.readFileSync(path.join(cwdDir, "AGENTS.md"), "utf8");
    assert.ok(!claudeAfter.includes("nexel:stub-product"), "claude fence removed");
    assert.ok(!agentsAfter.includes("nexel:stub-product"), "codex fence removed");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(cwdDir, { recursive: true, force: true });
  }
});

test("deactivateCommand is idempotent (second run reports noop)", () => {
  const skillsDir = makeTempDir();
  const cwdDir = makeTempDir();
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
    deactivateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude"],
      dryRun: false,
    });
    const second = deactivateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude"],
      dryRun: false,
    });
    assert.equal(second.ok, true);
    const claudeEntry = second.adapters.find((a) => a.adapter === "claude");
    assert.equal(claudeEntry.status, "deactivated");
    assert.equal(claudeEntry.details.action, "noop");
    assert.equal(claudeEntry.details.changed, false);
    assert.ok(typeof claudeEntry.details.reason === "string" && claudeEntry.details.reason.length > 0);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(cwdDir, { recursive: true, force: true });
  }
});

test("deactivateCommand dry-run reports would-deactivate without writing files", () => {
  const skillsDir = makeTempDir();
  const cwdDir = makeTempDir();
  const originalCwd = process.cwd();
  try {
    writeSkill(
      skillsDir,
      "alpha",
      "name: stub:alpha\nhost-instructions: references/alpha.md\ndescription: alpha",
      { "references/alpha.md": "alpha body" },
    );
    process.chdir(cwdDir);
    // Activate first so claude has a fence; codex doesn't (no activate run).
    activateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude"],
      skillsDir,
      dryRun: false,
    });
    const claudeBefore = fs.readFileSync(path.join(cwdDir, "CLAUDE.md"), "utf8");

    const result = deactivateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude", "codex"],
      dryRun: true,
    });
    assert.equal(result.ok, true);
    const claudeEntry = result.adapters.find((a) => a.adapter === "claude");
    const codexEntry = result.adapters.find((a) => a.adapter === "codex");
    assert.equal(claudeEntry.status, "would-deactivate");
    assert.equal(claudeEntry.details.hasFence, true);
    assert.equal(codexEntry.status, "would-deactivate");
    assert.equal(codexEntry.details.hasFence, false);
    // File untouched.
    assert.equal(fs.readFileSync(path.join(cwdDir, "CLAUDE.md"), "utf8"), claudeBefore);
    assert.equal(fs.existsSync(path.join(cwdDir, "AGENTS.md")), false);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.rmSync(cwdDir, { recursive: true, force: true });
  }
});

test("deactivateCommand reports failed entry for unknown --target", () => {
  const dir = makeTempDir();
  try {
    const result = deactivateCommand({
      repoRoot: dir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["bogus"],
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

test("deactivateCommand throws CommandError(ERR_ARGS) without productConfig", () => {
  const dir = makeTempDir();
  try {
    assert.throws(
      () => deactivateCommand({
        repoRoot: dir,
        scope: "project",
        targets: ["claude"],
        dryRun: false,
      }),
      (err) => err instanceof CommandError && err.code === ERR_ARGS,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runDeactivate throws on invalid --scope", async () => {
  const dir = makeTempDir();
  try {
    await assert.rejects(
      runDeactivate({ scope: "bogus", target: null, dryRun: false, json: false }, {
        repoRoot: dir,
        productConfig: STUB_PRODUCT,
      }),
      (err) => err instanceof CommandError && err.code === ERR_DEACTIVATE_INVALID_SCOPE,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deactivateCommand on file with no fence for this product returns noop", () => {
  const cwdDir = makeTempDir();
  const originalCwd = process.cwd();
  try {
    process.chdir(cwdDir);
    // CLAUDE.md exists with prose but no fence for stub-product.
    fs.writeFileSync(path.join(cwdDir, "CLAUDE.md"), "# user prose\n\nNothing managed here.\n");
    const before = fs.readFileSync(path.join(cwdDir, "CLAUDE.md"), "utf8");

    const result = deactivateCommand({
      repoRoot: cwdDir,
      productConfig: STUB_PRODUCT,
      scope: "project",
      targets: ["claude"],
      dryRun: false,
    });
    assert.equal(result.ok, true);
    const entry = result.adapters[0];
    assert.equal(entry.status, "deactivated");
    assert.equal(entry.details.action, "noop");
    assert.equal(entry.details.changed, false);
    assert.equal(entry.details.reason, "no fence for this product");
    // User prose preserved byte-identically.
    assert.equal(fs.readFileSync(path.join(cwdDir, "CLAUDE.md"), "utf8"), before);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(cwdDir, { recursive: true, force: true });
  }
});
