---
title: "feat: absorb netops kernel hardening and plugin install support"
type: feat
status: active
date: 2026-05-25
origin: docs/brainstorms/2026-05-25-absorb-netops-features-and-plugin-support-requirements.md
---

# feat: absorb netops kernel hardening and plugin install support

## Summary

v0.7 一次性吸收 `netops-agent-skills` 仓库分叉后演化出的 6 项 product-agnostic kernel 能力，分两束：kernel 韧性（state 健康检查、release-preflight runtime-deps↔engines floor 子检查、跨 plugin manifest 版本 lockstep helper）与 plugin 安装支持（sample-product 长出三平台 plugin layout、ProductConfig 扩 plugin metadata 字段、`pluginInstallInstructions()` SPI 接 ProductConfig 渲染、`scaffold-plugin` 跨产品 verb）。SPI v1.1 → v1.2、新增 ADR-0010 / ADR-0011 锁形。

---

## Problem Frame

nexel 已吸收 netops 的主要 installer kernel 能力（Adapter SPI v1.1、locale、release-preflight、conformance corpus 等，详见 `docs/plans/2026-05-22-001-...`）。但 netops 在 v0.5.1 分叉后继续演化到 v0.15.0，期间又沉淀出 6 项明确属于 product-agnostic kernel 的工程经验：

- nexel `state.json` 残留 manifest 已退役 `selectionId` 时，下游 `export` / `uninstall` 路径会抛模糊错误而非可操作错误（参见 origin Problem Frame）
- `release-preflight.mjs` 缺 runtime dependency `engines.node` 与宿主 `engines.node` 自洽校验，依赖升级易引入静默 Node 兼容性回退
- Kernel 已有 `opencode-plugin.mjs` 运行时 helper 与 `pluginInstallInstructions()` SPI 占位文字，但仓库根 `.claude-plugin/marketplace.json`、`.agents/plugins/marketplace.json`、sample-product 三套 plugin.json、`package.json.main` 均缺席 — 下游想发 plugin 形态没有可抄范例
- 无 `nexel scaffold plugin` 一键生成 plugin layout 的工具 — 下游手写易漂移
- `pluginInstallInstructions()` 当前是占位文字串，无法渲染下游产品真实 marketplace URL / plugin name / followup 命令

六项动机同源、互为前置（lockstep helper 需要 sample plugin layout 作校验对象；scaffolder 与 lockstep helper 互锁）。

---

## Requirements

- R1. 读取 `state.json` 的命令路径前调用 `assertValidExistingState(state)`，使用现有 `state.mjs:validateState`，单条 finding 抛 `CommandError` 含 `ERR_STATE_INVALID`，消息携带 `path` 与 `message`（see origin: R1）
- R2. 同上路径前调用 `assertStateSelectionsKnown(state, manifest)`，检测 `selectionId` 是否仍存在于 `manifest.skills` 或 `manifest.bundles`，未知 selectionId 抛 `CommandError` 含 `ERR_STATE_INVALID` 与 `{ unknownSelections: [...] }`，消息建议清理重装（see origin: R2）
- R3. `release-preflight.mjs` 新增子检查项：对每个 runtime dep 解析 `engines.node`，校验 floor 不严于宿主 `package.json.engines.node`；任一不满足导致 preflight 失败，错误列出冲突 dep 与版本边界（see origin: R3）
- R4. `examples/sample-product/` 补全三平台 plugin layout：`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`、`.opencode/INSTALL.md`、仓库根 `.claude-plugin/marketplace.json` 与 `.agents/plugins/marketplace.json`（指向 sample-product，`local` source）、`package.json.main` 指向 sample-product 的 OpenCode plugin entry、`files[]` 涵盖 plugin 打包目录（see origin: R4）
- R5. 公开 `verifyMarketplaceLockstep(specs)` 作为 kernel API，从 `scripts/installer/index.mjs` 导出，接受 `[{ path, expectedVersion }]`，校验所有 manifest 的 `version` 字段两两一致；sample-product 添加契约测试调用 helper，覆盖 R4 的三套 plugin.json + 根 marketplace.json（see origin: R5）
- R6. 新增 `scripts/installer/cli/commands/scaffold-plugin.mjs`，通过 `scaffold` verb 调用，接受 ProductConfig 生成 R4 的三套 plugin.json + 根 marketplace.json + OpenCode plugin entry js（复用 `adapters/opencode-plugin.mjs` 作运行时）；已存在文件默认不覆盖，`--force` 覆盖（see origin: R6）
- R7. `pluginInstallInstructions(productConfig)` SPI 签名变更：`claude.mjs` / `codex.mjs` / `opencode.mjs` 实现接受 ProductConfig，返回文字串内插真实 `productName`、marketplace URL、plugin name、followup 命令；`spi.mjs` `SPI_DEFAULTS` 与 `applyDefaults` 注入新签名 identity；`adapters/spi.test.mjs` 覆盖（see origin: R7）

---

## Key Technical Decisions

- **六项 v0.7 一次性发**，不分批：动机同源、互为前置、契约耦合；分批会丢上下文（see origin: Key Decisions）
- **Scaffolder verb 命名 = `scaffold`**：单 verb，无子命令。Origin Key Decisions 字面 "scaffold plugin" 读作 "verb 名 `scaffold` + `plugin` 作为当前唯一支持的 artifact 类型"。若未来需要 `scaffold skill` / `scaffold product` 等扩展形态，再决策子命令重构（参见 Deferred to Follow-Up Work）
- **Scaffolder 注册位 = `createCli({ enablePluginScaffolder: true })` opt-in**：kernel 出 `scaffoldPlugin(productConfig, opts)` 纯函数 + `dispatchScaffold(args, ctx)` argv 适配器；`createCli` 接受新 boolean flag `enablePluginScaffolder`（默认 `false`），仅当为 `true` 时把 `scaffold: dispatchScaffold` 注入 `KERNEL_HANDLERS`。纯 installer 下游零暴露；想发 plugin 的下游一行 flag 开启。sample-bin 演示开启路径
- **ProductConfig 字段全部新增为可选 + lazy-validate**：`repositoryUrl?` / `pluginName?` / `marketplaceName?` / `pluginAuthor?` / `pluginDescription?` 全可选；缺 `repositoryUrl` 时 scaffolder / `pluginInstallInstructions` 调用点 fail-loud。不动 `REQUIRED_FIELDS`、不破坏现有下游 ProductConfig 构造路径。`pluginName?` 默认派生 `productName`；`marketplaceName?` 默认 `${productName}-marketplace`
- **`repositoryUrl` 字段双用语义**：同时充当 git source（OpenCode adapter 的 `git clone` 步骤）与 marketplace URL（Claude / Codex adapter 的 `marketplace add` 步骤）。不引入独立 `marketplaceUrl` 字段
- **SPI v1.1 → v1.2 处理为 minor**：`pluginInstallInstructions` 签名从 `() => string` 改为 `(productConfig) => string`，旧实现忽略多余实参，行为兼容。`SPI_DEFAULTS.pluginInstallInstructions` 改为 `(_productConfig) => ""`。**已知行为变化**：`SPI_DEFAULTS.pluginInstallInstructions.length` 由 `0` 变 `1`；`SPI_DEFAULTS` 引用稳定性不属契约保证。ADR-0010 文字明确这两点
- **拆两份 ADR**：ADR-0010 锁 SPI v1.2（pluginInstallInstructions 签名），ADR-0011 锁 sample-product plugin layout 作为下游范例稳态（含命名、目录形状不可逆性）。与现有 ADR-0001…0009 单决策窄主题风格一致
- **sample-product plugin `name` 字段 = `sample-product`**：与目录名 / `productName` 一致，下游复制后单次全局 sed 即可 rename（see origin: Key Decisions）
- **scaffolder 生成的 OpenCode plugin entry 使用 sub-path import `nexel/adapters/opencode-plugin`**：遵循 ADR-0009 — opencode-plugin helper 不上 `index.mjs` 主表面

---

## Output Structure

R4 补全后 sample-product 新增 / 修改的关键文件（全部集中在 `examples/sample-product/` 子树内，repo 根仅 `package.json` 改动）：

```
nexel/
├── package.json                                # MOD — exports + files[]（不动 main）
└── examples/sample-product/
    ├── .claude-plugin/
    │   ├── plugin.json                         # NEW
    │   └── marketplace.json                    # NEW
    ├── .codex-plugin/
    │   └── plugin.json                         # NEW
    ├── .agents/
    │   └── plugins/
    │       └── marketplace.json                # NEW — Codex marketplace
    ├── .opencode/
    │   ├── INSTALL.md                          # NEW
    │   └── plugins/
    │       └── sample-product.js               # 已存在
    └── agent-skills.config.mjs                 # MOD — 加 repositoryUrl 等字段
```

实施者可调整 — 各 unit 的 `**Files:**` 段为准。

---

## Implementation Units

### U1. State health 双校验绑定读状态命令路径

**Goal:** state.json 残留无效结构或未知 selectionId 时给出可操作错误，而非晦涩堆栈。

**Requirements:** R1, R2

**Dependencies:** 无

**Files:**
- `scripts/installer/cli/commands/index.mjs` — 加 `assertValidExistingState(state)` 与 `assertStateSelectionsKnown(state, manifest)` helper 函数；在所有读取 state.json 的命令路径前调用
- `scripts/installer/cli/commands/index.test.mjs` — 加测试

**Approach:**
- 顶层加两个 helper：
  - `assertValidExistingState(state)` 调 `validateState` 并把 findings 数组转 `CommandError(ERR_STATE_INVALID, { findings })`，message 含首条 finding `path` + `message`，context 携带全部
  - `assertStateSelectionsKnown(state, manifest)` 比对 `state.installations[].selectionId` 与 `manifest.skills` / `manifest.bundles`，**accumulate** 全部未知 id（不 short-circuit），抛 `CommandError(ERR_NOT_INSTALLED, { unknownSelections })`（复用现有 `ERR_NOT_INSTALLED`，与 `applyUninstall` 中同概念检查的错码保持一致）
- Audit 现有 commands/index.mjs 命令入口（`uninstall`、`uninstallMulti`、`update`、`updateMulti`、`exportCommand`、`doctorCommand`、`repair`）— 哪些读 state.json 但未走 line 202 / line 871 的 validate 路径，按需补。**`importCommand` 不纳入 bound-paths**：import 写入 state 来自外部输入，对 state-empty target seed 全新数据，前置校验会阻塞合法首次 import
- 错误消息原则：`assertStateSelectionsKnown` 给出 unknown selection id 列表 + 建议 "remove retired selections from state.json before <verb>，或运行 clean reinstall"

**Patterns to follow:**
- 现有 `commands/index.mjs:202` 与 `:871` 已有 `validateState` 调用范式
- `CommandError` 构造惯例：`new CommandError(message, code, context)`

**Test scenarios:**
- `assertValidExistingState` 接受有效 state 直通；接收 missing 必填字段、错类型的 state 抛 `CommandError` 含 `ERR_STATE_INVALID`，错误消息含 finding 的 `path` 与 `message`
- `assertStateSelectionsKnown` 接受 state 中所有 selectionId 在 manifest 中存在 → 直通
- 接收含 unknown selectionId 的 state → 抛 `CommandError` 含 `ERR_STATE_INVALID`、`context.unknownSelections` 列出 id、消息含建议
- 端到端：`uninstall` / `export` 等命令在残留 selectionId 的 state 上执行 → 直接抛上述 error，未触达下游解析路径
- Audit gap 覆盖：每个读 state 的命令路径都至少 1 个测试覆盖 assert 命中

**Verification:** 所有现有测试通过；新增测试覆盖每个 read-state 命令入口；手工模拟 state.json 含未知 selectionId 跑 `uninstall` 返回可操作错误。

---

### U2. release-preflight 加 runtime deps ↔ engines.node floor 子检查

**Goal:** 引入 runtime dep 时若其 `engines.node` 严于宿主，preflight 立即失败。

**Requirements:** R3

**Dependencies:** 无

**Files:**
- `scripts/release-preflight.mjs` — `runPreflight` 加 `runtime-deps-engines-compatible` 子检查
- `scripts/release-preflight.test.mjs` — 加测试

**前置 audit（U2 实施第一步，先于添加 check）**：

- 跑一次手工对照 — 读 `package-lock.json` 中所有 `node_modules/<runtime-dep>` 的 `engines.node`，比较宿主 `package.json.engines.node`（当前 `>=18`）
- **已知冲突**：`@clack/prompts` 当前要求 `>=20.12.0`，宿主声明 `>=18` — 新 check 实施即 fail 当前 main。U2 同 unit 内必须 bump `package.json.engines.node` 到 lock 派生的有效 floor（预计 `>=20.12.0`），否则新 check 上线即失败、开发者训练自己忽略它
- 该 engines floor bump 在 release note v0.7 显式标注（npm 消费者的 SemVer 信号）

**Approach（添加 check 本身）：**

- 复用现有 `runPreflight` 中已读的 `pkg` 与 `lock`
- 对 `pkg.dependencies` 的每个 dep 名，从 `lock.packages["node_modules/<dep>"]` 读 `engines.node`；解析为 semver range 的最小满足 major.minor 形式
- 解析宿主 `pkg.engines.node`；比较 floor — 任一 dep 的 floor 严于宿主则 fail
- 单条 fail detail 列出 `dep@version: engines.node=<dep-range>，宿主 engines.node=<host-range>` 对照
- 不存在 `engines.node` 字段的 dep 视为兼容（无约束）

**Patterns to follow:**
- 现有 `add(name, ok, detail)` 调用范式
- `package-lock.json` 解析方式见现有 `package-lock-version-matches` check
- Semver 比较：可手写 `semverGt` 风格 floor 比较，避免引入依赖

**Test scenarios:**
- 所有 deps 兼容宿主 → check ok
- 一个 dep `engines.node` 严于宿主 → check fail，detail 列出 dep 名 + 双 range
- 多个 dep 严于宿主 → check fail，detail 列出所有冲突 dep
- Dep 无 `engines.node` 字段 → 视为兼容、不出现在 detail
- 宿主 `engines.node` 缺省 → check fail 并提示宿主需声明（或选择视为最严格 — 决策当下确定，倾向后者：缺省=最严格）

**Verification:** 现有 preflight 测试通过；新增测试覆盖各 floor 比较分支；手工在 `package.json` 加一个 `engines.node` 严于 `>=18` 的假 dep 跑 `npm run release:preflight` 应失败。

---

### U3. ProductConfig 扩 plugin metadata 字段

**Goal:** ProductConfig 携带后续 unit 渲染 plugin manifest 与 SPI 输出所需字段。

**Requirements:** R6, R7（共同前置 — U4 实现 R7 时消费本 unit 加的 ProductConfig 字段；U5 + U7 渲染 plugin manifest 时同样消费）

**Dependencies:** 无（其余 plugin 相关 unit U4 / U5 / U7 反向依赖本 unit）

**Files:**
- `scripts/installer/core/product-config.mjs` — 新增字段定义、验证、默认派生
- `scripts/installer/core/product-config.test.mjs` — 加测试
- `examples/sample-product/agent-skills.config.mjs` — 加 `repositoryUrl` 字段

**Approach:**

- **不动 `REQUIRED_FIELDS`**（保持 SPI v1 identity-fields 冻结）。所有新字段进 `OPTIONAL_DEFAULTS`：
  - `repositoryUrl?` → 默认 `undefined`；由 scaffolder / `pluginInstallInstructions` 调用点 lazy-validate（缺时抛 actionable error 指向 ProductConfig.repositoryUrl）
  - `pluginName?` → 派生默认 `productName`
  - `marketplaceName?` → 派生默认 `${productName}-marketplace`
  - `pluginAuthor?` → 默认 `undefined`（plugin.json 写时省略字段）
  - `pluginDescription?` → 默认 `undefined`
- **关键防御 — `Object.freeze({...})` return block 显式枚举**：
  `defineProductConfig` 当前显式列举每个返回字段（不 spread），任何未加入 return block 的字段会被静默丢弃（先例：sample-product `envTelemetry` / `telemetryDirName` 已被丢）。U3 必须在 `core/product-config.mjs:125` 附近的 `Object.freeze({...})` 内逐字段列出五项新字段及其 `?? OPTIONAL_DEFAULTS.<field>` fallback
- **`repositoryUrl` 双用语义**：同时充当 git source（OpenCode adapter `git clone`）与 marketplace URL（Claude / Codex adapter `marketplace add`）。U3 注释与 ADR-0010 显式声明，不引入独立 `marketplaceUrl`
- Sample-product `agent-skills.config.mjs` 追加 `repositoryUrl: "https://github.com/SeasonTemple/nexel"`（指向 nexel 本身，sample 不独立发布）

**Patterns to follow:**
- 现有 `REQUIRED_FIELDS` / `OPTIONAL_DEFAULTS` 范式
- 错误聚合（missing 全列、malformed 全列）
- ADR-0009 关于 OpenCode helper 不上 index.mjs 主表面的 sub-path 隔离思路

**Test scenarios:**
- 含全部新字段 → defineProductConfig 成功，返回值含所有字段
- 仅必填 5 字段（productName 等），新字段全省 → 成功；`pluginName === productName`、`marketplaceName === "${productName}-marketplace"`、`repositoryUrl === undefined`、其余 undefined（**向后兼容核心断言**）
- 显式提供 `pluginName` / `marketplaceName` / `repositoryUrl` → 覆盖派生默认
- `repositoryUrl` 类型错（数字）→ 抛 `ProductConfigError` 含 malformed
- **silent-drop 回归测试**：构造含一个**虚构**字段名（如 `_dropCanary: "x"`）的 overrides，断言返回对象不含该字段、仅含 schema 枚举的字段。该测试是 silent-drop 类 bug 的通用守卫，未来加字段忘了 return block 也会被它接住
- 现有 product-config 测试全过（向后兼容）

**Verification:** 现有 ProductConfig 测试全过；sample-product `bin.mjs` 仍能加载；新字段测试覆盖派生默认、覆盖、silent-drop 守卫。

---

### U4. SPI v1.2 — pluginInstallInstructions 接 ProductConfig

**Goal:** 三个 adapter 的 `pluginInstallInstructions()` 接受 ProductConfig 并渲染真实命令。

**Requirements:** R7

**Dependencies:** U3

**Files:**
- `scripts/installer/adapters/spi.mjs` — `SPI_DEFAULTS.pluginInstallInstructions` 改签名，文档头注释更新 v1.1 → v1.2 与 evolution policy 备注
- `scripts/installer/adapters/spi.test.mjs` — 覆盖新签名
- `scripts/installer/adapters/claude.mjs` — `pluginInstallInstructions(productConfig)` 实现内插字段
- `scripts/installer/adapters/codex.mjs` — 同上
- `scripts/installer/adapters/opencode.mjs` — 同上
- `scripts/installer/cli/prompts.mjs` 与 `cli/commands/index.mjs` — 任何调用点改为传 `productConfig`
- `scripts/installer/adapters/spi.test.mjs` / 三 adapter 各自 `.test.mjs` — 测试更新

**Approach:**
- 签名：`pluginInstallInstructions(productConfig: ProductConfig): string`
- 三 adapter 实现各自渲染字符串模板，内插 `productConfig.productName` / `pluginName` / `marketplaceName` / `repositoryUrl`
- **Lazy validation**：每个 adapter 实现先校验 `productConfig.repositoryUrl` 非空，缺时返回 actionable error 文字（"ProductConfig 缺 repositoryUrl — 在 agent-skills.config.mjs 中追加该字段"）而非占位串
- Claude adapter 输出三步：marketplace add（用 `repositoryUrl`）→ install（`<pluginName>@<marketplaceName>`）→ refresh
- Codex adapter 同形
- OpenCode adapter 输出 git clone + `opencode plugin` 命令，使用 `repositoryUrl`
- `SPI_DEFAULTS.pluginInstallInstructions` 改为 `(_productConfig) => ""`（identity 默认仍空串，但接 arg）
- 调用点 audit：`prompts.mjs` `gatherInstallChoices` 中 `pluginInstallInstructions()` 调用全部加 ProductConfig 形参从 ctx 传入；`spi.mjs:216` `assertSupportsDirect` 中的调用同步加 ProductConfig
- SPI 注释更新：`pluginInstallInstructions : (productConfig) => string` + 标注 "v1.2 — was () => string in v1.1; old implementations remain compatible because extra arg is ignored; SPI_DEFAULTS reference equality and Function.length are not part of the contract"

**Technical design (directional):** SPI evolution 兼容路径：

```
旧 adapter 实现: pluginInstallInstructions: () => "..."
新 SPI 调用方:    adapter.pluginInstallInstructions(productConfig)
                  // 旧实现忽略 productConfig，仍返回原字符串
                  // 新实现读 productConfig，渲染真实命令
```

**Patterns to follow:**
- 现有 adapter 中 `claude.mjs:45-55` / `codex.mjs:45-50` / `opencode.mjs` 占位文字结构
- `SPI_DEFAULTS` Object.freeze 风格

**Test scenarios:**
- `applyDefaults` 注入的 default `pluginInstallInstructions(productConfig)` 返回空串、不抛错
- 旧风格 adapter（无参实现）经 `applyDefaults` 后 `pluginInstallInstructions(productConfig)` 调用不抛（多余实参忽略）— 兼容性回归
- **Function.length 断言**：`SPI_DEFAULTS.pluginInstallInstructions.length === 1`（arity 变更属契约一部分，固化期望以后版本继续接 productConfig）
- 三 adapter 实现各自：传入 sample-product ProductConfig（含 repositoryUrl），返回字符串含 `productName`、`repositoryUrl`、`pluginName`、`marketplaceName` 实际值
- 同上：缺 `pluginName` 时使用派生默认 `productName`
- **Lazy validation**：传入 ProductConfig 缺 `repositoryUrl` → 三 adapter 各自返回含 "缺 repositoryUrl" 提示的 actionable error 文字（不是空串、不是占位）
- `prompts.mjs` 调用点：传入 ctx.productConfig 后渲染串无 `<your-product-marketplace-url>` 占位

**Verification:** 现有 spi.test + 三 adapter test 全过；新增测试覆盖签名变更与兼容路径；手工跑 sample-bin 走 plugin install 提示路径，输出无占位串。

---

### U5. sample-product 三平台 plugin layout 补全

**Goal:** sample-product 成为下游可直接抄的完整 plugin 范例。

**Requirements:** R4

**Dependencies:** U3（agent-skills.config.mjs 需先有 `repositoryUrl` 等字段）

**Files:**
- `examples/sample-product/.claude-plugin/plugin.json` — NEW
- `examples/sample-product/.codex-plugin/plugin.json` — NEW
- `examples/sample-product/.opencode/INSTALL.md` — NEW
- `examples/sample-product/.claude-plugin/marketplace.json` — NEW（marketplace.json 与 plugin.json 同目录；按 Claude marketplace 规范单一目录承载两文件）
- `examples/sample-product/.agents/plugins/marketplace.json` — NEW（Codex marketplace 同样置于 sample-product 子树内）
- `package.json` — MOD（**仅** `files[]` 追加 sample-product plugin layout 子目录 + 新增 exports map subpath；**不动 `main`**，保留 `./scripts/installer/index.mjs` 以维持 `import 'nexel'` 解析到 kernel barrel）

**Approach:**
- 三套 plugin.json 与根 marketplace.json 字段从 sample-product 的 ProductConfig 静态映射出来（pluginName=sample-product, marketplaceName=sample-product-marketplace, version 取自 nexel package.json）
- `.claude-plugin/plugin.json`: `name`、`version`、`description`、`skills: ["./skills/"]`
- `.codex-plugin/plugin.json`: 同上 + `interface` 段（`displayName`、`shortDescription`、`category`、`capabilities`）
- `examples/sample-product/.claude-plugin/marketplace.json`: `name: "sample-product-marketplace"`、`plugins: [{ name, source: ".", version }]`（source 相对 marketplace.json 自身位置；下游抄 sample-product 子树到自己 repo 根时路径仍正确）
- `examples/sample-product/.agents/plugins/marketplace.json`: `name: "sample-product-marketplace"`、`plugins: [{ name, source: { source: "local", path: "../.." }, ... }]`（指回 sample-product 根；下游抄走时 path 仍可定位 plugin 根）
- **`package.json` 改动严格限定**：
  - `main` **保持 `./scripts/installer/index.mjs`** — 不可 repoint 到 sample-product OpenCode plugin（会破坏 `import 'nexel'` + 与 library-only 定位冲突）
  - `exports` 加新 subpath `"./examples/sample-product/opencode-plugin": "./examples/sample-product/.opencode/plugins/sample-product.js"`，供 OpenCode plugin 发现机制按官方规范引用（U7 实施期间用 context7 查 OpenCode plugin spec 确认 entry 字段所在）
  - `files[]` 追加 `examples/sample-product/.claude-plugin/`、`examples/sample-product/.codex-plugin/`、`examples/sample-product/.agents/`、`examples/sample-product/.opencode/`
- `.opencode/INSTALL.md`: 短文档 — git clone 步骤 + `opencode plugin <PLUGIN_DIR> --global --force` 命令；强调 sample-product 是 nexel 内置范例非独立产品

**Patterns to follow:**
- netops 仓库 `plugins/netops-agent-skills/.claude-plugin/plugin.json` 与 `.codex-plugin/plugin.json` 字段形状（不照抄 netops 特定字段值）
- 注意：sample-product 在 nexel 内 layout 是 `examples/sample-product/` 而非 `plugins/<name>/`，路径相应调整

**Test scenarios:**
- 文件存在性测试：5 个新文件 + `package.json` 改动落地
- JSON 解析通过、必填字段存在
- 三套 plugin.json 的 `version` 字段两两一致、与 `package.json.version` 一致（手工覆盖；U6 lockstep helper 自动化）
- `package.json.main` **仍 = `./scripts/installer/index.mjs`**（回归断言：U5 不得改动 main 字段）
- `package.json.exports` 新增 sample-product OpenCode plugin subpath 可解析
- `package.json.files[]` 包含所有新 plugin 子目录
- OpenCode `.opencode/plugins/sample-product.js` 通过 `package.main` 加载成功（现有 `sample-opencode-plugin.test.mjs` 不变仍过）

**Verification:** 三套 plugin.json + 根 marketplace JSON 可解析；`npm pack --dry-run` 输出含所有新文件；现有 sample-opencode-plugin 测试不退化。

---

### U6. verifyMarketplaceLockstep kernel helper + sample contract test

**Goal:** 提供 kernel 级 helper 校验跨 plugin manifest 版本一致；sample-product 用其证。

**Requirements:** R5

**Dependencies:** Helper 本身无前置；sample-product contract test（同 unit 内 file）依赖 U5 layout 作 fixture — 但 U5 可独立 ship 不依赖 U6

**Files:**
- `scripts/installer/core/marketplace-lockstep.mjs` — NEW（kernel helper）
- `scripts/installer/core/marketplace-lockstep.test.mjs` — NEW
- `scripts/installer/index.mjs` — 导出 `verifyMarketplaceLockstep`
- `examples/sample-product/sample-marketplace-contract.test.mjs` — NEW

**Approach:**
- `verifyMarketplaceLockstep(specs: Array<Spec>): { ok: boolean, mismatches: Array<{ path, found, expected }> }`
- `Spec = { path: string, pluginName?: string, expectedVersion?: string }`：
  - path 指向 `plugin.json` 风格文件（顶层 `version`）→ helper 直接读顶层 `version`
  - path 指向 `marketplace.json` 风格文件 + 提供 `pluginName` → helper 自动 `find plugins[].name === pluginName` 取 `version`
  - 提供 `pluginName` 但 marketplace.json 中找不到对应 entry → mismatches 含 `found: null` 与错误标记
- `expectedVersion` 提供时与该值比对；未提供则取第一条 spec 的 version 作 baseline 与其余比对
- 返回 `{ ok, mismatches }` — 调用方决定如何抛错（不直接抛）
- 字段范围：仅 `version`；其余字段（`name`、`source` 等）的契约校验留给 sample contract test 自己写 assert
- Sample contract test 调用 helper 覆盖：`examples/sample-product/.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`、根 `.claude-plugin/marketplace.json`（spec 含 `pluginName: "sample-product"`）、根 `.agents/plugins/marketplace.json`（同上），外加 nexel `package.json.version` 作 baseline

**Patterns to follow:**
- Pure helper 风格（无 IO 副作用以外的状态、可单测）
- 现有 `scripts/installer/core/` 模块导出范式

**Test scenarios:**
- 所有 spec 版本一致 → ok: true、mismatches 空
- 一个 spec 版本不一致 → ok: false、mismatches 列出 path、found、expected
- Marketplace.json + `pluginName` selector → helper 自动从 `plugins[]` 找 entry 取 version
- Marketplace.json + `pluginName` 找不到对应 entry → mismatches 含 found: null
- Path 不存在 → 抛带 path 的 error
- JSON 解析失败 → 抛带 path 的 error
- 缺 `version` 字段 → mismatches 含 `found: null`
- Sample contract test：调用 helper 后 ok: true（U5 layout 落地后所有 version 与 `package.json` 一致）

**Verification:** Helper 单测全过；sample contract test 通过；手工把 sample-product `.claude-plugin/plugin.json` version 改坏后跑 contract test 应失败并报准确 path。

---

### U7. scaffold-plugin verb + dispatchScaffold + sample-bin 演示

**Goal:** `<bin> scaffold` 一键从 ProductConfig 生成 plugin layout，所有 createCli 下游自动获得。

**Requirements:** R6

**Dependencies:** U3, U5, U6

**Files:**
- `scripts/installer/cli/commands/scaffold-plugin.mjs` — NEW（`scaffoldPlugin(productConfig, opts)` 纯函数 + `dispatchScaffold(args, ctx)` argv 适配器）
- `scripts/installer/cli/commands/scaffold-plugin.test.mjs` — NEW
- `scripts/installer/cli/dispatch.mjs` — MOD（`KERNEL_HANDLERS` 加 `scaffold: dispatchScaffold`）
- `scripts/installer/cli/dispatch.test.mjs` — MOD（覆盖 scaffold 注册）
- `scripts/installer/cli/argv.mjs` — MOD（`validVerbs` 集合扩展前由 `createCli` 推断，无需直接改 argv.mjs；如必要加 `--force` flag — 已有）
- `scripts/installer/index.mjs` — 导出 `scaffoldPlugin`、`dispatchScaffold`
- `scripts/installer/cli/help.mjs` 与 `cli/strings.{en,zh}.mjs` — 加 scaffold verb 帮助文案
- `examples/sample-product/sample-bin.test.mjs` — 加 scaffold verb spawn-E2E 测试
- `examples/sample-product/bin.mjs` — 无需改动（createCli 自动暴露）；可加注释说明 scaffold 可用

**Approach:**
- `scaffoldPlugin(productConfig, { repoRoot, force = false, targetDir = null, depAudit = true }): { written: string[], skipped: string[], warnings: string[] }`
  - `targetDir` 默认 `<repoRoot>/examples/<productName>` 或调用方传入产品根
  - 生成文件清单：U5 layout 的 5 个文件 + OpenCode plugin entry js
  - OpenCode plugin entry 生成内容使用 `import { configureOpenCode } from "nexel/adapters/opencode-plugin"` 子路径（遵循 ADR-0009）
  - 三套 plugin.json + 根 marketplace.json 内容从 ProductConfig 字段渲染
  - **`productConfig.repositoryUrl` 必填校验**（lazy）：缺时抛 actionable error 指向 ProductConfig.repositoryUrl，generation 前 fail-loud
  - **下游 dep audit**（默认开启，`--no-deps` 关闭）：scaffolder 读 `<targetDir>/package.json`，若 dependencies / peerDependencies 不含 `nexel` → 输出 actionable warning（`generated entry imports "nexel/adapters/opencode-plugin"; add nexel to dependencies before opencode plugin load`），收入 `warnings[]` 返回。不自动写 dep（保持 scaffolder 单一职责）
  - 已存在文件：默认 skipped 加入返回；`force: true` 覆盖加入 written
- **`.opencode/INSTALL.md` 模板第一段显式声明**："Generated plugin entry depends on `nexel`. Ensure your product's `package.json` declares `nexel` in `dependencies` or `peerDependencies` before running `opencode plugin <PLUGIN_DIR>`"
- **Generated OpenCode entry 文件头注释**：`// requires nexel >= 0.7 as runtime dep — generated by <bin> scaffold`
- `dispatchScaffold(args, ctx)` argv 适配器：从 `args.force` / `args.target` / `ctx.productConfig` / `ctx.repoRoot` 调用 `scaffoldPlugin`，输出 `Wrote N files / Skipped M files / Warnings: ...`
- `createCli` 加 `enablePluginScaffolder: boolean = false` 选项；为 `true` 时把 `scaffold: dispatchScaffold` 加入 effective handlers（与 `extraHandlers` 同优先级合并，kernel 内置 verb 仍优先）
- sample-bin `bin.mjs` 调用 `createCli({ ..., enablePluginScaffolder: true })` 演示启用路径
- `dispatch.mjs` `KERNEL_HANDLERS` **不直接含 scaffold**；scaffold 在 `cli.mjs:createCli` 内根据 flag 拼接
- Help 与 strings 加 scaffold verb 说明文案（zh + en）
- argv 无需改动（确认：cli.mjs:29 DEFAULT_VERBS 已自动推导）

**Technical design (directional):** scaffolder 生成的 OpenCode plugin entry 模板：

```js
// generated by `<bin> scaffold` — do not edit by hand
import { configureOpenCode } from "nexel/adapters/opencode-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(HERE, "../../skills");

export default async () => ({
  config: async (config) => configureOpenCode(config, SKILLS_DIR),
});
```

**Patterns to follow:**
- 现有 `cli/commands/repair-rehash.mjs` 单文件命令风格
- `dispatchVerb({ verb, args, ctx, extraHandlers })` 调用约定
- `argv.mjs` 已有 `--force` flag

**Test scenarios:**
- `scaffoldPlugin(productConfig, { repoRoot, targetDir })` 空目录调用 → 写入所有预期文件、返回 written 列表
- 同上参数二次调用、`force: false` → 全部 skipped、零 written
- `force: true` → 全部 written 覆盖
- 生成的三套 plugin.json `version` 字段一致（用 U6 helper 校验）
- 生成的 OpenCode plugin entry js 可被 dynamic import、`configureOpenCode` 调用形状正确
- `dispatchScaffold` argv 适配器：传 `--force` → 覆盖路径；不传 → 默认 skip 路径；ctx 缺 productConfig → 抛带可操作消息的 error
- `KERNEL_HANDLERS.scaffold` 已注册：`dispatchVerb({ verb: "scaffold", ... })` 命中
- Sample-bin spawn-E2E：`node examples/sample-product/bin.mjs scaffold --target=<tmpdir>` 输出 written 列表并退出 0；二次跑相同 target 输出 skipped；`--force` 后 written
- Help: `<bin> scaffold --help` 输出含 scaffold 描述

**Verification:** 单测全过；sample-bin E2E 测试覆盖三状态（首次写 / skip / force）；手工跑 `node examples/sample-product/bin.mjs scaffold --target=/tmp/test-scaffold` 在空目录生成完整 layout 且 U6 lockstep 立即过。

---

## Documentation Updates

### ADR-0010: SPI v1.2 — pluginInstallInstructions accepts ProductConfig

- `docs/adr/0010-spi-v12-plugin-install-instructions-product-config.md`
- 记录：签名变更、minor 升级理由（旧实现兼容）、`SPI_DEFAULTS` 改动、与 ADR-0002 关系
- 在 ADR-0002 末尾加 "Superseded in part by ADR-0010 (SPI v1.2)" 引用

### ADR-0011: Sample-product plugin layout as downstream reference

- `docs/adr/0011-sample-product-plugin-layout-as-downstream-reference.md`
- 记录：sample-product 长 plugin 入口的决策、目录命名（`sample-product`）、layout 形状的稳定性窗口（**v0.7 release window**，演化需显式 migration note，而非永久 lock）、下游复制 / rename 路径、与 ADR-0009 关系
- **Consequences 段必须显式列出**：
  - kernel 自此承担对 downstream 模板复制者的 layout 稳定性义务（v0.7 窗口内）
  - marketplace lockstep helper 把 nexel 与 plugin-registry 演化绑定
  - 身份漂移：kernel library → "kernel + plugin-authoring reference"；与原 "product-agnostic install kernel" 定位的张力须明确
  - 已知演化口：Codex marketplace `interface` 段官方规范 verify 后可能需修正

### Release note v0.7

- `docs/release-notes/v0.7.0.md`（English + 中文双段）
- 列出六项吸收 + SPI v1.2 + 两份 ADR
- **显式声明 `engines.node` floor bump**（`>=18` → `>=20.12.0`）作为 npm 消费者 SemVer 信号 — 由 U2 audit 步骤推动

### CLAUDE.md / AGENTS.md

- 不动 — 本变更未改 commit 规范、不引入新 lint 规则

---

## Scope Boundaries

- 不吸收 netops 产品向资产：`gitlab-workflow` skill、autonomous mode skill、`closeout` skill、`publish-release.mjs`（GitLab API 直发）、`netops-lint-config.mjs`、`marketplace-contract.test.mjs` 中 netops-specific 路径断言
- 不引入新 npm 依赖
- 不改 GitHub Actions release 路径
- 不改 `opencode-plugin.mjs` 运行时行为（scaffolder 复用现有实现）
- 不扩展 `ASSET_TYPES`
- 不动 `conformance-product/`
- 不让 nexel 长 `package.json.bin` 字段（library-only 定位保留）

### Deferred to Follow-Up Work

- scaffold-plugin 之外的 `scaffold-product` / `scaffold-skill` 等扩展形态 — 本次仅做 plugin scaffolder
- `verifyMarketplaceLockstep` 校验 `name` / `source` / `interface` 等字段一致性 — 本次仅 `version`
- ADR-0002 重写为 "SPI 演化总览"汇总文档 — 本次仅末尾加引用

---

## Dependencies / Assumptions

- 假设 `state.mjs:validateState` 现有 finding 结构（`{ path, message }`）足以承载 U1 错误消息；若结构需扩展则在 U1 实施期间补判
- 假设 `package-lock.json` 始终随仓库提交（已是约定）— U2 可直接读 lock 解析 dep engines
- 确认：`cli/cli.mjs:29` `DEFAULT_VERBS = new Set([...Object.keys(KERNEL_HANDLERS), "help"])` 已自动从 KERNEL_HANDLERS 推导 verb 集；`cli/argv.mjs` 接受 `validVerbs` 作 Set 参数，无硬编码 verb 名。U7 添加 `scaffold: dispatchScaffold` 到 KERNEL_HANDLERS 即自动暴露 verb 给所有 createCli 调用方，无需改动 argv.mjs
- 假设 sample-product 在 nexel 内的位置 `examples/sample-product/` 与 netops 的 `plugins/<name>/` 路径差异不影响 plugin manifest 字段（`source` 字段相应使用 `./examples/sample-product`）
- sample-product plugin layout 一旦发布即为下游事实模板，命名 / 路径 / 字段顺序后续变更代价高 — ADR-0011 锁形

---

## System-Wide Impact

- SPI 表面：v1.1 → v1.2（minor，向后兼容）。所有 nexel 内 adapter 须更新；外部 adapter 实现（若有）旧风格仍能工作但渲染默认空串。**已知行为变化**：`SPI_DEFAULTS.pluginInstallInstructions.length` 由 0 变 1；reference 稳定性非契约
- Kernel 公共 API 表面：`index.mjs` 新增 `verifyMarketplaceLockstep`、`scaffoldPlugin`、`dispatchScaffold` 三个导出
- ProductConfig 表面：**全部新增字段均可选**（`repositoryUrl` / `pluginName` / `marketplaceName` / `pluginAuthor` / `pluginDescription`）；`REQUIRED_FIELDS` 不变。现有 ProductConfig 调用方零修改即可继续使用，仅需调用 plugin-related 路径（scaffolder / pluginInstallInstructions）时追加 `repositoryUrl`
- `createCli` 接受新选项 `enablePluginScaffolder: boolean = false`（默认 `false` 保留现有调用方零暴露）。开启后 `scaffold` verb 进入 effective handler 集；help / strings catalog 同步扩 scaffold 文案（仅在开启时显示）
- 仓库根：**无新增顶层目录**。所有 plugin 资产集中在 `examples/sample-product/` 子树内（marketplace.json + plugin.json + INSTALL.md + OpenCode entry 全部子树内）。Repo 根保持 kernel-library 第一印象
- `package.json`: **`main` 不变**（保留 `./scripts/installer/index.mjs`）；新增 `exports` subpath + `files[]` 改动；npm pack 输出变化

---

## Outstanding Questions

### Deferred to Implementation (mitigated)

- [Affects U7][Needs research, mitigated] Codex marketplace `interface` 段当前规范（必填字段）需查 Codex 文档而非照抄 netops 实例 — **Mitigation**：U5 / U7 实施期间先按 netops 已知字段做，使用 context7 查 Codex plugin spec 后对照修正；ADR-0011 Consequences 段已列为已知演化口
- [Affects U2][Technical, mitigated] 宿主 `engines.node` 缺省时的策略 — **Mitigation**：U2 实施期间默认视为最严格（任意 dep `engines.node` floor → fail）并在 detail 中提示宿主应声明 `engines.node`；该路径目前不会触发，因 U2 audit 步骤已要求宿主声明非空 floor
