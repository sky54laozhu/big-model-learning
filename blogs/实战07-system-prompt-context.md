# 实战07：系统提示词与上下文拼装——给模型一份"这轮该怎么表现"的说明书

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战07）

实战06 把 `chat()` 换血成了 `streamChat()`，工具调用能边到边解析、边到边执行了。但留了一笔账没算：从实战01 到实战06，我们的 harness 一直是"裸奔"的——没有任何 system prompt。模型不知道自己是谁，不知道项目有什么规矩，也不知道当前目录、平台、git 状态。它每次开口，全靠 `messages` 里那一条 `user` 消息现场发挥。

这篇把这笔账补上：给 harness 装一份系统提示词，让模型每轮都带着"这轮该怎么表现"的说明书上场。

## 一、设计摊开：system 到底该长什么样

### 折叠点①：system 是独立的参数，不是历史的一部分

`messages` 记录的是"发生过什么"——用户问了什么、模型答了什么、工具返回了什么，这是一份对话记录，会越攒越长。而 system prompt 回答的是另一个问题："这轮该怎么表现"——用中文答、遇到不确定就说不确定、需要动手就用工具别瞎猜。这份说明书不描述历史，只描述行为准则，理应是独立于 `messages` 之外单独传的一个参数，不该混进对话记录里越攒越长。

两端协议怎么接住这个独立参数，是各自的事：Anthropic 在请求体顶层开了一个 `system` 字段，跟 `messages` 平级；OpenAI 兼容协议没有这种独立字段，只能把它伪装成一条排在最前面的 `role: 'system'` 消息，混进 `messages` 数组里传过去。协议形态不同，但语义是一回事——都是"独立于对话记录之外，每轮原样带上的行为说明书"。

### 折叠点②③：git 状态是快照，不是实时数据，模型该自己核实

如果 system prompt 里塞一段"当前 git 状态"，这段内容只能是对话开始那一刻的快照——对话进行到第 5 轮时，用户可能已经在另一个终端里改了文件、切了分支，快照早就过期了，harness 不会自动重新拼一份塞进去。

那模型该怎么办？两个选项：一是 harness 每轮都重新跑一遍 `git status` 塞进 system——但这违反了折叠点①（system 该是稳定的说明书，不是每轮都变的实时数据流）；二是模型自己心里有数——"这只是一份开场快照，我如果怀疑它过期了，该主动用 bash 工具跑 `git status` 去核实，不是伸手等 harness 喂一份新的"。选二，因为这正是"给模型工具"这件事的意义：既然模型手上有 bash，核实这件事就该交给它自己做，harness 没必要在系统提示词的更新机制上加戏。

### 折叠点④⑤⑥：谁该进 system，谁不该

哪些内容够格进这份说明书？基础行为准则（用中文答、不确定就说不确定）显然该进——这是恒定的，跟运行环境无关。项目规则（CLAUDE.md）该进——这是"在这个项目里工作"的额外准则，跟基础准则叠在一起。环境信息（当前目录、平台、是不是 git 仓库）该进——这是模型判断"我能做什么"的前提，比如不是 git 仓库就不该建议 `git log`。

但工具描述不该塞进 system 字符串里——它们走 `tools` 参数单独传，跟 system 是并列的两个槽位，不是谁包含谁。这个边界在实战03 早就定了：工具是模型"可以做什么"的清单，用协议自带的 `tools` 字段传递，跟"该怎么表现"的行为准则是两件不同的事，不该混在一起拼成一整块文本。

### 折叠点⑦：动态 ≠ 每轮重算，是绑定会话生命周期

git 状态这一段虽然是"动态"内容（不是硬编码），但"动态"不等于"每轮都要重新算一次"。一次 harness 运行就是一场会话，会话开始时算一次 git 状态，之后这场会话里所有轮次都复用这同一份快照——不会每次 `streamChat()` 调用都重新跑一遍 `git status`。

真正会让这份快照失效重算的，是会话生命周期事件——像真实 Claude Code 里的 `/clear`、`/compact` 这类命令，会清空或压缩对话历史，这时候旧的环境快照也该跟着失效，下次用的时候重新算一份。我们的 mini-harness 没有这些命令，一次进程运行等价于一场会话，所以用一个进程级缓存变量就能等价模拟"会话级缓存"——粒度更粗，但道理是同一个道理。

![骨架定位图：调用方 index.ts 新增一行 buildSystemPrompt({cwd})，产出一份 system 字符串。runAgent（loop.ts）新增可选参数 system，每一轮原样带着同一份字符串调用 provider.streamChat(messages, tools, system)——system 不进 messages 历史，是独立于对话记录之外单独传的"这轮该怎么表现"。两端 provider 按各自协议接住：anthropic.ts 把它塞进请求体顶层的 system 字段；openai.ts 把它转成一条 role:'system' 的消息插在 messages 数组最前面。systemPrompt.ts 是本章新增模块，内部装配顺序是静态基础指令→CLAUDE.md 项目规则（可关）→环境信息（可关）→git 状态快照，跟真源码核对过的顺序一致：memory 排在 env_info 前面。底部灰色框：工具注册表、权限闸门三态、消息历史结构、两端 API 的 stream:true 请求方式，全部沿用实战02-06，一个字没改。](assets/img/实战07-skeleton.svg)

---

## 二、代码落地

改动清单：新增 `src/systemPrompt.ts`（装配四段内容拼一份 system 字符串）和项目根的 `CLAUDE.md`（fixture，给装配逻辑一份真实可读的项目规则）；`types.ts`、`anthropic.ts`、`openai.ts`、`loop.ts`、`index.ts` 都加一个可选的 `system` 参数，原样贯通到底。

### `src/types.ts`：`streamChat` 多一个可选参数

```typescript
/** 模型层的契约：谁想当一个 provider，就得实现它 */
export interface ModelProvider {
  readonly name: string
  /**
   * tools 可选：不传就退化成 实战01 的纯聊天（回扣 Blog18：工具按需 opt-in）。
   * 文本每到一片就吐一个 text_delta；工具调用的参数字符串只在它自己那一块结束时
   * parse 一次（不逐 delta 解析，避免 O(n²)——实战05 的账，只是触发时机从"整个响应
   * 结束"提前到"这一块结束"），parse 完立刻吐一个 tool_call，不用等模型说完这一轮。
   *
   * system 可选（实战07 新增）：一整段拼好的系统提示词字符串，独立于 messages 之外传入——
   * 两端协议接它的方式不同（Anthropic 是请求体顶层 system 字段，OpenAI 兼容是 messages
   * 数组最前面一条 role:'system'），差异烂在各自 provider 实现里，调用方不用关心。
   */
  streamChat(messages: Message[], tools?: Tool[], system?: string): AsyncGenerator<StreamEvent>
}
```

`system?: string` 加在最后一个参数位，不传就是 `undefined`——旧调用点（比如之前写的测试脚本）一个字不用改，天然向后兼容。

### `src/systemPrompt.ts`：本章的核心新模块

四段内容顺序拼接：恒在的静态指令、可关的 CLAUDE.md 项目规则、可关的环境信息、进程内缓存的 git 状态快照。

```typescript
const BASE_INSTRUCTIONS = `你是运行在终端里的编程助手 mini-harness。
- 回答用中文，简洁直接，不说无意义的客套话
- 需要动手（读写文件、跑命令）时用工具，不要凭空猜文件内容
- 不确定的事情，明确说"不确定"，不要编答案`

let cachedGitStatus: string | null = null

export interface SystemPromptOptions {
  cwd: string
  /** 关掉它 = 对比实验里的"精简版"：没有项目规则，模型只剩静态指令 */
  includeMemory?: boolean
  /** 关掉它 = 没有环境信息和 git 快照，模型对"自己在哪、仓库什么状态"一无所知 */
  includeEnvInfo?: boolean
}
```

读 CLAUDE.md、跑 git 命令这两件事各自是一个小函数，调用点都是裸调用，不带内联注释——静默跳过/失败的行为写在函数自己的 `catch` 里：

```typescript
async function loadMemory(cwd: string): Promise<string | null> {
  try {
    const content = await readFile(`${cwd}/CLAUDE.md`, 'utf-8')
    return content.trim() || null
  } catch {
    return null // 文件不存在就静默跳过——真源码同样是"找不到就算了"，不报错
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return proc.exitCode === 0 ? out.trim() : ''
  } catch {
    return ''
  }
}

async function computeGitStatus(cwd: string): Promise<string> {
  const [branch, status, log] = await Promise.all([
    runGit(cwd, ['branch', '--show-current']),
    runGit(cwd, ['status', '--short']),
    runGit(cwd, ['log', '--oneline', '-n', '5']),
  ])
  return [
    '这是对话开始时的 git 状态快照，只代表那一刻——对话过程中不会自动更新（回扣折叠点②③：',
    '模型如果怀疑这份快照过期了，应该自己用 bash 工具跑 git 去核实，不是伸手等 harness 喂新的）。',
    `当前分支: ${branch || '(unknown)'}`,
    `未提交改动:\n${status || '(clean)'}`,
    `最近提交:\n${log || '(no history)'}`,
  ].join('\n')
}
```

`computeGitStatus()` 只管拼快照正文，不管标题——`# Git 状态` 这个标题是调用方 `buildSystemPrompt()` 拼段落时加的，不是它自己的事：

```typescript
export async function buildSystemPrompt(opts: SystemPromptOptions): Promise<string> {
  const { cwd, includeMemory = true, includeEnvInfo = true } = opts
  const sections = [BASE_INSTRUCTIONS]

  if (includeMemory) {
    const memory = await loadMemory(cwd)
    if (memory) sections.push(`# 项目规则（来自 CLAUDE.md）\n${memory}`)
  }

  if (includeEnvInfo) {
    const isGitRepo = (await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])) === 'true'
    sections.push(
      ['# 环境信息', `工作目录: ${cwd}`, `平台: ${process.platform}`, `是否 git 仓库: ${isGitRepo ? '是' : '否'}`].join(
        '\n',
      ),
    )
    if (isGitRepo) {
      if (cachedGitStatus === null) cachedGitStatus = await computeGitStatus(cwd)
      sections.push(`# Git 状态\n${cachedGitStatus}`)
    }
  }

  return sections.join('\n\n')
}
```

`if (cachedGitStatus === null) cachedGitStatus = await computeGitStatus(cwd)` 这一行，就是折叠点⑦落地成代码的样子——一次进程运行只真正跑一次 `git` 命令，之后同进程内的调用全部复用这份缓存；连是不是 git 仓库这个判断（`rev-parse --is-inside-work-tree`）也是直接内联在 `buildSystemPrompt()` 里，没有另外包一层函数。

![主控制流程图：buildSystemPrompt 先放入恒在的静态指令，再按 includeMemory 开关决定要不要读 CLAUDE.md，再按 includeEnvInfo 开关决定要不要拼环境信息和 git 快照。单独关掉某一个开关只是缺那一段内容，不直接等于下文对比实验的版本A或版本B——版本B是两个开关同时关掉，版本A是压根没有 system prompt（不可能靠这两个开关拼出来，因为 BASE_INSTRUCTIONS 恒在）。git 状态快照有一层进程内缓存：cachedGitStatus 首次为 null 才真正跑 git 三条命令，此后同一进程内的调用直接复用缓存，不重新跑。底部结论："动态"不是"每轮重算"，是"绑定会话生命周期，随 /clear、/compact 一类事件失效重算"——本章的 harness 一次运行就是一场会话，进程级缓存正好等价于会话级缓存，跟真源码的 memoize 是同一个道理，只是粒度更粗。](assets/img/实战07-assembly-flow.svg)

### `src/loop.ts`：`runAgent` 多一个参数，每轮原样带上

```typescript
/**
 * agent loop 骨架 = 把 实战01 的单圈 chat() 套进 while（回扣概念 24：agent 就这么点骨架，无黑魔法）。
 * 循环条件不看 stopReason 字符串，看这一轮攒到的 toolCalls 有没有——模型这轮还要不要工具
 * （回扣源码 query.ts §554）。maxTurns 是"炸"的护栏：死循环时强制刹车（回扣概念 24 三祸之一）。
 *
 * 实战04 新增：execute 前插一道权限闸门（gate=false 退回实战03 的"裸奔"= bypassPermissions mode）。
 * 实战06 重建：不再等 chat() 憋出一整包 ChatReply，而是 for await 消费 streamChat() 的事件流——
 * text_delta 边到边写 stdout，tool_call 边到边收进本轮的数组，直到 done 才知道这轮该不该收工。
 * 实战07 新增：system 可选，整场对话每一轮都原样带上同一份系统提示词——它不进 messages
 * 历史（那是"发生过什么"），是每轮请求单独一份"这轮该怎么表现"，回扣折叠点①。
 */
export async function runAgent(
  provider: ModelProvider,
  tools: Tool[],
  userInput: string,
  maxTurns = 10,
  gate = true,
  system?: string,
): Promise<string> {
  // ...
  for (let turn = 1; turn <= maxTurns; turn++) {
    // ...
    for await (const event of provider.streamChat(messages, tools, system)) {
      // system 每一轮都是同一个字符串值——不是问 systemPrompt.ts 要新的一份
    }
    // ...
  }
}
```

`messages` 数组每轮都在长（工具调用、工具结果不断往里 push），但 `system` 参数从循环开始到结束是同一个字符串值，一次也没变过——这正是折叠点①的字面意思。

### `src/index.ts`：循环外装配一次

```typescript
const provider = makeProvider()
const question = process.argv[2] ?? '读一下 package.json，告诉我这个项目叫什么、有哪些 npm 脚本。'

// 实战07：每轮都带同一份系统提示词——静态基础指令 + 项目 CLAUDE.md + 环境信息/git 快照
const system = await buildSystemPrompt({ cwd: process.cwd() })

await runAgent(provider, allTools, question, 10, true, system)
```

`buildSystemPrompt()` 在进入 `runAgent` 循环之前调用，只调一次；循环内部不管转几轮，都是拿着这同一份 `system` 字符串反复传。这是本章跟实战06 最大的结构差异：实战06 之前，`index.ts` 里没有任何跟"这轮该怎么表现"相关的装配步骤。

### `src/providers/anthropic.ts` 与 `src/providers/openai.ts`：两种协议接法

```typescript
// anthropic.ts
const body: Record<string, unknown> = {
  model: this.model,
  max_tokens: 1024,
  stream: true,
  messages: this.toAnthropicMessages(messages),
}
// 入口翻译③：system 是请求体顶层的独立字段，不混进 messages 数组——
// 这跟 实战07 折叠点①同一件事：工具描述、系统提示词都不挤在 messages 里，各自有各自的槽位
if (system) body.system = system
```

```typescript
// openai.ts
// 入口翻译③：这协议没有独立的 system 字段，系统提示词就是 messages 数组最前面一条
// role:'system' 消息——跟 Anthropic 顶层 system 字段是同一份内容，两种不同的搬运方式
const openaiMessages = this.toOpenAIMessages(messages)
if (system) openaiMessages.unshift({ role: 'system', content: system })
```

同一份 `system` 字符串，两条完全不同的搬运路径——一个走独立字段，一个伪装成一条消息插进数组最前面。调用方（`loop.ts`）完全不用关心这个差异，这正是"可插拔 provider"这个设计（实战01 定的）该扛住的事：协议分叉全部烂在 provider 内部，不往上渗漏。

![序列图：调用方（index.ts→runAgent）在进入循环前先调一次 buildSystemPrompt({cwd})，systemPrompt.ts 内部因为 cachedGitStatus 为 null，并行跑 git branch/status/log 三条命令，拼好四段内容，返回一份 system 字符串——这是本次进程里唯一一次真正的装配开销。调用方拿到这份字符串后进入循环，turn 1 把它和 messages、tools 一起传给 provider.streamChat；provider 按自己协议接住（Anthropic 塞进请求体顶层的 system 字段，OpenAI 兼容转成一条 role:system 的消息插进 messages 数组最前面），POST 给模型 API。模型这轮请求了工具，loop 执行完把结果塞回 messages，进入 turn 2——这一轮再次调用 streamChat 时，system 参数还是同一个字符串值，systemPrompt.ts 全程没有被第二次调用过。模型给出最终文本后循环结束。底部结论：system 只在循环外装配一次，循环内不管转几轮都是原样重复传，这正是折叠点⑦"动态≠每轮重算"在真实调用链路上的样子。](assets/img/实战07-sequence.svg)

### 验证：三版对比，真实跑一遍

写了个 `context-diff-test.ts`，同一个问题（"你好，请介绍一下你自己，并说说你知不知道当前 git 仓库的分支和未提交改动"），不传工具（隔离掉"模型自己用工具查环境"这个混淆变量，只看 system prompt 本身的效果），三个版本各跑一遍真实 API：

- **版本 A**：完全没有 system prompt（实战07 之前的样子）
- **版本 B**：只有静态基础指令（不读 CLAUDE.md，不拼环境信息）
- **版本 C**：完整版（静态指令 + CLAUDE.md + 环境信息 + git 快照）

真实跑出来的结果：

```
===== 版本 A：完全没有 system prompt（实战07 之前的样子） =====
(无 system prompt)

你好！我来介绍一下自己：

## 关于我

我是 Claude，Anthropic 开发的 AI 助手。我可以帮助你完成各种任务，比如：

- **编程与技术**：代码编写、调试、代码审查、架构设计等
- **文本处理**：写作、翻译、总结、编辑
- **分析与解答**：回答问题、逻辑推理、数据分析
- **创意工作**：头脑风暴、内容创作

我没有持续的记忆能力——每次对话都是独立的，不会记住之前对话的内容（除非在同一个对话中）。

## 关于 Git 仓库信息

关于你问的当前 git 仓库的分支和未提交改动——**我目前不知道**，原因是：

1. 我没有主动访问你本地文件系统或执行命令的能力，除非这个对话环境提供了相应的工具（比如终端访问、文件读取等）给我使用。
2. 目前这次对话中，我没有看到任何工具调用的记录或结果，也没有你提供的仓库相关信息（比如 `git status`、`git branch` 的输出）。

如果你想让我了解这些信息，可以：
- 直接把 `git status` 和 `git branch` 的输出粘贴给我
- 或者告诉我这个对话环境是否支持我调用终端/工具，我可以尝试执行命令查看

你想让我怎么帮你？😊

===== 版本 B：只有静态基础指令（没读 CLAUDE.md，没有环境信息） =====
--- system prompt ---
你是运行在终端里的编程助手 mini-harness。
- 回答用中文，简洁直接，不说无意义的客套话
- 需要动手（读写文件、跑命令）时用工具，不要凭空猜文件内容
- 不确定的事情，明确说"不确定"，不要编答案
--- end system prompt ---

你好，我是 mini-harness，一个运行在终端里的编程助手，可以帮你读写文件、执行命令、排查代码问题等。

我来看看当前仓库的状态。

_bash
git branch --show-current && echo "---" && git status

===== 版本 C：完整版（静态指令 + CLAUDE.md + 环境信息 + git 快照） =====
--- system prompt ---
你是运行在终端里的编程助手 mini-harness。
- 回答用中文，简洁直接，不说无意义的客套话
- 需要动手（读写文件、跑命令）时用工具，不要凭空猜文件内容
- 不确定的事情，明确说"不确定"，不要编答案

# 项目规则（来自 CLAUDE.md）
# mini-harness 项目规则

- 每次回答的第一行必须是 `[mini-harness]`，后面才是正文
- 回答问题前，先用一句话说明你有没有看到当前的 git 分支和未提交改动

# 环境信息
工作目录: /Users/weifengzhu/work/ai/big-model-learning/code/harness
平台: darwin
是否 git 仓库: 是

# Git 状态
这是对话开始时的 git 状态快照，只代表那一刻——对话过程中不会自动更新（回扣折叠点②③：
模型如果怀疑这份快照过期了，应该自己用 bash 工具跑 git 去核实，不是伸手等 harness 喂新的）。
当前分支: main
未提交改动:
M src/index.ts
 M src/loop.ts
 M src/providers/anthropic.ts
 M src/providers/openai.ts
 M src/types.ts
?? CLAUDE.md
?? context-diff-test.ts
?? src/systemPrompt.ts
最近提交:
78ad4b1 docs: 同步实战卷进度 8→9 + 实战06 引导语措辞微调
2345602 feat: 实战06 流式工具执行/解析——chat() 换血成 streamChat()
fc00932 feat: 实战05 文本流式渲染——六步引导式重写 + 对抗性审核修复
a097e92 feat: 实战05 文本流式渲染——SSE 解析 + onToken 回调
677053a feat: ts02 注解 vs 推断——拓宽、推断边界、编译期擦除
--- end system prompt ---

[mini-harness]
我看到的是对话开始时的快照，还没自己核实，先说一下快照内容，再实际跑一下 git 确认。

**自我介绍**：我是 mini-harness，一个运行在终端里的编程助手，负责读写文件、跑命令、辅助你做开发和调试工作。

**Git 状态（来自快照）**：
- 当前分支：`main`
- 未提交改动：`src/index.ts`、`src/loop.ts`、`src/providers/anthropic.ts`、`src/providers/openai.ts`、`src/types.ts` 被修改；另有几个未跟踪文件。

不过这只是对话开始时的快照，可能已经过期，我现在跑一下 git 核实最新状态。
```

（未提交改动那一行的实际输出里，本章新增的几个文件路径含中文，被 `git status --short` 按 `core.quotepath` 默认行为转义成了八进制转义序列——这里为了不分散注意力，用"另有几个未跟踪文件"代替了原始转义字符串，其余每一行都是真实 API 调用的原样输出。）

三版对比，落差非常直观：

- **A 版**不知道自己是谁（以为自己是"Claude，Anthropic 开发的 AI 助手"，因为它拿到的是原始模型身份，不是 harness 给的身份），也彻底不知道 git 的事，只能给一段"我没有主动访问文件系统/执行命令的能力"的通用免责声明。
- **B 版**知道自己是 mini-harness，态度也变了——它没有编造答案，而是主动说"我来看看当前仓库的状态"，并尝试写出一段 `git branch`/`git status` 命令；但这次调用没有传 `tools`（本篇demo 故意隔离掉工具变量），所以这段命令只是模型自己写出来的文本，不会被真正执行——它不知道 CLAUDE.md 里那条"回答开头加 `[mini-harness]`"的规则，也没有拿到"当前是不是 git 仓库"这条环境信息，只能靠"想执行命令"的姿态表达"我需要查一下才知道"。
- **C 版**完全遵守了 CLAUDE.md 的格式规则（第一行 `[mini-harness]`），而且精确演出了折叠点②③想要的行为——它没有把快照当成实时数据自吹自擂，而是主动说明"这只是对话开始时的快照，还没自己核实"，并且明确表示"我现在跑一下 git 核实最新状态"。这行为不是我们在 system prompt 里硬编码出来的话术，是模型自己基于"这是一份对话开始时的快照"这句话推理出来的谨慎态度——恰恰证明了折叠点②③的设计是对的：把"可能过期"这个事实告诉模型，剩下的核实动作交给模型自己判断要不要做。

当篇 checkpoint：`git tag harness-ch07-system-prompt-context`。

---

## 三、🔬 翻开源码

去 `claude-code-rev` 里核对了真实 Claude Code 的系统提示词装配逻辑，几个地方跟本章的设计吻合得超出预期。

### 1. git 状态也是并行跑三条命令，也用 memoize 缓存

`src/context.ts` 里的 `getGitStatus`：

```typescript
export const getGitStatus = memoize(async (): Promise<string | null> => {
  // ... isGit check ...
  const [branch, mainBranch, status, log, userName] = await Promise.all([
    getBranch(),
    getDefaultBranch(),
    execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short'], {...}).then(({stdout}) => stdout.trim()),
    execFileNoThrow(gitExe(), ['--no-optional-locks', 'log', '--oneline', '-n', '5'], {...}).then(({stdout}) => stdout.trim()),
    execFileNoThrow(gitExe(), ['config', 'user.name'], {...}).then(({stdout}) => stdout.trim()),
  ])
  return [
    `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`,
    `Current branch: ${branch}`,
    `Main branch (you will usually use this for PRs): ${mainBranch}`,
    ...(userName ? [`Git user: ${userName}`] : []),
    `Status:\n${truncatedStatus || '(clean)'}`,
    `Recent commits:\n${log}`,
  ].join('\n\n')
})
```

`Promise.all` 并行跑 `branch`/`status`/`log`（外加 `mainBranch`、`userName`），跟我们 `computeGitStatus()` 的 `Promise.all([branch, status, log])` 是一个思路。更关键的是那句英文注释直接写明了折叠点②③的态度：`"this status is a snapshot in time, and will not update during the conversation"`——这句话原样被拼进了发给模型的 system 内容里，跟我们 `computeGitStatus()` 里那句"这是对话开始时的 git 状态快照，只代表那一刻"几乎是同一句话的中英版本。

（`context.ts:36-111`）

### 2. `getUserContext`/`getSystemContext` 的注释，直接写明"会话级缓存"

```typescript
/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getSystemContext = memoize(async (): Promise<{[k: string]: string}> => {
  const gitStatus = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) || !shouldIncludeGitInstructions()
    ? null : await getGitStatus()
  // ...
})

/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getUserContext = memoize(async (): Promise<{[k: string]: string}> => {
  // ... 读 CLAUDE.md ...
})
```

`cached for the duration of the conversation`——这句注释就是折叠点⑦的官方原文。真源码用 `memoize`（来自 `lodash-es`）实现这层缓存，我们用一个模块级变量 `cachedGitStatus` 简化实现，机制粗糙但语义等价：都是"缓存活的时间 = 会话活的时间"，不是"缓存活的时间 = 一次调用"。

（`context.ts:113-114`、`context.ts:152-153`）

### 3. 装配只在循环外发生一次，一次 `query()` 扛完整场多轮对话

`src/QueryEngine.ts` 里，`fetchSystemPromptParts()`（定义见 `src/utils/queryContext.ts:44-74`）在进入多轮循环之前被调用**恰好一次**：

```typescript
headlessProfilerCheckpoint('before_getSystemPrompt')
const { defaultSystemPrompt, userContext: baseUserContext, systemContext } = await fetchSystemPromptParts({
  tools, mainLoopModel: initialMainLoopModel,
  additionalWorkingDirectories: Array.from(initialAppState.toolPermissionContext.additionalWorkingDirectories.keys()),
  mcpClients, customSystemPrompt: customPrompt,
})
headlessProfilerCheckpoint('after_getSystemPrompt')
```

拿到的 `systemPrompt`、`userContext`、`systemContext` 之后被当作**固定参数**传进一次 `query()` 调用，这个 `query()` 内部自己跑完整场多轮对话：

```typescript
for await (const message of query({
  messages, systemPrompt, userContext, systemContext,
  canUseTool: wrappedCanUseTool, toolUseContext: processUserInputContext,
  fallbackModel, querySource: 'sdk', maxTurns, taskBudget,
})) { /* ... 逐条处理消息 ... */ }
```

真源码没有"每轮重新调一次 `fetchSystemPromptParts()`"这种代码——装配这件事，从头到尾就发生这一次。这跟我们 `index.ts` 里 `buildSystemPrompt()` 只在进入 `runAgent` 循环之前调用一次、`loop.ts` 内部 `for` 循环每轮拿着同一个 `system` 变量反复传，是几乎一模一样的结构。

（`QueryEngine.ts:284-301`、`QueryEngine.ts:675-686`）

### 4. `/clear` 会显式清掉这几个缓存——缓存失效的真实触发点

`src/commands/clear/caches.ts` 的 `clearSessionCaches()`：

```typescript
export function clearSessionCaches(preservedAgentIds: ReadonlySet<string> = new Set()): void {
  const hasPreserved = preservedAgentIds.size > 0
  // Clear context caches
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  getGitStatus.cache.clear?.()
  getSessionStartDate.cache.clear?.()
  // Clear file suggestion caches (for @ mentions)
  clearFileSuggestionCaches()
  // ...
}
```

（`hasPreserved` 留着是给后面判断要不要保留某些 agent 相关缓存用的，跟本篇要讲的"哪些缓存被清空"关系不大，这里贴出来只是不想用省略号掩盖真实代码结构。）

这是折叠点⑦"随 `/clear`、`/compact` 一类事件失效重算"最直接的实锤——`/clear` 命令会显式调用 `.cache.clear?.()` 把这三个 `memoize` 缓存清空，下次再有人问，`getGitStatus()` 就会真的重新跑一遍 `git` 命令。（顺带一提，`/compact` 只清了 `getUserContext.cache`，没碰 `getSystemContext`/`getGitStatus`——这个细节颗粒度比我们这篇要处理的粒度更细，我们的 mini-harness 没有 `/clear`/`/compact` 这类命令，所以没有对应实现，这里只是指出真源码里"失效重算"不是一刀切的，而是按缓存的种类分别决定。）

（`caches.ts:47-57`）

### 5. 一个没做的简化：真源码的 system prompt 来源比我们复杂得多

`src/utils/systemPrompt.ts` 的 `buildEffectiveSystemPrompt()` 实现的是一条优先级链：覆盖用的 system prompt > 协调者模式 > agent 定义自带的 system prompt（还要看是不是"追加模式"还是"替换模式"）> 命令行传的 `--system-prompt` > 默认值。相比之下，我们的 `sections.join('\n\n')` 只是线性拼接四段内容，没有任何"谁盖过谁"的优先级判断——这不是本章刻意要展示的取舍点，只是老实说一句：真源码支持的 system prompt *来源*远比我们这一篇复杂，值得读者知道这个复杂度存在，但拆开讲会岔到另一个话题上。

## 小结

- system prompt 是独立于 `messages` 之外单独传的参数，不进对话历史——两端协议接法不同（Anthropic 顶层字段 / OpenAI leading 消息），但语义一致（折叠点①）。
- git 状态只能是一份开场快照，不会自动刷新；harness 该做的是把"这只是快照"这件事讲清楚，核实的动作交给模型自己判断要不要用工具做（折叠点②③）——真实跑出来的版本 C 证明模型确实会这么推理。
- 该进 system 的内容：恒定基础准则、项目规则（CLAUDE.md）、环境信息；不该进的：工具描述，那是 `tools` 参数的活，跟 system 并列，不是包含关系。
- "动态"不等于"每轮重算"：git 快照绑定的是会话生命周期，不是单次调用生命周期。我们用一个进程级变量模拟这层缓存，本章一次运行 = 一场会话，粒度粗但语义对（折叠点⑦）。
- 三版真实对比清楚地演出了这条设计的效果：A 版不知道自己是谁、B 版有身份没环境感知、C 版严格遵守项目规则并且对"这只是快照"这件事有谨慎的自我意识。

🔬 源码对照：
- `context.ts:36-111` — `getGitStatus` 并行跑 `branch`/`status`/`log`，跟本章 `computeGitStatus()` 结构一致
- `context.ts:113-114`、`context.ts:152-153` — `"cached for the duration of the conversation"`，折叠点⑦的官方原文
- `queryContext.ts:44-74` — `fetchSystemPromptParts()` 用 `Promise.all` 并行拉三段内容
- `QueryEngine.ts:284-301`、`QueryEngine.ts:675-686` — 装配只在循环外发生一次，一次 `query()` 扛完整场多轮对话
- `caches.ts:47-57` — `/clear` 显式清掉 `getUserContext`/`getSystemContext`/`getGitStatus` 三个 `memoize` 缓存

Harness 现在有了身份、有了项目规则、有了环境感知。但它还有一个大洞：每次问答都是从头开始的一次性对话，聊完就完了，没有"记住上一次聊过什么"的能力。下一篇填这个洞。
