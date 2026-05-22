#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function semverGt(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

function newestReleaseNoteVersion(dir) {
  const versions = fs.readdirSync(dir)
    .map((name) => /^v(\d+\.\d+\.\d+)\.md$/.exec(name))
    .filter(Boolean)
    .map((m) => m[1]);
  if (versions.length === 0) return null;
  return versions.reduce((best, version) => (semverGt(version, best) ? version : best), versions[0]);
}

function gitDirty(repoRoot) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return { ok: false, detail: result.stderr || result.stdout };
  const ignored = /^(?:\?\? )?nexel-\d+\.\d+\.\d+\.tgz(?:\.sha256)?$/;
  const dirty = result.stdout.split(/\r?\n/).filter(Boolean).filter((line) => !ignored.test(line.replace(/^.. /, "")));
  return { ok: dirty.length === 0, detail: dirty.join(" | ") || "clean" };
}

export function runPreflight({ repoRoot = REPO_ROOT, allowDirty = false } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
  const version = pkg.version;
  const releaseNotesDir = path.join(repoRoot, "docs/release-notes");
  const releaseNotePath = path.join(releaseNotesDir, `v${version}.md`);
  const newest = newestReleaseNoteVersion(releaseNotesDir);

  const dirty = gitDirty(repoRoot);
  add("working-tree-clean", allowDirty || dirty.ok, allowDirty ? "skipped by --allow-dirty" : dirty.detail);
  add("package-lock-version-matches", lock.version === version && lock.packages?.[""]?.version === version,
    `package=${version} lock=${lock.version} root=${lock.packages?.[""]?.version}`);
  add("release-note-exists", fs.existsSync(releaseNotePath), `docs/release-notes/v${version}.md`);
  add("release-note-non-empty", fs.existsSync(releaseNotePath) && fs.readFileSync(releaseNotePath, "utf8").trim().length > 0,
    `docs/release-notes/v${version}.md`);
  add("newest-release-note-matches-package", newest === version,
    `package=${version} newest=${newest ?? "(none)"}`);

  const mismatches = checks.filter((check) => !check.ok);
  return { ok: mismatches.length === 0, version, checks, mismatches };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const json = process.argv.includes("--json");
  const allowDirty = process.argv.includes("--allow-dirty");
  const result = runPreflight({ allowDirty });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    for (const check of result.checks) {
      process.stdout.write(`  ${check.ok ? "OK  " : "FAIL"} ${check.name}${check.ok ? "" : ` — ${check.detail}`}\n`);
    }
    process.stdout.write(`\nrelease-preflight: ${result.ok ? "PASS" : `FAIL (${result.mismatches.length})`}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}
