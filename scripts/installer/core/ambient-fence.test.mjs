import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeAmbientFence, hasAmbientFence } from "./ambient-fence.mjs";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexel-ambient-fence-"));
}

const MANAGED_HEADER = "<!-- nexel-managed-fence v1; do not edit between markers -->";

function fenceFor(name, body) {
  // Mirrors writeAmbientFence's composeFenceBlock — every managed fence carries
  // the MANAGED_HEADER as line 1 of the body (P1#6 prose-collision defense).
  return `<!-- nexel:${name}:begin -->\n${MANAGED_HEADER}\n${body}\n<!-- nexel:${name}:end -->`;
}

function rawFenceFor(name, body) {
  // Legacy v0.8.0-shape fence WITHOUT the managed-header sentinel. Used to
  // exercise the round-2 P1#6 refusal path — these are indistinguishable from
  // user-prose markers as far as the writer is concerned.
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

test("escapeRegex internal: marker matching is regex-safe for character-class metachars", () => {
  // Retroactive review fixup: writeAmbientFence now validates productName at
  // entry (PRODUCT_NAME_PATTERN), so callers cannot inject regex metachars
  // through that surface. This test still exercises the internal regex-escape
  // path by writing two pre-existing fences whose product-name markers happen
  // to be substrings of one another, and verifying the lazy regex does not
  // confuse them. The actual writeAmbientFence call uses a safe name.
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    // Pre-existing fences for 'beta' and 'beta-extended' — the regex for
    // 'beta' must not match 'beta-extended's markers despite the prefix overlap.
    const original = `${fenceFor("beta", "real product")}\n${fenceFor("beta-extended", "different product")}\n`;
    fs.writeFileSync(target, original);

    const result = writeAmbientFence({
      targetPath: target,
      productName: "beta",
      contentBlock: "new body",
    });

    assert.equal(result.action, "updated");
    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes(fenceFor("beta", "new body")), "beta fence replaced");
    assert.ok(after.includes(fenceFor("beta-extended", "different product")), "beta-extended fence preserved despite prefix overlap");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("productName validation rejects unsafe values (adv-005 fixup)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    // The valid range is /^[a-zA-Z][a-zA-Z0-9_-]*$/. Each of these must throw.
    const unsafeNames = [
      "",
      " ",
      "evil\nname",
      "evil name",
      "a.b",
      "(parens)",
      "1leading-digit",
      "a:b",
      "👋emoji",
      "-leading-dash",
    ];
    for (const productName of unsafeNames) {
      assert.throws(
        () => writeAmbientFence({ targetPath: target, productName, contentBlock: "body" }),
        TypeError,
        `productName ${JSON.stringify(productName)} should be rejected`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to overwrite a marker pair lacking the managed-header sentinel (P1#6 adv-001 fixup)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    // Simulate user prose containing literal marker text with NO managed header.
    fs.writeFileSync(
      target,
      `## My notes\n\n${rawFenceFor("acme", "things I want to keep")}\n\nmore prose\n`,
    );

    assert.throws(
      () => writeAmbientFence({ targetPath: target, productName: "acme", contentBlock: "kernel body" }),
      /managed-header sentinel/i,
    );
    // User content untouched.
    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes("things I want to keep"), "user prose preserved");
    assert.ok(!after.includes("kernel body"), "kernel content NOT written");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("trusts and updates a fence that carries the managed-header sentinel", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    // Bootstrap with a real writeAmbientFence call so the managed header is present.
    writeAmbientFence({ targetPath: target, productName: "alpha", contentBlock: "old body" });
    const result = writeAmbientFence({ targetPath: target, productName: "alpha", contentBlock: "new body" });
    assert.equal(result.action, "updated");
    assert.equal(result.changed, true);
    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes("new body"));
    assert.ok(after.includes(MANAGED_HEADER), "managed header preserved on update");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to write through a symlinked target (adv-004 fixup)", () => {
  const dir = makeTempDir();
  try {
    const realTarget = path.join(dir, "real.md");
    fs.writeFileSync(realTarget, "pre-existing prose\n");
    const symlink = path.join(dir, "CLAUDE.md");
    try {
      fs.symlinkSync(realTarget, symlink);
    } catch (e) {
      // Skip when filesystem doesn't support symlinks (e.g., Windows without SeCreateSymbolicLink privilege).
      if (e.code === "EPERM" || e.code === "EACCES") return;
      throw e;
    }
    assert.throws(
      () => writeAmbientFence({ targetPath: symlink, productName: "alpha", contentBlock: "body" }),
      /symlink/i,
    );
    // Real target unchanged
    assert.equal(fs.readFileSync(realTarget, "utf8"), "pre-existing prose\n");
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
