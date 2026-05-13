import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "./argv.mjs";

const VERBS = new Set(["install", "uninstall", "list", "plan", "doctor", "help", "validate"]);

function p(...args) {
  // Simulate process.argv: ["node", "script.mjs", ...args]
  return parseArgs(["node", "script.mjs", ...args], { validVerbs: VERBS });
}

test("parseArgs: validVerbs Set is required", () => {
  assert.throws(() => parseArgs([], {}), /options\.validVerbs must be a Set/);
  assert.throws(() => parseArgs([], { validVerbs: ["install"] }), /options\.validVerbs must be a Set/);
});

test("parseArgs: first token in validVerbs becomes verb", () => {
  assert.equal(p("install").verb, "install");
  assert.equal(p("list").verb, "list");
});

test("parseArgs: unknown first token is null verb, becomes positional", () => {
  const args = p("unknown-verb");
  assert.equal(args.verb, null);
  assert.deepEqual(args.positional, ["unknown-verb"]);
});

test("parseArgs: no args returns null verb", () => {
  const args = p();
  assert.equal(args.verb, null);
});

test("parseArgs: boolean flags set true", () => {
  const args = p("install", "--yes", "--json", "--dry-run", "--force");
  assert.equal(args.yes, true);
  assert.equal(args.json, true);
  assert.equal(args.dryRun, true);
  assert.equal(args.force, true);
});

test("parseArgs: --help / -h both set help flag", () => {
  assert.equal(p("--help").help, true);
  assert.equal(p("-h").help, true);
});

test("parseArgs: --dry-run and --plan are aliases", () => {
  assert.equal(p("install", "--dry-run").dryRun, true);
  assert.equal(p("install", "--plan").dryRun, true);
});

test("parseArgs: --profile <value> and --profile=value both work", () => {
  assert.equal(p("install", "--profile", "dev").profile, "dev");
  assert.equal(p("install", "--profile=staging").profile, "staging");
});

test("parseArgs: --skill collects multiple values until next flag", () => {
  const args = p("install", "--skill", "a", "b", "c", "--yes");
  assert.deepEqual(args.skills, ["a", "b", "c"]);
  assert.equal(args.yes, true);
});

test("parseArgs: --skill=a,b,c comma-split form", () => {
  const args = p("install", "--skill=foo,bar,baz");
  assert.deepEqual(args.skills, ["foo", "bar", "baz"]);
});

test("parseArgs: --bundle behaves like --skill", () => {
  const args = p("install", "--bundle", "x", "y");
  assert.deepEqual(args.bundles, ["x", "y"]);
});

test("parseArgs: selectionIds is concat of skills + bundles", () => {
  const args = p("install", "--skill", "s1", "--bundle", "b1");
  assert.deepEqual(args.selectionIds, ["s1", "b1"]);
});

test("parseArgs: --agent supports single value, comma list, and multiple flags", () => {
  // Single value
  let args = p("install", "--agent", "codex");
  assert.equal(args.adapter, "codex");
  assert.deepEqual(args.adapters, ["codex"]);

  // Comma-separated list — adapter normalized to first element
  args = p("install", "--agent", "codex,claude-code");
  assert.equal(args.adapter, "codex");
  assert.deepEqual(args.adapters, ["codex", "claude-code"]);

  // Repeated --agent flags accumulate; dedup applied
  args = p("install", "--agent", "codex", "--agent", "opencode", "--agent", "codex");
  assert.deepEqual(args.adapters, ["codex", "opencode"]);
});

test("parseArgs: --agent=value form", () => {
  const args = p("install", "--agent=codex,opencode");
  assert.deepEqual(args.adapters, ["codex", "opencode"]);
});

test("parseArgs: --target <path> single value", () => {
  assert.equal(p("install", "--target", "/tmp/test").target, "/tmp/test");
  assert.equal(p("install", "--target=/tmp/test2").target, "/tmp/test2");
});

test("parseArgs: --accept-modified collects until next flag", () => {
  const args = p("uninstall", "--force", "--accept-modified", "a.md", "b.md", "--yes");
  assert.deepEqual(args.acceptModified, ["a.md", "b.md"]);
});

test("parseArgs: --banner-title with space-quoted value", () => {
  assert.equal(p("--banner-title", "Hello World").bannerTitle, "Hello World");
  assert.equal(p("--banner-title=My Skills").bannerTitle, "My Skills");
});

test("parseArgs: positional args (non-flag tokens after verb) accumulate", () => {
  const args = p("validate", "path/to/SKILL.md");
  assert.deepEqual(args.positional, ["path/to/SKILL.md"]);
});

test("parseArgs: defaults are sensible for omitted flags", () => {
  const args = p("install");
  assert.equal(args.json, false);
  assert.equal(args.yes, false);
  assert.equal(args.dryRun, false);
  assert.equal(args.mode, "direct");
  assert.equal(args.adapter, null);
  assert.deepEqual(args.adapters, []);
  assert.deepEqual(args.skills, []);
});
