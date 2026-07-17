import type { Tool, ModelProvider } from '../types'
import { runAgent } from '../loop'
import { loadSessionMessages } from '../session'
import { readFileTool } from './read_file'
import { writeFileTool } from './write_file'
import { editFileTool } from './edit_file'
import { listDirTool } from './list_dir'
import { bashTool } from './bash'
import { todoWriteTool } from './todo_write'

/**
 * 子agent能用的工具集：直接列基础工具，不含 task 自己——防止子agent再派生子agent的无限递归
 * （回扣折叠点③）。不从 tools/index.ts 反向 import，避免 index.ts → task.ts → index.ts 循环依赖。
 */
const subagentTools: Tool[] = [readFileTool, writeFileTool, editFileTool, listDirTool, bashTool, todoWriteTool]

type TaskStatus = 'running' | 'completed' | 'cancelled' | 'error'

/**
 * 实战15 新增：把实战13 的 completedBackgroundTasks（结果表）和实战14 的 controllerRegistry
 * （控制柄表）合并成一张登记表——两张表原本用"有没有这一行"分别表达"跑完了"和"还在跑"两种
 * 互斥状态，本质是同一件事（这个任务现在是什么状态）拆成了两张表各画一半。合并后一个 taskId
 * 从诞生到终结全程只对应一行，status 字段本身就是状态机，不用再靠"在不在这张表里"这种隐式
 * 编码去猜状态。
 *
 * 状态只留 4 种：running/completed/cancelled/error（回扣"翻源码"：真实源码 TaskStatus 是 5 种，
 * 多一个 pending——但顺着 execute 的代码读下来，controller 登记和 runAgent(...) 派发是背靠背的
 * 同步调用，中间没有排队/调度层，"已登记但还没开始跑"这个状态在咱们这个 harness 里从来没有
 * 被任何代码观察到过，所以不开这个状态）。
 *
 * cwd 不进这张表——它在整个进程里只有一份，跟 provider/gate 一样通过 createTaskTool 的闭包参数
 * 传入，不需要按 taskId 分别存一份。sessionId 也不单独存，因为它就是 taskId 本身
 * （bg-1 这个任务，自己的 transcript 文件就叫 bg-1.jsonl）。
 */
type TaskRecord = {
  taskId: string
  task: string
  status: TaskStatus
  /** drain 是否已经上报过这个终态——改标记，不删行，让这一行还能被 task_status 按 taskId 查到 */
  notified: boolean
  /** 这个任务自己的 transcript 已经读到第几条消息——task_status 增量查询的进度指针 */
  outputOffset: number
  /** 累计轮数，跟 outputOffset 一起持久化：查询是增量的，轮号不能每次都从 1 数起 */
  turnCount: number
  /** 只有 running 时才有；跑完（不管什么结局）就清掉，cancel_task 靠它判断"这个任务还能不能被摁停" */
  controller?: AbortController
  /** 只有终态（非 running）才有——子agent真正的结论文本，不是工具调用日志能推出来的东西 */
  result?: string
}

const taskRegistry = new Map<string, TaskRecord>()
let nextBackgroundTaskId = 1

/**
 * 实战15 新增：把一个后台任务自己的 transcript 从上次读到的位置往后翻，翻成人能读的工具调用日志。
 * 复用实战10 已经写好的 loadSessionMessages（整份读回再解析成 Message[]），按 outputOffset 切片，
 * 不另开一个按字节 seek 的读文件函数——这个 harness 里一份 transcript 顶多几十条消息，没有大到
 * 需要增量文件读取的地步（KISS/YAGNI，回扣折叠点：翻源码那节会提到真实源码的 outputOffset 其实
 * 是按字节存、给另一条轮询链路用的，用户输出这条路径反而没有用它）。
 *
 * assistant 消息的 toolCalls[] 跟随后的 tool 消息，靠 toolCallId 配对，不是按数组下标——
 * ToolCall.id 自己的注释说得很清楚："id 是把'哪个请求'和'哪个结果'缝在一起的线"。
 * 轮数靠"数遇到过几条 assistant 消息"往上累加，从 record.turnCount 接着数，不是每次都从 1 开始——
 * 否则第二次增量查询会把"这次新出现的第 4、5 轮"错标成"第 1、2 轮"。
 */
async function buildIncrementalLog(
  cwd: string,
  record: TaskRecord,
): Promise<{ lines: string[]; offset: number; turnCount: number }> {
  const messages = (await loadSessionMessages(cwd, record.taskId)) ?? []
  const slice = messages.slice(record.outputOffset)
  const lines: string[] = []
  let turnCount = record.turnCount

  for (const message of slice) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue
    turnCount++
    for (const call of message.toolCalls) {
      const toolResult = slice.find(m => m.role === 'tool' && m.toolCallId === call.id)
      const preview = toolResult ? toolResult.content.slice(0, 60).replace(/\s+/g, ' ') : '(还没见到结果)'
      lines.push(`[turn ${turnCount}] ${call.name}(${JSON.stringify(call.args)}) -> ${preview}…`)
    }
  }

  return { lines, offset: messages.length, turnCount }
}

/**
 * 工厂函数：`provider`/`gate` 只有 index.ts 启动时才拿得到，但 `Tool.execute` 的签名只收模型给的
 * `args`，没有第三个位置塞这两者。用闭包把它们焊进返回的 `Tool` 对象里——调用方（index.ts）只用
 * 调一次 `createTaskTool(provider, gate, cwd)`，之后模型每次调 `task`，`execute` 都记得住它们
 * （回扣折叠点：跟 `createAuthMiddleware(secretKey)` 是同一个形状）。
 *
 * 子agent的起始上下文只有这次的 task 描述，不带主agent的完整对话历史（回扣折叠点①）；
 * gate 原样传下去，跟主agent同一套权限闸门，危险度不会因为换了个调用者就变了（回扣折叠点⑤）。
 *
 * 实战15 新增：cwd 现在也闭包进来，跟 provider/gate 同一个模式——只有后台分支会真正用到它
 * （给这个后台子agent自己开一份 transcript，sessionId 就用它自己的 taskId）；阻塞分支（默认
 * 路径）不接 cwd/sessionId，维持实战12 的原判：这道题在阻塞子agent身上不成立，只有"后台跑、
 * 事后要能被翻出来查"这个需求才需要子agent自己也有一份 Layer A 记录。
 */
export function createTaskTool(provider: ModelProvider, gate: boolean, cwd: string): Tool {
  return {
    name: 'task',
    description:
      '派一个独立的子agent去执行一项任务。子agent只看到这次给它的任务描述，看不到当前对话的历史，' +
      '所以任务描述要包含它完成任务所需的全部上下文。适合可以独立展开调查、只需要一份汇总结论的工作，' +
      '比如并行查多件事再汇总。默认阻塞等待子agent跑完再拿到结果；如果这次任务耗时较长、或者你想' +
      '先继续做别的事，传 background:true 会立刻拿到一句提交确认，子agent转到后台继续跑，' +
      '跑完后会在后续某一轮通过提醒消息告诉你结果；也可以随时用 task_status 主动查看进度，不需要干等。',
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

      // 默认路径：跟实战12 一模一样，原地等它跑完，不接 cwd/sessionId
      if (!args?.background) {
        return runAgent(provider, subagentTools, task, 10, gate)
      }

      // background:true——发起但不等待。这次 execute 的返回值只是"提交成功"的确认，
      // 不是任务的最终结果；真正的结果由 .then/.catch 写进登记表。
      const taskId = `bg-${nextBackgroundTaskId++}`
      const controller = new AbortController()
      taskRegistry.set(taskId, {
        taskId,
        task,
        status: 'running',
        notified: false,
        outputOffset: 0,
        turnCount: 0,
        controller,
      })

      // 实战15：cwd 传实参、sessionId 传 taskId——这个后台子agent从此有了自己的一份 transcript
      // 文件（bg-1.jsonl），task_status 才有东西可读。
      runAgent(provider, subagentTools, task, 10, gate, undefined, cwd, taskId, undefined, controller.signal)
        .then(result => {
          const current = taskRegistry.get(taskId)
          if (!current) return
          taskRegistry.set(taskId, { ...current, status: 'completed', result, controller: undefined })
        })
        .catch((err: unknown) => {
          const current = taskRegistry.get(taskId)
          if (!current) return
          // controller.signal.aborted 分辨"被 cancel_task 主动叫停"和"真的跑失败了"——
          // 前者不是意外，不该跟真失败共用 error: 前缀，免得模型以为子agent自己出了故障。
          if (controller.signal.aborted) {
            taskRegistry.set(taskId, {
              ...current,
              status: 'cancelled',
              result: `cancelled: 子agent执行被取消`,
              controller: undefined,
            })
          } else {
            const message = err instanceof Error ? err.message : String(err)
            taskRegistry.set(taskId, {
              ...current,
              status: 'error',
              result: `error: 子agent后台执行失败——${message}`,
              controller: undefined,
            })
          }
        })

      return `已提交后台任务 ${taskId}，子agent正在执行，完成后会自动提醒你结果；也可以用 task_status 主动查看进度。`
    },
  }
}

/**
 * loop.ts 每轮开口前调用一次。把登记表里"终态但还没上报过"的条目整批取走——不再从 Map 里删掉
 * （回扣实战15：改成 notified 标记而不是删除，因为 task_status 之后还需要按 taskId 查到这一行；
 * 删掉会让"已经完工的任务"凭空消失，跟"列出所有后台任务"这个新能力冲突）。多个任务同时完工
 * 也只拼成一条消息，不逐条分别上报。没有任何条目符合条件时返回 null。
 */
export function drainCompletedBackgroundTasks(): string | null {
  const completed: { id: string; result: string }[] = []
  for (const [id, record] of taskRegistry) {
    if (record.status === 'running' || record.notified) continue
    completed.push({ id, result: record.result ?? '' })
    taskRegistry.set(id, { ...record, notified: true })
  }
  if (completed.length === 0) return null

  const body = completed.map(({ id, result }) => `- 任务 ${id} 已完成，结果：\n${result}`).join('\n\n')
  return `以下后台任务已经跑完：\n\n${body}`
}

/**
 * 实战15 新增：模型主动查询后台任务状态的接口——填上实战12/13/14 留的口子：任务能派、能自动提醒、
 * 能取消，但模型没法在自己想看的时候主动问"bg-1 现在到底跑到哪一步了"。跟 cancel_task 一样是
 * 模块级单例，但要读子agent自己的 transcript，所以也得闭包住 cwd（回扣：跟 createTaskTool 的
 * cwd 是同一份，同一个模式）。
 *
 * 不传 taskId：列出所有任务的概览——一行一个：taskId + 任务描述（截断）+ status，终态的话
 * 再附一段 result 预览，扫一眼就知道全局状态，需要细节再拿具体 taskId 查一次。
 * 传 taskId：单个任务的详情——状态、（终态才有的）完整 result、以及自上次查询以来新增的工具
 * 调用记录。查询本身会把这个任务标成 notified（回扣：跟 drain 共用同一个标记，模型已经主动看过
 * 的终态结果，drain 不用再重复上报一遍）。
 */
export function createTaskStatusTool(cwd: string): Tool {
  return {
    name: 'task_status',
    description:
      '查询后台任务的状态。不传 taskId 时列出所有后台任务的概览（id、任务描述、状态，已结束的附结果预览）；' +
      '传 taskId 时查询单个任务的详情（状态、已结束则附完整结果、以及自上次查询以来新增的工具调用记录）。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '要查询的后台任务 id（形如 bg-1）；不传则列出所有任务' },
      },
      required: [],
    },
    execute: async (args: { taskId?: string }) => {
      const taskId = args?.taskId

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

      const record = taskRegistry.get(taskId)
      if (!record) return `error: 找不到任务 ${taskId}`

      const { lines, offset, turnCount } = await buildIncrementalLog(cwd, record)
      taskRegistry.set(taskId, {
        ...record,
        outputOffset: offset,
        turnCount,
        notified: record.status !== 'running' ? true : record.notified,
      })

      const parts = [`状态：${record.status}`]
      if (record.status !== 'running' && record.result) parts.push(`结果：\n${record.result}`)
      parts.push(lines.length > 0 ? `新增工具调用记录：\n${lines.join('\n')}` : '自上次查询以来没有新的工具调用记录。')
      return parts.join('\n\n')
    },
  }
}

/**
 * 模型取消一个还在跑的后台任务的接口。跟 bashTool 一样是模块级单例，不是工厂函数——
 * execute 只需要读写 taskRegistry 这张模块级登记表，不需要闭包 provider/gate/cwd。
 *
 * 只出现在 index.ts 的顶层工具清单，不进 subagentTools：子agent的工具集里本来就
 * 没有 task 工具本身，所以子agent永远创建不出 bg-N 任务，"子agent A 取消子agent B 的任务"这个
 * 顾虑不需要额外代码去堵，结构上就不成立。
 */
export const cancelTaskTool: Tool = {
  name: 'cancel_task',
  description: '取消一个还在后台执行的子agent任务。只发出取消信号，不保证立刻停止——子agent会尽快响应中断。',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要取消的后台任务 id（形如 bg-1）' },
    },
    required: ['taskId'],
  },
  execute: async (args: { taskId?: string }) => {
    const taskId = args?.taskId
    if (!taskId) return 'error: 缺少 taskId 参数'

    const record = taskRegistry.get(taskId)
    if (!record || !record.controller) return `error: 找不到任务 ${taskId}（可能不存在，或已经结束）`

    record.controller.abort()
    return `已发出取消信号，${taskId} 会尽快停止`
  },
}
