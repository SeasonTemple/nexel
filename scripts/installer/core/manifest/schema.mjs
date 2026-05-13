// Manifest schema — single source of truth for field definitions, enums,
// schema version, and frontmatter regex. Pure data; no IO; no logic.
//
// Adding a new asset category, profile, or supported host = edit this file.
// Adding a new manifest schemaVersion = bump SCHEMA_VERSION + add a migration
// in state.mjs (manifest itself is not versioned for migration today; the
// loader simply verifies the constant).

export const SCHEMA_VERSION = 1;

export const PROFILES = Object.freeze([
  "standalone",
  "bundle",
  "repo-only",
  "host-specific",
]);

export const CATEGORIES = Object.freeze([
  "principle",
  "best-practice",
  "test",
  "review",
  "tool",
  "setup",
]);

export const HOSTS = Object.freeze(["opencode", "claude-code", "codex"]);

export const PROFILE_SET = new Set(PROFILES);
export const CATEGORY_SET = new Set(CATEGORIES);
export const HOST_SET = new Set(HOSTS);

// SKILL.md frontmatter must start with --- on the very first line, followed
// by YAML, then --- on its own line. CRLF tolerated. Single block only.
export const FRONTMATTER_RE = /^---\r?\n([\s\S]+?)\r?\n---/;
