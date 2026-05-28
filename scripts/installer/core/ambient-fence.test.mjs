import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeAmbientFence, hasAmbientFence } from "./ambient-fence.mjs";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-ambient-fence-"));
}

function fenceFor(name, body) {
  return `<!-- nexel:${name}:begin -->\n${body}\n<!-- nexel:${name}:end -->`;
}

test("creates the target file with only the fence when target is missing", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    const result = writeAmbientFence({
      targetPath: target,
      productName: "alpha",
      contentBlock: "alpha body",
    });
    assert.equal(result.action, "created");
    assert.equal(result.changed, true);
    assert.equal(fs.readFileSync(target, "utf8"), `${fenceFor("alpha", "alpha body")}\n`);
    assert.equal(hasAmbientFence(target, "alpha"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("appends the fence when target exists but has no fence for this product", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    fs.writeFileSync(target, "user prose line\n");
    const result = writeAmbientFence({
      targetPath: target,
      productName: "alpha",
      contentBlock: "alpha body",
    });
    assert.equal(result.action, "appended");
    assert.equal(result.changed, true);
    assert.equal(
      fs.readFileSync(target, "utf8"),
      `user prose line\n\n${fenceFor("alpha", "alpha body")}\n`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("appends without leading blank lines when target file is empty", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    fs.writeFileSync(target, "");
    const result = writeAmbientFence({
      targetPath: target,
      productName: "alpha",
      contentBlock: "alpha body",
    });
    assert.equal(result.action, "appended");
    assert.equal(fs.readFileSync(target, "utf8"), `${fenceFor("alpha", "alpha body")}\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("re-running with identical content is a no-op (action: updated, changed: false, file untouched)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    writeAmbientFence({
      targetPath: target,
      productName: "alpha",
      contentBlock: "alpha body",
    });
    const before = fs.readFileSync(target, "utf8");
    const mtimeBefore = fs.statSync(target).mtimeMs;

    // Sleep-free: filesystem mtime resolution can be coarse; assert byte equality + file unchanged via writeFileSync skip.
    const result = writeAmbientFence({
      targetPath: target,
      productName: "alpha",
      contentBlock: "alpha body",
    });
    assert.equal(result.action, "updated");
    assert.equal(result.changed, false);
    const after = fs.readFileSync(target, "utf8");
    assert.equal(after, before);
    const mtimeAfter = fs.statSync(target).mtimeMs;
    assert.equal(mtimeAfter, mtimeBefore, "file should not be rewritten on no-op");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("replaces fence content when re-running with different content (action: updated, changed: true)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    fs.writeFileSync(target, `prelude line\n\n${fenceFor("alpha", "old body")}\n\nepilogue line\n`);
    const result = writeAmbientFence({
      targetPath: target,
      productName: "alpha",
      contentBlock: "new body",
    });
    assert.equal(result.action, "updated");
    assert.equal(result.changed, true);
    assert.equal(
      fs.readFileSync(target, "utf8"),
      `prelude line\n\n${fenceFor("alpha", "new body")}\n\nepilogue line\n`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("preserves fences belonging to other products byte-identically", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    const original = `${fenceFor("acme", "acme body")}\n\nbetween\n\n${fenceFor("alpha", "old alpha body")}\n`;
    fs.writeFileSync(target, original);

    const result = writeAmbientFence({
      targetPath: target,
      productName: "alpha",
      contentBlock: "new alpha body",
    });

    assert.equal(result.action, "updated");
    assert.equal(result.changed, true);
    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes(fenceFor("acme", "acme body")), "acme fence preserved verbatim");
    assert.ok(after.includes(fenceFor("alpha", "new alpha body")), "alpha fence updated");
    assert.ok(!after.includes("old alpha body"), "old alpha content fully replaced");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("appending a new product fence preserves other products' fences", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    const original = `${fenceFor("acme", "acme body")}\n`;
    fs.writeFileSync(target, original);

    const result = writeAmbientFence({
      targetPath: target,
      productName: "beta",
      contentBlock: "beta body",
    });

    assert.equal(result.action, "appended");
    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes(fenceFor("acme", "acme body")), "acme fence preserved");
    assert.ok(after.includes(fenceFor("beta", "beta body")), "beta fence appended");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("product names with regex metacharacters are treated literally", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    // Product name contains '.' — regex metacharacter. Naive injection would
    // make the begin marker for 'acme.skills' also match e.g. 'acmeXskills'.
    const original = `${fenceFor("acme.skills", "real product")}\n${fenceFor("acmeXskills", "different product")}\n`;
    fs.writeFileSync(target, original);

    const result = writeAmbientFence({
      targetPath: target,
      productName: "acme.skills",
      contentBlock: "new body",
    });

    assert.equal(result.action, "updated");
    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes(fenceFor("acme.skills", "new body")), "acme.skills fence replaced");
    assert.ok(after.includes(fenceFor("acmeXskills", "different product")), "acmeXskills fence preserved");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("creates parent directories that do not yet exist", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "nested", "deeper", "CLAUDE.md");
    const result = writeAmbientFence({
      targetPath: target,
      productName: "alpha",
      contentBlock: "alpha body",
    });
    assert.equal(result.action, "created");
    assert.ok(fs.existsSync(target));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hasAmbientFence detects presence without rewriting", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    assert.equal(hasAmbientFence(target, "alpha"), false);
    writeAmbientFence({
      targetPath: target,
      productName: "alpha",
      contentBlock: "alpha body",
    });
    assert.equal(hasAmbientFence(target, "alpha"), true);
    assert.equal(hasAmbientFence(target, "other"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("throws TypeError on missing or invalid required arguments", () => {
  assert.throws(() => writeAmbientFence({ productName: "alpha", contentBlock: "body" }), TypeError);
  assert.throws(() => writeAmbientFence({ targetPath: "/tmp/x.md", contentBlock: "body" }), TypeError);
  assert.throws(() => writeAmbientFence({ targetPath: "/tmp/x.md", productName: "alpha", contentBlock: 42 }), TypeError);
});
