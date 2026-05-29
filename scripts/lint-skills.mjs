import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { isValidOpenCodeInstructionsPath, readOpenCodeInstructions } from "./installer/core/skill-metadata.mjs";
import { FRONTMATTER_RE, CATEGORY_SET } from "./installer/core/manifest/schema.mjs";
// Single source of truth: the category enum lives in schema.mjs. Keep the
// VALID_CATEGORIES export (consumed by lint-skills.test.mjs) derived from it so
// the linter and rebuild-manifest can never silently disagree on the enum.
export const VALID_CATEGORIES = Object.freeze([...CATEGORY_SET]);

export function stripBom(s) {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function extractFrontmatter(text) {
  const stripped = stripBom(text);
  const m = stripped.match(FRONTMATTER_RE);
  return m ? m[1] : null;
}

export function validateSkill(dirname, frontmatterText, options = {}) {
  const idPrefix = options.idPrefix ?? null;
  const findings = [];
  if (frontmatterText === null || frontmatterText === undefined) {
    findings.push({ severity: "error", message: "missing frontmatter block (must start with --- on the first line)" });
    return findings;
  }
  if (frontmatterText.trim() === "") {
    findings.push({ severity: "error", message: "empty frontmatter" });
    return findings;
  }
  let parsed;
  try {
    parsed = parseYaml(frontmatterText);
  } catch (e) {
    findings.push({ severity: "parse-error", message: `YAML parse failed: ${e.message}` });
    return findings;
  }
  if (!parsed || typeof parsed !== "object") {
    findings.push({ severity: "error", message: "frontmatter did not parse to an object" });
    return findings;
  }
  // When --id-prefix=<prefix> is supplied, enforce name === "<prefix>:<dirname>".
  // When omitted, only require that `name` is a non-empty string.
  if (parsed.name === undefined || parsed.name === null || parsed.name === "") {
    findings.push({ severity: "error", message: "missing required field: name" });
  } else if (typeof parsed.name !== "string") {
    findings.push({ severity: "error", message: `name must be a string, got ${typeof parsed.name}` });
  } else if (idPrefix) {
    const expectedName = `${idPrefix}:${dirname}`;
    if (parsed.name !== expectedName) {
      findings.push({ severity: "error", message: `name mismatch: expected "${expectedName}", got "${parsed.name}"` });
    }
  }
  const desc = parsed.description;
  if (desc === undefined || desc === null) {
    findings.push({ severity: "error", message: "missing required field: description" });
  } else if (typeof desc !== "string") {
    findings.push({ severity: "error", message: `description must be a string, got ${typeof desc}` });
  } else if (desc.trim() === "") {
    findings.push({ severity: "error", message: "empty required field: description" });
  }
  const cat = parsed.category;
  if (cat === undefined || cat === null || cat === "") {
    findings.push({ severity: "error", message: `missing required field: category (one of: ${VALID_CATEGORIES.join(", ")})` });
  } else if (typeof cat !== "string") {
    findings.push({ severity: "error", message: `category must be a string, got ${typeof cat}` });
  } else if (!CATEGORY_SET.has(cat)) {
    findings.push({ severity: "error", message: `category mismatch: "${cat}" not in {${VALID_CATEGORIES.join(", ")}}` });
  }
  validateOpenCodeInstructions(parsed, frontmatterText, findings);
  return findings;
}

function validateOpenCodeInstructions(parsed, frontmatterText, findings) {
  if (!Object.hasOwn(parsed, "opencode-instructions")) return;
  const value = parsed["opencode-instructions"];
  if (typeof value !== "string") {
    findings.push({ severity: "error", message: `opencode-instructions must be a string, got ${typeof value}` });
    return;
  }
  const rawValue = readOpenCodeInstructions(frontmatterText);
  if (!isValidOpenCodeInstructionsPath(rawValue)) {
    findings.push({
      severity: "error",
      message: "opencode-instructions must be a non-empty unquoted relative path without whitespace, absolute paths, or .. segments",
    });
  }
}

export function lintSkillsDir(skillsDir, options = {}) {
  if (!fs.existsSync(skillsDir)) {
    return {
      findings: [{ file: skillsDir, severity: "error", message: `skills directory not found: ${skillsDir}` }],
      scanned: 0,
    };
  }
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const allFindings = [];
  for (const entry of entries) {
    const dirname = entry.name;
    const skillMd = path.join(skillsDir, dirname, "SKILL.md");
    if (!fs.existsSync(skillMd)) {
      allFindings.push({ file: skillMd, severity: "error", message: "SKILL.md missing" });
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(skillMd, "utf8");
    } catch (e) {
      allFindings.push({ file: skillMd, severity: "parse-error", message: `read failed: ${e.message}` });
      continue;
    }
    const frontmatterText = extractFrontmatter(text);
    const findings = validateSkill(dirname, frontmatterText, options);
    for (const f of findings) {
      allFindings.push({ file: skillMd, ...f });
    }
  }
  return { findings: allFindings, scanned: entries.length };
}

export function format(findings, mode) {
  if (mode === "json") {
    return JSON.stringify(findings, null, 2);
  }
  return findings.map((f) => `${f.file}: ${f.severity} ${f.message}`).join("\n");
}

export function exitCodeFor(findings) {
  if (findings.some((f) => f.severity === "parse-error")) return 2;
  if (findings.some((f) => f.severity === "error")) return 1;
  return 0;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const json = args.includes("--json");
  const quiet = args.includes("--quiet");
  const dirFlag = args.find((a) => a.startsWith("--dir="));
  const dir = dirFlag ? path.resolve(dirFlag.slice("--dir=".length)) : path.resolve(process.cwd(), "skills");
  const idPrefixFlag = args.find((a) => a.startsWith("--id-prefix="));
  const idPrefix = idPrefixFlag ? idPrefixFlag.slice("--id-prefix=".length) : null;
  return { json, quiet, dir, idPrefix };
}

function main() {
  const { json, quiet, dir: skillsDir, idPrefix } = parseArgs(process.argv);
  const { findings, scanned } = lintSkillsDir(skillsDir, { idPrefix });
  const code = exitCodeFor(findings);
  if (quiet) {
    process.exit(code);
  }
  if (findings.length === 0) {
    if (json) {
      process.stdout.write(JSON.stringify({ pass: true, scanned, findings: [] }) + "\n");
    } else {
      process.stderr.write(`OK skills lint passed (${scanned} skills)\n`);
    }
  } else {
    if (json) {
      process.stdout.write(JSON.stringify({ pass: false, scanned, findings }) + "\n");
    } else {
      process.stderr.write(format(findings, "text") + "\n");
    }
  }
  process.exit(code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
