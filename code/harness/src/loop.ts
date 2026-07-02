import type { ModelProvider, Tool, Message } from './types'

/**
 * agent loop 骨架 = 把 实战01 的单圈 chat() 套进 while（回扣概念 24：agent 就这么点骨架，无黑魔法）。
 * 循环条件不看 stopReason 字符串，看 reply.toolCalls.length——模型这轮还要不要工具（回扣源码 query.ts §554）。
 * maxTurns 是"炸"的护栏：死循环时强制刹车（回扣概念 24 三祸之一）。
 */
export async function runAgent(
  provider: ModelProvider,
  tools: Tool[],
  userInput: string,
  maxTurns = 10,
): Promise<string> {
  const messages: Message[] = [{ role: 'user', content: userInput }]
  const toolByName = new Map(tools.map(t => [t.name, t]))

  for (let turn = 1; turn <= maxTurns; turn++) {
    const reply = await provider.chat(messages, tools)

    // 模型这轮没请求工具 → 收工（谁决定停 = 模型不再吐 toolCall，把开关交给模型）
    if (reply.toolCalls.length === 0) {
      return reply.text
    }

    // 模型要工具：先把它这轮的请求作为 assistant 轮记进历史（缝 id 用，下一轮结果要对回来）
    messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls })

    // 逐个执行，结果作为 tool 消息塞回 messages，供下一轮模型看到
    for (const call of reply.toolCalls) {
      const tool = toolByName.get(call.name)
      const result = tool
        ? await tool.execute(call.args)
        : `error: 未知工具 ${call.name}`
      const preview = result.slice(0, 60).replace(/\s+/g, ' ')
      console.log(`  [turn ${turn}] ${call.name}(${JSON.stringify(call.args)}) -> ${preview}…`)
      messages.push({ role: 'tool', toolCallId: call.id, content: result })
    }
  }
  return `（达到最大轮数 ${maxTurns}，强制停止）`
}
