// @nexel/vendor MVP — unit + spawn-E2E suite.
//
// Library tests exercise planPull/applyPull/pull/planDiff/fork against
// mkdtemp upstream + target dirs (never mutating the committed fixture).
// A small spawn-E2E drives bin.mjs end-to-end through a temp config.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import * as vendor from "./vendor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "bin.mjs");
const PREFIX = "sample";

// --- fixtures -------------------------------------------------------------

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `vendor-${label}-`));
}

function writeUpstream(root, { name = "upstream:greeter", body = "# Greeter\n", note = "notes\n" } = {}) {
  const dir = path.join(root, "skills", "greeter");
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ncategory: best-practice\ndescription: fixture.\n---\n\n${body}`,
  );
  fs.writeFileSync(path.join(dir, "references", "notes.md"), note);
  return root;
}

function makeEnv(opts = {}) {
  const upstream = writeUpstream(tmp("up"), opts);
  const targetSkillsDir = tmp("tgt");
  const entry = {
    source: upstream,
    path: "skills/greeter",
    as: "vendored-greeter",
    divergencePolicy: "manual-merge",
  };
  const ctx = { skillIdPrefix: PREFIX, targetSkillsDir };
  const targetDir = path.join(targetSkillsDir, entry.as);
  return { upstream, targetSkillsDir, targetDir, entry, ctx };
}

const STAMP = "2026-05-29T00:00:00.000Z";

// VendorError carries the code on `.code`, not in the message.
const code = (c) => (e) => e instanceof vendor.VendorError && e.code === c;

// --- hashPayload ----------------------------------------------------------

test("hashPayload: deterministic + order-independent", () => {
  const a = [
    { relpath: "SKILL.md", bytes: Buffer.from("x") },
    { relpath: "references/n.md", bytes: Buffer.from("y") },
  ];
  const b = [a[1], a[0]];
  assert.equal(vendor.hashPayload(a), vendor.hashPayload(b));
});

test("hashPayload: excludes the sidecar", () => {
  const base = [{ relpath: "SKILL.md", bytes: Buffer.from("x") }];
  const withSidecar = [...base, { relpath: vendor.SIDECAR_NAME, bytes: Buffer.from("{}") }];
  assert.equal(vendor.hashPayload(base), vendor.hashPayload(withSidecar));
});

test("hashPayload: content change flips the hash", () => {
  const a = [{ relpath: "SKILL.md", bytes: Buffer.from("x") }];
  const b = [{ relpath: "SKILL.md", bytes: Buffer.from("y") }];
  assert.notEqual(vendor.hashPayload(a), vendor.hashPayload(b));
});

// --- rewriteName ----------------------------------------------------------

test("rewriteName: surgical — only name changes, body + other keys preserved", () => {
  const src = `---\nname: upstream:greeter\ncategory: best-practice\ndescription: keep me.\n---\n\n# Body\nline2\n`;
  const out = vendor.rewriteName(src, "sample:vendored-greeter");
  assert.match(out, /^name: sample:vendored-greeter$/m);
  assert.doesNotMatch(out, /upstream:greeter/);
  assert.match(out, /category: best-practice/);
  assert.match(out, /description: keep me\./);
  assert.ok(out.endsWith("# Body\nline2\n"));
});

test("rewriteName: handles quoted name value", () => {
  const src = `---\nname: "upstream:greeter"\n---\nbody`;
  assert.match(vendor.rewriteName(src, "sample:x"), /^name: sample:x$/m);
});

test("rewriteName: throws on missing frontmatter / missing name", () => {
  assert.throws(() => vendor.rewriteName("# no fm\n", "sample:x"), code("ERR_NO_FRONTMATTER"));
  assert.throws(() => vendor.rewriteName("---\ncategory: x\n---\nb", "sample:x"), code("ERR_NO_NAME"));
});

test("readName: reads value", () => {
  assert.equal(vendor.readName("name: upstream:greeter\ncategory: x"), "upstream:greeter");
});

// --- pull: fresh ----------------------------------------------------------

test("pull fresh: writes rewritten payload + sidecar with post-rewrite hash", () => {
  const { entry, ctx, targetDir } = makeEnv();
  const d = vendor.pull(entry, ctx, { vendoredAt: STAMP });
  assert.equal(d.action, "fresh");

  const skill = fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf8");
  assert.match(skill, /^name: sample:vendored-greeter$/m);
  assert.ok(fs.existsSync(path.join(targetDir, "references", "notes.md")), "references copied");

  const sidecar = JSON.parse(fs.readFileSync(path.join(targetDir, vendor.SIDECAR_NAME), "utf8"));
  assert.equal(sidecar.schema, vendor.SIDECAR_SCHEMA);
  assert.equal(sidecar.divergencePolicy, "manual-merge");
  assert.equal(sidecar.rewrite.namePrefix, PREFIX);
  assert.equal(sidecar.vendoredAt, STAMP);
  // hash is over the REWRITTEN payload == current on-disk payload.
  assert.equal(sidecar.originHash, vendor.hashPayload(vendor.readPayload(targetDir)));
});

// --- pull: clean re-run ---------------------------------------------------

test("pull clean re-run: up-to-date, sidecar stable", () => {
  const { entry, ctx, targetDir } = makeEnv();
  vendor.pull(entry, ctx, { vendoredAt: STAMP });
  const before = fs.readFileSync(path.join(targetDir, vendor.SIDECAR_NAME), "utf8");

  const d = vendor.pull(entry, ctx, { vendoredAt: "2099-01-01T00:00:00.000Z" });
  assert.equal(d.action, "up-to-date");
  // up-to-date must NOT rewrite the sidecar (stamp would have changed).
  assert.equal(fs.readFileSync(path.join(targetDir, vendor.SIDECAR_NAME), "utf8"), before);
});

// --- pull: fast-forward ---------------------------------------------------

test("pull fast-forward: origin changed, local clean → overwrite + bump", () => {
  const { entry, ctx, targetDir, upstream } = makeEnv();
  vendor.pull(entry, ctx, { vendoredAt: STAMP });

  // Upstream gains a new body line.
  writeUpstream(upstream, { body: "# Greeter v2\nnew line\n" });
  const d = vendor.pull(entry, ctx, { vendoredAt: "2026-06-01T00:00:00.000Z" });
  assert.equal(d.action, "fast-forward");

  const skill = fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf8");
  assert.match(skill, /Greeter v2/);
  assert.match(skill, /^name: sample:vendored-greeter$/m); // prefix still rewritten
  const sidecar = JSON.parse(fs.readFileSync(path.join(targetDir, vendor.SIDECAR_NAME), "utf8"));
  assert.equal(sidecar.vendoredAt, "2026-06-01T00:00:00.000Z");
});

test("fast-forward prunes a file deleted upstream", () => {
  const { entry, ctx, targetDir, upstream } = makeEnv();
  vendor.pull(entry, ctx, { vendoredAt: STAMP });
  assert.ok(fs.existsSync(path.join(targetDir, "references", "notes.md")));

  fs.rmSync(path.join(upstream, "skills", "greeter", "references", "notes.md"));
  vendor.pull(entry, ctx, { vendoredAt: STAMP });
  assert.ok(!fs.existsSync(path.join(targetDir, "references", "notes.md")), "deleted upstream → pruned");
});

// --- pull: conflict -------------------------------------------------------

test("pull local-modified: conflict, no write, diff + attribution", () => {
  const { entry, ctx, targetDir } = makeEnv();
  vendor.pull(entry, ctx, { vendoredAt: STAMP });

  // Local edit to a vendored file.
  const skillPath = path.join(targetDir, "SKILL.md");
  fs.writeFileSync(skillPath, fs.readFileSync(skillPath, "utf8") + "\nLOCAL EDIT\n");
  const dirty = fs.readFileSync(skillPath, "utf8");

  const d = vendor.planPull(entry, ctx);
  assert.equal(d.action, "conflict");
  assert.equal(d.attribution, "local-only");
  assert.ok(d.diff.includes("LOCAL EDIT"));

  // applyPull refuses; on-disk untouched.
  assert.throws(() => vendor.applyPull(entry, ctx, d, STAMP), code("ERR_CONFLICT"));
  assert.equal(fs.readFileSync(skillPath, "utf8"), dirty);
});

test("pull conflict attribution 'both' when origin also changed", () => {
  const { entry, ctx, targetDir, upstream } = makeEnv();
  vendor.pull(entry, ctx, { vendoredAt: STAMP });

  fs.appendFileSync(path.join(targetDir, "SKILL.md"), "\nLOCAL\n");
  writeUpstream(upstream, { body: "# Greeter origin-moved\n" });

  const d = vendor.planPull(entry, ctx);
  assert.equal(d.action, "conflict");
  assert.equal(d.attribution, "both");
});

// --- pull: dry-run --------------------------------------------------------

test("pull --dry-run: never writes", () => {
  const { entry, ctx, targetDir } = makeEnv();
  const d = vendor.pull(entry, ctx, { dryRun: true, vendoredAt: STAMP });
  assert.equal(d.action, "fresh");
  assert.ok(!fs.existsSync(targetDir), "dry-run wrote nothing");
});

// --- diff -----------------------------------------------------------------

test("diff: not-vendored / clean / differs", () => {
  const { entry, ctx, targetDir } = makeEnv();
  assert.equal(vendor.planDiff(entry, ctx).action, "not-vendored");

  vendor.pull(entry, ctx, { vendoredAt: STAMP });
  assert.equal(vendor.planDiff(entry, ctx).action, "clean");

  fs.appendFileSync(path.join(targetDir, "SKILL.md"), "\nedit\n");
  const d = vendor.planDiff(entry, ctx);
  assert.equal(d.action, "differs");
  assert.ok(d.diff.includes("edit"));
});

// --- fork -----------------------------------------------------------------

test("fork: removes sidecar, keeps payload; second fork errors", () => {
  const { entry, ctx, targetDir } = makeEnv();
  vendor.pull(entry, ctx, { vendoredAt: STAMP });

  const d = vendor.fork(entry, ctx);
  assert.equal(d.action, "forked");
  assert.ok(!fs.existsSync(path.join(targetDir, vendor.SIDECAR_NAME)), "sidecar gone");
  assert.ok(fs.existsSync(path.join(targetDir, "SKILL.md")), "payload kept");

  assert.throws(() => vendor.fork(entry, ctx), code("ERR_NOT_VENDORED"));
});

// --- origin validation ----------------------------------------------------

test("resolveOrigin errors: missing origin / missing SKILL.md", () => {
  const targetSkillsDir = tmp("tgt");
  const ctx = { skillIdPrefix: PREFIX, targetSkillsDir };
  assert.throws(
    () => vendor.planPull({ source: "/nope", path: "x", as: "y" }, ctx),
    code("ERR_NO_ORIGIN"),
  );

  const up = tmp("up");
  fs.mkdirSync(path.join(up, "skills", "empty"), { recursive: true });
  fs.writeFileSync(path.join(up, "skills", "empty", "README.md"), "no skill");
  assert.throws(
    () => vendor.planPull({ source: up, path: "skills/empty", as: "y" }, ctx),
    code("ERR_NO_SKILL_MD"),
  );
});

// --- byte preservation (P0 regression guard) ------------------------------

test("rewriteName preserves bytes outside the name line — no blank line after fence", () => {
  const src = "---\nname: upstream:greeter\ncategory: best-practice\n---\n# Heading immediately\nbody\n";
  const out = vendor.rewriteName(src, "sample:x");
  assert.equal(out, "---\nname: sample:x\ncategory: best-practice\n---\n# Heading immediately\nbody\n");
  // Output must still be re-parseable (a second rewrite must not throw).
  assert.doesNotThrow(() => vendor.rewriteName(out, "sample:y"));
});

test("rewriteName preserves CRLF line endings and the post-fence blank line", () => {
  const src = "---\r\nname: upstream:greeter\r\ncategory: x\r\n---\r\n\r\n# Body\r\n";
  const out = vendor.rewriteName(src, "sample:x");
  assert.equal(out, "---\r\nname: sample:x\r\ncategory: x\r\n---\r\n\r\n# Body\r\n");
  assert.equal(vendor.readName("name: sample:x\r"), "sample:x"); // no trailing CR leaks into value
});

test("rewriteName: single-quoted and apostrophe-containing names", () => {
  assert.match(vendor.rewriteName("---\nname: 'upstream:greeter'\n---\nb", "sample:x"), /^name: sample:x$/m);
  assert.equal(vendor.readName("name: o'brien-skill"), "o'brien-skill");
});

// --- path traversal defense ------------------------------------------------

test("path traversal: as with separators/.. is rejected", () => {
  const { entry, ctx } = makeEnv();
  for (const bad of ["../../etc", "a/b", "..", "."]) {
    assert.throws(() => vendor.planPull({ ...entry, as: bad }, ctx), code("ERR_UNSAFE_AS"));
  }
});

test("path traversal: entry.path escaping source is rejected", () => {
  const { entry, ctx } = makeEnv();
  assert.throws(() => vendor.planPull({ ...entry, path: "../../../etc" }, ctx), code("ERR_UNSAFE_PATH"));
  assert.throws(() => vendor.planPull({ ...entry, path: "/etc/passwd" }, ctx), code("ERR_UNSAFE_PATH"));
});

// --- untracked guard (crash-orphan / hand-placed) --------------------------

test("untracked: non-empty target without sidecar is refused, not clobbered", () => {
  const { entry, ctx, targetDir } = makeEnv();
  // Simulate an orphaned/hand-placed skill: payload present, no sidecar.
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "SKILL.md"), "---\nname: hand:placed\n---\nlocal work\n");

  const d = vendor.planPull(entry, ctx);
  assert.equal(d.action, "untracked");
  assert.throws(() => vendor.applyPull(entry, ctx, d, STAMP), code("ERR_UNTRACKED"));
  // file untouched
  assert.match(fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf8"), /local work/);
});

// --- re-converge (no spurious conflict) ------------------------------------

test("re-converge: on-disk equals new origin → up-to-date, not conflict", () => {
  const { entry, ctx, targetDir, upstream } = makeEnv();
  vendor.pull(entry, ctx, { vendoredAt: STAMP });

  // User edits locally; upstream independently evolves to the SAME content.
  const newBody = "# Greeter\nconverged line\n";
  fs.writeFileSync(
    path.join(targetDir, "SKILL.md"),
    vendor.rewriteName(
      `---\nname: upstream:greeter\ncategory: best-practice\ndescription: fixture.\n---\n\n${newBody}`,
      `${PREFIX}:${entry.as}`,
    ),
  );
  writeUpstream(upstream, { body: newBody });

  const d = vendor.planPull(entry, ctx);
  assert.ok(d.action === "up-to-date" || d.action === "fast-forward", `got ${d.action}`);
  assert.notEqual(d.action, "conflict");
});

// --- corrupt sidecar -------------------------------------------------------

test("corrupt sidecar: planPull throws ERR_BAD_SIDECAR but fork still succeeds", () => {
  const { entry, ctx, targetDir } = makeEnv();
  vendor.pull(entry, ctx, { vendoredAt: STAMP });
  fs.writeFileSync(path.join(targetDir, vendor.SIDECAR_NAME), "{ not json");

  assert.throws(() => vendor.planPull(entry, ctx), code("ERR_BAD_SIDECAR"));
  // fork cuts the umbilical even when the sidecar is unparseable.
  assert.equal(vendor.fork(entry, ctx).action, "forked");
  assert.ok(!fs.existsSync(path.join(targetDir, vendor.SIDECAR_NAME)));
});

// --- fast-forward dry-run --------------------------------------------------

test("fast-forward --dry-run does not write", () => {
  const { entry, ctx, targetDir, upstream } = makeEnv();
  vendor.pull(entry, ctx, { vendoredAt: STAMP });
  writeUpstream(upstream, { body: "# Greeter v2\n" });

  const before = fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf8");
  const d = vendor.pull(entry, ctx, { dryRun: true, vendoredAt: STAMP });
  assert.equal(d.action, "fast-forward");
  assert.equal(fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf8"), before, "dry-run wrote nothing");
});

// --- diffPayloads branches -------------------------------------------------

test("diffPayloads: equal → null; origin-absent file → removal lines", () => {
  const a = [{ relpath: "SKILL.md", bytes: Buffer.from("x") }];
  assert.equal(vendor.diffPayloads(a, a), null);

  const local = [
    { relpath: "SKILL.md", bytes: Buffer.from("x") },
    { relpath: "extra.md", bytes: Buffer.from("local only\n") },
  ];
  const origin = [{ relpath: "SKILL.md", bytes: Buffer.from("x") }];
  const d = vendor.diffPayloads(local, origin);
  assert.match(d, /origin: absent/);
  assert.match(d, /-local only/);
});

// --- spawn E2E (bin.mjs through a temp config) ----------------------------

function writeTempConfig(upstream, targetSkillsDir) {
  const cfg = tmp("cfg");
  const file = path.join(cfg, "vendor.config.mjs");
  fs.writeFileSync(
    file,
    `export default ${JSON.stringify({
      skillIdPrefix: PREFIX,
      targetSkillsDir,
      vendorFrom: [
        { source: upstream, path: "skills/greeter", as: "vendored-greeter", divergencePolicy: "manual-merge" },
      ],
    })};\n`,
  );
  return file;
}

function writeTempConfigEntries(targetSkillsDir, vendorFrom) {
  const cfg = tmp("cfg");
  const file = path.join(cfg, "vendor.config.mjs");
  fs.writeFileSync(
    file,
    `export default ${JSON.stringify({ skillIdPrefix: PREFIX, targetSkillsDir, vendorFrom })};\n`,
  );
  return file;
}

function runBin(args) {
  try {
    const stdout = execFileSync("node", [BIN, ...args], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

test("E2E: pull --json fresh then conflict exit 2", () => {
  const upstream = writeUpstream(tmp("up"));
  const targetSkillsDir = tmp("tgt");
  const cfg = writeTempConfig(upstream, targetSkillsDir);

  const r1 = runBin(["pull", "--json", "--config", cfg]);
  assert.equal(r1.code, 0);
  const env1 = JSON.parse(r1.stdout);
  assert.equal(env1.verb, "pull");
  assert.equal(env1.ok, true);
  assert.equal(env1.entries[0].action, "fresh");
  // slimmed envelope must not leak file buffers.
  assert.ok(!("files" in env1.entries[0]));

  // local edit → conflict → exit 2
  fs.appendFileSync(path.join(targetSkillsDir, "vendored-greeter", "SKILL.md"), "\nLOCAL\n");
  const r2 = runBin(["pull", "--config", cfg]);
  assert.equal(r2.code, 2);
  assert.match(r2.stderr, /CONFLICT/);
});

test("E2E: --help exits 0", () => {
  const r = runBin(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /declarative skill vendoring/);
});

test("E2E: unknown verb / unknown flag exit 1", () => {
  const cfg = writeTempConfig(writeUpstream(tmp("up")), tmp("tgt"));
  assert.equal(runBin(["bogus-verb", "--config", cfg]).code, 1);
  assert.equal(runBin(["pull", "--nope", "--config", cfg]).code, 1);
});

test("E2E: pull --dry-run --json writes nothing and flags dryRun", () => {
  const upstream = writeUpstream(tmp("up"));
  const targetSkillsDir = tmp("tgt");
  const cfg = writeTempConfig(upstream, targetSkillsDir);
  const r = runBin(["pull", "--dry-run", "--json", "--config", cfg]);
  assert.equal(r.code, 0);
  const env = JSON.parse(r.stdout);
  assert.equal(env.dryRun, true);
  assert.equal(env.entries[0].action, "fresh");
  assert.ok(!fs.existsSync(path.join(targetSkillsDir, "vendored-greeter")), "dry-run wrote nothing");
});

test("E2E: diff and fork verbs via bin", () => {
  const upstream = writeUpstream(tmp("up"));
  const targetSkillsDir = tmp("tgt");
  const cfg = writeTempConfig(upstream, targetSkillsDir);
  runBin(["pull", "--config", cfg]);

  const diffClean = JSON.parse(runBin(["diff", "--json", "--config", cfg]).stdout);
  assert.equal(diffClean.entries[0].action, "clean");

  const forked = JSON.parse(runBin(["fork", "vendored-greeter", "--json", "--config", cfg]).stdout);
  assert.equal(forked.entries[0].action, "forked");
  assert.ok(!fs.existsSync(path.join(targetSkillsDir, "vendored-greeter", vendor.SIDECAR_NAME)));

  // fork on a non-vendored skill → exit 1
  assert.equal(runBin(["fork", "vendored-greeter", "--config", cfg]).code, 1);
  // fork with no target and no --all → usage error exit 1
  assert.equal(runBin(["fork", "--config", cfg]).code, 1);
});

test("E2E: pull --all partial conflict applies clean entry, exits 2", () => {
  const upA = writeUpstream(tmp("upA"));
  const upB = writeUpstream(tmp("upB"));
  const targetSkillsDir = tmp("tgt");
  const cfg = writeTempConfigEntries(targetSkillsDir, [
    { source: upA, path: "skills/greeter", as: "a", divergencePolicy: "manual-merge" },
    { source: upB, path: "skills/greeter", as: "b", divergencePolicy: "manual-merge" },
  ]);

  runBin(["pull", "--config", cfg]); // vendor both fresh
  // make entry A conflict, leave B clean; upstream B unchanged
  fs.appendFileSync(path.join(targetSkillsDir, "a", "SKILL.md"), "\nLOCAL\n");
  // change upstream B so there's a real fast-forward to apply
  writeUpstream(upB, { body: "# Greeter B v2\n" });

  const r = runBin(["pull", "--json", "--config", cfg]);
  assert.equal(r.code, 2, "any refusal → exit 2");
  const env = JSON.parse(r.stdout);
  const byAs = Object.fromEntries(env.entries.map((e) => [e.as, e.action]));
  assert.equal(byAs.a, "conflict");
  assert.equal(byAs.b, "fast-forward");
  // B really was written despite A's conflict
  assert.match(fs.readFileSync(path.join(targetSkillsDir, "b", "SKILL.md"), "utf8"), /Greeter B v2/);
});
