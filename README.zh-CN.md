<div align="center">

<img src="./assets/hero-banner.webp" alt="skillctl" width="100%" />

# skillctl

**通用 Agent 技能管理内核库 — 统一管理 Claude Code、Codex、OpenCode 上的 skills/agents/rules。**

[![npm version](https://img.shields.io/npm/v/skillctl?color=cb3837&label=npm&logo=npm)](https://www.npmjs.com/package/skillctl)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-43853d?logo=node.js&logoColor=white)](./package.json)
[![Type: ESM](https://img.shields.io/badge/type-ESM-f7df1e?logo=javascript&logoColor=black)](./package.json)
[![Tests](https://img.shields.io/badge/tests-101%20passing-2ea44f)](./scripts/installer/architecture.test.mjs)

[English](./README.md) · [中文](./README.zh-CN.md) · [快速上手](#30-秒上手) · [API](#public-api) · [示例](./examples/sample-product/)

</div>

---

## 概述

`skillctl` 是内核库。下游产品提供 `ProductConfig` 与 manifest，由 `skillctl` 负责校验、规划、安装/卸载/更新、状态追踪、drift 检测和多 adapter 分发。库自身完全产品无关 — bin 名、skill id 前缀、agent name 前缀、manifest 文件名、env var 命名空间，全部由 `ProductConfig` 注入。

> **当前版本：** v0.1.0 — 首个 OSS 发布。API 表面已稳定，1.0 之前会根据使用者反馈做小迭代。

## 安装

```sh
npm install skillctl
```

依赖 Node ≥ 18，仅 ESM。

## 30 秒上手

仓库自带完整示例 [`examples/sample-product/`](./examples/sample-product/):

```text
examples/sample-product/
├── agent-skills.config.mjs    # ProductConfig（产品身份的唯一来源）
├── sample.install.json        # Manifest
├── skills/  agents/  rules/   # 内容
├── bin.mjs                    # 以上述 config 包装 createCli
└── sample-bin.test.mjs        # spawnSync 端到端测试
```

运行:

```sh
node examples/sample-product/bin.mjs help
node examples/sample-product/bin.mjs list --json
node examples/sample-product/bin.mjs plan --agent codex --skill sample:hello-world
```

bin 输出的品牌名取决于你在 `productConfig.binName` 里设的值。一旦接入,`skillctl` 自身不会出现在任何 user-facing 文本里。

## ProductConfig

`defineProductConfig({...})` 是产品身份的唯一注入点。必填字段在构造期硬性校验:

```js
import { defineProductConfig } from "skillctl";

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

规则: `skillIdPrefix` 不可含 `:`；`agentNamePrefix` 必须以 `-` 结尾。

## Public API

`scripts/installer/index.mjs` 导出 v1 稳定契约。新增导出是向后兼容的，删除或重命名构成 breaking change。

| 类别 | 导出 |
|---|---|
| **工厂** | `createCli`、`createAdapterRegistry`、`defineProductConfig` |
| **CLI 基础件** | `parseArgs`、`printHelp`、`handleError`、`formatSkipNote`、`dispatchVerb`、`KERNEL_HANDLERS`、`strings` |
| **Verb 处理器** | `runList`、`runAgents`、`runValidate`、`runExport`、`runImport`、`runRepair`、`runDoctor`、`runPlan`、`runInstall`、`runUninstall`、`runUpdate`、`resolveSelections` |
| **Manifest 流水线** | `loadManifest`、`validateManifest`、`defaultManifestPath`、`defaultPaths`、`pipeline`、`detectDrift`、`exitCodeFor`、`formatFindings`、`SCHEMA_VERSION`、`PROFILES`、`CATEGORIES`、`HOSTS` |
| **Adapter SPI** | `SPI_REQUIRED`、`SPI_DEFAULTS`、`validateAdapter`、`applyAdapterDefaults`、`ADAPTERS`、`getAdapter`、`listAdapterStatus`、`assertSupportsDirect`、`assertCliPresent` |
| **资产模型** | `assetTypes`、`getAssetType`、`defaultTargetMapping`、`whichSync` |
| **Plan 期工具** | `buildInstallPlan`、`resolveSelection`、`transitiveAssets`、`formatPlanText` |
| **Kernel 命令** | `install`、`installMulti`、`uninstall`、`uninstallMulti`、`update`、`updateMulti`、`repair`、`exportCommand`、`importCommand`、`listCommand`、`agentsCommand`、`doctorCommand`、`planCommandText`、`planSelection` |
| **错误类** | `CommandError`、`AdapterError`、`ProductConfigError`、`StateError`、`FsError`、`PlanError`、`CancelledError`、全部 `ERR_*` 码 |

## 架构

`skillctl` 通过 `architecture.test.mjs` 强制 **Z 三层** 内核结构:

```
scripts/installer/
├── core/          # 纯逻辑；禁止反向依赖 cli/ 或 adapters/
├── adapters/      # 平台适配；禁止反向依赖 cli/
└── cli/           # 表面；可依赖 core/ 与 adapters/
```

Public API 桶 (`index.mjs`) 是下游唯一应该触碰的入口。

## Adapter SPI

内置三个适配器：Claude Code、Codex、OpenCode。下游产品通过 `createCli({ adapters: [...] })` 注入额外适配器。

每个适配器需导出以下 SPI v1 契约：

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

可选字段缺省时由 `SPI_DEFAULTS` 注入内核默认值。SPI 定义见 [`scripts/installer/adapters/spi.mjs`](./scripts/installer/adapters/spi.mjs)；完整实现示例见 [`scripts/installer/adapters/claude.mjs`](./scripts/installer/adapters/claude.mjs)。

## Verbs

| Verb | 用途 |
|---|---|
| `install` | 将 skills / agents / rules 安装到一个或多个 adapter target |
| `uninstall` | 卸载已安装的资产 |
| `update` | 重新安装资产，默认保留用户修改过的文件（除非 `--overwrite`） |
| `repair` | 仅重装与 manifest 已 drift 的资产 |
| `plan` | 预览 `install` / `update` 将要执行的写入，不落盘 |
| `list` | 打印 manifest 中的 skills 和 bundles |
| `agents` | 打印已知 adapter target 及其状态 |
| `validate` | 按 frontmatter 规则 lint 单个 `SKILL.md` 文件 |
| `export` | 将已安装状态归档为可移植文件 |
| `import` | 从归档恢复已安装状态 |
| `doctor` | 检查 adapter 健康度及已安装资产完整性 |
| `help` | 打印用法（由 CLI shell 直接处理，不走 kernel dispatch） |

所有 verb 都支持 `--json` 输出机器可读 JSON。以下 flag 适用于状态变更类 verb（`install`、`uninstall`、`update`、`repair`）；`plan` 也接受选择类子集：

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

完整 flag 列表通过 `node examples/sample-product/bin.mjs help` 查看 — 输出会按你的 `productConfig.binName` 动态渲染。

## 测试

```sh
npm test
```

7 个测试套件：argv 解析、verb dispatch、manifest 加载器、adapter SPI 一致性、架构层守卫、skill linter、sample bin 端到端 smoke。单独跑：

```sh
npm run test:lint           # SKILL.md frontmatter 校验
npm run test:loader         # Manifest 路径解析
npm run test:argv           # CLI 参数解析
npm run test:dispatch       # Verb -> handler 分发表
npm run test:spi            # Adapter SPI v1 合约
npm run test:architecture   # Z 三层依赖方向守卫
npm run test:sample-bin     # examples/sample-product 端到端
```

## Roadmap

- **v0.2.0** — npm subpath exports (`skillctl/adapters/*`)、基于 sample fixture 扩充测试覆盖、locale 目录插件、更多 Adapter SPI 实现
- **v1.0.0** — API 在生产环境经过至少一个外部 adopter 一个 quarter 稳定运行后触发

## License

MIT — 见 [LICENSE](./LICENSE).

## 贡献

欢迎 Issues 与 PRs。较大改动 —— 新增 adapter、新增 verb、Public API 增项或架构调整 —— 请先开 GitHub Issue 讨论方向，再着手实现。Bug 修复、文档改进及 sample fixture 补充可直接提 PR。
