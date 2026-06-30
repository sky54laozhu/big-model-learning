# 设计文档：实战卷《从 0 写一个 Harness》

> 日期：2026-07-01 · 状态：已批准设计，待落实现计划
> 定位：现有 31 篇概念系列的「第六阶段 · 实战卷」

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
| 终点范围 | **准生产全量**：核心 loop + 工具 + 权限 + 流式 + compaction + 状态 + 子 agent + skills + plan mode + hooks + MCP + 多模型路由 + 成本统计 + TUI |
| 模型后端 | **provider-agnostic 可插拔**：Anthropic API 或 OpenAI 兼容端点（如 GLM-4.6/GLM-5.2）；读者用自己有 key 的那家验证 |
| 与概念系列关系 | **实战卷**：复用同一 README/编号血脉，代码在 `code/`，每篇回扣对应概念篇 |
| 讲法 | **引导式设计 + 代码落地**：苏格拉底式推导设计 → 写真代码 → 翻开源码对照 |
| 代码组织 | **方案 C**：单一累积仓库 `code/harness/` + 每章末 git tag checkpoint |

---

## 2. 代码组织（方案 C：累积仓库 + checkpoint）

- 所有章节代码进同一个不断长大的项目：`code/harness/`。
- 第 N 章 = 第 N-1 章 + 一个新零件。
- **每章结束**：提交并打 tag，命名 `harness-ch<NN>-<slug>`（如 `harness-ch04-permission-gate`）。
- 想看/跑某一章末状态：`git checkout harness-ch04-permission-gate`。

**为什么选 C**：既给「每章跑通再继续」的隔离验证（靠 git tag），又不像「每章独立快照」那样把同一套代码抄 18 遍、改个 bug 要改 N 处。终点是一个真实、连续演进的 harness —— 跟 Claude Code 本身的演进方式一致。

**代价 / 纪律**：每章末必须提交并打 tag；保持 `code/harness/` 始终可跑（`bun run`/`npm run` 一键启动）。

---

## 3. 每篇统一结构（三段式）

每一篇实战博客都走同一套节奏：

1. **引导式设计** —— 苏格拉底式问「这一步最少需要什么」，从读者已有的知识架桥，推导出我们自己的*简化*设计。延续概念系列读者熟悉的节奏（锚定→架桥→推导→命名→追问）。
2. **代码落地** —— 把设计写进 `code/harness/`，给出可跑代码、运行命令、**明确的验证步骤**（跑什么、看到什么算通过）。当篇末打 git tag。
3. **🔬 翻开源码** —— 打开 Claude Code 真实实现，指明 `src/xxx` 路径与关键函数，对照「真实工程比我们多做了什么、为什么」。这是 17b 篇「工程 = 约束下权衡」的活体标本。

并配套：

- **回扣概念篇**：每篇显式回指对应的概念博客（见第 5 节锚点表）。
- **SVG 图解**：沿用系列既有风格（白底、WCAG AA 深色文字、警惕溢出，见记忆 feedback-svg-review / feedback-svg-style）。
- **对抗审核**：技术性强的篇目沿用「写完跑 Workflow 多 agent 对抗性审核（找问题→对抗验证→只改真问题）」流程。

---

## 4. 源码对照方法论与重要约束

源码位于 `/Users/weifengzhu/work/ai/claude-code-rev`（Bun 项目，TS-first）。

**⚠️ 关键约束（贯穿全卷）**：这份源码是**通过 source map 逆向还原 + 补齐缺失模块**得到的，**不是上游原始状态**，含兼容 shim 和降级实现。因此：

- 每次引用源码**必须实际 `Read` 打开验证**当前内容，不靠文件名臆测、不凭记忆断言。
- 凡涉及还原 fallback / shim 的地方，**明确标注**「此处为还原降级实现，可能与线上真实行为有出入」。
- 行号/函数名引用以写作当时实际读到的为准。

**写作流程提醒**：每篇的「翻开源码」环节，先打开相关 `src/` 文件确认实现，再下笔对照。

---

## 5. 章节大纲与源码锚点

起步 **18 篇**；加入源码对照后若某章信息量过大，可拆分/增补（用户已确认章节数可弹性增长）。独立编号 `实战01–18`（隶属第六阶段·实战卷）。

### 阶段 A · 地基（让循环转起来）

| # | 标题 | 新增可跑能力 | 验证 | 源码锚点 | 回扣 |
|---|------|------|------|------|------|
| 实战01 | 第一次对话：可插拔的模型层 | `chat()` + provider 适配器（GLM/Anthropic）+ messages 数组 | 发一句话拿到回复；切 provider 不改业务码 | `src/services/`（API 客户端）、`src/query.ts` | 17 金鱼 · 18 厂商差异 |
| 实战02 | agent loop 骨架 | `while` + `stop_reason` 分流 + 第一个工具 `read_file` | 让它读一个文件并回答 | `src/query.ts`、`src/query/transitions.ts` | 24 · 17b · 18 |

### 阶段 B · 工具与控制

| # | 标题 | 新增能力 | 验证 | 源码锚点 | 回扣 |
|---|------|------|------|------|------|
| 实战03 | 工具系统 | 工具注册表 + JSON Schema + read/write/edit/ls/bash | 让它改一个文件 | `src/Tool.ts`、`src/tools/FileReadTool`、`FileWriteTool`、`FileEditTool`、`BashTool`、`GlobTool`、`GrepTool` | 18 |
| 实战04 | 权限闸门 | 危险动作（write/bash）走审批 | 拦下一次 `rm -rf` | `src/hooks/toolPermission/`、permission-classifier | 24 三护栏 · 18 闸门 |
| 实战05 | 流式输出 | streaming + 工具调用流式解析 | 看到逐字输出 | `src/query.ts`（流式解析）、`src/ink/` | — |
| 实战06 | 系统提示词与上下文拼装 | system prompt + 环境信息 + 工具说明拼进 context | 注入 cwd/git 状态后行为变化 | `src/constants/`、prompt 拼装路径 | 17 一整坨 |

### 阶段 C · 自主与韧性

| # | 标题 | 新增能力 | 验证 | 源码锚点 | 回扣 |
|---|------|------|------|------|------|
| 实战07 | 错误处理与重试 | 工具报错回灌 + 重试 + `max_iterations` | 喂坏命令看它自纠 / 防死循环 | `src/query.ts`（错误回灌循环） | 24 三祸 · 22 校验 |
| 实战08 | 上下文压缩 compaction | 阈值触发 + 有损摘要 | 长对话不爆窗口 | `src/query.ts`、`src/history.ts` | 23 记忆线 · 17 |
| 实战09 | 跨会话状态 | 进度文件 + git 桥接 | 关掉重开接着干 | `src/state/`、`src/memdir/` | 23 状态线 · 17b |

### 阶段 D · 高级特性（逼近真 Claude Code）

| # | 标题 | 新增能力 | 验证 | 源码锚点 | 回扣 |
|---|------|------|------|------|------|
| 实战10 | 子 agent 编排 | `Task` 工具 + 隔离 context 的 worker | 并行查 3 件事再汇总 | `src/Task.ts`、`src/tools/AgentTool`、`src/tasks/` | 25 orchestrator |
| 实战11 | Slash 命令与 Skills | 可复用指令封装 + 按需加载 | 自定义 `/review` 跑通 | `src/skills/`（bundled、loadSkillsDir、mcpSkills）、`src/tools/SkillTool`、`src/commands/` | — |
| 实战12 | Plan mode | 只读探索 + 计划确认闸门 | 先出计划再动手 | `src/tools/EnterPlanModeTool`、`ExitPlanModeTool` | 24 · 17b |
| 实战13 | Hooks | 事件触发外部命令 | 保存后自动跑 lint | `src/query/stopHooks.ts`、`src/hooks/` | — |
| 实战14 | MCP 接入 | 连 MCP server 动态加载工具 | 挂一个真实 MCP | `src/tools/MCPTool`、`McpAuthTool`、`ListMcpResourcesTool`、`ReadMcpResourceTool` | 18 |
| 实战15 | 多模型智能路由 | 简单 query→小模型，难→大模型 | 路由命中统计 | `src/query/config.ts`、模型选择路径 | 26 |
| 实战16 | 成本统计与 token 预算 | 记账 + 预算上限熔断 | 超预算自动停 | `src/cost-tracker.ts`、`src/costHook.ts`、`src/query/tokenBudget.ts` | 28 |

### 阶段 E · 收尾

| # | 标题 | 新增能力 | 验证 | 源码锚点 | 回扣 |
|---|------|------|------|------|------|
| 实战17 | TUI / REPL 交互界面 | 真正能用的命令行界面 | 像 claude 一样跑起来 | `src/ink/`、`src/components/`、`src/screens/`、`src/replLauncher.tsx` | — |
| 实战18 | 收官：焊成 mini-claude-code | 全零件整合 + 回顾 Agent = Model + Harness | 用它完成一个真实改码任务 | `src/main.tsx`、`src/bootstrap/` | 全系列 |

**顺序原则**：每篇只加一个零件、当篇即可独立验证、严格按依赖递增。

---

## 6. 仓库结构（落地形态）

```
big-model-learning/
├── blogs/
│   ├── 实战01-first-call.md ... 实战18-finale.md   # 实战卷博客
│   ├── assets/img/实战NN-*.svg                       # 配图
│   └── README.md                                     # 追加「第六阶段·实战卷」表格
├── code/
│   └── harness/            # 累积仓库（方案 C），每章末打 tag
│       ├── package.json
│       ├── src/
│       └── README.md       # 如何运行、如何 checkout 某章
└── docs/superpowers/specs/2026-07-01-harness-from-scratch-series-design.md
```

- `code/harness/` 用 Node + TS（与 Claude Code 一致；运行时可选 Bun 或 ts-node/tsx，实现计划阶段定）。
- provider 适配器：抽象一个 `ModelProvider` 接口，`AnthropicProvider` 与 `OpenAICompatProvider`（GLM 等）两个实现；读者用环境变量切换 + 自己的 key。
- 每章 README 标注对应 git tag 与运行命令。

---

## 7. 未决细节（留给实现计划阶段）

1. **运行时具体选型**：Bun vs tsx/ts-node（源码用 Bun；我们的简化版是否也用 Bun，还是用更通用的 tsx 降低读者门槛）。
2. **provider 适配器的工具调用归一**：Anthropic（`tool_use`/`stop_reason`）与 OpenAI（`tool_calls`）格式差异如何在适配层抹平 —— 实战01/03 会触及，需在计划里定接口。
3. **首篇是否需要一篇「卷首语」** 说明本卷定位、源码出处与还原源码的免责声明。
4. 是否需要为本卷补一篇「对话历史 / messages 数据结构」独立小篇（当前并入实战01）。

---

## 8. 验收标准

- 每篇博客：含可运行代码 + 明确验证步骤 + 源码对照环节 + 回扣 + SVG。
- 每篇对应一个 `code/harness/` 的 git tag，checkout 后能按博客的验证步骤跑通。
- 全卷结束：`code/harness/` 是一个能完成真实改码任务的 mini-claude-code。
- 源码引用全部经实际打开验证，还原降级处已标注。
