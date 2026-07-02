# 全栈工程师的大模型学习笔记

> 一个全栈开发者从零开始理解大模型原理的学习记录 · 从直觉到工程，每学一块写一篇博客
>
> **进度：概念系列 32 篇正文 + 2 番外 · 完结 🎉 ｜ 实战卷《从 0 写一个 Harness》进行中（5/20）**

## 学习理念

- **用工程师的方式学 AI**：用你熟悉的编程思维来理解每个概念
- **从直觉到数学**：先建立直觉，再补数学，最后看代码实现
- **引导式推导**：先把概念推通，再落成博客，每篇配 SVG 图解
- **每学一块，写一篇博客**：教是最好的学

> 📚 **完整目录与路线图见 [`blogs/README.md`](blogs/README.md)**，下方为带跳转链接的速览。

---

## 博客目录

### 第一阶段：理解大模型
> 🏁 里程碑：能看懂 Transformer 论文

| # | 标题 | 状态 |
|---|------|:----:|
| 01 | [从 if-else 到概率预测：大模型是什么](blogs/01-what-is-llm.md) | ✅ |
| 02 | [Token 与 Embedding：文字怎么变成数字](blogs/02-token-and-embedding.md) | ✅ |
| 03 | [梯度下降：模型怎么学习](blogs/03-gradient-descent.md) | ✅ |
| 04 | [Attention：让 token 理解上下文](blogs/04-attention.md) | ✅ |
| 05 | [Transformer 完整架构：拼成一台机器](blogs/05-transformer-architecture.md) | ✅ |
| 06 | [向量基础补课：程序员已经会的数学](blogs/06-vector-basics.md) | ✅ |

### 第二阶段：训练的秘密
> 🏁 里程碑：能理解 Hugging Face 上任何模型卡片

| # | 标题 | 状态 |
|---|------|:----:|
| 07 | [Tokenizer 深入：BPE 算法与词表构建](blogs/07-tokenizer-bpe.md) | ✅ |
| 08 | [预训练：从随机噪声到语言能力](blogs/08-pretraining.md) | ✅ |
| 09 | [微调：让通才变专家](blogs/09-fine-tuning.md) | ✅ |
| 10 | [LoRA 低秩补课：只动 1% 参数的微调](blogs/10-lora-low-rank.md) | ✅ |
| 11 | [RLHF 与 RLVR：对齐人类意图](blogs/11-rlhf-rlvr.md) | ✅ |
| 12 | [模型的物理形态：参数、精度与显存](blogs/12-model-physical-form.md) | ✅ |

### 第三阶段：推理与部署
> 🏁 里程碑：能独立部署模型并理解性能瓶颈

| # | 标题 | 状态 |
|---|------|:----:|
| 13 | [推理过程：KV Cache 与批处理](blogs/13-kv-cache-batching.md) | ✅ |
| 14 | [量化与蒸馏：大模型瘦身术](blogs/14-quantization-distillation.md) | ✅ |
| 15 | [上下文窗口与长文本策略](blogs/15-context-window.md) | ✅ |
| 16 | [模型部署实战：从权重文件到 API 服务](blogs/16-model-deployment.md) | ✅ |

### 第四阶段：构建 AI 应用
> 🏁 里程碑：能独立设计并交付生产级 AI 功能

| # | 标题 | 状态 |
|---|------|:----:|
| 17 | [Context Engineering：超越 Prompt 的上下文工程](blogs/17-context-engineering.md) | ✅ |
| 番外 | [什么是"工程"？从 Prompt 到 Harness](blogs/17b-what-is-engineering.md) | ✅ |
| 番外 | [这颗"大脑"和你的不一样](blogs/18a-brain-vs-model.md) | ✅ |
| 18 | [结构化输出与工具调用](blogs/18-structured-output-tool-calling.md) | ✅ |
| 19 | [Embedding 应用：语义搜索与分类](blogs/19-embedding-applications.md) | ✅ |
| 20 | [RAG 原理：给模型外挂知识库](blogs/20-rag-principle.md) | ✅ |
| 21 | [RAG 工程：向量库、分块与重排序](blogs/21-rag-engineering.md) | ✅ |
| 22 | [评估与质量度量](blogs/22-evaluation.md) | ✅ |
| 23 | [对话记忆与状态管理](blogs/23-conversation-memory-state.md) | ✅ |
| 24 | [Agent：让模型自主行动](blogs/24-agent-autonomous-action.md) | ✅ |
| 25 | [Multi-Agent 与工作流编排](blogs/25-multi-agent-orchestration.md) | ✅ |

### 第五阶段：AI 架构设计
> 🏁 里程碑：能设计完整的 AI 平台架构

| # | 标题 | 状态 |
|---|------|:----:|
| 26 | [模型选型与智能路由](blogs/26-model-selection-routing.md) | ✅ |
| 27 | [LLM 网关：统一接入层设计](blogs/27-llm-gateway.md) | ✅ |
| 28 | [韧性设计与成本工程](blogs/28-resilience-cost.md) | ✅ |
| 29 | [AI 系统的测试与持续交付](blogs/29-testing-continuous-delivery.md) | ✅ |
| 30 | [安全与防护栏设计](blogs/30-security-guardrails.md) | ✅ |
| 31 | [AI 系统的可观测性与监控](blogs/31-observability-monitoring.md) | ✅ |
| 32 | [AI 平台战略：治理、多租户与演进](blogs/32-ai-platform-strategy.md) | ✅ |

### 第六阶段：实战卷 · 从 0 写一个 Harness
> 🏁 里程碑：亲手焊出一台能跑的 mini-claude-code（20 篇，代码累积进 `code/harness/`）

| # | 标题 | 状态 |
|---|------|:----:|
| 卷首语 | [我们要亲手焊一台 harness](blogs/实战00-preface.md) | ✅ |
| 番外 | [先给 TypeScript 打地基（写给会 JS 的你）](blogs/实战00a-typescript-basics.md) | ✅ |
| 番外 | [读懂本卷代码要的 TypeScript](blogs/实战00b-typescript-for-harness.md) | ✅ |
| 实战01 | [第一次对话：可插拔的模型层](blogs/实战01-first-call.md) | ✅ |
| 实战02 | [agent loop 骨架：给芯片套上循环](blogs/实战02-agent-loop.md) | ✅ |

---

## 学习方法

每个主题的学习步骤：

1. **引导式推导** — 用类比和反问，先把概念在对话里推通
2. **对抗式审核** — 写完用多 agent 交叉审核，只改确认为真的问题
3. **图解输出** — 每篇配 SVG 图解，把抽象机制画成看得见的东西
4. **写博客** — 用自己的话复述，检验是否真懂

## 目录结构

```
big-model-learning/
├── README.md      # 本文件：带链接的博客速览
├── blogs/         # 博客文章 + 完整路线图（blogs/README.md）
│   └── assets/img/  # 每篇配套 SVG 图解
├── code/          # 实验代码
├── notes/         # 学习笔记 / 调研留档
├── animations/    # 视频动画工程（Remotion）
└── videos/        # 视频脚本与成片
```

---

*GitHub: [sky54laozhu/big-model-learning](https://github.com/sky54laozhu/big-model-learning)*
