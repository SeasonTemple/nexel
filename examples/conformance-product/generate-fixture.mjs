#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const categories = ["principle", "best-practice", "test", "review", "tool", "setup"];
const profiles = ["standalone", "bundle", "repo-only", "host-specific"];
const hosts = ["opencode", "claude-code", "codex"];

fs.rmSync(path.join(root, "skills"), { recursive: true, force: true });
fs.rmSync(path.join(root, "agents"), { recursive: true, force: true });
fs.rmSync(path.join(root, "rules"), { recursive: true, force: true });
fs.mkdirSync(path.join(root, "skills"), { recursive: true });
fs.mkdirSync(path.join(root, "agents"), { recursive: true });
fs.mkdirSync(path.join(root, "rules"), { recursive: true });

const manifest = { schemaVersion: 1, skills: {}, agents: {}, rules: {}, bundles: {} };

for (let i = 1; i <= 8; i++) {
  const id = `agent-${String(i).padStart(2, "0")}`;
  const sourcePath = `agents/${id}.md`;
  fs.writeFileSync(path.join(root, sourcePath), `---\ndescription: Generic conformance agent ${i}\ntools:\n  - Read\n---\n\n# Generic agent ${i}\n`);
  manifest.agents[id] = {
    id,
    sourcePath,
    installedName: `conf-${id}`,
    description: `Generic conformance agent ${i}.`,
  };
}

for (let i = 1; i <= 8; i++) {
  const sourcePath = `rules/rule-${String(i).padStart(2, "0")}.md`;
  fs.writeFileSync(path.join(root, sourcePath), `# Generic rule ${i}\n\nSynthetic conformance rule.\n`);
  manifest.rules[sourcePath] = {
    sourcePath,
    description: `Generic conformance rule ${i}.`,
  };
}

for (let i = 1; i <= 36; i++) {
  const n = String(i).padStart(2, "0");
  const dirname = `skill-${n}`;
  const id = `conf:${dirname}`;
  const category = categories[(i - 1) % categories.length];
  const profile = profiles[(i - 1) % profiles.length];
  const skillDir = path.join(root, "skills", dirname);
  const hasInstructions = i % 5 === 0;
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });

  const frontmatter = [
    "---",
    `name: ${id}`,
    `category: ${category}`,
    `description: Generic conformance skill ${n}.`,
    hasInstructions ? "opencode-instructions: references/opencode-instructions.md" : null,
    "---",
  ].filter(Boolean).join("\n");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `${frontmatter}\n\n# Skill ${n}\n\nSynthetic skill for conformance coverage.\n`);
  fs.writeFileSync(path.join(skillDir, "references", "note.md"), `# Note ${n}\n`);
  if (hasInstructions) {
    fs.writeFileSync(path.join(skillDir, "references", "opencode-instructions.md"), `# OpenCode instructions ${n}\n\nGeneric ambient guidance.\n`);
  }

  const entry = {
    id,
    dirname,
    sourcePath: `skills/${dirname}`,
    category,
    profile,
    description: `Generic conformance skill ${n}.`,
  };
  if (profile === "host-specific") entry.appliesTo = [hosts[(i - 1) % hosts.length]];
  if (i % 3 === 0) {
    entry.dependencies = {
      agents: [`agent-${String(((i - 1) % 8) + 1).padStart(2, "0")}`],
      rules: [`rules/rule-${String(((i - 1) % 8) + 1).padStart(2, "0")}.md`],
    };
  }
  if (i % 7 === 0) {
    entry.dependencies = {
      ...(entry.dependencies || {}),
      skills: [`conf:skill-${String(i - 1).padStart(2, "0")}`],
    };
  }
  manifest.skills[id] = entry;
}

for (let i = 1; i <= 6; i++) {
  const n = String(i).padStart(2, "0");
  manifest.bundles[`conf-bundle-${n}`] = {
    id: `conf-bundle-${n}`,
    description: `Generic conformance bundle ${n}.`,
    skills: [`conf:skill-${String(i).padStart(2, "0")}`, `conf:skill-${String(i + 6).padStart(2, "0")}`],
    agents: [`agent-${n}`],
    rules: [`rules/rule-${n}.md`],
  };
}

fs.writeFileSync(path.join(root, "install.json"), JSON.stringify(manifest, null, 2) + "\n");
