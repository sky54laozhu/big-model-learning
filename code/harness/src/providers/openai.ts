import type { Message, ChatReply, ModelProvider, Tool, ToolCall } from '../types'

/** OpenAI 兼容 provider（智普 GLM / OpenRouter / 任何 OpenAI 兼容网关） */
export class OpenAICompatProvider implements ModelProvider {
  readonly name = 'openai-compat'
  constructor(
    private base: string,
    private apiKey: string,
    private model: string,
  ) {}

  async chat(messages: Message[], tools?: Tool[]): Promise<ChatReply> {
    const body: Record<string, unknown> = {
      model: this.model,
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

    // 出口翻译：OpenAI 回的是 choices[]，工具请求在 message.tool_calls[]
    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
        }
        finish_reason?: string
      }>
    }
    const choice = data.choices?.[0]
    const msg = choice?.message
    // ⚠️ OpenAI 的参数是一坨 JSON 字符串，不是对象——得 parse 才能归一化成 args（回扣 Blog18 概率性坏格式）
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map(tc => ({
      id: tc.id ?? '',
      name: tc.function?.name ?? '',
      args: safeParse(tc.function?.arguments),
    }))
    return {
      text: msg?.content ?? '',
      stopReason: choice?.finish_reason ?? 'stop',
      toolCalls,
    }
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
