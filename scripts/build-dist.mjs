#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function buildDist({ repoRoot = REPO_ROOT } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const expected = `${pkg.name}-${pkg.version}.tgz`;
  const result = spawnSync("npm", ["pack", "--silent"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`npm pack failed: ${result.stderr || result.stdout}`);
  }

  const artifact = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || expected;
  const artifactPath = path.join(repoRoot, artifact);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`npm pack did not create expected tarball: ${artifact}`);
  }

  const bytes = fs.readFileSync(artifactPath);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const checksumPath = `${artifactPath}.sha256`;
  fs.writeFileSync(checksumPath, `${sha256}  ${artifact}\n`);

  return {
    artifact,
    checksum: path.basename(checksumPath),
    bytes: bytes.length,
    sha256,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const result = buildDist();
    process.stdout.write(`dist: ${result.artifact} (${result.bytes} bytes)\n`);
    process.stdout.write(`sha256: ${result.sha256}\n`);
    process.stdout.write(`checksum: ${result.checksum}\n`);
  } catch (e) {
    process.stderr.write(`build-dist: ERROR — ${e.message || e}\n`);
    process.exit(1);
  }
}
