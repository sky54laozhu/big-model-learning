import type { Tool, ModelProvider } from '../types'
import { readFileTool } from './read_file'
import { writeFileTool } from './write_file'
import { editFileTool } from './edit_file'
import { listDirTool } from './list_dir'
import { bashTool } from './bash'
import { todoWriteTool } from './todo_write'
import { createTaskTool, cancelTaskTool, createTaskStatusTool } from './task'

/**
 * 工具注册表：全卷"有哪些工具"的唯一清单。
 * 兑现实战02 埋的钩——加工具 = 往这个数组塞一个自包含对象，loop / 调用方一个字都不用改
 * （loop.ts 已经能吃 Tool[] 并按名字建 Map 分流）。
 * 窄工具在前（read/write/edit/ls，边界清楚），todo_write 记进度，task 派子agent，逃生舱 bash 压轴
 * （回扣 Blog30 工具即权限）。
 *
 * 实战12 起，这里从写死的数组变成一个函数：`task` 工具要闭包住 `provider`/`gate`（回扣折叠点：
 * 工厂函数模式），而这两者只有 index.ts 拿到运行时的 provider 之后才有——所以整份清单也只能等到
 * 那一刻才组装完，调用方从 `import { allTools }` 改成 `createAllTools(provider, gate)`。
 *
 * 实战14 新增：cancel_task 只加在这份顶层清单里，不进 task.ts 的 subagentTools——子agent的
 * 工具集里没有 task 本身，自然也创建不出 bg-N，"取消谁"这个问题只有主agent这一层需要回答。
 *
 * 实战15 新增：新增第三个闭包参数 cwd——createTaskTool 和 createTaskStatusTool 都要用它
 * （前者给后台子agent开自己的 transcript，后者读那份 transcript 做增量查询），task_status
 * 同样只加在顶层清单，不进 subagentTools（理由跟 cancel_task 一样：子agent派生不出 bg-N）。
 */
export function createAllTools(provider: ModelProvider, gate: boolean, cwd: string): Tool[] {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirTool,
    bashTool,
    todoWriteTool,
    createTaskTool(provider, gate, cwd),
    cancelTaskTool,
    createTaskStatusTool(cwd),
  ]
}
