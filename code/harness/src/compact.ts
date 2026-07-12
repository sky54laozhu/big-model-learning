import type { Message, ModelProvider } from './types'
import { getCompactPrompt, getCompactUserSummaryMessage } from './compactPrompt'

/**
 * 阈值三常量，数值原样照抄源码（回扣 折叠点：本项目最后要转生产用，不为教学缩小规模）。
 *
 * - `MODEL_CONTEXT_WINDOW_DEFAULT`：源码 context.ts 的 `getContextWindowForModel` 是一整条
 *   长链（ant-only 环境变量 → 1M beta 白名单 → 模型能力注册表 → ... → 兜底 200_000）——
 *   那条链上除了最后一环，其余全部依赖我们没有的基础设施（模型能力注册表/1M beta/ant 内部实验）。
 *   这不是"数值缩水"，是结构性裁剪：源码自己对普通模型也是兜底到这个值，我们直接实现兜底这一环。
 * - `COMPACT_MAX_OUTPUT_TOKENS`：context.ts 导出的原名、原值。源码 autoCompact.ts 里给摘要输出
 *   预留的 token 数取的是 `min(该模型的最大输出 token 数, 20_000)`——我们没有逐模型的最大输出注册表，
 *   直接用这个 20_000（多数模型的最大输出本就不到 20_000，min 兜不住的情况很少见）。
 * - `AUTOCOMPACT_BUFFER_TOKENS`：autoCompact.ts 原名、原值 13_000。
 */
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000

/** 我们没有模型能力注册表/1M beta 这类基础设施，兜底值就是唯一值（回扣源码 context.ts §97 的最终兜底分支） */
export function getContextWindowForModel(_model: string): number {
  return MODEL_CONTEXT_WINDOW_DEFAULT
}

/** 上下文窗口刨掉这一轮摘要输出要用的预留额度——真正能用来装历史的部分（回扣 autoCompact.ts 同名函数） */
export function getEffectiveContextWindowSize(model: string): number {
  return getContextWindowForModel(model) - COMPACT_MAX_OUTPUT_TOKENS
}

/** 触发压缩的线：不是等窗口塞满才动手，留出 13_000 token 的安全垫（回扣 autoCompact.ts 同名函数） */
export function getAutoCompactThreshold(model: string): number {
  return getEffectiveContextWindowSize(model) - AUTOCOMPACT_BUFFER_TOKENS
}

/**
 * char/4 粗估——真源码 tokenEstimation.ts 的 `roughTokenCountEstimation` 默认比例（JSON 内容用 2，
 * 我们没有按文件类型区分内容的场景，统一用 4）。只用来估算"最后一条带用量的 assistant 消息之后"
 * 那一小段还没被计入用量的新增内容，不是给整段历史估算用的主力（主力是真实 usage）。
 */
function estimateTokensForChars(chars: number): number {
  return Math.round(chars / 4)
}

/** 一条消息的可读文本长度，工具调用的参数也要算进去（模型下一轮请求会把这些原样带上） */
function messageTextLength(message: Message): number {
  if (message.role === 'assistant') {
    const callsJson = message.toolCalls?.map(tc => JSON.stringify(tc.args)).join('') ?? ''
    return message.content.length + callsJson.length
  }
  return message.content.length
}

/**
 * 历史目前实际占了多少 token——由近及远找最后一条带 usage 的 assistant 消息（真实用量，来自
 * API 自己报的数字），它之后还没被这份用量覆盖到的新增消息（多是这一轮的工具结果）用 char/4 粗估
 * 补上（回扣源码 tokens.ts 的 `tokenCountWithEstimation`；我们没有"同一个 API 响应拆成多条消息"
 * 这回事——每轮一个 assistant 消息对一份 usage，所以不需要源码里按 responseId 回溯合并那一段）。
 */
export function tokenCountWithEstimation(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'assistant' && message.usage) {
      const trailing = messages.slice(i + 1).reduce((sum, m) => sum + estimateTokensForChars(messageTextLength(m)), 0)
      return message.usage.inputTokens + message.usage.outputTokens + trailing
    }
  }
  return messages.reduce((sum, m) => sum + estimateTokensForChars(messageTextLength(m)), 0)
}

/** 该不该在这一轮开口前先压缩——门槛就是 getAutoCompactThreshold（回扣 query.ts 每轮请求前的检查点） */
export function shouldAutoCompact(messages: readonly Message[], model: string): boolean {
  return tokenCountWithEstimation(messages) >= getAutoCompactThreshold(model)
}

/**
 * 源码原话，压缩这次模型调用专用的系统提示词——不是这场对话平时那份 system（回扣 compact.ts
 * 里 streamCompactSummary 兜底路径的调用点：压缩是"另开一次独立的模型调用"，跟这场对话平时
 * 聊什么无关，只有一个任务，systemPrompt 也该只服务这一个任务）。
 */
const COMPACT_SYSTEM_PROMPT = 'You are a helpful AI assistant tasked with summarizing conversations.'

/**
 * 压缩：把整段历史喂给模型，换一段摘要，用摘要整段替换掉原历史（回扣 折叠点：本章只做"整段替换"，
 * 不做 messagesToKeep 那种局部保留）。
 *
 * 跟源码的两处已知、刻意的简化差异（🔬 部分要点破）：
 * 1. 源码这次调用仍然带上 tools:[FileReadTool]（哪怕提示词里明说"别调用工具"）当保底——那是配合
 *    源码自己的"工具调用被拒绝后重试/截断"恢复路径存在的，我们没有那条恢复路径，所以这里 tools
 *    直接传 undefined，完全依赖文字指令按住模型，不留后门。
 * 2. 源码走的是"forked agent 共享缓存"快路径，退化到普通流式调用才是这条兜底逻辑——我们没有
 *    fork agent 的基础设施，直接走普通流式调用（等价于源码的兜底分支本身，不是又一层简化）。
 */
export async function compactMessages(provider: ModelProvider, messages: readonly Message[]): Promise<Message[]> {
  const summaryRequest: Message = { role: 'user', content: getCompactPrompt() }
  const combined = [...messages, summaryRequest]

  let summaryText = ''
  for await (const event of provider.streamChat(combined, undefined, COMPACT_SYSTEM_PROMPT)) {
    if (event.type === 'text_delta') summaryText += event.delta
  }

  return [{ role: 'user', content: getCompactUserSummaryMessage(summaryText) }]
}
