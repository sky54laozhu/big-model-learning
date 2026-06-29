# Agent Harness 深度调研报告

> 为番外《什么是"工程"？从 Prompt 到 Harness》而做的素材调研
> 方法：deep-research harness（5 个搜索角度 → 22 个来源 → 提取 108 条断言 → 25 条进入对抗验证 → 3 票制证伪，需 2/3 否决才毙 → 综合去重）
> 规模：104 个 agent、~534 万 token、调研于 2026-06
> 研究问题：什么是 AI agent harness，以及它如何体现"工程思维"？

---

## 一句话总览

**Agent harness** 是包在 LLM 外面、把一个"随机的下一 token 预测器"变成"可靠的自主系统"的那层工程——社区口诀 **`Agent = Model + Harness`**（"if you're not the model, you're the harness"）。它在 2025-2026 由 coding-agent 产品（Claude Code、Codex、Antigravity）、Anthropic 工程博客、OpenAI、LangChain 推热。核心的"工程思维"在于：**你无法完全控制模型，于是用一层确定性脚手架把它包住**——这层脚手架掌管 agent loop、上下文工程/压缩、跨会话记忆、子 agent 编排、护栏，而这些纪律明确借自人类软件工程师。Harness 与 model 是**可解耦**的：同一个模型放进不同 harness，成绩能摆动 15-34 个百分点；可靠性来自周围的工程设计，而非更聪明的模型——这正是为什么模型变强 harness 不会消失，而会一起进化。

---

## 一、定义与起源

### 1.1 广义：模型之外的一切（高置信度，3-0）

- **`Agent = Model + Harness`**，harness = 一切不是模型的东西。
- Claude Code 官方文档逐字：*"Claude Code serves as the agentic harness around Claude."*
- 公式归于 Mitchell Hashimoto，由 Anthropic（2025-11）与 OpenAI 进一步成文。
- 来源：[HF agent glossary](https://huggingface.co/blog/agent-glossary)（2026-05-25）、[Claude Code docs](https://code.claude.com/docs/en/how-claude-code-works)
- 原文：*"Products like Claude Code, Codex, and Antigravity CLI call the whole thing a harness... harness means everything that isn't the model... If you're not the model, you're the harness."*

### 1.2 狭义：执行层 vs 行为层（高置信度，3-0）

- **harness = 执行层**：调用模型、处理工具调用、决定何时停的那个循环——"what makes the agent run"。
- **scaffold = 行为层**：系统提示、工具描述、响应如何解析、跨步记什么（上下文管理）——"what the model works from"。
- **Harness engineering** = 把执行层设计好的学科：何时停、错误怎么处理、什么护栏，**训练和推理两端都适用**。
- 注意：产品里两词常合并成 1.1 的广义用法；词汇 2026 年才成文，尚未统一。
- 来源：[HF agent glossary](https://huggingface.co/blog/agent-glossary)

### 1.3 LangChain 三层栈（高置信度，3-0）

| 层 | 职责 | 代表 |
|---|---|---|
| **Framework** | 抽象/集成 | LangChain |
| **Runtime** | 持久执行/流式/HITL/持久化 | LangGraph |
| **Harness** | 开箱即用、内置工具的长任务框架 | Deep Agents SDK / Claude Agent SDK / Manus |

- 演化弧线：chaining（2023）→ workflow orchestration → tool-calling-in-a-loop + 文件系统 + 记忆。
- Caveat：这是 LangChain 一家提的分类，它自己也承认"边界模糊"，且 harness 一词非其首创。
- 来源：[LangChain docs](https://docs.langchain.com/oss/python/concepts/products)、[LangChain blog](https://www.langchain.com/blog/on-agent-frameworks-and-agent-observability)

### 1.4 词源补充

"agent harness" 一词来自**软件测试**——test harness 指在受控条件下运行代码的脚手架。搬到 AI 里：原始 API 只有 text-in/text-out，没记忆、没工具、没外部访问，harness 就是包住并管理模型行为的一切。

---

## 二、核心组件（解剖）

### 2.1 Agent Loop（心脏，3-0）

Anthropic 定义：agent = **"LLMs autonomously using tools in a loop"**。具体是三步循环：

1. 模型决定下一步动作，吐出**结构化 JSON 命令**（工具调用）
2. **确定性代码**执行该工具调用
3. 结果**塞回 context** 供下一步用
4. ……直到模型示意完成（生产循环还会加 max-iteration 上限）

- 来源：[Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09）、[Kubiya](https://www.kubiya.ai/blog/context-engineering-ai-agents)
- 小 hedge：输出"通常"是 JSON，有些 agent 用 ReAct 文本/代码动作。

### 2.2 工具调用 ≠ 模型动手（3-0）

- 模型**只产出结构化数据**（JSON 说要干啥），真正执行的是你的代码——**推理（模型）与执行（代码）分离**，这才让系统可扩展、可测试。
- 因此工具调用应被当作**结构化输出**，不是 side effect。
- Anthropic 平台文档："This contract makes the model behave less like a text generator and more like a function you call."
- 限定：生成的工具调用未必 schema 合法（除非用 strict mode/约束解码），所以"确定性代码执行"隐含一个校验步骤。

### 2.3 上下文工程（3-0）

- prompt engineering 的自然继任：跨多轮策展并维护整个 context state（系统指令、工具、MCP、外部数据、消息历史）里"最优的 token 集"。
- 指导原则：**找到能最大化期望结果的、最小的高信噪 token 集**；系统提示拎在"恰当的高度"（在死板 if-else 和空泛指令之间）。
- 来源：[Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

### 2.4 记忆与历史压缩（3-0）

- **Context compaction**：接近窗口上限时自动把旧内容蒸成摘要。
  - ⚠️ 阈值因实现而异：Claude Agent SDK 服务端 compaction 的触发阈值**由调用方设定**（cookbook 示例用 3000-5000）；Claude Code CLI 按**上下文占用百分比**触发（约 83-95%，可用 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 覆盖）。**不存在固定的 ~100K 默认值。**
- **跨会话记忆**：progress 日志文件 + git 历史桥接；事件驱动的 system reminder 对抗指令淡化。
- 来源：[Anthropic harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)、[arXiv:2603.05344](https://arxiv.org/pdf/2603.05344)（OpenDev，单作者预印本，当个案而非共识）

### 2.5 一个 harness 打包的组件（3-0）

planning/to-do 跟踪 · 子 agent 任务委派 · 可插拔文件系统存储（context 卸载）· token 管理（历史摘要 + 大工具结果驱逐）。这些是 harness 这一代区别于早期 chaining/orchestration 的标志。
- 来源：[LangChain docs](https://docs.langchain.com/oss/python/concepts/products)（langchain-ai/deepagents，25k+ stars）
- 注意：这是"可能包含"的组件，不是每个 harness 的普适定义。

---

## 三、为什么体现"工程思维"

### 3.1 明说灵感来自人类工程师（3-0）

- 即便前沿模型（Opus 4.5）在循环里跨多个 context 窗口跑，**只给一句高级 prompt（"克隆 claude.ai"）也盖不出生产级 web app**。
- Anthropic 的解法是工程化脚手架：双 agent（初始化 + 编码）+ `claude-progress.txt` 进度日志 + git 历史桥接跨会话记忆 + init.sh + 200+ 特性 JSON 清单 + 浏览器 E2E 测试。
- 原文：*"Inspiration for these practices came from knowing what effective software engineers do every day."*
- 来源：[Anthropic harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)（2025-11）

### 3.2 12-Factor Agents（3-0）

仿 Heroku 2011《十二要素应用》，把软件工程纪律搬给 LLM 系统：

| 要素 | 内容 |
|---|---|
| **F3** | Own Your Context Window（亲手掌控塞进窗口的每个 token） |
| **F8** | Own Your Control Flow（"you should own the while loop"） |
| **F9** | Compact Errors into Context Window |
| **F10** | Small Focused Agents |
| **F12** | Make Your Agent a Stateless Reducer（纯函数 `f(events) → next_action`，对事件历史做 fold） |

- 明确 Heroku-2011 血统："It's no coincidence that this mirrors the stateless, horizontally scalable nature of 12-Factor App services."
- 来源：[humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents)（Dex Horthy，10k+ stars）

### 3.3 解耦：工程独立于模型能力（3-0）

- **同一个模型，不同 harness，体验完全不同；换个更好的模型进同一 harness，体验也变。"The model, the harness, and the product are three different things."**
- 基准实测：
  - Endor Labs：GPT-5.5 在 Codex 61.5% vs 在 Cursor 87.2%（25.7pp，无模型变化）
  - Terminal-Bench 2.0：Claude Opus 在 Cursor 93% vs 在 Claude Code 77%
  - Cursor 自研：同模型跨 harness 46% vs 80%
  - **CORE-Bench：Opus 4.5 仅换脚手架 42% → 78%**
- 来源：[HF agent glossary](https://huggingface.co/blog/agent-glossary)

### 3.4 可靠性来自设计，不是更聪明的模型（3-0 / 一条 2-1）

- 确定性系统掌管控制循环和上下文窗口，LLM 只在既定框架内"给建议"。
- Harrison Chase（LangChain，2026-02）："fundamentally, the agent is a system around the model, so they will not disappear — they just need to evolve too."
- 实证：让 LLM 当最终决策者比确定性控制器差 11.7pp（LLM 来回摇摆，有界循环单调推进）；有说法称"65% 的企业 AI 失败可追溯到 Harness Defects"。
- ⚠️ 这条的强表述以 2-1 通过：异议指出 model 与 harness 是"largely decoupled"而非完全独立——更好的模型在同一 harness 内仍有帮助。
- 来源：[Kubiya](https://www.kubiya.ai/blog/context-engineering-ai-agents)、[LangChain blog](https://www.langchain.com/blog/on-agent-frameworks-and-agent-observability)

---

## 四、被对抗验证毙掉的断言（1-2 否决，博客刻意未用）

1. **"context rot"**：把"context 必须当有限资源"归因于 token 增多→召回下降→源于 transformer 的 n² 两两注意力开销。（毙）
2. **双 agent 架构作为普适范式**：harness 普遍用"规划/执行分离"的双 agent + 复合模型路由 + lazy tool discovery。（毙）
3. **harness 可行性绑定模型能力**：声称 harness 范式成立"正因为 LLM 推理在变强，可以把编排决策交给模型"。（毙）
4. **deepagents 是唯一模型无关 harness**：LangChain 声称它是唯一不绑定特定 LLM/应用栈的 harness。（毙）

---

## 五、Caveats（来源质量与时效）

- **最强的断言**（定义、agent-loop、上下文工程、解耦、Opus-4.5-需要-harness 论点）靠**一手来源**：Anthropic 工程博客、LangChain 文档/博客、Claude Code 文档、humanlayer/12-factor-agents repo——全 3-0。
- 工具调用/agent loop 的机制描述出自二手营销博客（kubiya.ai），但底层机制被 Anthropic 一手文档佐证。
- **较弱来源**：arXiv:2603.05344（OpenDev）是单作者、未经同行评审、零引用的预印本，其 compaction/memory 架构应归于 OpenDev 个例，不当行业共识。
- **术语未定型、时效敏感**：词汇大多 2025-2026 才成文；"harness" 一词多义（广义=模型外一切 vs 狭义=执行循环对应 scaffolding 行为层）。LangChain 的 framework/runtime/harness 分类是一家提议，非业界标准。

---

## 六、开放问题

1. 上下文管理到底算 harness（执行）还是 scaffolding（行为）？HF 归 scaffolding，LangChain 归 harness，产品两者合并——尚无定论。
2. 模型能力增长会让 harness 变薄还是转移职责？缺乏单次快照之外的纵向数据。
3. 覆盖最少的组件（错误处理/重试策略、结构化输出 schema 校验、验证循环）的标准化最佳实践是什么？
4. harness 驱动的 15-34pp 基准摆动有多可复现、是否排除了评测 harness 的混杂因素（非确定性噪声、打分差异）？

---

## 七、关键引用速查

| 论点 | 逐字原文 | 来源 |
|---|---|---|
| harness 定义 | "Claude Code serves as the agentic harness around Claude." | Claude Code docs |
| Agent 公式 | "Agent = Model + Harness... If you're not the model, you're the harness." | HF glossary |
| agent 定义 | "LLMs autonomously using tools in a loop." | Anthropic（2025-09） |
| 灵感来源 | "Inspiration for these practices came from knowing what effective software engineers do every day." | Anthropic（2025-11） |
| 解耦 | "The model, the harness, and the product are three different things." | HF glossary |
| 不会消失 | "the agent is a system around the model, so they will not disappear — they just need to evolve too." | Harrison Chase, LangChain |

---

*完整原始报告（含每条 finding 的 evidence 原文 + 25 条验证投票明细，2549 行）由 deep-research workflow 生成于 2026-06。本文为人工整理的留档版。*
