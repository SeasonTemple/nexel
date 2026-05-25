// Marketplace lockstep helper — verifies version-field agreement across a
// set of plugin / marketplace JSON files.
//
// A downstream product that ships plugin form maintains parallel manifests
// across Claude Code, Codex, and OpenCode. A single missed version bump
// produces silent skew: end users install the same plugin name across two
// platforms and get different versions. This helper compares the
// `version` field at every supplied spec and returns a structured report.
//
// Field scope is intentionally narrow:
//   - Only `version` is compared. `name`, `source`, `interface`, etc. are
//     contract decisions each downstream's contract test asserts itself.
//   - Caller may point at top-level plugin.json (reads top-level `version`)
//     OR at a marketplace.json (in which case `pluginName` selects the
//     correct entry from `plugins[]`).
//
// Spec shape:
//   { path: string, pluginName?: string, expectedVersion?: string }
//
// Behavior:
//   - `expectedVersion` provided → compare against that exact value.
//   - `expectedVersion` omitted → compare against the FIRST spec's resolved
//     version (baseline-from-first). Lets callers pass [packageJson, …all
//     plugin manifests] and have the lockstep computed off package.json.
//   - Missing `version` field → mismatch with `found: null`.
//   - File missing / malformed JSON → throws an Error annotated with the
//     offending path so the caller surfaces it cleanly.
//
// Returned shape: { ok: boolean, baseline: string|null, mismatches: [...] }
// `mismatches` is empty when ok = true. Each entry carries
// `{ path, pluginName?, found, expected }` so a single failure list
// pinpoints every drifted manifest.

import fs from "node:fs";
import path from "node:path";

function readVersionFromSpec({ path: filePath, pluginName }) {
  if (!fs.existsSync(filePath)) {
    const err = new Error(`marketplace-lockstep: file not found — ${filePath}`);
    err.code = "ERR_LOCKSTEP_FILE_MISSING";
    err.path = filePath;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    const err = new Error(`marketplace-lockstep: JSON parse error in ${filePath}: ${e.message}`);
    err.code = "ERR_LOCKSTEP_JSON_PARSE";
    err.path = filePath;
    throw err;
  }
  // marketplace.json shape: plugins[]  →  use pluginName selector
  if (Array.isArray(parsed.plugins) && pluginName) {
    const entry = parsed.plugins.find((p) => p && p.name === pluginName);
    if (!entry) return { version: null, reason: `plugin name "${pluginName}" not found in marketplace entries` };
    return { version: entry.version ?? null };
  }
  // marketplace.json shape but no selector → caller should have supplied one
  if (Array.isArray(parsed.plugins) && !pluginName) {
    return {
      version: null,
      reason: `marketplace.json contains plugins[] but spec did not provide a pluginName selector`,
    };
  }
  // plugin.json / package.json shape: top-level version
  return { version: typeof parsed.version === "string" ? parsed.version : null };
}

export function verifyMarketplaceLockstep(specs) {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error("verifyMarketplaceLockstep: specs must be a non-empty array");
  }

  // Resolve each spec to a {version, reason?} pair. Path / parse errors
  // throw immediately — they are environmental defects, not lockstep
  // drift, and the caller should fix them before re-running.
  const resolved = specs.map((s) => ({
    spec: s,
    ...readVersionFromSpec(s),
  }));

  // Baseline: first spec's resolved version (when `expectedVersion` is not
  // pinned per-spec) OR the explicit expectedVersion on the first spec.
  const baseline = specs[0].expectedVersion ?? resolved[0].version;

  const mismatches = [];
  for (const r of resolved) {
    const expected = r.spec.expectedVersion ?? baseline;
    if (r.version !== expected) {
      mismatches.push({
        path: path.relative(process.cwd(), r.spec.path),
        pluginName: r.spec.pluginName,
        found: r.version,
        expected,
        ...(r.reason ? { reason: r.reason } : {}),
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    baseline,
    mismatches,
  };
}
