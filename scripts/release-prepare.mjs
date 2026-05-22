#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUMP_TYPES = new Set(["patch", "minor", "major"]);

function run(command, args, { repoRoot = REPO_ROOT } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeReleaseNoteStub(notePath, version) {
  if (fs.existsSync(notePath)) return false;
  const text = `# v${version}\n\n## English\n\n- TODO: Summarize user-visible changes.\n- TODO: Note compatibility, migration, or operational details if any.\n\n## 中文\n\n- TODO: 总结用户可见的变化。\n- TODO: 如有兼容性、迁移或运维事项，在这里说明。\n`;
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  fs.writeFileSync(notePath, text);
  return true;
}

export function prepareRelease({ bump, repoRoot = REPO_ROOT } = {}) {
  if (!BUMP_TYPES.has(bump)) {
    throw new Error(`usage: npm run release:prepare -- <patch|minor|major>`);
  }

  run("npm", ["version", bump, "--no-git-tag-version"], { repoRoot });
  const pkg = readJson(path.join(repoRoot, "package.json"));
  const version = pkg.version;
  const tag = `v${version}`;
  const notePath = path.join(repoRoot, "docs", "release-notes", `${tag}.md`);
  const createdNote = writeReleaseNoteStub(notePath, version);

  return {
    version,
    tag,
    releaseNote: path.relative(repoRoot, notePath),
    createdNote,
    nextCommands: [
      `edit docs/release-notes/${tag}.md`,
      "npm test",
      "npm run release:preflight -- --allow-dirty",
      `node scripts/verify-release-tag.mjs ${tag}`,
      "npm run package:smoke",
      `git add package.json package-lock.json docs/release-notes/${tag}.md`,
      `git commit -m "release: ${tag}"`,
      `git tag -a ${tag} -m "${tag}"`,
      "git push origin main",
      `git push origin ${tag}`,
    ],
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const result = prepareRelease({ bump: process.argv[2] });
    process.stdout.write(`release-prepare: ${result.tag}\n`);
    process.stdout.write(`${result.createdNote ? "created" : "kept"} ${result.releaseNote}\n\n`);
    process.stdout.write("Next commands:\n");
    for (const command of result.nextCommands) process.stdout.write(`  ${command}\n`);
  } catch (e) {
    process.stderr.write(`release-prepare: ERROR - ${e.message || e}\n`);
    process.exit(1);
  }
}
