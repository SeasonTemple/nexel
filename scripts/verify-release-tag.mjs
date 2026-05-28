#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateBilingualReleaseNote } from "./release-note-policy.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ADR-0018 CI bless gate helpers. The bless marker at
// `.nexel/release-blessed-<tag>` is gitignored (ADR-0008) so it cannot
// reach CI via `actions/checkout`. We accept two enforcement transports:
//   1. Maintainer-machine: marker present + commit=<sha> matches HEAD
//      commit (peeled via `git rev-parse HEAD^{commit}` to handle
//      annotated tags, same trick as `.husky/pre-push:72`).
//   2. CI fresh-clone: marker absent, but workflow signals it has run the
//      server-side review-gate job by setting NEXEL_CI_BLESSED=true in
//      the release job's env (see `.github/workflows/release.yml`).
// Anything else (no marker, no CI signal) fails closed.
function readBlessMarker(markerPath) {
  if (!fs.existsSync(markerPath)) return { exists: false };
  // Reject symlinks for parity with `.husky/pre-push:49-52`. A symlink
  // pointing at a regular file would otherwise pass `existsSync` and let
  // a spoofed marker slip the gate.
  const lst = fs.lstatSync(markerPath);
  if (lst.isSymbolicLink()) {
    return { exists: true, symlink: true };
  }
  const content = fs.readFileSync(markerPath, "utf8");
  const match = content.match(/^commit=([0-9a-f]{40})$/m);
  return { exists: true, symlink: false, commit: match ? match[1] : null };
}

function resolveHeadCommit(repoRoot) {
  try {
    return execSync("git rev-parse HEAD^{commit}", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function verifyReleaseTag({
  tagName,
  repoRoot = REPO_ROOT,
  env = process.env,
} = {}) {
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

  // ADR-0018 CI bless gate. Skip when tagName is invalid; the earlier
  // format check already produced a clearer failure.
  if (tagName && /^v\d+\.\d+\.\d+$/.test(tagName)) {
    const markerPath = path.join(repoRoot, ".nexel", `release-blessed-${tagName}`);
    const marker = readBlessMarker(markerPath);
    const isCi = env.GITHUB_ACTIONS === "true";

    if (marker.exists) {
      if (marker.symlink) {
        failures.push(
          `bless marker is a symlink — rejected: .nexel/release-blessed-${tagName}`,
        );
      } else if (!marker.commit) {
        failures.push(
          `bless marker missing or malformed commit=<sha> line: .nexel/release-blessed-${tagName}`,
        );
      } else {
        const head = resolveHeadCommit(repoRoot);
        if (!head) {
          failures.push(
            `bless marker present but unable to resolve HEAD commit in ${repoRoot}`,
          );
        } else if (head !== marker.commit) {
          failures.push(
            `bless marker SHA ${marker.commit} does not match HEAD ${head}; re-run npm run release:bless -- ${tagName}`,
          );
        }
      }
    } else if (isCi) {
      // Fresh CI runner: marker is gitignored so it cannot reach the
      // workspace via checkout. The release workflow's review-gate job
      // must set NEXEL_CI_BLESSED=true on the release job's env before
      // invoking this script.
      if (env.NEXEL_CI_BLESSED !== "true") {
        failures.push(
          `CI context detected (GITHUB_ACTIONS=true) but NEXEL_CI_BLESSED is not "true"; the release workflow must run the review-gate job before tagging (ADR-0018)`,
        );
      }
    } else {
      failures.push(
        `no bless marker at .nexel/release-blessed-${tagName} and not in CI context; run npm run release:bless -- ${tagName} from a maintainer machine after ce-code-review (ADR-0013), or push from a CI workflow that runs the review-gate job (ADR-0018)`,
      );
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
