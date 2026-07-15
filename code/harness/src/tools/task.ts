import type { Tool, ModelProvider } from '../types'
import { runAgent } from '../loop'
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

/**
 * 实战13 新增：后台任务登记表，模块级单例（声明在 createTaskTool 工厂函数外面）。
 * 只登记"跑完了"的条目——还在跑的任务不占这张表的一行，因为没有任何代码需要读到
 * "还在跑"这个状态本身，登记表存在的唯一理由是给 drainCompletedBackgroundTasks 一个
 * "完工箱"，取走即删（防止下一轮重复上报）。
 *
 * 这张表是 execute（写，任务跑完时由 .then/.catch 写入）和 drainCompletedBackgroundTasks
 * （读，loop.ts 每轮开口前调用）之间唯一的桥——两者在不同时间点被调用，除了这个模块级变量，
 * 没有别的办法让后者看到前者写下的东西。
 *
 * 值统一是一条结果字符串：成功是 runAgent 的返回值，失败是一条 `error: ...` 前缀字符串
 * （跟 task.ts 别处表达错误的方式一致）——不单独开一个 error 字段，读写两端都不需要
 * 分支判断"这次是成功还是失败"，直接把值当成"要展示给模型看的结果"用。
 */
const completedBackgroundTasks = new Map<string, string>()

let nextBackgroundTaskId = 1

/**
 * 工厂函数：`provider`/`gate` 只有 index.ts 启动时才拿得到，但 `Tool.execute` 的签名只收模型给的
 * `args`，没有第三个位置塞这两者。用闭包把它们焊进返回的 `Tool` 对象里——调用方（index.ts）只用
 * 调一次 `createTaskTool(provider, gate)`，之后模型每次调 `task`，`execute` 都记得住它俩
 * （回扣折叠点：跟 `createAuthMiddleware(secretKey)` 是同一个形状）。
 *
 * 子agent的起始上下文只有这次的 task 描述，不带主agent的完整对话历史（回扣折叠点①）；
 * gate 原样传下去，跟主agent同一套权限闸门，危险度不会因为换了个调用者就变了（回扣折叠点⑤）；
 * cwd/sessionId 不传——不管阻塞还是后台执行都不参与 Layer A 持久化（回扣折叠点⑤：这道题
 * 子agent身上本来就不成立，跟是不是后台跑无关）。
 *
 * 实战13 新增：默认还是实战12 的阻塞行为——不传 `background` 或传 `false`，`execute` 原样
 * `await runAgent(...)` 等它跑完才返回，跟旧版一个字不差。只有显式传 `background: true`，
 * `execute` 才会立刻返回一句"已提交"的确认，不等 `runAgent` 真正跑完（默认阻塞、需要才显式
 * 加参数，跟 shell 命令默认前台、加 `&` 才后台是同一个默认值设计）。
 */
export function createTaskTool(provider: ModelProvider, gate: boolean): Tool {
  return {
    name: 'task',
    description:
      '派一个独立的子agent去执行一项任务。子agent只看到这次给它的任务描述，看不到当前对话的历史，' +
      '所以任务描述要包含它完成任务所需的全部上下文。适合可以独立展开调查、只需要一份汇总结论的工作，' +
      '比如并行查多件事再汇总。默认阻塞等待子agent跑完再拿到结果；如果这次任务耗时较长、或者你想' +
      '先继续做别的事，传 background:true 会立刻拿到一句提交确认，子agent转到后台继续跑，' +
      '跑完后会在后续某一轮通过提醒消息告诉你结果，不需要你主动去查。',
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

      // 默认路径：跟实战12 一模一样，原地等它跑完
      if (!args?.background) {
        return runAgent(provider, subagentTools, task, 10, gate)
      }

      // background:true——发起但不等待。这次 execute 的返回值只是"提交成功"的确认，
      // 不是任务的最终结果；真正的结果由 .then/.catch 写进登记表，等下一次
      // drainCompletedBackgroundTasks 被调用时才浮出水面。
      const taskId = `bg-${nextBackgroundTaskId++}`
      runAgent(provider, subagentTools, task, 10, gate)
        .then(result => completedBackgroundTasks.set(taskId, result))
        .catch((err: unknown) => {
          // 失败和成功共用同一条登记路径（同一个 Map、同一个字符串类型），只是内容
          // 换成 error: 前缀，不单独开失败分支。
          const message = err instanceof Error ? err.message : String(err)
          completedBackgroundTasks.set(taskId, `error: 子agent后台执行失败——${message}`)
        })

      return `已提交后台任务 ${taskId}，子agent正在执行，完成后会自动提醒你结果。`
    },
  }
}

/**
 * 实战13 新增：loop.ts 每轮开口前调用一次。把登记表里当前已经完工的条目整批取走
 * （取走 = 从 Map 里删掉，防止下一轮重复上报——多个任务同时完工也只拼成一条消息，
 * 不逐条分别上报）。没有任何条目完工时返回 null，调用方不需要塞任何消息进 messages。
 */
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
