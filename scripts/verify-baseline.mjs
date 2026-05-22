#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_ROOT = path.join(REPO_ROOT, "examples/sample-product");
const SAMPLE_BIN = path.join(SAMPLE_ROOT, "bin.mjs");
const BASELINE_DIR = path.join(SAMPLE_ROOT, ".baseline");

export const DEFAULT_BASELINES = Object.freeze([
  { name: "help.txt", args: ["help"], stream: "stdout", allowExit: [0] },
  { name: "list.json", args: ["list", "--json"], stream: "stdout", allowExit: [0] },
  { name: "agents.json", args: ["agents", "--json"], stream: "stdout", allowExit: [0] },
  { name: "doctor.json", args: ["doctor", "--json"], stream: "stdout", allowExit: [0, 1] },
  { name: "validate.json", args: ["validate", "skills/hello-world/SKILL.md", "--json"], stream: "stdout", allowExit: [0] },
]);

function stableEnv(root) {
  const agentHome = path.join(root, "agent-homes");
  fs.mkdirSync(agentHome, { recursive: true });
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir, { recursive: true });

  return {
    ...process.env,
    FORCE_COLOR: "0",
    LANG: "zh_CN.UTF-8",
    LC_ALL: "zh_CN.UTF-8",
    NEXEL_LANG: "en",
    SAMPLE_LANG: "en",
    CLAUDE_HOME: path.join(agentHome, "claude"),
    CODEX_HOME: path.join(agentHome, "codex"),
    OPENCODE_CONFIG_DIR: path.join(agentHome, "opencode"),
    PATH: binDir,
  };
}

export function captureBaseline(command, { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-baseline-")) } = {}) {
  const result = spawnSync(process.execPath, [SAMPLE_BIN, ...command.args, "--lang", "en"], {
    cwd: SAMPLE_ROOT,
    encoding: "utf8",
    env: stableEnv(tmpRoot),
  });
  const normalize = (text) => String(text ?? "").split(tmpRoot).join("<BASELINE_ROOT>");

  return {
    name: command.name,
    code: result.status,
    stdout: normalize(result.stdout),
    stderr: normalize(result.stderr),
    output: command.stream === "stderr" ? normalize(result.stderr) : normalize(result.stdout),
  };
}

export function diffLines(expected, actual) {
  const count = (text) => {
    const map = new Map();
    for (const line of text.split("\n")) {
      map.set(line, (map.get(line) ?? 0) + 1);
    }
    return map;
  };
  const e = count(expected);
  const a = count(actual);
  const keys = new Set([...e.keys(), ...a.keys()]);
  const removed = [];
  const added = [];
  for (const key of [...keys].sort()) {
    const delta = (a.get(key) ?? 0) - (e.get(key) ?? 0);
    if (delta > 0) added.push({ line: key, count: delta });
    if (delta < 0) removed.push({ line: key, count: -delta });
  }
  return { added, removed };
}

export function verifyBaselines({ baselineDir = BASELINE_DIR, update = false } = {}) {
  fs.mkdirSync(baselineDir, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-baseline-"));
  const results = [];

  try {
    for (const command of DEFAULT_BASELINES) {
      const captured = captureBaseline(command, { tmpRoot });
      const baselinePath = path.join(baselineDir, command.name);
      const exitOk = command.allowExit.includes(captured.code);
      if (!exitOk) {
        results.push({
          name: command.name,
          ok: false,
          reason: `exit ${captured.code}, expected one of ${command.allowExit.join(", ")}`,
          diff: null,
        });
        continue;
      }

      if (update || !fs.existsSync(baselinePath)) {
        fs.writeFileSync(baselinePath, captured.output);
        results.push({
          name: command.name,
          ok: update,
          reason: update ? "updated" : "missing baseline; wrote candidate, review and rerun",
          diff: null,
        });
        continue;
      }

      const expected = fs.readFileSync(baselinePath, "utf8");
      const ok = expected === captured.output;
      results.push({
        name: command.name,
        ok,
        reason: ok ? "matched" : "output changed",
        diff: ok ? null : diffLines(expected, captured.output),
      });
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  return { ok: results.every((r) => r.ok), results };
}

function formatResults(result) {
  const lines = [];
  for (const item of result.results) {
    lines.push(`${item.ok ? "OK  " : "FAIL"} ${item.name} — ${item.reason}`);
    if (item.diff) {
      for (const removed of item.diff.removed.slice(0, 8)) {
        lines.push(`  -${removed.count > 1 ? ` (${removed.count}x)` : ""} ${removed.line}`);
      }
      for (const added of item.diff.added.slice(0, 8)) {
        lines.push(`  +${added.count > 1 ? ` (${added.count}x)` : ""} ${added.line}`);
      }
    }
  }
  lines.push("");
  lines.push(`verify-baseline: ${result.ok ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const update = process.argv.includes("--update");
  const json = process.argv.includes("--json");
  const result = verifyBaselines({ update });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(formatResults(result) + "\n");
  }
  process.exit(result.ok ? 0 : 1);
}
