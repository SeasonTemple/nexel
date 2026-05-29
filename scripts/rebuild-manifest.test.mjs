// rebuild-manifest — unit + check-mode tests.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execFileSync } from "node:child_process";

import { deriveManifest, serializeManifest, checkManifest, writeManifest } from "./rebuild-manifest.mjs";

const BIN = path.resolve(fileURLToPath(import.meta.url), "..", "rebuild-manifest.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(HERE, "..", "examples", "sample-product", "sample.install.json");

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rebuild-${label}-`));
}

function makeSkill(skillsDir, dirname, { name, category = "best-practice", description = "desc.", eol = "\n" } = {}) {
  const dir = path.join(skillsDir, dirname);
  fs.mkdirSync(dir, { recursive: true });
  const fm = `---${eol}name: ${name ?? `sample:${dirname}`}${eol}category: ${category}${eol}description: ${description}${eol}---${eol}${eol}# Body${eol}`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), fm);
}

// Build a minimal repo: <root>/skills/<dirs> + <root>/<manifest>.json
function makeRepo(skillDirs, manifest) {
  const root = tmp("repo");
  const skillsDir = path.join(root, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  for (const d of skillDirs) makeSkill(skillsDir, d.dirname, d);
  const manifestPath = path.join(root, "install.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { root, skillsDir, manifestPath };
}

const DERIVE_OPTS = (skillsDirAbs) => ({ skillsDirAbs, skillsDirRel: "skills", idPrefix: null });

// --- keystone: real serializer test (scrambled input → canonical) ---------

test("serializer reorders skill fields into canonical order (not a tautology)", () => {
  const { skillsDir } = makeRepo([{ dirname: "alpha", name: "sample:alpha", category: "tool" }], {});
  // existing entry with DELIBERATELY scrambled field order + authored description
  const existing = {
    schemaVersion: 1,
    skills: {
      "sample:alpha": {
        description: "AUTHORED desc",
        category: "tool",
        profile: "standalone",
        sourcePath: "skills/alpha",
        dirname: "alpha",
        id: "sample:alpha",
      },
    },
  };
  const { manifest, errors } = deriveManifest(existing, DERIVE_OPTS(skillsDir));
  assert.deepEqual(errors, []);
  const keys = Object.keys(manifest.skills["sample:alpha"]);
  assert.deepEqual(keys, ["id", "dirname", "sourcePath", "category", "profile", "description"]);
  // authored description preserved despite frontmatter saying "desc."
  assert.equal(manifest.skills["sample:alpha"].description, "AUTHORED desc");
});

// --- idempotency regression guard on the canonical sample ------------------

test("idempotent on the canonical sample manifest (byte-for-byte)", () => {
  const skillsDirAbs = path.resolve(HERE, "..", "examples", "sample-product", "skills");
  const existing = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
  const { manifest, errors } = deriveManifest(existing, { skillsDirAbs, skillsDirRel: "skills", idPrefix: "sample" });
  assert.deepEqual(errors, []);
  assert.equal(serializeManifest(manifest), fs.readFileSync(SAMPLE, "utf8"));
});

// --- new skill add ---------------------------------------------------------

test("new skill on disk is added; other entries' authored fields untouched", () => {
  const { skillsDir } = makeRepo(
    [
      { dirname: "kept", name: "sample:kept" },
      { dirname: "fresh", name: "sample:fresh", category: "setup", description: "Fresh skill desc." },
    ],
    {
      schemaVersion: 1,
      skills: {
        "sample:kept": { id: "sample:kept", dirname: "kept", sourcePath: "skills/kept", category: "best-practice", profile: "bundle", description: "AUTHORED kept" },
      },
    },
  );
  const { manifest } = deriveManifest(JSON.parse(fs.readFileSync(path.join(skillsDir, "..", "install.json"), "utf8")), DERIVE_OPTS(skillsDir));
  // existing kept: authored profile/description preserved
  assert.equal(manifest.skills["sample:kept"].profile, "bundle");
  assert.equal(manifest.skills["sample:kept"].description, "AUTHORED kept");
  // new fresh: seeded
  assert.equal(manifest.skills["sample:fresh"].profile, "standalone");
  assert.equal(manifest.skills["sample:fresh"].description, "Fresh skill desc.");
  assert.equal(manifest.skills["sample:fresh"].sourcePath, "skills/fresh");
});

// --- error paths -----------------------------------------------------------

test("orphaned manifest skill (dir gone) is a hard error, never dropped", () => {
  const { skillsDir } = makeRepo([{ dirname: "present", name: "sample:present" }], {});
  const existing = {
    schemaVersion: 1,
    skills: {
      "sample:present": { id: "sample:present", dirname: "present", sourcePath: "skills/present", category: "best-practice", profile: "standalone", description: "d" },
      "sample:gone": { id: "sample:gone", dirname: "gone", sourcePath: "skills/gone", category: "tool", profile: "standalone", description: "d" },
    },
  };
  const { manifest, errors } = deriveManifest(existing, DERIVE_OPTS(skillsDir));
  assert.equal(manifest, null);
  assert.ok(errors.some((e) => /sample:gone.*no SKILL\.md/.test(e.message)));
});

test("duplicate derived id is a hard error", () => {
  const { skillsDir } = makeRepo(
    [
      { dirname: "one", name: "sample:dup" },
      { dirname: "two", name: "sample:dup" },
    ],
    {},
  );
  const { manifest, errors } = deriveManifest({ schemaVersion: 1, skills: {} }, DERIVE_OPTS(skillsDir));
  assert.equal(manifest, null);
  assert.ok(errors.some((e) => /duplicate skill id "sample:dup"/.test(e.message)));
});

test("category not in enum is a hard error (not silently persisted)", () => {
  const { skillsDir } = makeRepo([{ dirname: "bad", name: "sample:bad", category: "nonsense" }], {});
  const { manifest, errors } = deriveManifest({ schemaVersion: 1, skills: {} }, DERIVE_OPTS(skillsDir));
  assert.equal(manifest, null);
  assert.ok(errors.some((e) => /category "nonsense" not in/.test(e.message)));
});

test("--id-prefix mismatch is a hard error", () => {
  const { skillsDir } = makeRepo([{ dirname: "x", name: "wrong:x" }], {});
  const { manifest, errors } = deriveManifest({ schemaVersion: 1, skills: {} }, { skillsDirAbs: skillsDir, skillsDirRel: "skills", idPrefix: "sample" });
  assert.equal(manifest, null);
  assert.ok(errors.some((e) => /does not match expected "sample:x"/.test(e.message)));
});

test("CRLF frontmatter parses identically to LF", () => {
  const { skillsDir } = makeRepo([{ dirname: "crlf", name: "sample:crlf", eol: "\r\n", description: "CRLF desc." }], {});
  const { manifest, errors } = deriveManifest({ schemaVersion: 1, skills: {} }, DERIVE_OPTS(skillsDir));
  assert.deepEqual(errors, []);
  assert.equal(manifest.skills["sample:crlf"].description, "CRLF desc.");
  assert.equal(manifest.skills["sample:crlf"].category, "best-practice");
});

// --- check / write modes ---------------------------------------------------

test("check: clean → 0, drift → 1, then write makes it clean", () => {
  const { skillsDir, manifestPath } = makeRepo(
    [{ dirname: "a", name: "sample:a" }],
    {
      schemaVersion: 1,
      skills: { "sample:a": { id: "sample:a", dirname: "a", sourcePath: "skills/a", category: "best-practice", profile: "standalone", description: "d" } },
      agents: {},
      rules: {},
      bundles: {},
    },
  );
  // canonicalize first (inline→multiline arrays etc. — here already canonical-ish; ensure stable)
  assert.equal(writeManifest(manifestPath).code, 0);
  assert.equal(checkManifest(manifestPath).code, 0);

  // introduce drift: add a new skill dir
  makeSkill(skillsDir, "b", { name: "sample:b", description: "B desc." });
  assert.equal(checkManifest(manifestPath).code, 1);

  assert.equal(writeManifest(manifestPath).code, 0);
  assert.equal(checkManifest(manifestPath).code, 0);
  const written = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.ok("sample:b" in written.skills);
});

test("deriveManifest emits canonical top-level key order regardless of input order", () => {
  const { skillsDir } = makeRepo([{ dirname: "a", name: "sample:a" }], {});
  // scrambled top-level order in the input
  const existing = { bundles: {}, skills: {}, rules: {}, schemaVersion: 1, agents: {}, $schemaDescription: "x" };
  const { manifest } = deriveManifest(existing, DERIVE_OPTS(skillsDir));
  assert.deepEqual(Object.keys(manifest), ["$schemaDescription", "schemaVersion", "skills", "agents", "rules", "bundles"]);
});

test("serializeManifest: 2-space indent + trailing newline", () => {
  const out = serializeManifest({ schemaVersion: 1, skills: {} });
  assert.ok(out.endsWith("}\n"));
  assert.match(out, /\n {2}"skills"/);
});

test("agents/rules/bundles sections always emitted (write cannot persist a manifest --check rejects)", () => {
  // input manifest omits all three sections entirely
  const { manifestPath } = makeRepo([{ dirname: "a", name: "sample:a" }], { schemaVersion: 1, skills: {} });
  assert.equal(writeManifest(manifestPath).code, 0);
  const written = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.deepEqual(written.agents, {});
  assert.deepEqual(written.rules, {});
  assert.deepEqual(written.bundles, {});
  // and the written file passes --check (write/check symmetry)
  assert.equal(checkManifest(manifestPath).code, 0);
});

test("multiple new skills appended in codepoint order", () => {
  const { skillsDir } = makeRepo(
    [
      { dirname: "zeta", name: "sample:zeta" },
      { dirname: "alpha", name: "sample:alpha" },
      { dirname: "mid", name: "sample:mid" },
    ],
    { schemaVersion: 1, skills: {} },
  );
  const { manifest } = deriveManifest({ schemaVersion: 1, skills: {} }, DERIVE_OPTS(skillsDir));
  assert.deepEqual(Object.keys(manifest.skills), ["sample:alpha", "sample:mid", "sample:zeta"]);
});

test("unknown authored skill field is preserved verbatim (after canonical fields)", () => {
  const { skillsDir } = makeRepo([{ dirname: "a", name: "sample:a" }], {});
  const existing = {
    schemaVersion: 1,
    skills: {
      "sample:a": { id: "sample:a", dirname: "a", sourcePath: "skills/a", category: "best-practice", profile: "standalone", description: "d", customTag: "keep-me" },
    },
  };
  const { manifest } = deriveManifest(existing, DERIVE_OPTS(skillsDir));
  assert.equal(manifest.skills["sample:a"].customTag, "keep-me");
  // appended after the known canonical fields
  assert.equal(Object.keys(manifest.skills["sample:a"]).at(-1), "customTag");
});

test("--check fails when a regenerated manifest has a dangling bundle reference", () => {
  // authored bundle references a skill id that does not exist → deriveManifest
  // preserves the bundle verbatim, validateManifest in the regenerate pipeline
  // catches the dangling ref (a byte diff alone would not).
  const { manifestPath } = makeRepo([{ dirname: "a", name: "sample:a" }], {
    schemaVersion: 1,
    skills: { "sample:a": { id: "sample:a", dirname: "a", sourcePath: "skills/a", category: "best-practice", profile: "standalone", description: "d" } },
    agents: {},
    rules: {},
    bundles: { b: { id: "b", description: "x", skills: ["sample:ghost"] } },
  });
  const r = checkManifest(manifestPath);
  assert.equal(r.code, 1);
  assert.match(r.message, /fails validation/);
});

test("writeManifest refuses (code 1, no write) on an orphaned manifest skill", () => {
  const { manifestPath } = makeRepo([{ dirname: "present", name: "sample:present" }], {
    schemaVersion: 1,
    skills: {
      "sample:present": { id: "sample:present", dirname: "present", sourcePath: "skills/present", category: "best-practice", profile: "standalone", description: "d" },
      "sample:gone": { id: "sample:gone", dirname: "gone", sourcePath: "skills/gone", category: "tool", profile: "standalone", description: "d" },
    },
    agents: {},
    rules: {},
    bundles: {},
  });
  const before = fs.readFileSync(manifestPath, "utf8");
  assert.equal(writeManifest(manifestPath).code, 1);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), before, "nothing written on error");
});

test("malformed frontmatter (missing name) is a hard error", () => {
  const skillsDir = path.join(tmp("repo"), "skills");
  fs.mkdirSync(path.join(skillsDir, "bad"), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, "bad", "SKILL.md"), "---\ncategory: tool\ndescription: x\n---\nbody\n");
  const { manifest, errors } = deriveManifest({ schemaVersion: 1, skills: {} }, DERIVE_OPTS(skillsDir));
  assert.equal(manifest, null);
  assert.ok(errors.some((e) => /missing\/invalid frontmatter "name"/.test(e.message)));
});

// --- main() spawn E2E ------------------------------------------------------

function runBin(args) {
  try {
    return { code: 0, stdout: execFileSync("node", [BIN, ...args], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

test("E2E main(): no --manifest → exit 2; check clean → 0; drift → 1", () => {
  // usage error
  assert.equal(runBin([]).code, 2);
  assert.equal(runBin(["--manifest=/no/such/file.json"]).code, 2);

  const { skillsDir, manifestPath } = makeRepo([{ dirname: "a", name: "sample:a" }], {
    schemaVersion: 1,
    skills: { "sample:a": { id: "sample:a", dirname: "a", sourcePath: "skills/a", category: "best-practice", profile: "standalone", description: "d" } },
    agents: {},
    rules: {},
    bundles: {},
  });
  assert.equal(runBin([`--manifest=${manifestPath}`]).code, 0); // write
  assert.equal(runBin([`--manifest=${manifestPath}`, "--check"]).code, 0); // clean
  makeSkill(skillsDir, "b", { name: "sample:b", description: "B." });
  assert.equal(runBin([`--manifest=${manifestPath}`, "--check"]).code, 1); // drift
});
