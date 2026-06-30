# 设计文档：实战卷《从 0 写一个 Harness》

> 日期：2026-07-01 · 状态：已批准设计 + 已过对抗审核修订，待落实现计划
> 定位：现有 31 篇概念系列的「第六阶段 · 实战卷」
> 修订：2026-07-01 经 4 维度 × 双怀疑者对抗审核（66 agent），确认 24 条真问题已并入本稿，见末节「审核修订记录」。

---

## 1. 目标与定位

写一个**代码优先**的博客子系列，带读者从 0 写出一个 **Claude Code 级别的 harness agent**。与现有 01–31 概念系列（讲*为什么*、用 JS 伪代码）互补，这一卷讲*怎么真的写出来*：每一篇都有**真实可运行、可验证的 TypeScript 代码**，读者跑通当篇再进入下一篇。

整卷有双重价值：

1. **自己动手写一个 harness** —— 从一次模型调用，逐步长成能日常用的 mini-claude-code。
2. **读懂 Claude Code 真实怎么写** —— 每篇对照真实（还原）源码，看真实工程比我们的简化版多做了什么、为什么。

### 锁定的关键决策

| 维度 | 决策 |
|------|------|
| 语言/运行时 | **TypeScript / Node**（贴近 Claude Code 真实形态，复用读者全栈背景） |
| 终点范围 | **教学级全量**：覆盖核心 loop + 工具 + 权限 + 流式 + compaction + 状态 + 子 agent + skills + plan mode + hooks + MCP + 多模型路由 + 成本统计 + REPL 全部 14 类特性的**最小可运行实现**，并深度对照真实源码差距。不追求每个零件生产级健壮（区别见第 8 节验收标准）。 |
| 模型后端 | **provider-agnostic 可插拔**：Anthropic API 或 OpenAI 兼容端点（如 GLM-4.6/GLM-5.2）。**⚠️ 这是本卷自创的简化抽象，不是源码还原**——真实源码是 Anthropic-only（详见第 4 节）。读者用自己有 key 的那家验证。 |
| 与概念系列关系 | **第六阶段·实战卷**：独立编号 `实战01–20`，代码在 `code/harness/`，每篇回扣对应概念篇。README 表格待第五阶段（概念 26-31）写完后再追加，避免阶段倒挂。 |
| 讲法 | **引导式设计 + 代码落地**（弹性模板，见第 3 节）：苏格拉底式推导设计 → 写真代码 → 翻开源码对照。 |
| 代码组织 | **方案 C**：单一累积仓库 `code/harness/` + 每章末 git tag checkpoint。 |

---

## 2. 代码组织（方案 C：累积仓库 + checkpoint）

- 所有章节代码进同一个不断长大的项目：`code/harness/`。
- 第 N 章 = 第 N-1 章 + 一个新零件。
- **每章结束**：提交并打 tag，命名 `harness-ch<NN>-<slug>`（如 `harness-ch04-permission-gate`）。
- 想看/跑某一章末状态：`git checkout harness-ch<NN>-<slug>`。tag 用于**运行态隔离验证**（按博客验证步骤跑通），不承诺"跳着读某一章就能独立看懂"——阅读仍是顺序的。

**为什么选 C**：既给「每章跑通再继续」的隔离验证（靠 git tag），又不像「每章独立快照」那样把同一套代码抄 20 遍。终点是一个真实、连续演进的 harness —— 跟 Claude Code 本身的演进方式一致。

**代价 / 纪律**：每章末必须提交并打 tag；保持 `code/harness/` 始终可跑（`bun run`/`npm run` 一键启动）。

**注意一处叙事张力（来自审核）**：引入「流式」（实战05/06）时会把实战02 的非流式 loop 重构为流式生成器，这是**重塑主干**而非「加一个零件」。实战02 须预先声明这一点，且其验证限定为单轮，不触发多轮工具循环。

---

## 3. 每篇统一结构（三段式·弹性模板）

每一篇实战博客原则上走同一套节奏，但**三段式是弹性模板，不是刚性公式**：

1. **引导式设计** —— 苏格拉底式问「这一步最少需要什么」，从读者已有知识架桥，推导出我们自己的*简化*设计（锚定→架桥→推导→命名→追问）。
2. **代码落地** —— 把设计写进 `code/harness/`，给出可跑代码、运行命令、**明确的验证步骤**（跑什么、看到什么算通过）。当篇末打 git tag。
3. **🔬 翻开源码** —— 打开 Claude Code 真实实现，指明 `src/xxx` 路径与关键函数，对照「真实工程比我们多做了什么、为什么」。这是 17b 篇「工程 = 约束下权衡」的活体标本。

**弹性规则（来自审核）**：

- **有设计折叠点的篇**（loop / 权限 / compaction / 路由）走完整引导式——这些篇存在反直觉的设计抉择（如「while 括号里填什么」），值得苏格拉底逼问。
- **纯基础设施篇**（流式 / hooks / MCP / REPL）允许降级为「需求 → 协议讲解 → 代码 → 翻源码」，**不硬凑苏格拉底问答**（否则变成假问答）。
- **卷级分工铁律**：概念系列回答「为什么」，实战卷回答「怎么写 + 翻源码」。**实战篇不重新推导概念篇已推导过的"为什么"**（如实战02 不重推「为什么是 while + 停止条件」——那是概念24 的事，直接回扣），只做代码落地 + 翻源码看真实多做了什么。

并配套：

- **回扣概念篇**：每篇显式回指对应概念博客（见第 5 节锚点表）。
- **SVG 图解**：沿用系列既有风格（白底、WCAG AA 深色文字、警惕溢出）。
- **对抗审核**：技术性强的篇目沿用「写完跑 Workflow 多 agent 对抗性审核（找问题→对抗验证→只改真问题）」流程。

---

## 4. 源码对照方法论与重要约束

源码位于 `/Users/weifengzhu/work/ai/claude-code-rev`（Bun 项目，TS-first）。

**⚠️ 关键约束（贯穿全卷）**：这份源码是**通过 source map 逆向还原 + 补齐缺失模块**得到的，**不是上游原始状态**，含兼容 shim 和降级实现。因此：

- 每次引用源码**必须实际 `Read` 打开验证**当前内容，不靠文件名臆测、不凭记忆断言。（本设计稿初版正因臆测锚点而被审核抓出 10+ 处错位，是这条约束的反面教材。）
- 凡涉及还原 fallback / shim 的地方，**明确标注**「此处为还原降级实现，可能与线上真实行为有出入」。已知空壳：`src/query/transitions.ts` 是 3 行 no-op shim。
- 行号/函数名引用以写作当时实际读到的为准。

**两条源码事实定调（来自审核，影响全卷）**：

1. **源码是 Anthropic-only**：121 个文件 import `@anthropic-ai/sdk`。`src/utils/model/providers.ts` 的 `APIProvider = firstParty|bedrock|vertex|foundry` 四者全是 **Anthropic 协议**的不同承载方（直连 / AWS Bedrock / GCP Vertex / Azure Foundry），**不是 OpenAI 兼容 provider，也不是协议归一层**。所以本卷的「provider 可插拔（含 GLM/OpenAI 兼容）」是**自创扩展**，源码对照环节须诚实说明「真实源码的 provider 是部署通道而非协议归一，我们的 OpenAI 归一是自创」。
2. **stop_reason 不可靠**：`src/query.ts:554` 明确注释 `stop_reason === 'tool_use' is unreliable`，真实 loop 靠**流式期间累积的 tool_use 块**判断是否继续，而非读 stop_reason 字段。本卷实战02 的「stop_reason 分流」是教学简化，「翻开源码」须点明真实做法。

---

## 5. 章节大纲与源码锚点（共 20 篇）

独立编号 `实战01–20`（隶属第六阶段·实战卷）。锚点均需写作时实际打开复核（见第 4 节）。

### 阶段 A · 地基（让循环转起来）

| # | 标题 | 新增可跑能力 | 验证 | 源码锚点 | 回扣 |
|---|------|------|------|------|------|
| 实战01 | 第一次对话：可插拔的模型层 | `chat()` + provider 适配器（GLM/Anthropic）+ messages 数组 | 用自己有 key 的一端发一句话拿到回复；调用方代码无 provider 专属逻辑 | `src/services/api/`（client.ts/claude.ts）、`src/utils/model/providers.ts`（注明仅 Anthropic 承载方，非协议归一） | 17 金鱼 · 18 结构化输出 |
| 实战02 | agent loop 骨架 | `while` + 工具请求分流 + 第一个工具 `read_file`（**非流式单轮版，实战05/06 会重构为流式**） | 让它读一个文件并回答（单轮工具调用） | `src/query.ts`（query()/queryLoop()/`while(true)`；§554 注明 stop_reason 不可靠的真实做法） | 24 · 17b · 18 |

### 阶段 B · 工具与控制

| # | 标题 | 新增能力 | 验证 | 源码锚点 | 回扣 |
|---|------|------|------|------|------|
| 实战03 | 工具系统（含 bash） | 工具注册表 + JSON Schema + read/write/edit/ls/bash（bash 仅最小执行，**安全解析留实战04 讲差距**） | 让它改一个文件 | `src/Tool.ts`、`src/tools/`（FileReadTool/FileWriteTool/FileEditTool/BashTool/GlobTool/GrepTool） | 18 |
| 实战04 | 权限闸门 | 危险动作（write/bash）走审批；简化版只做**按工具名/危险动作分类审批** | 拦下一次 `rm -rf` | `src/hooks/toolPermission/`（PermissionContext.ts/handlers/）+ `src/tools/BashTool/bashPermissions.ts`（classifier 真身）；🔬 重点讲「黑名单为何不够、真实 ~1.2 万行做命令语义解析」 | 24 三护栏 · 18 闸门 |
| 实战05 | 文本流式渲染 | streaming 文本逐字输出（**只做文本，工具仍流后顺序执行**） | 看到逐字输出 | `src/query.ts`（流式生成器）、`src/ink/`（仅作渲染对照，不复刻） | — |
| 实战06 | 流式工具执行/解析 | 边流边解析工具调用（input_json_delta 累积）+ 把实战02 loop 重构为流式 | 流式中正确解析并执行一次工具调用 | `src/services/tools/StreamingToolExecutor.ts`、`src/query.ts`（streamingFallback/重建 executor） | — |
| 实战07 | 系统提示词与上下文拼装 | system prompt + 环境信息 + 工具说明 + **CLAUDE.md/记忆文件注入** 拼进 context | 注入 cwd/git 状态/CLAUDE.md 后行为变化 | `src/constants/`（prompts）、`src/memdir/`（MEMORY.md 扫描）、prompt 拼装路径 | 17 一整坨 |

### 阶段 C · 自主与韧性

| # | 标题 | 新增能力 | 验证 | 源码锚点 | 回扣 |
|---|------|------|------|------|------|
| 实战08 | 错误处理与重试 | 工具报错回灌 + 重试 + `max_iterations` | 喂坏命令看它自纠 / 防死循环 | `src/query.ts`（错误回灌/fallback 重试循环） | 18 校验循环 · 24 三祸 |
| 实战09 | 上下文压缩 compaction | 阈值触发 + 有损摘要（简化版，不含 skill/子agent/session 钩子） | 长对话不爆窗口 | `src/services/compact/`（autoCompact.ts/compact.ts/reactiveCompact.ts）为主，`query.ts` 作调用入口；🔬 点明真实 compaction 还耦合 skills/子agent/session 钩子 | 23 记忆线 · 17 |
| 实战10 | 跨会话状态 | 进度文件 + git 桥接 | 关掉重开接着干 | `src/utils/sessionStoragePortable.ts`、`src/utils/listSessionsImpl.ts`、`src/screens/ResumeConversation.tsx`、`src/memdir/` | 23 状态线 · 17b |
| 实战11 | TodoWrite 与 system-reminder | 任务清单工具 + 运行时动态回灌提醒（让长任务不跑偏） | 多步任务中 todo 状态被持续回灌、不跑偏 | `src/tools/TodoWriteTool`、`src/utils/messages.ts`（reminder wrap/注入）、`src/utils/memoryAge.ts` | 24 自主规划 · 23 |

### 阶段 D · 高级特性（逼近真 Claude Code）

| # | 标题 | 新增能力 | 验证 | 源码锚点 | 回扣 |
|---|------|------|------|------|------|
| 实战12 | 子 agent 编排 | `Task`/`Agent` 工具 + 隔离 context 的 worker（**最小 fork：仅隔离 messages + 独立 loop，skills 注入/agent memory/resume 留后续**） | 并行查 3 件事再汇总 | `src/tools/AgentTool/`（runAgent.ts/forkSubagent.ts）为主；`src/Task.ts`/`src/tasks/` 作任务生命周期底层对照 | 25 orchestrator |
| 实战13 | Slash 命令与 Skills | 可复用指令封装 + 按需加载 | 自定义 `/review` 跑通 | `src/skills/`（bundled/loadSkillsDir.ts/mcpSkills.ts）、`src/tools/SkillTool`、`src/commands/` | — |
| 实战14 | Plan mode | 只读探索 + 计划确认闸门 | 先出计划再动手 | `src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`、`src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts` | 24 · 17b |
| 实战15 | Hooks | 事件触发外部命令 | 保存后自动跑 lint | `src/query/stopHooks.ts`、`src/hooks/` | — |
| 实战16 | MCP 接入 | 连 MCP server 动态加载工具（**钉死在 stdio 传输 + 列/调工具最小闭环，不做 websocket/OAuth/审批 UI**） | 用 stdio 挂一个本地 MCP，列出并调用其工具 | `src/services/mcp/`（client.ts/useManageMCPConnections.ts/auth.ts）为主；`src/tools/MCPTool` 等仅是 stub（注明） | 18 |
| 实战17 | 多模型智能路由 | 简单 query→小模型，难→大模型（**本卷原创：真 Claude Code 不做 by-difficulty 路由**） | 路由命中统计 | `src/utils/model/model.ts`、`src/utils/model/modelOptions.ts`（small-fast 槽位 `getSmallFastModel`）；🔬 说明源码只有固定小快槽位、无难度路由 | 26（前置依赖：待概念26写成） |
| 实战18 | 成本统计与 token 预算 | 记账 + 预算上限熔断（**熔断是本卷原创**） | 超预算自动停 | `src/cost-tracker.ts`、`src/costHook.ts`（记账对照）；`src/query/tokenBudget.ts`（🔬 说明它实为"催继续"的 continuation 推进器、非熔断器） | 28（前置依赖：待概念28写成） |

### 阶段 E · 收尾

| # | 标题 | 新增能力 | 验证 | 源码锚点 | 回扣 |
|---|------|------|------|------|------|
| 实战19 | 最小 REPL 交互界面 | 用现成 ink/readline 包一个**最小可用 REPL**（不自研渲染层） | 像 claude 一样在终端跑起来 | `src/ink/`（~2 万行自研渲染层，🔬 只对照不复刻）、`src/components/`、`src/replLauncher.tsx` | — |
| 实战20 | 收官：焊成 mini-claude-code | 全零件整合 + 回顾 Agent = Model + Harness | 用它完成一个真实改码任务 | `src/main.tsx`、`src/bootstrap-entry.ts`、`src/bootstrapMacro.ts`、`src/entrypoints/`、`src/replLauncher.tsx`（`src/bootstrap/` 仅全局状态、非入口） | 全系列 |

**顺序原则**：每篇只加一个零件、当篇即可独立验证、严格按依赖递增（约束的是我们自己的简化版搭建顺序，非真实源码依赖图）。例外：流式（05/06）会重构 02 的 loop 主干，已在第 2 节标注。

---

## 6. 仓库结构（落地形态）

```
big-model-learning/
├── blogs/
│   ├── 实战01-first-call.md ... 实战20-finale.md   # 实战卷博客
│   ├── assets/img/实战NN-*.svg                       # 配图
│   └── README.md                                     # 第五阶段写完后追加「第六阶段·实战卷」表格
├── code/
│   └── harness/            # 累积仓库（方案 C），每章末打 tag
│       ├── package.json
│       ├── src/
│       └── README.md       # 如何运行、如何 checkout 某章 tag
└── docs/superpowers/specs/2026-07-01-harness-from-scratch-series-design.md
```

- `code/harness/` 用 Node + TS（运行时 Bun vs tsx/ts-node 在实现计划阶段、写第一行代码前敲定，见第 7 节）。
- provider 适配器：抽象一个 `ModelProvider` 接口，`AnthropicProvider` 与 `OpenAICompatProvider`（GLM 等）两个实现；读者用环境变量切换 + 自己的 key。**这是本卷自创层，无源码可对照**（第 4 节）。
- 每章 README 标注对应 git tag 与运行命令。

---

## 7. 未决细节（须在写第一行代码前敲定）

1. **运行时具体选型**：Bun vs tsx/ts-node（源码用 Bun；我们的简化版用 Bun 最贴近，还是用更通用的 tsx 降低读者门槛）。影响每篇运行命令与验证步骤，**写码前必须定**。
2. **【已升级为实战01/03 核心设计，不再是"细节"】provider 工具调用归一**：Anthropic 的流式 `tool_use`（content_block_delta / input_json_delta 增量拼）与 OpenAI 的 `tool_calls`（choices[].delta.tool_calls[].function.arguments 分片）形态完全不同。**落实现计划前先做 spike**：用 GLM（OpenAI 兼容）与 Anthropic 各跑通一次「带工具调用的流式请求」，验证 `ModelProvider` 接口能否同时容纳两端的流式 tool-call 解析，再据此回填实战01/02/03 的接口设计——否则早期章节对 GLM 用户跑不通。
3. **卷首语/免责声明篇**：是否需要一篇「卷首语」说明本卷定位、源码出处、还原源码免责、provider 可插拔是自创抽象。倾向需要。

---

## 8. 验收标准

- 每篇博客：含可运行代码 + 明确验证步骤 + 源码对照环节 + 回扣 + SVG。
- 每篇对应一个 `code/harness/` 的 git tag，checkout 后能按博客的验证步骤跑通。
- **「功能存在」而非「生产级健壮」**：教学级全量的标准是"覆盖该类特性的最小可运行实现，并讲清真实工程多做了什么"，不要求每个零件达到生产级健壮（如 bash 安全、MCP 连接管理、TUI 渲染都只做最小版 + 对照差距）。
- 全卷结束：`code/harness/` 是一个能完成真实改码任务的 mini-claude-code。
- 源码引用全部经实际打开验证，还原降级处已标注。

---

## 审核修订记录（2026-07-01）

4 维度（源码对照可行性 / 章节顺序与独立可验证性 / 范围可行性与隐藏复杂度 / 教学一致性与概念回扣）× 每条 2 怀疑者对抗验证，66 agent。31 findings → 24 双票确认 / 5 分裂票 / 2 误报。已并入本稿的主要修订：

- **源码锚点错位（10+ 处）**：实战17 路由(config.ts→model.ts/modelOptions.ts)、实战09 compaction(query/history→services/compact/)、实战10 跨会话(state/→sessionStorage/listSessions/ResumeConversation)、实战02(删 transitions.ts 空壳)、实战18(tokenBudget 语义相反)、实战20(bootstrap/→main.tsx 等入口)、实战12(Task.ts→AgentTool/)、实战16(MCP Tool stub→services/mcp/)、实战04(补 bashPermissions.ts)、实战14(ExitPlanModeV2Tool.ts)。
- **provider 地基**：承认源码 Anthropic-only，可插拔标为本卷自创；工具调用归一升为实战01/03 核心 + 先做 spike；stop_reason 不可靠定调。
- **范围**：「准生产全量」→「教学级全量」；TUI 降级最小 REPL；流式拆为 05/06；Bash/权限、MCP 篇内明确简化边界 + 差距作教学点。
- **章节增补**：18→20 篇（拆流式、增 TodoWrite+system-reminder）。
- **教学一致性**：实战01 回扣改「18 结构化输出」（非"厂商差异"）；实战17/18 回扣 26/28 标前置依赖；定位正式第六阶段（README 待第五阶段写完追加）；三段式声明为弹性模板；立卷级分工铁律（概念=为什么/实战=怎么写）。
- **误报（不改）**：「打 tag 支持跳读」（spec 本就只承诺顺序阅读）、「compaction 验证无法证伪」（教学可接受）。
