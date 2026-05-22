const ENGLISH_HEADING_RE = /^##\s+(English|EN)\s*$/im;
const CHINESE_HEADING_RE = /^##\s+(中文|Chinese|ZH|zh-CN)\s*$/im;

export function validateBilingualReleaseNote(text) {
  const body = String(text ?? "");
  const failures = [];

  if (!ENGLISH_HEADING_RE.test(body)) {
    failures.push("missing English release-note section: add `## English`");
  }
  if (!CHINESE_HEADING_RE.test(body)) {
    failures.push("missing Chinese release-note section: add `## 中文`");
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}
