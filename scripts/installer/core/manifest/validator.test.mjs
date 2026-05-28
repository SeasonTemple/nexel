import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest, exitCodeFor, formatFindings } from "./validator.mjs";
import { loadManifest } from "./loader.mjs";
import {
  registerValidatorRule,
  _resetRegistryForTests,
} from "../registry.mjs";

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

test("validateManifest: host-instructions missing file error message cites host-instructions key (T-06 v0.8.2 fixup)", () => {
  const { repoRoot, manifest } = makeRepoWithSkill(
    "name: sample:ambient-review\ncategory: review\nhost-instructions: references/missing.md\ndescription: test"
  );
  try {
    const findings = validateManifest(manifest, {
      repoRoot,
      skillsDirAbs: path.join(repoRoot, "skills"),
      skillIdPrefix: "sample",
    });
    assert.ok(
      findings.some((f) => /host-instructions file does not exist/.test(f.message)),
      `expected message to cite host-instructions, got: ${JSON.stringify(findings)}`,
    );
    // And NOT mis-cite opencode-instructions when the violation is on host-instructions.
    assert.ok(
      !findings.some((f) => /opencode-instructions file does not exist/.test(f.message)),
      `host-instructions violation should not mention opencode-instructions: ${JSON.stringify(findings)}`,
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

// Note: validator.mjs has a path-escape branch (startsWith(skillDir + sep)
// check) but isValidRelativeSkillPath in skill-metadata.mjs filters values
// containing `..` segments BEFORE the branch runs, making the branch
// functionally unreachable from any frontmatter value the predicate accepts.
// A test attempting to exercise that branch would be a false-positive
// assertion; we therefore cover only the reachable branch (missing-file)
// above and document this as a known unreachable code path. Eliminating
// the branch is a v0.8.x+ cleanup candidate.

// -----------------------------------------------------------------------
// Pluggable Validator Rule Registry integration (ADR-0016).
//
// Every test in this block calls `_resetRegistryForTests()` first AND at
// the end so neither precondition nor postcondition leaks into other
// suites (the registry is a module-scope singleton).
// -----------------------------------------------------------------------

function withRegistryReset(fn) {
  _resetRegistryForTests();
  try {
    fn();
  } finally {
    _resetRegistryForTests();
  }
}

test("validateManifest: registry — with no rules registered, behavior identical to v0.8.5", () => {
  withRegistryReset(() => {
    const m = loadManifest(SAMPLE_MANIFEST);
    const findings = validateManifest(m);
    assert.deepEqual(findings, []);
    assert.equal(exitCodeFor(findings), 0);
  });
});

test("validateManifest: registry — manifest-scope rule runs exactly once per validateManifest call", () => {
  withRegistryReset(() => {
    let invocations = 0;
    let lastSubject = null;
    registerValidatorRule({
      id: "test-manifest-rule",
      appliesTo: "manifest",
      check: (subject) => {
        invocations += 1;
        lastSubject = subject;
        return [];
      },
    });
    const m = loadManifest(SAMPLE_MANIFEST);
    validateManifest(m);
    assert.equal(invocations, 1);
    assert.equal(lastSubject, m, "manifest-scope check receives the manifest object");
  });
});

test("validateManifest: registry — skill-scope rule iterates every entry in manifest.skills", () => {
  withRegistryReset(() => {
    const seenIds = [];
    registerValidatorRule({
      id: "test-skill-rule",
      appliesTo: "skill",
      check: (skill) => {
        seenIds.push(skill && skill.id);
        return [];
      },
    });
    const m = loadManifest(SAMPLE_MANIFEST);
    validateManifest(m);
    const expected = Object.values(m.skills).map((s) => s.id);
    assert.deepEqual(seenIds, expected, "skill-scope rule visits every manifest.skills entry in order");
  });
});

test("validateManifest: registry — rule emitting findings appears in output; exitCodeFor returns 1", () => {
  withRegistryReset(() => {
    registerValidatorRule({
      id: "test-emit-error",
      appliesTo: "manifest",
      check: () => [
        { severity: "error", section: "custom", id: "x1", message: "policy violation" },
      ],
    });
    const m = loadManifest(SAMPLE_MANIFEST);
    const findings = validateManifest(m);
    const ours = findings.filter((f) => f.section === "custom");
    assert.equal(ours.length, 1);
    assert.equal(ours[0].id, "x1");
    assert.equal(ours[0].severity, "error");
    assert.equal(ours[0].message, "policy violation");
    assert.equal(exitCodeFor(findings), 1);
  });
});

test("validateManifest: registry — rule emitting parse-error → exitCodeFor returns 2", () => {
  withRegistryReset(() => {
    registerValidatorRule({
      id: "test-emit-parse",
      appliesTo: "manifest",
      check: () => [
        { severity: "parse-error", section: "custom", id: null, message: "unparseable" },
      ],
    });
    const m = loadManifest(SAMPLE_MANIFEST);
    const findings = validateManifest(m);
    assert.equal(exitCodeFor(findings), 2);
  });
});

test("validateManifest: registry — malformed rule output → parse-error with section 'registry' and rule id", () => {
  withRegistryReset(() => {
    registerValidatorRule({
      id: "test-malformed",
      appliesTo: "manifest",
      check: () => [
        // missing `message` and `section` — must be quarantined by validator
        { severity: "error", id: "x" },
      ],
    });
    const m = loadManifest(SAMPLE_MANIFEST);
    const findings = validateManifest(m);
    const quarantined = findings.filter(
      (f) => f.section === "registry" && f.id === "test-malformed",
    );
    assert.equal(quarantined.length, 1);
    assert.equal(quarantined[0].severity, "parse-error");
    assert.match(quarantined[0].message, /test-malformed/);
    // exit code: parse-error wins
    assert.equal(exitCodeFor(findings), 2);
  });
});

test("validateManifest: registry — productConfig threaded into rule ctx", () => {
  withRegistryReset(() => {
    let receivedCtx = null;
    registerValidatorRule({
      id: "test-ctx",
      appliesTo: "manifest",
      check: (_subject, ctx) => {
        receivedCtx = ctx;
        return [];
      },
    });
    const m = loadManifest(SAMPLE_MANIFEST);
    const stubConfig = { productName: "stub", skillIdPrefix: "stub" };
    validateManifest(m, { productConfig: stubConfig });
    assert.ok(receivedCtx, "rule ctx must be provided");
    assert.equal(receivedCtx.productConfig, stubConfig);
    assert.equal(Object.isFrozen(receivedCtx), true, "ctx is frozen");
  });
});
