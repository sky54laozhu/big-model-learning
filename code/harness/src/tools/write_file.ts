import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Tool } from '../types'

/** 整篇覆盖写（像 `cat > file`）。edit 是局部改，write 是整块换/新建。 */
export const writeFileTool: Tool = {
  name: 'write_file',
  description: '把给定内容写入指定路径（整篇覆盖，文件不存在则新建）。局部修改请用 edit_file。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要写入的文件路径' },
      content: { type: 'string', description: '写入的完整内容（会覆盖原文件）' },
    },
    required: ['path', 'content'],
  },
  execute: async (args: { path?: string; content?: string }) => {
    const path = args?.path
    if (!path) return 'error: 缺少 path 参数'
    const content = args?.content ?? ''
    try {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf-8')
      return `ok: 已写入 ${path}（${content.length} 字符）`
    } catch (e) {
      return `error: 写不了 ${path}: ${(e as Error).message}`
    }
  },
}
