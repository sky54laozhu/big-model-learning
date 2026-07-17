# 全栈工程师的大模型学习笔记

> 从零到 AI 架构师 · 概念系列 32 篇（完结 🎉）+ 实战卷《从 0 写一个 Harness》进行中

## 第一阶段：理解大模型

> 🏁 里程碑：能看懂 Transformer 论文

| # | 标题 | 博客 | 视频 |
|---|------|:----:|:----:|
| 01 | [从 if-else 到概率预测：大模型是什么](01-what-is-llm.md) | ✅ | ✅ |
| 02 | [Token 与 Embedding：文字怎么变成数字](02-token-and-embedding.md) | ✅ | |
| 03 | [梯度下降：模型怎么学习](03-gradient-descent.md) | ✅ | |
| 04 | [Attention：让 token 理解上下文](04-attention.md) | ✅ | |
| 05 | [Transformer 完整架构：拼成一台机器](05-transformer-architecture.md) | ✅ | |
| 06 | [向量基础补课：程序员已经会的数学](06-vector-basics.md) | ✅ | |

## 第二阶段：训练的秘密

> 🏁 里程碑：能理解 Hugging Face 上任何模型卡片

| # | 标题 | 副标题 | 博客 | 视频 |
|---|------|--------|:----:|:----:|
| 07 | [Tokenizer 深入：BPE 算法与词表构建](07-tokenizer-bpe.md) | 一个中文字为什么被拆成三个 token？ | ✅ | |
| 08 | [预训练：从随机噪声到语言能力](08-pretraining.md) | 万亿 token 喂进去，模型到底学到了什么？ | ✅ | |
| 09 | [微调：让通才变专家](09-fine-tuning.md) | 怎么把"只会续写的基座"调教成"听话的助手"？ | ✅ | |
| 10 | [LoRA 低秩补课：只动 1% 参数的微调](10-lora-low-rank.md) | 为什么那点"改动"可以小到从数学上讲透？ | ✅ | |
| 11 | [RLHF 与 RLVR：对齐人类意图](11-rlhf-rlvr.md) | 模型怎么知道哪个回答更好？ | ✅ | |
| 12 | [模型的物理形态：参数、精度与显存](12-model-physical-form.md) | 70B 模型到底要多少显卡才能装下？ | ✅ | |

## 第三阶段：推理与部署

> 🏁 里程碑：能独立部署模型并理解性能瓶颈

| # | 标题 | 副标题 | 博客 | 视频 |
|---|------|--------|:----:|:----:|
| 13 | [推理过程：KV Cache 与批处理](13-kv-cache-batching.md) | 为什么第一个 token 慢，后面的快？ | ✅ | |
| 14 | [量化与蒸馏：大模型瘦身术](14-quantization-distillation.md) | 怎么让 70B 模型跑在单张消费级显卡上？ | ✅ | |
| 15 | [上下文窗口与长文本策略](15-context-window.md) | 128K 上下文真的能用满吗？ | ✅ | |
| 16 | [模型部署实战：从权重文件到 API 服务](16-model-deployment.md) | vLLM、Docker、负载均衡怎么搭？ | ✅ | |

## 第四阶段：构建 AI 应用

> 🏁 里程碑：能独立设计并交付生产级 AI 功能

| # | 标题 | 副标题 | 博客 | 视频 |
|---|------|--------|:----:|:----:|
| 17 | [Context Engineering：超越 Prompt 的上下文工程](17-context-engineering.md) | 为什么同一个模型，别人用得比你好？ | ✅ | |
| 番外 | [什么是"工程"？从 Prompt 到 Harness](17b-what-is-engineering.md) | 凭什么这堆事配叫"工程"？ | ✅ | |
| 番外 | [这颗"大脑"和你的不一样](18a-brain-vs-model.md) | 把模型当人，会在哪栽跟头？ | ✅ | |
| 18 | [结构化输出与工具调用](18-structured-output-tool-calling.md) | 怎么让模型稳定返回 JSON 并调用外部 API？ | ✅ | |
| 19 | [Embedding 应用：语义搜索与分类](19-embedding-applications.md) | 怎么让计算机理解「相似」这件事？ | ✅ | |
| 20 | [RAG 原理：给模型外挂知识库](20-rag-principle.md) | 模型不知道的事，怎么让它答对？ | ✅ | |
| 21 | [RAG 工程：向量库、分块与重排序](21-rag-engineering.md) | 为什么你的 RAG 效果总是不好？ | ✅ | |
| 22 | [评估与质量度量](22-evaluation.md) | 没有标准答案的时候怎么给 AI 打分？ | ✅ | |
| 23 | [对话记忆与状态管理](23-conversation-memory-state.md) | 长对话为什么会「失忆」，怎么治？ | ✅ | |
| 24 | [Agent：让模型自主行动](24-agent-autonomous-action.md) | 从工具调用到自主规划，模型怎么做决策？ | ✅ | |
| 25 | [Multi-Agent 与工作流编排](25-multi-agent-orchestration.md) | 什么时候让模型决策，什么时候用确定流程？ | ✅ | |

## 第五阶段：AI 架构设计

> 🏁 里程碑：能设计完整的 AI 平台架构

| # | 标题 | 副标题 | 博客 | 视频 |
|---|------|--------|:----:|:----:|
| 26 | [模型选型与智能路由](26-model-selection-routing.md) | 怎么用最少的钱达到最好的效果？ | ✅ | |
| 27 | [LLM 网关：统一接入层设计](27-llm-gateway.md) | 所有 AI 请求都该过一层网关吗？ | ✅ | |
| 28 | [韧性设计与成本工程](28-resilience-cost.md) | 模型挂了怎么办？token 费用怎么控制？ | ✅ | |
| 29 | [AI 系统的测试与持续交付](29-testing-continuous-delivery.md) | Prompt 改了一个字，怎么知道没有 regression？ | ✅ | |
| 30 | [安全与防护栏设计](30-security-guardrails.md) | 怎么防止用户绕过你的安全策略？ | ✅ | |
| 31 | [AI 系统的可观测性与监控](31-observability-monitoring.md) | 出了事，你怎么第一时间知道？ | ✅ | |
| 32 | [AI 平台战略：治理、多租户与演进](32-ai-platform-strategy.md) | 从第一个 AI 功能到全公司 AI 平台，怎么规划？ | ✅ | |

## 第六阶段：实战卷 · 从 0 写一个 Harness

> 🏁 里程碑：亲手焊出一台能跑的 mini-claude-code（共 20 篇，代码累积进 `code/harness/`，每章末打 tag）

| # | 标题 | 副标题 | 博客 | 视频 |
|---|------|--------|:----:|:----:|
| 卷首语 | [我们要亲手焊一台 harness](实战00-preface.md) | 为什么要从 0 写一个 Harness？ | ✅ | |
| 番外 | [先给 TypeScript 打地基（写给会 JS 的你）](实战00a-typescript-basics.md) | 会 JS，怎么最快迈到能读 TS？ | ✅ | |
| 番外 | [读懂本卷代码要的 TypeScript](实战00b-typescript-for-harness.md) | 可辨识联合/async function* 到底怎么读？ | ✅ | |
| 实战01 | [第一次对话：可插拔的模型层](实战01-first-call.md) | 怎么把一次 chat() 写成换环境变量就能切后端的层？ | ✅ | |
| 实战02 | [agent loop 骨架：给芯片套上循环](实战02-agent-loop.md) | while 的括号里到底填什么？ | ✅ | |
| 实战03 | [工具系统：从一只手到一套家伙，外加一个逃生舱](实战03-tool-system.md) | 一个 bash 不就够了？为什么还要 read/write/edit？ | ✅ | |
| 实战04 | [给逃生舱上锁：命令安全与人工审批](实战04-permission-gate.md) | 怎么判断一条命令安不安全？为什么这把锁永远关不严？ | ✅ | |
| 实战05 | [文本流式渲染：从「憋到底」到「边到边喂」](实战05-text-streaming.md) | SSE 怎么选、怎么切、协议怎么归位？ | ✅ | |
| 实战06 | [流式工具执行/解析：把 loop 真正重构成流式](实战06-streaming-tool-calls.md) | chat() 怎么换血成 streamChat()？工具调用什么时候算"攒完了"？ | ✅ | |
| 实战07 | [系统提示词与上下文拼装：给模型一份「这轮该怎么表现」的说明书](实战07-system-prompt-context.md) | system 到底该长什么样？git 状态快照过期了怎么办？ | ✅ | |
| 实战08 | [错误处理与重试：请求失败了，不该当场认输](实战08-error-handling-retry.md) | 什么失败值得重试？退避该多久？重试用尽该怎么办？ | ✅ | |
| 实战09 | [上下文压缩：历史顶到窗口之前，先自己瘦一圈](实战09-context-compaction.md) | 门槛怎么定？压缩到底压什么？摘要怎么塞回去不让模型懵？ | ✅ | |
| 实战10 | [跨会话状态：关掉重开，接着干](实战10-cross-session-state.md) | 明天接着聊，模型该记住什么？项目经验怎么跨对话生效？ | ✅ | |
| 实战11 | [TodoWrite 与 system-reminder：状态线自己开口提醒](实战11-todowrite-system-reminder.md) | 状态线怎么变成模型自己会调用的工具？多久没写、多久没提醒该怎么算？ | ✅ | |
| 实战12 | [子agent编排：一个函数递归调自己](实战12-subagent-orchestration.md) | 派一个"分身"去干活，这套机制怎么落进现有工具体系？ | ✅ | |
| 实战13 | [子agent转后台：一个参数，把「调用就得等」变成「愿等才等」](实战13-background-task-dispatch.md) | 调用能不能不原地等？结果没人等着接，该往哪儿放？ | ✅ | |
| 实战14 | [取消一个后台任务：一个 AbortSignal，怎么让两处真的被打断](实战14-task-cancellation.md) | 改主意了想叫停，一个信号怎么同时打断网络请求和子进程？ | ✅ | |
| 实战15 | [主动查一次后台任务：两张表合一张，问法却分两种](实战15-task-status-query.md) | 提交之后过了好几轮才想起来查，那时候还找得到吗？ | ✅ | |

## 独立系列：从 0 到精通 TypeScript

> 🏁 里程碑：读懂任何库的类型定义、自己写类型体操（共 21 篇，配填空练习仓 `code/ts-course/`）
>
> 暗线：**类型 = 一组允许的值（集合）**——联合是并集、收窄是取子集、never 是空集、条件类型是对集合做判断。

| # | 标题 | 副标题 | 博客 | 练习 |
|---|------|--------|:----:|:----:|
| 卷首语 | [给会写代码的人，补一门类型课](ts00-preface.md) | 为什么全栈老手也值得从 0 补 TS？ | ✅ | |
| ts01 | [类型是什么：一组允许的值](ts01-type-is-a-set.md) | 为什么说 boolean 就是集合 {true, false}？ | ✅ | ✅ |
| ts02 | [注解 vs 推断：谁来决定一个槽的集合](ts02-annotation-vs-inference.md) | let n = 42 没写类型，TS 怎么猜出 number 的？ | ✅ | ✅ |

---

*进度：概念系列 32/32（完结 🎉）· 实战卷 15/20 · TS 卷 3/21 · 视频 1/32*
