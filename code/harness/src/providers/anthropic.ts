import type { Message, ChatReply, ModelProvider, Tool, ToolCall } from '../types'
import { readSSE } from '../sse'

/** 流式响应里正在拼的一块内容——text 块攒 text，tool_use 块的参数先攒成字符串，最后一次性 parse */
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; inputJson: string }

/** Anthropic 协议 provider（直连 api.anthropic.com，或经聚合器如 zenmux） */
export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic'
  constructor(
    private base: string,
    private apiKey: string,
    private authToken: string,
    private model: string,
  ) {}

  async chat(messages: Message[], tools?: Tool[], onToken?: (delta: string) => void): Promise<ChatReply> {
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
      stream: true,
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

    // 出口翻译：SSE 事件流里按 index 拼出 content 块——text 块边到边喂 onToken，
    // tool_use 块的参数只攒字符串，不逐片 parse（跟真源码 claude.ts 的理由一样：避免 O(n²) 重复解析）
    const blocks: ContentBlock[] = []
    let stopReason = 'end_turn'
    for await (const payload of readSSE(res)) {
      const event = JSON.parse(payload) as {
        type: string
        index?: number
        content_block?: { type: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
      }
      if (event.type === 'content_block_start' && event.index !== undefined && event.content_block) {
        blocks[event.index] =
          event.content_block.type === 'tool_use'
            ? { type: 'tool_use', id: event.content_block.id ?? '', name: event.content_block.name ?? '', inputJson: '' }
            : { type: 'text', text: '' }
      } else if (event.type === 'content_block_delta' && event.index !== undefined && event.delta) {
        const block = blocks[event.index]
        if (event.delta.type === 'text_delta' && block?.type === 'text') {
          block.text += event.delta.text ?? ''
          onToken?.(event.delta.text ?? '')
        } else if (event.delta.type === 'input_json_delta' && block?.type === 'tool_use') {
          block.inputJson += event.delta.partial_json ?? ''
        }
      } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason
      }
    }

    const text = blocks
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b?.type === 'text')
      .map(b => b.text)
      .join('')
    const toolCalls: ToolCall[] = blocks
      .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b?.type === 'tool_use')
      .map(b => ({ id: b.id, name: b.name, args: safeParse(b.inputJson) }))
    return { text, stopReason, toolCalls }
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

/** tool_use 块的参数是攒出来的 JSON 字符串，攒完才 parse 一次；万一模型吐了坏 JSON，退回空对象别崩循环 */
function safeParse(s: string): any {
  if (!s) return {}
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}
