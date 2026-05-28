import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeAmbientFence, hasAmbientFence, removeAmbientFence } from "./ambient-fence.mjs";

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

test("trusts a CRLF-converted managed fence (editor round-trip tolerance, v0.8.3 #7)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    // Write a fence with LF, then convert to CRLF as an editor (e.g.,
    // Windows Notepad) might do. isFenceTrusted must still recognize it.
    writeAmbientFence({ targetPath: target, productName: "crlf-test", contentBlock: "body content" });
    const lfContent = fs.readFileSync(target, "utf8");
    fs.writeFileSync(target, lfContent.replace(/\n/g, "\r\n"));

    // Re-running with the same content should be recognized as an
    // existing trusted fence (no orphan refusal, no untrusted refusal).
    const result = writeAmbientFence({
      targetPath: target,
      productName: "crlf-test",
      contentBlock: "body content",
    });
    assert.equal(result.action, "updated");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses trusted path when target file has unbalanced begin/end markers (adv-002 v0.8.3 #2)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    // Two BEGIN markers but one END — lazy regex would otherwise span from
    // FIRST BEGIN to single END, silently swallowing user prose between
    // SECOND BEGIN and END on replace.
    fs.writeFileSync(
      target,
      `<!-- nexel:dup:begin -->\n${MANAGED_HEADER}\nold managed body\n<!-- nexel:dup:begin -->\nuser-pasted prose between markers\n<!-- nexel:dup:end -->\n`,
    );
    assert.throws(
      () => writeAmbientFence({ targetPath: target, productName: "dup", contentBlock: "new body" }),
      /unbalanced fence markers/i,
    );
    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes("user-pasted prose between markers"));
    assert.ok(!after.includes("new body"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses append path when target file contains an orphan begin marker (adv-006 v0.8.2)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    // User prose copies the documented marker syntax but neglects to add the
    // end marker (or the end marker was hand-deleted). Without the v0.8.2
    // defense, writeAmbientFence would append below the orphan and the next
    // update would lazy-match across the orphan + the just-appended end.
    fs.writeFileSync(
      target,
      `## My notes\n\n<!-- nexel:acme:begin -->\nthings I want to keep\n\n(no end marker)\n`,
    );
    assert.throws(
      () => writeAmbientFence({ targetPath: target, productName: "acme", contentBlock: "kernel body" }),
      // v0.8.3 unified orphan/unbalanced detection: orphan-BEGIN (1 BEGIN, 0 END)
      // surfaces as "unbalanced fence markers" — the more general defense
      // subsumes the v0.8.2 orphan-only check.
      /unbalanced fence markers/i,
    );
    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes("things I want to keep"));
    assert.ok(!after.includes("kernel body"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses fence whose body contains the sentinel literal but NOT on line 1 (v0.8.2 line-anchor)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    // Attack class corrected in v0.8.2: prior .includes() check would TRUST
    // any block containing the sentinel anywhere. Now the sentinel must occupy
    // line 1 of the body. This block has the sentinel as line 3, not line 1
    // — must refuse.
    fs.writeFileSync(
      target,
      `<!-- nexel:acme:begin -->\nuser line one\nuser line two\n${MANAGED_HEADER}\nthings I copied from docs\n<!-- nexel:acme:end -->\n`,
    );
    assert.throws(
      () => writeAmbientFence({ targetPath: target, productName: "acme", contentBlock: "kernel body" }),
      /managed-header sentinel/i,
    );
    // User content preserved byte-identically.
    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes("user line one"));
    assert.ok(after.includes("things I copied from docs"));
    assert.ok(!after.includes("kernel body"));
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

test("refuses to lock through a symlinked .lock path (adv-r5-C v0.8.5 DOS defense)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    const lockPath = `${target}.lock`;
    // Plant a symlink at the lock path — without the v0.8.5 defense, this
    // would permanently block every subsequent activate with ELOCKED
    // because proper-lockfile's stale cleanup doesn't fire on symlinks.
    const decoyTarget = path.join(dir, "decoy");
    fs.writeFileSync(decoyTarget, "irrelevant");
    try {
      fs.symlinkSync(decoyTarget, lockPath);
    } catch (e) {
      if (e.code === "EPERM" || e.code === "EACCES") return; // Windows w/o privilege
      throw e;
    }
    assert.throws(
      () => writeAmbientFence({ targetPath: target, productName: "alpha", contentBlock: "body" }),
      // Pin the v0.8.5 guard's distinctive wording. proper-lockfile's own
      // ELOCKED would also match /symlink/i loosely — anchor on the
      // "planted DOS or stale state" framing to prove this test exercises
      // the v0.8.5 lstat-before-lock check, not just any symlink rejection.
      /planted DOS or stale state/i,
    );
    // Target file untouched.
    assert.equal(fs.existsSync(target), false);
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

// ---------- removeAmbientFence (ADR-0017 / v0.9.0) ----------

test("removeAmbientFence removes only THIS product's fence, preserving siblings byte-identically", () => {
  // Multi-product isolation invariant (INTERLOCK LOCK 1): exact-invert
  // per-product removal MUST NOT touch fences belonging to other products
  // sharing the same host file. Companion to the writeAmbientFence
  // preservation witness at :134.
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    // Two real managed fences laid down via the writer so the managed-header
    // sentinel is present on each (the exact bytes user hosts will see).
    writeAmbientFence({ targetPath: target, productName: "acme", contentBlock: "acme body" });
    writeAmbientFence({ targetPath: target, productName: "alpha", contentBlock: "alpha body" });
    const acmeFenceText = fenceFor("acme", "acme body");
    const before = fs.readFileSync(target, "utf8");
    assert.ok(before.includes(acmeFenceText), "acme fence written");
    assert.ok(before.includes(fenceFor("alpha", "alpha body")), "alpha fence written");

    const result = removeAmbientFence({ targetPath: target, productName: "alpha" });
    assert.equal(result.action, "removed");
    assert.equal(result.changed, true);
    const after = fs.readFileSync(target, "utf8");
    assert.ok(after.includes(acmeFenceText), "acme fence preserved byte-identically");
    assert.ok(!after.includes("alpha body"), "alpha content fully removed");
    assert.ok(!after.includes("<!-- nexel:alpha:begin -->"), "alpha begin marker removed");
    assert.ok(!after.includes("<!-- nexel:alpha:end -->"), "alpha end marker removed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeAmbientFence returns noop on missing host file", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md"); // never created
    const result = removeAmbientFence({ targetPath: target, productName: "alpha" });
    assert.equal(result.action, "noop");
    assert.equal(result.changed, false);
    assert.ok(typeof result.reason === "string" && result.reason.length > 0);
    assert.equal(fs.existsSync(target), false, "missing file remains absent (no side-effect creation)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeAmbientFence returns noop on file without this product's fence (different product fence present)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    writeAmbientFence({ targetPath: target, productName: "other", contentBlock: "other body" });
    const before = fs.readFileSync(target, "utf8");

    const result = removeAmbientFence({ targetPath: target, productName: "alpha" });
    assert.equal(result.action, "noop");
    assert.equal(result.changed, false);
    assert.equal(result.reason, "no fence for this product");
    // Other product's content byte-identical.
    assert.equal(fs.readFileSync(target, "utf8"), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeAmbientFence refuses target-symlink (adv-004 parity)", () => {
  const dir = makeTempDir();
  try {
    const realTarget = path.join(dir, "real.md");
    writeAmbientFence({ targetPath: realTarget, productName: "alpha", contentBlock: "body" });
    const realBefore = fs.readFileSync(realTarget, "utf8");
    const symlink = path.join(dir, "CLAUDE.md");
    try {
      fs.symlinkSync(realTarget, symlink);
    } catch (e) {
      if (e.code === "EPERM" || e.code === "EACCES") return;
      throw e;
    }
    assert.throws(
      () => removeAmbientFence({ targetPath: symlink, productName: "alpha" }),
      /symlink/i,
    );
    // Real target unchanged — defense prevented mutation through the link.
    assert.equal(fs.readFileSync(realTarget, "utf8"), realBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeAmbientFence refuses lock-symlink (adv-r5-C parity)", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    writeAmbientFence({ targetPath: target, productName: "alpha", contentBlock: "body" });
    const lockPath = `${target}.lock`;
    const decoyTarget = path.join(dir, "decoy");
    fs.writeFileSync(decoyTarget, "irrelevant");
    try {
      fs.symlinkSync(decoyTarget, lockPath);
    } catch (e) {
      if (e.code === "EPERM" || e.code === "EACCES") return;
      throw e;
    }
    assert.throws(
      () => removeAmbientFence({ targetPath: target, productName: "alpha" }),
      /planted DOS or stale state/i,
    );
    // Host file unchanged.
    assert.ok(fs.readFileSync(target, "utf8").includes("body"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeAmbientFence is idempotent: repeat call returns noop", () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, "CLAUDE.md");
    writeAmbientFence({ targetPath: target, productName: "alpha", contentBlock: "body" });
    const first = removeAmbientFence({ targetPath: target, productName: "alpha" });
    assert.equal(first.action, "removed");
    assert.equal(first.changed, true);
    const second = removeAmbientFence({ targetPath: target, productName: "alpha" });
    assert.equal(second.action, "noop");
    assert.equal(second.changed, false);
    assert.equal(second.reason, "no fence for this product");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeAmbientFence throws TypeError on missing or invalid required arguments", () => {
  assert.throws(() => removeAmbientFence({ productName: "alpha" }), TypeError);
  assert.throws(() => removeAmbientFence({ targetPath: "/tmp/x.md" }), TypeError);
  assert.throws(() => removeAmbientFence({ targetPath: "", productName: "alpha" }), TypeError);
  assert.throws(() => removeAmbientFence({ targetPath: "/tmp/x.md", productName: "evil name" }), TypeError);
});

test("removeAmbientFence refuses to splice unbalanced markers (adv-002 parity, Phase 4 P0)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-remove-unbal-"));
  try {
    const target = path.join(dir, "CLAUDE.md");
    // 2 BEGIN markers + 1 END marker — a real file would get this from a
    // copy-pasted documentation example or a prior failed write. A naive
    // splice would lazy-match the FIRST BEGIN through the lone END,
    // silently deleting user prose between them.
    fs.writeFileSync(
      target,
      "<!-- nexel:alpha:begin -->\nfake-fence-1\n<!-- nexel:alpha:end -->\n\nuser prose\n\n<!-- nexel:alpha:begin -->\nfake-fence-2\n",
      "utf8",
    );
    assert.throws(
      () => removeAmbientFence({ targetPath: target, productName: "alpha" }),
      /unbalanced fence markers.*2 BEGIN, 1 END/,
    );
    // Original file unchanged
    const after = fs.readFileSync(target, "utf8");
    assert.match(after, /<!-- nexel:alpha:begin -->\nfake-fence-1/);
    assert.match(after, /user prose/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeAmbientFence refuses to splice fence missing managed-header sentinel (P1#6 parity, Phase 4 P0)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-remove-untrusted-"));
  try {
    const target = path.join(dir, "CLAUDE.md");
    // User prose that happens to contain the literal begin/end marker
    // strings (e.g., copy-pasted from a docs example showing what nexel
    // writes) but WITHOUT the managed-header sentinel. writeAmbientFence
    // refuses to overwrite such a pair on the write side; remove must
    // refuse symmetrically to avoid silently deleting user prose.
    const untrusted =
      "<!-- nexel:alpha:begin -->\n" +
      "User prose explaining what nexel writes. No managed-header sentinel here.\n" +
      "<!-- nexel:alpha:end -->\n";
    fs.writeFileSync(target, untrusted, "utf8");
    assert.throws(
      () => removeAmbientFence({ targetPath: target, productName: "alpha" }),
      /missing the managed-header sentinel/,
    );
    // Original file unchanged
    assert.equal(fs.readFileSync(target, "utf8"), untrusted);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeAmbientFence: byte-exact post-remove preserves other-product fences (Phase 4 P2)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexel-remove-byte-exact-"));
  try {
    const target = path.join(dir, "CLAUDE.md");
    // Use writeAmbientFence to create two trusted fences side by side, so
    // the managed-header sentinel is present and the byte-exact baseline
    // can be captured.
    writeAmbientFence({ targetPath: target, productName: "alpha", contentBlock: "alpha-body" });
    writeAmbientFence({ targetPath: target, productName: "beta", contentBlock: "beta-body" });
    const withBoth = fs.readFileSync(target, "utf8");
    // Capture the byte-exact baseline of beta-only by writing it to a
    // separate file and asserting equality after we remove alpha from the
    // both-fences file.
    const alphaFenceBlock =
      "<!-- nexel:alpha:begin -->\n" +
      "<!-- nexel-managed-fence v1; do not edit between markers -->\n" +
      "alpha-body\n" +
      "<!-- nexel:alpha:end -->\n";
    assert.ok(withBoth.includes(alphaFenceBlock), "fixture sanity: alpha fence as written");

    removeAmbientFence({ targetPath: target, productName: "alpha" });
    const after = fs.readFileSync(target, "utf8");

    // Beta fence preserved verbatim (block + sentinel)
    const betaFenceBlock =
      "<!-- nexel:beta:begin -->\n" +
      "<!-- nexel-managed-fence v1; do not edit between markers -->\n" +
      "beta-body\n" +
      "<!-- nexel:beta:end -->\n";
    assert.ok(after.includes(betaFenceBlock), "beta fence must survive byte-identical");
    // Alpha fully gone
    assert.ok(!after.includes("<!-- nexel:alpha:begin -->"), "alpha begin marker removed");
    assert.ok(!after.includes("alpha-body"), "alpha body removed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
