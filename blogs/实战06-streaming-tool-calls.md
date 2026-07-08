# 实战06：流式工具执行/解析——把 loop 真正重构成流式

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战06）

实战05 留了一笔账没还：文本已经边到边喂出来了，但工具调用还是「实战02 的老样子」——`chat()` 内部把 `input_json_delta` 攒成字符串，攒够了才 `parse` 一次，`chat()` 本身也还是**憋到底才 `return` 一整包** `ChatReply`。这一篇把账还上：工具调用参数**边流边解析**（攒完这一个块的那一刻就 `parse`，不用等整条流跑完），`chat()` 这个"等一整包"的接口本身也**推倒重建**——不再是 `Promise<ChatReply>`，而是一个真正的**流式生成器**，`loop.ts` 也要跟着重写，从"等一个 `Promise`"变成"用 `for await` 消费一串事件"。

**先说清楚这不是"加一个参数"能解决的**：实战05 的 `onToken` 是**追加式**的——老接口 `chat(): Promise<ChatReply>` 原样保留，只是多塞一个可选回调。这一篇不是这个套路。卷首语就立过一条规矩："引入流式时会把非流式 loop 重构为流式生成器，这是**重塑主干**，不是**加一个零件**"。`chat()` 这个方法本身，从这一篇起不再存在——换成 `streamChat()`，`loop.ts` 里消费它的写法也从 `await` 整体换成 `for await` 逐个事件。这一次是真的要动骨架。

---

## 一、设计摊开：接口怎么换血、完成信号怎么找、loop 主干怎么重建

这一篇是**基础设施篇**——跟实战05 一样，不是"有真设计分叉、需要你现推"的那类（loop 骨架、权限三态、compaction 才是那类）。所以这里不摆考题，直接把几个要拿主意的地方摊开讲，你随时可以打断、可以说"这块我不同意"。

### 折叠点①：`chat()` 换成 `streamChat()`，为什么敢删掉老接口

先看一个事实：`chat()` 现在只有一处调用方——`loop.ts`。这个事实很关键，它决定了"能不能痛快地删掉重建"这件事的胆量从哪来。

如果 `chat()` 被三五个模块各自调用、各自处理返回值，直接改签名就是一场牵一发动全身的手术，那时候"加一个可选参数"（实战05 的 `onToken` 套路）才是唯一现实的路。但这里不是——`grep` 一下就知道，全仓库只有 `loop.ts` 这一个调用点。既然只有一个调用方，**没有"半路子调用方被破坏"的风险**，那就没理由留着两套接口并存（一个 `chat()` 憋到底、一个新增方法流式），干脆彻底替换，接口只有一份，心智负担最小。

新接口长什么样？现在返回值不再是"等到的一整包"，而是一个 `AsyncGenerator`：

```ts
streamChat(messages: Message[], tools?: Tool[]): AsyncGenerator<StreamEvent>
```

调用方不再 `await` 一次拿到全部结果，而是 `for await (const event of provider.streamChat(...))` 一个个接事件。这跟实战05 的 `onToken` 回调本质上是同一件事的两种写法吗？这里其实叠着两条正交的轴，得拆开看：

- **轴一：push vs pull。** 回调是"外面递一个函数进去，里面帮你调"（push，被调方主动喊）；生成器是"外面自己拉，拉一个是一个"（pull，控制权在调用方手上）——能用 `for await` 表达"逐个处理"、能在满足某个条件时直接 `break` 提前收尾不用等对方喊完。这才是这一篇真要生成器、不继续加回调的理由。
- **轴二：一条通道装三种事情 vs 三个专属回调。** 这靠的是可辨识联合（下一个折叠点要定的 `StreamEvent`），跟"是不是生成器"没有必然关系——就算不换生成器，把 `onToken` 的签名换成 `onEvent?: (event: StreamEvent) => void` 一样能用一条通道装三种事件，三头喊话的问题照样能消掉。

这一篇两条轴都占了——但先说清楚：**真正需要生成器的理由是控制权（轴一），不是"能装几种事件"（轴二，回调也能做到）**。

### 折叠点②：一条通道装三种事情，用可辨识联合把它们分开

流式过程中，provider 要往外报的事情其实只有三类：

1. 来了一片文本；
2. 一个工具调用的参数攒完了、解析好了；
3. 这一轮彻底结束了（不管有没有工具调用）。

这就是 `types.ts` 里新加的 `StreamEvent`：

```ts
export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; stopReason: string }
```

跟实战02 把 `Message` 劈成可辨识联合是同一个手法（回扣 实战00b：全卷最核心的类型技巧）——因为流式过程中，从 provider 吐出来的东西天生就不止一种形状，硬塞进一种类型只会逼着调用方到处判断"这个字段有没有值"。三个 `type` 分开定，`loop.ts` 消费的时候一个 `switch`/`if` 链就把三件事分得清清楚楚。

### 折叠点③：工具调用的参数字符串，什么时候算"攒完了"

这是这一篇真正的硬骨头。实战05 的策略是"流结束才解析"——好判断，因为"流结束"是一个全局唯一的时刻。但这一篇要**边流边解析**：一个工具调用的参数攒完，就该立刻吐一个 `tool_call` 事件，不用等模型说完这一整轮（这一轮可能后面还有文字、还有别的工具调用）。问题来了：怎么知道"这一个工具调用的参数攒完了"，而不是"还没攒完，只是刚好中间有一段像 JSON 那样"？

两家协议在这一点上给出的信号完全不同，得分开看。

**Anthropic 有显式的"这块结束了"事件**——`content_block_stop`。实战05 里这个事件是被忽略的（"忽略比处理更省心"，因为那时候不需要知道任何一块什么时候结束，反正是流结束才统一处理）。这一篇把它请回来：一个 `tool_use` 块的 `content_block_stop` 一到，就是"这个块彻底封版了"的权威信号，此刻 `parse` 一次、吐一个 `tool_call` 事件，比等到整条流结束早得多。

**OpenAI 兼容协议（GLM）没有这种显式信号**——没有"块开始/块结束"这两种事件的区分，每一行 `data:` 都是独立的完整包（实战05 已经讲过这个协议差异）。那怎么知道一个工具调用参数攒完了？答案要从协议本身能给的线索里找：每个工具调用都带一个 `tool_calls[].index`，只要这个 `index` **还没变**，说明追加的还是同一个工具调用的参数片段；一旦下一片数据带来一个**新的 `index`**，就说明上一个 `index` 的参数字符串已经不会再有片段追加进来了——它"攒完了"，可以在这一刻 `parse` 并吐出 `tool_call` 事件。

```
tool_calls: [{index:0, function:{arguments:'{"pa'}}]     ← index 0，累加中
tool_calls: [{index:0, function:{arguments:'th":"x"}'}}]  ← 还是 index 0，继续累加
tool_calls: [{index:1, function:{name:'list_dir'}}]       ← index 变成 1！index 0 的参数不会再变了，该 flush 了
```

这条推理链有一个漏洞，必须堵上：**最后一个工具调用永远没有"下一个 index"来触发这次 flush**——它是这一轮里最后一个出现的调用，流结束时它还在 `pending` 里等着，没有人告诉它"你也攒完了"。所以主循环跑完之后，还需要一次**兜底 flush**：拿着循环里最后记住的 `currentIndex`，把它对应的那个 `pending` 条目补发一次 `tool_call` 事件。

这两条推理路径（Anthropic 的显式事件 vs GLM 的 index 隐式反推）确实是我们自己在协议约束下想出来的，不是照抄某个 SDK——GLM/OpenAI 兼容这一层协议抽象本身，卷首语就交代过，是这个系列自己的设计产物，不是照哪个真实项目搬的。但这条推理必须用真实的多工具调用请求验证，不能只在脑内推演就相信它成立——下面代码落地之后有专门一段验证。

### 折叠点④：loop 主干怎么重建，以及一个刻意不做的事

`streamChat()` 换血之后，`loop.ts` 消费它的方式必须跟着变——不再 `await` 一次拿整包，而是：

```ts
let text = ''
const toolCalls: ToolCall[] = []
for await (const event of provider.streamChat(messages, tools)) {
  if (event.type === 'text_delta') { text += event.delta; process.stdout.write(event.delta) }
  else if (event.type === 'tool_call') { toolCalls.push(event.call) }
}
```

循环该不该继续的判断依据**没有变**——还是"这一轮有没有收到过 `tool_call` 事件"，不看 `done` 事件里的 `stopReason` 字符串（这条道理从实战02 就立住了，翻源码那节会再对照一次）。变的只是"怎么拿到这些数据"：从"等一个 `Promise` resolve"变成"用 `for await` 一个个接事件，接完才知道这一轮收没收到工具调用"。

但这里有一个**刻意不做的事**，得摊开说：真实 Claude Code 的源码里，工具调用其实不是等"这一轮彻底结束"才开始执行的——一个 `tool_use` 块刚从流里解析出来，就立刻在后台开始跑这个工具了，跟"模型还在吐这一轮剩下的文字/别的工具调用"完全并发。这一篇的教学 harness **没有**照抄这个"边解析边执行"的并发行为——`loop.ts` 里工具还是等 `for await` 整个循环跑完（也就是这一轮的 `done` 事件到达之后）才开始逐个执行，顺序执行。

为什么明知道真源码是并发的，这一篇却选择不复刻？两个理由，都不是"偷懒"：

1. **实战04 的权限闸门跟"边解析边执行"不兼容**——一个工具调用刚解析出来就要执行，意味着可能在模型还没吐完这一轮文字的时候，就要弹出"是否允许执行"的确认框。这个交互怎么跟"文字还在边流边打印"共存，是一个新的设计问题，不是这一篇"边流边解析"范围内的账。
2. **这一篇的验收线本来就是"边流边解析"，不是"边流边执行"**——设计文档给这一篇划的范围就是把 `input_json_delta` 的解析时机提前、把 loop 主干从非流式改成流式生成器，没有要求工具执行时机也跟着提前。真源码那条"并发执行"的账，翻源码那节会诚实地记一笔、附上真实行号，但不在这一篇复刻。

这不是回避真相，是明确划线——下面翻源码那节会把真实行为原样摆出来，让你自己判断这条简化是否合理。

设计摊开到这里，全局地图先亮出来——哪些文件动了、哪些没动：

![实战06 骨架定位图：调用方 index.ts → runAgent 循环，权限闸门 permission.ts、五个工具、消息历史结构全部沿用实战02-05（灰，不改）。本章唯一新增/改动是深色高亮：ModelProvider 接口的 chat() 被删除、换成 streamChat(): AsyncGenerator<StreamEvent>；types.ts 新增 StreamEvent 三态可辨识联合（text_delta/tool_call/done）；anthropic.ts 用 content_block_stop 触发工具调用参数的即时 parse；openai.ts 用 tool_calls[].index 变化反推块结束、并在流结束后兜底 flush 最后一个；loop.ts 从 await chat() 整包改成 for await 消费事件流，循环条件依旧是"toolCalls 是否为空"。底部灰字：工具顺序执行、权限闸门三态、消息历史结构一个字没改——这一篇只重建"模型层怎么把工具调用交给 loop"这一条管子](assets/img/实战06-skeleton.svg)

---

## 二、代码落地

改动清单：`types.ts` 的 `ModelProvider.chat()` 被删除、换成 `streamChat()`，新增 `StreamEvent` 类型；`anthropic.ts`/`openai.ts` 的 `chat()` 整段重写成 `streamChat()` 生成器；`loop.ts` 的 `runAgent()` 内层循环从 `await chat()` 改成 `for await` 消费事件流。工具、权限闸门、消息历史结构——一个字不改。

### 接口：`StreamEvent` 三态 + `streamChat()` 生成器

```ts
// src/types.ts
export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | {
      type: 'done'
      /**
       * 停止原因，已抹平两端字段名差异。⚠️ 只统一了"字段位置"没统一"取值词表"
       * （Anthropic end_turn/tool_use、OpenAI stop/tool_calls），别拿它跨端 switch。
       * 循环该不该继续，看有没有收到过 tool_call 事件，不看这个字符串（回扣源码 query.ts §554）。
       */
      stopReason: string
    }

export interface ModelProvider {
  readonly name: string
  streamChat(messages: Message[], tools?: Tool[]): AsyncGenerator<StreamEvent>
}
```

老的 `chat()` 方法和 `ChatReply` 类型直接删除——没有第二个调用方需要照顾。

### Anthropic 端：`content_block_stop` 触发即时 parse

```ts
// src/providers/anthropic.ts
const blocks: ContentBlock[] = []
let stopReason = 'end_turn'
for await (const payload of readSSE(res)) {
  const event = JSON.parse(payload) as { /* ... */ }
  if (event.type === 'content_block_start' && event.index !== undefined && event.content_block) {
    blocks[event.index] =
      event.content_block.type === 'tool_use'
        ? { type: 'tool_use', id: event.content_block.id ?? '', name: event.content_block.name ?? '', inputJson: '' }
        : { type: 'text', text: '' }
  } else if (event.type === 'content_block_delta' && event.index !== undefined && event.delta) {
    const block = blocks[event.index]
    if (event.delta.type === 'text_delta' && block?.type === 'text') {
      const delta = event.delta.text ?? ''
      block.text += delta
      yield { type: 'text_delta', delta }
    } else if (event.delta.type === 'input_json_delta' && block?.type === 'tool_use') {
      block.inputJson += event.delta.partial_json ?? ''
    }
  } else if (event.type === 'content_block_stop' && event.index !== undefined) {
    const block = blocks[event.index]
    if (block?.type === 'tool_use') {
      yield { type: 'tool_call', call: { id: block.id, name: block.name, args: safeParse(block.inputJson) } }
    }
  } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
    stopReason = event.delta.stop_reason
  }
}
yield { type: 'done', stopReason }
```

跟实战05 的版本对比，改动只在两处：`content_block_delta` 的 `text_delta` 分支从"追加到 `text` 变量"改成直接 `yield`；新增 `content_block_stop` 分支，一个 `tool_use` 块结束就地 `parse` 并 `yield` 一个 `tool_call` 事件。`input_json_delta` 分支本身**没有变**——依然只做字符串拼接，不逐片 `parse`，实战05 立的 O(n²) 规避账，这一篇分毫未动，只是把 `parse` 的**触发时机**从"整条流结束"提前到"这一块结束"。

### OpenAI 兼容端：`index` 变化反推块结束 + 兜底 flush

```ts
// src/providers/openai.ts
const pending: PendingToolCall[] = []
let currentIndex: number | null = null
let stopReason = 'stop'
for await (const payload of readSSE(res)) {
  if (payload === '[DONE]') break
  const chunk = JSON.parse(payload) as { /* ... */ }
  const choice = chunk.choices?.[0]
  if (choice?.delta?.content) {
    yield { type: 'text_delta', delta: choice.delta.content }
  }
  for (const tc of choice?.delta?.tool_calls ?? []) {
    if (currentIndex !== null && tc.index !== currentIndex) {
      const done = pending[currentIndex]
      if (done) yield { type: 'tool_call', call: { id: done.id, name: done.name, args: safeParse(done.argsJson) } }
    }
    currentIndex = tc.index
    const slot = (pending[tc.index] ??= { id: '', name: '', argsJson: '' })
    if (tc.id) slot.id = tc.id
    if (tc.function?.name) slot.name += tc.function.name
    if (tc.function?.arguments) slot.argsJson += tc.function.arguments
  }
  if (choice?.finish_reason) stopReason = choice.finish_reason
}

// 兜底：最后一个工具调用没有"下一个 index"帮它触发 flush，流结束后手动补一次
if (currentIndex !== null) {
  const last = pending[currentIndex]
  if (last) yield { type: 'tool_call', call: { id: last.id, name: last.name, args: safeParse(last.argsJson) } }
}
yield { type: 'done', stopReason }
```

跟实战05 的版本对比：`pending` 数组、按 `tc.index` 归位取槽、字符串累加（`argsJson +=`）这套结构实战05 就已经有了——那时候只攒不 flush，等整条流跑完再统一处理。这一篇真正新增的，只是**触发时机**：`index` 变化时立刻 flush 上一个、主循环跑完后兜底 flush 最后一个；累加本身的那几行代码一个字没动。

`index` 反推逻辑就是折叠点③推出来的那条链：新 `index` 到达 → 上一个 `index` flush；主循环跑完 → 最后一个 `currentIndex` 单独兜底 flush 一次。少了这个兜底，最后一个工具调用会永远卡在 `pending` 数组里，一次 `tool_call` 事件都不会吐出来——这条边界下面有专门的真实请求验证。

### loop 收口：`for await` 消费事件流，循环条件不变

```ts
// src/loop.ts
for (let turn = 1; turn <= maxTurns; turn++) {
  let text = ''
  const toolCalls: ToolCall[] = []
  for await (const event of provider.streamChat(messages, tools)) {
    if (event.type === 'text_delta') {
      text += event.delta
      process.stdout.write(event.delta)
    } else if (event.type === 'tool_call') {
      toolCalls.push(event.call)
    }
    // done 事件本身不用管——收没收到过 tool_call 才是"这轮要不要继续"的判断依据
  }

  if (toolCalls.length === 0) {
    process.stdout.write('\n')
    return text
  }

  messages.push({ role: 'assistant', content: text, toolCalls })
  console.log()

  for (const call of toolCalls) {
    const tool = toolByName.get(call.name)
    const result = tool ? await runWithGate(tool, call.args, session, gate) : `error: 未知工具 ${call.name}`
    const preview = result.slice(0, 60).replace(/\s+/g, ' ')
    console.log(`  [turn ${turn}] ${call.name}(${JSON.stringify(call.args)}) -> ${preview}…`)
    messages.push({ role: 'tool', toolCallId: call.id, content: result })
  }
}
```

跟实战05 的版本对比：外层 `for` 循环、权限闸门、工具执行、历史记录——一个字没变。变的只是内层怎么拿到这一轮的 `text` 和 `toolCalls`：从 `await provider.chat(...)` 拿一整包，改成 `for await` 接事件流、自己在本地攒 `text` 和 `toolCalls` 两个变量，事件流跑完（对应 `done` 事件到达）才知道这一轮该不该收工。

### 验证：两端、三种场景，各跑一次真请求

**GLM，纯聊天（无工具）：**

```
[provider] openai-compat
[you]      你好，用一句话介绍一下你自己

[assistant] 你好！我是一个AI助手，能够帮助你完成各种任务，包括读取、编辑、创建文件，执行命令，以及回答问题和提供建议。
```

**Anthropic，纯聊天（无工具）：**

```
[provider] anthropic
[you]      你好，用一句话介绍一下你自己

[assistant] 你好！我是Claude，由Anthropic开发的AI助手，可以帮你回答问题、编写和调试代码、处理文件，以及完成各种日常任务和创作需求。
```

**GLM，单个工具调用：**

```
[provider] openai-compat
[you]      读一下 package.json，告诉我这个项目叫什么、有哪些 npm 脚本

[assistant]
  [turn 1] read_file({"path":"package.json"}) -> { "name": "mini-harness", "version": "0.1.0", "descrip…
## 项目信息
**项目名称**: `mini-harness`
...（后略，完整表格见仓库实测）
```

**Anthropic，单个工具调用：**

```
[provider] anthropic
[you]      读一下 package.json，告诉我这个项目叫什么、有哪些 npm 脚本

[assistant]
  [turn 1] read_file({"path":"package.json"}) -> { "name": "mini-harness", "version": "0.1.0", "descrip…
这个项目叫 **mini-harness**（版本 0.1.0）...
...（后略）
```

单工具调用能跑通不算稀奇——实战05 之前也一直能跑通。真正要验证的是折叠点③那条 `index` 反推链有没有漏洞，所以专门构造一个**一轮里连续两个工具调用**的请求，逼出"上一个 flush、最后一个靠兜底 flush"这两条路径都被真实触发：

**GLM，一轮两个工具调用：**

```
[provider] openai-compat
[you]      分别读一下 package.json 和 tsconfig.json，各用一句话概括这两个文件是干嘛的

[assistant]
  [turn 1] read_file({"path":"package.json"}) -> { "name": "mini-harness", "version": "0.1.0", "descrip…
  [turn 1] read_file({"path":"tsconfig.json"}) -> { "compilerOptions": { "lib": ["ESNext"], "module"…
- **package.json**：项目的清单文件，声明项目名称、版本、脚本命令和依赖项。
- **tsconfig.json**：TypeScript 编译器的配置文件，指定编译选项以及需要包含的源码目录。
```

**Anthropic，一轮两个工具调用：**

```
[provider] anthropic
[you]      分别读一下 package.json 和 tsconfig.json，各用一句话概括这两个文件是干嘛的

[assistant]
  [turn 1] read_file({"path":"package.json"}) -> { "name": "mini-harness", "version": "0.1.0", "descrip…
  [turn 1] read_file({"path":"tsconfig.json"}) -> { "compilerOptions": { "lib": ["ESNext"], "module"…
- **package.json**：定义了 `mini-harness` 这个基于 Bun 的项目的基本信息、依赖（TypeScript、Bun 类型）以及运行/类型检查/spike 测试等常用脚本命令。
- **tsconfig.json**：配置 TypeScript 编译器以严格模式、ESNext 目标和 bundler 模块解析方式对 `src` 和 `spike` 目录下的代码做类型检查（不实际输出编译产物）。
```

两个工具调用都成功执行、两条结果都正确塞回历史给模型总结——GLM 那边验证了"`index` 从 0 变到 1 时 flush 第一个、流结束后兜底 flush 第二个"这两条路径都被真实触发，不是只有兜底逻辑在裸测时才被覆盖；Anthropic 那边验证了两个 `content_block_stop` 各自独立触发各自的 `tool_call` 事件，互不干扰。

事件完成信号的两条路径画在一张图里对照：

![实战06 事件完成检测图：左侧 Anthropic 按 index 开块，text_delta 逐片 yield，tool_use 块的 input_json_delta 只攒字符串，content_block_stop 到达时（显式信号）立刻 safeParse 并 yield tool_call 事件。右侧 OpenAI 兼容按 tool_calls[].index 归位累加，主循环内一旦下一片数据的 index 与 currentIndex 不同就 flush 上一个 index（隐式反推信号），主循环结束后单独用当前 currentIndex 兜底 flush 最后一个，避免最后一个工具调用因为没有"下一个 index"而永远留在 pending 里。底部结论：两条路径殊途同归——都是"参数字符串攒完的那一刻就地 parse、立刻 yield tool_call"，只是"攒完"这件事一个有官方显式事件、一个要靠协议里能拿到的唯一线索反推](assets/img/实战06-completion-detection.svg)

---

## 三、一条刻意划清的界线：解析提前了，执行没有跟着提前

折叠点④埋下的伏笔在这里兑现。真实 Claude Code 的行为和这一篇的教学实现，在"工具调用解析完之后，什么时候真正开始跑"这件事上是不一样的——这条差异值得单独画一张图，因为它是这一篇最容易被"想当然"用错的地方。

- **真实 Claude Code**：`tool_use` 块一旦从流里解析完成，`StreamingToolExecutor` 立刻把它加入执行队列开始跑，这个执行跟"模型还在吐这一轮剩下的内容"是**并发**的，工具早就在后台干活了，模型那边可能都还没说完这一轮该说的话。
- **这一篇的 `loop.ts`**：`for await` 把这一轮的所有事件都接完（对应"这一轮彻底结束"）之后，才**顺序**执行 `toolCalls` 数组里攒到的所有调用——跟解析时机比，执行时机完全没有提前。

![实战06 真实源码时序 vs 教学简化对比图：上半部分标注"真实 Claude Code"——一条时间轴上，tool_use 块刚解析完成（虚线标记"parse 完成"）那一刻，StreamingToolExecutor 就在时间轴下方开出一条并行执行轨道，跟模型继续吐这一轮剩余内容的主轨道并行推进，两条轨道在"整轮结束+所有工具执行完毕"处才汇合、才把这一轮的 assistant 消息连同工具结果一起并入对话历史。下半部分标注"这一篇的教学 harness"——同一条时间轴上，tool_use 解析完成同样在这一刻发生（跟上方对齐，强调"解析提前了"这一点两边一致），但执行轨道要等这一整轮的 for await 循环彻底跑完（done 事件到达）之后才开始，且是顺序执行不是并行执行。底部说明框：解析时机两边一致（这一篇的改动焦点），执行时机两边不同（教学 harness 刻意不跟进"边解析边执行"），并列出两条不复刻的理由：实战04 的权限闸门 ask 交互跟并发执行不兼容需要新设计；这一篇的验收线是"边流边解析"不是"边流边执行"](assets/img/实战06-timing-contrast.svg)

这张图的重点不是"教学版更差"，是**诚实标出简化的位置**：解析时机这一篇跟真源码是同构的（都是"块一结束就地处理"），执行时机是有意保留的简化。翻源码那节会把这条差异对应到具体行号。

时序图把"边流边解析、事件流跑完才执行"这条主线画一遍：

![实战06 序列图：runAgent、provider（内部含 SSE 读取与完成检测）、模型 API 三条泳道。beat1 用户提问进入循环，provider 发起 stream:true 请求；beat2 text_delta 陆续到达并逐片 yield，loop 边收边 write 到 stdout；beat3 工具调用参数片段到达，provider 内部按各自协议的完成信号（content_block_stop 或 index 变化）判断某个工具调用攒完了，一攒完立刻 yield 一个 tool_call 事件，loop 把它推进本地 toolCalls 数组（此刻还不执行，只是收下）；beat4 done 事件到达，loop 的 for await 循环结束，这才检查 toolCalls 是否为空；beat5 若非空，loop 才开始顺序执行——逐个过权限闸门、调用 execute()、把结果塞回 messages，进入下一轮。底部红字点题：tool_call 事件比实战05 更早吐出来了（不用等整条流结束），但"收到事件"和"真正执行"之间还隔着一层——这一层是这一篇刻意保留、留给以后再拆的账](assets/img/实战06-sequence.svg)

当篇 checkpoint：`git tag harness-ch06-streaming-tool-calls`。

---

## 四、🔬 翻开源码：解析确实提前了，执行确实没跟着提前

打开还原源码 `claude-code-rev`，主循环在 `src/query.ts`，工具的并发执行调度在 `src/services/tools/StreamingToolExecutor.ts`。下面每条引用都对着当前文件内容重新核对过行号，不是凭上一次读到的印象。

### 工具解析完立刻起跑——真源码里"边解析边执行"的原始出处

`query.ts:826-844` 是主流式循环里处理一条 `assistant` 消息的分支。注意 `msgToolUseBlocks` 一旦解析出来，`streamingToolExecutor.addTool()` 立刻被调用：

```ts
if (message.type === 'assistant') {
  assistantMessages.push(message)
  const msgToolUseBlocks = message.message.content.filter(
    content => content.type === 'tool_use',
  ) as ToolUseBlock[]
  if (msgToolUseBlocks.length > 0) {
    toolUseBlocks.push(...msgToolUseBlocks)
    needsFollowUp = true
  }
  if (streamingToolExecutor && !toolUseContext.abortController.signal.aborted) {
    for (const toolBlock of msgToolUseBlocks) {
      streamingToolExecutor.addTool(toolBlock, message)
    }
  }
}
```

这一段发生在 `for await (const message of deps.callModel(...))`（`query.ts:659`）这个主流式循环**内部**——也就是说，这一轮里如果模型后面还要继续吐文字或者别的工具调用，`addTool()` 已经先把这个工具扔给执行器了，不等这一轮结束。这就是折叠点④说的"边解析边执行"的原始出处，不是我们编的。

### 但历史只在"整轮结束+工具排干净"之后才更新——`getRemainingResults()` 和拼接历史的那一行

工具虽然提前起跑，但`query.ts:1380-1408` 显示，主流式循环跑完之后，还要显式等待所有还没完工的工具：

```ts
const toolUpdates = streamingToolExecutor
  ? streamingToolExecutor.getRemainingResults()
  : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)

for await (const update of toolUpdates) {
  if (update.message) {
    yield update.message
    // ...toolResults.push(...)
  }
}
```

`getRemainingResults()` 这个名字本身就说明了逻辑——"提前跑起来的工具，可能有些已经跑完了、有些还没有，这里统一收口，把剩下没跑完的等完"。等这一步全部跑完之后，`query.ts:1716` 才把这一轮的 `assistantMessages` 和 `toolResults` 一起拼进下一轮要用的历史：

```ts
const next: State = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
  // ...
}
```

这就是折叠点④"执行早于历史更新"这句话的真实出处——工具在流还没结束时就开始跑了（`query.ts:826-844`），但只有等**这一整轮**结束、且**所有工具都跑完**（`query.ts:1380-1408` 的 `getRemainingResults()`），这一轮的消息才会被拼进历史（`query.ts:1716`），下一轮请求才会带着这些历史发出去。

这跟我们这一篇 `loop.ts` 的做法对比：我们的 `toolCalls` 数组是在 `for await` 循环**内部**收集、循环**结束后**才开始执行，执行本身也是顺序的——跟真源码"解析完立刻并发起跑"的差异就在这里，前面那张对比图画的正是这条线。

### `stopReason`/`stop_reason` 依旧不可靠——流式改造没有改变这一点

`query.ts:554` 附近的注释，实战02 翻过一次，实战05 又确认了一次没变，这一篇再确认一次，还是没变：循环该不该继续，看流式期间有没有出现过 `tool_use` 块，不是读这个字符串。我们 `loop.ts` 的循环条件从实战02 立住、实战05 没动过、这一篇同样没动——`toolCalls.length === 0` 才收工。

### `StreamingToolExecutor.ts`：只借来"何时该收口"的思路，不照搬并发调度

`src/services/tools/StreamingToolExecutor.ts`（530 行）里定义了一个 `TrackedTool` 类型，带 `status: 'queued'|'executing'|'completed'|'yielded'` 这种状态机、`isConcurrencySafe` 这种"这个工具能不能跟别的工具并发跑"的判断、还有 `discard()`（用于流式回退时丢弃孤儿结果）。这一篇没有引入这整套状态机和并发安全分级——理由跟折叠点④说的一样：这一篇的验收线是"边流边解析"，`isConcurrencySafe` 这种并发调度粒度的设计，留给以后真要做"边解析边执行"的时候再展开，不在这一篇打包进来。

---

## 小结

- **接口彻底换血，不是追加**：`chat(): Promise<ChatReply>` 直接删除，换成 `streamChat(): AsyncGenerator<StreamEvent>`——因为全仓库只有 `loop.ts` 一个调用方，没有"半路子调用方被破坏"的顾虑，没理由留两套接口并存。这是卷首语立的"重塑主干、不是加零件"这一刀真正落下的地方。
- **`StreamEvent` 三态可辨识联合**：`text_delta`/`tool_call`/`done`，跟实战02 把 `Message` 劈成可辨识联合是同一个手法——流式过程里 provider 要报的事情天生不止一种形状。
- **工具调用完成信号，两家协议靠不同线索判断**：Anthropic 有显式的 `content_block_stop`；GLM/OpenAI 兼容没有，只能靠 `tool_calls[].index` 变化反推，且最后一个调用必须靠流结束后的兜底 flush，否则永远吐不出来——这条边界专门用"一轮两个工具调用"的真实请求验证过，两条路径（换 index 触发的 flush、兜底触发的 flush）都被真实覆盖到。
- **loop 主干重建，循环条件没变**：`for await` 换掉了 `await` 整包，但"toolCalls 是否为空"这条判断依据、权限闸门、工具顺序执行——一个没动。
- **诚实划一条线，不是回避**：真源码里工具解析完立刻并发起跑（`query.ts:826-844`），但历史只在整轮结束+工具排干净后才更新（`query.ts:1380-1408`、`query.ts:1716`）。这一篇只把"解析"这半条线做到跟真源码同构，"执行"那半条线刻意留在原地不动——因为权限闸门的 `ask` 交互还没准备好跟并发执行共存，且这不在这一篇的验收范围内。
- 🔬 源码对照：`query.ts:659`（主流式循环）、`query.ts:826-844`（工具解析完立刻 `addTool()` 起跑）、`query.ts:1380-1408`（`getRemainingResults()` 收口等待）、`query.ts:1716`（历史只在此刻拼接）、`query.ts:554`（`stop_reason` 依旧不可靠，循环靠 `tool_use` 块判断）、`StreamingToolExecutor.ts`（状态机与并发分级，本篇不复刻）。

下一篇——**实战07**：loop 主干已经流式化，工具调用也边流边解析了，下一个该攒的账是什么？留到下一篇再摊开讲。
