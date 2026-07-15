# 实战12：子agent编排——一个函数递归调自己

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战12）

实战11 收尾时留了一句话：“一个任务复杂到该拆给另一个‘分身’去干的时候，harness 怎么造出这个分身、又怎么把它的活儿收回来。”这一篇就是兑现这句话——阶段C（自主与韧性：实战08 扛请求失败、实战09 扛历史撑爆、实战10 扛进程重启、实战11 扛中途遗忘）到实战11 正式收官，阶段D（高级特性）从这一篇开篇。

概念卷25 早就把这道题的必要性摆明过：上一篇刚把一台 agent 拼出来，“有个念头几乎挡不住——‘这玩意儿这么强，那以后所有任务我都丢给它自己跑不就行了？’”那一篇给出的答案是：不是无脑把一切塞给一台 agent 一路跑到黑，而是在合适的边界上，让一个 agent 派另一个 agent 去干一件事，只要一份任务描述、只要一份汇总结论。这一篇要把这套“派活 + 收活”的机制真正嵌进 harness——而且会发现，它落地下来不是什么新造的架构，只是 `runAgent` 这个函数递归调它自己。

## 一、设计摊开：子agent怎么被派出去，又怎么被收回来

### 折叠点①：子agent睁眼看到的第一眼，该是什么

父agent这场对话已经攒了一堆历史——用户问了什么、read_file 读到了什么、之前几轮工具调用的结果。如果现在要派一个子agent去单独干一件事，它睁眼的第一眼，该看到父agent的全部历史吗？

如果子agent继承父agent完整的历史，它就得先“消化”一遍这些跟它要干的事毫无关系的上下文——父agent问过的别的问题、读过的别的文件，这些东西不会帮它把新任务干得更好，只会占掉它自己那一份上下文窗口，甚至可能把它的注意力带偏到父agent原来在忙的事情上。子agent真正需要的，只是“这次要它干什么”这一件事本身，外加干这件事所需要的全部背景——如果父agent知道某个文件路径、某个约束条件，那就得在任务描述里显式写清楚，而不是指望子agent能翻到父agent的历史里自己找。

所以子agent的起始上下文是隔离的：只有一份显式打包好的任务描述，不是父agent的完整对话历史。这也倒逼了一个约束——父agent派活时，必须把子agent完成任务所需的全部上下文都写进任务描述里，因为子agent看不到别的任何东西。

### 折叠点②：这件事该怎么接进现有工具体系

`runAgent` 已经是一个完整的“喂一句话进去、跑几圈工具调用、吐一个答案出来”的函数——这正好是折叠点①要的“子agent只看到任务描述、干完吐一个结论”这套行为。那么“派一个子agent”这件事，要不要单独造一套跟现有工具体系平行的新机制？

如果 harness 里“调用一个工具”已经有一条现成的路子——声明 `name`/`description`/`parameters`/`execute`，注册进工具清单，模型看得到就会调——那“派子agent”完全可以复用这条路：新增一个叫 `task` 的工具，它的 `execute` 什么都不用重新发明，直接 `await` 调用 `runAgent` 本身，把参数里的任务描述当作新的 `userInput` 传进去。对模型来说，“调用 task 工具”和“调用 read_file 工具”长得一模一样，都是发一个工具调用、等一个字符串结果；只是 `task` 这个工具的 `execute` 内部，偷偷又完整跑了一场新的 agent 循环。

### 折叠点③：子agent自己手上能用的工具，要不要跟父agent完全一样

子agent执行任务时，它自己会不会又想调用 `task` 工具，再派一个孙子agent？如果子agent的工具集跟父agent一模一样，这件事技术上是允许的——那如果子agent真的又派了一个孙子agent，孙子agent的工具集是不是又跟子agent一样，于是它又能派一个曾孙agent……这条链什么时候才会停？

除非中途有别的护栏（比如 `maxTurns`）先把整条调用链炸断，否则这是一条没有自然终点的递归。既然折叠点②已经把“派子agent”实现成“递归调用 `runAgent` 自己”，那要掐断这条无限递归，最直接的办法就是让子agent的工具集里没有 `task` 这一项——子agent能用父agent能用的其他工具（读写文件、跑 shell、记 todo），唯独不能再派下一层子agent。

### 折叠点④：一轮里如果同时派了好几个子agent，该怎么等它们跑完

现在模型可以一次性发出好几个 `task` 调用——比如“派三个子agent分别去查三件事，汇总给我”。原来 loop 里执行一轮工具调用是一个个排队做的（一个 `for` 循环，做完一个再做下一个）。如果 `task` 调用还是排队执行，会发生什么？

`task` 的 `execute` 内部是完整跑一场新的 agent 对话——可能要好几轮模型请求才能收工。如果三个 `task` 调用排队执行，那“派三个子agent并行查”会退化成“依次等三个子agent各自跑完”，跟直接自己顺序查三件事相比，除了多了三层调用开销，没有任何加速。真正的“并行”需要执行本身就是并发的——把这一轮的所有工具调用（不只是 `task`，是这一轮出现的任何工具调用）一起发起、一起等待，而不是一个个等前一个做完才发起下一个。

这个改动不需要只针对 `task` 特殊处理：只要把原来“一个个执行”的循环，换成“全部一起发起、一起等结果”，`task` 调用自然就获得了并发能力，其他工具调用也顺带获得了同样的能力（虽然它们原本大多很快，这次改动对它们的实际耗时没什么影响，但机制上是统一的，不需要为 `task` 单开一条特殊路径）。

### 折叠点⑤：子agent的“权限闸门”和“持久化”这两件事怎么办

父agent这场对话有一套权限闸门（危险操作要问人）和一套落盘机制（cwd/sessionId 齐了就把每条消息写进磁盘，好支持 `--resume`）。子agent这次执行，要不要也单独有一套？

先看权限闸门：子agent执行的每一个工具调用，本质上还是“这次运行”里发生的一次操作——用户已经对这次运行整体做过一次授权决策（比如允许 bash、允许写文件），子agent不是一个来路不明的外部程序，是父agent在同一次运行里派出去干活的一部分，没有理由让它绕开或者重新走一遍权限确认。所以子agent直接沿用父agent这次运行时传下来的同一套闸门开关。

再看持久化：Layer A（跨进程续传）解决的是“关掉重开还能接着聊”这件事——这要求有一个稳定的 `sessionId` 作为落盘的锚点。子agent这次执行不是一场独立的、用户可能会想 `--resume` 回来的对话，它是父agent这一轮工具调用里的一个内部实现细节，执行完就该收工、把结果交回去。所以子agent不接 `cwd`/`sessionId`，不参与 Layer A 落盘——这不是漏掉了什么，是这道题在子agent身上本来就不成立。

### 折叠点⑥：子agent跑完之后，那个字符串结果该怎么塞回父agent的对话里

子agent执行完，`runAgent` 递归调用最终会返回一个字符串（跟父agent一次普通对话跑完之后返回的东西是同一种类型）。这个字符串该怎么进入父agent接下来能看到的对话历史？

`task` 从模型的视角看，从头到尾都只是“一次工具调用”——模型发起调用时不知道、也不需要知道背后是又跑了一整场对话；它只关心结果。既然如此，`task` 执行完的返回值，走的就该是跟其他任何工具执行完一模一样的收口：包成一条 `{role:'tool', toolCallId, content}` 消息，推进父agent的 `messages`。`loop.ts` 不需要为 `task` 的返回值写任何特殊分支——子agent内部再怎么复杂，冒出到父agent这一层时，就是普通的一条工具结果。

### 折叠点⑦：`task` 工具的 `execute` 要调用 `runAgent`，但它需要 `provider`——这个值从哪儿进来

`execute` 的函数签名固定是 `(args: any) => Promise<string>`——工具被模型调用时，模型只会传 `args`（比如 `{task: "..."}`），不会额外传 `provider`。但 `execute` 内部要 `runAgent(provider, ...)`，`provider` 从哪儿来？

这跟“一个中间件函数要用到某个只有启动时才知道的密钥”是同一类问题——比如一个鉴权中间件本身的函数签名是 `(req, res, next) => void`，固定死了，没法多塞一个参数进去，但中间件内部又需要一个 `secretKey` 才能验证 token。这类问题的标准解法是工厂函数：不直接导出中间件本身，而是导出一个“造中间件”的函数，比如 `createAuthMiddleware(secretKey)`——调用它、把 `secretKey` 传进去，它返回的才是那个签名固定的 `(req, res, next) => void` 函数，`secretKey` 通过闭包被这个返回的函数一直记住。

`task.ts` 用的是同一招：不直接导出一个 `Tool` 对象，而是导出 `createTaskTool(provider, gate)`——调用它，传入这次运行用的 `provider`（还有决定要不要走权限闸门的 `gate`），它返回的才是真正签名固定的 `Tool` 对象；`execute` 内部要用的 `provider`/`gate`，通过闭包被永久记住，不需要模型帮忙传。

### 折叠点⑧：`tools/index.ts` 里那份工具清单，会不会也被这个改动波及

`tools/index.ts` 里原来有一份写死的数组 `allTools`，里面直接列着所有工具对象。现在其中一个工具（`task`）不再是一个可以直接写进数组的现成对象，而是要先调用 `createTaskTool(provider, gate)` 才能拿到——这份清单还能继续是一个写死的常量数组吗？

这份清单要凑齐 `task` 这一项，就必须先有 `provider`/`gate`，而这两者只有在 `index.ts` 造出 `provider` 之后才存在。既然清单里有一项依赖运行时才有的值，整份清单就没法在模块加载时就是一个现成的常量数组了——它也得变成一个函数：`createAllTools(provider, gate)`，内部调用 `createTaskTool(provider, gate)` 拼进其他几个照常写死的工具，一起返回。调用方（`index.ts`）也得跟着改一行：从 `import { allTools }` 直接用，变成先造好 `provider`，再 `createAllTools(provider, true)` 换来这一次运行真正要用的工具数组。一个工具变成工厂函数，直接把它所在的整份清单也带成了工厂函数。

![骨架定位图：新增 src/tools/task.ts，导出工厂函数 createTaskTool(provider, gate): Tool——execute 内部 await runAgent(provider, subagentTools, args.task, 10, gate)，subagentTools 是直接从五个基础工具模块（read_file/write_file/edit_file/list_dir/bash/todo_write）导入拼成的独立数组，不经过 tools/index.ts，避免循环引用。tools/index.ts 的 allTools 常量数组改造成工厂函数 createAllTools(provider, gate): Tool[]，内部调用 createTaskTool(provider, gate) 拼进其余六个工具。index.ts 调用点从 import { allTools } 改成先 const provider = makeProvider()，再 createAllTools(provider, true)。loop.ts 的执行分支从 for 循环改成 Promise.all(toolCalls.map(...))，results 数组保留原始顺序后再依次 push 进 messages。底部灰色虚线框：runAgent 函数体本身、权限闸门 runWithGate、streamChat 消费、压缩、todo 提醒、Layer A 落盘全部沿用实战02-11，一个字没改——子agent复用的正是这同一个函数。](assets/img/实战12-skeleton.svg)

---

## 二、代码落地

改动清单：新增 `src/tools/task.ts`（工厂函数 `createTaskTool`，闭包住 `provider`/`gate`，内部递归调用 `runAgent`，子agent工具集另起一份不含 `task` 自己的 `subagentTools`）；`tools/index.ts` 的 `allTools` 常量数组改造成工厂函数 `createAllTools`；`index.ts` 调用点跟着从静态 import 改成先造 `provider` 再调用工厂函数；`loop.ts` 主循环里工具执行从排队 `for` 循环改成 `Promise.all` 并发。

### `src/tools/task.ts`：新增工具，工厂函数闭包住 `provider`/`gate`

```typescript
import type { Tool, ModelProvider } from '../types'
import { runAgent } from '../loop'
import { readFileTool } from './read_file'
import { writeFileTool } from './write_file'
import { editFileTool } from './edit_file'
import { listDirTool } from './list_dir'
import { bashTool } from './bash'
import { todoWriteTool } from './todo_write'

// 直接拼六个基础工具模块，不从 tools/index.ts 的 createAllTools 里过滤 task——
// 那样会形成 tools/index.ts → task.ts → tools/index.ts 的循环引用（折叠点③）
const subagentTools: Tool[] = [readFileTool, writeFileTool, editFileTool, listDirTool, bashTool, todoWriteTool]

export function createTaskTool(provider: ModelProvider, gate: boolean): Tool {
  return {
    name: 'task',
    description:
      '派一个独立的子agent去执行一项任务。子agent只看到这次给它的任务描述，看不到当前对话的历史，' +
      '所以任务描述要包含它完成任务所需的全部上下文。适合可以独立展开调查、只需要一份汇总结论的工作，' +
      '比如并行查多件事再汇总。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '交给子agent的任务描述（需自包含全部上下文）' },
      },
      required: ['task'],
    },
    execute: async (args: { task?: string }) => {
      const task = args?.task
      if (!task) return 'error: 缺少 task 参数'
      // 子agent不接 cwd/sessionId，不参与 Layer A（折叠点⑤）；gate 沿用父agent这次运行的同一套闸门
      return runAgent(provider, subagentTools, task, 10, gate)
    },
  }
}
```

### `tools/index.ts`：常量数组改造成工厂函数

```typescript
import type { Tool, ModelProvider } from '../types'
import { readFileTool } from './read_file'
import { writeFileTool } from './write_file'
import { editFileTool } from './edit_file'
import { listDirTool } from './list_dir'
import { bashTool } from './bash'
import { todoWriteTool } from './todo_write'
import { createTaskTool } from './task'

// task 工具要闭包住 provider/gate（折叠点⑦：工厂函数模式），这两者只有 index.ts
// 拿到运行时的 provider 之后才有——整份清单也只能等到那一刻才组装完（折叠点⑧）
export function createAllTools(provider: ModelProvider, gate: boolean): Tool[] {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirTool,
    bashTool,
    todoWriteTool,
    createTaskTool(provider, gate),
  ]
}
```

### `index.ts`：调用点跟着改

```typescript
// 工具清单不再是静态 import：先造好 provider，再用它组装这次运行真正要用的工具数组
const provider = makeProvider()
const tools = createAllTools(provider, true)
```

### `loop.ts`：工具执行从排队改成并发

```typescript
// 实战12：并发执行每个工具调用（回扣折叠点④：task 工具内部会另起一整场子agent对话，
// 顺序执行会让"并行查3件事"退化成排队查3件事）。Promise.all 保证结果数组顺序跟 toolCalls
// 一致——尽管执行本身是并发的，push/record 进 messages 的顺序仍然是发起时的顺序，不受
// 谁先跑完影响。
const results = await Promise.all(
  toolCalls.map(async call => {
    const tool = toolByName.get(call.name)
    const result = tool
      ? await runWithGate(tool, call.args, session, gate)
      : `error: 未知工具 ${call.name}`
    return { call, result }
  }),
)
for (const { call, result } of results) {
  const preview = result.slice(0, 60).replace(/\s+/g, ' ')
  console.log(`  [turn ${turn}] ${call.name}(${JSON.stringify(call.args)}) -> ${preview}…`)
  const toolTurn: Message = { role: 'tool', toolCallId: call.id, content: result }
  messages.push(toolTurn)
  await record(toolTurn)
}
```

`runWithGate` 本身一个字没改——`task` 走的还是跟 `read_file`/`bash` 一模一样的闸门收口，`ask` 时一样会弹出确认提示（折叠点②：`task` 只是又一个工具，没有任何特殊路径）。

![主控制流程图：loop.ts 主循环这一轮从 streamChat 收到若干 toolCalls（其中可能有多个 task 调用）之后，不再用 for 循环排队跑，而是 toolCalls.map 拼出一组 Promise，交给 Promise.all 一起发起。每个 Promise 内部先查 toolByName 找到对应工具，调用 runWithGate 走权限闸门（deny 直接回错、ask 弹出确认、allow 直接执行），工具是 task 时 runWithGate 最终调用 createTaskTool 闭包住的 execute，execute 内部 await runAgent(provider, subagentTools, task, 10, gate) 递归发起一场完整的子agent对话——子agent自己内部再走一遍 streamChat 消费/工具执行/闸门确认的完整循环，直到吐出一个字符串结果。Promise.all 等所有工具调用（含所有子agent）都跑完，按 toolCalls 原始顺序把 {call, result} 数组交还，主循环依次把每条结果包成 role:tool 消息 push 进 messages 并 record 落盘——发起是并发的，写回顺序仍然确定。](assets/img/实战12-flow.svg)

### 验证：派三个子agent真的并发跑，日志证明谁先谁后完全不按发起顺序

给出的问题：“派三个子agent并行执行：子agent1读package.json告诉我项目名字；子agent2执行bash命令pwd告诉我当前目录；子agent3列出当前目录下的文件个数。汇总三条结果给我。”这一轮模型会一口气发出三个 `task` 调用，每个 `task` 内部各自再触发一次权限确认（外层 `task` 要问一次，子agent里的 `bash`/`read_file`/`list_dir` 各自还要再问一次），提前用 `printf` 管道喂足 8 个 `a`（本会话总是允许）应对这些确认：

```
[provider] anthropic
[session]  ad19fc86-c549-4851-a8e2-a8a8f5ea17e6
[you]      派三个子agent并行执行：子agent1读package.json告诉我项目名字；子agent2执行bash命令pwd告诉我当前目录；子agent3列出当前目录下的文件个数。汇总三条结果给我。

[assistant] [mini-harness] 我已看到系统提示中给出的 git 分支（main）和未提交改动快照……

⛔ 需要授权：task 将改动 文件系统
   [y] 允许一次   [a] 本会话总是允许   [其它] 拒绝 >  
⛔ 需要授权：task 将改动 文件系统
   [y] 允许一次   [a] 本会话总是允许   [其它] 拒绝 >  
⛔ 需要授权：task 将改动 文件系统
   [y] 允许一次   [a] 本会话总是允许   [其它] 拒绝 >  
[assistant] 
[assistant] 
[assistant] 

⛔ 需要授权：将执行 shell 命令：pwd
   [y] 允许一次   [a] 本会话总是允许   [其它] 拒绝 >    [turn 1] bash({"command":"pwd"}) -> /Users/weifengzhu/work/ai/big-model-learning/code/harness…

  [turn 1] read_file({"path":"package.json"}) -> { "name": "mini-harness", "version": "0.1.0", "descrip…

  [turn 1] list_dir({"path":"."}) -> .env .env.example .gitignore CLAUDE.md bun.lock compact-test…
mini-harness
当前工作目录路径为：

```
/Users/weifengzhu/work/ai/big-model-learning/code/harness
```
当前目录（.）下共有 **14** 个条目，具体如下：

- **文件（11个）**：.env、.env.example、.gitignore、CLAUDE.md、bun.lock、compact-test.ts、context-diff-test.ts、gate-test.ts、package.json、retry-test.ts、tsconfig.json
- **文件夹（3个）**：node_modules/、spike/、src/

**总计：14 个条目（11 个文件 + 3 个文件夹）**
  [turn 1] task({"task":"读取当前目录下的 package.json 文件……"}) -> mini-harness…
  [turn 1] task({"task":"执行 bash 命令 `pwd`……"}) -> 当前工作目录路径为： ``` /Users/weifengzhu/work/ai/big-model-learning…
  [turn 1] task({"task":"列出当前目录（.）下的所有条目……"}) -> 当前目录（.）下共有 **14** 个条目……
三条汇总结果：

1. **项目名字**：`mini-harness`（来自 package.json 的 name 字段）
2. **当前目录**：`/Users/weifengzhu/work/ai/big-model-learning/code/harness`
3. **文件个数**：当前目录下共 14 个条目，其中 11 个文件、3 个文件夹（node_modules/、spike/、src/）
```

最值得盯的一处细节：三个子agent各自内部的单条工具调用日志（`bash`、`read_file`、`list_dir`）先后交错打印出来，而且**先于**三条最外层 `task(...)` 汇总日志出现——`bash` 那个子agent执行得最快，它的结果最先落定，但外层 `for (const {call, result} of results)` 是等 `Promise.all` 三个都跑完才按“发起时的顺序”（子agent1、2、3）依次打印。如果是排队执行，三个子agent的内部日志会整段整段分开出现，不会像这样交叉穿插；交叉穿插正是三场子agent对话真的在同一时刻并发进行的直接证据。

（另外两次尝试的日志留作反面对照，不进这篇正文：一次是没通过 stdin 喂任何输入，三个 `task` 调用因为拿不到确认全被判定拒绝；另一次是外层三个 `task` 都批准了，但某个子agent内部嵌套的 `bash` 调用没被单独批准而被拒绝，还意外暴露了一个真实的小 bug——某次汇总里子agent自己说“12”个条目，随后又列出了 14 项，数字和列表对不上，这是模型自己的统计失误，不是 harness 的问题，但也说明子agent的输出不会因为“是子agent说的”就天然更可靠，父agent汇总时同样可能需要核实。）

![序列图：主生命线 loop.ts + task.ts(agent1/2/3各一份独立执行) + 模型。第①拍主循环这一轮从 streamChat 收到三个 task 工具调用；第②拍 loop.ts 用 Promise.all 同时对三个调用发起 runWithGate，三条子agent对话从这一刻起并发展开；第③拍子agent1内部循环调用 read_file 读 package.json，走权限确认后拿到结果，很快吐出"mini-harness"收工；第④拍子agent2内部循环调用 bash 执行 pwd，走权限确认后拿到当前目录路径，吐出结果收工；第⑤拍子agent3内部循环调用 list_dir 列出条目、自己数出14个（11文件+3文件夹），吐出结果收工——三条子agent对话完成的先后顺序不确定，取决于各自实际耗时，图中示意子agent1/2最先完成、子agent3稍后；第⑥拍 Promise.all 等三个 Promise 全部结束，按原始发起顺序（子agent1、2、3）把三条 {call, result} 依次包成 role:tool 消息 push 进父agent的 messages 并 record 落盘；第⑦拍父agent这一轮的 streamChat 请求带着三条工具结果发给模型，模型读到后组织成一段汇总文字，直接吐给用户。](assets/img/实战12-sequence.svg)

当篇 checkpoint：`git tag harness-ch12-subagent-orchestration`。

---

## 三、🔬 翻开源码

去 `claude-code-rev` 里核对了真实 Claude Code 的子agent派工系统——`src/tools/AgentTool/AgentTool.tsx`（1397 行）、`runAgent.ts`（973 行）、`agentToolUtils.ts`（686 行），加起来三千多行，而我们的 `task.ts` 只有四十来行。差距不是因为我们“漏做了什么细节”，是因为真源码要覆盖的场景比这一篇设定的范围大得多。

### 1. `agentId` 和 `sessionId` 是两个不同的东西，我们的子agent只用得上后者

`runAgent.ts` 里每次派子agent都会 `createAgentId()` 造一个全新的 `agentId`（第347行）——子agent自己有一个独立的身份。但它的转录落盘路径不靠这个身份串起父子关系，而是 `sessionStorage.ts` 里 `getAgentTranscriptPath` 内部直接再调一次 `getSessionId()`（一个进程内的全局取值，没有把 `sessionId` 当参数一路传下来），拼成 `<projectDir>/<sessionId>/subagents/.../agent-<agentId>.jsonl`——不管这次调用是最外层父agent发起的，还是子agent自己内部又派了一个孙子agent，落盘用的永远是同一个 ambient `sessionId`。这跟折叠点⑤定的“子agent不接 `cwd`/`sessionId`，不参与 Layer A”形成一个有意思的对照：真源码的子agent确实**不**拥有自己独立的 `sessionId`（它落盘时用的是外层那一个），但它也不是完全裸的——它有一个自己的 `agentId`，用来在磁盘上把自己的转录单独存一份。我们的子agent因为压根不落盘，这两个身份都不需要。

### 2. 真源码会把子agent的对话记下来，我们的子agent跑完就地蒸发

`runAgent.ts` 第735/738/794行调用 `recordSidechainTranscript(initialMessages, agentId)` 和 `writeAgentMetadata(agentId, {...})`——`src/utils/sessionStorage.ts` 里 `getAgentTranscriptPath`（第247-257行）把路径拼成 `<projectDir>/<sessionId>/subagents/.../agent-<agentId>.jsonl`，`getAgentMetadataPath`（第260-261行）在旁边存一份 `.meta.json` 副本。`writeAgentMetadata` 的文档注释说得很直白：不存这份元数据，将来想恢复某个子agent的执行现场时，会因为找不到它当初用的 `agentType` 而静默退化成通用型子agent（默认4KB系统提示词，也接不上原来的历史）。

我们的 `task.ts` 里子agent跑完只留下一个返回字符串，父agent那次运行结束后，子agent执行过程中的每一步都没有任何痕迹——这是折叠点⑤明确划定的范围：这一章只做“同步、跑完即收”的子agent，不做“子agent自己也能被恢复/审查”这道题。

### 3. 反递归：真源码是一个运行时开关，不是我们这种“工具表里直接不放”

折叠点③里我们靠“子agent的工具集里没有 `task` 这一项”防住无限递归，这是一个静态的、在工具清单层面就锁死的解法。真源码不是这么做的——`AgentTool.tsx` 里有一种叫“fork”的子agent模式，它的卖点恰恰是**共享父agent的完整工具集**（含 `Task` 工具本身），代码里靠 `toolUseContext.options.querySource === 'agent:builtin:fork'` 这个运行时标记去做别的控制（大意是：只有通过这个特定入口发起的调用才被允许拿到这份“连 Task 都在内”的完整工具集），而不是从工具表里物理拿掉。

这个差异值得诚实标注：我们只有一套扁平的工具集，用“拿掉 `task`”这一种简单粗暴的方式就能防住递归；真源码有 `agentDefinitions`/`subagent_type` 这一整套“不同类型子agent可以有不同工具配置”的系统，某些类型（比如 fork）本来就该拿到完整工具集（含递归调用自己的能力），于是防递归就不能再是静态地从数组里删一项，得挪到运行时按场景判断。

### 4. `AgentTool.tsx` 又拉出一整套按类型/按MCP过滤的子agent命名系统

`AgentTool.tsx` 顶部就在 import `filterDeniedAgents`、`getDenyRuleForAgent`、`filterAgentsByMcpRequirements`、`isBuiltInAgent`，运行时还会用到 `toolUseContext.options.agentDefinitions`（这一份是从调用上下文里取的，不是模块顶部 import 进来的）——真实 Claude Code 支持很多个具名的子agent类型（这个环境里能看到的 `code-reviewer`、`security-reviewer`、`tdd-guide` 之类都是这套系统的实例），每个类型有自己的系统提示词、工具白名单，还能按 MCP 依赖过滤、按用户配置的 deny 规则整体屏蔽某个类型。我们的 `task` 工具只有一种“子agent”，工具集固定成 `subagentTools` 这一份数组，没有任何按名字/按能力挑选的空间——这一章刻意只解决“派一个通用子agent、干一件独立的事”这个最小可用版本，命名/分类/MCP过滤是完全没碰的另一层复杂度。

### 5. 并发不是“见到工具调用就一律 `Promise.all`”，是逐个工具自己声明能不能并发

折叠点④我们把整轮工具执行从排队改成 `Promise.all`——这一步的方向是对的：`src/services/tools/toolOrchestration.ts` 里 `AgentTool.tsx` 第1273-1275行 `isConcurrencySafe() { return true }`，真实的 Task 工具确实被标记为“可以并发”。但真源码的并发不是无差别地把整轮所有工具调用都塞进一个 `Promise.all`——`runTools()` 会先用 `partitionToolCalls` 把这一轮的工具调用切成若干个 `Batch`：连续几个各自都标记为 `isConcurrencySafe` 的调用合并成一批走 `runToolsConcurrently`，只要出现一个不安全的调用，它自己单独成一批、走 `runToolsSerially`，前后相邻的并发批次也会被这一个不安全调用截断。`Tool.ts` 里默认的兜底实现（第750/759行）`isConcurrencySafe` 返回 `false`——不显式声明安全的工具，默认按不安全处理。并发上限还受 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 环境变量控制（`getMaxToolUseConcurrency()`，未设置时默认 `10`）。

我们的 `Promise.all` 是无差别地套在这一轮出现的**任何**工具调用组合上——如果模型这一轮同时发起了两个 `write_file` 调用，我们也会把它们一起并发跑，而真源码里没声明安全的工具默认会被强制串行。这是一处明确的简化：我们只有 `task` 这一个真正需要并发才有意义的工具，其余几个工具（读写文件、跑 shell）本身耗时很短，无差别并发在这一章的场景下不会带来实际的正确性问题，但如果工具集将来长出更多有副作用、顺序敏感的工具，这个“一律并发”的简化就需要收紧成真源码那种“逐工具自报安全性、有一个不安全就整批降级串行”的模型。

## 小结

- 子agent起始上下文隔离：只给一份自包含的任务描述，不给父agent的完整历史（折叠点①）。
- 派子agent就是新增一个 `task` 工具，`execute` 内部直接递归调用 `runAgent` 自己（折叠点②）。
- 子agent工具集另起一份不含 `task` 的 `subagentTools`，静态防住无限递归（折叠点③）。
- 一轮内所有工具调用（含多个 `task`）从排队改成 `Promise.all`，结果顺序仍按发起顺序落盘（折叠点④）。
- 子agent沿用父agent这次运行的同一套权限闸门；不接 `cwd`/`sessionId`，不参与 Layer A（折叠点⑤）。
- `task` 的返回值走跟其他工具一模一样的收口，包成 `role:'tool'` 消息，`loop.ts` 不需要特殊分支（折叠点⑥）。
- `task.ts` 用工厂函数 `createTaskTool(provider, gate)` 闭包住运行时才有的值，类比鉴权中间件闭包住密钥（折叠点⑦）。
- 一个工具变工厂函数，牵连整份工具清单也变成 `createAllTools(provider, gate)`（折叠点⑧）。

🔬 源码对照：
- `runAgent.ts` `createAgentId()`/`getSessionId()` — 子agent有独立 `agentId`，但落盘沿用父agent的 `sessionId`；我们的子agent两者都不需要
- `sessionStorage.ts` `recordSidechainTranscript`/`writeAgentMetadata` — 真源码会把子agent转录和元数据落盘、支持恢复；我们的子agent跑完就地蒸发
- `AgentTool.tsx` `querySource === 'agent:builtin:fork'` — 反递归是运行时按场景判断，我们是静态从工具表里拿掉
- `AgentTool.tsx` `agentDefinitions`/`filterAgentsByMcpRequirements`/`filterDeniedAgents` — 一整套具名子agent类型 + MCP过滤 + deny规则系统，我们只有一种扁平子agent
- `toolOrchestration.ts` `partitionToolCalls`/`isConcurrencySafe`/`getMaxToolUseConcurrency` — 逐工具自报安全性、选择性分批并发，我们对整轮任意工具组合无差别 `Promise.all`

`task` 工具让 harness 第一次拥有了“把一件事拆出去”的能力，但现在这次派工是同步的——父agent发起之后原地等着，直到子agent跑完才能继续往下走。下一篇要拆的是这道等待本身：如果子agent要跑的事情很长，或者父agent想一边等一边干别的，这次“派活”还能不能不再是一次阻塞式的函数调用。
