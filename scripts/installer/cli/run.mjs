// CLI verb handlers (the runX functions). Each function:
//   - takes parsed args + a ctx object { repoRoot, version, productConfig }
//   - dispatches to kernel commands (install / list / agents / ...)
//   - formats the result for stdout (text or JSON per args.json)
//
// These were inlined in the original thin bin (the legacy product fixture)
// pre-skillctl. Lifting them into the kernel lets downstream products
// (incl. examples/sample-product/) share the same dispatch surface while
// supplying their own productConfig.
//
// Behavior is preserved byte-for-byte from the legacy bin — message
// strings, exit codes, and JSON shapes are untouched. The i18n seam
// (task #20) will later route the literal text through cli/strings.mjs.

import fs from "node:fs";
import path from "node:path";

import {
  install,
  installMulti,
  uninstall,
  uninstallMulti,
  update,
  updateMulti,
  repair,
  exportCommand,
  importCommand,
  listCommand,
  agentsCommand,
  doctorCommand,
  planCommandText,
  CommandError,
} from "./commands/index.mjs";
import { formatPlanText } from "../core/plan.mjs";
import { formatSkipNote } from "./error-format.mjs";
import { strings } from "./strings.mjs";

/**
 * Resolve user-supplied --skill / --bundle / --all selections into a
 * concrete list of selection ids.
 *
 * @param {Object} args
 * @param {Object} ctx
 * @param {string} ctx.repoRoot
 * @returns {Promise<string[]>}
 */
export async function resolveSelections(args, ctx) {
  const ids = [...args.selectionIds];
  if (args.all) {
    const list = listCommand({ repoRoot: ctx.repoRoot, productConfig: ctx.productConfig });
    for (const s of list.skills) {
      if (s.installable && s.profile === "standalone") ids.push(s.id);
    }
  }
  if (ids.length === 0) {
    throw new CommandError("at least one --skill or --bundle (or --all) required", "ERR_NO_SELECTION");
  }
  return [...new Set(ids)];
}

export async function runList(args, ctx) {
  const out = listCommand({ repoRoot: ctx.repoRoot, adapterId: args.adapter, target: args.target, productConfig: ctx.productConfig });
  if (args.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }
  process.stdout.write(strings.run.listSkillsHeader({ count: out.skills.length }) + "\n");
  for (const s of out.skills) {
    const flag = s.installed ? "[I]" : s.installable ? "[ ]" : "[-]";
    process.stdout.write(`  ${flag} ${s.id}  (${s.profile}, ${s.category})\n`);
  }
  process.stdout.write("\n" + strings.run.listBundlesHeader({ count: out.bundles.length }) + "\n");
  for (const b of out.bundles) {
    process.stdout.write(`  - ${b.id}: ${b.skills} skill(s), ${b.agents} agent(s), ${b.rules} rule(s) — ${b.description}\n`);
  }
  if (out.targetRoot) process.stdout.write("\n" + strings.run.listTarget({ targetRoot: out.targetRoot, managed: out.hasState }) + "\n");
  process.stdout.write("\n" + strings.run.listLegend() + "\n");
}

export async function runAgents(args, ctx) {
  const out = agentsCommand({ repoRoot: ctx.repoRoot });

  // --print-path <id> short-circuits: emit just the targetRoot for the named agent.
  if (args.printPath) {
    const a = out.adapters.find((x) => x.id === args.printPath);
    if (!a) {
      process.stderr.write(strings.run.agentsUnknown({ id: args.printPath }) + "\n");
      process.exit(2);
    }
    process.stdout.write(`${a.targetRoot}\n`);
    return;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }
  process.stdout.write(strings.run.agentsHeader() + "\n");
  let anyCli = false;
  for (const a of out.adapters) {
    const direct = a.supportsDirect ? "yes" : "no";
    const present = a.exists ? "found" : "absent";
    const writable = a.writable ? "writable" : "not writable";
    const cli = a.cliPresent ? "cli=yes" : "cli=NOT FOUND";
    if (a.cliPresent) anyCli = true;
    process.stdout.write(`  - ${a.id}: ${a.targetRoot} (${present}, ${writable}, direct=${direct}, ${cli})\n`);
    if (!a.cliPresent) {
      process.stdout.write(`      ⚠ ${a.displayName} CLI ('${a.cliBinary}') not in PATH. Install: ${a.cliInstallUrl}\n`);
    }
    if (a.notes) process.stdout.write(`      ${a.notes}\n`);
  }
  if (!anyCli) {
    process.stderr.write("\n" + strings.run.agentsNoCli() + "\n");
    process.exitCode = 2;
  }
}

export async function runValidate(args, ctx) {
  const { extractFrontmatter, validateSkill } = await import("../../lint-skills.mjs");
  if (args.positional.length === 0) {
    const bin = ctx.productConfig?.binName ?? "installer";
    process.stderr.write(strings.run.validateUsage({ binName: bin }) + "\n");
    process.exit(2);
  }
  const target = path.resolve(args.positional[0]);
  if (!fs.existsSync(target)) {
    process.stderr.write(strings.run.validateFileMissing({ target }) + "\n");
    process.exit(2);
  }
  if (path.basename(target) !== "SKILL.md") {
    process.stderr.write(strings.run.validateNotSkillMd({ basename: path.basename(target) }) + "\n");
  }
  const dirname = path.basename(path.dirname(target));
  const raw = fs.readFileSync(target, "utf8");
  const fm = extractFrontmatter(raw);
  const findings = validateSkill(dirname, fm);

  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: findings.length === 0, target, dirname, findings }, null, 2) + "\n");
    process.exit(findings.length === 0 ? 0 : 1);
  }
  if (findings.length === 0) {
    process.stdout.write(strings.run.validateOk({ target, dirname }) + "\n");
    return;
  }
  process.stderr.write(strings.run.validateFail({ target, dirname }) + "\n");
  for (const f of findings) {
    process.stderr.write(`  [${f.severity}] ${f.message}\n`);
  }
  process.exit(1);
}

export async function runExport(args, ctx) {
  const envelope = exportCommand({
    repoRoot: ctx.repoRoot,
    adapterId: args.adapter,
    target: args.target,
    productConfig: ctx.productConfig,
  });
  // Always emit JSON — export is a machine-to-machine format. --json is a no-op.
  process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
}

export async function runImport(args, ctx) {
  // Read envelope from stdin (script-friendly pipe usage)
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    const bin = ctx.productConfig?.binName ?? "installer";
    process.stderr.write("error: import expects JSON envelope on stdin\n");
    process.stderr.write(`usage: ... export ... | ${bin} import --agent <id>\n`);
    process.exit(2);
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`error: failed to parse envelope JSON: ${e.message}\n`);
    process.exit(2);
  }
  const result = await importCommand({
    repoRoot: ctx.repoRoot,
    adapterId: args.adapter,
    target: args.target,
    envelope,
    installerVersion: ctx.version,
    dryRun: args.dryRun,
    overwriteUnmanaged: args.overwrite,
    allowNoCli: args.allowNoCli,
    productConfig: ctx.productConfig,
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (!result.ok) {
    process.stderr.write(`import blocked (${result.reason}): ${result.message || ""}\n`);
    process.exit(1);
  }
  if (result.dryRun) {
    process.stdout.write(formatPlanText(result.plan) + "\n");
    return;
  }
  process.stdout.write(`imported: ${result.writtenCount} file(s) written, ${result.skippedCount} skipped\n`);
  if (result.alreadyInstalled?.length) {
    process.stdout.write(`already installed (skipped): ${result.alreadyInstalled.length}\n`);
  }
}

export async function runRepair(args, ctx) {
  const result = await repair({
    repoRoot: ctx.repoRoot,
    adapterId: args.adapter,
    target: args.target,
    apply: args.apply,
    acceptModified: args.acceptModified,
    installerVersion: ctx.version,
    productConfig: ctx.productConfig,
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(0);
  }
  // Scan-only mode (default — no --apply)
  if (!args.apply) {
    const sum = result.summary;
    process.stdout.write(`repair scan (read-only — pass --apply to fix):\n`);
    process.stdout.write(`  managed files: ${sum.managedFileCount}\n`);
    process.stdout.write(`  missing on disk: ${sum.missingCount}\n`);
    process.stdout.write(`  tampered: ${sum.tamperedCount}\n`);
    process.stdout.write(`  source missing in repo: ${sum.sourceMissingCount}\n`);
    if (sum.missingCount > 0) {
      process.stdout.write("\nMissing files (would be re-copied from source with --apply):\n");
      for (const m of result.missing) {
        const note = m.sourceExists ? "source present, repairable" : "source MISSING — uninstall instead";
        process.stdout.write(`  - ${m.relPath}  [${note}]\n`);
      }
    }
    if (sum.tamperedCount > 0) {
      process.stdout.write("\nTampered files (need --apply --accept-modified <relPath> per file):\n");
      for (const m of result.tampered) {
        process.stdout.write(`  ~ ${m.relPath}\n`);
      }
    }
    process.exit(result.ok ? 0 : 1);
  }
  // Apply mode
  if (!result.ok) {
    process.stderr.write(`repair failed (${result.message || "unknown"})\n`);
    process.exit(1);
  }
  process.stdout.write(`repair: ${result.recopied.length} file(s) recopied`);
  if (result.skippedTampered.length > 0) {
    process.stdout.write(`; ${result.skippedTampered.length} tampered skipped (no --accept-modified)`);
  }
  if (result.sourceMissing.length > 0) {
    process.stdout.write(`; ${result.sourceMissing.length} source-missing (cannot repair, uninstall the selection)`);
  }
  process.stdout.write("\n");
  for (const r of result.recopied) process.stdout.write(`  ~ ${r}\n`);
}

export async function runDoctor(args, ctx) {
  const out = doctorCommand({ repoRoot: ctx.repoRoot, adapterId: args.adapter });
  if (args.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    process.exit(out.failCount > 0 ? 1 : 0);
  }
  process.stdout.write(`doctor: ${out.okCount} ok, ${out.failCount} failed (${out.reports.length} adapter(s) checked)\n\n`);
  for (const r of out.reports) {
    const headSym = r.ok ? "✓" : "✗";
    process.stdout.write(`${headSym} ${r.displayName} (${r.adapterId})\n`);
    process.stdout.write(`  target: ${r.targetRoot}\n`);
    for (const c of r.checks) {
      const sym = c.ok ? "  ✓" : "  ✗";
      process.stdout.write(`${sym} ${c.name}: ${c.detail}\n`);
    }
    process.stdout.write("\n");
  }
  process.exit(out.failCount > 0 ? 1 : 0);
}

export async function runPlan(args, ctx) {
  const ids = await resolveSelections(args, ctx);
  const result = await planCommandText({
    repoRoot: ctx.repoRoot,
    adapterId: args.adapter,
    target: args.target,
    selectionIds: ids,
    productConfig: ctx.productConfig,
  });
  if (args.json) {
    process.stdout.write(JSON.stringify({ targetRoot: result.targetRoot, plan: result.plan }, null, 2) + "\n");
    return;
  }
  process.stdout.write(`Target: ${result.targetRoot}\n\n${result.text}\n`);
}

export async function runInstall(args, ctx) {
  if (!args.yes && !args.dryRun && process.stdout.isTTY) {
    process.stderr.write("note: pass --yes to suppress this notice when scripting\n");
  }
  const ids = await resolveSelections(args, ctx);

  if (args.adapters.length > 1) {
    if (args.target) {
      process.stderr.write("error: --target cannot be combined with multiple --agent values\n");
      process.exit(2);
    }
    const multi = await installMulti({
      repoRoot: ctx.repoRoot,
      adapterIds: args.adapters,
      selectionIds: ids,
      installerVersion: ctx.version,
      installMode: args.mode,
      dryRun: args.dryRun,
      overwriteUnmanaged: args.overwrite,
      allowNoCli: args.allowNoCli,
      requestedBy: "cli",
      productConfig: ctx.productConfig,
    });
    if (args.json) {
      process.stdout.write(JSON.stringify(multi, null, 2) + "\n");
      process.exit(multi.failCount > 0 ? 1 : 0);
    }
    process.stdout.write(`multi-agent install: ${multi.okCount} ok, ${multi.failCount} failed (${multi.adapterIds.length} target(s))\n`);
    for (const r of multi.results) {
      if (r.ok) {
        const wc = r.result.writtenCount ?? "n/a";
        process.stdout.write(`  ✓ ${r.adapterId}: ${wc} file(s) written${formatSkipNote(r.result?.plan)}\n`);
      } else {
        const code = r.error?.code || r.result?.reason || "unknown";
        const msg = r.error?.message || r.result?.message || "";
        process.stdout.write(`  ✗ ${r.adapterId}: ${code} — ${msg}\n`);
      }
    }
    process.exit(multi.failCount > 0 ? 1 : 0);
  }

  const result = await install({
    repoRoot: ctx.repoRoot,
    adapterId: args.adapter,
    target: args.target,
    selectionIds: ids,
    installerVersion: ctx.version,
    installMode: args.mode,
    dryRun: args.dryRun,
    overwriteUnmanaged: args.overwrite,
    allowNoCli: args.allowNoCli,
    requestedBy: "cli",
    productConfig: ctx.productConfig,
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (!result.ok) {
    process.stderr.write(`install blocked (${result.reason}): ${result.message || ""}\n`);
    if (result.conflicts) {
      for (const c of result.conflicts) process.stderr.write(`  - ${c.relPath}: ${c.reason}\n`);
    }
    process.exit(1);
  }
  if (result.dryRun) {
    process.stdout.write(formatPlanText(result.plan) + "\n");
    return;
  }
  process.stdout.write(`installed: ${result.writtenCount} file(s) written, ${result.skippedCount} skipped${formatSkipNote(result.plan)}\n`);
  if (result.alreadyInstalled?.length) {
    process.stdout.write(`skipped (already installed, use 'update' to refresh): ${result.alreadyInstalled.length}\n`);
    for (const sid of result.alreadyInstalled) process.stdout.write(`  - ${sid}\n`);
  }
  if (result.postInstallHints?.length) {
    process.stdout.write(`\nPost-install hints (from manifest, descriptive only — no shell run):\n`);
    for (const h of result.postInstallHints) {
      process.stdout.write(`  ${h.selectionId}: ${h.hint}\n`);
    }
  }
}

export async function runUninstall(args, ctx) {
  if (!args.yes && process.stdout.isTTY) {
    process.stderr.write("note: pass --yes to suppress this notice when scripting\n");
  }
  const ids = await resolveSelections(args, ctx);

  if (args.adapters.length > 1) {
    if (args.target) {
      process.stderr.write("error: --target cannot be combined with multiple --agent values\n");
      process.exit(2);
    }
    const multi = await uninstallMulti({
      repoRoot: ctx.repoRoot,
      adapterIds: args.adapters,
      selectionIds: ids,
      installerVersion: ctx.version,
      force: args.force,
      acceptModified: args.acceptModified,
      dryRun: args.dryRun,
      productConfig: ctx.productConfig,
    });
    if (args.json) {
      process.stdout.write(JSON.stringify(multi, null, 2) + "\n");
      process.exit(multi.failCount > 0 ? 1 : 0);
    }
    process.stdout.write(`multi-agent uninstall: ${multi.okCount} ok, ${multi.failCount} failed (${multi.adapterIds.length} target(s))\n`);
    for (const r of multi.results) {
      if (r.ok) {
        const dc = r.result?.toDelete?.length ?? 0;
        process.stdout.write(`  ✓ ${r.adapterId}: ${dc} file(s) removed\n`);
      } else {
        const code = r.error?.code || r.result?.reason || "unknown";
        const msg = r.error?.message || r.result?.message || "";
        process.stdout.write(`  ✗ ${r.adapterId}: ${code} — ${msg}\n`);
        for (const m of r.result?.blockedByModification || []) {
          process.stdout.write(`      modified: ${m.relPath}\n`);
        }
      }
    }
    process.exit(multi.failCount > 0 ? 1 : 0);
  }

  const result = await uninstall({
    repoRoot: ctx.repoRoot,
    adapterId: args.adapter,
    target: args.target,
    selectionIds: ids,
    installerVersion: ctx.version,
    force: args.force,
    acceptModified: args.acceptModified,
    dryRun: args.dryRun,
    productConfig: ctx.productConfig,
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (!result.ok) {
    process.stderr.write(`uninstall blocked (${result.reason})\n`);
    if (result.blockedSelections && result.blockedSelections.length > 1) {
      // Multi-selection: surface per-selection grouping for clarity
      for (const b of result.blockedSelections) {
        process.stderr.write(`  ${b.selectionId}:\n`);
        for (const m of b.blockedByModification) process.stderr.write(`    modified: ${m.relPath}\n`);
        for (const m of b.blockedByMissingHash) process.stderr.write(`    missing on disk: ${m}\n`);
      }
    } else {
      for (const m of result.blockedByModification || []) {
        process.stderr.write(`  modified: ${m.relPath}\n`);
      }
      for (const m of result.blockedByMissingHash || []) {
        process.stderr.write(`  missing on disk: ${m}\n`);
      }
    }
    process.stderr.write("Pass --force --accept-modified <relPath> per modified file to bypass.\n");
    process.exit(1);
  }
  if (result.dryRun) {
    process.stdout.write(`would delete ${result.toDelete.length} file(s):\n`);
    for (const r of result.toDelete) process.stdout.write(`  - ${r}\n`);
    return;
  }
  process.stdout.write(`uninstalled: ${result.toDelete.length} file(s) removed\n`);
}

export async function runUpdate(args, ctx) {
  if (args.adapters.length > 1) {
    if (args.target) {
      process.stderr.write("error: --target cannot be combined with multiple --agent values\n");
      process.exit(2);
    }
    const multi = await updateMulti({
      repoRoot: ctx.repoRoot,
      adapterIds: args.adapters,
      installerVersion: ctx.version,
      force: args.force,
      acceptModified: args.acceptModified,
      dryRun: args.dryRun,
      productConfig: ctx.productConfig,
    });
    if (args.json) {
      process.stdout.write(JSON.stringify(multi, null, 2) + "\n");
      process.exit(multi.failCount > 0 ? 1 : 0);
    }
    process.stdout.write(`multi-agent update: ${multi.okCount} ok, ${multi.failCount} failed (${multi.adapterIds.length} target(s))\n`);
    for (const r of multi.results) {
      if (r.ok) {
        if (r.result.dryRun) {
          process.stdout.write(`  ✓ ${r.adapterId}: ${r.result.candidates?.length ?? 0} file(s) to update, ${r.result.upToDateCount ?? 0} up to date\n`);
        } else if (r.result.updatedCount === 0) {
          process.stdout.write(`  ✓ ${r.adapterId}: up to date\n`);
        } else {
          process.stdout.write(`  ✓ ${r.adapterId}: ${r.result.updatedCount} file(s) refreshed\n`);
        }
      } else {
        const code = r.error?.code || r.result?.reason || "unknown";
        const msg = r.error?.message || r.result?.message || "";
        process.stdout.write(`  ✗ ${r.adapterId}: ${code} — ${msg}\n`);
        for (const m of r.result?.blockedByModification || []) {
          process.stdout.write(`      modified: ${m.relPath}\n`);
        }
      }
    }
    process.exit(multi.failCount > 0 ? 1 : 0);
  }

  const result = await update({
    repoRoot: ctx.repoRoot,
    adapterId: args.adapter,
    target: args.target,
    installerVersion: ctx.version,
    force: args.force,
    acceptModified: args.acceptModified,
    dryRun: args.dryRun,
    productConfig: ctx.productConfig,
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (!result.ok) {
    process.stderr.write(`update blocked (${result.reason})\n`);
    for (const m of result.blockedByModification || []) {
      process.stderr.write(`  modified: ${m.relPath} (recorded=${m.recorded?.slice(0, 12)}…, onDisk=${m.onDisk?.slice(0, 12)}…)\n`);
    }
    process.stderr.write("Pass --force --accept-modified <relPath> per modified file to overwrite.\n");
    process.exit(1);
  }
  if (result.dryRun) {
    process.stdout.write(`update plan: ${result.candidates.length} file(s) to update, ${result.upToDateCount} up to date, ${result.sourceMissing.length} source missing\n`);
    for (const c of result.candidates) {
      const flag = c.tamperedOverridden ? " [tampered, --force-override]" : "";
      process.stdout.write(`  ~ ${c.relPath}: ${c.oldSha.slice(0, 12)}… -> ${c.newSha.slice(0, 12)}…${flag}\n`);
    }
    return;
  }
  if (result.updatedCount === 0) {
    process.stdout.write(`update: ${result.message || "all files up to date"}\n`);
    return;
  }
  process.stdout.write(`updated: ${result.updatedCount} file(s) refreshed (sourceCommit=${result.sourceCommit?.slice(0, 12) || "n/a"})\n`);
  for (const r of result.updated) process.stdout.write(`  ~ ${r}\n`);
}
