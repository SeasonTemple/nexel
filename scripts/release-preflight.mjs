#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { validateBilingualReleaseNote } from "./release-note-policy.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function semverGt(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

// Extract the minimum acceptable version from a single semver range disjunct.
// Handles the common shapes that appear in npm `engines.node` fields:
//   "^X.Y.Z" / "~X.Y.Z" / ">=X.Y.Z" / ">X.Y.Z" / "X.Y.Z" / "*" / ""
// Returns the X.Y.Z string of the floor, or null when the disjunct is open
// (`*`, empty, or unparseable). Open ranges are treated as "no constraint"
// by callers (they neither raise the host floor nor narrow a dep's floor).
function disjunctFloor(disjunct) {
  const trimmed = disjunct.trim();
  if (!trimmed || trimmed === "*" || trimmed === "x" || trimmed === "latest") return null;
  // strip leading operators
  const m = /^(?:\^|~|>=|>|=)?\s*(\d+(?:\.\d+){0,2})/.exec(trimmed);
  if (!m) return null;
  const specifiedSegments = m[1].split(".").length;
  const parts = m[1].split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  // `>X.Y.Z` is approximated by bumping the lowest-specified segment (so `>22`
  // becomes 23.0.0, `>22.22` becomes 22.23.0, `>22.22.2` becomes 22.22.3).
  // Bumping the patch slot for two-segment ranges understated the true minimum.
  if (trimmed.startsWith(">") && !trimmed.startsWith(">=")) {
    parts[specifiedSegments - 1] += 1;
    for (let i = specifiedSegments; i < parts.length; i++) parts[i] = 0;
  }
  return parts.join(".");
}

// Lowest acceptable version across a multi-disjunct semver range. For
// `^22.22.2 || ^24.15.0 || >=26.0.0` returns "22.22.2".
// Returns null when every disjunct is open (range = "*"), meaning "no floor".
//
// Mixed ranges like `^18 || *` are intentionally treated as "no constraint"
// here because the open disjunct legitimately admits all versions. Callers
// that want to flag mixed ranges as suspicious should use rangeAudit().
export function rangeMinimum(range) {
  const audit = rangeAudit(range);
  return audit.floor;
}

// Returns a richer view of a semver range so callers can distinguish
// "genuinely unconstrained" from "mixed open + concrete disjuncts". The
// latter often signals a dep author who added `|| *` accidentally and
// would benefit from surfacing the concrete floors despite the open clause.
export function rangeAudit(range) {
  if (typeof range !== "string") {
    return { floor: null, hasOpenDisjunct: false, concreteFloors: [] };
  }
  const disjuncts = range.split("||");
  const concreteFloors = [];
  let hasOpenDisjunct = false;
  for (const d of disjuncts) {
    const f = disjunctFloor(d);
    if (f === null) {
      hasOpenDisjunct = true;
      continue;
    }
    concreteFloors.push(f);
  }
  if (concreteFloors.length === 0) {
    return { floor: null, hasOpenDisjunct, concreteFloors };
  }
  if (hasOpenDisjunct) {
    // Mixed: the open clause admits everything; floor is null (compatible).
    return { floor: null, hasOpenDisjunct, concreteFloors };
  }
  const min = concreteFloors.reduce((acc, v) => (semverGt(acc, v) ? v : acc), concreteFloors[0]);
  return { floor: min, hasOpenDisjunct: false, concreteFloors };
}

// Compare a runtime dependency's engines.node floor to the host's. The host
// promises to install on every Node version `>=` its declared floor; the dep
// must accept every such version, so the dep's lowest acceptable version
// must be `<=` the host's. Returns null on compatible, or a structured
// detail object on incompatible.
function checkDepEngines(name, depRange, hostMin) {
  if (!depRange) return null;
  const depMin = rangeMinimum(depRange);
  if (depMin === null) return null; // dep has open range — accepts anything host accepts
  if (hostMin === null) {
    // Host declared `*` or omitted engines — strict view: any dep with a floor wins
    return { name, depRange, depMin, hostRange: "*", hostMin: null };
  }
  if (semverGt(depMin, hostMin)) {
    return { name, depRange, depMin, hostMin };
  }
  return null;
}

function checkRuntimeDepsEngines(pkg, lock) {
  const hostRange = pkg.engines?.node;
  const hostMin = rangeMinimum(hostRange);
  const deps = pkg.dependencies || {};
  const conflicts = [];
  const mixedOpenRanges = [];
  for (const name of Object.keys(deps)) {
    const lockEntry = lock.packages?.[`node_modules/${name}`];
    const depRange = lockEntry?.engines?.node;
    const conflict = checkDepEngines(name, depRange, hostMin);
    if (conflict) conflicts.push(conflict);
    // Audit mixed-open ranges (e.g., `^18 || *`) so users see when a
    // concrete floor is being silently suppressed by an accidental wildcard.
    if (depRange) {
      const audit = rangeAudit(depRange);
      if (audit.hasOpenDisjunct && audit.concreteFloors.length > 0) {
        mixedOpenRanges.push({ name, depRange, concreteFloors: audit.concreteFloors });
      }
    }
  }
  return { hostRange: hostRange || "(none)", hostMin, conflicts, mixedOpenRanges };
}

function newestReleaseNoteVersion(dir) {
  const versions = fs.readdirSync(dir)
    .map((name) => /^v(\d+\.\d+\.\d+)\.md$/.exec(name))
    .filter(Boolean)
    .map((m) => m[1]);
  if (versions.length === 0) return null;
  return versions.reduce((best, version) => (semverGt(version, best) ? version : best), versions[0]);
}

function gitDirty(repoRoot) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return { ok: false, detail: result.stderr || result.stdout };
  const ignored = /^(?:\?\? )?nexel-\d+\.\d+\.\d+\.tgz(?:\.sha256)?$/;
  const dirty = result.stdout.split(/\r?\n/).filter(Boolean).filter((line) => !ignored.test(line.replace(/^.. /, "")));
  return { ok: dirty.length === 0, detail: dirty.join(" | ") || "clean" };
}

export function runPreflight({ repoRoot = REPO_ROOT, allowDirty = false } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
  const version = pkg.version;
  const releaseNotesDir = path.join(repoRoot, "docs/release-notes");
  const releaseNotePath = path.join(releaseNotesDir, `v${version}.md`);
  const newest = newestReleaseNoteVersion(releaseNotesDir);

  const dirty = gitDirty(repoRoot);
  add("working-tree-clean", allowDirty || dirty.ok, allowDirty ? "skipped by --allow-dirty" : dirty.detail);
  add("package-lock-version-matches", lock.version === version && lock.packages?.[""]?.version === version,
    `package=${version} lock=${lock.version} root=${lock.packages?.[""]?.version}`);
  add("release-note-exists", fs.existsSync(releaseNotePath), `docs/release-notes/v${version}.md`);
  const releaseNoteText = fs.existsSync(releaseNotePath) ? fs.readFileSync(releaseNotePath, "utf8") : "";
  add("release-note-non-empty", releaseNoteText.trim().length > 0, `docs/release-notes/v${version}.md`);
  const bilingual = validateBilingualReleaseNote(releaseNoteText);
  add("release-note-bilingual", bilingual.ok,
    bilingual.ok ? "English and Chinese sections present" : bilingual.failures.join("; "));
  add("newest-release-note-matches-package", newest === version,
    `package=${version} newest=${newest ?? "(none)"}`);

  // Runtime dependency engines.node floor vs host engines.node floor.
  // Catches the "we bumped a dep that quietly requires newer Node" trap —
  // a missing host engines bump leaves npm install silently succeeding on
  // older runtimes that the dep refuses to load at runtime.
  const engines = checkRuntimeDepsEngines(pkg, lock);
  const mixedNote = engines.mixedOpenRanges.length > 0
    ? `; mixed-open ranges (concrete floor suppressed by '*' clause): ${engines.mixedOpenRanges.map((m) => `${m.name}@${m.depRange}`).join(", ")}`
    : "";
  if (engines.hostMin === null) {
    add(
      "runtime-deps-engines-compatible",
      engines.conflicts.length === 0,
      engines.conflicts.length === 0
        ? `host engines.node not declared — no constraint surface${mixedNote}`
        : `host engines.node not declared (treat as strictest); deps: ${engines.conflicts.map((c) => `${c.name}@${c.depRange}`).join(", ")}${mixedNote}`,
    );
  } else {
    add(
      "runtime-deps-engines-compatible",
      engines.conflicts.length === 0,
      engines.conflicts.length === 0
        ? `host=${engines.hostRange} satisfies every runtime dep's engines.node floor${mixedNote}`
        : `host=${engines.hostRange} (min ${engines.hostMin}) too low for: ${engines.conflicts.map((c) => `${c.name} engines.node=${c.depRange} (min ${c.depMin})`).join("; ")}${mixedNote}`,
    );
  }

  const mismatches = checks.filter((check) => !check.ok);
  return { ok: mismatches.length === 0, version, checks, mismatches };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const json = process.argv.includes("--json");
  const allowDirty = process.argv.includes("--allow-dirty");
  const result = runPreflight({ allowDirty });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    for (const check of result.checks) {
      process.stdout.write(`  ${check.ok ? "OK  " : "FAIL"} ${check.name}${check.ok ? "" : ` — ${check.detail}`}\n`);
    }
    process.stdout.write(`\nrelease-preflight: ${result.ok ? "PASS" : `FAIL (${result.mismatches.length})`}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}
