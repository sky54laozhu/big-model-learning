# 实战05：文本流式渲染——从「憋到底」到「边到边喂」

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战05）

实战01 到实战04，`provider.chat()` 一直是**憋到底**的：请求发出去，人盯着一片空白等，直到模型说完整段话，`text` 才一次性冒出来。这一篇要治的就是这个「空白期」——跟你在终端里用 Claude Code、或者在网页版 ChatGPT / Claude 里看到的效果一样：**字是一个个蹦出来的**。

**先划清这一篇的范围**：实战04 结尾已经把账立好了——流式重构分两刀。这一篇（实战05）**只做文本**——工具调用还是跟实战02-04 一模一样，收完整参数字符串、一次性 parse、顺序执行；把「边流边解析工具参数」+「把 loop 主干重建成真正流式」这一整块硬骨头，留给下一篇实战06。这不是偷懒分期付款，是故意的：文本流式是**纯输出层**的活，工具流式是**要动 loop 主干**的活，揉在一篇里，读者分不清哪块难在哪。

别看这一篇不动 loop 主干，脑力活一点不少——**协议怎么选、怎么切、参数怎么攒、接口怎么加**，四处都是要自己拿主意的折叠点，不是照抄一份 SSE 规范就完事。

---

## 一、引导式设计：协议怎么选、怎么切、参数怎么攒、接口怎么加

先问一句大白话：网页版 ChatGPT / Claude 里那个字一个个蹦出来的效果，你有没有想过，那背后到底是——

- 网络真的是一点一点、随着模型生成把数据陆续送过来的，前端收到多少就显示多少；
- 还是浏览器早就拿到了完整一整段文字，只是前端写了个「打字机动画」，按固定间隔一个字一个字地显示出来（纯视觉效果，跟网络传输节奏没关系）？

答案是前者——**真的是网络实时送的**，不是动画。这不是巧合，是因为模型这边**本来就是边生成边吐**的：它写第一个字的时候，最后一个字还没算出来，没有理由攒够了才发。

### 折叠点①：单向推送，为什么选 SSE 不选 WebSocket

既然是「网络实时送」，那用什么协议送？WebSocket 和 SSE（Server-Sent Events）都能做「服务端主动往客户端推数据」，但设计目的不一样——WebSocket 是**双向**的：建连接要走一次握手升级，连上之后客户端服务端都能随时往对方发东西，中途还能来回聊。

大模型这个场景是什么样？**客户端问一句话，服务端单方向地把生成的内容一路推回来，中途客户端不需要再插话**。这就是纯粹的「一问、然后一路收到底」——不需要 WebSocket 那套双向握手、维护连接的机制，那是杀鸡用牛刀。SSE 建立在普通 HTTP 之上，天生就是「服务端往外推」的模型，刚好对上这个单向场景。两端 API（Anthropic、OpenAI 兼容的 GLM）也确实都是用 SSE 做流式协议的。

### 折叠点②：一坨连续字节，怎么切成一条一条消息

传输方式定了，但传输的是「一堆陆续到达的文字碎片」——网络不会自动帮你标好「这一条消息从哪开始、到哪结束」，它就是一坨连续的字节流。如果你是协议设计者，会怎么标记这个边界？

写过二进制协议的人可能会先想到**长度前缀**（先发 4 个字节说"接下来这条消息多长"，再发内容）——但这条路在这里走不通：长度前缀要求发送方在发送前就知道这条消息有多长，而流式生成恰恰是"边生成边发"，写第一个字的时候还不知道这句话总共要写多长，没有长度可以提前报。剩下能走的是**分隔符**：写过文本协议的人本能会先想到——**换行符 `\n`**。SSE 正是这么定的：一行就是一条消息，格式是 `data: <内容>\n\n`。

但这里有个陷阱：网络数据不是按你想要的行边界到达的。一次 `read()` 收到的一坨字节，可能**在一行中间被截断**——这次只收到 `"我是一"`，下一次才收到 `"个AI\n"`。如果直接每次收到数据就 `split('\n')`，这种「半行」会被提前吐出去或者丢掉。

想想你写过的场景：一个大文件按块（chunk）读进来，但你要按完整的行处理，怎么保证「半行」不被提前送出去？答案是**攒一个缓冲区**：新数据来了往后拼，用 `\n` 切一刀，切出来的**最后一段留着不吐**（它可能还没写完），前面完整的几段才吐给下一步：

```ts
// src/sse.ts
// 两家 provider 的流式响应都是 SSE（Server-Sent Events）：一行行 `data: <json>\n\n`。
// 这个生成器只管拆行、吐 data 负载——不管里面的 json 长什么样，那是各 provider 自己的事。
export async function* readSSE(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? '' // 网络包可能把一行切成两半，留到下一轮拼完整
    for (const line of lines) {
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
}
```

「怎么分行」是两家 provider 共享的重复劳动，抽出来一个生成器，谁都不用再写一遍。

全局地图先亮出来——哪些文件动了、哪些没动：

![实战05 骨架定位图：调用方 index.ts → runAgent 循环（灰色虚线框，实战02-04 已有骨架：①chat ②模型点名工具 ③空则 return，权限闸门 permission.ts 灰色不变）；循环经 provider 层连到双端 API。本章唯一新增/改动是深色高亮：provider 层内部新增 src/sse.ts（SSE 行读取生成器，两端共用），anthropic.ts/openai.ts 的 chat() 从"整段等完"改成"边读 SSE 边喂 onToken"，ModelProvider.chat() 接口新增第三个可选参数 onToken；loop.ts 把 onToken 接到 process.stdout.write。底部灰字：五个工具、权限闸门、消息历史结构，一个字没改——这一篇只动"文本怎么从 provider 传到屏幕"这一条管子](assets/img/实战05-skeleton.svg)

---

### 协议讲解：payload 里装的东西，两家完全不一样

「按行读」解决的是外层——一行一条消息。但一行 `data:` 里面装的 JSON，模型的一次完整回复可能不止一段文字，还可能夹着「要调用哪个工具、参数是什么」。这些东西混在同一条流里陆续到达，协议要怎么帮客户端分清楚：这一小片，到底是正文，还是某个工具调用参数？

### 折叠点③：多份内容交替到达，靠什么归位

假设模型这次回复更复杂——不止一段文字，还先后调了两个工具。协议并**没有承诺**这些内容块一定是"一个写完才轮到下一个"——即便目前实测两家 API 都是按顺序把一个块写完才开下一个，协议本身也没把这个顺序焊死，客户端不能靠"假设不会交替"来偷懒。光看一个 `type: tool_use` 不够分清是哪一片属于哪一个块。

答案是**编号**：每开始一份新内容（一段文字、或一个工具调用）时，按出现的先后顺序给它编号（0、1、2...）——这是协议把"客户端不该依赖到达顺序"这件事显式做成契约：服务端还是一条一条按顺序吐事件，但"这片是几号的"要显式标出来，客户端按编号把碎片归位，不依赖假设。这就是协议里的 `index` 字段。

### 折叠点④：编号+类型，要不要跟着每一片重复发

编号解决了「这片是谁的」，但客户端还得知道「0 号是文字类型、1 号是工具调用类型」，不然连往哪种容器里塞都不知道。这信息要不要跟着**每一片**内容重复发一遍？

两家协议在这一步给出了两种不同答案：

**Anthropic：只在第一次报到时说明类型，之后的碎片不再重复**——避免信息冗余。协议里分成两种事件：`content_block_start`（报到：编号+类型，只报一次）和 `content_block_delta`（来一片内容，只带编号和碎片）：

```
content_block_start  {index:0, content_block:{type:'text'}}         块0 开张，是文本
content_block_delta   {index:0, delta:{type:'text_delta', text:'我'}}   块0 来一个字
content_block_delta   {index:0, delta:{type:'text_delta', text:'是'}}   块0 再来一个字
content_block_start  {index:1, content_block:{type:'tool_use', name:'read_file'}}  块1 开张，是工具调用
content_block_delta   {index:1, delta:{type:'input_json_delta', partial_json:'{"pa'}}  块1 参数碎片
content_block_delta   {index:1, delta:{type:'input_json_delta', partial_json:'th":"x"}'}} 块1 参数碎片
message_delta          {delta:{stop_reason:'tool_use'}}
```

**OpenAI 兼容（GLM）：没有「先报到再发内容」这两种事件的区分**——每一行 `data:` 本身就是一个完整独立的包，文字和工具调用信息混在同一个包里，**每片都同时带上两个字段**，客户端看哪个字段有值就处理哪个（`delta.content` 有值是文字，`delta.tool_calls` 有值是工具调用）。这不追求省流量，换来的是每片自包含、不用记"之前报过的类型"这种状态。工具调用如果模型同时调了多个，用的还是同一个「编号」思路——`tool_calls[].index`：

```
{choices:[{delta:{content:'我'}}]}                                          文本碎片
{choices:[{delta:{content:'是'}}]}                                          文本碎片
{choices:[{delta:{tool_calls:[{index:0, id:'call_1', function:{name:'read_file'}}]}}]}
{choices:[{delta:{tool_calls:[{index:0, function:{arguments:'{"pa'}}]}}]}
{choices:[{delta:{tool_calls:[{index:0, function:{arguments:'th":"x"}'}}]}}]}
{choices:[{finish_reason:'tool_calls'}]}
data: [DONE]
```

结尾是字面量 `[DONE]`，不是一个 JSON——`readSSE` 吐出的每一行都要先判断是不是这个哨兵，是就跳出循环，不能拿去 `JSON.parse`。

两家协议长得不一样，是**两种不同的信息冗余取舍**，不是谁抄谁；但**处理策略殊途同归**：文本碎片来一个喂一个 `onToken`；工具参数碎片只攒字符串，不逐片解析——这一条，两家协议是共同的，也是这一篇最重要的一个折叠点，下面单独拆开讲。

![实战05 协议状态图：左侧 Anthropic 事件流（content_block_start 按 index 开块→content_block_delta 的 text_delta 追加到 text 块并触发 onToken/input_json_delta 追加到 tool_use 块的 inputJson 字符串→message_delta 拿到最终 stop_reason），右侧 OpenAI 兼容事件流（每行是完整 chunk→choices[0].delta.content 有值就追加+触发 onToken/choices[0].delta.tool_calls[].function 按 index 归位分片追加 name 和 arguments→finish_reason 非空更新 stopReason→遇到字面量 [DONE] 终止）。中间共享层标注：两家协议头顶都盖着同一层 SSE 分行（src/sse.ts 的 readSSE 生成器），行以下的 JSON 形状各不相同。底部黄字警示框：input_json_delta/tool_calls.arguments 全程只做字符串拼接，不在循环中 JSON.parse——留到流结束后一次性解析](assets/img/实战05-sse-protocol.svg)

---

### 折叠点⑤：工具参数碎片，来一片解析一片，还是攒够了再解析？

工具调用的参数（一段 JSON，比如 `{"path": "x.txt"}`）也是一片一片到达的碎片——先来 `{"pa`，再来 `th":"x.`，再来 `txt"}`。每来一片，是立刻 `JSON.parse()` 一下，还是先攒着、等这份工具调用彻底结束再一次性解析？

第一层原因很直接：普通 `JSON.parse` 碰到不完整的花括号会直接报错，所以至少得等结束才能解析。

但再往下追一层——**假设**真有一种「专门能容忍不完整 JSON、不会报错」的特殊解析器（现实里确实有，方便实时展示"目前进度"）。哪怕不报错，要不要「每来一片就用它重新解析一次目前攒到的全部内容」？

摊开算一笔账：一个工具的参数分 100 片到达，如果每片来了都重新解析一次"从头到现在攒的全部内容"：

| 第几片到达 | 已攒起来的字符串有多长 | 这一片要重新解析多长的内容 |
|---|---|---|
| 第 1 片 | 1 | 1 |
| 第 2 片 | 2 | 2 |
| ... | ... | ... |
| 第 100 片 | 100 | 100 |

100 次解析的总工作量是 `1+2+...+100`，跟"只在第 100 片解析一次、只处理长度 100"相比，差了一个数量级——片数越多，多付出的代价跟片数本身还是线性关系，**总代价 ∝ n²**，而"攒完再解析一次"是 **∝ n**。这就是 **O(n²) vs O(n)**。

**命名**：所以设计是——`inputJson`/`argsJson` 每片来了**只做字符串拼接**（`+=`），不调用任何解析器；只在流结束、片数不再增加时，才 `parse` 一次。

这不是教学简化，是踩过真坑的设计——官方 Anthropic SDK 的 `BetaMessageStream` 恰恰就是"每来一片 `input_json_delta` 就调一次 `partialParse()`"，为了让调用方能实时看到"参数攒到目前的样子"。这是官方 SDK 自己的功能取舍，**代价正是上面那张表**。真源码（`claude.ts:1818`）发现了这个隐藏的 O(n²) 代价，索性绕开 `BetaMessageStream` 这层封装，改用更底层的原始 stream，自己攒字符串、流结束才解析——不是抄反了，是刻意避开官方默认行为里的这个坑。

---

### 折叠点⑥：接口怎么加，才不破坏已经在用的老调用方

协议怎么解析清楚了，但这些解析出来的文字碎片，要怎么"喂"给外面调用它的 `runAgent` 循环，让它能边收到边打印？

类比一下前端上传文件的进度条：`xhr.onprogress` 会被反复调用很多次，通知"目前传了多少字节"；`onload`（或者你 `await` 到的那个 promise）只在最后触发一次，给最终结果。这是两件不同的事，共存在同一个函数里。

`chat(messages, tools)` 现在的返回值是 `Promise<ChatReply>`，实战01-04 的调用方都在等这个 promise resolve 才能拿到完整结果——你没法把一个"还没生成完"的 promise 提前 resolve 给调用方看一部分，但可以**加一个新的、可选的第三个参数，这个参数本身是一个函数**：老代码调用 `chat(messages, tools)` 时压根不传第三个参数（等于 `undefined`），完全不受影响；新代码传一个函数进去，`chat()` 内部每解析出一片文字就立刻调用一次这个函数，跟 promise 要不要 resolve 完全是两件事——promise 还是等全部处理完才 resolve，返回完整的 `ChatReply`。

**命名**：这就是 `onToken` 回调。

到这里，六个折叠点全部推完：**真流式非动画 → SSE单向对上场景 → 按行读+留尾巴缓冲 → index 给多份内容归位 → announce-once(Anthropic) / 双字段自包含(GLM) → 参数只攒字符串避开 O(n²) → onToken 可选回调不破坏老契约**。下面开始落地。

---

## 二、代码落地

改动清单：新增 `src/sse.ts`（上面已经全文贴出）；`types.ts` 的 `ModelProvider.chat()` 加一个可选参数；`anthropic.ts`/`openai.ts` 的 `chat()` 从"攒完再 return"改成"边读边喂"；`loop.ts` 接上回调打印。工具、权限闸门、消息历史结构——一个字不改。

### 接口：加一个可选参数，不破坏实战04的调用方

```ts
// src/types.ts
export interface ModelProvider {
  readonly name: string
  /**
   * tools 可选：不传就退化成 实战01 的纯聊天（回扣 Blog18：工具按需 opt-in）。
   * onToken 也可选：不传就是 实战04 的老样子（憋到底再拿完整 text）；
   * 传了，文本每到一个片段就喂一次——工具调用仍然是收完整参数字符串再解析一次，不逐 token 解析（这是实战06 的活）。
   */
  chat(messages: Message[], tools?: Tool[], onToken?: (delta: string) => void): Promise<ChatReply>
}
```

`onToken` 是**可选的第三参**——没有任何调用方被破坏，`Promise<ChatReply>` 的返回契约跟实战04一模一样。这是这一篇接口层唯一的改动。

### Anthropic 端：按 index 拼块，text 边到边喂

```ts
// src/providers/anthropic.ts
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; inputJson: string }

// ...请求体加一行 stream: true，其余不变...

const blocks: ContentBlock[] = []
let stopReason = 'end_turn'
for await (const payload of readSSE(res)) {
  const event = JSON.parse(payload) as {
    type: string
    index?: number
    content_block?: { type: string; id?: string; name?: string }
    delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
  }
  if (event.type === 'content_block_start' && event.index !== undefined && event.content_block) {
    blocks[event.index] =
      event.content_block.type === 'tool_use'
        ? { type: 'tool_use', id: event.content_block.id ?? '', name: event.content_block.name ?? '', inputJson: '' }
        : { type: 'text', text: '' }
  } else if (event.type === 'content_block_delta' && event.index !== undefined && event.delta) {
    const block = blocks[event.index]
    if (event.delta.type === 'text_delta' && block?.type === 'text') {
      block.text += event.delta.text ?? ''
      onToken?.(event.delta.text ?? '')
    } else if (event.delta.type === 'input_json_delta' && block?.type === 'tool_use') {
      block.inputJson += event.delta.partial_json ?? ''
    }
  } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
    stopReason = event.delta.stop_reason
  }
}

// 流结束后，text 块拼接成整段文本；tool_use 块的 inputJson 字符串这才 parse 一次
const text = blocks
  .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b?.type === 'text')
  .map(b => b.text)
  .join('')
const toolCalls: ToolCall[] = blocks
  .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b?.type === 'tool_use')
  .map(b => ({ id: b.id, name: b.name, args: safeParse(b.inputJson) }))
return { text, stopReason, toolCalls }
```

`content_block_start`/`content_block_delta`/`message_delta` 三种事件类型之外的（`message_start`、`content_block_stop`、`message_stop`）**直接被 if 链忽略**——我们不需要它们做任何事，忽略比处理更省心。

### OpenAI 兼容端：每行一个 chunk，工具参数按 index 分片累加

```ts
// src/providers/openai.ts
type PendingToolCall = { id: string; name: string; argsJson: string }

let text = ''
const pending: PendingToolCall[] = []
let stopReason = 'stop'
for await (const payload of readSSE(res)) {
  if (payload === '[DONE]') break                // 字面量哨兵，不是 JSON
  const chunk = JSON.parse(payload) as {
    choices?: Array<{
      delta?: {
        content?: string | null
        tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
      }
      finish_reason?: string | null
    }>
  }
  const choice = chunk.choices?.[0]
  if (choice?.delta?.content) {
    text += choice.delta.content
    onToken?.(choice.delta.content)
  }
  for (const tc of choice?.delta?.tool_calls ?? []) {
    const slot = (pending[tc.index] ??= { id: '', name: '', argsJson: '' })
    if (tc.id) slot.id = tc.id
    if (tc.function?.name) slot.name += tc.function.name
    if (tc.function?.arguments) slot.argsJson += tc.function.arguments
  }
  if (choice?.finish_reason) stopReason = choice.finish_reason
}
```

跟 Anthropic 那边同一个策略：文本喂 `onToken`，工具参数攒字符串，流结束后再 `safeParse` 一次性解析。

### loop 收口：把回调接到 stdout

```ts
// src/loop.ts
process.stdout.write('\n[assistant] ') // 实战05：字从这儿开始一个个蹦出来，不再等模型说完整段才见字

for (let turn = 1; turn <= maxTurns; turn++) {
  const reply = await provider.chat(messages, tools, chunk => process.stdout.write(chunk))

  // 模型这轮没请求工具 → 收工（谁决定停 = 模型不再吐 toolCall，把开关交给模型）
  if (reply.toolCalls.length === 0) {
    process.stdout.write('\n')
    return reply.text
  }

  // 模型要工具：先把它这轮的请求作为 assistant 轮记进历史（缝 id 用，下一轮结果要对回来）
  messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls })
  console.log() // 跟刚流出来的文本隔开一行，工具日志另起一段
  // ...原有的工具执行循环，一个字没动...
}
```

`index.ts` 那边对应删掉一行——`answer` 已经在 `runAgent` 里边流边打到 stdout 了，不用再 `console.log` 一遍：

```ts
console.log(`\n[provider] ${provider.name}`)
console.log(`[you]      ${question}`)

// 实战05：answer 已经在 runAgent 里边流边打到 stdout 了，这里不用再 console.log 一遍
await runAgent(provider, allTools, question)
```

### 验证：两端、两种场景，各跑一次真请求

**GLM，纯聊天（无工具）：**

```
[provider] openai-compat
[you]      用一句话介绍一下你自己。

[assistant] 我是一个AI助手，可以帮助您处理各种文本操作、文件管理、代码编写和问题解答等任务。
```

**Anthropic，纯聊天（无工具）：**

```
[provider] anthropic
[you]      用一句话介绍一下你自己。

[assistant] 我是一个基于人工智能技术构建的助手，能够理解和回应你的文字问题，帮助你完成信息查询、文本处理、编程、文件操作等各类任务。
```

这两条在真实终端里跑，字是**一个一个蹦出来**的——贴在这里的是最终文本，动态效果你在自己终端跑一遍 `PROVIDER=glm bun run src/index.ts '...'` 就看得到。

**GLM，触发工具调用：**

```
[provider] openai-compat
[you]      读一下 package.json，告诉我这个项目叫什么、有哪些 npm 脚本。

[assistant]
  [turn 1] read_file({"path":"package.json"}) -> { "name": "mini-harness", "version": "0.1.0", "descrip…
根据 `package.json`，这个项目的信息如下：

## 项目名称
**mini-harness**
...（后略，完整表格见仓库实测）
```

**Anthropic，触发工具调用：**

```
[provider] anthropic
[you]      读一下 package.json，告诉我这个项目叫什么、有哪些 npm 脚本。

[assistant]
  [turn 1] read_file({"path":"package.json"}) -> { "name": "mini-harness", "version": "0.1.0", "descrip…
这个项目名为 **mini-harness**（版本 0.1.0）...
...（后略）
```

两条工具调用路径**跟实战04一模一样**——`read_file({"path":"package.json"})` 照常收完整参数、照常过权限闸门（只读工具直接放行）、照常执行、照常把结果塞回历史给模型下一轮读。流式只换了一件事：模型在决定要不要工具之前/之后吐的**文本**，现在是边吐边打，不再憋到最后。

时序图把"文本流、工具仍顺序执行"这条主线画一遍：

![实战05 序列图：runAgent、provider（内部含 SSE 读取)、模型 API 三条泳道。beat1 用户提问进入循环，provider 发起 stream:true 的请求；beat2 SSE 事件像水滴一样陆续到达——每来一个 text_delta，provider 就同步调 onToken，loop 把它 write 到 stdout（屏幕上逐字刷新，用连续多个小箭头表示"边到边"）；beat3 若这一轮模型还请求了工具，input_json_delta 只在 provider 内部悄悄累加字符串（灰色，屏幕上看不到任何变化）；beat4 流结束（message_delta(stop_reason) / 字面量 [DONE]），provider 才把攒好的 tool_use 参数字符串一次性 parse，返回完整 ChatReply；beat5 loop 照实战04 的老路子执行工具、把结果塞回历史、进入下一轮。底部红字点题：屏幕上"看得见"的只有文本 token 这条线是实时的，工具参数这条线全程在后台攒字符串，直到流结束才现身——这就是"文本流式、工具仍是收完整包再执行"的字面意思](assets/img/实战05-sequence.svg)

当篇 checkpoint：`git tag harness-ch05-text-streaming`。

---

## 三、🔬 翻开源码：对照真源码，确认这不是教学简化

打开还原源码 `claude-code-rev`，流式解析在 `src/services/api/claude.ts`；「循环该不该继续」的判断在 `src/query.ts`。

### 攒字符串、不逐块解析——真源码的原始出处

`claude.ts:1818-1820` 这段注释，是我们「`inputJson` 只拼字符串、不逐片 `parse`」这个设计选择的**原始出处**，不是我们编的教学简化，正对应折叠点⑤推出来的那个 O(n²) 陷阱：

```ts
// Use raw stream instead of BetaMessageStream to avoid O(n²) partial JSON parsing
// BetaMessageStream calls partialParse() on every input_json_delta, which we don't need
// since we handle tool input accumulation ourselves
```

真源码对应的处理逻辑在 `claude.ts` 的 `content_block_start`/`content_block_delta` 分支——下面这段是**简化改写**，不是逐字引用：真实分支还要多判 `server_tool_use`、`thinking`、`default` 兜底，并带埋点和报错守卫，比展示的更复杂。这里只抽出跟我们同构的 `tool_use`/`text` 这两条：

```ts
// content_block_start：按 part.content_block.type 初始化——tool_use 给 input:''，text 给 text:''
if (part.content_block.type === 'tool_use') {
  contentBlocks[part.index] = { ...part.content_block, input: '' }
} else if (part.content_block.type === 'text') {
  contentBlocks[part.index] = { ...part.content_block, text: '' }
}

// content_block_delta：input_json_delta 只做字符串拼接，text_delta 才追加到 text
if (delta.type === 'input_json_delta' && (contentBlock.type === 'tool_use' || contentBlock.type === 'server_tool_use')) {
  contentBlock.input += delta.partial_json
} else if (delta.type === 'text_delta' && contentBlock.type === 'text') {
  contentBlock.text += delta.text
}
```

跟我们 `blocks[event.index]` 按 `index` 归位、`text` 块追加文本、`tool_use` 块只攒 `input` 字符串——**处理这两类块的思路一致**：都是按 `content_block.type` 分岔、`tool_use` 只攒字符串、`text` 才追加。完整的真实分支还要多处理 `server_tool_use`/`thinking` 等类型、带埋点与报错守卫，我们只抽了骨架去对照，不是它的全貌。

### `stop_reason` 依旧不可靠——流式没有改变这一点

`query.ts:554-555` 那条注释，实战02 就翻过一次，这里原样成立，没有因为改成流式而变化：

```
// Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly.
// Set during streaming whenever a tool_use block arrives — the sole ...
```

真实循环判断"这轮还要不要继续"，靠的是**流式期间累积到的 `tool_use` 块有没有出现**，不是读 `message_delta.stop_reason` 这个字符串。我们 `loop.ts` 的循环条件一直是 `reply.toolCalls.length === 0` 才收工——从实战02 定下、到实战05 加了流式，这一条**没变过**：这不是照抄真源码抄来的，是实战02 就已经推导出的同一个道理（模型不吐 `tool_use` 就该停），流式只是把判断依据换了个更早到位的数据来源，跟真源码殊途同归，不是照它写的。

### `src/ink/`：只作渲染对照，我们不复刻

设计文档给这一篇标注的另一个源码锚点是 `src/ink/`——这不是直接依赖开源 [Ink](https://github.com/vadimdemedes/ink) 库，而是真源码自己写的一套渲染层（卷首语提过的"自研渲染层，只翻不抄"说的就是这层）：自己的 reconciler、自己的终端 DOM 模型，只是 API 风格上仿照 Ink 的思路（用 React 状态更新驱动、走虚拟 DOM diff 再刷终端），方便熟悉公开生态的人对照理解。这一层**复杂度跟本篇的教学目标不对等**——我们的 `process.stdout.write(chunk)` 是能达到"看得到逐字输出"这条验收线的最小实现，`src/ink/` 只作为"生产级实现长什么样"的参照，不在这一篇复刻。

---

## 小结

- **范围收窄，故意的**：这一篇只让**文本**流式输出；工具调用的参数收集/解析/执行，跟实战02-04 完全一样——收完整字符串、流结束后 parse 一次、顺序执行。把"边流边解析工具参数 + 重建 loop 主干"这块硬骨头，留给实战06。
- **协议选型不是抄现成规范**：单向推送选 SSE 不选 WebSocket，是因为场景本来就是"一问、一路收到底"；按行读+留尾巴缓冲，是为了应付网络包把一行切两半的陷阱；`index` 归位、Anthropic 的 announce-once 和 GLM 的双字段自包含，是两种不同的信息冗余取舍，不是谁抄谁。
- **文本边到边喂 `onToken`，工具参数只攒字符串**：两端 `chat()` 内部的处理策略完全一致，这不是巧合——攒字符串、流结束后一次性 `parse`，直接对应真源码 `claude.ts:1818` 的 O(n²) 规避思路，官方 SDK 自己的默认行为反而踩了这个坑。
- **接口设计**：`onToken` 是可选的第三参，不破坏 `Promise<ChatReply>` 的老契约——跟 `xhr.onprogress` + `onload` 共存是同一个思路。
- 🔬 源码对照：`claude.ts:1818-1820`（绕开 `BetaMessageStream.partialParse()` 逐片解析的 O(n²) 陷阱）；`content_block_start`/`content_block_delta` 的 `type` 分岔初始化——跟我们 `blocks[event.index]` 同形；`query.ts:554`（`stop_reason` 不可靠，流式没有改变这一点，循环仍靠 `toolCalls` 判断）；`src/ink/`（TUI 渲染层，仅作参照不复刻）。

下一篇——**实战06《流式工具执行/解析：把 loop 真正重构成流式》**：这一篇留的账要还了——把 `input_json_delta` 边流边解析（不再攒完再 parse），并且把实战02 定下的**非流式 loop 主干重建成真正的流式 loop**（卷首语预告过的「重塑主干、不是加零件」那一刀，这一次真的要动了）。
