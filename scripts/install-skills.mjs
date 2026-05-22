#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import * as clack from "@clack/prompts";

import {
  defaultManifestPath,
  formatPlanText,
  install,
  loadManifest,
} from "./installer/index.mjs";
import {
  CancelledError,
  confirmPlan,
  renderBanner,
  renderNextSteps,
  startSpinner,
} from "./installer/cli/prompts.mjs";

import productConfig from "../examples/sample-product/agent-skills.config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const SAMPLE_ROOT = path.join(REPO_ROOT, "examples", "sample-product");
const SAMPLE_BIN = path.join(SAMPLE_ROOT, "bin.mjs");
const require = createRequire(import.meta.url);
const PKG = require("../package.json");

const DEMO_SELECTIONS = Object.freeze([
  {
    value: "sample-demo",
    label: "sample-demo",
    hint: "bundle: installs one skill, one agent, and one rule",
  },
  {
    value: "sample:hello-world",
    label: "sample:hello-world",
    hint: "standalone skill only",
  },
]);

function parseDemoArgs(argv) {
  const out = {
    demo: false,
    help: false,
    yes: false,
    json: false,
    cleanup: false,
    noBanner: false,
    target: null,
    selectionIds: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const x = argv[i];
    if (x === "--demo") { out.demo = true; continue; }
    if (x === "--help" || x === "-h") { out.help = true; continue; }
    if (x === "--yes" || x === "-y") { out.yes = true; continue; }
    if (x === "--json") { out.json = true; continue; }
    if (x === "--cleanup") { out.cleanup = true; continue; }
    if (x === "--no-banner") { out.noBanner = true; continue; }
    if (x === "--target") { out.target = argv[++i]; continue; }
    if (x.startsWith("--target=")) { out.target = x.slice(9); continue; }
    if (x === "--selection") { out.selectionIds.push(argv[++i]); continue; }
    if (x.startsWith("--selection=")) { out.selectionIds.push(x.slice(12)); continue; }
  }
  return out;
}

function isDemoInvocation(argv) {
  return argv.length === 0 || argv.includes("--demo") || argv[0] === "--help" || argv[0] === "-h";
}

function printDemoHelp() {
  process.stdout.write(`nexel sample-product install demo

Usage:
  node scripts/install-skills.mjs
  node scripts/install-skills.mjs --demo [--yes] [--json] [--cleanup]
  node scripts/install-skills.mjs <sample-installer verb> [flags]

Demo flags:
  --demo                 Run the safe sample install demo explicitly
  --selection <id>       sample-demo or sample:hello-world
  --target <path>        Install into this target root instead of a temp dir
  --yes, -y              Skip the interactive confirmation
  --json                 Emit a machine-readable result envelope
  --cleanup              Remove the demo target after a successful run
  --no-banner            Hide the ASCII banner
  -h, --help             Show this help

Examples:
  node scripts/install-skills.mjs
  node scripts/install-skills.mjs --demo --yes --json --cleanup
  node scripts/install-skills.mjs list --json
  node scripts/install-skills.mjs plan --target /tmp/nexel-demo --bundle sample-demo

The demo reuses examples/sample-product. By default it writes to a temporary
target under ${os.tmpdir()}, not to ~/.codex, ~/.claude, or ~/.config/opencode.
`);
}

function forwardToSampleBin(argv) {
  const result = spawnSync(process.execPath, [SAMPLE_BIN, ...argv], {
    cwd: SAMPLE_ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function makeTempTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-demo-"));
}

function relPathForDisplay(targetRoot, absPath) {
  return path.relative(targetRoot, absPath).split(path.sep).join("/");
}

export function listDemoFiles(targetRoot) {
  if (!fs.existsSync(targetRoot)) return [];
  const out = [];
  const stack = [targetRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(relPathForDisplay(targetRoot, abs));
      }
    }
  }
  return out.sort();
}

export function formatDemoFlow({ targetRoot, selectionIds, temporary = true }) {
  const targetLabel = temporary ? "temporary target" : "demo target";
  return [
    "1. Load ProductConfig from examples/sample-product/agent-skills.config.mjs",
    "2. Load manifest from examples/sample-product/sample.install.json",
    `3. Resolve selection: ${selectionIds.join(", ")}`,
    `4. Build install plan for ${targetLabel}: ${targetRoot}`,
    "5. Stage and promote skill / agent / rule files",
    "6. Write managed state to .nexel/state.json",
  ].join("\n");
}

async function chooseSelections({ manifest, prompts = clack } = {}) {
  prompts.intro("nexel sample-product installer demo");
  const installable = DEMO_SELECTIONS.filter((option) => {
    return manifest.bundles?.[option.value] || manifest.skills?.[option.value];
  });
  const selected = await prompts.select({
    message: "Choose what to install into the temporary demo target",
    options: installable,
    initialValue: "sample-demo",
  });
  if (prompts.isCancel(selected)) throw new CancelledError("demo-selection");
  return [selected];
}

export async function runDemoInstall({
  selectionIds = [],
  target = null,
  yes = false,
  json = false,
  cleanup = false,
  noBanner = false,
  prompts = clack,
} = {}) {
  const targetRoot = target ? path.resolve(target) : makeTempTarget();
  let cleaned = false;
  const cleanupTarget = () => {
    if (!cleaned) {
      fs.rmSync(targetRoot, { recursive: true, force: true });
      cleaned = true;
    }
  };

  try {
    const manifest = loadManifest(defaultManifestPath(SAMPLE_ROOT, productConfig));
    if (!json) {
      renderBanner({ title: "nexel demo", version: PKG.version, enabled: !noBanner });
    }
    const chosenSelectionIds = selectionIds.length > 0
      ? selectionIds
      : yes
        ? ["sample-demo"]
        : await chooseSelections({ manifest, prompts });

    if (!json) {
      prompts.note(formatDemoFlow({ targetRoot, selectionIds: chosenSelectionIds, temporary: target === null }), "Demo flow");
    }

    const dryRun = await install({
      repoRoot: SAMPLE_ROOT,
      target: targetRoot,
      selectionIds: chosenSelectionIds,
      installerVersion: PKG.version,
      productConfig,
      dryRun: true,
      allowNoCli: true,
      requestedBy: "interactive",
    });
    const planText = formatPlanText(dryRun.plan);

    if (!yes) {
      const ok = await confirmPlan({
        planText,
        prompts,
        message: "Install this sample selection into the temporary demo target?",
        noteTitle: "Install plan",
      });
      if (!ok) throw new CancelledError("demo-confirm");
    } else if (!json) {
      prompts.note(planText, "Install plan");
    }

    const spinner = json ? null : startSpinner({ prompts, label: "Installing sample assets" });
    let result;
    try {
      result = await install({
        repoRoot: SAMPLE_ROOT,
        target: targetRoot,
        selectionIds: chosenSelectionIds,
        installerVersion: PKG.version,
        productConfig,
        allowNoCli: true,
        requestedBy: "interactive",
      });
      spinner?.stop("Demo install complete");
    } catch (e) {
      spinner?.stop("Demo install failed", 1);
      throw e;
    }

    const files = listDemoFiles(targetRoot);
    const statePath = path.join(targetRoot, ".nexel", "state.json");

    if (cleanup) {
      cleanupTarget();
    }

    const envelope = {
      ok: result.ok,
      targetRoot,
      cleaned,
      selectionIds: chosenSelectionIds,
      writtenCount: result.writtenCount ?? 0,
      skippedCount: result.skippedCount ?? 0,
      statePath,
      files,
    };

    if (json) {
      process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
      return envelope;
    }

    prompts.note(files.map((f) => `  ${f}`).join("\n"), "Demo target files");
    renderNextSteps({
      prompts,
      targets: [{
        adapterId: "sample-target",
        displayName: "Temporary demo target",
        targetRoot,
        writtenCount: result.writtenCount ?? 0,
      }],
      selectionIds: chosenSelectionIds,
    });
    if (cleanup) {
      prompts.outro(`Cleaned demo target: ${targetRoot}`);
    } else {
      prompts.outro(`Demo target left for inspection. Clean up with: rm -rf ${targetRoot}`);
    }
    return envelope;
  } catch (e) {
    if (cleanup) cleanupTarget();
    throw e;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (!isDemoInvocation(argv)) {
    forwardToSampleBin(argv);
    return;
  }
  const parsed = parseDemoArgs(argv);
  if (parsed.help) {
    printDemoHelp();
    return;
  }
  await runDemoInstall({
    selectionIds: parsed.selectionIds,
    target: parsed.target,
    yes: parsed.yes,
    json: parsed.json,
    cleanup: parsed.cleanup,
    noBanner: parsed.noBanner,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    if (e instanceof CancelledError) {
      process.stderr.write(`cancelled at ${e.stage}\n`);
      process.exit(130);
    }
    process.stderr.write(`fatal: ${e?.stack || e?.message || e}\n`);
    process.exit(1);
  });
}
