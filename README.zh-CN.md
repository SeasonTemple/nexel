<div align="center">

<img src="./assets/hero-banner.webp" alt="nexel" width="100%" />

# nexel

**产品无关内核 —— 一套 agent-skill pack 写一次,经可插拔 adapter SPI 适配到任意 agent CLI;Claude Code、Codex、OpenCode 内置。**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-43853d?logo=node.js&logoColor=white)](./package.json)
[![Type: ESM](https://img.shields.io/badge/type-ESM-f7df1e?logo=javascript&logoColor=black)](./package.json)
[![Tests](https://img.shields.io/badge/tests-253%20passing-2ea44f)](./scripts/installer/architecture.test.mjs)

[English](./README.md) · [中文](./README.zh-CN.md) · [为什么](#为什么用-nexel) · [快速开始](#快速开始) · [核心模型](#核心模型) · [参考](#参考) · [Agent 契约](#ai-agent-cli-契约) · [示例](./examples/sample-product/)

</div>

---

## 为什么用 nexel

将一套 agent skills、subagents、rules 同时发布到多个 agent CLI,通常意味着
每个工具一条独立安装路径。各 target 把资产存在不同位置、要求不同的
frontmatter 形态,于是安装逻辑、状态追踪、drift 检测被逐 target 重复实现、
逐 target 单独调试:

```text
                  ┌─ agent CLI #1 ─ install · state · drift   (path 1)
  one skill pack ─┼─ agent CLI #2 ─ install · state · drift   (path 2)
                  └─ agent CLI #N ─ install · state · drift   (path N)

    N targets  ⇒  N re-implemented, separately-debugged paths
```

`nexel` 将这部分整合进单一内核。消费产品提供一份 `ProductConfig` 与一份
manifest;内核负责校验、规划、安装/卸载/更新、状态追踪、drift 检测,并经
可插拔 adapter 在边界向每个 target 扇出:

```text
  ProductConfig ┐                            ┌─ Claude Code  ┐
                ├─► nexel kernel ─dispatch─► ┼─ Codex         │ built-in
  manifest ─────┘   validate · plan ·        ├─ OpenCode      ┘
                    install/uninstall/       └─ any CLI ── via adapter SPI
                    update · state · drift
```

内核不携带任何产品知识 —— bin 名、skill-id 前缀、agent-name 前缀、manifest
文件名、env 命名空间,全部经 `ProductConfig` 注入。支持一个新 CLI 即新增
一个 adapter,而非重写。

> 以 agent 程序化驱动 nexel 衍生 bin(而非自行编写)者,参见
> [AI agent CLI 契约](#ai-agent-cli-契约):行为契约单独规范,且为稳定
> kernel 表面。

## 快速开始

### 安装

未发布 npm。通过锁定的 git tag 消费 —— clone、git 依赖或 vendor:

```sh
# git 依赖（package.json），锁定到发布 tag
npm install "git+https://github.com/<owner>/nexel.git#v0.6.0"
```

```sh
# 或 clone + 锁定 tag
git clone https://github.com/<owner>/nexel.git && cd nexel && git checkout v0.6.0
```

依赖 Node ≥ 18,仅 ESM。每个 tag 的发布说明见
[`docs/release-notes/`](./docs/release-notes/)。

本地 release artifacts 可在不发布 npm 的情况下生成:

```sh
npm run release:preflight
npm run dist
```

`dist` 写出 `nexel-<version>.tgz` 与 `.sha256` checksum。远端发布仍是消费
产品自己的决策。

### 面向人类 —— 运行或构建产品

完整、可运行的示例位于
[`examples/sample-product/`](./examples/sample-product/):

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

bin 的品牌名由 `productConfig.binName` 决定;产品接入后,`nexel` 自身不
出现在任何面向用户的文本中。构建产品见 [ProductConfig](#productconfig)。

### 面向 AI agent —— 驱动 bin

任何 nexel 衍生 bin 均为非交互、可机器驱动:每个 verb 接受 `--json`(结构化
stdout 输出信封),`--yes` 跳过提示,退出码契约稳定。完整的产品无关行为契约
见 [`docs/AGENT-CLI-CONTRACT.md`](./docs/AGENT-CLI-CONTRACT.md),详述于
[AI agent CLI 契约](#ai-agent-cli-契约) 一节。

人类可读输出可通过 `--lang en|zh`、`NEXEL_LANG` 或产品专属 locale env
锁定。JSON key 与错误码不翻译。

## 核心模型

以下五个术语支撑全文。

| 术语 | 含义 |
|---|---|
| **Kernel** | `scripts/installer/` 中的产品无关库。负责安装/卸载/更新/状态/drift/规划。对任何产品的内容零认知。 |
| **ProductConfig** | 由消费产品传入、按产品冻结的身份(`productName`、`skillIdPrefix`…)。没有它内核即空载(inert)。 |
| **Adapter** | 针对单个 CLI 的可插拔集成,实现 adapter SPI。决定资产落点与内容转换方式。Claude Code、Codex、OpenCode 内置;任意其它 CLI 通过提供 adapter 即可触达。 |
| **Asset** | 内核安装的单位 —— **skill**、**agent**、**rule** 三者恰取其一。非泛指文件。 |
| **Manifest** | `install.json` —— 唯一真相源。一个资产对内核可见 **当且仅当** 它有 manifest 条目。 |

关系:

```text
  ProductConfig ──configures──► Kernel ──dispatch──► Adapter ──► target CLI
                                  ▲                      ▲
                                  │ reads                │ maps + transforms
                               Manifest ──declares──► Asset
                                                    (skill | agent | rule)
```

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

## 设计原则

内核为何如此设计。下列每条均被强制或被记录,而非口号。

1. **产品无关内核。** 对产品零认知;没有 `ProductConfig` 即空载(inert),
   且配置错误时在 `defineProductConfig` 处抛错 —— 而非等到首次使用。
   ([ADR-0001](./docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md))
2. **Manifest 是唯一真相源。** 无 manifest 条目 → 内核看不见该资产。不存在
   隐式文件系统发现。
3. **Z 三层,由测试强制。** `index.mjs` 是唯一公共入口;层方向守卫是
   `architecture.test.mjs`,而非约定。
   ([ADR-0001](./docs/adr/0001-adopt-adr-practice-and-record-frozen-invariants.md))

   ```text
   scripts/installer/
   ├── core/      # 纯逻辑；禁止反向依赖 adapters/ 或 cli/
   ├── adapters/  # 平台适配；禁止反向依赖 cli/
   └── cli/       # 表面；可依赖 core/ 与 adapters/
   ```

4. **幂等、状态追踪、drift 感知。** `install` / `update` / `repair` 在已
   记录的磁盘状态上有明确语义;`repair` 只重装与 manifest drift 的部分。
   ([ADR-0008](./docs/adr/0008-unfreeze-state-dirname-rename-to-nexel.md))
5. **解耦纪律。** npm 发布与公共 API 契约时钟刻意与命名决策解耦并延后 ——
   发布前的内部 API 变动属清理,而非契约破坏。
   ([ADR-0007](./docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md))
6. **ADR 记录权衡。** 难以回退、缺上下文会令人意外的决策,各以一个文件
   记录于 [`docs/adr/`](./docs/adr/)。

## 参考

> 查阅性材料 —— 非必读;需查具体导出、verb 或 flag 时再来。

### 公共 API

`scripts/installer/index.mjs` 导出 v1 稳定契约。新增导出向后兼容;删除或
重命名构成破坏性变更。

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

### OpenCode direct 与 plugin mode

OpenCode 有两条产品无关集成路径:

- Direct install 由 OpenCode Adapter 处理。它将 skills 写入 `skills/`,
  将转换后的 agents 写入 `agent/`,并按 manifest 路径写入 rule reference
  files。它不写 `AGENTS.md`。
- Plugin mode 由消费产品自己的 OpenCode plugin 处理。plugin 可从
  `nexel/adapters/opencode-plugin` 导入 `configureOpenCode`,并传入已安装
  的 `skills` 目录。helper 会把该目录追加到 `config.skills.paths`,并将
  skill frontmatter 中声明的
  `opencode-instructions: <skill-relative-path>` 文件追加到
  `config.instructions`。

`opencode-instructions` 是 Skill Metadata,不是 Manifest 条目,也不是新的
Asset 类型。引用文件必须留在声明它的 skill 目录内。示例见
[`examples/sample-product/.opencode/plugins/sample-product.js`](./examples/sample-product/.opencode/plugins/sample-product.js)。

### Verb 与 flag

| Verb | 用途 |
|---|---|
| `install` | 将 skills / agents / rules 安装到一个或多个 adapter target |
| `uninstall` | 卸载已安装的资产 |
| `update` | 重新安装资产,默认保留用户修改过的文件(除非 `--overwrite`) |
| `repair` | 仅重装与 manifest 已 drift 的资产 |
| `plan` | 预览 `install` / `update` 将要执行的写入,不落盘 |
| `list` | 打印 manifest 中的 skills 与 bundles |
| `agents` | 打印已知 adapter target 及其状态 |
| `validate` | 按 frontmatter 规则 lint 单个 `SKILL.md` 文件 |
| `export` | 将已安装状态归档为可移植文件 |
| `import` | 从归档恢复已安装状态 |
| `doctor` | 检查 adapter 健康度及已安装资产完整性 |
| `help` | 打印用法（由 CLI shell 直接处理,不进入 kernel dispatch） |

所有 verb 均支持 `--json`。以下 flag 适用于状态变更类 verb(`install`、
`uninstall`、`update`、`repair`);`plan` 也接受其中的选择类子集:

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

完整 flag 列表:`node examples/sample-product/bin.mjs help`,按
`productConfig.binName` 动态渲染。单 verb:`<bin> <verb> --help` 或
`<bin> help <verb>`。

## AI agent CLI 契约

用于程序化驱动 nexel 衍生 bin 的产品无关行为契约 —— 每个 verb、退出码
契约、`--json` 输出信封结构、非交互 flag(`--yes`、`--json`)、help 可
发现性规则 —— 规范见
[`docs/AGENT-CLI-CONTRACT.md`](./docs/AGENT-CLI-CONTRACT.md)。它是稳定的
kernel 表面,与任何产品的 bin 名称或内容无关。
[`examples/sample-product/bin.mjs`](./examples/sample-product/) 是可直接
运行的实例,用于对照测试。

## 项目

### 状态

1.0 之前。名称已定(`nexel`);npm 发布与公共 API 契约时钟刻意延后并与
命名决策解耦(见
[ADR-0007](./docs/adr/0007-rename-to-nexel-and-decouple-publish-decision.md),
取代
[ADR-0005](./docs/adr/0005-release-model-no-npm-provisional-name.md))。
公共表面仍在迭代 —— 请锁定 tag。

### 路线图

- **后续** —— 基于 sample fixture 扩充测试覆盖、locale 目录插件、更多
  Adapter SPI 实现。分发维持 git-tag / git 依赖 / vendor;npm 发布仍延后。
- **v1.0.0** —— API 经至少一个外部采用方在生产环境稳定运行一个季度后
  触发。

### 测试

```sh
npm test
```

`npm test` 跑全套;`package.json` 中的 `test` script 是权威且始终最新的
清单。覆盖分层:按模块单元测试(`errors`、`asset-types`、`which`、
`plan`、`stage-asset`、`manifest` loader/validator/drift)、adapter
一致性(`spi`、`opencode`)、CLI 层(`argv`、`dispatch`、`lint-skills`、
`lint-release-sync`)、Z 层守卫(`architecture`)、`examples/sample-product/`
端到端(`sample-bin`、`repair-rehash`)。

### 许可证

MIT —— 见 [LICENSE](./LICENSE)。

### 贡献

欢迎 Issue 与 PR。较大改动 —— 新增 adapter、新增 verb、公共 API 增项或
架构调整 —— 请先开 GitHub Issue 讨论方向,再着手实现。Bug 修复、文档
改进及 sample fixture 补充可直接提 PR。
