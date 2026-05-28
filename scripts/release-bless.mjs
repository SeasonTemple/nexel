#!/usr/bin/env node
// Mark a release tag as reviewed so the husky pre-push hook will let it
// through. Captures the tag's referenced commit SHA so the marker is
// cryptographically bound to one specific revision — `git commit --amend`
// or force-retagging invalidates the bless and the hook refuses the push.
//
// Usage:
//   npm run release:bless -- vX.Y.Z
//   node scripts/release-bless.mjs vX.Y.Z
//
// Prerequisites:
//   1. The tag `vX.Y.Z` MUST already exist locally before bless runs (the
//      bless captures `git rev-parse vX.Y.Z^{commit}`).
//   2. The operator MUST have run `compound-engineering:ce-code-review`
//      against the diff from the previous tag and fixed or documented
//      every P1 finding (per CLAUDE.md "Mandatory release-time review
//      gate"). The bless script does NOT itself run code review — it
//      records the operator's confirmation that review was completed.
//
// Output: `.nexel/release-blessed-<tag>` in the working tree (gitignored
// session-local per `.nexel/` line in .gitignore). The marker contains:
//   tag=vX.Y.Z
//   commit=<40-char SHA the tag points at>
//   blessed_at=<ISO-8601 timestamp>
// The husky pre-push hook parses this file and verifies the captured
// commit matches the SHA being pushed for that tag.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER_DIR = path.join(REPO_ROOT, ".nexel");
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function usage() {
  process.stderr.write("Usage: node scripts/release-bless.mjs vX.Y.Z\n");
  process.exit(2);
}

function gitRevParse(tag) {
  // Resolve the tag to the underlying commit SHA. `^{commit}` dereferences
  // annotated tags down to the commit they point at.
  try {
    const out = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", `${tag}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

function main() {
  // npm run release:bless -- vX.Y.Z forwards `vX.Y.Z` as argv[2]
  const tag = process.argv[2];
  if (!tag) usage();
  if (!TAG_PATTERN.test(tag)) {
    process.stderr.write(`release-bless: tag "${tag}" does not match /^v\\d+\\.\\d+\\.\\d+$/.\n`);
    process.exit(2);
  }

  const sha = gitRevParse(tag);
  if (!sha) {
    process.stderr.write(`release-bless: tag "${tag}" does not exist locally — create the tag (git tag -a ${tag} ...) before blessing.\n`);
    process.exit(2);
  }
  if (!SHA_PATTERN.test(sha)) {
    process.stderr.write(`release-bless: rev-parse returned unexpected non-SHA output: ${JSON.stringify(sha)}\n`);
    process.exit(2);
  }

  fs.mkdirSync(MARKER_DIR, { recursive: true });
  const markerPath = path.join(MARKER_DIR, `release-blessed-${tag}`);
  const stamp = new Date().toISOString();
  fs.writeFileSync(
    markerPath,
    `tag=${tag}\ncommit=${sha}\nblessed_at=${stamp}\n`,
  );
  process.stdout.write(`release-bless: marker written: ${path.relative(REPO_ROOT, markerPath)} (commit ${sha.slice(0, 10)})\n`);
}

main();
