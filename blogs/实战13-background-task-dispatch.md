# 实战13：子agent转后台——一个参数，把"调用就得等"变成"愿等才等"

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战13）

实战12 收尾时留了一句话："`task` 工具让 harness 第一次拥有了'把一件事拆出去'的能力，但现在这次派工是同步的——父agent发起之后原地等着，直到子agent跑完才能继续往下走。"这一篇要拆的就是这道等待本身：如果子agent要跑的事情比较长，父agent能不能不再被这一次调用原地摁住，先去干别的事，等子agent真跑完了再被提醒一声。

答案不是把 `task` 整体改成"发了就不管"，而是给它加一个选项——默认还是原来的样子，只有显式要求才会不等。这一篇会发现，"不等"这件事本身不需要什么新架构：一张记完工结果的表、一次每轮开工前的顺手检查，就够了。

## 一、设计摊开：从"必须等"到"愿等才等"

### 折叠点①：新加的这个参数，默认值该怎么定

实战12 里 `task` 只有一种脾气：调用一次，原地等它跑完再拿结果。现在要给它加一个"不等"的选项——但这个新参数不传的时候，`task` 该继续老样子阻塞，还是从这一刻起默认就不阻塞？

想想 shell：跑一条 `npm run build`，默认是前台执行，命令没跑完终端就一直卡在那儿；只有显式在命令后面加一个 `&`，它才会被丢到后台、终端立刻还给你。没有人会觉得"默认后台执行，想要阻塞才需要显式声明"更符合直觉——大多数时候你确实想等这条命令跑完再往下走，"不等"是少数情况，需要主动说出来。

同样的默认值选择也适用于 `task`：调用它的绝大多数场合——比如"帮我读几个文件汇总一下"——你确实想要一个马上能用的结果，阻塞是符合直觉的默认行为；只有任务明显耗时较长、或者你想先干别的事情时，"不等"才值得被显式声明。于是新参数 `background` 不传（或传 `false`）就是实战12 的老样子，只有显式 `true` 才切到新逻辑——跟 shell 命令的 `&` 是同一个默认值设计。

### 折叠点②：不等的这一次调用，`execute` 立刻返回什么，真正的结果去哪儿了

`task` 的 `execute` 签名固定是 `(args) => Promise<string>`——工具调用必须有一个返回值，模型才知道这次调用"发生过"。如果 `background:true` 时不等 `runAgent` 跑完就要返回，那这一次 `execute` 立刻返回的是什么？总不能是空字符串，或者是子agent还没算出来的最终答案。

唯一说得通的答案是：这次返回值只是一句"已经提交、正在跑"的确认，不是任务的最终结果。但这就带出一个新问题——`runAgent(...)` 真正跑完之后吐出的那个字符串结果，如果没人在等它，它冒出来的时候要往哪儿放？总得有个地方能接住它，让"以后某个时刻"有办法读到它。

这跟一个后台 worker 处理完一个任务后该怎么办是同一类问题：worker 自己不知道谁在等结果、什么时候会来查，它能做的只是把结果写进一个大家都够得到的地方——一张表、一个队列——写完就收工，谁来读、什么时候读，是读者自己的事。`task` 的后台分支也是这个思路：`runAgent(...).then(result => 登记表.set(id, result))`，发起时不 `await`，跑完之后靠 `.then` 把结果写进一张登记表，`execute` 自己早就已经带着"已提交"的确认返回了。

### 折叠点③：模型怎么才能知道结果——还走 tool-result 这条路吗

其他工具调用完，结果都是包成一条跟这次调用 `toolCallId` 绑定的 `{role:'tool', toolCallId, content}` 消息塞回历史。后台任务真正跑完时，它对应的那次 `task` 调用早就已经拿到过一次 `execute` 返回值（那句"已提交"）——一次工具调用只对应一次工具结果，这个位置已经被占用了，不能等任务跑完再补发第二条 tool 消息挂在同一个 `toolCallId` 上。

那结果要怎么让模型看到？实战11 已经解决过一个很像的问题：`todo` 太久没写、提醒该怎么塞进对话——答案不是伪装成一条工具结果，是在合适的时机主动插进一条 `role:'user'`、`isMeta:true` 的 `<system-reminder>` 消息，模型自然会读到它，却不需要专门"调用什么"才能收到。后台任务的完工通知，走的是同一条路：不占用任何 `toolCallId`，是一条独立插进历史的提醒消息，模型下一次开口前会先看到它。

### 折叠点④：这张登记表该放在哪儿

登记表要被两处代码用到：`task` 的 `execute`（后台任务跑完时把结果写进去）、还有某个新函数（把写好的结果取出来、拼成提醒消息）。这两处代码不是同一次函数调用触发的——写入发生在子agent真正跑完的那一刻（可能是好几秒甚至更久之后），读取发生在下一次循环开工前——两者之间除了这张表，没有别的桥能把"写完的东西"传给"要读的人"。

`createTaskTool(provider, gate)` 这个工厂函数每次调用都会返回一个新的 `Tool` 对象，但登记表不能是工厂函数内部的局部变量——如果它声明在 `createTaskTool` 内部，那"写"的一方是这次调用返回的 `execute`，但"读"的一方（`loop.ts` 里要调用的读取函数）压根拿不到这个闭包变量，除非把它也从 `createTaskTool` 里导出来，这样反而绕远了。登记表得是模块级的单例——声明在 `createTaskTool` 函数体外面，跟这个文件里定义的另一个导出函数共享，两者天然就能看到同一份数据，不需要靠参数传递或者闭包捕获牵线。

### 折叠点⑤：什么时候去查这张登记表

如果查这张表这件事需要模型主动发起——比如再造一个"查询后台任务"的工具，模型得先想起来去调用它——那就变成了轮询：模型要么忘了查，要么隔三差五就去问一次浪费一轮工具调用。有没有办法让模型什么都不用做，后台任务一完工就自然被看到？

实战09 的压缩检查、实战11 的 todo 提醒已经给出了答案：这两件事都不是模型主动触发的，是 loop 自己每一轮开口前先做的一次"自检"——历史顶到阈值了吗？好久没写 todo 了吗？现在要加的这一问，是同一个家族的第三个成员：有没有后台任务在上一轮之后完工了？把这一问放在跟前两者完全相同的位置——每一轮 `streamChat` 真正发起之前——模型不需要知道这次检查存在，结果该出现的时候自然就出现在它的下一轮输入里。

### 折叠点⑥：好几个任务同时完工，要一条条报还是攒起来一次报，会不会重复上报

如果这一轮开工前查登记表，发现里面躺着三个已经完工的任务，是一条条分别插三条提醒消息，还是拼成一条？拼成一条更省事——不需要决定三条消息谁先谁后插进历史，模型一次性看到"以下几个后台任务都跑完了"这句话，跟看到三条孤立的提醒相比信息量是一样的，消息数量却少了。

还有一个更容易被忽略的问题：这一轮读到、报告过的结果，下一轮还会不会再被读到、再报告一次？如果读取函数只是"看一眼"这张表，不做任何清理，那已经报过的完工任务会一轮又一轮反复出现在提醒里——模型第一次看到"任务A完成",第二次、第三次还在看到同一句话，会怀疑是不是又跑出了一个新任务A。这道题的答案是"取走就删"：读取函数把当前这一批完工的条目收集起来的同时，把它们从表里删掉，下一轮再查这张表时，这些条目已经不在了，天然就不会被第二次报告。

### 折叠点⑦：后台任务万一执行失败了怎么办

如果子agent执行到一半抛了异常，`.then(result => 登记表.set(...))` 这条链根本不会被触发——那这次失败要不要单独处理，还是就这么悄悄消失，模型永远不知道它发起过的这个后台任务已经失败了？

`task.ts` 里原本就有处理错误的先例——`if (!task) return 'error: 缺少 task 参数'`——错误不是单独开一个字段，就是一条以 `error:` 开头的普通字符串，跟正常结果走的是同一条路。后台任务的失败也该按这个约定来：`.then` 后面再接一个 `.catch`，把异常信息包成 `error: 子agent后台执行失败——...` 这样一条字符串，写进同一张登记表的同一个位置。读取的那一方完全不需要知道这次是成功还是失败，登记表里存的永远是"一条要给模型看的结果字符串"，模型看到 `error:` 前缀自己判断这次没成。

### 折叠点⑧：登记表里每个任务用什么当 key

登记表要用一个稳定的标识区分"是哪个后台任务完工了"，这个标识（任务ID）从哪儿来？最简单的办法是一个模块级的自增计数器——每次发起一个后台任务就 `bg-1`、`bg-2`、`bg-3` 往上数，跟数据库自增主键是同一个思路：反正只是在这一次运行的内存里当 key 用，够唯一、够简单就行，不需要考虑别的进程会不会撞上同一个 ID。

（这一处刻意选了最简单的方案；真实 Claude Code 的任务 ID 生成要复杂得多，安全动机也不一样——放进下面"翻开源码"细讲。）

![骨架定位图：新增 CompletedBackgroundTask 登记表（模块级 Map&lt;string,string&gt;，声明在 tools/task.ts 里、createTaskTool 工厂函数外面）+ nextBackgroundTaskId 自增计数器。createTaskTool 返回的 Tool.parameters 新增 background:boolean 字段。execute 分叉成两条路：background 不传或 false，原样 await runAgent(...) 走实战12 老路；background:true 时生成 bg-N 任务ID，runAgent(...).then(结果写入登记表).catch(错误以 error: 前缀写入同一张登记表)，execute 立即返回一句"已提交"确认，不等待。task.ts 新增导出函数 drainCompletedBackgroundTasks()：遍历登记表收集所有已完工条目、边收集边从表里删除（防重复上报），多条目拼成一条消息返回，没有条目时返回 null。loop.ts 主循环每轮开口前（跟 shouldAutoCompact/shouldRemindTodo 同一位置）调用 drainCompletedBackgroundTasks()，非 null 时包成跟实战11 todo提醒同款的 role:'user'+isMeta+&lt;system-reminder&gt; 消息 push 进 messages 并 record 落盘。](assets/img/实战13-skeleton.svg)

---

## 二、代码落地

改动清单：`src/tools/task.ts` 新增模块级登记表 `completedBackgroundTasks`、自增计数器 `nextBackgroundTaskId`，工具 schema 新增 `background: boolean` 参数，`execute` 按 `background` 分叉成阻塞/后台两条路，新增导出函数 `drainCompletedBackgroundTasks()`；`loop.ts` 每轮开口前新增一次登记表检查，完工就插一条提醒消息。

### `src/tools/task.ts`：登记表 + 分叉的 `execute` + `drainCompletedBackgroundTasks`

```typescript
// 模块级单例——声明在 createTaskTool 工厂函数外面，execute（写）和
// drainCompletedBackgroundTasks（读）之间唯一的桥（折叠点④）
const completedBackgroundTasks = new Map<string, string>()
let nextBackgroundTaskId = 1

export function createTaskTool(provider: ModelProvider, gate: boolean): Tool {
  return {
    name: 'task',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '交给子agent的任务描述（需自包含全部上下文）' },
        background: {
          type: 'boolean',
          description: '为 true 时不阻塞等待——立即返回提交确认，子agent转到后台执行，跑完再提醒',
        },
      },
      required: ['task'],
    },
    execute: async (args: { task?: string; background?: boolean }) => {
      const task = args?.task
      if (!task) return 'error: 缺少 task 参数'

      // 默认路径：跟实战12 一模一样，原地等它跑完（折叠点①）
      if (!args?.background) {
        return runAgent(provider, subagentTools, task, 10, gate)
      }

      // background:true——发起但不等待（折叠点②）
      const taskId = `bg-${nextBackgroundTaskId++}`
      runAgent(provider, subagentTools, task, 10, gate)
        .then(result => completedBackgroundTasks.set(taskId, result))
        .catch((err: unknown) => {
          // 失败和成功共用同一条登记路径，只是内容换成 error: 前缀（折叠点⑦）
          const message = err instanceof Error ? err.message : String(err)
          completedBackgroundTasks.set(taskId, `error: 子agent后台执行失败——${message}`)
        })

      return `已提交后台任务 ${taskId}，子agent正在执行，完成后会自动提醒你结果。`
    },
  }
}

// loop.ts 每轮开口前调用一次：取走当前已完工的条目（取走=从表里删，防止下一轮重复上报，
// 折叠点⑥），没有任何条目完工时返回 null
export function drainCompletedBackgroundTasks(): string | null {
  const completed: { id: string; result: string }[] = []
  for (const [id, result] of completedBackgroundTasks) {
    completed.push({ id, result })
    completedBackgroundTasks.delete(id)
  }
  if (completed.length === 0) return null

  const body = completed.map(({ id, result }) => `- 任务 ${id} 已完成，结果：\n${result}`).join('\n\n')
  return `以下后台任务已经跑完：\n\n${body}`
}
```

### `loop.ts`：每轮开口前顺手查一眼登记表

```typescript
import { drainCompletedBackgroundTasks } from './tools/task'

// ……跟压缩检查、todo 提醒同一个位置（折叠点⑤）
if (shouldRemindTodo(messages)) {
  const reminder = buildTodoReminderMessage()
  messages.push(reminder)
  await record(reminder)
}

const backgroundReport = drainCompletedBackgroundTasks()
if (backgroundReport) {
  const notice: Message = {
    role: 'user',
    content: `<system-reminder>\n${backgroundReport}\n</system-reminder>`,
    isMeta: true,
  }
  messages.push(notice)
  await record(notice)
}
```

这条通知走的是跟实战11 todo 提醒完全一样的收口——`role:'user'`、`isMeta:true`、`<system-reminder>` 包裹，不占用任何 `toolCallId`（折叠点③）。`loop.ts` 里 `import { drainCompletedBackgroundTasks } from './tools/task'` 和 `task.ts` 里已有的 `import { runAgent } from '../loop'` 会形成一个循环引用——两个方向都只在函数体内部（不是模块顶层）引用对方，ES module 的实时绑定能安全处理这种"互相 import 但不在加载时就互相调用"的情况，`tsc` 类型检查和实际运行都没有报错。

![主控制流程图：loop.ts 每一轮开口前，先后做三次自检——shouldAutoCompact（历史顶到阈值就摘要）、shouldRemindTodo（好久没写就提醒）、drainCompletedBackgroundTasks（有后台任务完工就整批取出并清空登记表）。三者是同一个"每轮开工前自检"家族，位置紧挨着，互不依赖。若 drainCompletedBackgroundTasks 返回非 null，包成 role:'user'+isMeta+&lt;system-reminder&gt; 消息 push 进 messages、record 落盘。随后照常发起 streamChat：模型这一轮如果调用 task 且 background:true，execute 生成 bg-N 任务ID、发起 runAgent(...).then/.catch 但不 await，立即返回"已提交"字符串收口成普通 role:'tool' 消息；runAgent 内部的 provider 请求和工具调用在后台异步进行，跟主循环并发，跑完后 .then/.catch 把结果或 error: 前缀字符串写入模块级登记表，等下一轮循环开口前的自检才被看见、清空、转成提醒消息。](assets/img/实战13-flow.svg)

### 验证：提交后台任务立刻拿到确认，主线程接着干别的，结果在下一轮自动浮现

给出的问题："先用 task 工具派一个后台子agent（传 background:true）：任务是读取当前目录下的 package.json 文件，告诉我这个项目叫什么名字。提交后不要等它，你自己依次单独执行三次 bash 命令：先 pwd，再 date，再 whoami——每次都是单独一次工具调用。做完后如果后台任务的结果已经收到，就一起汇总给我；如果还没收到，就先汇总这三条命令的结果，并告诉我后台任务还在跑。"

```
[assistant] [mini-harness] 先说明：我看到了当前 git 状态快照……

⛔ 需要授权：task 将改动 文件系统
   [AUTO_APPROVE=always]

  [turn 1] task({"task":"读取当前目录……package.json……","background":true})
    -> 已提交后台任务 bg-1，子agent正在执行，完成后会自动提醒你结果。…

  [turn 1] read_file({"path":".../package.json"}) -> { "name": "mini-harness", …
后台任务已提交（bg-1），不等它，接着依次单独执行三条命令。

⛔ 需要授权：将执行 shell 命令：pwd
   [AUTO_APPROVE=always]
  [turn 2] bash({"command":"pwd"}) -> /Users/weifengzhu/.../code/harness…
项目名称是：**mini-harness**

⛔ 需要授权：将执行 shell 命令：date
   [AUTO_APPROVE=always]
  [turn 3] bash({"command":"date"}) -> Wed Jul 15 18:31:58 CST 2026…

⛔ 需要授权：将执行 shell 命令：whoami
   [AUTO_APPROVE=always]
  [turn 4] bash({"command":"whoami"}) -> weifengzhu…
[mini-harness] 三条命令已依次单独执行完毕，后台子agent（bg-1）的结果也已收到，一并汇总如下：

- pwd：`/Users/weifengzhu/big-model-learning/code/harness`
- date：`Wed Jul 15 18:31:58 CST 2026`
- whoami：`weifengzhu`
- 后台任务结果：项目名称是 **mini-harness**（来自 package.json 的 name 字段）
```

最值得盯的两处细节：一是 `task(..., background:true)` 这次调用在 `turn 1` 就立刻返回了"已提交"，父agent完全没有被这次调用拖住，紧接着自己发起了 `pwd`/`date`/`whoami` 三轮独立工具调用；二是终端中间那句"项目名称是：**mini-harness**"，其实不是父agent说的——它是 `bg-1` 那个后台子agent自己内部 `runAgent` 流式输出的最终答案，跟父agent的输出写在同一个 stdout 上，只是恰好在这个时间点冒出来，跟实战12 里"多个子agent内部日志交错打印"是同一种现象。真正体现折叠点⑤生效的证据是最后一段：父agent自己从来没有主动"查询"过 `bg-1` 的结果，`drainCompletedBackgroundTasks()` 在进入下一轮（`turn 5`）、父agent准备做最终总结前那次自检里，发现登记表已经有了 `bg-1` 的结果，插了一条提醒消息——父agent才第一次"知道"这件事，并把它写进了最终汇总。

![序列图：主生命线 loop.ts + task.ts(execute 里的 bg-1 后台调用) + 模型。第①拍父agent发起 task(background:true)，execute 生成 bg-1、发起 runAgent(...).then/.catch 但不 await，立即返回"已提交"字符串；这次工具调用的 tool-result 槽在这一刻就已经收口。第②拍父agent继续这一轮的其余工具调用（read_file 读 package.json，是本轮模型一并请求的，跟 bg-1 并发但走的是正常阻塞路径）。第③拍父agent进入 turn2，drainCompletedBackgroundTasks() 检查登记表——bg-1 还没完工，返回 null，无事发生，照常执行 bash pwd。同时 bg-1 后台的 runAgent 内部完整走一遍流式请求+工具调用+第二轮流式请求，逐步逼近它自己的最终答案。第④拍父agent进入 turn3/turn4，各自查一次登记表，bg-1 仍未完工（假设耗时较长），照常执行 date/whoami。第⑤拍 bg-1 的 runAgent 终于 resolve，.then 把结果字符串写入登记表这一刻，跟父agent的主循环完全不同步——它可能发生在父agent turn2 和 turn3 之间的任意时刻。第⑥拍父agent进入下一轮（假设是 turn5，做最终总结前），drainCompletedBackgroundTasks() 这次查到 bg-1 已完工，取出结果、从登记表删除、包成 role:'user'+isMeta 的 &lt;system-reminder&gt; 消息 push 进 messages。第⑦拍这一轮 streamChat 请求带着提醒消息发给模型，模型读到后把 bg-1 的结果并入最终汇总一并吐给用户。](assets/img/实战13-sequence.svg)

当篇 checkpoint：`git tag harness-ch13-background-task-dispatch`。

---

## 三、🔬 翻开源码

去 `claude-code-rev` 里核对了真实 Claude Code 的后台任务系统——分散在 `src/tools/BashTool/BashTool.tsx`、`src/tools/AgentTool/AgentTool.tsx`、`src/utils/task/framework.ts`、`src/utils/task/TaskOutput.ts`、`src/state/AppState.tsx`、`src/Task.ts` 好几个文件里，比我们这一篇加的四十来行复杂得多——但复杂的方向，恰好印证或者延展了这一篇的每一个折叠点。

### 1. `background` 不是我们发明的维度：Bash 和 Task 工具本身都有这个参数

`BashTool.tsx`（约第241行）的 schema 里有 `run_in_background: z.boolean().optional()`，紧接着还有一整套自动转后台的机制——`ASSISTANT_BLOCKING_BUDGET_MS`/`startBackgrounding`/`spawnBackgroundTask`（约858-999行）：命令跑得太久，即使调用方没显式要求后台执行，也会被系统自动转成后台任务。而 `AgentTool.tsx`（约第87行）本身也有一份一模一样的 `run_in_background: z.boolean().optional()`，外加 agent 定义级别的 `background: true` 标记、`isAsync`/`is_async` 标记——这跟折叠点①的判断吻合：`background` 不是只有 shell 命令才需要的维度，"派一个子agent"这件事本身，前台/后台就是它的一等公民属性，不是靠外面套一层 `&` 才有的能力。

### 2. 完工通知走的确实是"消息"这条路，不是"工具结果"

折叠点③选了"不占用 toolCallId，走一条独立插入的提醒消息"，这个选择在真源码里被验证得相当彻底：`src/utils/task/framework.ts` 里的 `pollTasks()` 会不断对比任务状态，一发现变化就调用 `enqueueTaskNotification()`，构造出形如 `<task-notification><task-id>…</task-id><status>completed</status><summary>…</summary></task-notification>` 的 XML 片段，通过 `enqueuePendingNotification({ value: message, mode: 'task-notification' })`（`src/utils/messageQueueManager.ts`）排进一个消息队列；`src/query.ts`（约1575行）在合适的时机把它当作**用户角色消息**注入对话——`src/coordinator/coordinatorMode.ts` 的注释直接写明了这不是工具结果。我们的 `<system-reminder>` + `role:'user'` + `isMeta:true` 跟这条真实路径在"走消息、不走工具结果"这个关键决策上完全一致；差别只在于真源码用结构化的 XML 标签区分不同字段（`task-id`/`status`/`summary`），我们直接拼了一段自然语言。

### 3. 真源码有两张登记表，我们只有一张——因为我们没有"主动查询"的能力

真源码不只有一张表：`src/state/AppStateStore.ts`（约160行）里的 `tasks: { [taskId: string]: TaskState }` 是一张按 taskId 索引的记录（通过 `src/utils/task/framework.ts` 的 `updateTaskState<T>()` 修改），`TaskState` 是一个联合类型（`LocalShellTaskState`/`LocalAgentTaskState`/`RemoteAgentTaskState`……），每种都带 `status: 'pending'|'running'|'completed'|'failed'|...` 加上 `result`/`error` 字段（例如 `LocalShellTask.tsx` 233-234、346-347行）；另外 `src/utils/task/TaskOutput.ts` 里还有一个私有的 `static Map<string, TaskOutput>` 登记表（`#registry`）。

我们的登记表只登记"完工"，压根没有 `pending`/`running` 这两种中间状态——因为真源码的中间状态是给两件我们没做的事用的：一是有专门的 `TaskOutputTool` 让模型（或用户）可以随时**主动查询**"某个任务现在跑到哪一步了"，二是 UI 要把"正在跑"实时渲染出来。折叠点⑤定死了我们只做被动通知，没有主动查询这个能力——既然没人会来问"现在跑到哪儿了"，登记表就没必要记录跑到哪儿了，只需要记录"跑完了、结果是什么"这一件事。

### 4. 任务 ID：我们的自增计数器和真源码的随机 ID，安全动机完全不同

折叠点⑧选了最简单的自增计数器（`bg-1`、`bg-2`……）。真源码的 `generateTaskId(type)`（`src/Task.ts` 第98行）要复杂得多：用 `randomBytes(8)` 取随机字节，映射到一个36字符的字母表，再拼上按类型区分的前缀（`TASK_ID_PREFIXES`）——源码注释直接写明理由："36^8 ≈ 2.8 trillion combinations, sufficient to resist brute-force symlink attacks"（约28万亿种组合，足以抵御暴力符号链接攻击）。

这个安全顾虑在我们这一篇完全不成立：真源码的任务 ID 会被拼进落盘路径（比如子agent转录文件 `agent-<agentId>.jsonl`），如果 ID 可预测，攻击者理论上能提前在磁盘上放一个同名的符号链接，等系统按预测的路径写入时被劫持到别的地方——这是一个真实的文件系统攻击面。我们的登记表只是进程内存里的一个 `Map`，任务 ID 只当 key 用，从来不会被拼进任何文件路径，符号链接攻击这个前提在我们这里根本不存在，自增计数器没有任何安全代价。

### 5. 前台可以中途转后台，我们的选择是一次性定死

`AgentTool.tsx`（约829、886行）里有一套 `Promise.race` 机制：一次原本按前台（阻塞）方式发起的子agent调用，会把"下一条消息"的 promise 跟一个 `backgroundSignal` 赛跑——用户在界面上主动触发 `backgroundAll()` 时，这个信号才会被点亮，调用在**执行途中**被转成后台任务，配合 `registerAsyncAgent()`/`killAsyncAgent()`/`failAsyncAgent()`/`updateAsyncAgentProgress()` 这一整套运行时管理（`ASSISTANT_BLOCKING_BUDGET_MS`/`backgroundExistingForegroundTask` 是另一套机制，只属于 `BashTool.tsx`/`PowerShellTool.tsx`——命令跑太久就自动转后台，跟 `AgentTool.tsx` 无关，是两条不同的转后台路径）。也就是说，是否后台执行这件事，真源码里不是调用那一刻的一锤子买卖，而是可以随着执行过程被用户动态调整的。

我们的 `background` 参数是发起时就定死的：模型调用 `task` 的那一刻决定了这次是阻塞还是后台，一旦选了阻塞，中途不会因为跑得久就自动转后台；一旦选了后台，也没有"中途改回阻塞、原地等它"这个选项。这是折叠点①刻意收窄的范围——这一篇只解决"调用时二选一"，"运行中途动态转换"是明显更复杂的一层，留在真源码那边。

## 小结

- `background` 参数默认不传等于实战12 老样子（阻塞），显式 `true` 才切到不等待的新逻辑——跟 shell 命令默认前台、`&` 才后台是同一个默认值设计（折叠点①）。
- 后台任务真正跑完之后，结果没人等着接，只能写进一张大家都够得到的登记表，等以后被读走（折叠点②）。
- 完工通知不走 `tool-result`（这次调用的结果槽已经被"已提交"占用），走跟实战11 同款的 `role:'user'`+`isMeta`+`<system-reminder>` 提醒消息（折叠点③）。
- 登记表是 `task.ts` 模块级单例，`execute`（写）和 `drainCompletedBackgroundTasks`（读）之间唯一的桥（折叠点④）。
- 检查登记表这件事放进 loop.ts 每轮开工前的自检家族，跟压缩检查、todo 提醒同一个位置，不是模型主动轮询（折叠点⑤）。
- 多个任务同时完工拼成一条消息；读取即删除，防止下一轮重复上报（折叠点⑥）。
- 后台任务失败跟成功共用同一条登记路径，只是内容换成 `error:` 前缀字符串（折叠点⑦）。
- 任务 ID 用最简单的自增计数器——因为登记表只在内存里、从不落盘，不存在真源码那种符号链接攻击面（折叠点⑧）。

🔬 源码对照：
- `BashTool.tsx` `run_in_background` + `AgentTool.tsx` `run_in_background` — 前后台是 Bash 和 Task 工具共有的一等公民维度，不是我们自己发明的
- `framework.ts` `pollTasks()`/`enqueueTaskNotification()` + `query.ts` 用户角色注入 — 真源码明确"完工通知走消息、不走工具结果"，跟我们的选择完全一致
- `AppStateStore.ts` 的 `tasks` 字段（`TaskState` 联合类型，含 pending/running）+ `TaskOutput.#registry` — 真源码有两张表、有中间状态，因为它支持主动查询；我们只有一张只记完工的表
- `Task.ts` `generateTaskId()` — `randomBytes(8)` 随机 ID 是为了防落盘路径被符号链接攻击；我们的登记表不落盘，自增计数器没有这层顾虑
- `AgentTool.tsx` `Promise.race`/`backgroundSignal` — 真源码支持用户中途主动把前台执行转后台；我们的 `background` 是调用那一刻的一次性决定

后台任务现在能提交、能被自动通知完工，但还缺一件事：如果父agent提交之后改主意了——任务其实没必要跑了，或者跑错了方向——有没有办法把一个还在后台跑着的子agent叫停？下一篇要拆的就是这个"取消"。
