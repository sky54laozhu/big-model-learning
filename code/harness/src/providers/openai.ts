import type { Message, ChatReply, ModelProvider, Tool, ToolCall } from '../types'
import { readSSE } from '../sse'

/** 流式里正在拼的一个工具调用——按 index 归位，name 一般随第一个 delta 到齐，arguments 分片累加 */
type PendingToolCall = { id: string; name: string; argsJson: string }

/** OpenAI 兼容 provider（智普 GLM / OpenRouter / 任何 OpenAI 兼容网关） */
export class OpenAICompatProvider implements ModelProvider {
  readonly name = 'openai-compat'
  constructor(
    private base: string,
    private apiKey: string,
    private model: string,
  ) {}

  async chat(messages: Message[], tools?: Tool[], onToken?: (delta: string) => void): Promise<ChatReply> {
    const body: Record<string, unknown> = {
      model: this.model,
      stream: true,
      // 入口翻译①：中立 messages → OpenAI chat.completions 方言
      messages: this.toOpenAIMessages(messages),
    }
    // 入口翻译②：工具说明 → OpenAI 的 tools（外面套一层 type:'function'）
    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    }

    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`openai-compat ${res.status}: ${await res.text()}`)

    // 出口翻译：SSE 里每个 data: 是一个 chunk，text 边到边喂 onToken；
    // tool_calls 的 arguments 按 index 分片累加成字符串，收完才 parse 一次
    let text = ''
    const pending: PendingToolCall[] = []
    let stopReason = 'stop'
    for await (const payload of readSSE(res)) {
      if (payload === '[DONE]') break
      const chunk = JSON.parse(payload) as {
        choices?: Array<{
          delta?: {
            content?: string | null
            tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
          }
          finish_reason?: string | null
        }>
      }
      const choice = chunk.choices?.[0]
      if (choice?.delta?.content) {
        text += choice.delta.content
        onToken?.(choice.delta.content)
      }
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const slot = (pending[tc.index] ??= { id: '', name: '', argsJson: '' })
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name += tc.function.name
        if (tc.function?.arguments) slot.argsJson += tc.function.arguments
      }
      if (choice?.finish_reason) stopReason = choice.finish_reason
    }

    // ⚠️ OpenAI 的参数是一坨 JSON 字符串，不是对象——得 parse 才能归一化成 args（回扣 Blog18 概率性坏格式）
    const toolCalls: ToolCall[] = pending
      .filter((tc): tc is PendingToolCall => Boolean(tc))
      .map(tc => ({ id: tc.id, name: tc.name, args: safeParse(tc.argsJson) }))
    return { text, stopReason, toolCalls }
  }

  /** 入口翻译：中立 Message[] → OpenAI messages[]（结果走 role:'tool'，工具请求走 tool_calls） */
  private toOpenAIMessages(messages: Message[]): Array<Record<string, unknown>> {
    return messages.map(m => {
      if (m.role === 'user') return { role: 'user', content: m.content }
      if (m.role === 'assistant') {
        if (m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.args) },
            })),
          }
        }
        return { role: 'assistant', content: m.content }
      }
      // tool 结果：OpenAI 用独立的 role:'tool' 消息，带 tool_call_id
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    })
  }
}

/** 参数字符串可能缺失或损坏，解析失败就退回空对象，别让整条循环崩掉 */
function safeParse(s: string | undefined): any {
  if (!s) return {}
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}
