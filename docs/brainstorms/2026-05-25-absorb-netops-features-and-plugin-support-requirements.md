---
date: 2026-05-25
topic: absorb-netops-features-and-plugin-support
---

# 吸收 netops 演化经验 & 补齐 plugin 安装支持

## Summary

v0.7 一次性吸收 netops 仓库分叉后演化出的 6 项 kernel-level 通用能力，分两束推进：kernel 韧性（state 健康检查、release-preflight 子检查、marketplace lockstep helper）与 plugin 安装支持（sample-product plugin layout 补全、ProductConfig 驱动的 plugin scaffolder、`pluginInstallInstructions()` 接 ProductConfig 渲染）。

---

## Problem Frame

`netops-agent-skills` 在 v0.5.1 与本仓库分叉。Netops 走"内部产品 + GitLab workflow"路线演化到 v0.15.0，期间多数提交是产品向，但有 6 项明确属于 product-agnostic kernel 的工程经验，nexel 尚未具备：

- Nexel `state.json` 残留 manifest 已退役 `selectionId` 时，下游 export/uninstall 路径会抛模糊错误而非可操作错误。
- Nexel `release-preflight` 缺少 runtime dependency 的 `engines.node` floor 与本仓库 `engines.node` 自洽校验，依赖升级时易引入静默 Node 兼容性回退。
- Nexel 已具备 `opencode-plugin.mjs` 运行时 helper、`pluginInstallInstructions()` SPI 占位文字、sample-product 的 `.opencode/plugins/sample-product.js`，但仓库根 `.claude-plugin/marketplace.json`、根 `.agents/plugins/marketplace.json`、sample-product 的 `.claude-plugin/plugin.json` 与 `.codex-plugin/plugin.json`、`package.json.main` 均缺席。下游产品要发 plugin 形态必须自己摸索 layout，没有可抄的范例，也没有跨平台版本一致性的契约测试工具。
- Nexel 没有"从 ProductConfig 一键生成三套 plugin 入口 + marketplace 元数据"的 scaffolder。下游手写三套 plugin.json 易漂移，与下面的 lockstep helper 没有锁形。
- Nexel 的 `pluginInstallInstructions()` 当前是占位文字串，无法渲染下游产品的真实 marketplace URL / plugin name / 配套 followup 命令。

六项动机同源（跨仓对比一次性发现）、互为前置（lockstep helper 需要 sample plugin layout 作为校验对象；scaffolder 与 lockstep helper 互锁），分批推进会丢失这层耦合。

---

## Requirements

**Kernel 韧性**

- R1. `cli/commands/index.mjs` 在所有读取 `state.json` 的命令路径（`export`、`uninstall`、`update`、`doctor` 等）前调用 `assertValidExistingState(state)`，使用现有 `state.mjs:validateState`，单条 finding 抛 `CommandError` 含 `ERR_STATE_INVALID`，错误消息携带 `path` 与 `message`。
- R2. 同上命令路径前调用 `assertStateSelectionsKnown(state, manifest)`，检测 `state.installations[].selectionId` 是否仍存在于 `manifest.skills` 或 `manifest.bundles`，未知 selectionId 抛 `CommandError` 含 `ERR_STATE_INVALID` 与 `{ unknownSelections: [...] }`，错误消息建议清理重装。
- R3. `release-preflight.mjs` 新增子检查项：读取 `package.json.dependencies` 与 `package-lock.json`，对每个 runtime dep 解析 `engines.node`，校验其 floor 不严于宿主 `package.json.engines.node`。任一不满足导致 preflight 失败，错误列出冲突 dep 与版本边界。

**Plugin 安装支持**

- R4. `examples/sample-product/` 补全三平台 plugin layout：
  - `.claude-plugin/plugin.json`（含 `name`、`version`、`description`、`skills`）
  - `.codex-plugin/plugin.json`（含同上字段 + `interface` 段）
  - `.opencode/INSTALL.md`（手写安装说明）
  - 仓库根目录提供：`.claude-plugin/marketplace.json`、`.agents/plugins/marketplace.json`（指向 sample-product 作为唯一 plugin entry，用 `local` source）
  - `package.json` 增加 `main` 字段指向 sample-product 的 OpenCode plugin entry，`files[]` 涵盖 plugin 打包目录
- R5. 公开 `verifyMarketplaceLockstep(specs)` 作为 kernel API（从 `scripts/installer/index.mjs` 导出），接受形如 `[{ path, expectedVersion }]` 的入参，校验所有指定 manifest 的 `version` 字段两两一致。Sample-product 添加一份契约测试调用该 helper，覆盖 R4 中的三套 plugin.json + 根 marketplace.json。
- R6. 新增 `scripts/installer/cli/commands/scaffold-plugin.mjs`（或同等位置），通过 `nexel scaffold plugin` 子命令调用，接受 ProductConfig 作为输入，生成 R4 中的三套 plugin.json + 根 marketplace.json + OpenCode plugin entry js（复用 `adapters/opencode-plugin.mjs` 作运行时）。已存在文件默认不覆盖，`--force` 覆盖。
- R7. `pluginInstallInstructions(productConfig)` SPI 签名变更：所有 adapter（`claude.mjs`、`codex.mjs`、`opencode.mjs`）的实现接受 ProductConfig 参数，返回的文字串内插真实 `productName`、marketplace URL、plugin name 与 followup 命令（不再硬编码 `<your-product-marketplace-url>` 占位）。`spi.mjs` `applyDefaults` 注入 identity 默认。更新 `adapters/spi.test.mjs` 覆盖新签名。

---

## Success Criteria

- 下游产品作者读 sample-product 即可复制完整 plugin 形态，无需查阅外部仓库。
- `nexel scaffold plugin` 从空目录的 ProductConfig 一次成功生成所有 plugin 元数据，运行 `verifyMarketplaceLockstep` 立即通过。
- `state.json` 含残留 selectionId 时，`uninstall` / `export` 路径给出包含 selectionId 列表与"清理重装"建议的可操作错误，而非堆栈或晦涩 `undefined` 错误。
- 引入 runtime dep 时若其 `engines.node` 严于宿主，`npm run release:preflight` 失败并指出冲突 dep。
- ce-plan 接手后无需补判任何 product-level 决策（命名、覆盖策略、SPI 签名都在本文档中定型）。

---

## Scope Boundaries

- 不吸收 netops 产品向资产：`gitlab-workflow` skill、autonomous mode skill、`closeout 交互门禁` skill、`publish-release.mjs`（GitLab API 直发）、`netops-lint-config.mjs`、`marketplace-contract.test.mjs` 中的 netops-specific 路径断言。
- 不引入新依赖（`@clack/prompts` / `figlet` / `proper-lockfile` / `write-file-atomic` 已具备）。
- 不实现 GitHub Release 自动化的修改 —— nexel 现有 GitHub Actions 路径不动。
- 不修改 `opencode-plugin.mjs` 运行时行为 —— scaffolder 复用现有实现。
- 不扩展 ASSET_TYPES。

---

## Key Decisions

- 六项 v0.7 一次性发：动机同源、互为前置；分批会丢上下文与契约耦合。
- scaffolder 入 kernel 而非留下游：三套 plugin.json 手写易漂移，scaffolder 与 lockstep helper 双向锁。
- `pluginInstallInstructions()` 接 ProductConfig 视作 SPI v1.1 → v1.2：签名变更需新版 SPI 号与 ADR 更新；同步影响 `adapters/spi.test.mjs` 的 `SPI_DEFAULTS` 与 `applyDefaults` 路径。
- sample-product 作为唯一 plugin 范例（不另起 `plugin-product/`）：避免与 `conformance-product/` 并列造成"范例之范例"的语义膨胀。
- sample-product plugin 的 `name` 字段使用 `sample-product`：与目录名 / `ProductConfig.productName` 一致，下游复制后单次全局 sed 即可 rename，语义中性。
- `nexel scaffold plugin` 注册到下游 bin 的 verb，kernel 出 `scaffoldPlugin(productConfig, opts)` 纯函数 + `dispatchScaffold(argv, ctx)` argv 适配器双导出。下游 bin 一行 wire 即可接入；nexel 保持 library-only 定位（无 `package.json.bin`）。Sample-product 的 `bin.mjs` 演示接入路径。

---

## Dependencies / Assumptions

- 假设 `state.mjs:validateState` 现有 finding 结构（`{ path, message }`）足以承载 R1 错误消息；若结构需扩展则在 plan 阶段补判。
- 假设 `package-lock.json` 始终随仓库提交，R3 可直接读 lock 文件解析 dep engines；若策略变化需调整。
- 假设 nexel `cli/argv.mjs` 与 `cli/dispatch.mjs` 已具备子命令注册扩展点，新增 `scaffold` verb 无需重构调度器。
- Sample-product plugin layout 一旦发布即为下游事实模板，命名 / 路径 / 字段顺序后续变更代价高 —— 触发 ADR。

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] `verifyMarketplaceLockstep` 是否同时校验 `name` / `source` 等其他字段，还是仅 `version`？倾向仅 `version`，其余留契约测试自行断言。
- [Affects R7][Technical] `pluginInstallInstructions` 的 marketplace URL 是从 ProductConfig 哪个字段读？需先确认 ProductConfig 是否已有 `marketplaceUrl` / `repositoryUrl` 等字段，无则在本变更中追加。
- [Affects R4, R6][Needs research] `.codex-plugin/plugin.json` 的 `interface` 段必填字段清单需查 Codex marketplace 当前规范，netops 实例非权威。
- [Affects R1, R2][Technical] 现有 `commands/index.mjs:202` 已对初始 state 做 `validateState`，需 audit 哪些命令路径绕过该校验。
