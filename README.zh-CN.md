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

**当前版本**: v0.1.0 — 首个 OSS 发布。API 表面已稳定，1.0 之前会根据使用者反馈做小迭代。

## 安装

```sh
npm install skillctl
```

依赖 Node ≥ 18，仅 ESM。

## 30 秒上手

仓库自带完整示例 [`examples/sample-product/`](./examples/sample-product/):

```
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
  productName:         "my-skills",
  skillIdPrefix:       "my",                // skill id 必须以 "my:" 开头
  agentNamePrefix:     "my-",               // agent installedName 必须以 "my-" 开头
  defaultManifestFile: "my.install.json",
  binName:             "my-skills",

  // 可选 (默认值如下):
  defaultSkillsDir: "skills",
  defaultAgentsDir: "agents",
  defaultRulesDir:  "rules",
  envProfile:       "MY_SKILLS_PROFILE",    // sandbox/profile 隔离用
  envBannerTitle:   "MY_SKILLS_BANNER_TITLE",
});
```

规则: `skillIdPrefix` 不可含 `:`；`agentNamePrefix` 必须以 `-` 结尾。

## Public API

`scripts/installer/index.mjs` 一次性导出全部稳定接口:

| 类别 | 导出 |
|---|---|
| **工厂** | `createCli`、`createAdapterRegistry`、`defineProductConfig` |
| **CLI 基础件** | `parseArgs`、`printHelp`、`handleError`、`formatSkipNote`、`dispatchVerb`、`KERNEL_HANDLERS`、`strings` |
| **Verb 处理器** | `runList`、`runAgents`、`runValidate`、`runExport`、`runImport`、`runRepair`、`runDoctor`、`runPlan`、`runInstall`、`runUninstall`、`runUpdate`、`resolveSelections` |
| **Manifest 流水线** | `loadManifest`、`validateManifest`、`defaultManifestPath`、`defaultPaths`、`pipeline` |
| **Adapter SPI** | `SPI_REQUIRED`、`SPI_DEFAULTS`、`validateAdapter` |
| **资产模型** | `assetTypes`、`defaultTargetMapping`、`whichSync` |
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

内置三个适配器: Claude Code、Codex、OpenCode。下游产品通过 `createCli({ adapters: [...] })` 注入额外适配器。每个适配器导出: `id`、`displayName`、`cliBinary`、`cliInstallUrl`、`supportsDirect`、`supportedAssetTypes`、`detectTargetRoot({ env })`、`mapTargetPath(asset, manifest)`、`doctorProbes`、`pluginInstallInstructions`。

SPI 定义见 [`scripts/installer/adapters/spi.mjs`](./scripts/installer/adapters/spi.mjs); 完整实现示例见 [`scripts/installer/adapters/claude.mjs`](./scripts/installer/adapters/claude.mjs)。

## Verbs

```
install   uninstall   update    list      plan      agents
doctor    repair      export    import    validate  help
```

所有 verb 都支持 `--json` 输出机器可读 JSON。涉及状态变更的 verb (`install` / `uninstall` / `update` / `repair`) 接受 `--agent <id>` (可重复)、`--target <path>`、`--profile <name>`、`--skill <id>`、`--bundle <id>`、`--all`、`--dry-run`、`--yes`、`--overwrite`、`--force`、`--accept-modified <relPath>`。

完整 flag 列表通过 `node examples/sample-product/bin.mjs help` 查看 — 输出会按你的 `productConfig.binName` 动态渲染。

## 测试

```sh
npm test
```

7 个测试套件: argv 解析、verb dispatch、manifest 加载器、adapter SPI 一致性、架构层守卫、skill linter、sample bin 端到端 smoke。单独跑:

```
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

欢迎 Issues 与 PRs。较大改动请先开 Issue 讨论方向。
