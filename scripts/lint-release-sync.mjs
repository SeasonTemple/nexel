#!/usr/bin/env node
// Read-only pre-release doc-sync linter.
//
// Mechanically enforces the deterministic subset of nexel's release
// discipline (the written spec lives in
// docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md D4).
// Same risk class as lint-skills.mjs / manifest drift.mjs: it READS only —
// no writes, and zero code dependency on any release/publish tooling.
//
// Checks:
//   1. (fatal) package.json version == newest docs/release-notes/v*.md,
//      compared by SEMVER (numeric per field), not lexically — lexical
//      order breaks at v0.10.0 vs v0.9.0 ("10" < "9" as strings).
//   2. (advisory, false-negative tolerant) README prose carries no stale
//      current-state version assertion.
//
// Deliberately ABSENT vs. the netops original:
//   - The four-manifest version lockstep (.claude-plugin/marketplace.json,
//     plugin.json x2). nexel ships no plugin manifests — there is
//     nothing to lockstep.
//   - The README release-badge check. nexel has no version-bearing
//     README badge at all: the misleading dynamic npm badge (which
//     pointed at the unrelated third-party `skillctl` package, not this
//     project) was removed in the residual-cleanup release (ADR-0008).
//     A correct `nexel` npm badge is deferred to the publish work (2b),
//     additive when the package is actually published. Until then there
//     is no README version badge to check — the check stays absent.
//
// Usage:
//   node scripts/lint-release-sync.mjs            # text report, exit 0/1
//   node scripts/lint-release-sync.mjs --json     # machine-readable
//
// Exit: 0 = consistent, 1 = at least one mismatch, 2 = IO/parse error.
//
// Exported (testable) units: semverGt, newestReleaseNoteVersion, runLint.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Semver greater-than. Numeric per field, NOT lexical — lexical order
 * breaks at v0.10.0 vs v0.9.0 ("10" < "9" as strings).
 */
export function semverGt(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/**
 * Newest release-note version (semver order) from a docs/release-notes
 * directory. Throws if the dir has no `v<x.y.z>.md` files.
 */
export function newestReleaseNoteVersion(releaseNotesDir) {
  const versions = fs.readdirSync(releaseNotesDir)
    .map((f) => /^v(\d+\.\d+\.\d+)\.md$/.exec(f))
    .filter(Boolean)
    .map((m) => m[1]);
  if (versions.length === 0) {
    throw new Error(`no v<x.y.z>.md files in ${releaseNotesDir}`);
  }
  return versions.reduce((best, v) => (semverGt(v, best) ? v : best), versions[0]);
}

/**
 * Run all checks against a repo root. Pure: no process.exit, no stdout.
 * Returns { ok, version, checks:[{name,ok,detail}], advisory:[...],
 * mismatches:[], error? }. `ok`/`mismatches`/exit derive ONLY from
 * `checks` (the deterministic gate); `advisory` (the stale-prose
 * heuristic) is reported but never affects `ok`.
 */
export function runLint({ repoRoot }) {
  const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
  const readJson = (rel) => JSON.parse(read(rel));
  const checks = [];
  const advisory = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  let pkgVersion;
  try {
    pkgVersion = readJson("package.json").version;

    const newest = newestReleaseNoteVersion(path.join(repoRoot, "docs/release-notes"));
    add("package-version-matches-newest-release-note", pkgVersion === newest,
      `package.json=${pkgVersion} newest docs/release-notes/=v${newest}`);

    // A line is a *current-state* version assertion when it carries one of
    // these cues: "CLI vX", "as of vX", an English "latest: vX" link, or
    // the Chinese README's "当前 latest" / "CLI（…vX" phrasings.
    const verTok = /v(\d+\.\d+\.\d+)/g;
    const CURRENT_STATE_CUE = /(CLI,? v|as of v|当前 latest|latest: \[?v|CLI（[^）]*v\d)/;
    // A version mention is historical (legitimate) when framed as a past
    // decision: "vX 起" / "vX onward", an audit/ADR/fate reference, or
    // "deferred/superseded".
    const HISTORICAL_CUE = /起\b|onward|audit|defer|superseded|ADR-?\d|fate/i;

    const staleHits = [];
    for (const file of ["README.md", "README.zh-CN.md"]) {
      let text;
      try { text = read(file); } catch { continue; } // tolerate absence
      text.split("\n").forEach((line, i) => {
        if (!CURRENT_STATE_CUE.test(line) || HISTORICAL_CUE.test(line)) return;
        for (const mm of line.matchAll(verTok)) {
          if (mm[1] !== pkgVersion) {
            staleHits.push(`${file}:${i + 1} cites v${mm[1]} (pkg v${pkgVersion}): ${line.trim().slice(0, 80)}`);
          }
        }
      });
    }
    advisory.push({
      name: "no-stale-current-state-version (heuristic, advisory)",
      ok: staleHits.length === 0,
      detail: staleHits.length ? staleHits.join(" | ") : "none",
    });
  } catch (e) {
    return { ok: false, version: pkgVersion ?? null, checks, advisory, mismatches: [], error: String(e.message || e) };
  }

  const mismatches = checks.filter((c) => !c.ok).map((c) => ({ name: c.name, detail: c.detail }));
  return { ok: mismatches.length === 0, version: pkgVersion, checks, advisory, mismatches };
}

// ---- CLI (only when invoked directly, never on import) ----
const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const jsonMode = process.argv.includes("--json");
  const r = runLint({ repoRoot: REPO_ROOT });

  if (r.error) {
    if (jsonMode) process.stdout.write(JSON.stringify({ ok: false, error: r.error }, null, 2) + "\n");
    else process.stderr.write(`lint-release-sync: ERROR — ${r.error}\n`);
    process.exit(2);
  }

  if (jsonMode) {
    process.stdout.write(JSON.stringify({ ok: r.ok, checks: r.checks, advisory: r.advisory, mismatches: r.mismatches }, null, 2) + "\n");
  } else {
    for (const c of r.checks) {
      process.stdout.write(`  ${c.ok ? "OK  " : "FAIL"} ${c.name}${c.ok ? "" : `  — ${c.detail}`}\n`);
    }
    for (const a of r.advisory) {
      process.stdout.write(`  ${a.ok ? "OK  " : "NOTE"} ${a.name}${a.ok ? "" : `  — ${a.detail}`}\n`);
    }
    const n = r.mismatches.length;
    process.stdout.write(`\nlint-release-sync: ${r.ok ? "PASS" : `FAIL (${n} mismatch${n > 1 ? "es" : ""})`}` +
      `${r.advisory.some((a) => !a.ok) ? " (+ advisory notes — not blocking)" : ""}\n`);
  }
  process.exit(r.ok ? 0 : 1);
}
