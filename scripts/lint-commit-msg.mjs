#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const HEADER_RE = /^(feat|fix|docs|test|refactor|perf|build|ci|chore|release)(\([a-z0-9][a-z0-9-]*\))?: [a-z0-9][^\r\n]*$/;
const AUTO_PREFIX_RE = /^(Merge |Revert "|fixup! |squash! )/;

export function lintCommitMessage(message) {
  const text = String(message ?? "").replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((line) => !line.startsWith("#"));
  const header = lines.find((line) => line.trim().length > 0)?.trim() ?? "";
  const failures = [];

  if (!header) {
    failures.push("commit message is empty");
  } else if (!AUTO_PREFIX_RE.test(header) && !HEADER_RE.test(header)) {
    failures.push("header must match: <type>(<scope>): <summary>");
  }

  if (header.length > 72) {
    failures.push(`header must be <= 72 characters, got ${header.length}`);
  }

  return {
    ok: failures.length === 0,
    header,
    failures,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const msgPath = process.argv[2];
  if (!msgPath) {
    process.stderr.write("lint-commit-msg: ERROR - missing commit message file path\n");
    process.exit(2);
  }

  const result = lintCommitMessage(fs.readFileSync(msgPath, "utf8"));
  if (!result.ok) {
    process.stderr.write("lint-commit-msg: FAIL\n");
    for (const failure of result.failures) {
      process.stderr.write(`  - ${failure}\n`);
    }
    process.stderr.write("\nAllowed format:\n");
    process.stderr.write("  <type>(<scope>): <summary>\n");
    process.stderr.write("\nAllowed types:\n");
    process.stderr.write("  feat, fix, docs, test, refactor, perf, build, ci, chore, release\n");
    process.stderr.write("\nExample:\n");
    process.stderr.write("  docs(release): require bilingual release notes\n");
    process.exit(1);
  }

  process.stdout.write(`lint-commit-msg: PASS ${result.header}\n`);
}
