// Architecture lint — enforce Z three-layer dependency direction.
//
// Rules:
//   core/**/*.mjs      → may import ONLY from core/** or node:** or npm packages
//                        (never from cli/ or adapters/)
//   adapters/**/*.mjs  → may import from core/** or node:** or npm packages
//                        (never from cli/)
//   cli/**/*.mjs       → may import from core/** or adapters/** or node:** or
//                        npm packages (unrestricted within installer/)
//   index.mjs          → may import from core/, cli/, adapters/ (the public
//                        API surface composes everything)
//   examples/<product>/bin.mjs → may import ONLY from installer/index.mjs
//                                (or named adapter modules), the example's
//                                own ProductConfig file, and scripts/ root
//                                utilities that are not part of the kernel
//
// This file uses Node built-ins only (fs + regex). No dev dependency added.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = HERE;
const SCRIPTS_ROOT = path.resolve(HERE, "..");

/**
 * Recursively walk a directory, returning all .mjs file paths (excluding tests).
 */
function listMjs(dir, predicate = () => true) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listMjs(full, predicate));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".mjs") && predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import\s+[^"']*from\s+|export\s+[^"']*from\s+|import\s*\(\s*)["']([^"']+)["']/g;

function extractImports(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    out.push(m[1]);
  }
  return out;
}

function isExternalImport(spec) {
  // Node built-ins (node: prefix) and bare npm package imports.
  if (spec.startsWith("node:")) return true;
  if (!spec.startsWith(".") && !spec.startsWith("/")) return true;
  return false;
}

/**
 * Resolve a relative import spec against its containing file's directory and
 * return a normalized path relative to INSTALLER_ROOT. Returns null when the
 * import refers outside the installer/ tree (e.g., "../../lint-skills.mjs").
 */
function resolveRelative(fromFile, spec) {
  const absTarget = path.resolve(path.dirname(fromFile), spec);
  const rel = path.relative(INSTALLER_ROOT, absTarget);
  // If rel starts with "..", the target lives outside installer/.
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

function classifyLayer(relPath) {
  if (relPath === "index.mjs") return "index";
  if (relPath.startsWith("core/")) return "core";
  if (relPath.startsWith("cli/")) return "cli";
  if (relPath.startsWith("adapters/")) return "adapters";
  return "other";
}

const ALLOWED = {
  core: new Set(["core"]),
  adapters: new Set(["core", "adapters"]),
  cli: new Set(["core", "cli", "adapters"]),
  index: new Set(["core", "cli", "adapters", "index"]),
};

test("architecture: core/ only imports from core/ or external packages", () => {
  const files = listMjs(path.join(INSTALLER_ROOT, "core"), (p) => !p.endsWith(".test.mjs"));
  const violations = [];
  for (const file of files) {
    const relSrc = path.relative(INSTALLER_ROOT, file).split(path.sep).join("/");
    for (const spec of extractImports(file)) {
      if (isExternalImport(spec)) continue;
      const target = resolveRelative(file, spec);
      if (target === null) {
        violations.push(`${relSrc} → ${spec} (escapes installer/)`);
        continue;
      }
      const targetLayer = classifyLayer(target);
      if (!ALLOWED.core.has(targetLayer)) {
        violations.push(`${relSrc} → ${target} (forbidden: core may not import ${targetLayer})`);
      }
    }
  }
  assert.deepEqual(violations, [], `core/ layer violations:\n  ${violations.join("\n  ")}`);
});

test("architecture: adapters/ imports from core/ or adapters/ but never cli/", () => {
  const files = listMjs(path.join(INSTALLER_ROOT, "adapters"), (p) => !p.endsWith(".test.mjs"));
  const violations = [];
  for (const file of files) {
    const relSrc = path.relative(INSTALLER_ROOT, file).split(path.sep).join("/");
    for (const spec of extractImports(file)) {
      if (isExternalImport(spec)) continue;
      const target = resolveRelative(file, spec);
      if (target === null) {
        violations.push(`${relSrc} → ${spec} (escapes installer/)`);
        continue;
      }
      const targetLayer = classifyLayer(target);
      if (!ALLOWED.adapters.has(targetLayer)) {
        violations.push(`${relSrc} → ${target} (forbidden: adapters may not import ${targetLayer})`);
      }
    }
  }
  assert.deepEqual(violations, [], `adapters/ layer violations:\n  ${violations.join("\n  ")}`);
});

test("architecture: cli/ imports from core/, adapters/, or cli/ — no internal escapes", () => {
  const files = listMjs(path.join(INSTALLER_ROOT, "cli"), (p) => !p.endsWith(".test.mjs"));
  const violations = [];
  for (const file of files) {
    const relSrc = path.relative(INSTALLER_ROOT, file).split(path.sep).join("/");
    for (const spec of extractImports(file)) {
      if (isExternalImport(spec)) continue;
      const target = resolveRelative(file, spec);
      if (target === null) {
        // Allow cli/ to import from scripts/ root (e.g., ../../install-skills.mjs).
        // This is the Unit 7 thin-wrapper that re-invokes the bin's main().
        // It's a legitimate temporary coupling that Unit 7's followup
        // (banner/argv/format extraction) will remove.
        continue;
      }
      const targetLayer = classifyLayer(target);
      if (!ALLOWED.cli.has(targetLayer)) {
        violations.push(`${relSrc} → ${target} (forbidden: cli may not import ${targetLayer})`);
      }
    }
  }
  assert.deepEqual(violations, [], `cli/ layer violations:\n  ${violations.join("\n  ")}`);
});

test("architecture: examples/sample-product/bin.mjs only imports the public API surface", () => {
  const file = path.resolve(SCRIPTS_ROOT, "..", "examples", "sample-product", "bin.mjs");
  if (!fs.existsSync(file)) return; // example may be relocated later
  const imports = extractImports(file).filter((s) => !isExternalImport(s));
  const violations = [];
  for (const spec of imports) {
    // Allowed: the public API surface (../../scripts/installer/index.mjs)
    //   and named adapter modules (kernel adapters/* are part of the
    //   public surface for now; v0.2.0 will expose them via subpath exports).
    // Allowed: ./agent-skills.config.mjs (the example's own ProductConfig).
    // Forbidden: deep imports into core/ or cli/ internals.
    if (/installer\/index\.mjs$/.test(spec)) continue;
    if (/installer\/adapters\/[a-z]+\.mjs$/.test(spec)) continue;
    if (/^\.\/[a-z][\w.-]*\.mjs$/.test(spec)) continue;
    if (/installer\/(core|cli)\//.test(spec)) {
      violations.push(`examples/sample-product/bin.mjs → ${spec} (must go through installer/index.mjs)`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `sample bin imports installer internals directly:\n  ${violations.join("\n  ")}\n  Use installer/index.mjs as the entry point.`
  );
});

test("architecture: sample OpenCode plugin imports only the public plugin subpath", () => {
  const file = path.resolve(SCRIPTS_ROOT, "..", "examples", "sample-product", ".opencode", "plugins", "sample-product.js");
  if (!fs.existsSync(file)) return;
  const imports = extractImports(file);
  const violations = [];

  for (const spec of imports) {
    if (spec.startsWith("node:")) continue;
    if (spec === "nexel/adapters/opencode-plugin") continue;
    violations.push(`examples/sample-product/.opencode/plugins/sample-product.js → ${spec} (must use nexel/adapters/opencode-plugin, not installer internals)`);
  }

  assert.deepEqual(
    violations,
    [],
    `sample OpenCode plugin imports private paths:\n  ${violations.join("\n  ")}`
  );
});

test("architecture: installer/index.mjs re-exports stable public API symbols", () => {
  const file = path.join(INSTALLER_ROOT, "index.mjs");
  const src = fs.readFileSync(file, "utf8");
  const expected = [
    "createCli",
    "createAdapterRegistry",
    "defineProductConfig",
    "SPI_REQUIRED",
    "SPI_DEFAULTS",
    "validateAdapter",
    "assetTypes",
    "defaultTargetMapping",
    "whichSync",
    "loadManifest",
    "validateManifest",
    "CommandError",
    "FsError",
    "StateError",
    "PlanError",
    "AdapterError",
    "ProductConfigError",
  ];
  const missing = expected.filter((sym) => !new RegExp(`\\b${sym}\\b`).test(src));
  assert.deepEqual(missing, [], `index.mjs missing expected symbols: ${missing.join(", ")}`);
});
