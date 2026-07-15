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
 * 工厂函数：`provider`/`gate` 只有 index.ts 启动时才拿得到，但 `Tool.execute` 的签名只收模型给的
 * `args`，没有第三个位置塞这两者。用闭包把它们焊进返回的 `Tool` 对象里——调用方（index.ts）只用
 * 调一次 `createTaskTool(provider, gate)`，之后模型每次调 `task`，`execute` 都记得住它俩
 * （回扣折叠点：跟 `createAuthMiddleware(secretKey)` 是同一个形状）。
 *
 * 子agent的起始上下文只有这次的 task 描述，不带主agent的完整对话历史（回扣折叠点①）；
 * gate 原样传下去，跟主agent同一套权限闸门，危险度不会因为换了个调用者就变了（回扣折叠点⑤）；
 * cwd/sessionId 不传——这次同步子agent调用内联在主agent的一次工具调用里执行完，不参与 Layer A
 * 持久化（回扣折叠点⑤：真正需要跨进程续传的是异步子agent，这一篇没做）。
 */
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
      return runAgent(provider, subagentTools, task, 10, gate)
    },
  }
}
