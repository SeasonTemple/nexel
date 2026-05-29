// rebuild-manifest — derive install.json skill entries from SKILL.md
// frontmatter on disk, merge-preserving authored fields.
//
// Dev/CI tool (sibling of lint-skills.mjs), NOT part of the runtime kernel:
// it imports `yaml` and installer/core freely and is never re-exported from
// installer/index.mjs.
//
// Contract (see docs/plans/2026-05-29-003-...):
//   - Derived from frontmatter: id (name), dirname, sourcePath, category.
//   - Merge-preserved verbatim: description / profile / dependencies (+ any
//     other authored skill field) and the whole agents / rules / bundles /
//     $schemaDescription / schemaVersion sections. Authored objects are spread,
//     never reconstructed.
//   - NEW skill (on disk, not in manifest): added; description seeded from
//     frontmatter, profile defaults to "standalone".
//   - Skill in manifest whose dir is GONE on disk: hard error (never silently
//     dropped — dropping a still-referenced skill would emit a manifest that
//     fails validateBundles/validateDependencies).
//   - Duplicate derived id, missing/malformed name or category: hard error
//     (a generator must refuse to persist garbage).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { extractFrontmatter } from "./lint-skills.mjs";
import { CATEGORY_SET, SCHEMA_VERSION } from "./installer/core/manifest/schema.mjs";
import { loadManifest, defaultPaths } from "./installer/core/manifest/loader.mjs";
import { validateManifest, formatFindings } from "./installer/core/manifest/validator.mjs";

const SKILL_FIELD_ORDER = ["id", "dirname", "sourcePath", "category", "profile", "description", "dependencies"];

function codepointCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Derive a canonical manifest object from `existing` + the SKILL.md files under
 * `skillsDirAbs`. Returns { manifest, errors }. On any error, manifest is null
 * (never emit a partial/garbage manifest).
 *
 * @param {object} existing   parsed existing manifest
 * @param {{skillsDirAbs: string, skillsDirRel: string, idPrefix?: string|null}} opts
 */
export function deriveManifest(existing, { skillsDirAbs, skillsDirRel, idPrefix = null }) {
  const errors = [];
  const existingSkills = existing.skills || {};

  // 1. Orphaned manifest skills (entry present, dir gone) — hard error.
  for (const [id, entry] of Object.entries(existingSkills)) {
    const dirname = entry.dirname;
    if (!dirname || !fs.existsSync(path.join(skillsDirAbs, dirname, "SKILL.md"))) {
      errors.push({
        severity: "error",
        message: `manifest skill "${id}" has no SKILL.md on disk (dirname "${dirname}"); remove it from the manifest or restore the directory`,
      });
    }
  }

  // 2. Walk disk dirs, derive entries from frontmatter.
  const diskById = new Map();
  const dirs = fs.existsSync(skillsDirAbs)
    ? fs.readdirSync(skillsDirAbs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  for (const dirname of dirs) {
    const skillMd = path.join(skillsDirAbs, dirname, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue; // a non-skill subdir
    const fm = extractFrontmatter(fs.readFileSync(skillMd, "utf8"));
    if (fm === null) {
      errors.push({ severity: "error", message: `${dirname}/SKILL.md: missing frontmatter block` });
      continue;
    }
    let parsed;
    try {
      parsed = parseYaml(fm);
    } catch (e) {
      errors.push({ severity: "error", message: `${dirname}/SKILL.md: YAML parse failed: ${e.message}` });
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      errors.push({ severity: "error", message: `${dirname}/SKILL.md: frontmatter did not parse to an object` });
      continue;
    }
    const { name, category, description } = parsed;
    if (typeof name !== "string" || name.trim() === "") {
      errors.push({ severity: "error", message: `${dirname}/SKILL.md: missing/invalid frontmatter "name"` });
      continue;
    }
    // `__proto__` as an object key is the one name that breaks bracket
    // assignment (it targets the prototype setter, not an own property), so a
    // skill literally named "__proto__" would be silently lost. Refuse it —
    // a generator must not persist garbage.
    if (name === "__proto__") {
      errors.push({ severity: "error", message: `${dirname}/SKILL.md: "__proto__" is a reserved name` });
      continue;
    }
    if (idPrefix && name !== `${idPrefix}:${dirname}`) {
      errors.push({ severity: "error", message: `${dirname}/SKILL.md: name "${name}" does not match expected "${idPrefix}:${dirname}"` });
      continue;
    }
    if (typeof category !== "string" || !CATEGORY_SET.has(category)) {
      errors.push({ severity: "error", message: `${dirname}/SKILL.md: category "${category}" not in {${[...CATEGORY_SET].join(", ")}}` });
      continue;
    }
    if (diskById.has(name)) {
      errors.push({ severity: "error", message: `duplicate skill id "${name}" derived from dirs "${diskById.get(name).dirname}" and "${dirname}"` });
      continue;
    }
    // description is only consumed when SEEDING a new skill; an existing skill's
    // authored manifest description is preserved regardless.
    const isNew = !Object.hasOwn(existingSkills, name);
    if (isNew && (typeof description !== "string" || description.trim() === "")) {
      errors.push({ severity: "error", message: `${dirname}/SKILL.md: new skill needs a non-empty frontmatter "description" to seed the manifest` });
      continue;
    }
    diskById.set(name, { id: name, dirname, category, description });
  }

  if (errors.length) return { manifest: null, errors };

  // 3. Order: existing ids keep their on-disk order; new ids appended by
  // codepoint sort. (localeCompare deliberately avoided — guards locale leak.)
  const orderedIds = [];
  for (const id of Object.keys(existingSkills)) {
    if (diskById.has(id)) orderedIds.push(id);
  }
  const newIds = [...diskById.keys()].filter((id) => !Object.hasOwn(existingSkills, id)).sort(codepointCompare);
  orderedIds.push(...newIds);

  // 4. Build canonical skill entries.
  const skills = {};
  for (const id of orderedIds) {
    const d = diskById.get(id);
    const prev = Object.hasOwn(existingSkills, id) ? existingSkills[id] : {};
    const entry = {
      id,
      dirname: d.dirname,
      sourcePath: `${skillsDirRel}/${d.dirname}`,
      category: d.category,
    };
    if ("profile" in prev) entry.profile = prev.profile;
    else if (!Object.hasOwn(existingSkills, id)) entry.profile = "standalone";
    entry.description = "description" in prev ? prev.description : d.description;
    if ("dependencies" in prev) entry.dependencies = prev.dependencies;
    // Preserve any other authored fields verbatim, after the canonical ones.
    for (const k of Object.keys(prev)) {
      if (!SKILL_FIELD_ORDER.includes(k)) entry[k] = prev[k];
    }
    skills[id] = entry;
  }

  // 5. Assemble canonical top-level object; preserve authored sections verbatim.
  // agents/rules/bundles are ALWAYS emitted (defaulting to {}) so the output is
  // schema-valid even when the input omitted an empty section — otherwise
  // writeManifest could persist a manifest that validateManifest rejects.
  const manifest = {};
  if ("$schemaDescription" in existing) manifest.$schemaDescription = existing.$schemaDescription;
  manifest.schemaVersion = existing.schemaVersion ?? SCHEMA_VERSION;
  manifest.skills = skills;
  manifest.agents = existing.agents ?? {};
  manifest.rules = existing.rules ?? {};
  manifest.bundles = existing.bundles ?? {};

  return { manifest, errors: [] };
}

/** Canonical JSON serialization (2-space, trailing newline). */
export function serializeManifest(manifest) {
  return JSON.stringify(manifest, null, 2) + "\n";
}

/**
 * Resolve repoRoot/paths/skillsDirRel from a manifest path, mirroring the
 * validator's main() resolution.
 */
function resolvePaths(manifestPath) {
  const repoRoot = path.dirname(manifestPath);
  const paths = defaultPaths(repoRoot);
  paths.manifestPath = manifestPath;
  const skillsDirRel = path.relative(repoRoot, paths.skillsDirAbs).split(path.sep).join("/");
  return { repoRoot, paths, skillsDirRel };
}

/**
 * Shared regenerate pipeline for both check and write: load → derive →
 * validate the GENERATED output (catches dangling refs / schema issues a byte
 * diff or per-skill derive cannot). Returns { error } on failure, or
 * { manifest, generated } on success. Both modes validate, so neither can
 * persist nor bless a manifest that validateManifest would reject.
 */
function regenerate(manifestPath, idPrefix) {
  const { paths, skillsDirRel } = resolvePaths(manifestPath);
  const existing = loadManifest(manifestPath);
  const { manifest, errors } = deriveManifest(existing, { skillsDirAbs: paths.skillsDirAbs, skillsDirRel, idPrefix });
  if (errors.length) {
    return { error: errors.map((e) => `${e.severity}: ${e.message}`).join("\n") };
  }
  const findings = validateManifest(manifest, paths);
  if (findings.length) {
    return { error: `regenerated manifest fails validation:\n${formatFindings(findings, "text")}` };
  }
  return { manifest, generated: serializeManifest(manifest) };
}

/**
 * --check: regenerate (incl. validation) and byte-compare to disk.
 * Returns { code, message }.
 */
export function checkManifest(manifestPath, { idPrefix = null } = {}) {
  const r = regenerate(manifestPath, idPrefix);
  if (r.error) return { code: 1, message: r.error };
  if (r.generated !== fs.readFileSync(manifestPath, "utf8")) {
    return { code: 1, message: `manifest is out of date — run rebuild-manifest to regenerate ${manifestPath}` };
  }
  return { code: 0, message: `OK manifest matches filesystem (${Object.keys(r.manifest.skills).length} skills)` };
}

/** Write mode: regenerate (incl. validation) and write to disk. Returns { code, message }. */
export function writeManifest(manifestPath, { idPrefix = null } = {}) {
  const r = regenerate(manifestPath, idPrefix);
  if (r.error) return { code: 1, message: r.error };
  fs.writeFileSync(manifestPath, r.generated);
  return { code: 0, message: `wrote ${manifestPath} (${Object.keys(r.manifest.skills).length} skills)` };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const check = args.includes("--check");
  const manifestFlag = args.find((a) => a.startsWith("--manifest="));
  const manifestPath = manifestFlag ? path.resolve(manifestFlag.slice("--manifest=".length)) : null;
  const idPrefixFlag = args.find((a) => a.startsWith("--id-prefix="));
  const idPrefix = idPrefixFlag ? idPrefixFlag.slice("--id-prefix=".length) : null;
  return { check, manifestPath, idPrefix };
}

function main() {
  const { check, manifestPath, idPrefix } = parseArgs(process.argv);
  if (!manifestPath) {
    process.stderr.write("usage: rebuild-manifest --manifest=<path> [--check] [--id-prefix=<prefix>]\n");
    process.exit(2);
  }
  if (!fs.existsSync(manifestPath)) {
    process.stderr.write(`manifest not found: ${manifestPath}\n`);
    process.exit(2);
  }
  const { code, message } = check
    ? checkManifest(manifestPath, { idPrefix })
    : writeManifest(manifestPath, { idPrefix });
  process[code === 0 ? "stdout" : "stderr"].write(message + "\n");
  process.exit(code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
