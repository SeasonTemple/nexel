import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import SampleProductPlugin from "./.opencode/plugins/sample-product.js";
import { buildInstallPlan } from "../../scripts/installer/core/plan.mjs";
import { loadManifest } from "../../scripts/installer/core/manifest/loader.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(HERE, "skills");
const LEGACY_INSTRUCTIONS = path.join(SKILLS_DIR, "hello-world", "references", "opencode-instructions.md");
const HOST_INSTRUCTIONS = path.join(SKILLS_DIR, "sample-host-context", "references", "host-context.md");

test("sample OpenCode plugin configures skills path and instructions idempotently", async () => {
  const plugin = await SampleProductPlugin({});
  const config = {};

  await plugin.config(config);
  await plugin.config(config);

  assert.deepEqual(config.skills.paths, [SKILLS_DIR]);
  // v0.8: discover picks up BOTH hello-world (opencode-instructions: alias) and
  // sample-host-context (host-instructions: unified key). The unified key + alias
  // mechanism (R2, AE5) is exercised end-to-end through the OpenCode plugin entry.
  assert.deepEqual(config.instructions.sort(), [HOST_INSTRUCTIONS, LEGACY_INSTRUCTIONS].sort());
});

test("sample OpenCode instruction file remains a skill file, not a separate manifest asset", () => {
  const manifest = loadManifest(path.join(HERE, "sample.install.json"));
  assert.equal(Object.hasOwn(manifest.rules, "skills/hello-world/references/opencode-instructions.md"), false);

  const plan = buildInstallPlan(manifest, ["sample:hello-world"], {
    repoRoot: HERE,
    targetRoot: path.join(HERE, ".tmp-target"),
  });

  assert.ok(plan.files.some((file) => file.sourcePath === "skills/hello-world/references/opencode-instructions.md"));
  assert.ok(plan.files.every((file) => file.assetType === "skill"));
  assert.equal(fs.existsSync(LEGACY_INSTRUCTIONS), true);
});
