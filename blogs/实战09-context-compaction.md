# 实战09：上下文压缩——历史顶到窗口之前，先自己瘦一圈

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战09）

实战08 解决的是"这一轮请求本身会不会失败"——网络抖一下、服务器过载一下，重试机制兜得住。但重试兜不住另一件事：只要对话足够长，`messages` 数组会一轮接一轮地往里塞用户消息、模型回复、工具调用、工具结果，哪怕每一轮请求都成功，历史本身也在悄悄变胖。200K token 的上下文窗口不是无限的，塞满那一刻，下一次请求会直接被服务器拒绝——不是"这次不巧"，是"这次根本装不下"。重试对这种失败无能为力，因为重试只会原样再发一遍同样装不下的请求。

这篇要解决的问题不是"请求失败了怎么办"，是"怎么在真正装不下之前，自己先瘦一圈"。

## 一、设计摊开：历史太长了，怎么办

### 折叠点①：拿什么当"满没满"的尺子——自己数字符，还是问 API 要账本？

判断历史占了多少空间，最直觉的做法是自己把 `messages` 里所有文本拼起来，除以某个"平均几个字符一个 token"的经验值。但这是个近似值，而且每次都要重新算一遍全部历史，越往后越慢。

更准的账本其实一直都在：每次请求成功后，API 响应里都带着一份 `usage`——这一轮到底吃掉了多少输入 token、吐出了多少输出 token，是模型自己的 tokenizer 数出来的，不是我们猜的。这份账不需要另开一个全局计数器去维护，直接挂在这一轮的 assistant 消息身上就行——`Message` 类型上加一个可选的 `usage` 字段，谁想知道"现在历史占了多大"，去最后一条带 `usage` 的 assistant 消息上取账，比自己从头数一遍准，也比维护一个游离在消息之外的计数器更不容易跟真实历史脱节。

### 折叠点②：门槛怎么定——是不是要等塞满了才动手？

如果非要等 `messages` 真的把 200K token 塞满才压缩，那说明触发压缩的那次请求本身已经晚了——这次请求都装不下，还谈什么"这次请求正常发出去，压缩下一轮再做"。必须留出安全垫，在真正塞满之前就先动手。

留多大的垫子，涉及两个独立的预留：一是这一轮如果模型正常回话，它的输出本身要占一块地方（`COMPACT_MAX_OUTPUT_TOKENS = 20_000`），窗口里刨掉这块才是"真正能拿来装历史"的有效空间（`getEffectiveContextWindowSize`）；二是即便刨掉这块之后，也不能卡着有效空间的边线才触发，还要再留一道安全垫（`AUTOCOMPACT_BUFFER_TOKENS = 13_000`），才是真正触发压缩的门槛（`getAutoCompactThreshold`）。窗口本身（`MODEL_CONTEXT_WINDOW_DEFAULT = 200_000`）是普通模型的兜底值。三个数字都不是拍脑袋定的教学取整——本项目最后要转生产用，数字必须原样照抄真实门槛：

```
门槛 = 200_000（窗口）− 20_000（给这轮摘要输出留的地方）− 13_000（安全垫）= 167_000
```

### 折叠点③：压缩到底"压"什么——删旧消息，还是让模型自己写一份摘要？

顶到门槛之后，最简单粗暴的做法是把最老的几条消息直接砍掉，只留最近的一部分。这样做的问题是：被砍掉的那部分可能藏着后面还用得上的关键信息（比如用户很早之前定下的一个约束条件），砍了就是真丢了，模型没有任何机会挽回。

更稳妥的做法是让模型自己读一遍全部历史，写一份详细摘要，再用这份摘要**整段替换**掉原来的历史——信息被压缩了，但没有被硬切掉，模型自己决定什么该留、什么可以浓缩。这也是这一篇明确划的范围：只做"整段替换"，不做"保留最近 N 条、其余摘要掉"这种局部裁剪（那需要额外一条 `messagesToKeep` 的界线，属于另一层复杂度，这篇不碰）。

### 折叠点④：写摘要这次调用，算这场对话的一部分吗？

压缩本身也是一次模型调用——把历史喂给模型，请它写摘要。这次调用要不要沿用这场对话平时那份系统提示词（实战07 装的那份"这轮该怎么表现"的说明书）？

不该沿用。平时那份系统提示词是为了让模型在这场对话里扮演好它的角色（要用什么工具、语气该怎样），但写摘要是一个完全不同的、一次性的任务，跟这场对话平时聊什么无关。所以压缩这次调用换一份专门服务这一个任务的极简系统提示词：

```typescript
const COMPACT_SYSTEM_PROMPT = 'You are a helpful AI assistant tasked with summarizing conversations.'
```

### 折叠点⑤：这次调用要不要让模型继续能调用工具？

如果这次调用仍然带着完整的工具列表，模型完全可能在写摘要的过程中忽然决定"我要不要先查一下文件确认细节"，调用一次工具——但这一轮的唯一任务是产出一段摘要文本，一次意外的工具调用就等于浪费掉这仅有的一轮。

这篇的做法是靠一段前言死死按住模型："CRITICAL: Respond with TEXT ONLY. Do NOT call any tools."，并且这次调用干脆不传任何工具（`tools: undefined`）——完全依赖文字指令，不留后门。

### 折叠点⑥：摘要写完了，怎么塞回下一轮，不让模型一脸懵地问"发生了什么"？

模型写完摘要后，下一轮请求带着的历史应该只剩这份摘要，模型看到的是一段孤零零的文字，没有前因后果。直接把摘要原文当成一条新消息塞回去，模型很可能会先愣一下，反问"你要我做什么"——这一问一答又要浪费一轮。

解决办法是把摘要包进一段固定措辞的用户消息里，明确交代"这是压缩前对话的摘要，接着做就行，别问问题"：

```
This session is being continued from a previous conversation that ran out of context.
The summary below covers the earlier portion of the conversation.

Summary:
...

Continue the conversation from where it left off without asking the user any
further questions. Resume directly...
```

（这段话眼熟吗？这就是这篇博客这次对话本身在长到一定程度后，会收到的那种续接提示——你现在读到的这句解释，正是这个机制真实生效时长的样子。）

![骨架定位图：调用方入口（index.ts→runAgent）不变，改动分两层。底层账本：types.ts 给 Message 和 StreamEvent 加一个可选的 usage 字段（用量长在消息自己身上，不是另开计数器），anthropic.ts/openai.ts 各自从 SSE 流里把这份用量抠出来随 done 事件带出，loop.ts 把它塞进这一轮的 assistant 消息。压缩本体：src/compact.ts 是本章核心新文件——三个阈值常量算出门槛、tokenCountWithEstimation 由近及远找最后一条带 usage 的消息、shouldAutoCompact 判断该不该动手、compactMessages 发起一次独立的摘要调用（专属 system、不带工具）。src/compactPrompt.ts 是另一个新文件——压缩请求的提示词文案、剥掉 analysis 只留 summary、包成续接消息三个纯函数。loop.ts 在每轮开口前插一次 shouldAutoCompact 检查，命中就调 compactMessages 后用 splice 整段替换 messages。底部灰色虚线框：SSE 解析主体、工具调用累积、权限闸门、重试机制、系统提示词装配，全部沿用实战02-08，一个字没改。](assets/img/实战09-skeleton.svg)

---

## 二、代码落地

改动清单：`types.ts` 给 `Message`/`StreamEvent` 加 `usage` 字段；`anthropic.ts`、`openai.ts` 从各自的 SSE 流里抠出用量；新增 `src/compact.ts`（阈值判断 + 压缩编排）与 `src/compactPrompt.ts`（压缩请求的文案）；`loop.ts` 把用量记进历史，并在每轮开口前插一道压缩检查。

### `src/types.ts`：用量长在消息自己身上

```typescript
export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface Message {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  usage?: Usage   // 只有 assistant 消息会带这个字段——这一轮实际吃掉的 token 账本
}
```

`done` 事件也带上同一个类型的 `usage?`，两端 provider 从各自的协议里把这个数字翻出来，随 `done` 一起吐给 `loop.ts`。

### `anthropic.ts` / `openai.ts`：从两种不同形状的流里抠出同一份账本

Anthropic 的用量分两次到——`input_tokens` 只在 `message_start` 报一次，`output_tokens` 在 `message_delta` 里报的是"跑到目前为止的累计总数"（不是增量），所以最后一次收到的值就是这轮的最终用量：

```typescript
if (event.type === 'message_start' && event.message?.usage?.input_tokens !== undefined) {
  usage = { inputTokens: event.message.usage.input_tokens, outputTokens: 0 }
} else if (event.type === 'message_delta' && event.usage?.output_tokens !== undefined) {
  usage = { inputTokens: usage?.inputTokens ?? 0, outputTokens: event.usage.output_tokens }
}
```

OpenAI 兼容协议默认不在流里带用量，得显式开一个开关（`stream_options: { include_usage: true }`），服务器才会在最后一个 `choices` 为空数组的 chunk 里额外塞一份 `usage`：

```typescript
const body: Record<string, unknown> = {
  model: self.model,
  stream: true,
  messages: openaiMessages,
  stream_options: { include_usage: true },
}
// ……
if (chunk.usage) {
  usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 }
}
```

两种协议的账本形状完全不同（一个分两拍报、一个塞在流末尾的特殊 chunk 里），但抠出来之后统一成同一个 `Usage` 形状交给 `loop.ts`——协议差异继续烂在各自 provider 内部，这是实战01 定的可插拔设计一路扛到这一章的又一个例子。

### `src/compact.ts`：阈值三常量 + 由近及远找账本 + 独立一次的摘要调用

阈值三个常量和折叠点②的公式直接对应：

```typescript
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000

export function getContextWindowForModel(_model: string): number {
  return MODEL_CONTEXT_WINDOW_DEFAULT
}

export function getEffectiveContextWindowSize(model: string): number {
  return getContextWindowForModel(model) - COMPACT_MAX_OUTPUT_TOKENS
}

export function getAutoCompactThreshold(model: string): number {
  return getEffectiveContextWindowSize(model) - AUTOCOMPACT_BUFFER_TOKENS
}
```

`tokenCountWithEstimation` 是折叠点①的字面落地——由近及远找最后一条带 `usage` 的 assistant 消息，它之后还没被这份用量覆盖到的新增消息（多是这一轮刚回来的工具结果），用 char/4 粗估补上：

```typescript
export function tokenCountWithEstimation(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'assistant' && message.usage) {
      const trailing = messages.slice(i + 1).reduce((sum, m) => sum + estimateTokensForChars(messageTextLength(m)), 0)
      return message.usage.inputTokens + message.usage.outputTokens + trailing
    }
  }
  return messages.reduce((sum, m) => sum + estimateTokensForChars(messageTextLength(m)), 0)
}

export function shouldAutoCompact(messages: readonly Message[], model: string): boolean {
  return tokenCountWithEstimation(messages) >= getAutoCompactThreshold(model)
}
```

`compactMessages` 是折叠点③④⑤⑥的汇合点——把 `getCompactPrompt()` 拼成一条新的 user 消息追加到历史后面，用专属的 `COMPACT_SYSTEM_PROMPT`、不传任何工具发起一次独立调用，拿到的摘要文本包成续接消息，**整段替换**掉原来的 `messages`：

```typescript
const COMPACT_SYSTEM_PROMPT = 'You are a helpful AI assistant tasked with summarizing conversations.'

export async function compactMessages(provider: ModelProvider, messages: readonly Message[]): Promise<Message[]> {
  const summaryRequest: Message = { role: 'user', content: getCompactPrompt() }
  const combined = [...messages, summaryRequest]

  let summaryText = ''
  for await (const event of provider.streamChat(combined, undefined, COMPACT_SYSTEM_PROMPT)) {
    if (event.type === 'text_delta') summaryText += event.delta
  }

  return [{ role: 'user', content: getCompactUserSummaryMessage(summaryText) }]
}
```

### `src/compactPrompt.ts`：压缩请求的文案，三个纯函数

`getCompactPrompt()` 拼出折叠点⑤的按住工具前言 + 正文任务说明 + 结尾再提醒一遍；`formatCompactSummary()` 把模型答案里的 `<analysis>` 草稿整段剥掉（那只是帮模型自己想清楚，没有信息增量），`<summary>` 标签换成人读的 `"Summary:\n"` 标题；`getCompactUserSummaryMessage()` 是折叠点⑥落成的续接消息：

```typescript
export function formatCompactSummary(summary: string): string {
  let formatted = summary.replace(/<analysis>[\s\S]*?<\/analysis>/, '')
  const summaryMatch = formatted.match(/<summary>([\s\S]*?)<\/summary>/)
  if (summaryMatch) {
    const content = summaryMatch[1] ?? ''
    formatted = formatted.replace(/<summary>[\s\S]*?<\/summary>/, `Summary:\n${content.trim()}`)
  }
  return formatted.replace(/\n\n+/g, '\n\n').trim()
}

export function getCompactUserSummaryMessage(summary: string): string {
  const formattedSummary = formatCompactSummary(summary)
  return `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${formattedSummary}
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`
}
```

### `src/loop.ts`：每轮开口前先看一眼，命中就整段换血

```typescript
for (let turn = 1; turn <= maxTurns; turn++) {
  if (shouldAutoCompact(messages, provider.model)) {
    process.stdout.write('\n[压缩] 历史接近上下文窗口阈值，正在摘要…\n')
    const compacted = await compactMessages(provider, messages)
    messages.splice(0, messages.length, ...compacted)
    process.stdout.write('[压缩] 完成，继续对话\n[assistant] ')
  }

  // ……原有的 streamChat 消费逻辑不变……

  // done 事件到达时，这一轮的用量随之落地
  usage = event.usage
  // ……
  messages.push({ role: 'assistant', content: text, toolCalls, usage })
}
```

`messages.splice(0, messages.length, ...compacted)` 是折叠点③"整段替换"的字面写法——用 `splice` 而不是重新 `const` 一个新数组，是因为外面握着的是同一个 `messages` 引用，`splice` 能在不改绑定的前提下把数组内容整个换血；如果改成重新赋值一个新数组，`runAgent` 函数体里所有闭包捕获的 `messages` 引用都得跟着重新对齐，徒增一层麻烦。

![主控制流程图：每轮循环最前面插入一次 shouldAutoCompact(messages, model) 检查。若为 false，直接走原有的 streamChat 消费路径（跟实战08 一模一样）。若为 true：先打印"正在摘要"提示，调用 compactMessages(provider, messages)——内部把 getCompactPrompt() 追加成一条新 user 消息，用 COMPACT_SYSTEM_PROMPT、tools:undefined 发起一次独立的 streamChat 调用（这次调用不受 shouldAutoCompact 影响，也不再触发递归压缩），收集全部 text_delta 拼成 summaryText，包成 getCompactUserSummaryMessage(summaryText) 返回。拿到返回的单条消息数组后，messages.splice(0, messages.length, ...compacted) 整段替换，打印"完成"提示，然后正常进入这一轮真正的 streamChat(messages, tools, system) 调用——这次模型看到的历史只剩一条摘要消息。done 事件到达后 usage 落地，随 assistant 消息一起 push 进历史，供下一轮 shouldAutoCompact 再次读取账本。](assets/img/实战09-flow.svg)

### 验证：`compact-test.ts`，边界值 + 一次真实的 runAgent 整合验证

先验证纯函数的边界——阈值算出来是不是 167_000，卡在门槛正好、越过门槛、够不着门槛三种用量分别判断对不对：

```
===== 验证①：阈值三常量算出来的门槛 =====
  getAutoCompactThreshold('fake-model') = 167000
  等价于 200_000 - 20_000(摘要预留) - 13_000(安全垫) = 167000

===== 验证②：tokenCountWithEstimation 边界——按最后一条带 usage 的 assistant 消息算，不是数字符串 =====
  below 用量 120，够不着阈值：tokenCount=120，shouldAutoCompact=false
  atThreshold 卡在门槛上：tokenCount=167000，shouldAutoCompact=true
  overThreshold 越过门槛：tokenCount=167500，shouldAutoCompact=true
```

只验证孤立的阈值函数还不够——它证明了"该不该压缩"这个判断本身是对的，但没证明 `loop.ts` 真的在每轮开口前调用了它、压缩之后对话真的能接着往下走。所以又加了一段整合验证：假 provider 第一轮故意报一份越过阈值的巨额用量并带一个工具调用，逼循环走进第二轮；第二轮开口前，`shouldAutoCompact` 该命中，压缩调用该发生，压缩完之后模型该能正常收尾：

```
===== 验证③：整合跑一遍 runAgent——用量越过阈值后，下一轮开口前自动压缩，对话继续不崩 =====

[assistant] 我需要先查一下环境
  [turn 1] noop({}) -> ok…

[压缩] 历史接近上下文窗口阈值，正在摘要…
[压缩] 完成，继续对话
[assistant] 压缩之后，继续把任务做完

[最终回复] 压缩之后，继续把任务做完
[压缩调用次数] 1（应为 1：只在越过阈值的那一轮触发一次，之后不再重复触发）
```

![序列图：两轮循环，第二轮前触发一次压缩。三条生命线：loop.ts、compact.ts、FakeProvider。第①拍 loop.ts 第 1 轮开口前调 shouldAutoCompact，历史还很短，返回 false，正常调 streamChat，FakeProvider 回一段文本 + 一个工具调用 + done(usage=越过阈值的巨额用量)。第②拍 loop.ts 把这份 usage 随 assistant 消息一起 push 进 messages，执行 noop 工具，工具结果也 push 进 messages。第③拍进入第 2 轮，开口前再调 shouldAutoCompact——这次 tokenCountWithEstimation 找到刚才那条带巨额 usage 的 assistant 消息，判定越过门槛，返回 true。第④拍 loop.ts 调 compactMessages(provider, messages)，内部拼出摘要请求、用 COMPACT_SYSTEM_PROMPT 发起一次独立的 streamChat 调用，FakeProvider 认出这个专属 system，回一段 analysis+summary 文本。第⑤拍 compactMessages 剥掉 analysis、包成续接消息，返回单条消息数组，loop.ts 用 splice 整段替换 messages。第⑥拍 loop.ts 用换血后的 messages 正常发起这一轮真正的 streamChat 调用，FakeProvider 认出这不是压缩调用，回一段正常收尾文本，done 无工具调用。第⑦拍 loop.ts 发现 toolCalls 为空，return 收工。结论：compactMessages 是嵌在正常轮次之间的一次额外调用，对 loop.ts 主流程完全透明——只是在真正开口前多做一次检查、必要时多打一次独立的模型请求。](assets/img/实战09-sequence.svg)

当篇 checkpoint：`git tag harness-ch09-context-compaction`。

---

## 三、🔬 翻开源码

去 `claude-code-rev` 里核对了真实 Claude Code 的压缩逻辑（`context.ts`、`autoCompact.ts`、`tokens.ts`、`tokenEstimation.ts`、`compact.ts`、`prompt.ts`），核心思路一致，但真源码要应付的场景复杂得多。

### 1. 阈值三常量数字原样一致，但 `getContextWindowForModel` 是一整条我们没有基础设施支撑的长链

`MODEL_CONTEXT_WINDOW_DEFAULT`、`COMPACT_MAX_OUTPUT_TOKENS`、`AUTOCOMPACT_BUFFER_TOKENS` 三个数字（200_000、20_000、13_000）和公式结构跟真源码完全一致——这不是巧合，是故意照抄，因为这几个数字直接决定"什么时候触发压缩"，教学缩小规模没有意义，本项目最后要转生产用。

但 `getContextWindowForModel` 在真源码里不是一个常量返回值，是一整条判断链：先看 ant 内部专用的环境变量覆盖，再看模型是否在 1M 上下文的 beta 白名单里，再查一张按模型能力划分的注册表，一路查到最后才落到 `200_000` 这个兜底值。这条链上除了最后一环，其余全部依赖我们没有的基础设施（模型能力注册表、1M beta 白名单、ant 内部实验开关）——这不是数值上的缩水，是结构性裁剪：真源码对不在任何名单里的普通模型，自己也是兜底到这同一个 `200_000`，我们直接实现了兜底这一环。

`COMPACT_MAX_OUTPUT_TOKENS` 在真源码里是 `min(该模型的最大输出 token 数, 20_000)`——我们没有逐模型的最大输出注册表，直接用 `20_000`（多数模型的最大输出本就不到这个数，`min` 兜不住的情况很少见）。

### 2. `tokenCountWithEstimation` 思路一致，但真源码要处理"同一个 API 响应拆成多条消息"这回事

真源码的这份账本要额外应付一种我们不会遇到的情况：同一次 API 响应，在某些场景下会被拆成多条消息记录（按 `responseId` 关联），账本得先把同一个 `responseId` 下的消息合并计数，再决定"最后一条带账的消息"是哪个。我们的 harness 里，一轮请求永远对应恰好一个 assistant 消息、一份 `usage`，不存在"一个响应拆成几条消息"的情况，所以不需要这段按 `responseId` 回溯合并的逻辑——这不是简化掉了功能，是这个问题在我们的架构里压根不存在。

### 3. char/4 粗估比例一致，但真源码按内容类型区分比例

`roughTokenCountEstimation` 默认 `bytesPerToken=4`，跟我们 `estimateTokensForChars` 的 `chars/4` 是同一个比例。但真源码对 JSON 类型的内容用的是 `bytesPerToken=2`（JSON 里大量的标点、引号、转义字符会让"一个 token 对应的字符数"变少，统一用 4 会低估）。我们的消息里工具调用参数确实是 JSON 字符串，但没有按内容类型区分比例——统一用 4，这是一处已知的、故意的粗糙化，换来一个更简单的心智模型（"不管什么内容，四个字符约等于一个 token"），生产场景如果要更准，这里是可以继续细化的点。

### 4. 压缩系统提示词逐字一致，但真源码这次调用还留着一个我们没有的工具保底

`COMPACT_SYSTEM_PROMPT` 这句英文原样照抄源码。但真源码这次调用即便在提示词里三令五申"不要调用工具"，`tools` 参数仍然传了一个 `[FileReadTool]`——留这个保底是配合真源码自己的一整套"工具调用被拒绝/被截断后自动恢复重试"的机制存在的：万一模型真的无视指令调用了工具，那套恢复逻辑能接得住，不至于让整个压缩流程直接崩掉。我们的 harness 没有对应的恢复路径，所以这里更激进——`tools: undefined`，完全不给模型工具，只靠文字指令按住，没有保底。这是一处刻意的、比源码更简化的选择，不是遗漏。

### 5. 压缩请求的文案逐字照抄，但源码还有我们故意不搬的 `PARTIAL`/`PARTIAL_UP_TO` 变体

`NO_TOOLS_PREAMBLE`、`DETAILED_ANALYSIS_INSTRUCTION`、`BASE_COMPACT_PROMPT`、`NO_TOOLS_TRAILER` 这几段英文文案，逐字照抄源码 `prompt.ts` 里的 `BASE` 变体——生产用不改教学措辞。但源码 `prompt.ts` 里还有 `PARTIAL` 和 `PARTIAL_UP_TO` 两个变体，对应"只保留最近一部分消息、其余摘要掉"这种局部压缩（也就是折叠点③里提到、明确划出范围之外的 `messagesToKeep` 局部裁剪）。我们这一篇的设计边界从一开始就只做"整段历史一次性摘要替换"，所以这两个变体没有搬——不是漏看了，是设计阶段就划掉的范围。

### 6. 续接消息包装逻辑一致，但真源码有一个我们用不上的分支开关

`getCompactUserSummaryMessage`（源码同名函数）逻辑一致——都是"续接提示 + 摘要正文 + 别再问问题"这三段拼接。但源码这个函数带一个 `suppressFollowUpQuestions` 开关：为 `false` 时，续接消息末尾会换成一句反问模型"要不要我针对刚才摘要里提到的某件事接着做"，把控制权交还给交互式会话里的人；只有 `suppressFollowUpQuestions=true` 时才是我们抄的这句"直接继续，别问"。源码还会在这条消息里带一个 `transcriptPath`，方便模型或工具事后回查完整的原始会话记录。我们的 harness 是单进程内一次性跑到底的 agent 循环，压缩完立刻自己接着跑下一轮，不存在"另开一个交互式会话、等人来确认"这回事，所以硬编码死了 `suppressFollowUpQuestions=true` 这一条分支，也没有 `transcriptPath`——单进程跑完就退出，没有可供事后翻阅的会话文件。

### 7. 真源码里还有一整套我们完全没碰的相邻机制

核对源码时还看到几个明显更复杂、这一篇故意没涉及的机制：`reactiveCompact.ts` 在当前源码里其实是一段死代码（没有被实际调用路径引用到，更像是一次未完成的实验或者被新机制取代后忘了删）；除此之外还有 microcompact（更细粒度、不整段替换的压缩策略）、session-memory（跨会话持久化的记忆层，不是单次对话内的压缩）、context-collapse/snip（针对超长工具结果的专项裁剪，不等到整体阈值触发也会单独收缩）。这些都是围绕"上下文别爆"这同一个问题的更复杂解法，本章只挑了其中最基础的一条——阈值触发、整段摘要替换——作为骨架，其余留在这篇的范围之外。

## 小结

- 判断历史占了多大，用 API 自己报的 `usage`，不是自己重新数一遍字符（折叠点①）。
- 触发压缩不能等真塞满，要留出摘要输出预留 + 安全垫两层缓冲，门槛算下来是 `200_000-20_000-13_000=167_000`（折叠点②）。
- 压缩不是删消息，是让模型自己写一份摘要，用摘要**整段替换**掉原历史——不做局部保留的 `messagesToKeep`（折叠点③）。
- 写摘要是一次独立的模型调用，换一份专属的极简系统提示词，跟这场对话平时聊什么无关（折叠点④）。
- 这次调用不给模型工具，完全靠文字前言按住，比真源码留的 `FileReadTool` 保底更激进（折叠点⑤）。
- 摘要要包成固定措辞的续接消息塞回历史，让模型直接接着干，不反问用户发生了什么（折叠点⑥）。
- 三个阈值常量、压缩系统提示词、压缩请求文案，全部逐字照抄源码数值/原文——本项目最后要转生产用，教学场景不该悄悄改动这些决定"什么时候触发""怎么触发"的关键数字。

🔬 源码对照：
- `context.ts` — `getContextWindowForModel` 完整判断链（ant 环境变量→1M beta 白名单→能力注册表→…→200_000 兜底），我们只实现了最后的兜底环
- `autoCompact.ts` — 三个阈值常量与公式结构，数字原样一致
- `tokens.ts` — `tokenCountWithEstimation`，思路一致，我们不需要真源码按 `responseId` 合并多条消息那一段
- `tokenEstimation.ts` — `roughTokenCountEstimation`，比例一致但真源码按内容类型区分（JSON 用 2，我们统一用 4）
- `compact.ts` — 压缩系统提示词逐字一致，真源码这次调用仍带 `[FileReadTool]` 保底，我们完全不给工具
- `prompt.ts` — 压缩请求文案逐字照抄 `BASE` 变体，未搬 `PARTIAL`/`PARTIAL_UP_TO` 局部压缩变体
- `prompt.ts`（`getCompactUserSummaryMessage` 同名函数）— 续接消息包装逻辑一致，我们硬编码了 `suppressFollowUpQuestions=true` 且没有 `transcriptPath`
- `reactiveCompact.ts` — 当前源码里的死代码；microcompact/session-memory/context-collapse-snip 是更复杂的相邻机制，本章范围之外

Harness 现在能在历史真正塞满窗口之前自己先瘦一圈，长对话不会突然被服务器拒之门外。但压缩解决的是"一整场对话"级别的膨胀——如果问题出在单次工具结果本身就异常庞大（比如一次读文件读回来几万字），压缩要等到阈值命中才会触发，来不及救这一轮。下一篇看这个。
