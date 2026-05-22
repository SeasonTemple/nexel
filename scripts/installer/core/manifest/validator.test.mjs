import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest, exitCodeFor, formatFindings } from "./validator.mjs";
import { loadManifest } from "./loader.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_MANIFEST = path.resolve(HERE, "../../../../examples/sample-product/sample.install.json");

test("validateManifest: the shipped sample.install.json is valid (zero findings)", () => {
  const m = loadManifest(SAMPLE_MANIFEST);
  const findings = validateManifest(m);
  assert.deepEqual(findings, [], `sample manifest should validate clean: ${JSON.stringify(findings)}`);
  assert.equal(exitCodeFor(findings), 0);
});

test("validateManifest: non-object → error finding, exit 1", () => {
  const findings = validateManifest(null);
  assert.ok(findings.length > 0);
  assert.equal(exitCodeFor(findings), 1);
});

test("validateManifest: wrong schemaVersion → error finding", () => {
  const m = loadManifest(SAMPLE_MANIFEST);
  const bad = { ...m, schemaVersion: 999 };
  const findings = validateManifest(bad);
  assert.ok(findings.some((f) => /schemaVersion/.test(f.message)), JSON.stringify(findings));
  assert.notEqual(exitCodeFor(findings), 0);
});

test("formatFindings: text and json modes", () => {
  const findings = validateManifest({});
  const text = formatFindings(findings, "text");
  assert.equal(typeof text, "string");
  const json = JSON.parse(formatFindings(findings, "json"));
  assert.equal(json.pass, false);
  assert.ok(Array.isArray(json.findings));
});

test("formatFindings: json pass:true on clean manifest", () => {
  const m = loadManifest(SAMPLE_MANIFEST);
  const json = JSON.parse(formatFindings(validateManifest(m), "json"));
  assert.equal(json.pass, true);
  assert.deepEqual(json.findings, []);
});

function makeRepoWithSkill(frontmatter, files = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-manifest-"));
  const skillDir = path.join(repoRoot, "skills", "ambient-review");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Ambient review\n`);
  for (const [relativePath, body] of Object.entries(files)) {
    const filePath = path.join(skillDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body);
  }
  const manifest = {
    schemaVersion: 1,
    skills: {
      "sample:ambient-review": {
        id: "sample:ambient-review",
        dirname: "ambient-review",
        sourcePath: "skills/ambient-review",
        category: "review",
        profile: "standalone",
        description: "Review skill with OpenCode ambient instructions.",
      },
    },
    agents: {},
    rules: {},
    bundles: {},
  };
  return { repoRoot, manifest };
}

test("validateManifest: opencode-instructions existing file passes for non-setup skill", () => {
  const { repoRoot, manifest } = makeRepoWithSkill(
    "name: sample:ambient-review\ncategory: review\nopencode-instructions: references/opencode-instructions.md\ndescription: test",
    { "references/opencode-instructions.md": "instructions" }
  );
  try {
    assert.deepEqual(validateManifest(manifest, {
      repoRoot,
      skillsDirAbs: path.join(repoRoot, "skills"),
      skillIdPrefix: "sample",
    }), []);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("validateManifest: opencode-instructions missing file fails when repoRoot is supplied", () => {
  const { repoRoot, manifest } = makeRepoWithSkill(
    "name: sample:ambient-review\ncategory: review\nopencode-instructions: references/missing.md\ndescription: test"
  );
  try {
    const findings = validateManifest(manifest, {
      repoRoot,
      skillsDirAbs: path.join(repoRoot, "skills"),
      skillIdPrefix: "sample",
    });
    assert.ok(findings.some((f) => /opencode-instructions file does not exist/.test(f.message)), JSON.stringify(findings));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
