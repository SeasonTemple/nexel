// U5 (plan 2026-05-25-001): sample-product three-platform plugin layout.
//
// Asserts the on-disk layout that downstream products copy verbatim. The
// version field across all manifests must match nexel's package.json so the
// sample stays as a canonical reference; U6's verifyMarketplaceLockstep
// helper verifies that contract programmatically.
//
// IMPORTANT — F4 regression guard: package.json.main MUST remain pointed at
// the kernel barrel. Repointing it at a sample-product file breaks
// `import 'nexel'` for every downstream consumer and contradicts nexel's
// library-only positioning.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

const PLUGIN_FILES = [
  "examples/sample-product/.claude-plugin/plugin.json",
  "examples/sample-product/.claude-plugin/marketplace.json",
  "examples/sample-product/.codex-plugin/plugin.json",
  "examples/sample-product/.agents/plugins/marketplace.json",
  "examples/sample-product/.opencode/INSTALL.md",
  "examples/sample-product/.opencode/plugins/sample-product.js",
];

test("U5: every expected plugin file exists on disk", () => {
  for (const rel of PLUGIN_FILES) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, rel)),
      `missing plugin file: ${rel}`,
    );
  }
});

test("U5: every plugin / marketplace JSON parses", () => {
  for (const rel of PLUGIN_FILES.filter((f) => f.endsWith(".json"))) {
    assert.doesNotThrow(() => readJson(rel), `${rel} must parse as JSON`);
  }
});

test("U5: plugin.json + marketplace entry versions all match nexel package.json", () => {
  const pkgVersion = readJson("package.json").version;
  const claudePlugin = readJson("examples/sample-product/.claude-plugin/plugin.json");
  const codexPlugin = readJson("examples/sample-product/.codex-plugin/plugin.json");
  const claudeMarketplace = readJson("examples/sample-product/.claude-plugin/marketplace.json");

  assert.equal(claudePlugin.version, pkgVersion, "Claude plugin.json version drift");
  assert.equal(codexPlugin.version, pkgVersion, "Codex plugin.json version drift");

  const mpEntry = claudeMarketplace.plugins.find((p) => p.name === "sample-product");
  assert.ok(mpEntry, "Claude marketplace.json must declare sample-product plugin entry");
  assert.equal(mpEntry.version, pkgVersion, "Claude marketplace entry version drift");
});

test("U5: every plugin manifest names the plugin sample-product (rename canary)", () => {
  const claudePlugin = readJson("examples/sample-product/.claude-plugin/plugin.json");
  const codexPlugin = readJson("examples/sample-product/.codex-plugin/plugin.json");
  const claudeMarketplace = readJson("examples/sample-product/.claude-plugin/marketplace.json");
  const codexMarketplace = readJson("examples/sample-product/.agents/plugins/marketplace.json");

  assert.equal(claudePlugin.name, "sample-product");
  assert.equal(codexPlugin.name, "sample-product");
  assert.equal(claudeMarketplace.name, "sample-product-marketplace");
  assert.equal(codexMarketplace.name, "sample-product-marketplace");
  assert.ok(claudeMarketplace.plugins.some((p) => p.name === "sample-product"));
  assert.ok(codexMarketplace.plugins.some((p) => p.name === "sample-product"));
});

test("U5: F4 regression guard — package.json.main stays pointed at the kernel barrel", () => {
  const pkg = readJson("package.json");
  assert.equal(
    pkg.main,
    "./scripts/installer/index.mjs",
    "package.json.main must NOT be repointed to a sample-product file — that would break `import 'nexel'` for every downstream consumer (see plan U5 / F4 in 2026-05-25-001 review)",
  );
});

test("U5: package.json.exports adds the sample-product OpenCode plugin subpath", () => {
  const pkg = readJson("package.json");
  assert.equal(
    pkg.exports?.["./examples/sample-product/opencode-plugin"],
    "./examples/sample-product/.opencode/plugins/sample-product.js",
    "exports subpath must point at the sample-product OpenCode plugin entry",
  );
});

test("U5: npm pack would ship every plugin asset", () => {
  // Indirectly verified via the wildcard `examples/sample-product/**` already
  // present in files[]. Assert the wildcard is still there as the gatekeeper.
  const pkg = readJson("package.json");
  assert.ok(
    pkg.files.includes("examples/sample-product/**"),
    "package.json.files[] must include the sample-product wildcard so plugin manifests ship",
  );
});

test("U5: .opencode/INSTALL.md mentions nexel dep requirement (A4 guidance)", () => {
  const installMd = fs.readFileSync(
    path.join(REPO_ROOT, "examples/sample-product/.opencode/INSTALL.md"),
    "utf8",
  );
  assert.match(installMd, /nexel/, "INSTALL.md must mention the nexel dep requirement");
  assert.match(installMd, /opencode plugin/, "INSTALL.md must show the `opencode plugin` invocation");
});
