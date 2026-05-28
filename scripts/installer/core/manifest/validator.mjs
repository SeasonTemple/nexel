// Manifest validator — pure rule-checking against the loaded manifest.
// All findings are returned as a structured array; no throws. The CLI
// entry at the bottom converts findings → exit code + formatted output.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCHEMA_VERSION,
  PROFILES,
  CATEGORIES,
  HOSTS,
  PROFILE_SET,
  CATEGORY_SET,
  HOST_SET,
  FRONTMATTER_RE,
} from "./schema.mjs";
import { loadManifest, defaultPaths, stripBom } from "./loader.mjs";
import {
  isValidRelativeSkillPath,
  readHostInstructions,
  HOST_INSTRUCTIONS_KEY,
  OPENCODE_INSTRUCTIONS_KEY,
} from "../skill-metadata.mjs";

function isInsideRepo(repoRoot, candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  if (path.isAbsolute(candidate)) return false;
  const norm = path.posix.normalize(candidate.replace(/\\/g, "/"));
  if (norm.startsWith("../") || norm === "..") return false;
  const abs = path.resolve(repoRoot, norm);
  const rel = path.relative(repoRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return true;
}

function pushError(findings, section, id, message) {
  findings.push({ severity: "error", section, id, message });
}

export function validateManifest(manifest, options = {}) {
  const findings = [];
  const repoRoot = options.repoRoot;
  const skillsDirAbs = options.skillsDirAbs;
  // Identity prefixes come from productConfig via the options bag. When
  // omitted, the validator runs in "no-prefix-check" mode — id-prefix
  // enforcement is skipped. Downstream products that want strict
  // namespacing must pass skillIdPrefix / agentNamePrefix explicitly.
  const skillIdPrefix = options.skillIdPrefix ?? null;
  const agentNamePrefix = options.agentNamePrefix ?? null;

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    pushError(findings, "root", null, "manifest must be an object");
    return findings;
  }

  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    pushError(findings, "root", null, `schemaVersion must be ${SCHEMA_VERSION}, got ${manifest.schemaVersion}`);
  }

  for (const sec of ["skills", "agents", "rules", "bundles"]) {
    if (!manifest[sec] || typeof manifest[sec] !== "object" || Array.isArray(manifest[sec])) {
      pushError(findings, "root", sec, `missing or invalid section: ${sec}`);
    }
  }
  if (findings.some((f) => f.severity === "error" && f.section === "root")) return findings;

  validateAgents(manifest.agents, repoRoot, findings, agentNamePrefix);
  validateRules(manifest.rules, repoRoot, findings);
  validateSkills(manifest.skills, manifest.agents, manifest.rules, repoRoot, skillsDirAbs, findings, skillIdPrefix);
  validateBundles(manifest.bundles, manifest.skills, manifest.agents, manifest.rules, findings);
  validateCaseFoldedPathCollisions(manifest, findings);

  return findings;
}

function validateAgents(agents, repoRoot, findings, agentNamePrefix = null) {
  const ids = Object.keys(agents);
  const seenInstalled = new Map();
  for (const id of ids) {
    const a = agents[id];
    if (!a || typeof a !== "object") {
      pushError(findings, "agents", id, "entry must be an object");
      continue;
    }
    if (a.id !== id) pushError(findings, "agents", id, `id field "${a.id}" does not match key "${id}"`);
    if (typeof a.sourcePath !== "string" || !a.sourcePath) {
      pushError(findings, "agents", id, "sourcePath must be a non-empty string");
    } else if (repoRoot && !isInsideRepo(repoRoot, a.sourcePath)) {
      pushError(findings, "agents", id, `sourcePath escapes repo: ${a.sourcePath}`);
    } else if (repoRoot) {
      const abs = path.resolve(repoRoot, a.sourcePath);
      if (!fs.existsSync(abs)) pushError(findings, "agents", id, `sourcePath does not exist: ${a.sourcePath}`);
    }
    if (typeof a.installedName !== "string" || !a.installedName) {
      pushError(findings, "agents", id, "installedName must be a non-empty string");
    } else if (agentNamePrefix && !a.installedName.startsWith(agentNamePrefix)) {
      pushError(findings, "agents", id, `installedName must start with "${agentNamePrefix}", got "${a.installedName}"`);
    } else {
      const prev = seenInstalled.get(a.installedName);
      if (prev) pushError(findings, "agents", id, `installedName collision with "${prev}": ${a.installedName}`);
      else seenInstalled.set(a.installedName, id);
    }
    if (typeof a.description !== "string" || a.description.trim() === "") {
      pushError(findings, "agents", id, "description must be a non-empty string");
    }
  }
}

function validateRules(rules, repoRoot, findings) {
  for (const key of Object.keys(rules)) {
    const r = rules[key];
    if (!r || typeof r !== "object") {
      pushError(findings, "rules", key, "entry must be an object");
      continue;
    }
    if (typeof r.sourcePath !== "string" || !r.sourcePath) {
      pushError(findings, "rules", key, "sourcePath must be a non-empty string");
    } else if (repoRoot && !isInsideRepo(repoRoot, r.sourcePath)) {
      pushError(findings, "rules", key, `sourcePath escapes repo: ${r.sourcePath}`);
    } else if (repoRoot) {
      const abs = path.resolve(repoRoot, r.sourcePath);
      if (!fs.existsSync(abs)) pushError(findings, "rules", key, `sourcePath does not exist: ${r.sourcePath}`);
    }
    if (typeof r.description !== "string" || r.description.trim() === "") {
      pushError(findings, "rules", key, "description must be a non-empty string");
    }
  }
}

function validateSkills(skills, agents, rules, repoRoot, skillsDirAbs, findings, skillIdPrefix = null) {
  for (const id of Object.keys(skills)) {
    const s = skills[id];
    if (!s || typeof s !== "object") {
      pushError(findings, "skills", id, "entry must be an object");
      continue;
    }
    if (s.id !== id) pushError(findings, "skills", id, `id field "${s.id}" does not match key "${id}"`);
    if (skillIdPrefix) {
      const skillIdMarker = `${skillIdPrefix}:`;
      if (typeof id !== "string" || !id.startsWith(skillIdMarker)) {
        pushError(findings, "skills", id, `skill id must start with "${skillIdMarker}": ${id}`);
      }
    }
    if (typeof s.dirname !== "string" || !s.dirname) {
      pushError(findings, "skills", id, "dirname must be a non-empty string");
    }
    if (typeof s.sourcePath !== "string" || !s.sourcePath) {
      pushError(findings, "skills", id, "sourcePath must be a non-empty string");
    } else if (repoRoot && !isInsideRepo(repoRoot, s.sourcePath)) {
      pushError(findings, "skills", id, `sourcePath escapes repo: ${s.sourcePath}`);
    } else if (repoRoot) {
      const abs = path.resolve(repoRoot, s.sourcePath);
      if (!fs.existsSync(abs)) {
        pushError(findings, "skills", id, `sourcePath does not exist: ${s.sourcePath}`);
      } else {
        const skillMd = path.join(abs, "SKILL.md");
        if (!fs.existsSync(skillMd)) pushError(findings, "skills", id, `SKILL.md missing at ${s.sourcePath}/SKILL.md`);
        else validateSkillFrontmatterMatch(s, skillMd, findings);
      }
    }
    if (!CATEGORY_SET.has(s.category)) {
      pushError(findings, "skills", id, `unknown category "${s.category}" (valid: ${CATEGORIES.join(", ")})`);
    }
    if (!PROFILE_SET.has(s.profile)) {
      pushError(findings, "skills", id, `unknown profile "${s.profile}" (valid: ${PROFILES.join(", ")})`);
    }
    if (s.profile === "host-specific") {
      if (!Array.isArray(s.appliesTo) || s.appliesTo.length === 0) {
        pushError(findings, "skills", id, "host-specific profile requires non-empty appliesTo array");
      } else {
        for (const h of s.appliesTo) {
          if (!HOST_SET.has(h)) pushError(findings, "skills", id, `appliesTo host "${h}" not in {${HOSTS.join(", ")}}`);
        }
      }
    } else if (s.appliesTo !== undefined) {
      pushError(findings, "skills", id, "appliesTo only allowed for host-specific profile");
    }
    if (typeof s.description !== "string" || s.description.trim() === "") {
      pushError(findings, "skills", id, "description must be a non-empty string");
    }
    validateDependencies(s.dependencies, agents, rules, skills, "skills", id, findings);
  }
  if (skillsDirAbs && fs.existsSync(skillsDirAbs)) {
    const fsDirs = fs.readdirSync(skillsDirAbs, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const manifestDirs = new Set(Object.values(skills).map((s) => s.dirname));
    for (const d of fsDirs) {
      if (!manifestDirs.has(d)) pushError(findings, "skills", null, `skill on disk not in manifest: ${d}`);
    }
  }
}

function validateSkillFrontmatterMatch(skill, skillMdPath, findings) {
  const text = stripBom(fs.readFileSync(skillMdPath, "utf8"));
  const m = text.match(FRONTMATTER_RE);
  if (!m) return;
  const fm = m[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  if (nameMatch && nameMatch[1].trim() !== skill.id) {
    pushError(findings, "skills", skill.id, `frontmatter name "${nameMatch[1].trim()}" does not match manifest id "${skill.id}"`);
  }
  const catMatch = fm.match(/^category:\s*(.+)$/m);
  if (catMatch && catMatch[1].trim() !== skill.category) {
    pushError(findings, "skills", skill.id, `frontmatter category "${catMatch[1].trim()}" does not match manifest category "${skill.category}"`);
  }
  validateOpenCodeInstructionsFile(skill, skillMdPath, fm, findings);
}

function validateOpenCodeInstructionsFile(skill, skillMdPath, frontmatterText, findings) {
  const result = readHostInstructions(frontmatterText);
  if (result === null) return;
  if (!isValidRelativeSkillPath(result.value)) return;

  // P2-F: cite the actual frontmatter key that supplied the value so the user
  // can grep their SKILL.md. `host-instructions:` is the unified key (v0.8);
  // `opencode-instructions:` is the legacy alias retained for back-compat.
  const sourceKey = result.source === "host" ? HOST_INSTRUCTIONS_KEY : OPENCODE_INSTRUCTIONS_KEY;
  const relativeInstructionPath = result.value;

  const skillDir = path.dirname(skillMdPath);
  const instructionPath = path.resolve(skillDir, relativeInstructionPath);
  if (!instructionPath.startsWith(`${skillDir}${path.sep}`)) {
    pushError(findings, "skills", skill.id, `${sourceKey} path escapes skill directory: ${relativeInstructionPath}`);
    return;
  }
  if (!fs.existsSync(instructionPath)) {
    pushError(findings, "skills", skill.id, `${sourceKey} file does not exist: ${path.posix.join(skill.sourcePath, relativeInstructionPath)}`);
  }
}

function validateDependencies(deps, agents, rules, skills, section, ownerId, findings) {
  if (deps === undefined) return;
  if (!deps || typeof deps !== "object" || Array.isArray(deps)) {
    pushError(findings, section, ownerId, "dependencies must be an object");
    return;
  }
  const allowed = new Set(["rules", "agents", "skills"]);
  for (const k of Object.keys(deps)) {
    if (!allowed.has(k)) {
      pushError(findings, section, ownerId, `unknown dependency kind: ${k}`);
      continue;
    }
    if (!Array.isArray(deps[k])) {
      pushError(findings, section, ownerId, `dependencies.${k} must be an array`);
      continue;
    }
    for (const ref of deps[k]) {
      if (typeof ref !== "string") {
        pushError(findings, section, ownerId, `dependencies.${k} entries must be strings`);
        continue;
      }
      if (k === "agents" && !(ref in agents)) pushError(findings, section, ownerId, `dependencies.agents references unknown agent: ${ref}`);
      if (k === "rules" && !(ref in rules)) pushError(findings, section, ownerId, `dependencies.rules references unknown rule key: ${ref}`);
      if (k === "skills" && !(ref in skills)) pushError(findings, section, ownerId, `dependencies.skills references unknown skill: ${ref}`);
    }
  }
}

function validateBundles(bundles, skills, agents, rules, findings) {
  for (const id of Object.keys(bundles)) {
    const b = bundles[id];
    if (!b || typeof b !== "object") {
      pushError(findings, "bundles", id, "entry must be an object");
      continue;
    }
    if (b.id !== id) pushError(findings, "bundles", id, `id field "${b.id}" does not match key "${id}"`);
    if (typeof b.description !== "string" || b.description.trim() === "") {
      pushError(findings, "bundles", id, "description must be a non-empty string");
    }
    for (const sec of ["skills", "agents", "rules"]) {
      const arr = b[sec];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) {
        pushError(findings, "bundles", id, `${sec} must be an array`);
        continue;
      }
      const lookup = sec === "skills" ? skills : sec === "agents" ? agents : rules;
      for (const ref of arr) {
        if (typeof ref !== "string") {
          pushError(findings, "bundles", id, `${sec} entries must be strings`);
          continue;
        }
        if (!(ref in lookup)) pushError(findings, "bundles", id, `${sec} references unknown id: ${ref}`);
      }
    }
  }
}

function validateCaseFoldedPathCollisions(manifest, findings) {
  const seen = new Map();
  const collect = (section, id, p) => {
    if (typeof p !== "string" || !p) return;
    const lower = p.toLowerCase();
    if (seen.has(lower)) {
      const prev = seen.get(lower);
      if (prev.path !== p) {
        pushError(findings, section, id, `case-folded path collision with ${prev.section}/${prev.id}: "${prev.path}" vs "${p}"`);
      }
    } else {
      seen.set(lower, { section, id, path: p });
    }
  };
  for (const id of Object.keys(manifest.skills)) collect("skills", id, manifest.skills[id]?.sourcePath);
  for (const id of Object.keys(manifest.agents)) collect("agents", id, manifest.agents[id]?.sourcePath);
  for (const id of Object.keys(manifest.rules)) collect("rules", id, manifest.rules[id]?.sourcePath);
}

export function exitCodeFor(findings) {
  if (findings.length === 0) return 0;
  return findings.some((f) => f.severity === "parse-error") ? 2 : 1;
}

export function formatFindings(findings, mode = "text") {
  if (mode === "json") return JSON.stringify({ pass: findings.length === 0, findings }, null, 2);
  return findings.map((f) => `[${f.severity}] ${f.section}${f.id ? `:${f.id}` : ""} — ${f.message}`).join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const manifestFlag = args.find((arg) => arg.startsWith("--manifest="));
  const manifestPath = manifestFlag
    ? path.resolve(manifestFlag.slice("--manifest=".length))
    : null;
  const repoRoot = manifestPath ? path.dirname(manifestPath) : path.resolve(process.cwd());
  const paths = defaultPaths(repoRoot);
  if (manifestPath) paths.manifestPath = manifestPath;
  if (!fs.existsSync(paths.manifestPath)) {
    process.stderr.write(`manifest not found: ${paths.manifestPath}\n`);
    process.exit(2);
  }
  const manifest = loadManifest(paths.manifestPath);
  const findings = validateManifest(manifest, paths);
  if (json) {
    process.stdout.write(formatFindings(findings, "json") + "\n");
  } else if (findings.length === 0) {
    process.stderr.write(`OK manifest validates (${Object.keys(manifest.skills).length} skills, ${Object.keys(manifest.agents).length} agents, ${Object.keys(manifest.rules).length} rules, ${Object.keys(manifest.bundles).length} bundles)\n`);
  } else {
    process.stderr.write(formatFindings(findings, "text") + "\n");
  }
  process.exit(exitCodeFor(findings));
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
