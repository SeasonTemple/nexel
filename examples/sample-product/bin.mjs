#!/usr/bin/env node
// Sample bin — demonstrates how a downstream product wraps the
// nexel kernel:
//   1. Load this product's ProductConfig from agent-skills.config.mjs.
//   2. Import the kernel's createCli factory + adapter modules.
//   3. Build a CLI bound to this product's identity + content layout.
//   4. Run it with process.argv.
//
// Real downstream products would publish this file as their npm `bin`
// entry; users would invoke it as `<binName> install --agent codex`.
// In this repo it lives under examples/ so the nexel test suite
// can exercise the kernel against a real productConfig end-to-end.
//
// Driving this bin from an AI agent? The product-agnostic behavioral
// contract every nexel-derived bin honors (verbs, exit codes,
// --json envelope, non-interactive flags, help affordances) is
// documented in docs/AGENT-CLI-CONTRACT.md.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { createCli } from "../../scripts/installer/index.mjs";
import * as claude from "../../scripts/installer/adapters/claude.mjs";
import * as codex from "../../scripts/installer/adapters/codex.mjs";
import * as opencode from "../../scripts/installer/adapters/opencode.mjs";

import productConfig from "./agent-skills.config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Sample fixture is self-contained: repoRoot = this directory.
process.chdir(HERE);

const require = createRequire(import.meta.url);
const PKG = require("../../package.json");

const cli = createCli({
  adapters: [claude, codex, opencode],
  productConfig,
  version: PKG.version,
  // Sample-product demonstrates the v0.7 opt-in scaffold verb. Real
  // downstream products that already ship a plugin form can skip this
  // flag — the scaffolder is for new products bootstrapping their
  // plugin layout from a ProductConfig.
  enablePluginScaffolder: true,
});

cli.run(process.argv).catch((e) => {
  process.stderr.write(`fatal: ${e?.stack || e?.message || e}\n`);
  process.exit(1);
});
