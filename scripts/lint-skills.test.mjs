import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  stripBom,
  extractFrontmatter,
  validateSkill,
  lintSkillsDir,
  exitCodeFor,
  format,
  VALID_CATEGORIES,
} from "./lint-skills.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "lint-skills.mjs");

// Helper: build a minimal valid frontmatter body for a given dirname.
// Tests that target one specific failure should override the relevant field.
function validFm(name, overrides = {}) {
  const fields = {
    name: `netops:${name}`,
    description: "valid description",
    category: "tool",
    ...overrides,
  };
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function validSkillFile(name, overrides = {}) {
  return `---\n${validFm(name, overrides)}\n---\nbody`;
}

function runCli(args, opts = {}) {
  return spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    cwd: opts.cwd || process.cwd(),
  });
}

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lint-skills-"));
}

function writeSkill(root, name, content) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), content);
}

// ---- stripBom ----

test("stripBom removes BOM when present", () => {
  assert.equal(stripBom("﻿hello"), "hello");
  assert.equal(stripBom("hello"), "hello");
  assert.equal(stripBom(""), "");
});

// ---- extractFrontmatter ----

test("extractFrontmatter: no frontmatter returns null", () => {
  assert.equal(extractFrontmatter("# Title\n\nbody"), null);
});

test("extractFrontmatter: handles CRLF", () => {
  const text = "---\r\nname: foo\r\n---\r\nbody";
  assert.equal(extractFrontmatter(text), "name: foo");
});

test("extractFrontmatter: handles BOM", () => {
  const text = "﻿---\nname: foo\n---\nbody";
  assert.equal(extractFrontmatter(text), "name: foo");
});

test("extractFrontmatter: ignores yaml code block in body", () => {
  const text =
    "---\nname: netops:e2e-testing\ndescription: x\n---\n# Body\n\n```yaml\nname: E2E Tests\n```\n";
  assert.equal(extractFrontmatter(text), "name: netops:e2e-testing\ndescription: x");
});

// ---- validateSkill: required fields baseline ----

test("validateSkill: valid skill returns no findings", () => {
  const findings = validateSkill("foo", validFm("foo"));
  assert.equal(findings.length, 0);
});

test("validateSkill: extra fields like trigger pass", () => {
  const findings = validateSkill("foo", validFm("foo") + "\ntrigger: /foo");
  assert.equal(findings.length, 0);
});

test("validateSkill: missing frontmatter (null)", () => {
  const findings = validateSkill("foo", null);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /missing frontmatter/);
});

test("validateSkill: empty frontmatter body", () => {
  const findings = validateSkill("foo", "   \n");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /empty frontmatter/);
});

test("validateSkill: YAML syntax error returns parse-error severity", () => {
  const findings = validateSkill("foo", "name: : :\n  broken: [unclosed\n");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "parse-error");
});

// ---- validateSkill: name field ----

test("validateSkill: missing name", () => {
  const findings = validateSkill("foo", validFm("foo", { name: undefined }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /missing required field: name/);
});

test("validateSkill: with --id-prefix, name without prefix fails", () => {
  const findings = validateSkill("foo", validFm("foo", { name: "foo" }), { idPrefix: "sample" });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /name mismatch/);
  assert.match(findings[0].message, /sample:foo/);
});

test("validateSkill: with --id-prefix, name prefix but wrong dirname fails", () => {
  const findings = validateSkill("foo", validFm("foo", { name: "sample:bar" }), { idPrefix: "sample" });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /name mismatch/);
});

test("validateSkill: without --id-prefix, any non-empty string name passes", () => {
  const findings = validateSkill("foo", validFm("foo", { name: "anything-goes" }));
  assert.equal(findings.length, 0);
});

test("validateSkill: numeric name is rejected", () => {
  const findings = validateSkill("foo", validFm("foo", { name: 42 }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /name must be a string/);
});

test("validateSkill: empty name string", () => {
  const findings = validateSkill("foo", validFm("foo", { name: '""' }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /missing required field: name/);
});

// ---- validateSkill: description field ----

test("validateSkill: missing description", () => {
  const findings = validateSkill("foo", validFm("foo", { description: undefined }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /missing required field: description/);
});

test("validateSkill: empty description string", () => {
  const findings = validateSkill("foo", validFm("foo", { description: '""' }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /empty required field: description/);
});

test("validateSkill: numeric description rejected", () => {
  const findings = validateSkill("foo", validFm("foo", { description: 42 }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /description must be a string/);
});

// ---- validateSkill: category field ----

test("validateSkill: VALID_CATEGORIES exports the canonical six-bucket set", () => {
  assert.deepEqual(
    [...VALID_CATEGORIES].sort(),
    ["best-practice", "principle", "review", "setup", "test", "tool"]
  );
});

test("validateSkill: missing category", () => {
  const findings = validateSkill("foo", validFm("foo", { category: undefined }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /missing required field: category/);
});

test("validateSkill: invalid category enum value", () => {
  const findings = validateSkill("foo", validFm("foo", { category: "infra" }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /category mismatch/);
  assert.match(findings[0].message, /infra/);
});

test("validateSkill: numeric category rejected", () => {
  const findings = validateSkill("foo", validFm("foo", { category: 42 }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /category must be a string/);
});

test("validateSkill: each canonical category value passes", () => {
  for (const cat of VALID_CATEGORIES) {
    const findings = validateSkill("foo", validFm("foo", { category: cat }));
    assert.equal(findings.length, 0, `category ${cat} should pass`);
  }
});

// ---- lintSkillsDir ----

test("lintSkillsDir: valid dir of valid skills returns findings + scanned", () => {
  const tmp = makeTmp();
  try {
    writeSkill(tmp, "foo", validSkillFile("foo"));
    writeSkill(tmp, "bar", validSkillFile("bar"));
    const result = lintSkillsDir(tmp);
    assert.equal(result.findings.length, 0);
    assert.equal(result.scanned, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("lintSkillsDir: directory with no SKILL.md", () => {
  const tmp = makeTmp();
  try {
    fs.mkdirSync(path.join(tmp, "foo"));
    const result = lintSkillsDir(tmp);
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0].message, /SKILL.md missing/);
    assert.equal(result.scanned, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("lintSkillsDir: missing skills directory includes path in message", () => {
  const result = lintSkillsDir("/nonexistent/path/to/skills/xyz");
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].message, /skills directory not found/);
  assert.match(result.findings[0].message, /nonexistent.*skills.*xyz/);
  assert.equal(result.scanned, 0);
});

test("lintSkillsDir: mixed valid and invalid skills all flagged (with idPrefix)", () => {
  const tmp = makeTmp();
  try {
    writeSkill(tmp, "good", validSkillFile("good"));
    writeSkill(tmp, "bad-name", validSkillFile("bad-name", { name: "bad-name" }));
    writeSkill(tmp, "bad-cat", validSkillFile("bad-cat", { category: "infra" }));
    // With idPrefix="netops", "bad-name" frontmatter name "bad-name"
    // (missing the netops: prefix) is flagged in addition to the
    // unknown category in "bad-cat".
    const result = lintSkillsDir(tmp, { idPrefix: "netops" });
    assert.equal(result.scanned, 3);
    assert.equal(result.findings.length, 2);
    const files = result.findings.map((f) => f.file);
    assert.ok(files.some((f) => f.includes("bad-name")));
    assert.ok(files.some((f) => f.includes("bad-cat")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- exitCodeFor ----

test("exitCodeFor: 0 when no findings", () => {
  assert.equal(exitCodeFor([]), 0);
});

test("exitCodeFor: 1 when error findings only", () => {
  assert.equal(exitCodeFor([{ severity: "error" }]), 1);
});

test("exitCodeFor: 2 when parse-error present", () => {
  assert.equal(
    exitCodeFor([{ severity: "error" }, { severity: "parse-error" }]),
    2
  );
});

// ---- format ----

test("format: json mode returns valid JSON array", () => {
  const out = format(
    [{ file: "x", severity: "error", message: "msg" }],
    "json"
  );
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].file, "x");
});

test("format: text mode one line per finding", () => {
  const out = format(
    [
      { file: "a", severity: "error", message: "m1" },
      { file: "b", severity: "error", message: "m2" },
    ],
    "text"
  );
  assert.equal(out.split("\n").length, 2);
});

// ---- main() CLI integration tests via spawnSync ----

function makeFixtureSkillsDir() {
  const tmp = makeTmp();
  const skillsDir = path.join(tmp, "skills");
  fs.mkdirSync(skillsDir);
  return { tmp, skillsDir };
}

test("main: --json on valid fixture exits 0 with parseable success envelope on stdout", () => {
  const { tmp, skillsDir } = makeFixtureSkillsDir();
  try {
    writeSkill(skillsDir, "foo", validSkillFile("foo"));
    writeSkill(skillsDir, "bar", validSkillFile("bar"));
    const r = runCli(["--json", `--dir=${skillsDir}`]);
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.pass, true);
    assert.equal(parsed.scanned, 2);
    assert.deepEqual(parsed.findings, []);
    assert.equal(r.stderr, "");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("main: --json on broken fixture exits 1 with parseable failure envelope on stdout", () => {
  const { tmp, skillsDir } = makeFixtureSkillsDir();
  try {
    writeSkill(skillsDir, "good", validSkillFile("good"));
    writeSkill(skillsDir, "bad-name", validSkillFile("bad-name", { name: "bad-name" }));
    const r = runCli(["--json", `--dir=${skillsDir}`, "--id-prefix=netops"]);
    assert.equal(r.status, 1);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.pass, false);
    assert.equal(parsed.scanned, 2);
    assert.equal(parsed.findings.length, 1);
    assert.match(parsed.findings[0].message, /name mismatch/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("main: text mode sends OK to stderr, stdout empty", () => {
  const { tmp, skillsDir } = makeFixtureSkillsDir();
  try {
    writeSkill(skillsDir, "foo", validSkillFile("foo"));
    const r = runCli([`--dir=${skillsDir}`]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /OK skills lint passed \(1 skills?\)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("main: text mode sends findings to stderr on failure", () => {
  const { tmp, skillsDir } = makeFixtureSkillsDir();
  try {
    writeSkill(skillsDir, "broken", validSkillFile("broken", { name: "not-prefixed" }));
    const r = runCli([`--dir=${skillsDir}`, "--id-prefix=netops"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /name mismatch/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("main: --quiet suppresses all output, exit code only", () => {
  const { tmp, skillsDir } = makeFixtureSkillsDir();
  try {
    writeSkill(skillsDir, "broken", validSkillFile("broken", { name: "not-prefixed" }));
    const r = runCli(["--quiet", `--dir=${skillsDir}`, "--id-prefix=netops"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("main: exit 2 on YAML parse error", () => {
  const { tmp, skillsDir } = makeFixtureSkillsDir();
  try {
    writeSkill(skillsDir, "bad-yaml", "---\nname: : :\n  invalid: [unclosed\n---\n");
    const r = runCli([`--dir=${skillsDir}`]);
    assert.equal(r.status, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("main: --dir override respected; missing dir reports resolved path", () => {
  const r = runCli(["--json", "--dir=/definitely-nonexistent-xyz123"]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.pass, false);
  assert.match(parsed.findings[0].message, /skills directory not found/);
  assert.match(parsed.findings[0].message, /definitely-nonexistent-xyz123/);
});
