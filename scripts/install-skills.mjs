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
  installMulti,
  listAdapterStatus,
  loadManifest,
  uninstall,
  uninstallMulti,
} from "./installer/index.mjs";
import { readState } from "./installer/core/filesystem.mjs";
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
    action: null,
    adapterIds: [],
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
    if (x === "--action") { out.action = argv[++i]; continue; }
    if (x.startsWith("--action=")) { out.action = x.slice(9); continue; }
    if (x === "--agent" || x === "-a") {
      const value = argv[++i];
      out.adapterIds.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (x.startsWith("--agent=")) {
      out.adapterIds.push(...x.slice(8).split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
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
  --action <name>        install, uninstall, or lifecycle (install then uninstall)
  --agent <id>           claude-code, codex, opencode; repeat or comma-separate
  --selection <id>       sample-demo or sample:hello-world
  --target <path>        Use this demo sandbox root instead of a temp dir
  --yes, -y              Skip the interactive confirmation
  --json                 Emit a machine-readable result envelope
  --cleanup              Remove the demo target after a successful run
  --no-banner            Hide the ASCII banner
  -h, --help             Show this help

Examples:
  node scripts/install-skills.mjs
  node scripts/install-skills.mjs --demo --yes --json --cleanup
  node scripts/install-skills.mjs --demo --action lifecycle --agent codex --target /tmp/nexel-demo
  node scripts/install-skills.mjs list --json
  node scripts/install-skills.mjs plan --target /tmp/nexel-demo --bundle sample-demo

The demo reuses examples/sample-product. By default it writes to a temporary
sandbox under ${os.tmpdir()}, not to ~/.codex, ~/.claude, or ~/.config/opencode.
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

function makeExecutableShim(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}

function createDemoEnv(demoRoot) {
  const binDir = path.join(demoRoot, ".bin");
  for (const name of ["claude", "codex", "opencode"]) {
    makeExecutableShim(path.join(binDir, name));
  }
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
    CLAUDE_HOME: path.join(demoRoot, "agents", "claude-code"),
    CODEX_HOME: path.join(demoRoot, "agents", "codex"),
    OPENCODE_CONFIG_DIR: path.join(demoRoot, "agents", "opencode"),
  };
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
        const rel = relPathForDisplay(targetRoot, abs);
        if (!rel.startsWith(".bin/")) out.push(rel);
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

export function formatLifecycleFlow({ action, demoRoot, adapterIds, selectionIds, temporary = true }) {
  const rootLabel = temporary ? "temporary sandbox" : "demo sandbox";
  return [
    "1. Load ProductConfig from examples/sample-product/agent-skills.config.mjs",
    "2. Load manifest from examples/sample-product/sample.install.json",
    `3. Choose action: ${action}`,
    `4. Choose target agent CLI(s): ${adapterIds.join(", ")}`,
    `5. Resolve selection: ${selectionIds.join(", ")}`,
    `6. Build install/uninstall plan under ${rootLabel}: ${demoRoot}`,
    "7. Stage/promote files or remove managed files",
    "8. Update managed state in each agent's .nexel/state.json",
  ].join("\n");
}

function formatMultiInstallPlan(dryRun) {
  if (dryRun.results) {
    return dryRun.results.map((entry) => {
      if (!entry.ok) return `${entry.adapterId}: ${entry.error?.code || "error"} — ${entry.error?.message || ""}`;
      const plan = entry.result?.plan;
      const target = plan?.targetRoot || entry.result?.targetRoot || "(unknown target)";
      return [`Agent: ${entry.adapterId}`, `Target: ${target}`, "", formatPlanText(plan)].join("\n");
    }).join("\n\n");
  }
  return formatPlanText(dryRun.plan);
}

function formatUninstallPlan(dryRun) {
  const formatOne = (adapterId, result) => {
    const lines = [`Agent: ${adapterId}`, `would delete ${result.toDelete?.length ?? 0} file(s):`];
    for (const rel of result.toDelete || []) lines.push(`  - ${rel}`);
    return lines.join("\n");
  };
  if (dryRun.results) {
    return dryRun.results.map((entry) => {
      if (!entry.ok) return `${entry.adapterId}: ${entry.error?.code || "error"} — ${entry.error?.message || ""}`;
      return formatOne(entry.adapterId, entry.result);
    }).join("\n\n");
  }
  return formatOne(dryRun.adapterId || "custom", dryRun);
}

function targetSummary(adapterIds, env) {
  const statuses = listAdapterStatus({ env });
  return adapterIds.map((id) => {
    const status = statuses.find((s) => s.id === id);
    return {
      adapterId: id,
      displayName: status?.displayName || id,
      targetRoot: status?.targetRoot || "",
    };
  });
}

async function chooseAction({ prompts = clack } = {}) {
  prompts.intro("nexel sample-product installer demo");
  const action = await prompts.select({
    message: "What would you like to demo?",
    options: [
      { value: "install", label: "Install  —  choose agent CLI(s), preview, then write managed files" },
      { value: "uninstall", label: "Uninstall  —  choose agent CLI(s), preview, then remove managed files" },
      { value: "lifecycle", label: "Lifecycle  —  install, then uninstall from the same sandbox" },
    ],
    initialValue: "install",
  });
  if (prompts.isCancel(action)) throw new CancelledError("demo-action");
  return action;
}

async function chooseAgents({ env, prompts = clack } = {}) {
  const adapters = listAdapterStatus({ env }).filter((a) => a.supportsDirect);
  const selected = await prompts.multiselect({
    message: "Target agent CLI(s) — space toggle, enter confirm",
    options: adapters.map((a) => ({
      value: a.id,
      label: `${a.displayName}  (${a.targetRoot})`,
      hint: `sandboxed demo target | cli=yes`,
    })),
    required: true,
    initialValues: ["codex"],
  });
  if (prompts.isCancel(selected)) throw new CancelledError("demo-agent");
  return Array.isArray(selected) ? selected : [selected];
}

async function seedForUninstall({ repoRoot, env, adapterIds, selectionIds, version }) {
  if (adapterIds.length > 1) {
    await installMulti({
      repoRoot,
      adapterIds,
      selectionIds,
      installerVersion: version,
      allowNoCli: true,
      requestedBy: "interactive",
      productConfig,
      env,
    });
    return;
  }
  await install({
    repoRoot,
    adapterId: adapterIds[0],
    selectionIds,
    installerVersion: version,
    allowNoCli: true,
    requestedBy: "interactive",
    productConfig,
    env,
  });
}

async function performInstall({ env, adapterIds, selectionIds, yes, json, prompts }) {
  const common = {
    repoRoot: SAMPLE_ROOT,
    selectionIds,
    installerVersion: PKG.version,
    allowNoCli: true,
    requestedBy: "interactive",
    productConfig,
    env,
  };
  const dryRun = adapterIds.length > 1
    ? await installMulti({ ...common, adapterIds, dryRun: true })
    : await install({ ...common, adapterId: adapterIds[0], dryRun: true });
  const planText = formatMultiInstallPlan(dryRun);
  if (!yes) {
    const ok = await confirmPlan({
      planText,
      prompts,
      message: "Install this sample selection into the selected sandbox agent CLI target(s)?",
      noteTitle: "Install plan",
    });
    if (!ok) throw new CancelledError("demo-install-confirm");
  } else if (!json) {
    prompts.note(planText, "Install plan");
  }

  const spinner = json ? null : startSpinner({ prompts, label: "Installing sample assets" });
  try {
    const result = adapterIds.length > 1
      ? await installMulti({ ...common, adapterIds })
      : await install({ ...common, adapterId: adapterIds[0] });
    spinner?.stop("Demo install complete");
    return result;
  } catch (e) {
    spinner?.stop("Demo install failed", 1);
    throw e;
  }
}

async function performUninstall({ env, adapterIds, selectionIds, yes, json, prompts }) {
  const common = {
    repoRoot: SAMPLE_ROOT,
    selectionIds,
    installerVersion: PKG.version,
    force: false,
    productConfig,
    env,
  };
  const dryRun = adapterIds.length > 1
    ? await uninstallMulti({ ...common, adapterIds, dryRun: true })
    : await uninstall({ ...common, adapterId: adapterIds[0], dryRun: true });
  const planText = formatUninstallPlan(dryRun);
  if (!yes) {
    const ok = await confirmPlan({
      planText,
      prompts,
      message: "Uninstall this sample selection from the selected sandbox agent CLI target(s)?",
      noteTitle: "Uninstall plan",
    });
    if (!ok) throw new CancelledError("demo-uninstall-confirm");
  } else if (!json) {
    prompts.note(planText, "Uninstall plan");
  }

  const spinner = json ? null : startSpinner({ prompts, label: "Removing managed sample assets" });
  try {
    const result = adapterIds.length > 1
      ? await uninstallMulti({ ...common, adapterIds })
      : await uninstall({ ...common, adapterId: adapterIds[0] });
    spinner?.stop("Demo uninstall complete");
    return result;
  } catch (e) {
    spinner?.stop("Demo uninstall failed", 1);
    throw e;
  }
}

async function chooseSelections({ manifest, prompts = clack } = {}) {
  const installable = DEMO_SELECTIONS.filter((option) => {
    return manifest.bundles?.[option.value] || manifest.skills?.[option.value];
  });
  const selected = await prompts.select({
    message: "Choose what to install or uninstall",
    options: installable,
    initialValue: "sample-demo",
  });
  if (prompts.isCancel(selected)) throw new CancelledError("demo-selection");
  return [selected];
}

function resultOk(result) {
  if (!result) return true;
  if (typeof result.failCount === "number") return result.failCount === 0;
  return result.ok !== false;
}

export async function runDemoInstall({
  selectionIds = [],
  adapterIds = [],
  action = null,
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
    const env = createDemoEnv(targetRoot);
    if (!json) {
      renderBanner({ title: "nexel demo", version: PKG.version, enabled: !noBanner });
    }
    const chosenAction = action || (yes ? "install" : await chooseAction({ prompts }));
    const chosenSelectionIds = selectionIds.length > 0
      ? selectionIds
      : yes
        ? ["sample-demo"]
        : await chooseSelections({ manifest, prompts });
    const chosenAdapterIds = adapterIds.length > 0
      ? [...new Set(adapterIds)]
      : yes
        ? ["codex"]
        : await chooseAgents({ env, prompts });

    if (!json) {
      prompts.note(
        formatLifecycleFlow({
          action: chosenAction,
          demoRoot: targetRoot,
          adapterIds: chosenAdapterIds,
          selectionIds: chosenSelectionIds,
          temporary: target === null,
        }),
        "Demo flow"
      );
      const targets = targetSummary(chosenAdapterIds, env)
        .map((t) => `  - ${t.displayName}: ${t.targetRoot}`)
        .join("\n");
      prompts.note(targets, "Sandbox agent targets");
    }

    const installResult = ["install", "lifecycle"].includes(chosenAction)
      ? await performInstall({ env, adapterIds: chosenAdapterIds, selectionIds: chosenSelectionIds, yes, json, prompts })
      : null;

    if (chosenAction === "uninstall") {
      await seedForUninstall({
        repoRoot: SAMPLE_ROOT,
        env,
        adapterIds: chosenAdapterIds,
        selectionIds: chosenSelectionIds,
        version: PKG.version,
      });
    }

    const uninstallResult = ["uninstall", "lifecycle"].includes(chosenAction)
      ? await performUninstall({ env, adapterIds: chosenAdapterIds, selectionIds: chosenSelectionIds, yes, json, prompts })
      : null;

    const files = listDemoFiles(targetRoot);
    const targets = targetSummary(chosenAdapterIds, env).map((t) => ({
      ...t,
      writtenCount: installResult?.results
        ? (installResult.results.find((r) => r.adapterId === t.adapterId)?.result?.writtenCount ?? 0)
        : (installResult?.writtenCount ?? 0),
      state: readState(t.targetRoot),
    }));

    if (cleanup) {
      cleanupTarget();
    }

    const envelope = {
      ok: resultOk(installResult) && resultOk(uninstallResult),
      targetRoot,
      cleaned,
      action: chosenAction,
      adapterIds: chosenAdapterIds,
      selectionIds: chosenSelectionIds,
      writtenCount: installResult?.results
        ? installResult.results.reduce((sum, r) => sum + (r.result?.writtenCount ?? 0), 0)
        : (installResult?.writtenCount ?? 0),
      removedCount: uninstallResult?.results
        ? uninstallResult.results.reduce((sum, r) => sum + (r.result?.toDelete?.length ?? 0), 0)
        : (uninstallResult?.toDelete?.length ?? 0),
      targets,
      files,
    };

    if (json) {
      process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
      return envelope;
    }

    prompts.note(files.map((f) => `  ${f}`).join("\n"), "Demo target files");
    renderNextSteps({
      prompts,
      targets,
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
    adapterIds: parsed.adapterIds,
    action: parsed.action,
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
