import type { Message, ChatReply, ModelProvider } from '../types'

/** OpenAI 兼容 provider（智普 GLM / OpenRouter / 任何 OpenAI 兼容网关） */
export class OpenAICompatProvider implements ModelProvider {
  readonly name = 'openai-compat'
  constructor(
    private base: string,
    private apiKey: string,
    private model: string,
  ) {}

  async chat(messages: Message[]): Promise<ChatReply> {
    // 入口翻译：中立 messages → OpenAI chat.completions 的 body（形态恰好也叫 messages）
    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages }),
    })
    if (!res.ok) throw new Error(`openai-compat ${res.status}: ${await res.text()}`)

    // 出口翻译：OpenAI 回的是 choices[]，取 message.content 与 finish_reason
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
    }
    const choice = data.choices?.[0]
    return {
      text: choice?.message?.content ?? '',
      stopReason: choice?.finish_reason ?? 'stop',
    }
  }
}
