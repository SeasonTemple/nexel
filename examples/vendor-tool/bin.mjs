#!/usr/bin/env node
// @nexel/vendor CLI (MVP scaffold).
//
//   vendor pull [<as> | --all] [--dry-run] [--json]   # default --all
//   vendor diff [<as> | --all] [--json]               # read-only
//   vendor fork (<as> | --all) [--json]
//   vendor --help
//
// Exit codes:
//   0  ok
//   1  usage / fatal / not-vendored
//   2  manual-merge refused (local changes; human action required)
//
// This bin is a downstream consumer: it imports nothing from the kernel
// (`installer/**`). The consuming product's identity comes from the config.

import path from "node:path";
import { fileURLToPath } from "node:url";

import * as vendor from "./vendor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELP = `vendor — declarative skill vendoring (local-path MVP)

Usage:
  vendor pull [<as> | --all] [--dry-run] [--json]
  vendor diff [<as> | --all] [--json]
  vendor fork (<as> | --all) [--json]

Options:
  --all         operate on every entry in vendorFrom (default for pull/diff)
  --dry-run     compute the decision but write nothing (pull only)
  --json        emit a structured JSON envelope
  --config <p>  config path (default: ./vendor.config.mjs next to this bin)
  -h, --help    show this help

Exit codes: 0 ok · 1 usage/fatal/not-vendored · 2 manual-merge refused`;

function parseArgv(argv) {
  const flags = { all: false, dryRun: false, json: false, help: false, config: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--all": flags.all = true; break;
      case "--dry-run": flags.dryRun = true; break;
      case "--json": flags.json = true; break;
      case "-h":
      case "--help": flags.help = true; break;
      case "--config": flags.config = argv[++i]; break;
      default:
        if (a.startsWith("-")) throw new vendor.VendorError("ERR_USAGE", `unknown flag: ${a}`);
        positional.push(a);
    }
  }
  return { verb: positional[0], target: positional[1], flags };
}

function selectEntries(config, target, all) {
  if (target) {
    const e = config.vendorFrom.find((x) => x.as === target);
    if (!e) throw new vendor.VendorError("ERR_USAGE", `no vendorFrom entry with as="${target}"`);
    return [e];
  }
  if (!all) return null; // caller decides whether default-all applies
  return config.vendorFrom;
}

async function loadConfig(flags) {
  const p = flags.config ? path.resolve(flags.config) : path.join(HERE, "vendor.config.mjs");
  const mod = await import(p);
  return mod.default;
}

async function main(argv) {
  const { verb, target, flags } = parseArgv(argv);

  if (flags.help || !verb) {
    process.stdout.write(HELP + "\n");
    return flags.help ? 0 : 1; // --help is success; bare invocation is a usage error
  }

  const config = await loadConfig(flags);
  const ctx = { skillIdPrefix: config.skillIdPrefix, targetSkillsDir: config.targetSkillsDir };

  if (verb === "pull") {
    const entries = selectEntries(config, target, true); // pull defaults to --all
    return runPull(entries, ctx, flags);
  }
  if (verb === "diff") {
    const entries = selectEntries(config, target, true); // diff defaults to --all
    return runDiff(entries, ctx, flags);
  }
  if (verb === "fork") {
    const entries = selectEntries(config, target, flags.all);
    if (!entries) throw new vendor.VendorError("ERR_USAGE", "fork requires <as> or --all");
    return runFork(entries, ctx, flags);
  }
  throw new vendor.VendorError("ERR_USAGE", `unknown verb: ${verb}`);
}

function runPull(entries, ctx, flags) {
  const results = [];
  let exit = 0;
  for (const entry of entries) {
    const d = vendor.pull(entry, ctx, { dryRun: flags.dryRun });
    results.push(d);
    if (d.action === "conflict" || d.action === "untracked") exit = 2;
  }
  if (flags.json) {
    emitJson("pull", exit === 0, results, flags.dryRun);
  } else {
    for (const d of results) printPull(d, flags.dryRun);
  }
  return exit;
}

function runDiff(entries, ctx, flags) {
  const results = entries.map((e) => vendor.planDiff(e, ctx));
  if (flags.json) {
    emitJson("diff", true, results);
  } else {
    for (const d of results) printDiff(d);
  }
  return 0;
}

function runFork(entries, ctx, flags) {
  const results = entries.map((e) => vendor.fork(e, ctx));
  if (flags.json) {
    emitJson("fork", true, results);
  } else {
    for (const d of results) process.stdout.write(`forked ${d.as} (sidecar removed)\n`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printPull(d, dryRun) {
  const tag = dryRun ? "[dry-run] " : "";
  switch (d.action) {
    case "fresh":
      process.stdout.write(`${tag}vendored ${d.as} (fresh)\n`);
      break;
    case "up-to-date":
      process.stdout.write(`${tag}${d.as} up-to-date\n`);
      break;
    case "fast-forward":
      process.stdout.write(`${tag}fast-forwarded ${d.as}\n`);
      break;
    case "conflict":
      process.stderr.write(
        `CONFLICT ${d.as}: local changes (${d.attribution} changed); refusing ${d.policy} fast-forward\n` +
          `${d.diff}\n`,
      );
      break;
    case "untracked":
      process.stderr.write(
        `UNTRACKED ${d.as}: target exists but has no .vendored.json; refusing to overwrite. Remove it or run fork.\n`,
      );
      break;
    default:
      process.stdout.write(`${tag}${d.as}: ${d.action}\n`);
  }
}

function printDiff(d) {
  if (d.action === "not-vendored") {
    process.stdout.write(`${d.as}: not vendored\n`);
  } else if (d.action === "clean") {
    process.stdout.write(`${d.as}: clean (matches origin)\n`);
  } else {
    process.stdout.write(`${d.as}: differs\n${d.diff}\n`);
  }
}

function emitJson(verb, ok, entries, dryRun) {
  const envelope = { verb, ok, ...(dryRun ? { dryRun: true } : {}), entries: entries.map(slim) };
  process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
}

// Drop only the heavy `files` Buffer array from the JSON envelope. The sidecar
// (originHash, vendoredAt, …) is plain JSON and useful to CI consumers, so it
// stays.
function slim(d) {
  const { files, ...rest } = d;
  return rest;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((e) => {
    if (e instanceof vendor.VendorError) {
      process.stderr.write(`error [${e.code}]: ${e.message}\n`);
      process.exit(1);
    }
    process.stderr.write(`fatal: ${e?.stack || e?.message || e}\n`);
    process.exit(1);
  });
