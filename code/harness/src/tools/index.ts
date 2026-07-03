import type { Tool } from '../types'
import { readFileTool } from './read_file'
import { writeFileTool } from './write_file'
import { editFileTool } from './edit_file'
import { listDirTool } from './list_dir'
import { bashTool } from './bash'

/**
 * 工具注册表：全卷"有哪些工具"的唯一清单。
 * 兑现实战02 埋的钩——加工具 = 往这个数组塞一个自包含对象，loop / 调用方一个字都不用改
 * （loop.ts 已经能吃 Tool[] 并按名字建 Map 分流）。
 * 窄工具在前（read/write/edit/ls，边界清楚），逃生舱 bash 压轴（回扣 Blog30 工具即权限）。
 */
export const allTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  bashTool,
]
