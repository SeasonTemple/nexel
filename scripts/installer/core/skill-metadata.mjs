import path from "node:path";

export const OPENCODE_INSTRUCTIONS_KEY = "opencode-instructions";

export function isValidOpenCodeInstructionsPath(value) {
  if (typeof value !== "string") return false;
  if (value.trim() !== value || value.length === 0) return false;
  if (value.startsWith("'") || value.startsWith('"')) return false;
  if (/\s/.test(value)) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  return !value.split(/[\\/]+/).includes("..");
}

export function readOpenCodeInstructions(frontmatterText) {
  const line = String(frontmatterText ?? "")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${OPENCODE_INSTRUCTIONS_KEY}:`));

  if (!line) return null;
  const value = line.slice(OPENCODE_INSTRUCTIONS_KEY.length + 1).trim();
  return value || "";
}
