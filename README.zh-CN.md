<div align="center">

<img src="./assets/hero-banner.webp" alt="nexel" width="100%" />

# nexel

**通用产品无关内核 — 一套 agent-skill pack,一次写好,同时发布到 Claude Code、Codex、OpenCode。**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-43853d?logo=node.js&logoColor=white)](./package.json)
[![Type: ESM](https://img.shields.io/badge/type-ESM-f7df1e?logo=javascript&logoColor=black)](./package.json)
[![Tests](https://img.shields.io/badge/tests-253%20passing-2ea44f)](./scripts/installer/architecture.test.mjs)

[English](./README.md) · [中文](./README.zh-CN.md) · [Why](#why-nexel) · [Core model](#core-model) · [Quick start](#quick-start) · [Reference](#reference) · [AI agents](#for-ai-agents) · [示例](./examples/sample-product/)

</div>

---

## Why nexel

你维护着一套 agent skills、subagents、rules,想把它同时装到 Claude Code、
Codex、OpenCode。每个工具把资产放在不同位置、要求不同的 frontmatter 形态
—— 于是"把我这套发布到所有平台"退化成 N 套安装脚本、N 份状态文件、N 套
drift 检查,每个工具各推导一遍,每次改动各调试一遍。

`nexel` 就是吸收这部分工作的内核。你只写**一份 `ProductConfig` 和一份
manifest**;内核负责校验、规划、安装/卸载/更新、状态追踪、drift 检测、
按 adapter 分发。内核对你的产品零认知 —— bin 名、skill-id 前缀、agent-name
前缀、manifest 文件名、env 命名空间,全部来自你的 config。支持一个新 CLI
是加一个 adapter,不是重写。

> 是要用 agent 程序化驱动 nexel 衍生 bin,而不是自己写一个?直接跳到
> [For AI agents](#for-ai-agents) —— 行为契约单独规范,且是稳定的 kernel
> 表面。

## Core model

五个名词。吃透这五个,本文余下部分自然成立。

| 名词 | 是什么 |
|---|---|
| **Kernel** | `scripts/installer/` 里的产品无关库。owns 安装/卸载/更新/状态/drift/规划。对任何产品的内容零认知。 |
| **ProductConfig** | 你传入的、按产品冻结的身份(`productName`、`skillIdPrefix`…)。没有它内核处于 inert。 |
| **Adapter** | 按 CLI 的可插拔集成(Claude Code、Codex、OpenCode)。决定资产落到哪、内容如何 transform。 |
| **Asset** | 内核安装的单位 —— **skill**、**agent**、**rule** 三者恰取其一。不是泛指文件。 |
| **Manifest** | `install.json` —— 唯一真相源。一个资产对内核可见 **当且仅当** 它有 manifest 条目。 |

> 每个消费产品有一个 **Kernel**,由一个 **ProductConfig** 配置;一份
> **Manifest** 声明哪些 **Asset** 存在;一个 **Adapter** 把这些资产映射并
> transform 到目标 CLI。

## Quick start

仓库自带完整、可运行的示例
[`examples/sample-product/`](./examples/sample-product/) —— 先跑起来看效果,
再接你自己的:

```text
examples/sample-product/
├── agent-skills.config.mjs    # ProductConfig（产品身份的唯一来源）
├── sample.install.json        # Manifest
├── skills/  agents/  rules/   # 内容
├── bin.mjs                    # 以上述 config 包装 createCli
└── sample-bin.test.mjs        # spawnSync 端到端测试
```

```sh
node examples/sample-product/bin.mjs help
node examples/sample-product/bin.mjs list --json
node examples/sample-product/bin.mjs plan --agent codex --skill sample:hello-world
```

bin 的品牌名取决于你在 `productConfig.binName` 里设的值;一旦接入,`nexel`
自身不会出现在任何 user-facing 文本里。

## Install

未发布 npm。通过锁定的 git tag 消费 —— clone、git 依赖或 vendor:

```sh
# git 依赖（package.json），锁定到发布 tag
npm install "git+https://github.com/<owner>/nexel.git#v0.3.0"
```

```sh
# 或 clone + 锁定 tag
git clone https://github.com/<owner>/nexel.git && cd nexel && git checkout v0.3.0
```

依赖 Node ≥ 18,仅 ESM。每个 tag 的发布说明见
[`docs/release-notes/`](./docs/release-notes/)。

## ProductConfig

`defineProductConfig({...})` 是产品身份的唯一注入点。必填字段在构造期硬性
校验:

```js
import { defineProductConfig } from "nexel";

export default defineProductConfig({
  productName: "my-skills",
  skillIdPrefix: "my", // skill id 必须以 "my:" 开头
  agentNamePrefix: "my-", // agent installedName 必须以 "my-" 开头
  defaultManifestFile: "my.install.json",
  binName: "my-skills",

  // 可选（默认值如下）:
  defaultSkillsDir: "skills",
  defaultAgentsDir: "agents",
  defaultRulesDir: "rules",
  targetPathLayout: { skills: "skills", agents: "agents" },
  envProfile: "MY_SKILLS_PROFILE", // sandbox/profile 隔离用
  envBannerTitle: "MY_SKILLS_BANNER_TITLE",
});
```

规则: `skillIdPrefix` 不可含 `:`;`agentNamePrefix` 必须以 `-` 结尾。

## Design principles

内核为何长成这样。下面每条都是被强制或被记录的,不是口号。

1. **产品无关内核。** 对产品零认知;没有 `ProductConfig` 即 inert,且配置
   错误时在 `defineProductConfig` 处抛错 —— 不是等到首次使用。
   ([ADR-0001](./docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md))
2. **Manifest 是唯一真相源。** 无 manifest 条目 → 内核看不见该资产。不存在
   隐式文件系统发现。
3. **Z 三层,由测试强制。** `index.mjs` 是唯一公共入口;层方向守卫是
   `architecture.test.mjs`,不靠约定。
   ([ADR-0001](./docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md))

   ```text
   scripts/installer/
   ├── core/      # 纯逻辑；禁止反向依赖 adapters/ 或 cli/
   ├── adapters/  # 平台适配；禁止反向依赖 cli/
   └── cli/       # 表面；可依赖 core/ 与 adapters/
   ```

4. **幂等、状态追踪、drift 感知。** `install` / `update` / `repair` 在记录
   的 on-disk 状态上有明确语义;`repair` 只重装与 manifest drift 的部分。
   ([ADR-0008](./docs/adr/0008-unfreeze-state-dirname-rename-to-nexel.md))
5. **解耦纪律。** npm 发布与 public-API contract clock 刻意与命名决策解耦
   并延后 —— 发布前的内部 API 变动是清理,不是契约破坏。
   ([ADR-0007](./docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md))
6. **ADR 记录权衡。** 难以回退、缺上下文会意外的决策,各以一个文件记录在
   [`docs/adr/`](./docs/adr/)。

## Reference

> 查阅性材料 —— 除非要查具体导出、verb 或 flag,可跳过。

### Public API

`scripts/installer/index.mjs` 导出 v1 稳定契约。新增导出向后兼容;删除或
重命名构成 breaking change。

| 类别 | 导出 |
|---|---|
| **工厂** | `createCli`、`createAdapterRegistry`、`defineProductConfig` |
| **CLI 基础件** | `parseArgs`、`printHelp`、`renderHelp`、`handleError`、`formatSkipNote`、`dispatchVerb`、`KERNEL_HANDLERS`、`strings` |
| **Verb 处理器** | `runList`、`runAgents`、`runValidate`、`runExport`、`runImport`、`runRepair`、`runDoctor`、`runPlan`、`runInstall`、`runUninstall`、`runUpdate`、`resolveSelections` |
| **Manifest 流水线** | `loadManifest`、`validateManifest`、`defaultManifestPath`、`defaultPaths`、`detectDrift`、`exitCodeFor`、`formatFindings`、`SCHEMA_VERSION`、`PROFILES`、`CATEGORIES`、`HOSTS` |
| **Adapter SPI** | `SPI_REQUIRED`、`SPI_DEFAULTS`、`validateAdapter`、`applyAdapterDefaults`、`ADAPTERS`、`getAdapter`、`listAdapterStatus`、`assertSupportsDirect`、`assertCliPresent` |
| **资产模型** | `assetTypes`、`getAssetType`、`defaultTargetMapping`、`whichSync` |
| **Plan 期工具** | `buildInstallPlan`、`resolveSelection`、`transitiveAssets`、`formatPlanText` |
| **Kernel 命令** | `install`、`installMulti`、`uninstall`、`uninstallMulti`、`update`、`updateMulti`、`repair`、`exportCommand`、`importCommand`、`listCommand`、`agentsCommand`、`doctorCommand`、`planCommandText`、`planSelection` |
| **错误类** | `CommandError`、`AdapterError`、`ProductConfigError`、`StateError`、`FsError`、`PlanError`、`CancelledError`、全部 `ERR_*` 码 |

### Adapter SPI

内置三个适配器:Claude Code、Codex、OpenCode。下游产品通过
`createCli({ adapters: [...] })` 注入额外适配器。每个适配器需导出 SPI v1
契约:

| 字段 | 必填 | 类型 / 签名 |
|---|---|---|
| `id` | 是 | `string` — 唯一标识符 |
| `displayName` | 是 | `string` — 面向用户的显示名 |
| `detectTargetRoot` | 是 | `({ override, env }) => string` |
| `detectStatus` | 是 | `({ override, env }) => StatusObject` |
| `mapTargetPath` | 否 | `(asset, manifest, productConfig) => relPath` |
| `supportedAssetTypes` | 否 | `Array<"skill" \| "agent" \| "rule">` |
| `pluginInstallInstructions` | 否 | `() => string` |
| `supportsDirect` | 否 | `boolean` |
| `cliBinary` | 否 | `string`（`""` 表示跳过 CLI 存在性检查） |
| `cliInstallUrl` | 否 | `string` |
| `doctorProbes` | 否 | `({ targetRoot, env, productConfig }) => Array<{ name, ok, detail }>` |

可选字段缺省时由 `SPI_DEFAULTS` 注入内核默认值。SPI 定义见
[`scripts/installer/adapters/spi.mjs`](./scripts/installer/adapters/spi.mjs);
完整实现示例见
[`scripts/installer/adapters/claude.mjs`](./scripts/installer/adapters/claude.mjs)。

### Verbs & flags

| Verb | 用途 |
|---|---|
| `install` | 将 skills / agents / rules 安装到一个或多个 adapter target |
| `uninstall` | 卸载已安装的资产 |
| `update` | 重新安装资产,默认保留用户修改过的文件(除非 `--overwrite`) |
| `repair` | 仅重装与 manifest 已 drift 的资产 |
| `plan` | 预览 `install` / `update` 将要执行的写入,不落盘 |
| `list` | 打印 manifest 中的 skills 和 bundles |
| `agents` | 打印已知 adapter target 及其状态 |
| `validate` | 按 frontmatter 规则 lint 单个 `SKILL.md` 文件 |
| `export` | 将已安装状态归档为可移植文件 |
| `import` | 从归档恢复已安装状态 |
| `doctor` | 检查 adapter 健康度及已安装资产完整性 |
| `help` | 打印用法（由 CLI shell 直接处理,不走 kernel dispatch） |

所有 verb 都支持 `--json`。以下 flag 适用于状态变更类 verb(`install`、
`uninstall`、`update`、`repair`);`plan` 也接受选择类子集:

| Flag | 参数 | 用途 |
|---|---|---|
| `--agent` | `<id>`（可重复） | 限定 adapter target |
| `--skill` | `<id>` | 选定单个 skill |
| `--bundle` | `<id>` | 选定 bundle |
| `--all` | — | 选中 manifest 全部条目 |
| `--target` | `<path>` | 覆盖 adapter target 根路径 |
| `--profile` | `<name>` | 激活 sandbox / env profile |
| `--dry-run` | — | 预览改动不落盘 |
| `--yes` | — | 跳过确认提示 |
| `--overwrite` | — | 覆盖用户已修改文件 |
| `--force` | — | 绕过安全检查 |
| `--accept-modified` | `<relPath>` | 标记某文件为有意修改 |

完整 flag 列表:`node examples/sample-product/bin.mjs help`,按你的
`productConfig.binName` 动态渲染。单 verb:`<bin> <verb> --help` 或
`<bin> help <verb>`。

## For AI agents

需要程序化驱动 nexel 衍生 bin?产品无关的行为契约 —— 每个 verb、退出码
契约、`--json` envelope 形态、非交互 flag(`--yes`、`--json`)、help 可
发现性规则 —— 规范在
[`docs/AGENT-CLI-CONTRACT.md`](./docs/AGENT-CLI-CONTRACT.md)。它是稳定的
kernel 表面,与任何产品的 bin 名称或内容无关。
[`examples/sample-product/bin.mjs`](./examples/sample-product/) 是可直接
运行的实例,用于对照测试。

## Project

### Status

1.0 之前。名称已定(`nexel`);npm 发布与 public-API contract clock 刻意
延后并与命名决策解耦(见
[ADR-0007](./docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md),
取代
[ADR-0005](./docs/adr/0005-release-model-no-npm-provisional-name.md))。
公共表面仍在迭代 —— 请锁定 tag。

### Roadmap

- **后续** —— 基于 sample fixture 扩充测试覆盖、locale 目录插件、更多
  Adapter SPI 实现。分发维持 git-tag / git 依赖 / vendor;npm 发布仍延后。
- **v1.0.0** —— API 在生产环境经过至少一个外部 adopter 一个 quarter 稳定
  运行后触发。

### Tests

```sh
npm test
```

`npm test` 跑全套;`package.json` 里的 `test` script 是权威且始终最新的
清单。覆盖分层:per-module unit(`errors`、`asset-types`、`which`、
`plan`、`stage-asset`、`manifest` loader/validator/drift)、adapter
一致性(`spi`、`opencode`)、CLI 表面(`argv`、`dispatch`、
`lint-skills`、`lint-release-sync`)、Z 层守卫(`architecture`)、
`examples/sample-product/` 端到端(`sample-bin`、`repair-rehash`)。

### License

MIT —— 见 [LICENSE](./LICENSE)。

### Contributing

欢迎 Issues 与 PRs。较大改动 —— 新增 adapter、新增 verb、Public API 增项
或架构调整 —— 请先开 GitHub Issue 讨论方向,再着手实现。Bug 修复、文档
改进及 sample fixture 补充可直接提 PR。
