import { readFile } from 'node:fs/promises'
import type { Tool } from '../types'

/** 第一个工具：给金鱼接上第一只手——读文件（回扣概念 18a：泡在罐里的脑，本来只能想不能动） */
export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取指定路径的文本文件，返回其完整内容。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要读取的文件路径（相对当前目录或绝对路径）' },
    },
    required: ['path'],
  },
  // 干活的手：真正碰文件系统的地方。execute 收的是归一化后的 args 对象
  execute: async (args: { path?: string }) => {
    const path = args?.path
    if (!path) return 'error: 缺少 path 参数'
    try {
      return await readFile(path, 'utf-8')
    } catch (e) {
      // 出错也返回文本（不抛），把错误回灌给模型让它下一轮自己想办法（回扣 Blog18 校验重试）
      return `error: 读不了 ${path}: ${(e as Error).message}`
    }
  },
}
