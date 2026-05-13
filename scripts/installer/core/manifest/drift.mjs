import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadManifest, defaultPaths, defaultManifestPath, stripBom } from "./loader.mjs";
import { validateManifest } from "./validator.mjs";
import { FRONTMATTER_RE } from "./schema.mjs";

export function detectDrift({ repoRoot, manifest } = {}) {
  if (!repoRoot) throw new Error("repoRoot required");
  const paths = defaultPaths(repoRoot);
  const m = manifest || loadManifest(paths.manifestPath);

  const findings = validateManifest(m, paths);
  const driftOnly = findings.filter((f) => isDriftFinding(f));

  const skillsOnDisk = new Set(
    fs.existsSync(paths.skillsDirAbs)
      ? fs.readdirSync(paths.skillsDirAbs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
      : []
  );
  const manifestDirs = new Set(Object.values(m.skills).map((s) => s.dirname));

  const missingFromManifest = [...skillsOnDisk].filter((d) => !manifestDirs.has(d)).sort();
  const missingFromDisk = [...manifestDirs].filter((d) => !skillsOnDisk.has(d)).sort();

  const categoryMismatches = [];
  for (const sid of Object.keys(m.skills)) {
    const skill = m.skills[sid];
    const skillMd = path.join(paths.skillsDirAbs, skill.dirname, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    const text = stripBom(fs.readFileSync(skillMd, "utf8"));
    const fm = text.match(FRONTMATTER_RE);
    if (!fm) continue;
    const catLine = fm[1].match(/^category:\s*(.+)$/m);
    if (catLine && catLine[1].trim() !== skill.category) {
      categoryMismatches.push({ skillId: sid, frontmatter: catLine[1].trim(), manifest: skill.category });
    }
  }

  const orphanedAgentEntries = [];
  for (const aid of Object.keys(m.agents)) {
    const a = m.agents[aid];
    const referencedBy = collectAgentReferers(m, aid);
    if (referencedBy.length === 0) orphanedAgentEntries.push({ agentId: aid, installedName: a.installedName });
  }

  const orphanedRuleEntries = [];
  for (const rid of Object.keys(m.rules)) {
    const referencedBy = collectRuleReferers(m, rid);
    if (referencedBy.length === 0) orphanedRuleEntries.push({ ruleKey: rid });
  }

  return {
    pass: driftOnly.length === 0 && missingFromManifest.length === 0 && categoryMismatches.length === 0,
    fullValidation: findings,
    driftOnly,
    missingFromManifest,
    missingFromDisk,
    categoryMismatches,
    orphanedAgentEntries,
    orphanedRuleEntries,
  };
}

function isDriftFinding(f) {
  return /not in manifest|does not exist|frontmatter (?:name|category)/.test(f.message);
}

function collectAgentReferers(manifest, agentId) {
  const out = [];
  for (const sid of Object.keys(manifest.skills)) {
    const deps = manifest.skills[sid].dependencies || {};
    if ((deps.agents || []).includes(agentId)) out.push({ kind: "skill", id: sid });
  }
  for (const bid of Object.keys(manifest.bundles)) {
    const b = manifest.bundles[bid];
    if ((b.agents || []).includes(agentId)) out.push({ kind: "bundle", id: bid });
  }
  return out;
}

function collectRuleReferers(manifest, ruleKey) {
  const out = [];
  for (const sid of Object.keys(manifest.skills)) {
    const deps = manifest.skills[sid].dependencies || {};
    if ((deps.rules || []).includes(ruleKey)) out.push({ kind: "skill", id: sid });
  }
  for (const bid of Object.keys(manifest.bundles)) {
    const b = manifest.bundles[bid];
    if ((b.rules || []).includes(ruleKey)) out.push({ kind: "bundle", id: bid });
  }
  return out;
}

export function formatDrift(result, mode = "text") {
  if (mode === "json") return JSON.stringify(result, null, 2);
  const lines = [];
  if (result.pass) {
    lines.push(`OK manifest in sync with disk`);
  } else {
    lines.push(`DRIFT detected:`);
  }
  if (result.missingFromManifest.length > 0) {
    lines.push(`  Skills on disk missing from manifest (${result.missingFromManifest.length}):`);
    for (const d of result.missingFromManifest) lines.push(`    - ${d}`);
  }
  if (result.missingFromDisk.length > 0) {
    lines.push(`  Manifest skills missing from disk (${result.missingFromDisk.length}):`);
    for (const d of result.missingFromDisk) lines.push(`    - ${d}`);
  }
  if (result.categoryMismatches.length > 0) {
    lines.push(`  Category mismatches (${result.categoryMismatches.length}):`);
    for (const m of result.categoryMismatches) {
      lines.push(`    - ${m.skillId}: frontmatter "${m.frontmatter}" vs manifest "${m.manifest}"`);
    }
  }
  if (result.orphanedAgentEntries.length > 0) {
    lines.push(`  Manifest agents not referenced by any skill or bundle (${result.orphanedAgentEntries.length}):`);
    for (const o of result.orphanedAgentEntries) lines.push(`    - ${o.agentId}`);
  }
  if (result.orphanedRuleEntries.length > 0) {
    lines.push(`  Manifest rules not referenced by any skill or bundle (${result.orphanedRuleEntries.length}):`);
    for (const o of result.orphanedRuleEntries) lines.push(`    - ${o.ruleKey}`);
  }
  return lines.join("\n");
}

function parseFrontmatter(skillMdPath) {
  if (!fs.existsSync(skillMdPath)) return null;
  const text = stripBom(fs.readFileSync(skillMdPath, "utf8"));
  const m = text.match(FRONTMATTER_RE);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(name|category|description):\s*(.+)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

export function applyFix({ repoRoot, manifest, drift }) {
  const paths = defaultPaths(repoRoot);
  const m = manifest || loadManifest(paths.manifestPath);
  const fixed = JSON.parse(JSON.stringify(m));
  const log = { added: [], removed: [], categoryUpdated: [], orphanedAgentRemoved: [], orphanedRuleRemoved: [] };
  const d = drift || detectDrift({ repoRoot, manifest: m });

  for (const dirname of d.missingFromManifest) {
    const fm = parseFrontmatter(path.join(paths.skillsDirAbs, dirname, "SKILL.md"));
    if (!fm || !fm.name || !fm.category) {
      log.added.push({ dirname, status: "SKIPPED — missing frontmatter name/category" });
      continue;
    }
    fixed.skills[fm.name] = {
      id: fm.name,
      dirname,
      profile: "standalone",
      category: fm.category,
      description: fm.description || "(autofix: review and fill)",
      dependencies: { agents: [], rules: [], skills: [] },
    };
    log.added.push({ dirname, id: fm.name });
  }

  for (const dirname of d.missingFromDisk) {
    const sid = Object.keys(fixed.skills).find((id) => fixed.skills[id].dirname === dirname);
    if (sid) {
      delete fixed.skills[sid];
      log.removed.push({ id: sid, dirname });
    }
  }

  for (const mismatch of d.categoryMismatches) {
    if (fixed.skills[mismatch.skillId]) {
      fixed.skills[mismatch.skillId].category = mismatch.frontmatter;
      log.categoryUpdated.push({ id: mismatch.skillId, from: mismatch.manifest, to: mismatch.frontmatter });
    }
  }

  for (const orphan of d.orphanedAgentEntries) {
    delete fixed.agents[orphan.agentId];
    log.orphanedAgentRemoved.push(orphan.agentId);
  }

  for (const orphan of d.orphanedRuleEntries) {
    delete fixed.rules[orphan.ruleKey];
    log.orphanedRuleRemoved.push(orphan.ruleKey);
  }

  return { fixed, log };
}

function summarizeFix(log) {
  const lines = [];
  if (log.added.length) {
    lines.push(`  Added skill entries (${log.added.length}):`);
    for (const a of log.added) lines.push(`    + ${a.id || a.dirname}${a.status ? " — " + a.status : ""}`);
  }
  if (log.removed.length) {
    lines.push(`  Removed orphan skill entries (${log.removed.length}):`);
    for (const r of log.removed) lines.push(`    - ${r.id} (dirname=${r.dirname})`);
  }
  if (log.categoryUpdated.length) {
    lines.push(`  Updated category to match frontmatter (${log.categoryUpdated.length}):`);
    for (const c of log.categoryUpdated) lines.push(`    ~ ${c.id}: "${c.from}" -> "${c.to}"`);
  }
  if (log.orphanedAgentRemoved.length) {
    lines.push(`  Removed orphaned agent entries (${log.orphanedAgentRemoved.length}):`);
    for (const a of log.orphanedAgentRemoved) lines.push(`    - ${a}`);
  }
  if (log.orphanedRuleRemoved.length) {
    lines.push(`  Removed orphaned rule entries (${log.orphanedRuleRemoved.length}):`);
    for (const r of log.orphanedRuleRemoved) lines.push(`    - ${r}`);
  }
  return lines.length ? lines.join("\n") : "  (no changes)";
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const fix = args.includes("--fix");
  const dryRun = args.includes("--dry-run");
  const repoRoot = path.resolve(process.cwd());
  const manifestPath = defaultManifestPath(repoRoot);
  if (!fs.existsSync(manifestPath)) {
    process.stderr.write(`manifest not found: ${manifestPath}\n`);
    process.exit(2);
  }
  const result = detectDrift({ repoRoot });

  if (fix) {
    const { fixed, log } = applyFix({ repoRoot, drift: result });
    const summary = summarizeFix(log);
    const hasChanges =
      log.added.length + log.removed.length + log.categoryUpdated.length +
      log.orphanedAgentRemoved.length + log.orphanedRuleRemoved.length > 0;
    if (dryRun) {
      process.stderr.write(`DRY-RUN — would apply autofix:\n${summary}\n`);
      process.exit(0);
    }
    if (!hasChanges) {
      process.stderr.write(`autofix: no changes needed\n`);
      process.exit(0);
    }
    fs.writeFileSync(manifestPath, JSON.stringify(fixed, null, 2) + "\n");
    process.stderr.write(`autofix applied:\n${summary}\n`);
    const after = detectDrift({ repoRoot });
    if (json) process.stdout.write(formatDrift(after, "json") + "\n");
    process.exit(after.pass ? 0 : 1);
  }

  if (json) {
    process.stdout.write(formatDrift(result, "json") + "\n");
  } else {
    process.stderr.write(formatDrift(result, "text") + "\n");
  }
  process.exit(result.pass ? 0 : 1);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
