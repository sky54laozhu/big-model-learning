# 实战08：错误处理与重试——请求失败了，不该当场认输

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战08）

实战07 给 harness 装了一份系统提示词，模型每轮都带着"这轮该怎么表现"的说明书上场了。但从实战01 到实战07，我们一直假设了一件事：`fetch` 会成功。真实世界不是这样——网络会抖、服务器会短暂过载、429 限流会不期而至。目前的 harness 遇到这些情况的反应是：`if (!res.ok) throw new Error(...)`，直接把整场对话炸掉，用户什么都得不到。

这篇把这笔账补上：区分"值得再试一次"和"再试也没用"的失败，给值得重试的失败一套退避节奏，给重试用尽的失败一次响亮的失败。

## 一、设计摊开：失败之后该做什么

### 折叠点①：不是所有失败都一样——分"临时不巧"和"本身有问题"两类

请求失败分两种。第一种是**临时性的**：网络层错误（DNS 解析失败、连接被拒、超时——这些甚至没走到 HTTP 层，`fetch` 自己就抛了）、HTTP 429（限流，服务器说"你现在问太快了"）、HTTP 5xx（服务器自己出问题）。这些失败的共同点是：换个时机再试一次，很可能就好了——问题不在这次请求本身，在"这一刻不巧"。

第二种是**永久性的**：HTTP 400（请求本身格式有问题）、HTTP 401（鉴权失败，key 不对）、内容安全策略拒绝（模型主动拒答，不是网络层出的错）。这些失败的共同点是：不管重试多少次，请求内容不变，结果也不会变——重试只是原样再犯一次同样的错，纯粹浪费用户的等待时间。

分类的判断依据不是"失败了没有"，是"再试一次，情况有没有可能不同"。

### 折叠点②：退避该是指数增长，不是固定间隔

值得重试的失败，多久之后再试？如果每次都固定等 1 秒，对一个正在过载、需要喘气时间的服务器来说毫无意义——它连 1 秒之后大概率还是过载的。指数退避（1s → 2s → 4s）给的是一条"越来越有耐心"的曲线：第一次失败大概率是抖动，快速重试；如果连续失败，说明问题不是一瞬间的抖动，那就该给服务器越来越长的喘气时间。

### 折叠点③：重试不能没有上限

无限重试等于把"到底要不要放弃"这个决定权交给了对方——如果对方一直不好，harness 就一直傻等，用户的终端就一直卡在那里。必须有一个上限：试够次数还不行，就该老实承认"这次真的不行"，把决定权还给用户，而不是自己在那儿死等。这一篇定的数字是 3 次重试（也就是最多 4 次尝试）。

### 折叠点④：无状态协议——重试等于整包重发，不是接着上次没说完的地方续

Anthropic Messages API 和 OpenAI Chat Completions API 都是无状态的：一次 HTTP 请求对应一次完整的对话状态，服务器不会记住"上次这个连接吐到第几个字就断了"。这意味着重试没有"续传"这个选项——上一次尝试攒到一半的文本、还没解析完的工具调用参数，这次重试统统作废，得把完整的请求重新发一遍，从零开始收新的响应。

这条设计约束不是我们选的，是协议本身决定的——如果协议是有状态的（比如某些支持 resume token 的流式协议），重试可以设计成"接着断的地方续"，但 Anthropic/OpenAI 这两套协议都不是。

### 折叠点⑤：重试提示要走独立频道，不能混进 assistant 的文本里

用户正在看 `[assistant] ` 后面一个字一个字蹦出来的文本，这时候如果请求失败要重试，"⚠ 请求失败，重试中"这句话如果直接拼进这条文本流里，用户会以为是模型自己说的话——这是一句系统消息，不是模型的发言，必须让用户分得清"这是谁在说话"。做法是单开一种事件类型（`retry`），消费端收到它单独打一行，跟 `text_delta` 拼出来的助手文本视觉上分开。

### 折叠点⑥：重试用尽——响亮失败，不能悄悄吞掉

这条是实战03 就定下的原则的复用：`bypassPermissions` 模式下工具执行失败要把错误原样报给用户，不能因为"这只是个内部问题"就悄悄跳过去。重试也是同理——3 次都不行，就该把这件事甩出去让上层知道（`throw`），不能捕获异常之后随便返回一个空字符串糊弄过去。用户宁可看到一条清楚的"失败了，试了 3 次都不行"，也不该在不知情的情况下拿到一个看起来正常但其实是空的结果。

![骨架定位图：调用方（index.ts→runAgent）不变，改动全部发生在 provider 内部和一个新增的共享模块。src/retry.ts 是本章唯一的新文件：HttpError（带状态码的错误）、isRetryable（按状态码分类）、backoffDelay（指数退避计算）、RetryExhaustedError（响亮失败）、withRetry（把这套节奏套在任意一个 runOnce 生成器外面）。anthropic.ts 和 openai.ts 内部把各自原有的 fetch+SSE 解析逻辑整个装进一个嵌套的 runOnce 异步生成器里，外层 streamChat 变成一行 yield* withRetry(runOnce)——协议差异继续烂在各自 provider 内部，退避/分类/上限这套逻辑两端共用一份，不重复写。types.ts 新增一种 StreamEvent：retry，独立频道的系统通知。loop.ts 收到 retry 事件单独打一行，并清空这一轮攒到一半的 text/toolCalls。底部灰色框：SSE 解析、工具调用累积、权限闸门、系统提示词装配，全部沿用实战02-07，一个字没改。](assets/img/实战08-skeleton.svg)

---

## 二、代码落地

改动清单：新增 `src/retry.ts`（本章核心，两端 provider 共用）；`types.ts` 新增 `retry` 事件；`anthropic.ts`、`openai.ts` 把各自 `streamChat` 的主体重构进嵌套的 `runOnce` 生成器，外面套一层 `withRetry`；`loop.ts` 新增对 `retry` 事件的处理分支。

### `src/retry.ts`：本章唯一的新模块

先是两个错误类型——`HttpError` 带状态码，方便下游按状态码分类；`RetryExhaustedError` 带上试了几次、最后一次错在哪，不把原因吞掉：

```typescript
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`重试 ${attempts} 次后仍失败：${reason}`)
    this.name = 'RetryExhaustedError'
  }
}
```

分类和退避各是一个纯函数，跟折叠点①②直接对应——`isRetryable` 里 `status === undefined` 走的是折叠点①说的"网络层错误，没有状态码，大概率是抖动，值得再试"；`backoffDelay` 就是 1s→2s→4s 那条指数曲线的字面实现：

```typescript
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

export function isRetryable(status: number | undefined): boolean {
  if (status === undefined) return true
  if (status === 429) return true
  return status >= 500
}

export function backoffDelay(attempt: number): number {
  return BASE_DELAY_MS * 2 ** (attempt - 1)
}
```

核心的 `withRetry`：接一个 `runOnce`（本身就是一个 `AsyncGenerator<StreamEvent>` 工厂），每次重试就整个再调用一遍它：

```typescript
export async function* withRetry(runOnce: () => AsyncGenerator<StreamEvent>): AsyncGenerator<StreamEvent> {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      yield* runOnce()
      return
    } catch (err) {
      const status = extractHttpStatus(err)
      if (!isRetryable(status)) throw err // 400/401 这类：重试只是原样再犯一次错，直接原样抛出，不算"耗尽"
      if (attempt > MAX_RETRIES) throw new RetryExhaustedError(attempt - 1, err)
      const delayMs = backoffDelay(attempt)
      // 独立频道的系统通知，不混进 assistant 的文本流——上一次已经吐到屏幕上的碎片留在原地，
      // 但逻辑上这次要干净重开，消费端（loop.ts）看到这个事件就该清空这一轮攒到一半的 text/toolCalls
      yield {
        type: 'retry',
        attempt,
        maxRetries: MAX_RETRIES,
        delayMs,
        reason: err instanceof Error ? err.message : String(err),
      }
      await sleep(delayMs)
    }
  }
}
```

`yield* runOnce()` 是折叠点④的字面落地——每次循环都是一次全新的生成器调用，`runOnce` 内部所有累积状态（累积的文本、正在拼的工具调用参数）都是它自己的局部变量，上一次失败时攒到哪，这次重新从零开始，没有任何跨尝试的状态被带过来。

这里有一处容易写错的分支，最初我把"不该重试"和"重试次数耗尽"合并成一个条件判断，结果 401 这种第一次就失败的错误会被包进 `RetryExhaustedError`、报出"重试 0 次后仍失败"这种自相矛盾的话——明明一次重试都没试过。修正后拆成两条独立的判断：不该重试的错误原样 `throw err`（连包装都不做，因为它压根没资格被叫作"重试耗尽"）；只有真正试够次数还失败的，才配得上 `RetryExhaustedError` 这个响亮的说法。

### `src/types.ts`：新增 `retry` 事件类型

```typescript
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
  | {
      /**
       * 实战08 新增：独立频道的系统通知，不是 assistant 说的话——请求失败、判断值得重试时吐出来。
       * 消费端（loop.ts）看到这个事件，该做两件事：把它打印成单独一行（别跟 text_delta 拼在一起），
       * 并清空这一轮已经攒到一半的 text/toolCalls——无状态协议的重试是整包重发，上一次的碎片作废。
       */
      type: 'retry'
      attempt: number
      maxRetries: number
      delayMs: number
      reason: string
    }
```

这是折叠点⑤落成的类型——`retry` 和 `text_delta` 是平级的两种事件，不是把提示文字拼进某个 `text_delta.delta` 里传出去。

### `src/providers/anthropic.ts` 与 `openai.ts`：把原有逻辑装进 `runOnce`，外面套 `withRetry`

两个 provider 改法完全一致，用 Anthropic 那份举例。原来 `streamChat()` 整个方法体（组装请求、`fetch`、解析 SSE）现在整段搬进一个嵌套的 `runOnce` 异步生成器里：

```typescript
async *streamChat(messages: Message[], tools?: Tool[], system?: string): AsyncGenerator<StreamEvent> {
  const self = this
  // 实战08：一次尝试的完整逻辑收进 runOnce——withRetry 每重试一次就整个重新调用它一遍，
  // 这就是"无状态协议，重试=整包重发"的字面意思：blocks/stopReason 每次调用都是全新的局部变量。
  const runOnce = async function* (): AsyncGenerator<StreamEvent> {
    // ……组装 headers/body（跟实战07 一模一样，没有改动）……
    const res = await fetch(`${self.base}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body) })
    // 实战08：不再当场 throw 完事——换成带状态码的 HttpError，交给 withRetry 按状态码分类
    if (!res.ok) throw new HttpError(res.status, `anthropic ${res.status}: ${await res.text()}`)

    // ……SSE 解析逻辑（跟实战06 一模一样，没有改动）……
    yield { type: 'done', stopReason }
  }

  yield* withRetry(runOnce)
}
```

两处真正的改动只有：`if (!res.ok) throw new Error(...)` 换成 `throw new HttpError(res.status, ...)`（多带一个状态码，供 `withRetry` 分类用）；方法末尾从"运行完 `runOnce` 自己的逻辑"变成 `yield* withRetry(runOnce)`（把整套重试节奏套在外面）。SSE 解析、工具调用累积这些内部逻辑一个字没改。

有个 JS 语法细节值得提一句：`runOnce` 必须是一个具名的 `async function*`，不能写成箭头函数——JS 目前没有箭头函数版的异步生成器语法。而 `runOnce` 内部又要用到 `this.base`、`this.model` 这些实例字段，箭头函数能自动捕获外层 `this`，普通函数不能——所以开头先 `const self = this` 存一份引用，`runOnce` 内部全部改用 `self.` 访问，绕开这个语法限制。`openai.ts` 是同一个模式,原样复用。

### `src/loop.ts`：收到 `retry` 事件，单独打一行，清空这一轮的碎片

```typescript
for await (const event of provider.streamChat(messages, tools, system)) {
  if (event.type === 'text_delta') {
    text += event.delta
    process.stdout.write(event.delta)
  } else if (event.type === 'tool_call') {
    toolCalls.push(event.call)
  } else if (event.type === 'retry') {
    // 独立频道通知：单独一行，不跟 assistant 的文本拼在一起；这一轮攒到一半的碎片作废重来
    const seconds = (event.delayMs / 1000).toFixed(1)
    process.stdout.write(`\n⚠ 请求失败，${seconds}s 后重试（第 ${event.attempt}/${event.maxRetries} 次）：${event.reason}\n[assistant] `)
    text = ''
    toolCalls.length = 0
  }
  // done 事件本身不用管——收没收到过 tool_call 才是"这轮要不要继续"的判断依据
}
```

`text = ''` 和 `toolCalls.length = 0` 是折叠点④在消费端的另一半——`runOnce` 内部的累积状态归零只解决了"provider 这边不会带着上次的碎片"，但 `loop.ts` 这边自己也攒了一份 `text`/`toolCalls`（用来判断这轮该不该继续、要不要执行工具），这份账也得跟着清零，两边步调一致，否则用户会在屏幕上看到"重试前吐出来的半句话"和"重试后吐出来的完整答案"接在一起，读起来像是同一句话断句错误。

![主控制流程图：streamChat 外层现在只是 yield* withRetry(runOnce) 一行。withRetry 内部是一个 for 循环，最多跑 MAX_RETRIES+1=4 轮：每轮先 yield* runOnce()，如果 runOnce 顺利跑完自己的 done 事件就直接 return 收工；如果 runOnce 抛错，先看 isRetryable(status)——不可重试（400/401 这类）就原样 throw err 出去，不包装；可重试但 attempt 已经超过 MAX_RETRIES，就 throw RetryExhaustedError，带上真正试过的次数和最后一次的原因；否则算出 backoffDelay(attempt)（1s/2s/4s），yield 一个 retry 事件通知调用方，然后真正 sleep 那么久，再进入下一轮循环重新调用 runOnce()。底部结论：runOnce 每次被调用都是全新的一次请求，内部所有累积状态（blocks/pending/currentIndex）都是它自己新建的局部变量，没有任何跨尝试的状态被带过来——这就是"无状态协议→重试=整包重发"的运行时体现。](assets/img/实战08-assembly-flow.svg)

### 验证：`retry-test.ts`，四种场景 + 一次真实的 provider 整合验证

写了一个 `retry-test.ts`，跟 `gate-test.ts` 一样的风格——直接调用，不碰真实网络，自己控制假请求第几次失败、失败成什么样。前四组直接喂假的 `runOnce` 给 `withRetry`：

```
===== 502 失败 2 次，第 3 次成功——该重试且重试后活了 =====
  retry: 第 1/3 次，1000ms 后重试——boom 502
  retry: 第 2/3 次，2000ms 后重试——boom 502
  text_delta: 第 3 次成功
  done: end_turn

===== 401 第 1 次就失败——不该重试，直接原样抛出 =====
  抛出 HttpError: boom 401

===== 429 连续失败 4 次——超过上限 3 次，响亮抛出 RetryExhaustedError =====
  retry: 第 1/3 次，1000ms 后重试——boom 429
  retry: 第 2/3 次，2000ms 后重试——boom 429
  retry: 第 3/3 次，4000ms 后重试——boom 429
  抛出 RetryExhaustedError: 重试 3 次后仍失败：boom 429

===== 网络层错误（没有状态码）失败 1 次，第 2 次成功——归类为可重试 =====
  retry: 第 1/3 次，1000ms 后重试——network error: connect ECONNREFUSED
  text_delta: 第 2 次成功
  done: end_turn
```

![序列图：两次 502 之后第三次成功——withRetry 对调用方完全透明。三条生命线：loop.ts（消费事件）、withRetry（重试节奏）、runOnce+fetch（模型 API）。第①拍 loop.ts 调 streamChat()，实际是 yield* withRetry(runOnce)，withRetry 发起 attempt 1 调 runOnce，runOnce fetch 到 502 抛出 HttpError。第②拍 withRetry 判断可重试且没超次数，算出 delayMs=1000ms，yield 一个 retry 事件给 loop.ts，loop.ts 打印警告行并清空 text/toolCalls。第③拍 withRetry 真的 sleep 1000ms。第④拍 attempt 2 同样的过程再来一遍（fetch 502→throw→retry(2/3,2000ms)→清空→sleep 2000ms）。第⑤拍 attempt 3，runOnce fetch 到 200 和一份 SSE 流，yield text_delta，withRetry 原样透传给 loop.ts。第⑥拍 runOnce yield done 后正常结束，withRetry 里的 yield* runOnce() 返回触发 return，不再进入下一轮。第⑦拍 loop.ts 发现 toolCalls 为空，return text 收工。结论：withRetry 对调用方完全透明——失败时多吐几个 retry 事件，成功时原样转发 runOnce 的事件，loop.ts 消费的接口跟没有重试机制时一模一样，都只是在消费一个 AsyncGenerator\<StreamEvent\>。](assets/img/实战08-sequence.svg)

四组结果精确对应折叠点①②③：退避是 1s→2s→4s 的指数曲线；401 没有任何 `retry` 事件，直接原样抛出；429 试满 3 次后响亮报错，报错文案带着"重试 3 次"和最后一次的原因，不是一句模糊的"失败了"。

只测孤立的 `withRetry` 还不够——它证明了退避/分类/上限这套逻辑本身是对的,但没证明两个 provider 真的把 `runOnce` 和 `withRetry`接对了。所以又加了一段整合验证：monkeypatch 掉 `globalThis.fetch`,前两次回 502，第三次回一份真实形状的 Anthropic SSE 流，然后真的 `new AnthropicProvider(...)` 跑一遍 `streamChat()`：

```
===== 整合验证：AnthropicProvider 真的经过 withRetry 重试，不是绕开它 =====
  retry: 第 1/3 次，1000ms 后重试——anthropic 502: upstream overloaded
  retry: 第 2/3 次，2000ms 后重试——anthropic 502: upstream overloaded
  text_delta: 重试后活了
  done: end_turn
  一共调用了 fetch 3 次
```

`fetch` 真的被调用了 3 次（两次 502 + 一次成功），`retry` 事件里的 `reason` 字段也真的是 `anthropic.ts` 里 `HttpError` 拼出来的那句 `anthropic 502: upstream overloaded`——证明 `runOnce`/`withRetry` 这套重构没有停留在"类型对得上"，是真的在 `AnthropicProvider` 内部按预期跑通的。

当篇 checkpoint：`git tag harness-ch08-error-handling-retry`。

---

## 三、🔬 翻开源码

去 `claude-code-rev` 里核对了真实 Claude Code 的重试逻辑（`src/services/api/withRetry.ts`、`src/services/api/errors.ts`），几个核心思路一致，但真源码要处理的复杂度远超本章。

### 1. 退避公式思路一致，但真源码多了随机抖动和上限

`withRetry.ts` 的 `getRetryDelay`（下面按真实源码整理复述，为了突出核心逻辑重排了换行和部分注释，不是逐行粘贴）：

```typescript
export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs = 32000,
): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) return seconds * 1000
  }
  const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), maxDelayMs)
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}
```

`BASE_DELAY_MS * Math.pow(2, attempt - 1)` 跟我们 `backoffDelay()` 里的 `BASE_DELAY_MS * 2 ** (attempt - 1)` 是同一条公式，只是真源码的 `BASE_DELAY_MS = 500`（我们用 1000，数字上更直观，方便读者口算）。真源码多两件事我们没做：一是 `Math.min(..., maxDelayMs)`，指数增长封顶在 32 秒，不会无限翻倍下去；二是 `jitter = Math.random() * 0.25 * baseDelay`，往延迟上加一点随机抖动——如果同一时刻有一大批请求同时失败、同时重试，没有抖动的话它们会在完全相同的时刻再次同时命中服务器（"惊群效应"），加一点随机量能把这些重试请求错开。我们的简化版没有加抖动，因为教学场景下确定性的延迟数字（1s/2s/4s）比"1.13s/2.07s/4.19s"更容易讲清楚退避曲线本身，但生产代码这个抖动是必要的。

（`withRetry.ts:530-548`）

### 2. 分类逻辑思路一致，但真源码是一整套按状态码/来源分层判断的规则

真源码的 `shouldRetry()`（同样是整理复述，压缩了部分分支注释）：

```typescript
function shouldRetry(error: APIError): boolean {
  if (isMockRateLimitError(error)) return false
  // ...（persistent mode / CCR mode 的特殊分支）
  if (error.message?.includes('"type":"overloaded_error"')) return true
  if (parseMaxTokensContextOverflowError(error)) return true

  const shouldRetryHeader = error.headers?.get('x-should-retry')
  if (shouldRetryHeader === 'true' && (!isClaudeAISubscriber() || isEnterpriseSubscriber())) return true
  if (shouldRetryHeader === 'false') {
    const is5xxError = error.status !== undefined && error.status >= 500
    if (!(process.env.USER_TYPE === 'ant' && is5xxError)) return false
  }

  if (error instanceof APIConnectionError) return true
  if (!error.status) return false
  if (error.status === 408) return true // 请求超时
  if (error.status === 409) return true // 锁冲突
  if (error.status === 429) return !isClaudeAISubscriber() || isEnterpriseSubscriber()
  if (error.status === 401) {
    clearApiKeyHelperCache() // 清缓存后仍然重试——跟我们把 401 当永久失败不一样
    return true
  }
  if (isOAuthTokenRevokedError(error)) return true
  if (error.status && error.status >= 500) return true
  return false
}
```

（`withRetry.ts:696-787`）

我们这一篇把 401 归类成"永久失败，不重试"，这跟真源码正好相反——真源码的 401 分支是**清一次鉴权缓存之后仍然重试**（`clearApiKeyHelperCache()` 之后 `return true`），因为它假设 401 可能是"缓存的 key 碰巧过期了，刷新一下就好"，而不是"key 本身写错了"。我们的简化把 401 一刀切当成"请求本身有问题"处理，是故意牺牲了这层"先自愈、再判断"的精细度，换取更容易讲清楚"400/401=永久失败"这条分类边界——这是一个明确的简化点，值得读者知道真实场景里 401 的处理比我们这篇更微妙。另外真源码还有 `x-should-retry` 这个响应头——服务器可以直接在响应里告诉客户端"这次要不要重试"，客户端优先听服务器的判断，这条机制我们完全没有实现。

### 3. 重试上限和"响亮失败"的思路一致，但数字和触发路径复杂得多

同样是整理复述（原始类名是 `RetryError`，构造函数体做了折行整理）：

```typescript
const DEFAULT_MAX_RETRIES = 10
const MAX_529_RETRIES = 3

export class CannotRetryError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly retryContext: RetryContext,
  ) {
    super(errorMessage(originalError))
    this.name = 'RetryError'
    if (originalError instanceof Error && originalError.stack) this.stack = originalError.stack
  }
}
```

真源码默认重试 10 次（`DEFAULT_MAX_RETRIES`），比我们的 3 次宽松得多；`CannotRetryError` 就是我们 `RetryExhaustedError` 的原型——同样带上原始错误（`originalError`），同样是"用尽后就该响亮地抛出去"（对应折叠点⑥）。但真源码的重试次数不是一个孤零零的数字：529（overloaded）错误单独用 `MAX_529_RETRIES = 3` 计数，连续 529 达到这个数、且调用方配置了 `options.fallbackModel` 时会触发**换模型**（`FallbackTriggeredError`，比如从 Opus 掉到一个 fallback 模型）；没配 fallback 模型的话，仍然是老实抛 `CannotRetryError`，不会凭空冒出一个模型来接手。此外还有一整套"persistent retry"模式（`CLAUDE_CODE_UNATTENDED_RETRY`），专门给无人值守的会话用，429/529 会几乎无限重试、按分钟级退避、定期发心跳防止宿主环境判定会话空闲。这些都是我们这一篇故意没有涉及的复杂度——本章只想讲清楚"重试要有上限、上限到了要响亮失败"这条最核心的骨架。

（`withRetry.ts:52-54`、`withRetry.ts:144-158`）

### 4. 内容安全策略拒绝根本不是 HTTP 错误，是一次正常的 200 响应

这是设计阶段折叠点①里举的例子中，唯一一个真源码处理方式跟我们想的完全不一样的地方。`errors.ts` 里有个 `getErrorMessageIfRefusal`：

```typescript
export function getErrorMessageIfRefusal(
  stopReason: BetaStopReason | null,
  model: string,
): AssistantMessage | undefined {
  if (stopReason !== 'refusal') return
  // ……
}
```

模型拒绝回答，走的是响应体里的 `stop_reason: 'refusal'`——这是一次完全成功的 HTTP 200 响应，只是模型自己选择不作答，根本没有触发 `withRetry` 那一整套 catch 逻辑。我们这一篇的设计阶段把"内容安全策略拒绝"当成跟 400/401 并列的一种"永久失败"例子来讲折叠点①的分类道理，这个类比在道理上是对的（拒绝了就是拒绝了，重试内容不变结果也不会变），但技术实现上它压根不经过我们 `retry.ts` 里 `isRetryable(status)` 这条判断路径——它连 `HttpError` 都不会被抛出来。这是设计比喻和真实实现之间的一处落差，这里明确标注出来，不让读者以为我们的 `isRetryable()` 函数也覆盖了这种情况。

（`errors.ts:1184-1200` 附近）

## 小结

- 失败分两类：临时性的（网络层错误、429、5xx）值得重试，永久性的（400、401、内容安全拒绝）重试只是浪费时间（折叠点①）。
- 退避该是指数增长（1s→2s→4s），给过载的服务器越来越长的喘气时间，不是固定节奏接着捶（折叠点②）。
- 重试必须有上限（这一篇定的是 3 次），试够了就该把"要不要继续等"的决定权还给用户（折叠点③）。
- 无状态协议决定了重试只能是整包重发——`runOnce` 每次被调用都是全新的局部状态，没有"接着上次没说完的地方续"这个选项（折叠点④）。
- 重试提示要走独立频道（`retry` 事件），不能混进 assistant 的文本流里，让用户分不清是谁在说话（折叠点⑤）。
- 重试用尽要响亮失败（`RetryExhaustedError`），不能悄悄吞掉异常返回一个看似正常的空结果（折叠点⑥，回扣实战03）。
- `withRetry(runOnce)` 这个包装函数让两个 provider 共用同一份分类/退避/上限逻辑，协议差异（怎么组装请求、怎么解析 SSE）继续各自烂在 provider 内部——这是"可插拔 provider"设计（实战01 定的）继续扛住的又一个例子。
- 真实跑通的整合验证证明这套重构不只是类型对得上：monkeypatch `fetch` 模拟两次 502 后成功，`AnthropicProvider.streamChat()` 真的吐出了两个 `retry` 事件、真的等了 1s+2s、真的在第 3 次拿到数据后正常完成。

🔬 源码对照：
- `withRetry.ts:530-548` — `getRetryDelay`，指数退避公式思路一致，真源码多了 32s 上限和随机抖动
- `withRetry.ts:696-787` — `shouldRetry`，按状态码分类的思路一致，但 401 的处理方向跟我们相反（先自愈再重试，不是直接判永久失败）
- `withRetry.ts:52-54`、`withRetry.ts:144-158` — `DEFAULT_MAX_RETRIES=10`、`CannotRetryError`，重试上限和"响亮失败"思路的原型，但真源码还有 529 专属计数和换模型兜底
- `errors.ts:1184-1200` 附近 — `getErrorMessageIfRefusal`，内容安全拒绝走的是 `stop_reason:'refusal'` 的正常响应，根本不经过重试判断路径

Harness 现在会自己分辨"值得再等等"和"再等也没用"，失败不会再悄无声息。但重试解决的是"这一轮请求"内部的问题——如果问题出在更高层，比如同一个工具被反复无意义地调用、模型在原地打转，重试这套机制完全帮不上忙。下一篇看这个。
