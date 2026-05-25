// U6 (plan 2026-05-25-001): sample-product marketplace contract test.
//
// Uses the kernel helper `verifyMarketplaceLockstep` to assert that every
// plugin / marketplace manifest in this sample matches nexel's package.json
// version. Catches version drift the moment a contributor bumps one
// manifest and forgets the others.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyMarketplaceLockstep } from "../../scripts/installer/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");

test("sample marketplace contract: every plugin manifest matches nexel package.json version", () => {
  const result = verifyMarketplaceLockstep([
    // Baseline: nexel package.json — every plugin in the sample tracks this.
    { path: path.join(REPO_ROOT, "package.json") },
    // Sample-product plugin.json files.
    { path: path.join(HERE, ".claude-plugin/plugin.json") },
    { path: path.join(HERE, ".codex-plugin/plugin.json") },
    // Sample-product marketplace.json entries (selector picks the right entry).
    { path: path.join(HERE, ".claude-plugin/marketplace.json"), pluginName: "sample-product" },
    // Note: .agents/plugins/marketplace.json deliberately omits per-entry
    // version (Codex marketplace shape lets plugin.json own version). It
    // is therefore not lockstep-checked here.
  ]);

  assert.equal(
    result.ok,
    true,
    `marketplace lockstep failed:\n${JSON.stringify(result.mismatches, null, 2)}`,
  );
});
