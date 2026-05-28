import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  HOST_INSTRUCTIONS_KEY,
  OPENCODE_INSTRUCTIONS_KEY,
  isValidHostInstructionsPath,
  isValidOpenCodeInstructionsPath,
  isValidRelativeSkillPath,
  readHostInstructions,
  readOpenCodeInstructions,
} from "./skill-metadata.mjs";

test("HOST_INSTRUCTIONS_KEY and OPENCODE_INSTRUCTIONS_KEY are stable constants", () => {
  assert.equal(HOST_INSTRUCTIONS_KEY, "host-instructions");
  assert.equal(OPENCODE_INSTRUCTIONS_KEY, "opencode-instructions");
});

test("isValidRelativeSkillPath accepts plain relative paths and rejects bad shapes", () => {
  // Aliases share identity — same predicate body backs all three names.
  assert.equal(isValidHostInstructionsPath, isValidRelativeSkillPath);
  assert.equal(isValidOpenCodeInstructionsPath, isValidRelativeSkillPath);

  assert.equal(isValidRelativeSkillPath("references/ambient.md"), true);
  assert.equal(isValidRelativeSkillPath(""), false);
  assert.equal(isValidRelativeSkillPath(" references/ambient.md"), false);
  assert.equal(isValidRelativeSkillPath("\"references/ambient.md\""), false);
  assert.equal(isValidRelativeSkillPath("references/space file.md"), false);
  assert.equal(isValidRelativeSkillPath("../outside.md"), false);
  assert.equal(isValidRelativeSkillPath("/tmp/outside.md"), false);
  assert.equal(isValidRelativeSkillPath("C:\\tmp\\outside.md"), false);
  assert.equal(isValidRelativeSkillPath("\\\\server\\share\\outside.md"), false);
  assert.equal(isValidRelativeSkillPath(42), false);
});

test("readHostInstructions returns null when neither key is declared", () => {
  const frontmatter = [
    "name: sample:plain",
    "category: tool",
    "description: nothing relevant",
  ].join("\n");
  assert.equal(readHostInstructions(frontmatter), null);
});

test("readHostInstructions returns host-source result when only host-instructions present", () => {
  const frontmatter = [
    "name: sample:host-only",
    "category: setup",
    "host-instructions: references/host.md",
    "description: host only",
  ].join("\n");
  assert.deepEqual(readHostInstructions(frontmatter), {
    value: "references/host.md",
    source: "host",
    duplicateDetected: false,
  });
});

test("readHostInstructions returns opencode-source result when only opencode-instructions present (alias)", () => {
  const frontmatter = [
    "name: sample:opencode-only",
    "category: setup",
    "opencode-instructions: references/opencode.md",
    "description: legacy alias",
  ].join("\n");
  assert.deepEqual(readHostInstructions(frontmatter), {
    value: "references/opencode.md",
    source: "opencode",
    duplicateDetected: false,
  });
});

test("readHostInstructions yields host value with duplicateDetected when both keys present", () => {
  const frontmatter = [
    "name: sample:both",
    "category: setup",
    "host-instructions: references/host.md",
    "opencode-instructions: references/opencode.md",
    "description: both declared",
  ].join("\n");
  assert.deepEqual(readHostInstructions(frontmatter), {
    value: "references/host.md",
    source: "host",
    duplicateDetected: true,
  });
});

test("readHostInstructions preserves duplicate detection when both values agree", () => {
  const frontmatter = [
    "name: sample:both-same",
    "category: setup",
    "host-instructions: references/shared.md",
    "opencode-instructions: references/shared.md",
    "description: both declared same path",
  ].join("\n");
  const result = readHostInstructions(frontmatter);
  assert.equal(result.source, "host");
  assert.equal(result.duplicateDetected, true);
  assert.equal(result.value, "references/shared.md");
});

test("readOpenCodeInstructions back-compat wrapper returns raw string", () => {
  const onlyOpencode = [
    "name: sample:legacy",
    "opencode-instructions: references/legacy.md",
  ].join("\n");
  assert.equal(readOpenCodeInstructions(onlyOpencode), "references/legacy.md");

  const onlyHost = [
    "name: sample:new",
    "host-instructions: references/new.md",
  ].join("\n");
  // Legacy wrapper now picks up host-instructions through the structured
  // reader — the alias resolution is consistent across both entry points.
  assert.equal(readOpenCodeInstructions(onlyHost), "references/new.md");

  const neither = [
    "name: sample:plain",
    "category: tool",
  ].join("\n");
  assert.equal(readOpenCodeInstructions(neither), null);
});

test("readHostInstructions handles empty / null / non-string frontmatter input gracefully", () => {
  assert.equal(readHostInstructions(null), null);
  assert.equal(readHostInstructions(undefined), null);
  assert.equal(readHostInstructions(""), null);
});

test("readHostInstructions handles CRLF line endings", () => {
  const frontmatter = "name: sample:crlf\r\nhost-instructions: references/crlf.md\r\ndescription: windows-style";
  const result = readHostInstructions(frontmatter);
  assert.equal(result?.value, "references/crlf.md");
  assert.equal(result?.source, "host");
});

// Sanity: path module is reachable (catches accidental ESM resolution regressions).
test("path module is reachable from the metadata module's test surface", () => {
  assert.equal(typeof path.posix.isAbsolute, "function");
});
