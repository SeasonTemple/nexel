#!/usr/bin/env node
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

if (!existsSync(path.join(repoRoot, ".git"))) {
  process.exit(0);
}

try {
  execSync("git rev-parse --is-inside-work-tree", { cwd: repoRoot, stdio: "ignore" });
} catch {
  process.exit(0);
}

if (process.env.CI || process.env.NETOPS_SKIP_HUSKY) {
  process.exit(0);
}

try {
  const husky = await import("husky");
  husky.default();
  execSync("git config commit.template .gitmessage", { cwd: repoRoot, stdio: "ignore" });
} catch (e) {
  if (e?.code === "ERR_MODULE_NOT_FOUND") process.exit(0);
  console.error(`husky setup skipped: ${e.message}`);
  process.exit(0);
}
