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
  help: Object.freeze({    header: ({ binName, version }) => `${binName} v${version} — 托管安装器`,
    usage: ({ binName }) => `用法:\n  ${binName} <verb> [flags]`,

    verbsBlock: () => `命令:
  install                    安装选定的 skills/bundles 到目标 agent home
  uninstall                  删除选定项的托管文件(感知 state)
  update                     刷新源文件已变化的托管文件(hash 校验)
  list                       列出 manifest 资产与可选安装状态
  plan                       展示安装计划但不写入(--dry-run alias)
  agents                     检测支持的 agent target 与可写状态
  doctor                     按 agent 检查安装环境(CLI、target、state、drift、locks)
  repair                     对齐 state.json 与磁盘(默认只扫描; --apply 修复)
  export                     将已安装选择集以 JSON 输出到 stdout
  import                     从 stdin 读取选择集 JSON 并安装(配合 export)
  activate                   将 ambient context fence 写入 CLAUDE.md / AGENTS.md
  deactivate                 从 CLAUDE.md / AGENTS.md 移除本产品的 ambient context fence
  validate <path/SKILL.md>   lint 单个 SKILL.md frontmatter,不扫描整个 repo
  scaffold                   按 ProductConfig 生成三平台 plugin 布局
                             (仅当 createCli({enablePluginScaffolder: true}))
  help                       显示此信息`,

    flagsBlock: ({ adapterList, envProfile, envBannerTitle, binName }) => `通用 flags:
  --agent, -a <id>           目标 agent: ${adapterList}
                             可重复或逗号分隔,一次安装到多个 agent
                             (e.g. -a codex -a claude-code OR --agent=codex,claude-code)
  --target <path>            显式 target root(覆盖 --agent 默认值;仅单 agent)
  --profile <name>           给 target root 追加 .<name> 后缀(sandbox/devbox 隔离).
                             也读取 ${envProfile} env var. 允许: [A-Za-z0-9_-]{1,32}.
                             提供 --target 时忽略. 示例: codex + --profile dev
                             → ~/.codex.dev/ (完全隔离的 state + skill tree)
  --lang <en|zh>             人类可读输出语言(env: NEXEL_LANG 或产品 env)
  --allow-no-cli             跳过 CLI binary 检测(高级;可移植安装)
  --no-banner                隐藏 ASCII intro banner(仅交互流程)
  --banner-title <text>      覆盖交互 banner 标题(env: ${envBannerTitle})
  --skill, -s <ids...>       Skill ids(可重复或逗号分隔)
  --bundle, -b <ids...>      Bundle ids(manifest 定义;见 'list')
  --all                      展开为全部可安装 standalone skills
  --mode <plugin|direct>     安装模式(默认: direct)
  --dry-run                  预览计划,不写入
  --yes, -y                  跳过交互确认(非交互 install/uninstall 必需)
  --overwrite                替换 target 路径上的非托管文件(install)
  --apply                    (repair) 实际执行修复(默认只扫描/只读)
  --force                    uninstall 时绕过 hash 检查(配合 --accept-modified)
  --accept-modified <relPath...>
                             对 --force uninstall 逐文件确认
  --json                     机器可读输出
  --print-path <id>          (agents) 只打印指定 agent 的 target root
                             (script-friendly: cd "\$(${binName} agents --print-path codex)")
  -h, --help                 显示帮助`,

    examplesBlock: ({ binName, prefix }) => `示例:
  ${binName} agents
  ${binName} list --agent codex
  ${binName} plan --agent claude-code --bundle <bundle-id>
  ${binName} install --agent codex --skill ${prefix}:<skill-id> -y
  ${binName} uninstall --agent codex --skill ${prefix}:<skill-id> -y`,

    // Per-verb usage blocks. Co-declared INSIDE this Object.freeze literal
    // (strings.help is frozen — a post-freeze strings.help.verb = … would
    // throw). Each key is a parameterized renderer per the catalog's
    // function-key contract: ({ binName, prefix, adapterList }) => string.
    // These render for `<verb> --help` and `help <verb>`; bare help / --help
    // still render the composed full body via printHelp. Intentionally a
    // verb-scoped flag subset, never the full table — the literal
    // "Common flags:" appears only in flagsBlock and must NOT leak here
    // (it is the full-vs-verb test discriminator).
    verb: Object.freeze({
      install: ({ binName, prefix, adapterList }) => `${binName} install — install selected skills/bundles into a target agent home

Usage:
  ${binName} install --agent <id> (--skill <ids…> | --bundle <ids…> | --all) [flags]

Flags:
  --agent, -a <id>      ${adapterList} (repeat or comma-separate for multi)
  --skill, -s <ids…>    skill ids (repeat or comma-separate)
  --bundle, -b <ids…>   bundle ids (manifest-defined; see 'list')
  --all                 all installable standalone skills
  --mode <plugin|direct>  install mode (default: direct)
  --target <path>       explicit target root (single-agent only)
  --overwrite           replace unmanaged files at target paths
  --allow-no-cli        skip agent-CLI detection
  --dry-run             preview plan, no writes
  --yes, -y             non-interactive (required for scripted install)
  --json                machine-readable output

Examples:
  ${binName} install --agent codex --skill ${prefix}:<skill-id> -y
  ${binName} install --agent=codex,claude-code --all -y

Run '${binName} help' for the complete reference.
`,
      uninstall: ({ binName, prefix, adapterList }) => `${binName} uninstall — remove managed files for selections (state-aware)

Usage:
  ${binName} uninstall --agent <id> (--skill <ids…> | --bundle <ids…>) [flags]

Flags:
  --agent, -a <id>      ${adapterList} (repeat or comma-separate for multi)
  --skill, -s <ids…>    skill ids
  --bundle, -b <ids…>   bundle ids
  --force               bypass hash check (requires --accept-modified)
  --accept-modified <relPath…>  per-file consent for --force
  --dry-run             list files that would be deleted, no writes
  --yes, -y             non-interactive (required for scripted uninstall)
  --json                machine-readable output

Hash protection: edited managed files block uninstall unless
--force --accept-modified <relPath> is given per edited file.

Example:
  ${binName} uninstall --agent codex --skill ${prefix}:<skill-id> -y

Run '${binName} help' for the complete reference.
`,
      update: ({ binName, adapterList }) => `${binName} update — refresh managed files whose source changed (hash-checked)

Usage:
  ${binName} update --agent <id> [flags]

Flags:
  --agent, -a <id>      ${adapterList} (repeat or comma-separate for multi)
  --dry-run             preview which files would be refreshed
  --force               overwrite locally-edited files (requires --accept-modified)
  --accept-modified <relPath…>  per-file consent for --force
  --json                machine-readable output

Only source-changed, locally-unedited files are refreshed. Edited files
block until explicitly accepted.

Example:
  ${binName} update --agent codex --dry-run

Run '${binName} help' for the complete reference.
`,
      list: ({ binName }) => `${binName} list — list manifest assets and installed status

Usage:
  ${binName} list [--agent <id>] [--json]

Flags:
  --agent, -a <id>      annotate with that agent's installed markers
  --json                machine-readable output

Legend: [I]=installed  [ ]=installable  [-]=repo-only

Run '${binName} help' for the complete reference.
`,
      plan: ({ binName }) => `${binName} plan — show the install plan without writing (--dry-run alias)

Usage:
  ${binName} plan --agent <id> (--skill <ids…> | --bundle <ids…>) [--json]

Flags:
  --agent, -a <id>      target agent
  --skill, -s <ids…>    skill ids
  --bundle, -b <ids…>   bundle ids
  --target <path>       explicit target root
  --json                machine-readable output (incl. sha256 + bytes)

Example:
  ${binName} plan --agent codex --bundle <bundle-id>

Run '${binName} help' for the complete reference.
`,
      agents: ({ binName }) => `${binName} agents — detect supported agent targets and writable status

Usage:
  ${binName} agents [--print-path <id>] [--json]

Flags:
  --print-path <id>     print only that agent's target root (script-friendly)
  --json                machine-readable output

Example:
  cd "$(${binName} agents --print-path codex)/skills"

Run '${binName} help' for the complete reference.
`,
      doctor: ({ binName }) => `${binName} doctor — health-check installer environment per agent

Usage:
  ${binName} doctor [--agent <id>] [--json]

Flags:
  --agent, -a <id>      check a single agent (default: all)
  --json                machine-readable output (exit 1 if any check fails)

Checks: CLI presence, target writability, state schema, drift, locks.

Run '${binName} help' for the complete reference.
`,
      repair: ({ binName }) => `${binName} repair — reconcile state.json against disk

Usage:
  ${binName} repair --agent <id> [--apply] [flags]

Flags:
  --agent, -a <id>      target agent
  --apply               actually perform the repair (default: scan-only / read-only)
  --accept-modified <relPath…>  allow recopy over a tampered file
  --json                machine-readable output

Default is a read-only scan. Pass --apply to re-copy missing files from source.

Run '${binName} help' for the complete reference.
`,
      export: ({ binName }) => `${binName} export — dump installed selection set as JSON to stdout

Usage:
  ${binName} export --agent <id> [--target <path>]

Flags:
  --agent, -a <id>      target agent
  --target <path>       explicit target root

Portable across machines. Pair with 'import':
  ${binName} export --agent codex > selections.json

Run '${binName} help' for the complete reference.
`,
      import: ({ binName }) => `${binName} import — read selection-set JSON from stdin and install

Usage:
  ${binName} export --agent <id> | ${binName} import --agent <id> [flags]

Flags:
  --agent, -a <id>      target agent
  --target <path>       explicit target root
  --dry-run             preview plan, no writes
  --overwrite           replace unmanaged files at target paths
  --json                machine-readable output

Reads the envelope on stdin (pipe 'export'). Files re-install from the
destination's repo manifest, not a frozen snapshot.

Run '${binName} help' for the complete reference.
`,
      scaffold: ({ binName }) => `${binName} scaffold — 按 ProductConfig 生成三平台 plugin 布局

用法:
  ${binName} scaffold [--target <path>] [--force] [--no-deps] [--json]

Flags:
  --target <path>       写入的目录(默认: cwd)
  --force               覆盖已存在文件(默认: 跳过)
  --no-deps             跳过下游 package.json runtime-dep 审计
  --json                机器可读 {written, skipped, warnings} envelope

生成六个文件: .claude-plugin/{plugin,marketplace}.json、
.codex-plugin/plugin.json、.agents/plugins/marketplace.json、
.opencode/INSTALL.md、.opencode/plugins/<pluginName>.js。
要求 productConfig.repositoryUrl,缺则 fail-loud。

如果 target 目录非空且无 package.json,拒绝写入 —— 防止 --target=$HOME 等误用。

仅当 createCli({enablePluginScaffolder: true}) 时可用。

运行 '${binName} help' 查看完整参考。
`,
      validate: ({ binName }) => `${binName} validate — lint a single SKILL.md frontmatter

Usage:
  ${binName} validate <path/to/SKILL.md> [--json]

Flags:
  --json                machine-readable output (exit 1 on findings)

Validates name, category enum, and non-empty description without
scanning the whole skills/ tree.

Example:
  ${binName} validate path/to/draft/SKILL.md

Run '${binName} help' for the complete reference.
`,
      activate: ({ binName }) => `${binName} activate — 将 ambient context fence 写入 CLAUDE.md / AGENTS.md

用法:
  ${binName} activate [--target <id>] [--scope user|project] [flags]

Flags:
  --agent, -a <id>      claude | codex | opencode (逗号分隔或重复)
                        默认: claude,codex。--agent=opencode 会被拒绝 ——
                        OpenCode 激活在 OpenCode 启动时通过 opencode-plugin
                        入口完成，不经此 verb。
                        --target 作 deprecated alias 保留 (v0.8.x compat)，
                        新脚本请用 --agent。
  --scope <user|project>  user → ~/.claude/CLAUDE.md + ~/.codex/AGENTS.md
                          project → ./CLAUDE.md + ./AGENTS.md (默认)
  --skills-dir <path>   覆盖 skills 目录 (默认: <productConfig.defaultSkillsDir>)
  --dry-run             按 adapter 报告 would-activate；不实际写文件
  --json                stdout 输出机器可读 envelope

JSON envelope 中每个 adapter 条目: { adapter, status, code?, details }。
状态值: activated | would-activate | refused | failed。

幂等：源不变时重跑产生字节相同的 fence 文件。
拒绝写入符号链接目标文件。

示例:
  ${binName} activate --scope=project --json
  ${binName} activate --target=claude --dry-run
  ${binName} activate --target=opencode    # exit 1 + ERR_ACTIVATE_OPENCODE_REFUSED

运行 '${binName} help' 查看完整参考。
`,
      deactivate: ({ binName }) => `${binName} deactivate — 从 CLAUDE.md / AGENTS.md 移除本产品的 ambient context fence

用法:
  ${binName} deactivate [--agent <id>] [--scope user|project] [flags]

Flags:
  --agent, -a <id>      claude | codex | opencode (逗号分隔或重复)
                        默认: claude,codex。--agent=opencode 会被拒绝 ——
                        OpenCode 生命周期由 opencode-plugin 运行时入口托管,
                        不经此 verb。
                        --target 作 deprecated alias 保留, 新脚本请用 --agent。
  --scope <user|project>  user → ~/.claude/CLAUDE.md + ~/.codex/AGENTS.md
                          project → ./CLAUDE.md + ./AGENTS.md (默认)
  --dry-run             按 adapter 报告 would-deactivate；不实际写文件
  --json                stdout 输出机器可读 envelope

JSON envelope 中每个 adapter 条目: { adapter, status, code?, details }。
状态值: deactivated | would-deactivate | refused | failed。

仅移除本产品写入的 fence (activate 的反向操作); 同一 host file 中其它产品的
fence 字节相同地保留。幂等: 第二次 deactivate 返回 { action: "noop",
changed: false }。拒绝写入符号链接目标文件。

示例:
  ${binName} deactivate --scope=project --json
  ${binName} deactivate --agent=claude --dry-run
  ${binName} deactivate --target=opencode    # exit 1 + ERR_DEACTIVATE_OPENCODE_REFUSED

运行 '${binName} help' 查看完整参考。
`,
    }),
  }),

  errors: Object.freeze({
    code: ({ code, message }) => `错误[${code}]: ${message}`,
    plain: ({ message }) => `错误: ${message}`,
    pluginInstructions: ({ message, instructions }) => `错误: ${message}\n\n${instructions}`,
    cancelled: ({ stage }) => `已取消: ${stage}`,
    fatal: ({ detail }) => `致命错误: ${detail}`,
  }),

  run: Object.freeze({
    listLegend: () => "图例: [I]=已安装 [ ]=可安装 [-]=repo-only",
    listSkillsHeader: ({ count }) => `Skills (${count}):`,
    listBundlesHeader: ({ count }) => `Bundles (${count}):`,
    listTarget: ({ targetRoot, managed }) => `Target: ${targetRoot} (${managed ? "managed" : "no managed state"})`,

    agentsHeader: () => "检测到的 agent targets:",
    agentsNoCli: () => "错误: 本机未检测到 agent CLI。运行 'install' 前至少安装一个(claude / codex / opencode)。",
    agentsUnknown: ({ id }) => `错误: unknown agent id: ${id}`,

    validateUsage: ({ binName }) => `错误: validate 需要 SKILL.md 路径\n用法: ${binName} validate <path/to/SKILL.md>`,
    validateFileMissing: ({ target }) => `错误: file not found: ${target}`,
    validateNotSkillMd: ({ basename }) => `注意: 文件名不是 SKILL.md (got: ${basename}); 继续处理`,
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
