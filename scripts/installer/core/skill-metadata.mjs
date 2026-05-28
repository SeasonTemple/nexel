import path from "node:path";

// Unified Skill Metadata key for ambient instructions shared across CLI hosts.
// `opencode-instructions:` remains valid as a back-compat alias (the original
// v0.6 key, now superseded by `host-instructions:`).
export const HOST_INSTRUCTIONS_KEY = "host-instructions";
export const OPENCODE_INSTRUCTIONS_KEY = "opencode-instructions";

// Shared predicate for any relative-path Skill Metadata value: single path,
// no whitespace, not absolute on either platform, no `..` escape. Exported
// under both names so the legacy `isValidOpenCodeInstructionsPath` callers
// continue to work unchanged.
export function isValidRelativeSkillPath(value) {
  if (typeof value !== "string") return false;
  if (value.trim() !== value || value.length === 0) return false;
  if (value.startsWith("'") || value.startsWith('"')) return false;
  if (/\s/.test(value)) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  return !value.split(/[\\/]+/).includes("..");
}

export const isValidHostInstructionsPath = isValidRelativeSkillPath;
export const isValidOpenCodeInstructionsPath = isValidRelativeSkillPath;

function readKey(frontmatterText, key) {
  const line = String(frontmatterText ?? "")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${key}:`));
  if (!line) return null;
  return line.slice(key.length + 1).trim();
}

/**
 * Structured reader for ambient-instructions Skill Metadata.
 *
 * Returns one of:
 *   - `null` when neither `host-instructions:` nor `opencode-instructions:` is declared
 *   - `{ value, source, duplicateDetected }` when at least one is declared
 *
 * Precedence: `host-instructions:` wins when both are present.
 * `source` is `"host"` or `"opencode"` (the key the returned value came from).
 * `duplicateDetected` is true iff both keys are present in the frontmatter
 * (regardless of whether the values agree). Callers (typically the
 * discover layer) are responsible for emitting any warning.
 *
 * @param {string} frontmatterText
 * @returns {null | { value: string, source: "host" | "opencode", duplicateDetected: boolean }}
 */
export function readHostInstructions(frontmatterText) {
  const hostRaw = readKey(frontmatterText, HOST_INSTRUCTIONS_KEY);
  const opencodeRaw = readKey(frontmatterText, OPENCODE_INSTRUCTIONS_KEY);
  if (hostRaw === null && opencodeRaw === null) return null;
  const duplicateDetected = hostRaw !== null && opencodeRaw !== null;
  if (hostRaw !== null) {
    return { value: hostRaw, source: "host", duplicateDetected };
  }
  return { value: opencodeRaw, source: "opencode", duplicateDetected };
}

/**
 * Legacy thin wrapper preserved for back-compat with v0.7 callers that import
 * `readOpenCodeInstructions`. Returns the raw value string (or "" / null)
 * exactly as the v0.7 reader did, ignoring duplicate detection.
 *
 * @param {string} frontmatterText
 * @returns {string | null}
 */
export function readOpenCodeInstructions(frontmatterText) {
  const result = readHostInstructions(frontmatterText);
  if (result === null) return null;
  return result.value;
}
