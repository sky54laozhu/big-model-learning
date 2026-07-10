import type { Message, StreamEvent, ModelProvider, Tool, ToolCall } from '../types'
import { readSSE } from '../sse'
import { HttpError, withRetry } from '../retry'

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

  async *streamChat(messages: Message[], tools?: Tool[], system?: string): AsyncGenerator<StreamEvent> {
    const self = this
    // 实战08：一次尝试的完整逻辑收进 runOnce——withRetry 每重试一次就整个重新调用它一遍，
    // 这就是"无状态协议，重试=整包重发"的字面意思：blocks/stopReason 每次调用都是全新的局部变量。
    const runOnce = async function* (): AsyncGenerator<StreamEvent> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      }
      // 直连用 x-api-key；聚合器（zenmux 等）多用 Authorization: Bearer
      if (self.authToken) headers['authorization'] = `Bearer ${self.authToken}`
      else headers['x-api-key'] = self.apiKey

      const body: Record<string, unknown> = {
        model: self.model,
        max_tokens: 1024,
        stream: true,
        // 入口翻译①：中立 messages（含工具请求/结果）→ Anthropic 的 content 块方言
        messages: self.toAnthropicMessages(messages),
      }
      // 入口翻译③：system 是请求体顶层的独立字段，不混进 messages 数组——
      // 这跟 实战07 折叠点①同一件事：工具描述、系统提示词都不挤在 messages 里，各自有各自的槽位
      if (system) body.system = system
      // 入口翻译②：工具说明 → Anthropic 的 tools（参数字段叫 input_schema）
      if (tools && tools.length > 0) {
        body.tools = tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }))
      }

      const res = await fetch(`${self.base}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      // 实战08：不再当场 throw 完事——换成带状态码的 HttpError，交给 withRetry 按状态码分类
      if (!res.ok) throw new HttpError(res.status, `anthropic ${res.status}: ${await res.text()}`)

      // 出口翻译：SSE 事件流里按 index 拼出 content 块——text 块边到边喂 text_delta 事件，
      // tool_use 块的参数只攒字符串、不逐片 parse（跟真源码 claude.ts 的理由一样：避免 O(n²) 重复解析），
      // 但 content_block_stop 一到（这块彻底结束），立刻 parse 一次并吐出 tool_call 事件——
      // 不用等整条流跑完，实战05 里这个事件是被忽略的，这一篇把它请回来当"该 parse 了"的信号。
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
            const delta = event.delta.text ?? ''
            block.text += delta
            yield { type: 'text_delta', delta }
          } else if (event.delta.type === 'input_json_delta' && block?.type === 'tool_use') {
            block.inputJson += event.delta.partial_json ?? ''
          }
        } else if (event.type === 'content_block_stop' && event.index !== undefined) {
          const block = blocks[event.index]
          if (block?.type === 'tool_use') {
            yield { type: 'tool_call', call: { id: block.id, name: block.name, args: safeParse(block.inputJson) } }
          }
        } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason
        }
      }

      yield { type: 'done', stopReason }
    }

    yield* withRetry(runOnce)
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
