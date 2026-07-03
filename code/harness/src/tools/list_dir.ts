import { readdir } from 'node:fs/promises'
import type { Tool } from '../types'

/** 列目录（像 `ls`）。给模型一个"看看这里有什么"的眼睛，好决定下一步读/改哪个文件。 */
export const listDirTool: Tool = {
  name: 'list_dir',
  description: '列出指定目录下的条目（目录名带尾部 /）。默认列当前目录。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要列出的目录路径，默认当前目录 "."' },
    },
    required: [],
  },
  execute: async (args: { path?: string }) => {
    const path = args?.path || '.'
    try {
      const entries = await readdir(path, { withFileTypes: true })
      if (entries.length === 0) return `（${path} 是空目录）`
      return entries
        .map(e => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join('\n')
    } catch (e) {
      return `error: 列不了 ${path}: ${(e as Error).message}`
    }
  },
}
