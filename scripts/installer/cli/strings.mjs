// Central catalog of user-facing strings — the i18n seam.
//
// Every user-visible piece of text routed through this module gains two
// properties for free:
//   1. A single grep point for terminology / spelling reviews.
//   2. A future plug-in for locale switching (the downstream product can
//      pass its own catalog to override en defaults — without forking
//      any kernel module).
//
// v0.1.0 coverage:
//   - help text (full)
//   - run.mjs success / blocked messages (full)
//   - error-format.mjs short envelopes (full)
//   - prompts.mjs / adapters' CLI-install instructions are NOT yet routed
//     through here; they live where they're used. Migration to this
//     catalog is part of v0.2.0+ work.
//
// Catalog shape:
//   strings.<namespace>.<key> = (params) => "rendered string"
//   Every key is a function (even when it takes no params) so that
//   downstream catalogs can substitute richer logic without changing
//   the call sites.

export const strings = Object.freeze({
  help: Object.freeze({
    header: ({ binName, version }) => `${binName} v${version} — managed installer`,
    usage: ({ binName }) => `Usage:\n  ${binName} <verb> [flags]`,

    verbsBlock: () => `Verbs:
  install                    Install selected skills/bundles into a target agent home
  uninstall                  Remove managed files for selections (state-aware)
  update                     Refresh managed files whose source has changed (hash-checked)
  list                       List manifest assets and (optional) installed status
  plan                       Show install plan without writing (--dry-run alias)
  agents                     Detect supported agent targets and writable status
  doctor                     Health-check installer environment per agent (CLI, target, state, drift, locks)
  repair                     Reconcile state.json against disk (default: scan only; --apply to fix)
  export                     Dump installed selection set as JSON to stdout (portable across machines)
  import                     Read selection-set JSON from stdin and install (pair with export)
  validate <path/SKILL.md>   Lint a single SKILL.md frontmatter without scanning the whole repo
  help                       Show this message`,

    flagsBlock: ({ adapterList, envProfile, envBannerTitle, binName }) => `Common flags:
  --agent, -a <id>           Target agent: ${adapterList}
                             Repeat or comma-separate to install to multiple agents in one run
                             (e.g. -a codex -a claude-code OR --agent=codex,claude-code)
  --target <path>            Explicit target root (overrides --agent default; single-agent only)
  --profile <name>           Append .<name> suffix to target root (sandbox/devbox isolation).
                             Also reads ${envProfile} env var. Allowed: [A-Za-z0-9_-]{1,32}.
                             Ignored when --target is provided. Example: codex + --profile dev
                             → ~/.codex.dev/ (fully isolated state + skill tree)
  --allow-no-cli             Skip CLI binary detection check (advanced; portable installs)
  --no-banner                Hide ASCII intro banner (interactive flow only)
  --banner-title <text>      Override interactive banner title (env: ${envBannerTitle})
  --skill, -s <ids...>       Skill ids (repeat or comma-separate)
  --bundle, -b <ids...>      Bundle ids (manifest-defined; see 'list')
  --all                      Expand to all installable standalone skills
  --mode <plugin|direct>     Install mode (default: direct)
  --dry-run                  Preview plan without writing
  --yes, -y                  Skip interactive prompts (required for non-interactive install/uninstall)
  --overwrite                Replace unmanaged files at target paths (install)
  --apply                    (repair) Actually perform the repair (default is scan-only / read-only)
  --force                    Bypass hash check for uninstall (use with --accept-modified)
  --accept-modified <relPath...>
                             Per-file consent for --force uninstall
  --json                     Machine-readable output
  --print-path <id>          (agents) Print just the target root path for the named agent
                             (script-friendly: cd "\$(${binName} agents --print-path codex)")
  -h, --help                 Show help`,

    examplesBlock: ({ binName, prefix }) => `Examples:
  ${binName} agents
  ${binName} list --agent codex
  ${binName} plan --agent claude-code --bundle <bundle-id>
  ${binName} install --agent codex --skill ${prefix}:<skill-id> -y
  ${binName} uninstall --agent codex --skill ${prefix}:<skill-id> -y`,
  }),

  errors: Object.freeze({
    code: ({ code, message }) => `error[${code}]: ${message}`,
    plain: ({ message }) => `error: ${message}`,
    pluginInstructions: ({ message, instructions }) => `error: ${message}\n\n${instructions}`,
    cancelled: ({ stage }) => `cancelled at ${stage}`,
    fatal: ({ detail }) => `fatal: ${detail}`,
  }),

  run: Object.freeze({
    listLegend: () => "Legend: [I]=installed [ ]=installable [-]=repo-only",
    listSkillsHeader: ({ count }) => `Skills (${count}):`,
    listBundlesHeader: ({ count }) => `Bundles (${count}):`,
    listTarget: ({ targetRoot, managed }) => `Target: ${targetRoot} (${managed ? "managed" : "no managed state"})`,

    agentsHeader: () => "Detected agent targets:",
    agentsNoCli: () => "ERROR: no agent CLI detected on this machine. Install at least one of (claude / codex / opencode) before running 'install'.",
    agentsUnknown: ({ id }) => `error: unknown agent id: ${id}`,

    validateUsage: ({ binName }) => `error: validate requires a SKILL.md path\nusage: ${binName} validate <path/to/SKILL.md>`,
    validateFileMissing: ({ target }) => `error: file not found: ${target}`,
    validateNotSkillMd: ({ basename }) => `note: file is not named SKILL.md (got: ${basename}); proceeding anyway`,
    validateOk: ({ target, dirname }) => `OK ${target} (validated as dirname=${dirname})`,
    validateFail: ({ target, dirname }) => `FAIL ${target} (validated as dirname=${dirname}):`,
    validateFinding: ({ severity, message }) => `  [${severity}] ${message}`,

    importStdinEmpty: ({ binName }) => `error: import expects JSON envelope on stdin\nusage: ... export ... | ${binName} import --agent <id>`,
    importParseError: ({ message }) => `error: failed to parse envelope JSON: ${message}`,
    importBlocked: ({ reason, message }) => `import blocked (${reason}): ${message || ""}`,
    importSuccess: ({ writtenCount, skippedCount }) => `imported: ${writtenCount} file(s) written, ${skippedCount} skipped`,
    importAlreadyInstalled: ({ count }) => `already installed (skipped): ${count}`,

    installScriptingNote: () => "note: pass --yes to suppress this notice when scripting",
    installMultiTargetConflict: () => "error: --target cannot be combined with multiple --agent values",
    installBlocked: ({ reason, message }) => `install blocked (${reason}): ${message || ""}`,
    installConflict: ({ relPath, reason }) => `  - ${relPath}: ${reason}`,
    installSuccess: ({ writtenCount, skippedCount, skipNote }) => `installed: ${writtenCount} file(s) written, ${skippedCount} skipped${skipNote}`,
    installAlreadyInstalled: ({ count }) => `skipped (already installed, use 'update' to refresh): ${count}`,
    installAlreadyInstalledItem: ({ id }) => `  - ${id}`,
    installHintsHeader: () => "\nPost-install hints (from manifest, descriptive only — no shell run):",
    installHint: ({ selectionId, hint }) => `  ${selectionId}: ${hint}`,
    installMultiSummary: ({ okCount, failCount, targetCount }) => `multi-agent install: ${okCount} ok, ${failCount} failed (${targetCount} target(s))`,
    installMultiOk: ({ adapterId, writtenCount, skipNote }) => `  ✓ ${adapterId}: ${writtenCount} file(s) written${skipNote}`,
    installMultiFail: ({ adapterId, code, msg }) => `  ✗ ${adapterId}: ${code} — ${msg}`,

    uninstallBlocked: ({ reason }) => `uninstall blocked (${reason})`,
    uninstallBlockedSelection: ({ selectionId }) => `  ${selectionId}:`,
    uninstallBlockedModified: ({ relPath }) => `    modified: ${relPath}`,
    uninstallBlockedMissing: ({ relPath }) => `    missing on disk: ${relPath}`,
    uninstallForceHint: () => "Pass --force --accept-modified <relPath> per modified file to bypass.",
    uninstallDryRun: ({ count }) => `would delete ${count} file(s):`,
    uninstallDryRunItem: ({ relPath }) => `  - ${relPath}`,
    uninstallSuccess: ({ count }) => `uninstalled: ${count} file(s) removed`,
    uninstallMultiSummary: ({ okCount, failCount, targetCount }) => `multi-agent uninstall: ${okCount} ok, ${failCount} failed (${targetCount} target(s))`,
    uninstallMultiOk: ({ adapterId, deletedCount }) => `  ✓ ${adapterId}: ${deletedCount} file(s) removed`,

    updateBlocked: ({ reason }) => `update blocked (${reason})`,
    updateBlockedModified: ({ relPath, recorded, onDisk }) => `  modified: ${relPath} (recorded=${recorded?.slice(0, 12)}…, onDisk=${onDisk?.slice(0, 12)}…)`,
    updateForceHint: () => "Pass --force --accept-modified <relPath> per modified file to overwrite.",
    updateDryRunHeader: ({ candidateCount, upToDateCount, sourceMissingCount }) => `update plan: ${candidateCount} file(s) to update, ${upToDateCount} up to date, ${sourceMissingCount} source missing`,
    updateDryRunCandidate: ({ relPath, oldSha, newSha, tamperedFlag }) => `  ~ ${relPath}: ${oldSha.slice(0, 12)}… -> ${newSha.slice(0, 12)}…${tamperedFlag}`,
    updateUpToDate: ({ message }) => `update: ${message}`,
    updateSuccess: ({ updatedCount, sourceCommit }) => `updated: ${updatedCount} file(s) refreshed (sourceCommit=${sourceCommit})`,
    updateSuccessItem: ({ relPath }) => `  ~ ${relPath}`,
    updateMultiSummary: ({ okCount, failCount, targetCount }) => `multi-agent update: ${okCount} ok, ${failCount} failed (${targetCount} target(s))`,
    updateMultiDryRun: ({ adapterId, candidateCount, upToDateCount }) => `  ✓ ${adapterId}: ${candidateCount} file(s) to update, ${upToDateCount} up to date`,
    updateMultiUpToDate: ({ adapterId }) => `  ✓ ${adapterId}: up to date`,
    updateMultiOk: ({ adapterId, updatedCount }) => `  ✓ ${adapterId}: ${updatedCount} file(s) refreshed`,

    repairScanHeader: () => "repair scan (read-only — pass --apply to fix):",
    repairScanCounts: ({ managedFileCount, missingCount, tamperedCount, sourceMissingCount }) => `  managed files: ${managedFileCount}\n  missing on disk: ${missingCount}\n  tampered: ${tamperedCount}\n  source missing in repo: ${sourceMissingCount}`,
    repairMissingHeader: () => "\nMissing files (would be re-copied from source with --apply):",
    repairMissingItem: ({ relPath, sourceNote }) => `  - ${relPath}  [${sourceNote}]`,
    repairTamperedHeader: () => "\nTampered files (need --apply --accept-modified <relPath> per file):",
    repairTamperedItem: ({ relPath }) => `  ~ ${relPath}`,
    repairFailed: ({ message }) => `repair failed (${message})`,
    repairRecopiedHeader: ({ count }) => `repair: ${count} file(s) recopied`,
    repairRecopiedItem: ({ relPath }) => `  ~ ${relPath}`,
    repairSkippedTampered: ({ count }) => `; ${count} tampered skipped (no --accept-modified)`,
    repairSourceMissing: ({ count }) => `; ${count} source-missing (cannot repair, uninstall the selection)`,

    doctorSummary: ({ okCount, failCount, reportCount }) => `doctor: ${okCount} ok, ${failCount} failed (${reportCount} adapter(s) checked)`,
    doctorAdapterHeader: ({ sym, displayName, adapterId }) => `${sym} ${displayName} (${adapterId})`,
    doctorTargetLine: ({ targetRoot }) => `  target: ${targetRoot}`,
    doctorCheckLine: ({ sym, name, detail }) => `${sym} ${name}: ${detail}`,

    planTargetHeader: ({ targetRoot, text }) => `Target: ${targetRoot}\n\n${text}`,
  }),
});
