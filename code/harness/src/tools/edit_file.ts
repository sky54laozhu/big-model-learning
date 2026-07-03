import { readFile, writeFile } from 'node:fs/promises'
import type { Tool } from '../types'

/**
 * 局部改：把 old_string 换成 new_string。
 * 核心是"唯一性"——old_string 由模型挑，代码里满是重复串（回扣实战03 推导）。
 * 撞多处不猜、不换第一个，而是"响亮地失败"：报错回灌，逼模型多带上下文再来（回扣 Blog18 校验重试 / 柱三）。
 * 真实 FileEditTool 还提供 replace_all 显式逃生阀（想全换自己开），这里从简，只做"唯一才换"。
 */
export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    '在文件里把一段旧内容替换成新内容。old_string 必须在文件里唯一出现——撞多处会报错，请多带上下文让它唯一。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要修改的文件路径' },
      old_string: { type: 'string', description: '要被替换的原文（需在文件中唯一出现）' },
      new_string: { type: 'string', description: '替换成的新内容' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  execute: async (args: { path?: string; old_string?: string; new_string?: string }) => {
    const path = args?.path
    if (!path) return 'error: 缺少 path 参数'
    const oldString = args?.old_string
    if (oldString == null) return 'error: 缺少 old_string 参数'
    const newString = args?.new_string ?? ''

    let content: string
    try {
      content = await readFile(path, 'utf-8')
    } catch (e) {
      return `error: 读不了 ${path}: ${(e as Error).message}`
    }

    // 数出现几次：split 段数 - 1（照 FileEditTool.ts:329 的写法）
    const matches = content.split(oldString).length - 1
    if (matches === 0) {
      return `error: 在 ${path} 里没找到 old_string，无法替换。`
    }
    if (matches > 1) {
      return `error: old_string 在 ${path} 里出现了 ${matches} 次，无法确定改哪一处。请在 old_string 里多带一些上下文让它唯一。`
    }

    // 唯一，换那一处。用函数式 replacer 避免 new_string 里的 $&、$1 被当成特殊替换模式
    const updated = content.replace(oldString, () => newString)
    try {
      await writeFile(path, updated, 'utf-8')
    } catch (e) {
      return `error: 写不了 ${path}: ${(e as Error).message}`
    }
    return `ok: 已修改 ${path}（替换 1 处）`
  },
}
