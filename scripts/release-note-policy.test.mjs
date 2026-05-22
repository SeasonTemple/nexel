import test from "node:test";
import assert from "node:assert/strict";

import { validateBilingualReleaseNote } from "./release-note-policy.mjs";

test("validateBilingualReleaseNote accepts English and Chinese sections", () => {
  const result = validateBilingualReleaseNote(`# v1.2.3

## English

- Added release automation.

## 中文

- 增加发布自动化。
`);
  assert.equal(result.ok, true);
});

test("validateBilingualReleaseNote rejects English-only notes", () => {
  const result = validateBilingualReleaseNote(`# v1.2.3

## English

- Added release automation.
`);
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /Chinese/);
});

test("validateBilingualReleaseNote rejects Chinese-only notes", () => {
  const result = validateBilingualReleaseNote(`# v1.2.3

## 中文

- 增加发布自动化。
`);
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /English/);
});
