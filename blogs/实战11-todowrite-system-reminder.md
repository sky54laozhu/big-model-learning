# 实战11：TodoWrite 与 system-reminder——状态线自己开口提醒

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战11）

实战10 把"记不记得住"焊上了：关掉重开能接着聊，跨会话的经验也能沉淀成备忘录。但这两层解决的都是"进程之间"的记忆——这一篇要处理的是**同一个进程里、同一场对话内部**的另一道题：一场足够长的任务，模型自己会不会把"干到第几步了"这件事弄丢？

概念卷 24 篇讲过金鱼记忆的"三祸"——炸、坏、偏，其中"偏"（跑题/上下文中毒）的解药是**状态线**：把"最初任务是啥、干到第几步、上一步关键结果"这种错一字都不行的事实，单独拎出来记，不跟着记忆线一起做有损压缩。当时那篇留了一句直白的话：**"Claude Code 那个进度文件就是它（回扣 17b/23）"**——这一篇就是把这句话坐实：状态线在真实 harness 里，不是一份被动读写的数据结构，而是一个模型自己会调用的工具（`TodoWrite`），外加一套**它多久没被用了、就该被戳一下**的自动提醒机制。这一篇是阶段C（自主与韧性）的收尾：实战08 教会 harness 扛住请求失败，实战09 教会它扛住历史撑爆，实战10 教会它扛住进程重启，这一篇教会它扛住"任务太长、中途忘了自己在干嘛"。

## 一、设计摊开：状态怎么被记下来，又怎么被"提醒"起来

### 折叠点①：多久没写、多久没提醒——这两把尺子该怎么定

先问一个朴素的问题：如果要在"模型好久没更新任务清单了"这件事上戳它一下，"好久"该怎么算？

只看"离上次写 TodoWrite 过了几轮"够不够？不够——如果上一轮刚提醒过，这一轮判断条件还是"离上次写超过 N 轮"，会连续每一轮都塞提醒，模型会被反复打扰到没法正常干活。所以还得留一把尺子管"离上次提醒过了几轮"，两把尺子都过线（既是好久没写、也是好久没提醒过）才真的提醒一次——这是个防抖设计，而不是单纯的阈值判断。

两个阈值具体定多少轮？这一篇直接照抄源码 `attachments.ts` 的 `TODO_REMINDER_CONFIG`：`TURNS_SINCE_WRITE: 10`、`TURNS_BETWEEN_REMINDERS: 10`，都是 10 轮。这两个数字本身没什么好教学阐述的空间，照搬即可，不为了"看起来像教程"而调小。

### 折叠点②：todo 条目该长什么样——只要一个状态字符串够吗？

清单里的每一项至少要有"内容"和"状态"。状态选 `pending`/`in_progress`/`completed` 三态，这没什么好争的——但"内容"该是几个字段？

如果只有一个 `content: string`，那当某一项正在进行时，要不要把它从"修复登录bug"这种祈使式描述，换成"正在修复登录bug"这种进行时口吻显示给用户？如果由 harness 自己做这个转换——比如无脑加个"正在"前缀，或者对英文做 `-ing` 变位——规则很快会在不规则动词上翻车（`Stop` 该变 `Stopping`，规则做出来的很可能是错的 `Stoping`）。

更省事也更准的做法：两个字段都直接问模型要。`content` 是祈使式（列表默认显示），`activeForm` 是进行时（只在 `in_progress` 时换上）——两个字符串都由模型自己写好，harness 不做任何文本变换，只负责在渲染时选哪个字段显示。

### 折叠点③：轮数怎么数——要不要维护一个专门的计数器？

判断"该不该提醒"需要知道"过了几轮"，直觉上会想开一个变量，每过一轮就 `+1`，遇到 TodoWrite 调用就清零。但这跟实战09 压缩、实战10 断点续传踩过的同一个坑一样：一旦历史被压缩整段替换、或者是 `--resume` 读回的旧历史，一个独立维护的活变量根本不知道该怎么"跟上"这些跳变——压缩发生的那一刻，计数器要不要清零？`--resume` 读回来的历史里已经发生过的 TodoWrite 调用，计数器要不要"倒着补"？

这一篇的答案是不维护活变量，两个计数都靠**倒着扫一遍当前的 `messages` 现算**：从最后一条往前找，遇到第一个带 `todo_write` 工具调用的 assistant 消息就停（记下"多久没写"），遇到第一条被标记为"上一次提醒"的消息也停（记下"多久没提醒"）。不管这份 `messages` 是刚压缩过的、还是 `--resume` 读回来的，现算这一刻永远对，没有"计数器没跟上历史变化"这道题。

### 折叠点④：怎么标记"这条消息是提醒"，好在下次倒着扫的时候认出它

折叠点③要倒着扫消息找"上一次提醒"，这就要求提醒消息本身必须带一个能被认出来的标记。选什么形状的消息来装这条提醒？

它必须是模型这一轮请求里能读到的一条消息——`Role` 只有 `user`/`assistant`/`tool` 三种，只有 `role: 'user'` 能承载"喂给模型看的新信息"（`assistant` 是模型自己说的话，`tool` 要绑一个具体的 `toolCallId`，都不合适）。但它又不是人类这一轮真正敲的字，得跟真实用户输入区分开——所以给 `Message` 的 `user` 变体加一个可选的 `isMeta?: boolean` 字段，`true` 表示"这是 harness 自己合成塞进去的"。下次倒着扫时，找的就是 `role === 'user' && isMeta === true` 这条。

### 折叠点⑤：这次自检该摆在循环的哪个位置

`shouldRemindTodo` 这次检查，该放在 loop 主循环的什么地方？

它跟实战09 的压缩检查（`shouldAutoCompact`）其实是同一种性质的东西：**每一轮开口前的自检**——都是"看一眼当前 messages 的状态，决定要不要在真正调用模型之前，往 messages 里插一条东西"。没道理为它另开一条独立的检查路径，摆在跟压缩检查同一个位置（`for` 循环顶部、`streamChat` 调用之前）最合理：两把尺子过线就 `push` 一条提醒消息进 `messages`，跟其他消息一样走 `record` 落盘，下一行就进入这一轮的模型请求。

### 折叠点⑥：当前清单内容存在哪——现算，还是活对象？

提醒文案里要带上"当前清单的实际内容"，这份内容该从哪儿取？

折叠点③已经定了"轮数不维护活变量，现算"这条原则，但清单内容不是"轮数"，是 TodoWrite 每次调用**整体替换**掉的实际数据——不是"发生过多少次调用"这种可以倒着数的事件，而是"最后一次调用把清单改成了什么样"这种只有最新一份有意义的状态。倒着扫 messages 找到最后一次 `todo_write` 调用、解析它的参数，理论上也能拿到同样的答案，但直接用一个模块级的活对象、每次 TodoWrite 执行就真的把它改了，直白得多——这跟折叠点③"不维护活变量"看似矛盾，但两者管的是不同性质的东西：轮数是"过了多久"这种需要重新计算的历史事实，清单内容是"当前是什么"这种直接被写覆盖的当前状态，回扣真源码 `appState.todos[todoKey]` 正是这样一个真实存在的活字典。

![骨架定位图：types.ts 的 Message 联合类型里 user 变体新增可选字段 isMeta。新增两个自包含文件——src/tools/todo_write.ts（TodoItem 类型 + 模块级活对象 currentTodos + getCurrentTodos 读接口 + todoWriteTool 工具定义，注册进 tools/index.ts 的 allTools 数组）与 src/todoReminder.ts（TODO_REMINDER_CONFIG 双阈值常量 + getTodoReminderTurnCounts 倒扫计数 + shouldRemindTodo 双阈值判断 + buildTodoReminderMessage 提醒文案组装，读取 todo_write.ts 导出的 getCurrentTodos）。loop.ts 主循环顶部新增一次 shouldRemindTodo 检查，紧跟在实战09 的 shouldAutoCompact 检查之后、streamChat 调用之前——两次检查是同一种"每轮开口前自检"，共享同一个位置。底部灰色虚线框：streamChat 消费、权限闸门、重试机制、压缩、Layer A/B 持久化全部沿用实战02-10，一个字没改。](assets/img/实战11-skeleton.svg)

---

## 二、代码落地

改动清单：`types.ts` 的 `Message` 类型新增 `isMeta`；新增 `src/tools/todo_write.ts`（工具本体 + 活状态）；新增 `src/todoReminder.ts`（双阈值判断 + 提醒文案）；`tools/index.ts` 注册新工具；`loop.ts` 主循环里接入检查调用。

### `types.ts`：`user` 消息新增 `isMeta`

```typescript
export type Message =
  | { role: 'user'; content: string; isMeta?: boolean }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; usage?: Usage }
  | { role: 'tool'; toolCallId: string; content: string }
```

### `src/tools/todo_write.ts`：三态 + 双文本字段 + 一个真活对象

```typescript
export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type TodoItem = { content: string; activeForm: string; status: TodoStatus }

let currentTodos: TodoItem[] = []

export function getCurrentTodos(): readonly TodoItem[] {
  return currentTodos
}

export const todoWriteTool: Tool = {
  name: 'todo_write',
  description: '用一份完整的任务清单整体替换当前的 todo 列表，用来追踪多步骤任务的进度。',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '祈使式描述，如"修复登录bug"' },
            activeForm: { type: 'string', description: '进行时描述，如"正在修复登录bug"' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'activeForm', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  execute: async (args: { todos?: TodoItem[] }) => {
    currentTodos = args?.todos ?? []
    return `ok: 已更新任务清单（${currentTodos.length} 项）`
  },
}
```

### `src/todoReminder.ts`：双阈值倒扫 + 提醒文案组装

```typescript
export const TODO_REMINDER_CONFIG = {
  TURNS_SINCE_WRITE: 10,
  TURNS_BETWEEN_REMINDERS: 10,
} as const

function getTodoReminderTurnCounts(messages: readonly Message[]): {
  turnsSinceLastTodoWrite: number
  turnsSinceLastReminder: number
} {
  let lastTodoWriteIndex = -1
  let lastReminderIndex = -1
  let turnsSinceLastTodoWrite = 0
  let turnsSinceLastReminder = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'assistant') {
      if (lastTodoWriteIndex === -1 && message.toolCalls?.some(call => call.name === 'todo_write')) {
        lastTodoWriteIndex = i
      }
      if (lastTodoWriteIndex === -1) turnsSinceLastTodoWrite++
      if (lastReminderIndex === -1) turnsSinceLastReminder++
    } else if (lastReminderIndex === -1 && message?.role === 'user' && message.isMeta) {
      lastReminderIndex = i
    }

    if (lastTodoWriteIndex !== -1 && lastReminderIndex !== -1) break
  }

  return { turnsSinceLastTodoWrite, turnsSinceLastReminder }
}

export function shouldRemindTodo(messages: readonly Message[]): boolean {
  const { turnsSinceLastTodoWrite, turnsSinceLastReminder } = getTodoReminderTurnCounts(messages)
  return (
    turnsSinceLastTodoWrite >= TODO_REMINDER_CONFIG.TURNS_SINCE_WRITE &&
    turnsSinceLastReminder >= TODO_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS
  )
}

export function buildTodoReminderMessage(): Message {
  const todos = getCurrentTodos()
  let text =
    'todo_write 工具最近没被用过。如果当前任务是多步骤、值得追踪进度的，考虑调用它来记录进展；' +
    '如果清单已经过时、跟当前工作对不上了，也考虑清理一下。只在确实相关时才用它，这只是个温和的' +
    '提醒——不相关就忽略。不要向用户提起这条提醒本身。'

  if (todos.length > 0) {
    const items = todos.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`).join('\n')
    text += `\n\n当前清单内容：\n\n[${items}]`
  }

  return { role: 'user', content: `<system-reminder>\n${text}\n</system-reminder>`, isMeta: true }
}
```

### `tools/index.ts`：注册新工具

```typescript
export const allTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  bashTool,
  todoWriteTool,
]
```

### `loop.ts`：接进主循环，跟压缩检查同一个位置

```typescript
for (let turn = 1; turn <= maxTurns; turn++) {
  if (shouldAutoCompact(messages, provider.model)) {
    // ……实战09：压缩……
  }

  // 实战11：好久没写 todo_write、好久没提醒过——两把尺子都过线才塞一条提醒消息，
  // 跟其他消息一样 push 进 messages 并 record，让它进入这轮请求也进入 Layer A 落盘
  if (shouldRemindTodo(messages)) {
    const reminder = buildTodoReminderMessage()
    messages.push(reminder)
    await record(reminder)
  }

  // ……streamChat 消费、工具执行，沿用实战06-10……
}
```

![主控制流程图：loop.ts 主 for 循环每一轮开口前依次做两次自检——先 shouldAutoCompact（实战09，历史顶到窗口阈值就整段替换），再 shouldRemindTodo（本篇，两把尺子现算）。shouldRemindTodo 内部调用 getTodoReminderTurnCounts 倒着扫当前 messages：找最近一条带 todo_write 工具调用的 assistant 消息记 turnsSinceLastTodoWrite，找最近一条 role:user 且 isMeta 为真的消息记 turnsSinceLastReminder，两者都找到或扫到头就停。两个计数都过各自阈值（10 轮）才返回 true。true 分支：调用 buildTodoReminderMessage——读 todo_write.ts 导出的 getCurrentTodos() 活对象取当前清单内容，拼出带 当前清单内容 段落的文案，包一层 &lt;system-reminder&gt; 标签，包成 role:user、isMeta:true 的消息对象；这条消息像其他消息一样 push 进 messages 并 await record() 落盘（回扣实战10 Layer A）。之后才进入 streamChat 消费这一轮的模型请求。另一条独立支线：todo_write 工具被模型调用时（跟 read_file/write_file/bash 等工具走同一条 runWithGate 执行路径），execute 直接给模块级 currentTodos 赋新值——下一次 buildTodoReminderMessage 读到的就是这份最新内容。](assets/img/实战11-flow.svg)

### 验证：双阈值从 false 翻到 true，提醒文案原样吐出，吐完自己立刻噤声

用一段独立脚本模拟 10 轮 assistant 消息（每轮都调用非 `todo_write` 的工具），逐轮检查 `shouldRemindTodo`：

```
9轮后 shouldRemindTodo = false
10轮后 shouldRemindTodo = true
```

第 9 轮时 `turnsSinceLastTodoWrite` 还只有 9，不到阈值 10；第 10 轮跨过阈值，`true`。接着写一条 todo（`in_progress` 状态）、构造提醒消息：

```json
{
  "role": "user",
  "content": "<system-reminder>\ntodo_write 工具最近没被用过。如果当前任务是多步骤、值得追踪进度的，考虑调用它来记录进展；如果清单已经过时、跟当前工作对不上了，也考虑清理一下。只在确实相关时才用它，这只是个温和的提醒——不相关就忽略。不要向用户提起这条提醒本身。\n\n当前清单内容：\n\n[1. [in_progress] 修复登录bug]\n</system-reminder>",
  "isMeta": true
}
```

把这条消息推进 `messages` 后紧接着再问一次 `shouldRemindTodo`：

```
刚提醒过，紧接着 shouldRemindTodo = false
```

立刻变回 `false`——`turnsSinceLastReminder` 的倒扫在这条消息自己身上就命中了 `role:'user' && isMeta`，不需要再等下一轮真的调用一次 TodoWrite 才消停。这正是折叠点①"两把尺子都要过线"设计要防住的场景：提醒吐出去之后，不会在接下来几轮里被连续重复戳。

![序列图：单条生命线 loop.ts + todoReminder.ts + todo_write.ts + 模型。第①拍主循环进入第 10 轮，shouldAutoCompact 判断历史未到阈值，跳过压缩；第②拍 shouldRemindTodo 被调用，内部 getTodoReminderTurnCounts 倒扫 messages，发现最近一次 todo_write 调用在 10 轮之前、且从未有过 isMeta 提醒消息，两个计数都过线返回 true；第③拍 buildTodoReminderMessage 被调用，内部 getCurrentTodos() 读到 todo_write.ts 模块级活对象里当前的清单内容，拼出文案、包一层 system-reminder 标签，返回 role:user isMeta:true 的消息对象；第④拍这条消息被 push 进 messages 并 await record 落盘；第⑤拍这一轮的 streamChat 请求携带这条提醒一起发给模型，模型读到后主动调用 todo_write 工具更新清单（不向用户提起这条提醒本身）；第⑥拍 todo_write 的 execute 把新清单整体写入 currentTodos，覆盖掉旧内容；第⑦拍主循环进入下一轮，shouldRemindTodo 再次被调用，这次倒扫会在很近的位置就找到刚才那次 todo_write 调用，turnsSinceLastTodoWrite 从 0 重新计起，暂时不会再触发提醒。](assets/img/实战11-sequence.svg)

当篇 checkpoint：`git tag harness-ch11-todowrite-reminder`。

---

## 三、🔬 翻开源码

去 `claude-code-rev` 里核对了真实 Claude Code 的 `attachments.ts`/`messages.ts`，核心算法（双阈值常量、倒扫函数）逐字一致，但围绕它的架构复杂得多。

### 1. 真源码有一层我们收掉的中间态：`AttachmentMessage`

我们的 `buildTodoReminderMessage` 直接返回最终能塞进 `messages` 的 `Message` 对象。真源码不是这样一步到位的：`getTodoReminderAttachments` 只产出一个轻量的 `Attachment`（`{ type: 'todo_reminder', content: TodoList, itemCount }`），这个 attachment 先被 `createAttachmentMessage` 包成 `AttachmentMessage`（`{ attachment, type: 'attachment', uuid, timestamp }`），要等到真正组装发给模型的请求时，才由 `messages.ts` 里 `case 'todo_reminder'` 那个分支把它转换成最终的 `wrapMessagesInSystemReminder([createUserMessage({ content, isMeta: true })])`。

这道中间层存在是因为真源码有十几种 attachment 类型（`nested_memory`、`plan_file_reference`、`invoked_skills`、`relevant_memories`、IDE 打开文件……），它们全部先在一处并行收集成统一的 `Attachment[]`，再统一转换成消息——这是一套通用的"收集候选 → 统一转换"两阶段管线。我们只有 `todo_reminder` 这一种提醒，管线只服务一个消费者，中间态不产生任何复用收益，所以直接把"判断该不该提醒"和"组装最终消息"焊在同一个函数里。

### 2. 真源码多两道我们没有的互斥闸门

`getTodoReminderAttachments` 在真正判断双阈值之前，还有两道前置检查：一是这一轮工具清单里根本没有 `TodoWrite` 就直接跳过；二是如果工具清单里存在一个 `SendUserMessage`（代码里叫 `BRIEF_TOOL_NAME`）工具，也直接跳过——注释解释得很直白：当这个工具存在时，它才是模型跟用户沟通的主渠道，TodoWrite 提醒会跟这套"简报"工作流冲突，戳它没有意义（工具本身还留着能用，只是不再被主动提醒）。

我们的 `todo_write` 永远注册在 `allTools` 里，也没有一个跟它竞争"主沟通渠道"地位的工具，所以这两道闸门在我们的工具集里没有对应的触发场景——不是简化掉了判断逻辑，是这两个分支依赖的另一个功能（`SendUserMessage`）我们压根没做。

### 3. `todoKey = agentId ?? sessionId`，真源码的清单按键存在一个字典里

我们的当前清单是一个模块级的扁平数组 `currentTodos`。真源码是 `appState.todos[todoKey]`——一个以 `toolUseContext.agentId ?? getSessionId()` 为键的字典。这是因为真实 Claude Code 一次运行里可能同时存在多个 agent（主 agent + 若干 subagent，各自可能有自己的任务清单），也可能有多个会话共享同一进程状态，用一个键区分"这份清单属于哪个 agent/session"是必需的。

`mini-harness` 目前是单进程单 agent 单会话架构（还没有 subagent，那是实战12 要教的东西），扁平变量就是唯一的"当前状态"，不需要再包一层字典——这正是折叠点⑥选活对象时留下的伏笔，源码印证了它为什么长成字典而不是单值。

### 4. 真源码存在一套几乎逐字复刻的姊妹机制：`task_reminder`

`attachments.ts` 里紧挨着 `getTodoReminderAttachments` 的是 `getTaskReminderAttachments`——一套结构上几乎一模一样的倒扫 + 双阈值判断，只是盯的工具从 `TodoWrite` 换成 `TaskCreate`/`TaskUpdate`（就是这个环境里我自己在用的 `TaskCreate`/`TaskUpdate`/`TaskList` 那一套），共享同一份 `TODO_REMINDER_CONFIG` 阈值。调用处用 `isTodoV2Enabled()` 这个特性开关二选一：开了就只跑 task 版本、关了就只跑 todo 版本，从不同时跑两套。

这是同一个"好久没追踪进度就提醒一下"的模式在产品迭代中长出的 V2 版本，机制上没有新概念，教一遍 `todo_reminder` 完整的双阈值 + 倒扫 + 消息注入闭环，`task_reminder` 不会带来任何新的设计决策，所以这一篇不重复实现它。

### 5. 提醒文案措辞逐句对照，只在标点习惯上做了本地化

对照真源码 `messages.ts` 里 `todo_reminder` 分支的英文原文——"The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. …Make sure that you NEVER mention this reminder to the user"——跟我们的中文文案逐句对得上：`todo_write` 工具最近没被用过 → 建议追踪进度 → 清单过时就清理 → 只在相关时用、温和提醒、不相关就忽略 → 不要向用户提起这条提醒本身。唯一的差别是语言本身的本地化，没有裁剪或新增任何一句判断逻辑。

## 小结

- 双阈值防抖：多久没写、多久没提醒，两把尺子都过线才提醒一次，数值原样照抄源码 `TODO_REMINDER_CONFIG`（折叠点①）。
- todo 条目双文本字段：`content` 祈使式、`activeForm` 进行时，都由模型自己写，harness 不做任何文本变换（折叠点②）。
- 轮数现算不维护活变量：倒扫当前 `messages`，压缩/`--resume` 之后永远算得对（折叠点③）。
- `isMeta` 标记提醒消息，让倒扫能认出"上一次提醒"在哪（折叠点④）。
- 检查摆在跟 `shouldAutoCompact` 同一个位置——都是"每轮开口前的自检"（折叠点⑤）。
- 清单内容例外用活对象存，不现算——"当前是什么"和"过了多久"是两种不同性质的状态（折叠点⑥）。

🔬 源码对照：
- `attachments.ts` `TODO_REMINDER_CONFIG`/`getTodoReminderTurnCounts` — 双阈值常量与倒扫算法逐字一致
- `attachments.ts` `getTodoReminderAttachments` — 我们没做 `Attachment`/`AttachmentMessage` 两阶段中间态，也没有 `TodoWrite`/`SendUserMessage` 互斥闸门
- `messages.ts` `case 'todo_reminder'`/`wrapMessagesInSystemReminder` — 提醒文案与包裹格式逐句对照一致，我们把转换步骤直接内联进 `buildTodoReminderMessage`
- `attachments.ts` `appState.todos[todoKey]`（`todoKey = agentId ?? sessionId`）— 我们用扁平模块变量，因为还没有 subagent/多会话共享状态这道题
- `attachments.ts` `getTaskReminderAttachments`/`isTodoV2Enabled` — 结构几乎复刻的 V2 姊妹机制（`TaskCreate`/`TaskUpdate`），我们没有重复实现

Harness 现在扛得住"任务太长、中途忘了自己在干嘛"——但这份提醒能不能真的生效，前提是模型这一轮还留在同一个 agent 身上。下一篇要拆的是完全不同的一道题：一个任务复杂到该拆给另一个"分身"去干的时候，harness 怎么造出这个分身、又怎么把它的活儿收回来。
