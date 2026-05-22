import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { applyLocale, resolveLocale } from "./locale.mjs";
import { getLocale, strings } from "./strings.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SAMPLE_BIN = path.join(REPO_ROOT, "examples/sample-product/bin.mjs");

test("resolveLocale honors explicit args before product env and host locale", () => {
  assert.equal(resolveLocale({
    args: { lang: "en" },
    productConfig: { envLocale: "SAMPLE_LANG" },
    env: { SAMPLE_LANG: "zh", LANG: "zh_CN.UTF-8" },
  }), "en");
});

test("applyLocale selects Chinese catalog through product env", () => {
  const locale = applyLocale({
    args: {},
    productConfig: { envLocale: "SAMPLE_LANG" },
    env: { SAMPLE_LANG: "zh" },
  });

  assert.equal(locale, "zh");
  assert.equal(getLocale(), "zh");
  assert.match(strings.help.header({ binName: "stub", version: "1.0.0" }), /托管安装器/);
  applyLocale({ args: { lang: "en" }, env: {}, productConfig: null });
});

test("sample bin pins English with --lang even on a Chinese host locale", () => {
  const result = spawnSync("node", [SAMPLE_BIN, "help", "--lang", "en"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      LANG: "zh_CN.UTF-8",
      LC_ALL: "zh_CN.UTF-8",
      NEXEL_LANG: "",
      SAMPLE_LANG: "",
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.doesNotMatch(result.stdout, /用法:/);
});

test("sample bin renders Chinese help when product locale env is zh", () => {
  const result = spawnSync("node", [SAMPLE_BIN, "help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      SAMPLE_LANG: "zh",
      NEXEL_LANG: "",
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /用法:/);
  assert.match(result.stdout, /通用 flags:/);
});

test("JSON output keys stay stable across locales", () => {
  const en = spawnSync("node", [SAMPLE_BIN, "validate", "skills/hello-world/SKILL.md", "--json", "--lang", "en"], {
    cwd: path.join(REPO_ROOT, "examples/sample-product"),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const zh = spawnSync("node", [SAMPLE_BIN, "validate", "skills/hello-world/SKILL.md", "--json", "--lang", "zh"], {
    cwd: path.join(REPO_ROOT, "examples/sample-product"),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  assert.equal(en.status, 0);
  assert.equal(zh.status, 0);
  assert.deepEqual(Object.keys(JSON.parse(en.stdout)).sort(), Object.keys(JSON.parse(zh.stdout)).sort());
});
