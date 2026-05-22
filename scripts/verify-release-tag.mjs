#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateBilingualReleaseNote } from "./release-note-policy.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function verifyReleaseTag({ tagName, repoRoot = REPO_ROOT } = {}) {
  const failures = [];
  if (!tagName) {
    failures.push("tagName is required");
  } else if (!/^v\d+\.\d+\.\d+$/.test(tagName)) {
    failures.push(`tag must match vX.Y.Z: ${tagName}`);
  }

  const pkgPath = path.join(repoRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const expectedTag = `v${pkg.version}`;
  if (tagName && tagName !== expectedTag) {
    failures.push(`tag/package mismatch: tag=${tagName} package=${pkg.version}`);
  }

  const notePath = path.join(repoRoot, "docs", "release-notes", `${expectedTag}.md`);
  if (!fs.existsSync(notePath)) {
    failures.push(`missing release note: docs/release-notes/${expectedTag}.md`);
  } else {
    const noteText = fs.readFileSync(notePath, "utf8");
    if (noteText.trim().length === 0) {
      failures.push(`empty release note: docs/release-notes/${expectedTag}.md`);
    }
    for (const failure of validateBilingualReleaseNote(noteText).failures) {
      failures.push(`release note policy: ${failure}`);
    }
  }

  return {
    ok: failures.length === 0,
    tagName,
    packageVersion: pkg.version,
    releaseNote: `docs/release-notes/${expectedTag}.md`,
    failures,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = verifyReleaseTag({ tagName: process.argv[2] || process.env.GITHUB_REF_NAME });
  if (!result.ok) {
    for (const failure of result.failures) {
      process.stderr.write(`verify-release-tag: ERROR — ${failure}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`verify-release-tag: OK ${result.tagName}\n`);
}
