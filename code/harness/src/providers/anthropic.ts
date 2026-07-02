import type { Message, ChatReply, ModelProvider, Tool, ToolCall } from '../types'

/** Anthropic 协议 provider（直连 api.anthropic.com，或经聚合器如 zenmux） */
export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic'
  constructor(
    private base: string,
    private apiKey: string,
    private authToken: string,
    private model: string,
  ) {}

  async chat(messages: Message[], tools?: Tool[]): Promise<ChatReply> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    }
    // 直连用 x-api-key；聚合器（zenmux 等）多用 Authorization: Bearer
    if (this.authToken) headers['authorization'] = `Bearer ${this.authToken}`
    else headers['x-api-key'] = this.apiKey

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 1024,
      // 入口翻译①：中立 messages（含工具请求/结果）→ Anthropic 的 content 块方言
      messages: this.toAnthropicMessages(messages),
    }
    // 入口翻译②：工具说明 → Anthropic 的 tools（参数字段叫 input_schema）
    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))
    }

    const res = await fetch(`${this.base}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`)

    // 出口翻译：Anthropic 回的是 content[] 数组，里面混着 text 块和 tool_use 块
    // res.json() 在 strict 下是 unknown——给它一个最小形状，别信运行时数据（回扣 Blog 18）
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>
      stop_reason?: string
    }
    const blocks = data.content ?? []
    const text = blocks
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('')
    // 从 tool_use 块抽出归一化的 toolCalls（input 就是解析好的参数对象）
    const toolCalls: ToolCall[] = blocks
      .filter(b => b.type === 'tool_use')
      .map(b => ({ id: b.id ?? '', name: b.name ?? '', args: b.input ?? {} }))
    return { text, stopReason: data.stop_reason ?? 'end_turn', toolCalls }
  }

  /** 入口翻译：中立 Message[] → Anthropic messages[]（tool_use / tool_result 都是 content 块） */
  private toAnthropicMessages(messages: Message[]): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = []
    for (const m of messages) {
      if (m.role === 'user') {
        out.push({ role: 'user', content: m.content })
      } else if (m.role === 'assistant') {
        if (m.toolCalls && m.toolCalls.length > 0) {
          const blocks: Array<Record<string, unknown>> = []
          if (m.content) blocks.push({ type: 'text', text: m.content })
          for (const tc of m.toolCalls) {
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })
          }
          out.push({ role: 'assistant', content: blocks })
        } else {
          out.push({ role: 'assistant', content: m.content })
        }
      } else {
        // tool 结果：Anthropic 用一条 user 消息装 tool_result；连续多个结果并进同一条 user
        const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
        const last = out[out.length - 1]
        if (last && last.role === 'user' && Array.isArray(last.content)) {
          last.content.push(block)
        } else {
          out.push({ role: 'user', content: [block] })
        }
      }
    }
    return out
  }
}
