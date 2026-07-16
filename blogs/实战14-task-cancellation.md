# 实战14：取消一个后台任务——一个 AbortSignal，怎么让两处真的被打断

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战14）

实战13 收尾时留了一句话："后台任务现在能提交、能被自动通知完工，但还缺一件事：如果父agent提交之后改主意了——任务其实没必要跑了，或者跑错了方向——有没有办法把一个还在后台跑着的子agent叫停？"这一篇要拆的就是这个"取消"。

答案不需要什么新架构。已经有的两条会卡住不动的路径——一次网络请求、一次子进程执行——只要往里插一根共同的开关线，配上一张新的登记表和一个新工具，"取消"就成立了。这一篇会发现，最难的部分甚至不是"怎么发出取消信号"，而是"发出去之后，两个完全不同的阻塞点，反应居然不一样"。

## 一、设计摊开：从"发个信号"到"两处真的被打断"

### 折叠点①：取消一个还在跑的任务，跟撤销一次已经做过的操作，是同一件事吗

想象两个场景：一笔转账已经到账，你想"撤销"它——银行得再走一次退款流程，把已经发生的资金变动倒转回去；另一个场景，你在终端里跑着一个 `for i in {1..100}; do ...; done` 的循环，敲一个 Ctrl+C，它立刻停了——但已经打印出来的那几十行不会消失，Ctrl+C 从来没打算把它们擦掉。

后台子agent跑到一半，可能已经读过几个文件、执行过几条 shell 命令、往磁盘写过东西——这些副作用已经真实发生了。取消它，是要把这些已经做过的事情"倒转回去"，还是只是让"还没发生的那部分"不再发生？答案更接近 Ctrl+C，不是转账撤销：已经读过的文件不需要"取消读"，已经打印的日志不需要撤回，取消要打断的，是接下来还打算做、但还没真正做完的那一步——一次还没收到响应的网络请求，一次还没跑完的子进程。这决定了整篇要往哪个方向使力：不是给已经发生的动作记账、可回滚，是给"正在进行中"的东西装一个能被叫停的开关。

### 折叠点②：这个"叫停"的动作，是给已有工具加个参数，还是需要一个全新的工具

`task` 工具已经有一个 `background` 参数，决定这次调用要不要等。乍一看，"取消"似乎也可以塞进同一个地方——比如再给 `task` 加个 `cancel: true` 的用法？

问题是，`task(background:true)` 这次调用早就已经收工了：`execute` 在提交那一刻就返回过一句"已提交"，工具调用是一次性的，没有"回头改一次参数、再调一遍同一次调用"这种动作——调用已经结束，不存在"重新配置它"的机会。取消一个还在跑的任务，需要的是一次**全新的、独立的**调用，在完全不同的时间点、由模型主动决定去按下。于是答案是一个新工具：`cancel_task`。跟实战13 里"完工提醒"是 harness 被动插进对话的消息不同，这次按钮是模型自己主动去按的。

### 折叠点③：模型按下"取消"，harness 手里握着的、代表"正在跑的这个东西"的把手是什么

`runAgent(...)` 这次调用，此刻正在某处的事件循环里跑着——读着文件、等着网络响应。`cancel_task` 的 `execute` 被调用时，是完全另一次独立的函数调用，跟前者不共享任何调用栈。一个函数调用，怎么才能打断另一个已经在别处独立跑着的函数调用？

这正是遥控器和接收器的关系：按钮按下去（`abort()`），得有个东西在另一头持续监听着有没有被按下（`signal`）。JS 标准里现成就有这套 API——`AbortController`/`AbortSignal`，`fetch` 早就支持它。`new AbortController()` 造出一个控制器，它自带一个 `.signal` 属性；把这个 `signal` 传给任何愿意接它的异步操作，之后调用控制器的 `.abort()`，那些操作就有机会做出反应。这就是 harness 需要握在手里的那个"把手"。

### 折叠点④：这个 controller 该存在哪儿，`cancel_task` 才找得到它

实战13 里有一张登记表 `completedBackgroundTasks`，专门记"跑完了"的后台任务结果。现在要解决一个不一样的问题：`cancel_task` 拿到一个 `taskId`，得找到那个还在跑的任务对应的 controller，才能调它的 `.abort()`。

这跟员工排班表是同一类问题——一张"在岗名单"记谁现在还在，一张"离岗记录"记谁已经走了，两张表记录的是完全相反的时间段，不能共用一张。`completedBackgroundTasks` 只在任务**跑完之后**才有它的一行；现在需要的这张新表，正好反过来——只要任务**还在跑**，就该有一行，一旦跑完（不管成功、失败还是被取消），这一行就该消失。于是加一张平行的第二张模块级登记表：`controllerRegistry: Map<string, AbortController>`。

### 折叠点⑤：`controller.abort()` 调用之后，任务是不是就已经停了

先别急着往下设计——这里有个容易被忽略的陷阱。`controller.abort()` 做的事情，说穿了只是把 `controller.signal.aborted` 设成 `true`，并在 `signal` 上触发一个 `'abort'` 事件。它不会主动去"够到"任何正在运行的代码，把它强行打断——就像遥控器的按钮按下去了，但电视压根没插这根天线，按了也没反应。

`runAgent(...)` 内部此刻正在做的事——等 `fetch` 的响应、等子进程跑完——如果这些代码从头到尾都没有检查过任何 `signal`，那 `controller.abort()` 调用完全是对空气打了一拳，任务会稳稳当当地继续跑到底。所以"能不能被取消"这件事，主动权根本不在 `cancel_task` 这一侧，而在 `runAgent` 内部是不是**愿意接住**这根信号线。

### 折叠点⑥：`signal` 要怎么从 `cancel_task` 一路传到 `runAgent` 内部真正卡住的地方

顺着上一个折叠点往下走：`runAgent` 得先有能力接住一个 `signal`，才谈得上后面怎么响应它。眼下 `runAgent` 的签名里压根没有这个参数——`provider, tools, userInput, maxTurns, gate, system, cwd, sessionId, resumeMessages`，一个都对不上。

最直接的做法就是往参数列表末尾加一个新的可选参数：`signal?: AbortSignal`。可选是因为不是每一次 `runAgent` 调用都需要被取消的能力——CLI 直接发起的那次前台调用，从头到尾没有人会去调用 `cancel_task`，不传 `signal` 照样跑得跟以前一模一样；只有 `task.ts` 后台分支里创建的那个 `controller`，它的 `.signal` 才会被真正传进去。

### 折叠点⑦：`runAgent` 内部真正"卡着不动"的地方有几处，是不是每一处都要接

一次 `runAgent` 调用会阻塞在不止一个地方——每一轮先要等 `streamChat` 的网络响应，模型如果请求了 `bash` 工具，还要等子进程跑完。取消信号如果只接进其中一处，会发生什么？假设只有 `streamChat` 接了 `signal`：模型正卡在一次 `bash({"command":"sleep 30"})` 里等待子进程时被取消，`streamChat` 那边什么都不会发生，子进程照样安安稳稳地睡完 30 秒——从外面看,这次"取消"完全没起作用，因为它根本没打断真正卡住的那个地方。

所以两处阻塞点都要接：`streamChat`（`anthropic.ts`/`openai.ts` 里的 `fetch` 调用）,还有 `bash.ts` 里的 `Bun.spawn`。`Tool.execute` 原来的签名是 `(args) => Promise<string>`，也得跟着改成 `(args, signal?) => Promise<string>`——一个裸的第二个参数，不是包进一个上下文对象。这里刻意没有像很多真实框架那样造一个 `ToolUseContext` 之类的对象把 `signal` 和别的东西打包在一起传——因为眼下没有第二样东西需要跟着 `signal` 一起传给工具，多包一层纯粹是为将来可能出现、但现在根本不存在的需求预留空间。

接进去之后还有一个意外的发现：`fetch` 被 abort 会自己抛出 `AbortError`，处理起来很直接；但 `Bun.spawn({ signal })` 被 abort 之后，`proc.exited` 这个 promise 照样正常 `resolve`，不会抛错——得手动检查一遍 `signal.aborted`，再决定这次子进程退出算不算"正常跑完"。两个看起来同样是"接一个 signal"的地方，反应方式完全不是同一套约定，这是这一篇写代码时才真正撞见的细节。

### 折叠点⑧：同一次 `runAgent` 调用里，`streamChat` 跟这一轮所有的工具调用，是各自配一个 controller，还是共用一个

一次后台任务对应一次 `runAgent` 调用，这次调用内部可能会跑好几轮，每一轮都有一次 `streamChat`、可能还有好几个并发的工具调用（`Promise.all`）。取消这个任务的时候，是要把这些阻塞点一个个单独叫停，还是有一个更简单的整体开关？

回到遥控器的类比：一台电视的遥控器管的是"整台电视"这一个整体，不会拆成"音量遥控器"和"频道遥控器"两个各自独立的东西——按一次电源键,整台机器都关。同理，一次 `runAgent` 调用只创建**一个** `AbortController`，它的 `.signal` 同时传给这一轮的 `streamChat` 调用**和** `Promise.all` 里的每一个工具的 `execute`——不是每个阻塞点各自开一个 controller。这样 `cancel_task` 只需要调一次 `.abort()`，这次调用里所有还卡着的地方都会同时收到信号，不需要 harness 去追踪"这次调用具体卡在哪几个点"。

### 折叠点⑨：这一个 controller，该在代码的哪一行被创建出来

一次后台任务从"发起"那一刻起就该有能力被取消——不能等它跑到某一半才后补一个 controller，那样任务刚提交的头几秒是没法取消的。那 controller 到底该在哪一行诞生？

这跟发工牌是同一件事：新员工入职当天，工牌和对讲机是一起发的，不会先发工牌、过几天才想起来配对讲机。`task.ts` 里 `background:true` 分支生成 `taskId`（`bg-${nextBackgroundTaskId++}`）的那一行，就是这个任务被真正创建出来的时刻——`new AbortController()` 就紧挨着写在这一行旁边，两者同一时刻诞生，`controllerRegistry.set(taskId, controller)` 立刻登记，`runAgent(..., controller.signal)` 把它的 `.signal` 传下去。从任务存在的第一秒起，它就已经具备"能被取消"这个能力。

### 折叠点⑩：任务跑完之后（不管是成功、失败，还是被取消打断），`controllerRegistry` 里那一行该怎么处理

任务迟早会走到 `runAgent(...)` 这个 promise 落地的那一刻——不管是 `.then`（成功）还是 `.catch`（失败或被取消）。这时候 `controllerRegistry` 里对应这个 `taskId` 的那一行，还有没有必要留着？

留着的坏处很直接：一个已经跑完的任务，理论上还能被 `cancel_task` 找到并调用 `.abort()`——这是一个已经收工的人还挂着一个"还能被呼叫"的对讲机,没有任何实际意义，纯粹是留了一个不该存在的假象。所以任务落地的那一刻，不管走的是 `.then` 还是 `.catch`，都该顺手把 `controllerRegistry` 里这一行删掉——用 `.finally(() => controllerRegistry.delete(taskId))`，一个回调同时覆盖成功和失败两条路径。这跟 `completedBackgroundTasks` 恰好是反过来的生命周期：那张表只在"跑完了"才有一行，这张表只在"还没跑完"才有一行，一个任务的一生，在两张表里此起彼伏、从不同时出现在两张表的同一行。

### 折叠点⑪：`cancel_task` 的 `execute` 具体怎么写——找到目标、找不到目标，分别该答什么

`cancel_task` 拿到一个 `taskId`，第一步自然是去 `controllerRegistry` 里查这个 key。这里其实只有两种可能的结果，不需要设计得更复杂：查到了，说明这个任务眼下确实还在跑，调它的 `.abort()`，然后如实告诉模型——信号已经发出去了，但不保证立刻停（子agent那边响应信号需要时间，也许它下一步已经在准备收尾了）；查不到，只有一种可能的原因需要合并成一句话说清楚——这个 `taskId` "可能从没存在过，也可能已经跑完了"，两种情况在这一张表面前长得一模一样（一个从来没被 `set` 过，一个被 `.finally` 删掉了），没必要、也没办法在这一层区分出到底是哪一种。

### 折叠点⑫：`controller.abort()` 之后，`.catch` 里怎么分清"这是我自己叫停的"和"它真的失败了"

`runAgent(...)` 被 abort 之后最终会走到 `.catch` 分支——但 `.catch` 原本只有一种含义：这次子agent执行失败了，把错误信息包成 `error: 子agent后台执行失败——...` 写进登记表。现在这个分支会被两种完全不同性质的情况同时触发：真的出了故障，或者只是被 `cancel_task` 主动打断。这两者如果都套上同一句 `error:` 前缀，模型读到的时候只会以为"这个子agent自己出故障了"——它并不知道这次终止其实是自己（或用户）主动要求的。

这跟医生开死亡证明是同一类问题：死因写"猝死"糊弄不过去，得写清楚是自然病亡还是外力所致，因为后续要采取的行动完全不同。这里判断"死因"的依据现成就有——`controller.signal.aborted` 这个布尔值：`.abort()` 被调用过，这个值就是 `true`。`.catch` 里先检查这个值，`true` 就写一条区分开的 `cancelled: 子agent执行被取消`，不再跟真实故障共用 `error:` 前缀。

### 折叠点⑬：`cancel_task` 这个工具对象，要不要像 `task` 一样也做成一个工厂函数

`task` 工具是 `createTaskTool(provider, gate)` 这样一个工厂函数——因为它的 `execute` 需要闭包住 `provider` 和 `gate`，这两者只有运行时才拿得到。`cancel_task` 需不需要照这个样子来一份？

看它的 `execute` 具体要用到什么：只是读写 `controllerRegistry` 这一张模块级的表，不需要认识 `provider` 是谁、`gate` 开没开——跟 `bashTool` 一样，是一个"放在那儿就能直接用"的对象，不需要运行时才决定的任何东西。既然不需要闭包任何东西，就没理由套一层工厂函数——`cancel_task` 就是一个跟 `bashTool` 同款的模块级单例 `Tool` 对象，`export const cancelTaskTool: Tool = {...}`，写在哪儿、什么时候被 import，行为都完全一样。

### 折叠点⑭：`cancel_task` 该出现在哪份工具清单里——顶层的，还是子agent自己那份

工具清单现在有两份：`tools/index.ts` 的 `createAllTools`（主agent能用的全集），和 `task.ts` 里的 `subagentTools`（子agent能用的窄集）。`cancel_task` 该塞进哪一份，还是两份都要？

看一眼 `subagentTools` 这份清单本身：它压根不包含 `task` 工具——这是实战12 就定下的规矩，为了防止子agent自己又派生子agent、无限递归下去。子agent的手里，从一开始就没有"派任务"这个权限，那它自然也创建不出任何 `bg-N` 后台任务——一个从没创建过后台任务的角色，需不需要"取消后台任务"这个按钮？答案是这个问题在结构上根本不成立，不是"需要但要小心权限"，是"连场景都凑不出来"。所以 `cancel_task` 只加进顶层清单，`subagentTools` 一个字都不用改——不是靠额外的权限检查代码堵住"子agent A 取消子agent B 的任务"这个顾虑，是这条路径从结构上压根走不出来。

![骨架定位图：tools/task.ts 新增第二张模块级登记表 controllerRegistry（taskId → AbortController），跟 completedBackgroundTasks 平行、生命周期相反——只在"还在跑"时有这一行，.finally 里删除。createTaskTool 的 background:true 分支里，taskId 生成的同一处创建 new AbortController()，controller.signal 传进 runAgent 的新增第 10 个参数 signal。runAgent（loop.ts）把 signal 转给 provider.streamChat 的新增第 4 个参数，也转给 Promise.all 里每个 tool.execute 的新增第 2 个参数。bash.ts 的 execute 把 signal 转给 Bun.spawn 的 signal 选项，并在 proc.exited 后手动检查 signal.aborted（因为 Bun.spawn 被 abort 不会自动抛错，跟 fetch 不同）。anthropic.ts/openai.ts 的 streamChat 把 signal 转给 fetch 的 signal 选项（fetch 被 abort 自动抛 AbortError）。retry.ts 的 withRetry 新增 AbortError 短路：捕获到 AbortError 直接原样抛出，不进入重试等待。新增模块级单例 cancelTaskTool（非工厂函数），execute 查 controllerRegistry：找到就调 controller.abort() 并返回确认；找不到就返回 error。cancelTaskTool 只加进 tools/index.ts 的 createAllTools 顶层清单，不加进 task.ts 的 subagentTools。task.ts 的 .catch 分支新增判断：controller.signal.aborted 为 true 时写入 cancelled: 前缀，否则维持原来的 error: 前缀。](assets/img/实战14-skeleton.svg)

---

## 二、代码落地

改动清单：新增 `controllerRegistry` 登记表和模块级单例 `cancelTaskTool`（`tools/task.ts`），把它加进顶层工具清单（`tools/index.ts`）；`runAgent`/`Tool.execute`/`ModelProvider.streamChat` 都新增可选的 `signal` 参数并一路传下去（`loop.ts`、`types.ts`）；`bash.ts` 把 `signal` 接进 `Bun.spawn` 并手动检查 `signal.aborted`；`anthropic.ts`、`openai.ts` 把 `signal` 接进各自的 `fetch` 调用；`retry.ts` 给 `AbortError` 加一条短路，取消不会被误当成"值得重试"。

### `src/tools/task.ts`：第二张登记表 + `cancel_task`

```typescript
// 只登记"还在跑"的后台任务——跟 completedBackgroundTasks 反过来的生命周期（折叠点④）
const controllerRegistry = new Map<string, AbortController>()

export function createTaskTool(provider: ModelProvider, gate: boolean): Tool {
  return {
    // ……task/background 的 schema 跟实战13 一样，省略
    execute: async (args: { task?: string; background?: boolean }) => {
      const task = args?.task
      if (!task) return 'error: 缺少 task 参数'
      if (!args?.background) return runAgent(provider, subagentTools, task, 10, gate)

      const taskId = `bg-${nextBackgroundTaskId++}`
      // controller 跟 taskId 同一处诞生（折叠点⑨）
      const controller = new AbortController()
      controllerRegistry.set(taskId, controller)
      runAgent(provider, subagentTools, task, 10, gate, undefined, undefined, undefined, undefined, controller.signal)
        .then(result => completedBackgroundTasks.set(taskId, result))
        .catch((err: unknown) => {
          // 分清"我自己叫停的"和"真的失败了"（折叠点⑫）
          if (controller.signal.aborted) {
            completedBackgroundTasks.set(taskId, `cancelled: 子agent执行被取消`)
          } else {
            const message = err instanceof Error ? err.message : String(err)
            completedBackgroundTasks.set(taskId, `error: 子agent后台执行失败——${message}`)
          }
        })
        .finally(() => controllerRegistry.delete(taskId)) // 跑完就收回对讲机（折叠点⑩）

      return `已提交后台任务 ${taskId}，子agent正在执行，完成后会自动提醒你结果。`
    },
  }
}

// 模块级单例，不是工厂函数——execute 只读写 controllerRegistry，不需要闭包 provider/gate（折叠点⑬）
export const cancelTaskTool: Tool = {
  name: 'cancel_task',
  description: '取消一个还在后台执行的子agent任务。只发出取消信号，不保证立刻停止——子agent会尽快响应中断。',
  parameters: {
    type: 'object',
    properties: { taskId: { type: 'string', description: '要取消的后台任务 id（形如 bg-1）' } },
    required: ['taskId'],
  },
  execute: async (args: { taskId?: string }) => {
    const taskId = args?.taskId
    if (!taskId) return 'error: 缺少 taskId 参数'
    const controller = controllerRegistry.get(taskId)
    if (!controller) return `error: 找不到任务 ${taskId}（可能不存在，或已经结束）` // 折叠点⑪
    controller.abort()
    return `已发出取消信号，${taskId} 会尽快停止`
  },
}
```

### `src/loop.ts`：`runAgent` 接住 `signal`，转给 `streamChat` 和每个工具

```typescript
export async function runAgent(
  provider: ModelProvider,
  tools: Tool[],
  userInput: string,
  maxTurns = 10,
  gate = true,
  system?: string,
  cwd?: string,
  sessionId?: string,
  resumeMessages?: Message[],
  signal?: AbortSignal, // 折叠点⑥：新增可选的最后一个参数
): Promise<string> {
  // ……
  for await (const event of provider.streamChat(messages, tools, system, signal)) {
    // ……跟实战13 一样
  }
  // ……
  const results = await Promise.all(
    toolCalls.map(async call => {
      const tool = toolByName.get(call.name)
      const result = tool
        ? await runWithGate(tool, call.args, session, gate, signal) // 一次调用共用同一个 signal（折叠点⑧）
        : `error: 未知工具 ${call.name}`
      return { call, result }
    }),
  )
  // ……
}

async function runWithGate(
  tool: Tool,
  args: any,
  session: ReturnType<typeof newSession>,
  gate: boolean,
  signal?: AbortSignal,
): Promise<string> {
  if (!gate) return tool.execute(args, signal)
  // ……权限判断跟实战04 一样
  return tool.execute(args, signal)
}
```

### `src/types.ts`：`Tool.execute` 和 `ModelProvider.streamChat` 都加一个可选 `signal`

```typescript
export type Tool = {
  name: string
  description: string
  parameters: object
  // 裸的第二个参数，没有包进上下文对象——眼下没有第二样东西需要跟 signal 一起传（折叠点⑦）
  execute: (args: any, signal?: AbortSignal) => Promise<string>
}

export interface ModelProvider {
  readonly name: string
  readonly model: string
  streamChat(messages: Message[], tools?: Tool[], system?: string, signal?: AbortSignal): AsyncGenerator<StreamEvent>
}
```

### `src/tools/bash.ts`：`Bun.spawn` 接了 `signal`，但反应跟 `fetch` 不一样

```typescript
execute: async (args: { command?: string }, signal?: AbortSignal) => {
  const command = args?.command
  if (!command) return 'error: 缺少 command 参数'
  try {
    const proc = Bun.spawn(['bash', '-c', command], { stdout: 'pipe', stderr: 'pipe', signal })
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    // Bun.spawn 被 abort 时 proc.exited 照样 resolve——得手动查 signal.aborted 才知道
    // 这次退出是不是被打断的（不像 fetch 那样自己抛 AbortError，折叠点⑦）
    await proc.exited
    if (signal?.aborted) throw new Error('命令执行被取消')
    const code = proc.exitCode
    const body = [out.trim(), err.trim() && `[stderr]\n${err.trim()}`].filter(Boolean).join('\n')
    return body || `（命令无输出，退出码 ${code}）`
  } catch (e) {
    return `error: 命令执行失败: ${(e as Error).message}`
  }
},
```

### `src/providers/anthropic.ts` / `openai.ts`：`signal` 原样转给 `fetch`

```typescript
// anthropic.ts —— fetch 被 abort 会自己抛 AbortError，不需要额外判断（折叠点⑦）
async *streamChat(messages: Message[], tools?: Tool[], system?: string, signal?: AbortSignal) {
  // ……
  const res = await fetch(`${self.base}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal })
  // ……
}
```

```typescript
// openai.ts —— 跟 anthropic.ts 同一份处理，两端 provider 不能只改一个
async *streamChat(messages: Message[], tools?: Tool[], system?: string, signal?: AbortSignal) {
  // ……
  const res = await fetch(`${self.base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${self.apiKey}` },
    body: JSON.stringify(body),
    signal,
  })
  // ……
}
```

### `src/retry.ts`：主动取消不该被当成"值得重试"

```typescript
export async function* withRetry(runOnce: () => AsyncGenerator<StreamEvent>): AsyncGenerator<StreamEvent> {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      yield* runOnce()
      return
    } catch (err) {
      // 主动取消不是"这次临时不巧"——重试只会让 cancel_task 的"尽快停止"多等好几个
      // 退避周期，跟 400/401 一样直接原样抛出，不算"耗尽"
      if (err instanceof Error && err.name === 'AbortError') throw err
      const status = extractHttpStatus(err)
      if (!isRetryable(status)) throw err
      if (attempt > MAX_RETRIES) throw new RetryExhaustedError(attempt - 1, err)
      // ……跟实战08 一样
    }
  }
}
```

这一条是写代码时才补上的：`isRetryable(undefined)` 默认返回 `true`，如果不加这道短路，一次被取消的请求（`fetch` 抛出的 `AbortError` 没有 HTTP 状态码，会落进 `undefined` 这一档）会被 `withRetry` 当成"网络层临时抽风"，乖乖等 1 秒、2 秒、4 秒重试三次——跟 `cancel_task` 承诺的"会尽快停止"背道而驰。

![主控制流程图：cancel_task 被调用后，controller.abort() 让 controller.signal.aborted 变为 true 并触发 abort 事件。这个 signal 早前已经被同一个 controller 分发给了两处：runAgent 这一轮的 provider.streamChat（内部转给 fetch 的 signal 选项，fetch 自动抛 AbortError）和 Promise.all 里每个工具的 execute（如 bashTool 转给 Bun.spawn 的 signal 选项，Bun.spawn 不自动抛错，需要手动检查 signal.aborted）。无论 runAgent 卡在哪一处，abort 事件触发后该处很快会以异常或提前返回的方式结束，最终让整个 runAgent 的 promise 落地——withRetry 遇到 AbortError 直接原样抛出不重试，runAgent 的 promise reject，task.ts 里的 .catch 检查 controller.signal.aborted 为 true，写入 cancelled: 前缀而非 error: 前缀，.finally 删除 controllerRegistry 里的这一行。](assets/img/实战14-flow.svg)

### 验证：真的把一个正在跑的子进程叫停

给出的问题："先用 task 工具派一个后台子agent（传 background:true）：任务描述是执行 shell 命令 `sleep 30`，命令结束后返回字符串 done。提交后不要等它，立刻调用 cancel_task 工具，把刚才拿到的 taskId 传进去取消它，并把 cancel_task 的返回内容告诉我。然后你自己单独执行一次 bash 命令 pwd。做完这些后，把整个过程（提交、取消、pwd 结果）汇总给我。"

```
[assistant] [mini-harness]
先并行提交后台子agent任务和执行 pwd（两者无依赖）：

  [turn 1] task({"task":"执行 shell 命令 `sleep 30`……","background":true})
    -> 已提交后台任务 bg-1，子agent正在执行，完成后会自动提醒你结果。…
  [turn 1] bash({"command":"pwd"}) -> /Users/weifengzhu/.../code/harness…

拿到 taskId 后立刻取消：
  [turn 2] cancel_task({"taskId":"bg-1"}) -> 已发出取消信号，bg-1 会尽快停止…

  [turn 1] bash({"command":"sleep 30"}) -> error: 命令执行失败: 命令执行被取消…

## 汇总

1. **提交后台子agent**：调用 task(background:true)，任务为执行 sleep 30 后返回 done。
   返回结果：已提交后台任务 bg-1，子agent正在执行，完成后会自动提醒你结果。
2. **取消任务**：立即用拿到的 taskId=bg-1 调用 cancel_task。
   返回内容：已发出取消信号，bg-1 会尽快停止（只是发信号，不保证立即停止）。
3. **pwd 结果**：/Users/weifengzhu/work/ai/big-model-learning/code/harness
```

最值得盯的是被截断的那一行：`bg-1` 内部的子agent这一轮正卡在 `bash({"command":"sleep 30"})` 里，`cancel_task` 调用完之后没过多久，这次 `sleep 30` 就提前吐出了 `error: 命令执行失败: 命令执行被取消`——那是折叠点⑦里 `bash.ts` 手动检查 `signal.aborted` 之后主动抛出的那句话。这条链路走完了整整五层：`cancel_task` → `controllerRegistry.get(taskId).abort()` → 子agent这次 `runAgent` 共用的那个 `signal` → `bashTool.execute` → `Bun.spawn` 里真正被杀掉的子进程——`sleep 30` 确实没有睡满 30 秒，是被真正打断的，不是凭空表演出来的效果。

![序列图：主生命线父agent + task.ts(controllerRegistry) + 子agent bg-1(runAgent 内部的 bash 调用) + 真实子进程 sleep 30。第①拍父agent调用 task(background:true)，task.ts 生成 taskId=bg-1，同时创建 AbortController 并登记进 controllerRegistry，runAgent(...,controller.signal) 发起但不 await，execute 立即返回"已提交"确认。第②拍 bg-1 内部的 runAgent 这一轮请求模型，模型决定调用 bash({"command":"sleep 30"})，execute 把这一轮共用的 signal 转给 Bun.spawn，真实子进程开始执行 sleep 30。第③拍父agent几乎同时并发执行 bash pwd（走正常阻塞路径，不受影响）。第④拍父agent拿到 taskId 后立即调用 cancel_task({"taskId":"bg-1"})，execute 在 controllerRegistry 里查到对应 controller，调用 controller.abort()，返回"已发出取消信号"。第⑤拍 abort() 让 signal.aborted 变为 true 并触发 abort 事件——这一刻同时影响两处：真实子进程被 Bun.spawn 的内部机制发信号终止；bash.ts 的 execute 里 await proc.exited 之后检查到 signal.aborted 为 true，抛出"命令执行被取消"这一异常，被外层 catch 包成 error: 前缀字符串返回。第⑥拍这次工具结果通过 tool 消息进入 bg-1 内部 runAgent 的下一轮，下一轮 streamChat 请求发出时 signal 已经是 aborted 状态，fetch 立即抛出 AbortError，withRetry 识别为 AbortError 短路不重试，直接向上抛出，runAgent 这个 promise 最终 reject。第⑦拍 task.ts 的 .catch 捕获到这次 reject，检查 controller.signal.aborted 为 true，把结果写入 completedBackgroundTasks 为 cancelled: 子agent执行被取消，.finally 从 controllerRegistry 删除 bg-1 这一行。](assets/img/实战14-sequence.svg)

当篇 checkpoint：`git tag harness-ch14-task-cancellation`。

---

## 三、🔬 翻开源码

去 `claude-code-rev` 里核对了真实 Claude Code 的任务取消系统——分散在 `src/tools/TaskStopTool/TaskStopTool.ts`（对外别名 `KillShell`）、`src/tasks/stopTask.ts`、`src/tasks/LocalAgentTask/LocalAgentTask.tsx`、`src/utils/ShellCommand.ts` 几个文件里。跟我们这一篇加的这点代码相比，真源码要处理的取消场景多得多，但每一处多出来的复杂度，都能对上这一篇某个折叠点刻意收窄的地方。

### 1. `signal` 裸传 vs 打包进 `ToolUseContext`

折叠点⑦把 `Tool.execute` 的签名改成了 `(args, signal?)`——一个裸的第二参数。真源码里，`abortController` 从来不是单独传的一个参数，它是打包进一个统一的 `ToolUseContext` 对象里，跟 `options`（模型配置、工具清单等一大坨运行时选项）、`readFileState`（文件读取状态缓存）、`getAppState()`/`setAppState()` 等一大堆运行时上下文一起传给每个工具的 `call()`。我们没有这些额外的上下文需要携带——`bashTool`/`cancelTaskTool` 除了 `signal`，不需要认识任何别的运行时状态，裸参数已经够用；一旦以后真的出现第二样需要跟 `signal` 一起传的东西，再包一层对象也不迟，现在包对象是给一个不存在的需求预留位置。

### 2. `.aborted` 布尔值 vs `signal.reason` 的富信息

`AbortSignal` 标准本身支持一个 `.reason` 字段——`abort(reason)` 可以带上"为什么被取消"这段信息，不只是一个光秃秃的布尔值。真源码里取消的来源不止一种：用户按了 Esc、达到了某个超时、上游任务被取消因而连带取消下游——不同来源需要在日志、UI 里展示不同的文案，`.reason` 恰好派上用场。我们目前只有一种取消的理由——模型（或用户）调用了 `cancel_task`，没有第二种需要区分的来源，所以只查一个布尔值 `signal.aborted` 就够，`.reason` 这个字段现在写了也用不上。

### 3. `TaskStopTool.ts`/`stopTask.ts` 的三态错误码 vs 我们只有一种"找不到"

折叠点⑪里 `cancel_task` 只有两条分支：找到就 abort，找不到统一报一句"可能不存在或已结束"。真源码的 `stopTask()`（`src/tasks/stopTask.ts`）区分得更细：`StopTaskError` 带三种错误码——`not_found`（这个 taskId 从来没存在过）、`not_running`（存在，但已经结束，不能再停）、`unsupported_type`（这个任务类型压根不支持被停止）。这背后是因为真源码的"任务"不止子agent一种类型——shell 命令本身也可以被单独 `kill`（对应 `TaskStopTool.ts` 对外的别名 `KillShell`），不同任务类型能不能被停止、停止的机制都不一样，三态错误码是为了让调用方知道具体是哪种情况没法停。我们眼下后台任务只有 `runAgent` 子agent这一种类型，"这个 taskId 现在还能不能被 abort"只有两种可能，合并成一句话完全够用。

### 4. `abortController` 打包进统一状态对象 vs 我们两张平行的 `Map`

`src/tasks/LocalAgentTask/LocalAgentTask.tsx` 的 `killAsyncAgent()` 操作的是 `AppState.tasks` 里的一个统一的 per-task 状态对象——这个对象把 `status`、`abortController`、还有一堆 UI 展示要用的元信息都揉在一起，是"一个任务=一个大对象"的设计。我们这一篇是两张完全独立、平行的 `Map`：`completedBackgroundTasks`（结果）和 `controllerRegistry`（能不能被停）。真源码需要合并成一个大对象，是因为一个任务除了"能不能被 abort"，还要跟着一大堆别的状态（进度、UI 渲染用的字段）一起流转；我们目前只有两件互相独立的事要记，天然就分得开，没必要现在就为了"看起来更统一"合并成一个对象——真需要共享状态的那一天，再合并也不迟。

### 5. `treeKill(pid, 'SIGKILL')` 进程树级别的 kill vs 我们依赖 `Bun.spawn` 自带的 signal

`src/utils/ShellCommand.ts` 对 shell 命令做取消时，用的是 `treeKill(pid, 'SIGKILL')`——递归杀掉整棵进程树，不只是最外层那一个进程。我们这一篇完全依赖 `Bun.spawn({ signal })` 自带的机制：`abort()` 之后，`Bun.spawn` 只会去处理它直接管理的那一个进程。这次验证跑的 `sleep 30` 只有一层，没有暴露这个差距；但如果 `bash` 工具跑的命令内部又 fork 了别的子进程（比如一段脚本调用了另一个命令），`AbortSignal` 只会杀掉最外层的那一个，孙子进程有可能变成孤儿继续跑下去——这是一个真实存在、但这一篇没有解决的缺口，留给以后需要更复杂 shell 命令场景时再补。

## 小结

- 取消不是回滚——已经发生的副作用不需要撤销，只是让"还没发生的部分"不再发生（折叠点①）。
- `cancel_task` 是一个全新的、独立的工具，不是给 `task` 加参数——取消这次调用早就已经收工，没有"回头改参数"这个动作（折叠点②）。
- `AbortController`/`AbortSignal`：控制器是按钮，`signal` 是接收端，代表"正在跑的这个东西"的把手（折叠点③）。
- 新增第二张模块级登记表 `controllerRegistry`，跟 `completedBackgroundTasks` 生命周期相反——只在"还在跑"时有一行（折叠点④）。
- `controller.abort()` 单独调用没有任何效果——`runAgent` 内部得先愿意检查 `signal` 才谈得上被打断（折叠点⑤）。
- `runAgent` 新增可选的最后一个参数 `signal?: AbortSignal`（折叠点⑥）。
- 两处真正会卡住的地方都要接：`streamChat`（网络）和工具的 `execute`（子进程）——`fetch` 被 abort 自动抛错，`Bun.spawn` 得手动检查 `signal.aborted`（折叠点⑦）。
- 一次 `runAgent` 调用只创建一个 controller，`streamChat` 和这一轮所有工具调用共用同一个 `signal`（折叠点⑧）。
- controller 跟 `taskId` 同一处创建——任务从存在的第一秒起就能被取消（折叠点⑨）。
- 任务落地（成功/失败/取消）时，`.finally` 统一清理 `controllerRegistry` 里那一行（折叠点⑩）。
- `cancel_task` 的 `execute` 只有找到/找不到两条分支，找不到时不区分"不存在"和"已结束"（折叠点⑪）。
- `.catch` 靠 `controller.signal.aborted` 分清"被主动叫停"和"真的失败了"，前者用 `cancelled:` 前缀（折叠点⑫）。
- `cancel_task` 是模块级单例，不是工厂函数——不需要闭包 `provider`/`gate`（折叠点⑬）。
- `cancel_task` 只进顶层工具清单，不进 `subagentTools`——子agent没有 `task`，自然创建不出后台任务，"谁能取消谁"这个顾虑结构上不成立（折叠点⑭）。

🔬 源码对照：
- `ToolUseContext`（真源码工具上下文对象）— 把 `abortController` 跟 `options`/`readFileState`/`getAppState()` 等一堆运行时状态打包传递；我们没有别的状态要一起传，裸传 `signal` 就够
- `AbortSignal.reason`（标准 API 富信息）— 真源码有多种取消来源需要区分；我们只有一种取消理由，布尔值 `.aborted` 够用
- `src/tasks/stopTask.ts` 的 `StopTaskError`（`not_found`/`not_running`/`unsupported_type` 三态）— 真源码支持多种任务类型的取消；我们只有一种任务类型，合并成一句话
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx` `killAsyncAgent()`（统一 per-task 状态对象）— 真源码一个任务要跟着一大堆状态流转；我们只有两件互相独立的事，两张平行的 Map 足够
- `src/utils/ShellCommand.ts` `treeKill(pid, 'SIGKILL')`（进程树级别的 kill）— 真源码能杀掉整棵进程树；我们依赖 `Bun.spawn` 自带的信号机制，命令内部再 fork 出的孙子进程可能变成孤儿，是一个还没解决的缺口

任务现在能提交、能完工提醒、也能被取消了——但父agent要取消一个任务，前提是它已经记得住那个 `taskId`。如果同时派出去好几个后台任务，或者过了几轮之后已经想不起来提交过哪些、现在还剩哪些在跑，有没有办法让它一次性看清楚"眼下还有什么在跑"？下一篇要拆的就是这个。
