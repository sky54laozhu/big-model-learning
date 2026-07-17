# 实战15：主动查一次后台任务——两张表合一张，问法却分两种

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战15）

实战14 收尾时留了一句话："任务现在能提交、能完工提醒、也能被取消了——但父agent要取消一个任务，前提是它已经记得住那个 `taskId`。如果同时派出去好几个后台任务，或者过了几轮之后已经想不起来提交过哪些、现在还剩哪些在跑，有没有办法让它一次性看清楚'眼下还有什么在跑'？"这一篇要填的就是这个空。

答案不是新架子，是先拆掉一个旧毛病：`completedBackgroundTasks`（结果表）和 `controllerRegistry`（控制柄表）这两张平行的登记表，一开始就是同一件事的两半——"这个任务现在是什么状态"——被硬拆成"在不在结果表里"和"在不在控制柄表里"两种隐式编码去猜。这一篇会先把两张表合成一张，再在合出来的这张表上面，架一个新工具让模型能主动问。

## 一、设计摊开：从"两张表各画一半"到"一张表、两种问法"

### 折叠点①：`completedBackgroundTasks` 和 `controllerRegistry`，到底是不是两件事

实战13 留下 `completedBackgroundTasks`——只在任务**跑完之后**才有它的一行；实战14 又加了 `controllerRegistry`——只在任务**还在跑**的时候才有它的一行。两张表的生命周期正好相反，一个任务的一生，从来不会同时出现在两张表的同一行。

这跟"值班表"和"离职名单"分成两张表管一个员工是同一个毛病：这个人到底是什么状态，本该是**一个字段**的事——在职/请假/离职——却被拆成"在不在值班表里"和"在不在离职名单里"两种隐式编码，还得靠"两张表都查一遍、互相印证"才能拼出这个人现在到底是什么状态。现在要新加一个"查询"的能力，如果继续在两张表的基础上查，`task_status` 的 `execute` 得先查 `controllerRegistry` 判断"是不是还在跑"，查不到再去 `completedBackgroundTasks` 里找结果——两次查询、两次判空，只为拼出一个本该是一个字段就能回答的问题。答案是把两张表合成一张：`taskRegistry: Map<string, TaskRecord>`，`status` 字段自己就是状态机，不用再靠"在不在这张表里"去猜。

### 折叠点②：合成一张表之后，`status` 该有几种取值

两张旧表隐含的状态其实只有"跑完了"（在结果表）和"还在跑"（在控制柄表）两种粗粒度分类，但"跑完了"这个粗分类底下其实还分好几种结局——成功、失败、被取消——实战14 的 `.catch` 分支已经在用 `cancelled:` 和 `error:` 两种不同的字符串前缀区分它们了，只是这个区分从来没有被提升成一个正式的字段。

现在把它们摊平成一个枚举：`'running' | 'completed' | 'cancelled' | 'error'`。四种，不多不少——`running` 对应旧的"控制柄表里有它"，剩下三种对应旧的"结果表里有它"底下那三种前缀所代表的结局。

### 折叠点③：一个任务跑完之后，模型已经通过自动提醒看过一次结果了，这一行该删掉吗

实战13/14 的 `drainCompletedBackgroundTasks` 上报完一个终态任务之后，原来的实现是直接把这一行从表里删掉——反正已经报过了，留着还有什么用？

但这一篇要新加的 `task_status` 恰好需要反过来——模型可能过了好几轮才想起来去查一个更早提交的任务，这时候如果这一行已经被删掉了，`task_status({taskId: "bg-1"})` 只能回答"找不到"，而"找不到"这个回答本该只属于"这个 taskId 从来没存在过"这一种情况，不该跟"存在过，只是已经报过一次就被清理掉了"共用同一句话。

这跟"已读"和"删除"是两个不同的动作是同一类问题：邮件读过了会被标成已读，不会因为你看过就自动从收件箱里消失，下次想翻出来对照一下，它还在那儿。删除这一行，删掉的不只是"还没上报的标记"，还顺带删掉了这个任务存在过的全部证据——这是过度设计成"看完就清空"付出的代价。于是改成一个 `notified: boolean` 标记：`drainCompletedBackgroundTasks` 和 `task_status` 遇到终态任务时都只是把这个标记翻成 `true`，从不删除这一行——终态任务的结果，从此可以被反复查到。

### 折叠点④：`task_status` 该回答"现在是什么状态"，还是也要回答"这一路都干了些什么"

最省事的做法是 `task_status` 只吐出 `record.status` 这一个字——running/completed/cancelled/error，四选一，一句话的事。但站在模型的角度想一下：如果一个后台任务卡在 `running` 好几轮都不动，模型光知道"还在跑"这三个字，没法判断它是卡住了还是确实需要这么久——它需要知道这个任务这一路究竟在做什么，读了哪些文件、跑了哪些命令,是"正常在推进"还是"看起来卡住了"。

只回答状态，回答的是"这个任务现在是活的还是死的"；把这一路的工具调用也带出来，回答的才是"它这一路究竟在忙什么"。这不是无中生有加复杂度——子agent每一次都有自己独立的一份 transcript（回扣实战10：`sessionId = taskId`，`bg-1` 这个任务自己的 transcript 文件就叫 `bg-1.jsonl`），这份记录本来就存在，只是从来没人把它翻出来给模型看过。`task_status` 传了具体 `taskId` 的时候，除了状态,还要把这个任务自己 transcript 里的工具调用记录翻出来给模型看。

### 折叠点⑤：翻这份 transcript，要不要新开一条"按字节增量读文件"的路

第一次查询和第二次查询之间,这份 transcript 可能又新增了好几条消息——如果每次查询都把整份 transcript 从头翻一遍给模型看,查询越到后面,重复的旧内容就越多,没意义。得记住"上次翻到哪儿了",下次接着往后翻。

`loadSessionMessages(cwd, sessionId)`（实战10已经写好的函数）本来就是把整份 transcript 读回一个 `Message[]` 数组;这个 harness 里一份后台任务的 transcript 顶多几十条消息，全部读进内存、按数组下标切片，开销小到可以忽略。真去开一条按字节 `seek` 的增量读文件的路,是在给一个不存在的性能问题预先修路——这个判断留到"翻源码"那节详细对照，因为真实源码里恰好有一条这样的路,但走的是完全不同的用途。于是这一篇的答案是：`outputOffset` 记的是"读到第几条消息"，不是字节偏移量；每次查询用 `messages.slice(record.outputOffset)` 切出新增的那一段，查完把 `offset` 更新成 `messages.length`。

### 折叠点⑥：切出来的这一段消息里，怎么把"模型调了哪个工具"和"那个工具答了什么"配对起来

一段新增的消息里,可能夹着好几条 `assistant` 消息（每条又可能带好几个并发工具调用）,和好几条 `tool` 消息（对应的结果）。最直接的想法是"第几个工具调用就对应第几条结果",按数组下标一一配对——但一旦这一轮有并发工具调用，`tool` 消息在数组里出现的顺序，不一定跟 `assistant.toolCalls[]` 里声明的顺序完全一致（回扣实战06：并发工具调用是用 `Promise.all` 一起发出去的，谁先落地完全看各自跑多快）。

按下标配对,一旦顺序错位,日志里显示的"某个调用 -> 某个结果"就会张冠李戴。真正稳的锚点是 `ToolCall.id`——每次调用自带的一个 id，随后的 `tool` 消息用 `toolCallId` 指回同一个 id，不管顺序怎么变，`slice.find(m => m.toolCallId === call.id)` 总能精确找到那一条,不依赖任何顺序假设。

### 折叠点⑦：日志里的"第几轮"，该从哪个数字开始数

每次查询都是"接着上次翻到的地方往后翻",如果轮数每次都从 1 开始数，第二次查询翻出来的"第 3、4 轮"就会被显示成"第 1、2 轮"——跟第一次查询里已经看过的"第 1、2 轮"重名，混淆了到底哪次是哪次。

轮数得跟 `outputOffset` 一样,是一个需要跨查询持久化的进度指针：`turnCount` 存进 `TaskRecord`，每次查询从 `record.turnCount` 接着往上累加，不是每次都归零重来。

### 折叠点⑧：`task_status` 的 `execute` 要读子agent自己的 transcript，这份数据从哪儿拿到

`buildIncrementalLog` 要调 `loadSessionMessages(cwd, record.taskId)`——这里的 `cwd` 是整个进程运行时唯一的一份工作目录，不是按 `taskId` 各存一份的东西。`createTaskTool` 已经示范过这个模式：`provider`/`gate` 只有 `index.ts` 启动的时候才拿得到，用工厂函数把它们焊进返回的 `Tool` 对象里。`task_status` 需要 `cwd` 的理由完全一样——`createTaskStatusTool(cwd)` 也做成工厂函数，`cwd` 作为闭包参数传进去，跟 `provider`/`gate` 同一个形状。

### 折叠点⑨：不传 `taskId` 该回答什么——是报错、还是另一种问法

`task_status` 目前设计成"传 `taskId` 就查这一个任务的详情"，但如果模型压根不记得自己提交过哪些任务的 `taskId`（这正是实战14 结尾那句话里描述的场景），要求它必须先知道 `taskId` 才能查，就跟"必须先知道文件名才能打开文件管理器"一样本末倒置。

"不传 `taskId`"不该是一个错误，该是另一种合法的问法——列出登记表里**所有**任务的概览：`taskId` + 任务描述（截断）+ `status`，终态的话再附一段结果预览。扫一眼概览就知道全局状态，需要细节再拿具体某个 `taskId` 查一次详情。同一个工具，两种传参方式对应两种粒度的问法，不需要拆成两个工具。

### 折叠点⑩：`task_status` 该出现在哪份工具清单里

跟实战14 的 `cancel_task` 面对的是同一个问题：工具清单现在有两份——`tools/index.ts` 的顶层清单（主agent能用的全集）和 `task.ts` 里的 `subagentTools`（子agent能用的窄集，不含 `task` 本身，回扣实战12 折叠点③，防止子agent再派生子agent）。

子agent的工具集里从一开始就没有 `task` 这个工具，它自然创建不出任何 `bg-N` 后台任务——一个从没创建过后台任务的角色，需不需要"查后台任务状态"这个工具？答案跟 `cancel_task` 一样：这个问题在结构上根本不成立。所以 `task_status` 只加进顶层清单，`subagentTools` 一个字都不用改。

![骨架定位图：tools/task.ts 把实战13 的 completedBackgroundTasks（结果表）和实战14 的 controllerRegistry（控制柄表）合并成一张登记表 taskRegistry: Map&lt;string, TaskRecord&gt;。TaskRecord 字段：taskId、task、status（四选一：running/completed/cancelled/error）、notified（终态是否已被看过，标记不删除）、outputOffset（transcript 读到第几条消息）、turnCount（累计轮数，跨查询持久化）、controller?（仅 running 时有）、result?（仅终态时有）。新增 buildIncrementalLog(cwd, record) 函数：调用实战10 的 loadSessionMessages(cwd, taskId) 整份读回子agent自己的 transcript，按 outputOffset 切片出新增部分，assistant.toolCalls[] 跟 tool 消息按 ToolCall.id 配对（不是数组下标），轮数从 record.turnCount 接着累加。新增工厂函数 createTaskStatusTool(cwd)，闭包住 cwd（跟 createTaskTool 的 provider/gate/cwd 同一个模式）。execute 分两种问法：不传 taskId 时遍历 taskRegistry 输出每个任务一行的概览；传 taskId 时查这一行，调用 buildIncrementalLog 拿增量日志，把 outputOffset/turnCount 写回、并把 notified 置为 true（终态时）。drainCompletedBackgroundTasks 同步改为标记 notified 而非删除这一行。task_status 只加进 tools/index.ts 的顶层清单 createAllTools，不加进 task.ts 的 subagentTools。](assets/img/实战15-skeleton.svg)

---

## 二、代码落地

改动清单：`task.ts` 里把 `completedBackgroundTasks` 和 `controllerRegistry` 合并成一张 `taskRegistry: Map<string, TaskRecord>`，新增 `buildIncrementalLog` 辅助函数和 `createTaskStatusTool` 工厂函数；`drainCompletedBackgroundTasks` 改成标记 `notified` 而不是删除；`tools/index.ts` 的 `createAllTools` 多接一个 `cwd` 参数,用它同时组装 `createTaskTool` 和 `createTaskStatusTool`。

### `src/tools/task.ts`：合并登记表 + 新增 `TaskRecord`

```typescript
type TaskStatus = 'running' | 'completed' | 'cancelled' | 'error'

// 把实战13 的 completedBackgroundTasks 和实战14 的 controllerRegistry 合成一张表——
// 一个 taskId 从诞生到终结全程只对应一行，status 字段本身就是状态机（折叠点①②）
type TaskRecord = {
  taskId: string
  task: string
  status: TaskStatus
  notified: boolean       // 终态是否已经被看过——标记，不删除这一行（折叠点③）
  outputOffset: number     // transcript 读到第几条消息（折叠点⑤）
  turnCount: number        // 累计轮数，跨查询持久化（折叠点⑦）
  controller?: AbortController  // 只有 running 时才有
  result?: string                // 只有终态才有
}

const taskRegistry = new Map<string, TaskRecord>()
```

### `buildIncrementalLog`：把一段 transcript 翻成人能读的工具调用日志

```typescript
async function buildIncrementalLog(
  cwd: string,
  record: TaskRecord,
): Promise<{ lines: string[]; offset: number; turnCount: number }> {
  const messages = (await loadSessionMessages(cwd, record.taskId)) ?? []
  const slice = messages.slice(record.outputOffset) // 只翻上次读到之后新增的部分（折叠点⑤）
  const lines: string[] = []
  let turnCount = record.turnCount // 接着上次的轮数往上累加，不从 1 开始（折叠点⑦）

  for (const message of slice) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue
    turnCount++
    for (const call of message.toolCalls) {
      // 按 id 配对，不是数组下标——并发工具调用的结果落地顺序不保证跟声明顺序一致（折叠点⑥）
      const toolResult = slice.find(m => m.role === 'tool' && m.toolCallId === call.id)
      const preview = toolResult ? toolResult.content.slice(0, 60).replace(/\s+/g, ' ') : '(还没见到结果)'
      lines.push(`[turn ${turnCount}] ${call.name}(${JSON.stringify(call.args)}) -> ${preview}…`)
    }
  }

  return { lines, offset: messages.length, turnCount }
}
```

### `createTaskStatusTool`：闭包住 `cwd`，两种问法走两条分支

```typescript
export function createTaskStatusTool(cwd: string): Tool {
  return {
    name: 'task_status',
    description:
      '查询后台任务的状态。不传 taskId 时列出所有后台任务的概览（id、任务描述、状态，已结束的附结果预览）；' +
      '传 taskId 时查询单个任务的详情（状态、已结束则附完整结果、以及自上次查询以来新增的工具调用记录）。',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string', description: '要查询的后台任务 id（形如 bg-1）；不传则列出所有任务' } },
      required: [],
    },
    execute: async (args: { taskId?: string }) => {
      const taskId = args?.taskId

      // 不传 taskId：概览（折叠点⑨）
      if (!taskId) {
        if (taskRegistry.size === 0) return '当前没有任何后台任务。'
        const lines = Array.from(taskRegistry.values()).map(record => {
          const desc = record.task.length > 40 ? `${record.task.slice(0, 40)}…` : record.task
          const preview =
            record.status !== 'running' && record.result
              ? `：${record.result.slice(0, 60).replace(/\s+/g, ' ')}…`
              : ''
          return `- ${record.taskId} [${record.status}] ${desc}${preview}`
        })
        return lines.join('\n')
      }

      // 传 taskId：详情
      const record = taskRegistry.get(taskId)
      if (!record) return `error: 找不到任务 ${taskId}`

      const { lines, offset, turnCount } = await buildIncrementalLog(cwd, record)
      taskRegistry.set(taskId, {
        ...record,
        outputOffset: offset,
        turnCount,
        notified: record.status !== 'running' ? true : record.notified, // 查过就不用 drain 再报一遍
      })

      const parts = [`状态：${record.status}`]
      if (record.status !== 'running' && record.result) parts.push(`结果：\n${record.result}`)
      parts.push(lines.length > 0 ? `新增工具调用记录：\n${lines.join('\n')}` : '自上次查询以来没有新的工具调用记录。')
      return parts.join('\n\n')
    },
  }
}
```

### `drainCompletedBackgroundTasks`：改成标记，不再删除

```typescript
export function drainCompletedBackgroundTasks(): string | null {
  const completed: { id: string; result: string }[] = []
  for (const [id, record] of taskRegistry) {
    if (record.status === 'running' || record.notified) continue
    completed.push({ id, result: record.result ?? '' })
    taskRegistry.set(id, { ...record, notified: true }) // 标记，不 delete（折叠点③）
  }
  if (completed.length === 0) return null
  const body = completed.map(({ id, result }) => `- 任务 ${id} 已完成，结果：\n${result}`).join('\n\n')
  return `以下后台任务已经跑完：\n\n${body}`
}
```

### `src/tools/index.ts`：`createAllTools` 多接一个 `cwd` 参数

```typescript
export function createAllTools(provider: ModelProvider, gate: boolean, cwd: string): Tool[] {
  return [
    readFileTool, writeFileTool, editFileTool, listDirTool, bashTool, todoWriteTool,
    createTaskTool(provider, gate, cwd),
    cancelTaskTool,
    createTaskStatusTool(cwd), // 只进顶层清单，不进 subagentTools（折叠点⑩）
  ]
}
```

![主控制流程图：模型调用 task_status 工具，execute 先分岔——没传 taskId 时遍历 taskRegistry 整张表，逐行拼出"id [状态] 描述+结果预览"的概览字符串直接返回；传了 taskId 时先按 taskId 查这一行，查不到直接返回 error，查到之后调用 buildIncrementalLog(cwd, record)：内部调 loadSessionMessages 读回这个任务自己的 transcript，按 record.outputOffset 切出新增消息段，遍历这段消息里的 assistant 工具调用，用 ToolCall.id 在同一段里找到对应的 tool 结果消息配对，轮数从 record.turnCount 往上累加，返回新增日志行 + 新的 offset + 新的 turnCount。execute 把这三者写回 taskRegistry（同时把 notified 置 true，如果这个任务已经是终态），最后拼出"状态 + （终态才有的）完整结果 + 新增工具调用记录"三段返回给模型。](assets/img/实战15-flow.svg)

### 验证：先列概览，再查详情

给出的问题："先用 task 工具派一个后台子agent（传 background:true）：任务描述是先执行 shell 命令 pwd，再执行 shell 命令 echo hello，最后返回一句总结说明这两条命令各自的输出。提交之后立刻调用 task_status 工具（不传 taskId）看一下概览，把返回内容原样告诉我。然后等待几秒，再调用一次 task_status，这次传入刚才拿到的 taskId，把这次返回的详情也原样告诉我。"

```
[mini-harness]
第一次（提交后立即调用，不传 taskId）：
  [turn 2] task_status({}) -> - bg-1 [running] 先执行 shell 命令 pwd，再执行 shell 命令 echo hello……

等待几秒后第二次（传 taskId: bg-1）：
  [turn 4] task_status({"taskId":"bg-1"}) ->
状态：completed

结果：
总结：`pwd` 命令输出了当前工作目录路径 `/Users/weifengzhu/work/ai/big-model-learning/code/harness`；
`echo hello` 命令输出了字符串 `hello`。

新增工具调用记录：
[turn 1] bash({"command":"pwd"}) -> error: 用户拒绝了这次 bash 调用。…
[turn 1] bash({"command":"echo hello"}) -> error: 用户拒绝了这次 bash 调用。…
[turn 2] bash({"command":"pwd"}) -> /Users/weifengzhu/work/ai/big-model-learning/code/harness…
[turn 2] bash({"command":"echo hello"}) -> hello…
```

顺便提一句：在这两次主动查询之间，另有一条 system-reminder 自动推送了 bg-1 完成的消息（跟第二次查到的结果一致）——这正是折叠点③要保的那件事：`drainCompletedBackgroundTasks` 已经报过一次，但因为改成了标记而不是删除，`task_status` 之后还能按 `taskId` 精确查到这同一行，两条路径互不打架。

第一次查询原样吐出了概览格式——`taskId` + 状态 + 截断的任务描述,这时候子agent才刚提交,状态还是 `running`,没有结果预览。第二次带上 `taskId` 查询,状态已经变成 `completed`,完整结果和"新增工具调用记录"都出来了——日志里能看到子agent自己那份 transcript 里真实发生的两轮：第一轮两条 `bash` 调用先被闸门拒绝了一次（子agent跑在自己的会话里，`gate` 沿用同一套闸门,回扣实战12 折叠点⑤),第二轮才真正跑通,拿到 `pwd` 和 `echo hello` 各自的输出——`turnCount` 正确地把这两轮分别标成"第 1 轮"和"第 2 轮"，不是从头数起,也没有因为拒绝重试就把轮号搞乱。

当篇 checkpoint：`git tag harness-ch15-task-status-query`。

![序列图：主生命线父agent + task.ts(taskRegistry) + 子agent bg-1 自己的 transcript(bg-1.jsonl)。第①拍父agent调用 task(background:true)，taskRegistry 里新增一行 taskId=bg-1、status=running，runAgent(...,cwd,taskId=sessionId,...) 发起但不 await，子agent这次的每一轮对话都被写进它自己的 bg-1.jsonl。第②拍父agent几乎立刻调用 task_status({})（不传 taskId），execute 遍历 taskRegistry，只找到 bg-1 这一行且 status=running，拼出概览字符串直接返回，没有读取任何 transcript 文件。第③拍子agent这一侧继续跑——第一轮两次 bash 调用先被闸门拒绝，第二轮重新发起 bash pwd 和 bash echo hello 两次调用都成功，子agent产出最终总结文本，runAgent 这次 promise 落地，.then 把 taskRegistry 里 bg-1 这一行更新为 status=completed、写入 result，controller 清空。第④拍下一轮 loop 开口前 drainCompletedBackgroundTasks 发现 bg-1 是终态且 notified=false，把结果拼进 system-reminder 自动上报给父agent，同时把 notified 置为 true（但不删除这一行）。第⑤拍父agent等待几秒后调用 task_status({taskId:"bg-1"})，execute 查到这一行，调用 buildIncrementalLog(cwd, record)：读回 bg-1.jsonl 全部消息，按 record.outputOffset=0 切出全部消息，按 ToolCall.id 把两轮里各自的 bash 调用和结果配对，产出带 turn 编号的日志行；execute 把 outputOffset 更新为消息总数、turnCount 更新为 2、notified 保持 true（已经是 true），拼出"状态+结果+新增工具调用记录"三段返回给父agent。](assets/img/实战15-sequence.svg)

---

## 三、🔬 翻开源码

去 `claude-code-rev` 里核对了真实 Claude Code 的任务查询系统——分散在 `src/tools/TaskOutputTool/TaskOutputTool.tsx`、`src/tasks/Task.ts`、`src/tasks/types.ts`、`src/utils/task/diskOutput.ts`、`src/utils/task/framework.ts`、`src/state/AppStateStore.ts` 几个文件里。这一篇跟真源码相比,有一处是刻意收窄的简化，有一处是巧合般的殊途同归，还有一处是容易被误认成同一件事、实则完全无关的另一套系统。

### 1. 真实的 `TaskOutputTool` 已经被标记废弃——它描述的正是这一篇的设计方向

`TaskOutputTool.tsx:157-159` 里，这个工具的名字对外叫 `TaskOutput`，但它自己的 `isEnabled()`/描述文本明确写着这是一个 **DEPRECATED** 的工具：description 里直接告诉模型——background 任务提交时和完工通知里都会带上输出文件的路径，模型应该直接用 `Read` 工具去读那个文件，而不是调 `TaskOutput`。真源码走到这一步，等于已经在文档里承认"专门开一个查询工具"这条路线不如"把文件路径给你，你自己去读"来得直接。

这恰好是这一篇 `task_status` 想做的事情——一次调用就把状态、结果、增量日志格式化好、直接吐给模型，不需要模型自己再去拼文件路径、再调一次 `Read`、再自己解析 transcript 格式。某种程度上，这一篇的 `task_status` 更接近真源码"废弃 `TaskOutput`、改用 `Read`"这个决定背后想要达到的效果，而不是接近被废弃的那个工具本身。

### 2. `outputOffset` 是字节偏移量，但只喂给另一条完全不同的轮询链路——用户查询工具从来没用过它

`Task.ts:45-57` 的 `TaskStateBase` 上确实有一个字段叫 `outputOffset: number`，初始化为 `0`（`Task.ts:108-125`）。但这个字段是**字节偏移量**，不是消息条数——它唯一的消费者是 `src/utils/task/diskOutput.ts:300-330` 的 `getTaskOutputDelta()`，内部调 `readFileRange(path, fromOffset, maxBytes)`，返回 `newOffset: fromOffset + result.bytesRead`。而这个函数又只被 `src/utils/task/framework.ts` 内部一条**自动轮询循环**调用（`generateTaskAttachments()`，`framework.ts:158-206`，由 `pollTasks()` 以 `POLL_INTERVAL_MS = 1000` 每秒调一次，`framework.ts:255-269`）——它是 harness 自己每秒偷偷读一次增量、往对话里注入附件用的,不是用户可以主动调用的工具接口。

真正的用户查询工具 `TaskOutputTool`（就算没被废弃）走的是完全不同的另一条路：每次调用都用 `getTaskOutputData()` → `getTaskOutput()`（`diskOutput.ts:336-357`）从文件**末尾**往前 tail 读最多 8MB,完全不看、也不更新 `outputOffset`。也就是说,真源码的"增量指针"和"用户查询接口"根本走的是两条从不相交的路径——`outputOffset` 只服务那条每秒自动轮询的隐藏管道。这一篇的 `outputOffset`/`turnCount` 设计（折叠点⑤⑦）恰恰把这两件事合并到了同一条路径上：既是增量指针,也是查询工具自己在用的进度指针——这是刻意的简化，理由还是折叠点⑤提过的：这个 harness 里一份 transcript 顶多几十条消息，没有必要为了效仿真源码"轮询 + tail 读"这套双轨设计，去多开一条只有几十条消息量级用不上的性能优化路径。

### 3. `notified` 标记——这一次是巧合的殊途同归，不是简化

折叠点③把"删除这一行"改成"标记 `notified`"，原本以为这纯粹是这个 harness 自己权衡出来的设计；但 `TaskStateBase`（`Task.ts:45-57`）本身就带一个同名字段 `notified: boolean`，含义也完全一致——标记"这个任务的完工是否已经上报过"，不作为删除这一行的依据。这是这一篇少有的"没找真源码抄，自己推出来的答案，恰好长得一模一样"的地方——值得单独记一笔：不是我们简化了什么，是这条设计本身大概率就是"任务完工提醒不该跟任务记录的存续绑在一起"这件事唯一合理的解法，殊途同归。

### 4. `TaskStatus` 真实有 5 种取值，比我们的 4 种多一个 `pending`

`Task.ts:15-20` 定义的 `TaskStatus` 是 `'pending' | 'running' | 'completed' | 'failed' | 'killed'`（对应我们的 `running/completed/cancelled/error`，只是命名不同，`failed`→`error`、`killed`→`cancelled`）。多出来的 `pending` 描述的是"已经登记、但还没真正开始执行"这个中间状态——在真源码里，任务的登记（写入 `AppState.tasks`）和真正开始跑（分发给具体的执行器）之间，有一层调度/排队的逻辑，两者不是背靠背的同步调用。

顺着这一篇 `createTaskTool` 的 `execute` 代码读下来：`taskRegistry.set(taskId, {...})` 登记完的下一行紧接着就是 `runAgent(...)`——中间没有任何排队或调度层，"已登记但还没开始跑"这个状态在这个 harness 里从来没有被任何代码观察到过，所以没有开这个状态,不是漏掉了,是这个 harness 的执行模型里它本来就不存在。

### 5. 真实的任务登记表是判别式联合 `TaskState`，我们是一张扁平的 `TaskRecord`——还有一套同名但无关的工具家族要小心

真源码里没有一个字面叫 `TaskRecord` 的类型（`grep -rn "TaskRecord" src` 无结果）。真正的等价物是 `TaskStateBase`（共享的基础字段）加一个判别式联合 `TaskState`（`src/tasks/types.ts:12-19`）：`LocalShellTaskState | LocalAgentTaskState | RemoteAgentTaskState | InProcessTeammateTaskState | LocalWorkflowTaskState | MonitorMcpTaskState | DreamTaskState`——一个任务可能是本地 shell、本地子agent、远程子agent、进程内队友、工作流……七种截然不同的类型，各自需要携带的字段不一样，统一存进 `AppState.tasks: { [taskId: string]: TaskState }`（`AppStateStore.ts:160`）。我们眼下只有"后台子agent"这一种任务类型，不需要判别式联合，一张扁平的 `TaskRecord` 已经够用——真源码要处理的任务类型多得多，是复杂度的真实来源，不是过度设计。

顺带一提一个容易踩的坑：真源码里还有另一组名字长得像的工具——`TaskGetTool`/`TaskListTool`/`TaskCreateTool`/`TaskUpdateTool`（工具名 `TaskGet`/`TaskList`/`TaskCreate`/`TaskUpdate`），这是一套 todo/项目任务追踪器（字段是 `subject`/`blocks`/`blockedBy`/`owner`，`TaskGetTool.ts:20-33`），操作的是 `src/utils/tasks.ts` 的 `getTask()`/`listTasks()`，被 `isTodoV2Enabled()` 开关控制——这套系统跟我们这一篇的后台异步任务登记表（`AppState.tasks`）是完全不同的两个概念，只是命名撞了车,不能混为一谈。

## 小结

- `completedBackgroundTasks` 和 `controllerRegistry` 本是同一件事拆成两半——合并成一张 `taskRegistry`，`status` 字段本身就是状态机（折叠点①）。
- `status` 只留 4 种：`running/completed/cancelled/error`——把旧的隐式前缀区分（`cancelled:`/`error:`）提升成正式字段（折叠点②）。
- 终态任务不再删除这一行，而是标记 `notified`——上报过和查得到是两件事，不该绑在一起（折叠点③）。
- `task_status` 传了 `taskId` 时不只回答状态，还带出这一路的工具调用日志——光知道"还在跑"判断不出"是不是卡住了"（折叠点④）。
- 增量日志复用 `loadSessionMessages` + 数组切片，`outputOffset` 记的是消息条数，不新开字节级 seek（折叠点⑤）。
- 工具调用和结果按 `ToolCall.id` 配对，不是数组下标——并发调用的落地顺序不保证跟声明顺序一致（折叠点⑥）。
- `turnCount` 从上次查询接着往上累加,不是每次归零（折叠点⑦）。
- `createTaskStatusTool(cwd)` 是工厂函数，`cwd` 跟 `provider`/`gate` 同一个闭包模式（折叠点⑧）。
- 不传 `taskId` 列概览、传 `taskId` 查详情——同一个工具，两种粒度的问法（折叠点⑨）。
- `task_status` 只进顶层工具清单，不进 `subagentTools`——子agent创建不出 `bg-N`,这个顾虑结构上不成立（折叠点⑩）。

🔬 源码对照：
- `TaskOutputTool.tsx`（真源码已废弃的查询工具，description 直接建议改用 `Read`）— 这一篇 `task_status` 的一次性格式化返回，更接近真源码"废弃它"这个决定背后想要的效果
- `outputOffset`（真源码字节偏移量，只喂给 `framework.ts` 每秒一次的自动轮询链路，用户查询工具从不使用）— 我们把"增量指针"和"查询进度"合并成同一条路径，是这个 harness 消息量级下的刻意简化
- `notified: boolean`（`TaskStateBase` 自带同名字段）— 巧合的殊途同归，不是简化
- `TaskStatus` 五态（多一个 `pending`，描述"已登记未开始跑"的调度中间态）— 这个 harness 里登记和执行背靠背同步发生，没有这个中间态
- 判别式联合 `TaskState`（七种任务类型各自的字段）vs 我们扁平的 `TaskRecord`（只有一种类型）— 复杂度差距来自真源码要处理的任务类型更多
- `TaskGetTool`/`TaskListTool`（todo/项目任务追踪器，跟后台异步任务是两套无关系统，只是命名撞车）

任务现在能提交、能完工提醒、能被取消、也能被主动查了——但眼下的每一次查询、每一次取消、每一次提交，都只在这一次 CLI 进程活着的时候才有意义，进程一退出，`taskRegistry` 这张表就随内存一起蒸发了。如果父agent这次会话中途断了、或者想在下一次启动时接着看昨天提交的那个后台任务还在不在，这套状态该怎么活过一次进程重启？下一篇要拆的就是这个。
