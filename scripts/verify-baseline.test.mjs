import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { diffLines, verifyBaselines } from "./verify-baseline.mjs";

test("diffLines detects duplicate-line count changes", () => {
  const diff = diffLines("a\nx\nx\n", "a\nx\n");
  assert.deepEqual(diff.removed, [{ line: "x", count: 1 }]);
  assert.deepEqual(diff.added, []);
});

test("verifyBaselines reports missing baselines with capture hint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-baseline-test-"));
  try {
    const result = verifyBaselines({ baselineDir: dir, update: false });
    assert.equal(result.ok, false);
    assert.ok(result.results.every((r) => /missing baseline/.test(r.reason)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyBaselines passes after explicit update", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-baseline-test-"));
  try {
    const update = verifyBaselines({ baselineDir: dir, update: true });
    assert.equal(update.ok, true);
    const verify = verifyBaselines({ baselineDir: dir, update: false });
    assert.equal(verify.ok, true, JSON.stringify(verify.results));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
