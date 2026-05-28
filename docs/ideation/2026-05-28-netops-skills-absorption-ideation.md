---
date: 2026-05-28
topic: netops-skills-absorption
focus: 从 ~/workspace/netops-agent-skills 挖掘可吸收 / 可孵化为更高阶形态的能力，聚焦 installer/lifecycle、skill 治理、跨 agent runtime、doc/ADR、self-improve hook、collector/absorber 元工具
mode: repo-grounded
---

# Ideation: NAS → nexel 能力吸收 + 高阶形态孵化

> **Grill Pass 状态 (2026-05-28)**: 经 `/grill-with-docs` 7 轮拷打（G1–G7），原 7 个 ranked ideas 已重整为 **8 条**（Idea 4 拆为 4a/4b）。CONTEXT.md 加 `Vendoring` 词条（G1）；多处术语漂移修正；Idea 5/7 范围缩小。Post-grill 排序在文末 §Post-Grill Ranking。三个 ADR 候选记录在 §Open ADR Candidates。

## Grounding Context

### Source: netops-agent-skills (NAS, v0.24.0, `~/workspace/netops-agent-skills/`)
- 三层 installer kernel (`scripts/installer/{core,adapters,cli}` ~1200 LOC) + 5-stage 原子 pipeline + `state.json.bak` recoverySweep
- SHA-256 (LF-normalized) per-file hash + `referencedBy` 引用计数 + `<target>/.netops-agent-skills/.lock` 互斥
- SPI v1.1 `transformAssetContent` 内容转换 hook (ADR-0002 NAS)；只用于 Claude→OpenCode YAML schema 翻译
- 三平台 marketplace 抽象 (`.claude-plugin/`, `.codex-plugin/`, `.opencode/`) + 单 SKILL.md 源树
- 32 skills, 28 agents, 3 bundles. 6-bucket frontmatter 分类 (principle/best-practice/test/review/tool/setup)
- 14 个 OBEY-* principle skills (Fowler/Evans/Vernon/Ousterhout/Kleppmann/Nygard/Martin/Hunt&Thomas/McConnell/Feathers) + 互斥关系仅写在 SKILL.md 散文里
- skill-analyzer (agent-neutral) + skill-collector + skill-absorber (**0 production runs**, 13/13 promotion 走手工 cp+manifest edit+MR 捷径)
- install-plane / activation-plane 分离 (NAS ADR-0009 NAS): installer 放文件，`setup-help` skill 写 runtime config
- `.baseline/` 字节级回归 oracle (7 canonical commands)
- i18n CLI (EN/ZH per locale)，gitlab-issue-workflow (强 NAS-specific)
- 已经验证的痛点：skill-absorber 设计完整从未投产；rule assets v0.14.0 retired (NAS ADR-0008 NAS); `repair` 历史上的 staged-hash bug

### Target: nexel (CWD, v0.7.0)
- 14 verbs，SPI v1.2，11 ADRs，frozen Z 三层
- ADR-0004 已显式排除：skill-{collector,analyzer,absorber,forge}、PROVENANCE.md、ABSORBED.md、INSTALL-FOR-AGENTS.md、verify-baseline.mjs、gitlab-workflow、四 manifest lockstep（v0.7 吸收部分）
- npm publish 延后；v1.0 时钟在 ≥1 production downstream adopter 跑满一个季度后才启动
- ADR-0008 unfroze state dirname 的判据是 "adoption 仍为 0" — 类似的 freeze 决策可在 adoption=0 窗口低成本翻新
- 已交付：state 双重校验 (U1)、SPI v1.2 ProductConfig 注入 (U4)、三平台 plugin layout sample (U5)、marketplace lockstep helper (U6)、scaffold verb (U7)
- 显式延后：typed-error loader 层，`renderNextSteps` 产品字面量解耦

### 关键约束 (ADR-0006 boundary)
任何提议必须通过「kernel-generic vs product-private」测试：要 core 包含产品字面量、特定 CLI 知识、固定命令清单、特定分发渠道 → 必须 reframe 为 sister package 或 examples/，**不要**塞进 kernel。

## Topic Axes

1. Kernel-installer 容错性
2. Adapter SPI 表达力
3. Meta-tooling lifecycle
4. Governance & discipline
5. Distribution & ecosystem

## Ranked Ideas

### 1. Skill Vendoring — declarative `vendorFrom` + provenance sidecar + `@nexel/vendor` 姊妹包

> **术语校正 (grill G1)**: 不再使用 "Absorber" — 与 CONTEXT.md `Absorption` 词条（专指 netops→kernel 单向演化）语义冲突。改用 `Vendoring`（生态熟词，方向语义正确，参考 Go modules / Cargo vendor）。Glossary 项见 CONTEXT.md。

**Description:** 不要把 NAS 的 skill-collector / skill-absorber 拉进 kernel（ADR-0004 已正确排除）。Incubate 成独立姊妹包 `@nexel/vendor`，**kernel 完全不参与**：(a) 姊妹包定义 product-side config (例如 `vendor.config.mjs` 或 product 自家的 manifest 扩展) 声明 `vendorFrom: [{source, path, as}]`；(b) 每个 vendored skill 写 `.vendored.json` sidecar 记录 `{originUri, originHash, vendoredAt, divergencePolicy, supersedes}`；(c) `@nexel/vendor` 提供 `vendor {pull|diff|fork}` CLI — 干净时快进，本地有改动时 refuse + 3-way diff，`fork` 切脐带删 sidecar。把 NAS 8 步过程性流程 (collected-skills → ABSORBED.md → manifest edit → frontmatter align → self-improve inject → ...) 折成一行 config + 自动 resolve。

**关键 boundary 决策**: ProductConfig 不 加 `vendorFrom` 字段（保 kernel-generic 边界更干净，呼应 ADR-0006）。姊妹包**消费 kernel public API**，但反向不依赖。

**Axis:** Meta-tooling lifecycle

**Basis:** `direct:` — NAS `skill-absorber/SKILL.md` 设计完整、13/13 promotion 全走手工捷径绕过它（0 个 ABSORBED.md 在生产）。`external:` — Go modules `vendor/`、Cargo `[patch]` 表、Git subtree (vs submodule)。`reasoned:` — vendoring 隐含「外部进自家 + 保留 origin 标识 + 可继续 pull」单向语义，比 absorber 一锤子 copy 强一个量级。

**Rationale:** 用户明确点名 collector/absorber 类元工具。Vendoring 既保住 ADR-0006 边界（kernel 0 改动），又把 NAS 投产失败的设计真正升级出能跑的形态。`vendorFrom` 行就是机器可读的 ABSORBED.md，配合 sidecar 让上游 pull 可持续，而不是一锤子买卖。

**Downsides:** 新姊妹包需要独立版本节奏与文档；`.vendored.json` 在 host 上多一种文件类型；divergence policy 设计需要打磨（auto-FF / manual-merge / pinned 等）；姊妹包**不能依赖未公开的 kernel internal**，意味着它需要 kernel 先 publish 公共 API（与 ADR-0005 的 deferred publish 张力 — 见 G8 reconciliation）。

**Confidence:** 85%

**Complexity:** Medium (kernel **零** 改动；所有逻辑在 `@nexel/vendor` 姊妹包，使用 kernel 已公开的 API)

**Status:** Unexplored

---

### 2. Principle-Pack Ecosystem — frontmatter schema + @nexel/governance 姊妹包 + kernel Pluggable Validator Rule Registry

> **Boundary 校正 (grill G2)**: 不扩 Asset 枚举（CONTEXT.md "Asset: Exactly one of skill/agent/rule" 保持封闭）。principle 是 **skill** asset 的子类，靠 frontmatter 字段表达；check hook 落在 `@nexel/governance` 姊妹包；kernel 唯一新增是**通用** Pluggable Validator Rule Registry（任何 product 都能用，不绑 principle）。

**Description:** 三件分层：
1. **Frontmatter 扩展（product-private）**: skill SKILL.md 加 `school: <id>` + `conflicts_with: [<skill-id>, ...]` + `pack: <pack-id>` 三个可选字段。Glossary 上属 "Skill Metadata"（CONTEXT.md 已存在的 first-class 概念），不创建新 Asset 类型。
2. **`@nexel/governance` 姊妹包**: 消费 kernel public API 解析 frontmatter，构建冲突图，提供 `governance check` CLI 验证 install set 内有无冲突；多 pack 共存时打印拓扑解释并 refuse。OBEY-X 14 个 skill 内容**仍是 product-private**（NAS 或任何想用的 product 自己维护）。
3. **Kernel 唯一改动 — Pluggable Validator Rule Registry**: 通用扩展点 — `ProductConfig.validatorRules?: ValidatorRule[]` 或 plugin hook 让外部包（`@nexel/governance`、其他）注册检查规则；规则跑在 `nexel validate` / `lint:skills` 时；返回结构化 Diagnostic。这一个 affordance 是 kernel-generic（任何产品都能加自己的检查），principle-pack 只是首个消费者。

**Axis:** Governance & discipline

**Basis:** `direct:` — NAS 14 个 OBEY-* skill 结构高度一致 (when-to-load / conflicts-with / key tenets)，3 个互引；NAS SKILL.md body 显式警告"不要 always-on"+ 冲突仅用中文散文。`external:` — Mod manager (Vortex / MO2) 显式冲突声明 + load-order resolution；apt/dpkg `Conflicts:` / `Breaks:` header；ESLint `extends` 链 + 自定义规则注册。`reasoned:` — 14 个 artifact 是 1 个能力 (declare-which-school) 的 14 个数据点；今天的冲突 enforce 完全靠用户读散文 — kernel 无法防范"同时 load PoEAA + IDDD"的真实矛盾输出；同时 kernel 不需要知道"DDD 是什么"，它只需要提供一个**让外部规则插进来**的接口。

**Rationale:** Kernel 学到的是 *generic 扩展点*（validator rule registry），用 ADR-0006 测试是 kernel-generic ✓。"OBEY-X 14 个 skill" 是 product-private（任何 product 都可借用，但 kernel 不携带）。这是 ADR-0006 的标准应用：kernel 加 affordance，product 决定语义。

**Downsides:** 用户必须了解到「冲突 enforce 不在 kernel 而在 `@nexel/governance`」— 多一层心智；validator rule registry 一旦 public 几乎不可改（要进入 G8 的 ADR 候选）；姊妹包之间无依赖契约（`@nexel/governance` 是否要消费 `@nexel/vendor` 的 `.vendored.json` provenance？open question）。

**Axis:** Governance & discipline

**Basis:** `direct:` — NAS 14 个 OBEY-* skill 结构高度一致 (when-to-load / conflicts-with / key tenets)，3 个互引；NAS SKILL.md body 显式警告"不要 always-on"+ 冲突仅用中文散文。`external:` — Mod manager (Vortex / MO2) 显式冲突声明 + load-order resolution；apt/dpkg `Conflicts:` / `Breaks:` header；ESLint `extends` 链。`reasoned:` — 14 个 artifact 是 1 个能力 (declare-which-school) 的 14 个数据点；今天的冲突 enforce 完全靠用户读散文 — kernel 无法防范"同时 load PoEAA + IDDD"的真实矛盾输出。

**Rationale:** 这是用户问题「孵化为更高阶形态」最响亮的答案。OBEY-X pattern 公开领域无先例（web research 确认），nexel 把它做成 schema 等于产出原创设计资产；同时 kernel 只学到「mutually-exclusive group + check hook」两个 kernel-generic affordance，不需要懂 DDD / Fowler 任何具体内容，product-agnostic 测试通过。

**Downsides:** schema 设计风险（取错会反复 break）；check 执行机制需要新 sub-API（lint vs ast-grep vs agent prompt 三类异质）；可能需要 expand 受支持的 asset types (Idea 7 的子集)。

**Confidence:** 80%

**Complexity:** High (schema + 冲突图 resolver + check hook + 新 verb)

**Status:** Unexplored

---

### 3. Optional Staged Content Pipeline SPI — additive minor + self-improve as stage

> **Boundary 校正 (grill G6)**: 原稿 "mandatory pipeline 所有 adapter 必须声明" 破坏 ADR-0002 + ADR-0010 共同建立的 SPI **additive-optional + identity-default = minor** invariant。改为 **optional `contentPipeline?: Stage[]` 与现有 `transformAssetContent?` 并存**；conformance suite 负责断言 round-trip 正确，不强制声明。SPI v1.3 仍是加性 minor bump。

**Description:** v1.3 加 optional `contentPipeline?: Stage[]` 字段，每个 stage `{ id, when: 'plan'|'stage'|'lint', run: (asset, ctx) => {content, warnings} }`。与 v1.2 的 `transformAssetContent?` **并存**：
- adapter 只声明 `transformAssetContent` → kernel auto-promote 为 1-stage pipeline，行为不变
- adapter 声明 `contentPipeline` 即用 pipeline；同时声明两者则 pipeline 优先
- 都不声明 → 空 pipeline → identity round-trip (SPI_DEFAULTS 不变)

NAS 从未投产的 `--self-improve` hook 重新定位为 "pipeline 内的一个 stage"（纯函数，install-time 跑，无 daemon、无 LLM-at-install），架构上解耦从未实现的 runtime 自演化。Lint 也可作为 `when: 'lint'` stage 跑（lint 与 transform 共享执行模型，逐步替代 `lint-skills.mjs` 的并行实现）。

**Axis:** Adapter SPI 表达力

**Basis:** `direct:` — ADR-0002 v1.1 single hook 只服务 Claude→OpenCode 翻译一个 use case；ADR-0010 v1.2 ProductConfig 注入也是同形态加性扩展；NAS `skill-absorber/SKILL.md` 提到 `--self-improve hook` 但代码不存在。`external:` — rollup / postcss / unified+remark stage pipeline；OCI image layer transforms。`reasoned:` — 加 stages 不要求 adapter 声明任何东西；conformance suite 用 fixture 跑空 pipeline 也能断言 round-trip — testability 与 mandatory 解耦。

**Rationale:** 一次加性 SPI 升级解锁四个东西：(a) 第三方 stage pack (zh↔en 翻译、cost-estimate inject)，(b) Lint 与 transform 同执行模型，(c) self-improve 找到设计落点而非 runtime daemon，(d) cross-CLI sanitization 统一着陆点。**保 ADR-0010 additive-optional invariant + identity default + 无 breaking change**。

**Downsides:** SPI v1.3 加字段；现有 adapter 可不动；conformance suite 要更新（但只是新增 stage 断言，不破现有 v1.2 conformance）；同时存在两种声明方式（`transformAssetContent` 和 `contentPipeline`）的认知负担 — 文档需明确 promotion 规则。

**Confidence:** 85% (重框后基础牢)

**Complexity:** Medium

**Status:** Unexplored

---

### 4a. Plugin Runtime 横向扩展 — claude-plugin + codex-plugin 镜像 opencode-plugin

> **Boundary 校正 (grill G3)**: 原稿 `@nexel/activate` 姊妹包**重复发明**了 ADR-0009 + CONTEXT.md 已落地的 **Plugin Runtime** 概念。删除姊妹包提法；改用既有 subpath-export 模式 (`scripts/installer/adapters/<cli>-plugin.mjs`)，在 kernel 包内、**不**从主 `index.mjs` re-export（保 kernel 主接口干净，ADR-0009 决策延续）。

**Description:** 既有 `opencode-plugin.mjs` 是 Plugin Runtime 唯一实现，覆盖面只 OpenCode。横向扩两件 helper：
1. **`claude-plugin.mjs`** — 消费已安装 skill 路径 + ambient instruction 文件，写 CLAUDE.md fence / Claude Code marketplace JSON 同步；Skill Metadata `claude-instructions: <relative-path>` 声明
2. **`codex-plugin.mjs`** — 同形态，写 AGENTS.md / Codex marketplace 同步；Skill Metadata `codex-instructions:`

三个 `<cli>-plugin` helper 同 dimensionality + 同导出模式（`./adapters/<cli>-plugin` subpath，主 index 不暴露）。Skill Metadata category/profile agnostic、不创建 Asset、不进 manifest（沿 ADR-0009）。

**Axis:** Adapter SPI 表达力 + Distribution & ecosystem

**Basis:** `direct:` — ADR-0009 已确立 Plugin Runtime + subpath 导出 + Skill Metadata 形态；opencode-plugin 是 working precedent。`reasoned:` — 加一个 CLI 用"新姊妹包"路线认知成本高（多版本协调 + 两次 install），用既有 subpath 模式认知成本零。

**Rationale:** 填补「install-plane / activation-plane 分离 only OpenCode 落地」的覆盖洞，不引入新概念，不破现有 ADR。

**Downsides:** Skill Metadata 字段从 1 个涨到 3 个；可能存在「合并为单一 host-instructions field + adapter 选择」更进一步设计，留待 brainstorm。

**Confidence:** 90%

**Complexity:** Low-Medium

---

### 4b. Multi-tenant install plane + `runTransactional` public primitive

**Description:** 两件独立 kernel 升级（与 4a 无技术耦合）：
1. **Multi-tenancy** — kernel 加 `<target>/.nexel/host-registry.json` 列同 host 所有 ProductConfig (productName / skillIdPrefix / install path)；新 verb `nexel hosts` + `nexel host gc`；install-time 拒绝 prefix 冲突 + 打印冲突 product 名
2. **`runTransactional(steps, {onRollback})`** — 把现有 5-stage + recoverySweep 提到 `installer/index.mjs` public API，每个 step 声明 `apply/rollback/verify`，downstream 自定义 verb 免费拿崩溃安全

**Axis:** Kernel-installer 容错性 + Distribution & ecosystem

**Basis:** `direct:` — nexel CLAUDE.md "atomic safety" 未作公共 API；`ProductConfig.skillIdPrefix` enforcement 设计本身假设多租户世界。`external:` — asdf/mise tool isolation, Nix profile, Python virtualenv。`reasoned:` — ADR-0008 unfroze state dirname 的判据是 "adoption=0"；反过来 adoption=N 时 host-collision 必然成为头号工单 — 现在做最便宜。

**Rationale:** 多 adopter 时表面会塌位置的提前加固。host-registry + transactional 互不依赖但都 distribution-scale 必需品。Public transactional API 还能给 4a 的 plugin-runtime helper 用（每个 fence 注入做成 transactional step）。

**Downsides:** state schema 扩展（host-registry 是新文件，需先决定 per-host 还是 per-product）；transactional API 一旦 public 几乎不可改 — 进 G8 ADR 候选。

**Confidence:** 75%

**Complexity:** Medium-High

**Status:** Unexplored

---

### 5. State schema-migration ladder（缩范围版）

> **Boundary 校正 (grill G5)**: 原稿三件套 (CAS state / 删 repair / migration ladder) 拆分。**仅保留 ladder (5c)** 为 ranked survivor — 无依赖、立刻可做、为后续所有 state 演化兜底；做完后**反而让 CAS 不再依赖 pre-adoption 窗口**（任何 schema 变更走 ladder）。原 (a) CAS state + (b) 删 repair 降级为 open question (见下方)。
> ADR-0008 的 pre-adoption 窗口论证已用过一次（state dirname unfreeze），二次使用论证力衰减；先建 ladder，把"pre-adoption 窗口"从一次性资源变成可重入。

**Description:** `state.json` 标 `stateSchema: N`，每次启动 kernel 读 version，walk 注册的 `v(N) → v(N+1)` 纯函数迁移链，rewrite state 后跑 verb；迁移过程 logged 给用户看。adapter 可注册自家 subtree 的迁移（如 Plugin Runtime metadata format 变更）。

**Axis:** Kernel-installer 容错性

**Basis:** `external:` — Stardew Valley / Factorio save-version 迁移、Rails `db/migrate/` + `schema_migrations`、Chrome extension `manifest_version` bump sunset window。`direct:` — ADR-0008 已经经历过一次需要破 state 形态的局面（彼时 unfroze dirname），但当时没有 ladder 这种基础设施 — 下次再需要变 schema 时同样的 ADR 论证不可重复使用。`reasoned:` — ladder 把"pre-adoption 窗口"从一次性昂贵资源变成可重入操作；nexel pre-1.0 这个窗口正好是建 ladder 的便宜时机。

**Rationale:** 让未来任何 state schema 变更不再是 breaking change（包括 5a CAS、host-registry from 4b、principle-pack metadata、其他未知）。是所有其他 state-touching idea 的 risk 降低器。

**Downsides:** 加一层启动开销（migration check）；ladder 一旦 public 几乎不可改（需要 G8 ADR 候选）；迁移函数必须 pure，难以引入跨 step 状态。

**Confidence:** 85% (单独做风险低、价值高)

**Complexity:** Medium

**Open question (推迟决策)**:
- **5a — Content-addressed state**: 把 state.json 从 path→on-disk-hash 改为 assetId→content-hash-of-source。需要 Windows symlink/copy 策略、需要 Idea 3 pipeline 输出 hash contract 协调。建议 ladder 落地后走 v(N)→v(N+1) 迁移做，不抢 pre-adoption 窗口。
- **5b — 删 repair verb，install 变 reconciler**: conditional on 5a；`repair` 当前的"只重装 drifted"优化要么保留要么牺牲 — 单独无法判断。Brainstorm 时一起算账。

**Status:** Unexplored

---

### 6. Adapter Capability Handshake + 公开 Conformance Harness + Doctor Probe Registry

**Description:** 三件套打包成 "adapter 生态系统基础设施"：(a) **Capability handshake** — adapter 加 `capabilities()` 返回 `{ spiVersion, capabilities: ['content-pipeline', 'activation-plane', 'doctor-probes', 'recovery-sweep'] }`；kernel 在 dispatch 前查 capability 决定是否 offer 某 verb；新 kernel feature 通过 capability 渐进 opt-in，旧 adapter 不动也不破。(b) **`@nexel/adapter-conformance`** 发布包 — 第三方 adapter 作者 devDep 装上、指自家 export、拿到分级 conformance 报告 (SPI v1 / content-pipeline / lifecycle / idempotency)。版本与 SPI 同步。(c) **Doctor probe SPI** — adapter 注册 `probes()` 返回 `Probe[]` (`{id, severity, message, fixHint, autofixable}`)；`nexel doctor` 汇总跑全所有 adapter + product 注册的 probe，统一 JSON 信封 + 退出码。

**Axis:** Adapter SPI 表达力 + Distribution & ecosystem

**Basis:** `external:` — LSP `initialize` capability negotiation (跨编辑器可移植性的 ground truth)、MCP capability declaration、WebDriver W3C 一致性套件、OCI image-spec conformance、`mise doctor` ~20 个 probe、`brew doctor` 早发现 env 污染。`direct:` — nexel 已有 `spi.test.mjs` + `opencode.test.mjs` 但没 publish；NAS doctorCommand 已经在做但无 adapter probe 注册接口；duck-typed adapter feature detection 在 SPI 演化时会反复成本（v1.0→v1.1→v1.2 都是隐式契约）。

**Rationale:** 让 adapter 作者社区有「合规出生证」，让 SPI 演化变成 capability bit 而非 break change。三件套互相强化：capability 在 handshake 阶段宣称 → conformance harness 把它做成可测试断言 → doctor probe 是 capability 的运行时 surface。今天 SPI 任何变化都要改所有 adapter，做完后 SPI 演化解耦为 capability 增量。

**Downsides:** SPI 又一次 bump (v1.3+)；conformance harness 维护负担；probe 报告 schema 设计争议会持续。

**Confidence:** 80%

**Complexity:** Medium (extract + publish + 加 capability bit + 改 dispatch gate)

**Status:** Unexplored

---

### 7. Manifest 从 filesystem 派生（缩范围版）

> **Boundary 校正 (grill G4)**: 原稿"ProductConfig 也从 manifest 派生"与 ADR-0001 D2 frozen identity + fail-loud-at-construction invariant 存在张力（5 个 identity 字段的 fail-loud 时机会从 bin 启动推迟到 manifest load；manifest 在 git/手工被改篡能导致已安装资产孤儿化；sample-product `bin.mjs` 作为 ADR-0011 downstream reference 的角色会被波及）。**废原 7b**；只保留 7a (Manifest-from-FS)。`defineProductConfig` 留在 code，invariant 不动。

**Description:** Manifest-as-mirror —— `install.json` 不再手编。`nexel rebuild-manifest` walk `<skillsDir>/*/SKILL.md` 等，解析 frontmatter，emit canonical `install.json`。`lint:manifest` 变成「regen-and-diff」，非空 diff = CI 失败。`ProductConfig.manifestMode: "authored" | "derived"` 让现有产品可选（不破后兼容）。`defineProductConfig` 不动 —— ProductConfig 仍是 code，identity 字段仍在 bin 入口 fail-loud 验证。

**Axis:** Meta-tooling lifecycle

**Basis:** `direct:` — NAS 13 次成功 promotion 全用「cp + manifest edit + MR」捷径绕过 skill-absorber，manifest 编辑是真摩擦点。`external:` — Cargo workspaces / npm workspaces / asdf 从 `.tool-versions` 派生。`reasoned:` — frontmatter 与 manifest 双重编码同一事实 (`lint-drift` 存在的全部理由)；自动派生时双重编码消失。

**Rationale:** 解决 NAS 真正的 DX 摩擦 (manifest 编辑)，同时不动 nexel kernel 的 frozen invariant。

**Downsides:** `derived` 模式要求 frontmatter 能表达 manifest 所有字段（可能缺 grouping/bundle 元信息 —— 需要先盘点 manifest schema）；`authored` 与 `derived` 并存增加文档负担。

**Open question (推迟决策)**: 原 Idea 7b (ProductConfig 全从 manifest 派生) 没死，只是降级为 open question。要做需先起 ADR 处理 fail-loud 时机迁移、manifest tamper 风险、sample-product reference 影响三件事。当前 ranked survivor 不收。

**Confidence:** 80% (范围缩小，可信度上升)

**Complexity:** Medium (frontmatter→manifest scanner + lint:manifest 重写)

**Status:** Unexplored

---

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | 删 `defaultRulesDir` from ProductConfig (F2.1, C-P) | below meeting-test floor — 纯 cleanup，路由进常规重构；与 Idea 5 / 6 的更大 surface 重叠 |
| 2 | Adapter SPI as JSON-RPC wire protocol (F3.3, C-E) | too expensive relative to demonstrated need — 当前没有非-JS / 远程 adapter 需求；推迟到 ce-brainstorm 当 Rust / Python adapter demand 出现时再起 |
| 3 | Workspace mini-manifests + lockfile (F3.2, C-C) | overlaps Idea 7 — derived manifest 已经覆盖大部分价值；lockfile 概念可在 Idea 5 (CAS) 中以 content-hash 形式吸收 |
| 4 | Watch-mode reactive reload (F5.5, C-W) | below meeting-test floor — 作者 DX nice-to-have，不是 kernel 形态升级；适合作为 brainstorm 输出而非 absorption proposal |
| 5 | Layered skill bundles (OCI-layer, F5.7, C-X) | premature — 没有团队定制需求证据；overhead 极高 (`nexel why`, override semantics, 决定性 fold)；等 customization-without-fork demand 浮现 |
| 6 | Drift-as-PR (drift export → patch, F6.8, C-AA) | speculative — 用户在 install 站点改 skill 的行为未被观察到（NAS 零 adopter）；干净的 nexel `repair` 还没造成抱怨 |
| 7 | Reference-count audit + `--accept-orphan` (F1.5, C-BB) | covered by routine audit — nexel `state.mjs` 现有引用计数成熟度需 file-level 审计，不是 discrete idea；归入 Idea 4 的 transactional + multi-tenant 工作 |
| 8 | Locale catalog SPI (F1.6, C-L) | already on roadmap — nexel README 已列；具体 SPI 形状值得 ce-brainstorm 单独打磨 |
| 9 | User-extensible asset types (F3.7, C-S) | folds into Idea 5/2 — content-addressed state 重写时顺带处理 asset-type registry；principle-pack (Idea 2) 也可能引入新 asset type；不独立成立 |
| 10 | Lint scripts → generators (F2.6 部分) | partially covered by Idea 7 + future governance pack — adr-suggest / release-prep 是好想法但属第二轮；可视为 Idea 6 (conformance) 的同源生态包 |
| 11 | OBEY-X 合并为 1 个 skill 的 deflationary 版本 (F2.5 alt) | duplicated by Idea 2 — principle-pack ecosystem 是更强 form；纯合并是降级方案 |
| 12 | Mandatory pipeline 单独 (F4.1 alt) | merged into Idea 3 — 与 self-improve-as-stage 合并 |
| 13 | Doctor probe single (F1.2/F4.5 alt) | merged into Idea 6 — 三件套联合 (capability + conformance + doctor) 比单独 doctor probe 强 |
| 14 | Endosymbiotic absorber 单独 (F5.2 alt) | merged into Idea 1 — declarative absorbFrom + provenance + sister-package 三件套联合 |
| 15 | Multi-tenant 单独 (F3.6/F4.4 alt) | merged into Idea 4 — 与 activation-plane sister + transactional 联合 |

**Axis coverage of survivor set:**
- Axis 1 (installer 容错性): Idea 5 (primary), Idea 4 (partial via transactional)
- Axis 2 (SPI 表达力): Idea 3, Idea 6
- Axis 3 (meta-tooling lifecycle): Idea 1, Idea 7
- Axis 4 (governance & discipline): Idea 2
- Axis 5 (distribution & ecosystem): Idea 4, Idea 6 (partial)

均匀，所有 axis 至少 1 个 survivor。无 axis 被 recovery cap 跳过。

## 评估总结 (用户问题的两个面)

### "可吸收"侧 — 已经/可以照搬的能力
- **Idea 4 中的 transactional + recoverySweep**：NAS 已投产、稳定、形态成熟，提到 public API 即可
- **Idea 6 中的 doctor probe registry**：NAS doctorCommand 已经在做，缺 adapter 注册接口
- **Idea 7 中的 derived-manifest**：filesystem-scan + frontmatter 已是 NAS lint-skills 在干的事，只差反转因果（lint → generate）

### "可孵化为更高阶形态"侧 — 用户最关心的部分
- **Idea 1 (endosymbiotic absorber)**：NAS 设计完整 + 投产失败 → 用 declarative resolver + 持续 provenance 升级，是「修复一个失败 design」的高阶答案
- **Idea 2 (principle-pack ecosystem)**：OBEY-X 是 NAS 原创且公开领域无产化先例 → 把 14 个手工 artifact 升级为 schema + 冲突图 + check hook 是「把隐式知识做成基础设施」的范例
- **Idea 3 (mandatory staged pipeline)**：把 NAS 的单 hook 升级成 content extensibility 平台，给 self-improve / lint / cross-CLI sanitization 一个共同落点
- **Idea 5 (content-addressed state)**：跨域类比 (Nix/Cargo/OCI) 引入的 kernel 核心数据模型升级，结构性消除一类 ADR-bug + 一个 verb

### 战略性观察 (cross-cutting，post-grill)
1. **两个姊妹包成 coherent ecosystem story**：`@nexel/vendor` (Idea 1) + `@nexel/governance` (Idea 2 中)。第三个原拟 `@nexel/activate` 在 G3 被废 —— Plugin Runtime 用 kernel 包内 subpath 模式（沿 ADR-0009）覆盖。Kernel 保持产品无关；ecosystem 两包加法生长。
2. **pre-1.0 + adoption≈0 窗口论证有限次使用**：ADR-0008 已用过一次（state dirname unfreeze）；G5 决策做 schema-migration ladder 优先，让 CAS state 等大改可走 ladder 而**不再需要消耗剩余 unfreeze 预算**。
3. **NAS 的两个"失败投产"特性 (skill-absorber, --self-improve hook) 都在本 ideation 中得到结构升级落点** (Idea 1 Vendoring 经 endosymbiosis 比喻, Idea 3 pipeline-stage 落点)，把死掉的 design 复活为更通用的 form。
4. **Conformance + capability 是 SPI 演化解锁键**：Idea 6 让后续 SPI 改动从「break 所有 adapter」变为「add capability bit」，与 Idea 3 共同保住 ADR-0010 additive-optional invariant。

## Post-Grill Ranking (8 ideas after split)

按 (post-grill confidence × kernel leverage × ADR-compliance) 重排：

| Rank | Idea | Conf | Complexity | Grill 影响 |
|---|---|---|---|---|
| 1 | **4a. Plugin Runtime 横向扩展** (claude-plugin + codex-plugin) | 90% | Low-Med | G3 校正：从「新姊妹包」改为「沿 ADR-0009 subpath 扩展」，提升可信度 |
| 2 | **5. State schema-migration ladder** | 85% | Med | G5 校正：从「CAS+删 repair+ladder 三件套」缩为 ladder only；CAS 走 ladder 推迟 |
| 3 | **3. Optional staged content pipeline** (additive minor v1.3) | 85% | Med | G6 校正：从「mandatory」改为「optional 并存」，保 ADR-0010 invariant |
| 4 | **1. Skill Vendoring + @nexel/vendor** | 85% | Med (kernel 零改动) | G1 校正：Absorber → Vendoring 改名；kernel 改动量从 Medium 降为 Zero |
| 5 | **2. Principle-Pack + Pluggable Validator Rule Registry** | 85% | Med-High | G2 校正：Asset enum 不扩；frontmatter 字段 + 姊妹包 + 通用 kernel registry |
| 6 | **6. Capability handshake + conformance + doctor probes** | 80% | Med | 未受 grill 影响 |
| 7 | **7. Manifest 从 filesystem 派生** (缩范围) | 80% | Med | G4 校正：仅保 7a (Manifest-from-FS)；ProductConfig 派生废 |
| 8 | **4b. Multi-tenant install + runTransactional primitive** | 75% | Med-High | G3 split：从原 Idea 4 拆出 |

**关键变化**：原 #1 (Vendoring) 降到 #4 — 不是它变弱了，而是 4a (Plugin Runtime 横向扩展) 在 grill 中露出**几乎零风险 + 填实际覆盖洞**的特性，应优先。

## Open ADR Candidates

以下决策**等具体实施时**应起 ADR（满足 hard-to-reverse + surprising-without-context + real-trade-off 三条）：

| 候选 | 触发条件 | 摘要 |
|---|---|---|
| **ADR-XX: Pluggable Validator Rule Registry — kernel-generic affordance, Asset enum 闭合** | Idea 2 真要落地时 | 记录"为什么 principle 不进 Asset 枚举 / 为什么 check 逻辑在 `@nexel/governance` 不在 kernel verb"。trade-off：扩 enum vs frontmatter+sister 包 |
| **ADR-XX: State schema-migration ladder** | Idea 5 ladder 实施时 | 记录"为什么先做 ladder 再做 CAS / 为什么 pre-adoption 窗口不再用于 CAS"。trade-off：现在 unfreeze 一次 vs ladder 化所有未来变更 |
| **ADR-XX: SPI v1.3 — Optional `contentPipeline` 与 `transformAssetContent` 并存** | Idea 3 落地时 | 记录"为什么不强制 pipeline / 两种声明并存的 auto-promote 规则"。trade-off：mandatory cleaner vs additive-optional 守 ADR-0010 invariant |

CONTEXT.md 已就 G1 (Vendoring 术语) 更新；未来 G2/G3 落地时 `Plugin Runtime` 词条要加多 CLI 实现的子项（claude-plugin / codex-plugin）；`Validator Rule` 是潜在新词条。
