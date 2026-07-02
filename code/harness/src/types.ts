// harness 最底层的契约：可插拔的模型层
// 入口给中立的 messages，出口拿归一化的 ChatReply——provider 差异全烂在实现里。

export type Role = 'user' | 'assistant'

/** 一条对话消息（回扣概念 Blog 17：记忆不在模型脑里，在这个数组里，每轮原样重放） */
export type Message = { role: Role; content: string }

/** 归一化回复：无论后面接的是 Anthropic 还是 GLM，调用方只认这个形状 */
export type ChatReply = {
  text: string
  /** 停止原因，已抹平两端字段名差异（Anthropic end_turn/tool_use、OpenAI stop/tool_calls）。实战02 的循环停止判断会用它 */
  stopReason: string
}

/** 模型层的契约：谁想当一个 provider，就得实现它 */
export interface ModelProvider {
  readonly name: string
  chat(messages: Message[]): Promise<ChatReply>
}
