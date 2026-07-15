import type { Message } from './types'
import { getCurrentTodos } from './tools/todo_write'

/**
 * 两把尺子的门槛，数值原样照抄源码 attachments.ts 的 TODO_REMINDER_CONFIG（回扣折叠点①：
 * 本项目不为教学缩小规模）。两把尺子都要过线才提醒——只看"多久没写"，模型正常干别的活时
 * 也会被打扰；只看"多久没提醒"，模型压根没打算用 TodoWrite 时也会被反复戳。
 */
export const TODO_REMINDER_CONFIG = {
  TURNS_SINCE_WRITE: 10,
  TURNS_BETWEEN_REMINDERS: 10,
} as const

/**
 * 两个计数都靠倒着扫 messages 现算，不维护活变量（回扣折叠点③）：--resume 读回的历史、
 * 压缩后被整段替换掉的历史，都是直接对着当前这份 messages 数组算的，不存在"计数器没跟上
 * 历史变化"这道题。
 *
 * 找 TodoWrite 调用：assistant 消息的 toolCalls 里有没有 todo_write。
 * 找上一次提醒：role:'user' 且 isMeta 为真的那条（回扣折叠点④：这正是提醒消息自己的标记）。
 * 命中那条消息本身不计入轮数——不然"刚提醒过"会被自己再算一轮。
 */
function getTodoReminderTurnCounts(messages: readonly Message[]): {
  turnsSinceLastTodoWrite: number
  turnsSinceLastReminder: number
} {
  let lastTodoWriteIndex = -1
  let lastReminderIndex = -1
  let turnsSinceLastTodoWrite = 0
  let turnsSinceLastReminder = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'assistant') {
      if (lastTodoWriteIndex === -1 && message.toolCalls?.some(call => call.name === 'todo_write')) {
        lastTodoWriteIndex = i
      }
      if (lastTodoWriteIndex === -1) turnsSinceLastTodoWrite++
      if (lastReminderIndex === -1) turnsSinceLastReminder++
    } else if (lastReminderIndex === -1 && message?.role === 'user' && message.isMeta) {
      lastReminderIndex = i
    }

    if (lastTodoWriteIndex !== -1 && lastReminderIndex !== -1) break
  }

  return { turnsSinceLastTodoWrite, turnsSinceLastReminder }
}

/** 该不该在这一轮开口前塞一条提醒——摆法照抄 compact.ts 的 shouldAutoCompact：每轮开口前先看一眼 */
export function shouldRemindTodo(messages: readonly Message[]): boolean {
  const { turnsSinceLastTodoWrite, turnsSinceLastReminder } = getTodoReminderTurnCounts(messages)
  return (
    turnsSinceLastTodoWrite >= TODO_REMINDER_CONFIG.TURNS_SINCE_WRITE &&
    turnsSinceLastReminder >= TODO_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS
  )
}

/**
 * 提醒文案（措辞照抄源码 messages.ts 的 'todo_reminder' 分支，含"当前清单内容"那一段，
 * 以及"别向用户提起这条提醒"那句）。当前清单不是从 messages 里现扫的，是折叠点⑥选的活对象
 * ——getCurrentTodos() 读的就是 todo_write 工具最后一次真正写入的内容。
 *
 * role:'user' + isMeta:true + <system-reminder> 包一层（回扣折叠点④）：role 必须是 user，
 * 因为 Role 只有 'user'|'assistant'|'tool' 三种，只有 user 能承载"模型该读的新信息"；
 * isMeta 标记它不是人类真正敲的这一轮；包裹格式跟本对话里你已经见过的 <system-reminder>
 * 块逐字一致（回扣源码 wrapInSystemReminder：`<system-reminder>\n${content}\n</system-reminder>`）。
 */
export function buildTodoReminderMessage(): Message {
  const todos = getCurrentTodos()
  let text =
    'todo_write 工具最近没被用过。如果当前任务是多步骤、值得追踪进度的，考虑调用它来记录进展；' +
    '如果清单已经过时、跟当前工作对不上了，也考虑清理一下。只在确实相关时才用它，这只是个温和的' +
    '提醒——不相关就忽略。不要向用户提起这条提醒本身。'

  if (todos.length > 0) {
    const items = todos.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`).join('\n')
    text += `\n\n当前清单内容：\n\n[${items}]`
  }

  return { role: 'user', content: `<system-reminder>\n${text}\n</system-reminder>`, isMeta: true }
}
