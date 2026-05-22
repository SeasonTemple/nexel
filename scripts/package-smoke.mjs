#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildDist } from "./build-dist.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BASE_REQUIRED_PACKAGE_FILES = Object.freeze([
  "package/README.md",
  "package/LICENSE",
  "package/assets/install-uninstall-flow.gif",
  "package/scripts/install-skills.mjs",
  "package/scripts/render-install-demo-gif.mjs",
  "package/scripts/package-smoke.mjs",
  "package/scripts/release-prepare.mjs",
  "package/scripts/installer/index.mjs",
  "package/scripts/installer/adapters/claude.mjs",
  "package/scripts/installer/adapters/codex.mjs",
  "package/scripts/installer/adapters/opencode.mjs",
  "package/scripts/installer/adapters/opencode-plugin.mjs",
  "package/examples/sample-product/bin.mjs",
  "package/examples/sample-product/sample.install.json",
]);

function requiredPackageFiles(pkg) {
  return [
    ...BASE_REQUIRED_PACKAGE_FILES,
    `package/docs/release-notes/v${pkg.version}.md`,
  ];
}

function tarList(artifactPath) {
  const result = spawnSync("tar", ["-tzf", artifactPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`tar list failed: ${result.stderr || result.stdout}`);
  }
  return new Set(result.stdout.split(/\r?\n/).filter(Boolean));
}

export function runPackageSmoke({ repoRoot = REPO_ROOT, cleanup = true } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const dist = buildDist({ repoRoot });
  const artifactPath = path.join(repoRoot, dist.artifact);
  const checksumPath = path.join(repoRoot, dist.checksum);
  const entries = tarList(artifactPath);
  const requiredFiles = requiredPackageFiles(pkg);
  const missing = requiredFiles.filter((entry) => !entries.has(entry));
  const ok = missing.length === 0 && fs.existsSync(checksumPath);

  if (cleanup) {
    fs.rmSync(artifactPath, { force: true });
    fs.rmSync(checksumPath, { force: true });
  }

  return {
    ok,
    artifact: dist.artifact,
    checksum: dist.checksum,
    bytes: dist.bytes,
    sha256: dist.sha256,
    requiredFiles,
    missing,
    cleaned: cleanup,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const keep = process.argv.includes("--keep");
  try {
    const result = runPackageSmoke({ cleanup: !keep });
    for (const entry of result.requiredFiles) {
      process.stdout.write(`  ${result.missing.includes(entry) ? "FAIL" : "OK  "} ${entry}\n`);
    }
    process.stdout.write(`\npackage-smoke: ${result.ok ? "PASS" : `FAIL (${result.missing.length} missing)`}\n`);
    process.stdout.write(`artifact: ${result.artifact}${result.cleaned ? " (cleaned)" : ""}\n`);
    process.exit(result.ok ? 0 : 1);
  } catch (e) {
    process.stderr.write(`package-smoke: ERROR - ${e.message || e}\n`);
    process.exit(1);
  }
}
