import type { Message, ChatReply, ModelProvider } from '../types'

/** Anthropic 协议 provider（直连 api.anthropic.com，或经聚合器如 zenmux） */
export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic'
  constructor(
    private base: string,
    private apiKey: string,
    private authToken: string,
    private model: string,
  ) {}

  async chat(messages: Message[]): Promise<ChatReply> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    }
    // 直连用 x-api-key；聚合器（zenmux 等）多用 Authorization: Bearer
    if (this.authToken) headers['authorization'] = `Bearer ${this.authToken}`
    else headers['x-api-key'] = this.apiKey

    // 入口翻译：中立 messages → Anthropic 的 body 形态
    const res = await fetch(`${this.base}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, max_tokens: 1024, messages }),
    })
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`)

    // 出口翻译：Anthropic 回的是 content[] 数组，取其中的 text 块拼起来
    // res.json() 在 strict 下是 unknown——给它一个最小形状，别信运行时数据（回扣 Blog 18）
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>
      stop_reason?: string
    }
    const text = (data.content ?? [])
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('')
    return { text, stopReason: data.stop_reason ?? 'end_turn' }
  }
}
