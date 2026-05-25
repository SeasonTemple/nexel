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

// Release-note stub template (since v0.7.0). Bilingual, table-driven so the
// rendered GitHub Release page uses the full content-column width instead of
// being dominated by short bullets and white space.
//
// Required sections (release-note-policy.mjs enforces `## English` + `## 中文`):
//   - Highlights — area / change / why-it-matters table; the elevator pitch
//   - Compatibility — what/before/after/action table; the upgrade decision row
//   - Added — what shipped this release; group by Implementation Unit when
//     the release comes from a plan, by area otherwise
//   - Notes — caveats, known issues, deferred items
//
// Drop a section when it is empty; never pad with TODO bullets in the
// published note. Keep summaries terse — tables read better in the GitHub
// Release page's content column than long paragraphs.

const STUB_TEMPLATE = ({ version }) => `# v${version} — <one-line theme>

> <YYYY-MM-DD> · <one-line scope: units / ADRs / breaking signals>

## 中文

### Highlights

| 维度 | 改动 | 为什么重要 |
|---|---|---|
| **<Area>** | <change summary> | <why it matters in 1-2 sentences> |

### Compatibility

| What | Before | After | Action |
|---|---|---|---|
| <surface> | <prev> | <new> | <action> |

### Added — by Implementation Unit

| Unit | Surface | Tests |
|---|---|---|
| **U?** <name> | <what landed> | +N |

合计：**X / X tests passing**。

### Documentation

- **ADR-####** — <decision>
- **README** / **README.zh-CN** — <doc updates>

### Notes

- <caveat / known issue / deferred item>

---

## English

### Highlights

| Area | Change | Why it matters |
|---|---|---|
| **<Area>** | <change summary> | <why it matters in 1-2 sentences> |

### Compatibility

| What | Before | After | Action |
|---|---|---|---|
| <surface> | <prev> | <new> | <action> |

### Added — by Implementation Unit

| Unit | Surface | Tests |
|---|---|---|
| **U?** <name> | <what landed> | +N |

Total: **X / X tests passing**.

### Notes

- <caveat / known issue / deferred item>
`;

function writeReleaseNoteStub(notePath, version) {
  if (fs.existsSync(notePath)) return false;
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  fs.writeFileSync(notePath, STUB_TEMPLATE({ version }));
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
