import type { Message, StreamEvent, ModelProvider, Tool } from '../types'
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

  async *streamChat(messages: Message[], tools?: Tool[], system?: string): AsyncGenerator<StreamEvent> {
    // 入口翻译③：这协议没有独立的 system 字段，系统提示词就是 messages 数组最前面一条
    // role:'system' 消息——跟 Anthropic 顶层 system 字段是同一份内容，两种不同的搬运方式
    const openaiMessages = this.toOpenAIMessages(messages)
    if (system) openaiMessages.unshift({ role: 'system', content: system })

    const body: Record<string, unknown> = {
      model: this.model,
      stream: true,
      messages: openaiMessages,
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

    // 出口翻译：SSE 里每个 data: 是一个 chunk，text 边到边喂 text_delta；
    // 这协议没有 Anthropic 那种显式的"这块结束了"事件，只能靠 tool_calls[].index 反推——
    // 换了 index，说明上一个工具调用的参数字符串已经攒完，可以 parse 并吐一个 tool_call 了。
    // 最后一个工具调用没有"下一个 index"来触发这一下，得靠 finish_reason 到达时兜底 flush 一次。
    const pending: PendingToolCall[] = []
    let currentIndex: number | null = null
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
        yield { type: 'text_delta', delta: choice.delta.content }
      }
      for (const tc of choice?.delta?.tool_calls ?? []) {
        if (currentIndex !== null && tc.index !== currentIndex) {
          const done = pending[currentIndex]
          if (done) yield { type: 'tool_call', call: { id: done.id, name: done.name, args: safeParse(done.argsJson) } }
        }
        currentIndex = tc.index
        const slot = (pending[tc.index] ??= { id: '', name: '', argsJson: '' })
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name += tc.function.name
        if (tc.function?.arguments) slot.argsJson += tc.function.arguments
      }
      if (choice?.finish_reason) stopReason = choice.finish_reason
    }

    // 兜底：最后一个工具调用没有"下一个 index"帮它触发 flush，流结束后手动补一次
    if (currentIndex !== null) {
      const last = pending[currentIndex]
      if (last) yield { type: 'tool_call', call: { id: last.id, name: last.name, args: safeParse(last.argsJson) } }
    }

    yield { type: 'done', stopReason }
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
