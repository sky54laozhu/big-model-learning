import type { Tool } from '../types'

/**
 * 三态 + 双文本字段（回扣折叠点②）：content 是祈使式（"修复登录bug"，pending/completed 时显示），
 * activeForm 是进行时（"正在修复登录bug"，只在 in_progress 时换上）。两个字符串都由模型自己写死，
 * 不是 harness 拿规则去做英文 -ing 变位——规则会在不规则动词上翻车（Stop→Stoping 而非 Stopping）。
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type TodoItem = { content: string; activeForm: string; status: TodoStatus }

/**
 * 当前清单存哪（回扣折叠点⑥）：不像折叠点③那样从 messages 里现扫，而是开一个活对象，
 * TodoWrite 每次执行就真的把它改了——回扣真源码 appState.todos[todoKey]。
 * mini-harness 单进程单会话，模块级变量就是这次运行唯一的"当前状态"，不需要再包一层 session。
 */
let currentTodos: TodoItem[] = []

export function getCurrentTodos(): readonly TodoItem[] {
  return currentTodos
}

export const todoWriteTool: Tool = {
  name: 'todo_write',
  description: '用一份完整的任务清单整体替换当前的 todo 列表，用来追踪多步骤任务的进度。',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '祈使式描述，如"修复登录bug"' },
            activeForm: { type: 'string', description: '进行时描述，如"正在修复登录bug"' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'activeForm', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  execute: async (args: { todos?: TodoItem[] }) => {
    currentTodos = args?.todos ?? []
    return `ok: 已更新任务清单（${currentTodos.length} 项）`
  },
}
