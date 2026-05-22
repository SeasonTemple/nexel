#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const OUT = path.join(REPO_ROOT, "assets", "install-uninstall-flow.gif");
const TAPE = path.join(os.tmpdir(), "nexel-install-demo.tape");
const DEMO_ROOT = "/tmp/nexel-demo";

function requireCommand(name) {
  const result = spawnSync("sh", ["-c", `command -v "${name}" >/dev/null 2>&1`], {
  });
  if (result.status !== 0) {
    throw new Error(`${name} is required. Install with: brew install charmbracelet/tap/vhs ffmpeg`);
  }
}

function writeTape() {
  const tape = `Output ${JSON.stringify(OUT)}

Require node
Require vhs
Require ffmpeg

Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 18
Set Width 1280
Set Height 900
Set Padding 14
Set Framerate 12
Set PlaybackSpeed 1.15
Set Theme "Dracula"
Set WindowBar "Colorful"
Set TypingSpeed 20ms

Hide
Type "cd ${REPO_ROOT.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")} && rm -rf ${DEMO_ROOT} && node scripts/install-skills.mjs --demo --target ${DEMO_ROOT}"
Enter
Show

Sleep 900ms
Down
Down
Enter
Sleep 450ms
Enter
Sleep 450ms
Enter
Sleep 700ms
Left
Enter
Sleep 900ms
Left
Enter
Sleep 1600ms
`;
  fs.writeFileSync(TAPE, tape);
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}

try {
  requireCommand("vhs");
  requireCommand("ffmpeg");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.rmSync(DEMO_ROOT, { recursive: true, force: true });
  writeTape();
  run("vhs", [TAPE]);
  fs.rmSync(DEMO_ROOT, { recursive: true, force: true });
  process.stdout.write(`${path.relative(REPO_ROOT, OUT)}\n`);
} finally {
  fs.rmSync(TAPE, { force: true });
}
