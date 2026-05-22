import test from "node:test";
import assert from "node:assert/strict";

import { lintCommitMessage } from "./lint-commit-msg.mjs";

test("lintCommitMessage accepts the fixed conventional template", () => {
  const result = lintCommitMessage("docs(release): require bilingual release notes\n");
  assert.equal(result.ok, true);
});

test("lintCommitMessage accepts unscoped release commits", () => {
  const result = lintCommitMessage("release: v0.6.2\n");
  assert.equal(result.ok, true);
});

test("lintCommitMessage rejects missing type/scope separator", () => {
  const result = lintCommitMessage("update release docs\n");
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /<type>\(<scope>\): <summary>/);
});

test("lintCommitMessage rejects uppercase summary starts", () => {
  const result = lintCommitMessage("docs(release): Require bilingual release notes\n");
  assert.equal(result.ok, false);
});

test("lintCommitMessage allows merge, revert, fixup, and squash messages", () => {
  for (const message of [
    "Merge branch 'main'",
    "Revert \"docs(release): require bilingual release notes\"",
    "fixup! docs(release): require bilingual release notes",
    "squash! docs(release): require bilingual release notes",
  ]) {
    assert.equal(lintCommitMessage(message).ok, true, message);
  }
});
