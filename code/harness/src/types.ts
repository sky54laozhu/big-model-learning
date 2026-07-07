// harness 最底层的契约：可插拔的模型层
// 入口给中立的 messages（+ 这一轮可用的 tools），出口拿归一化的 ChatReply——provider 差异全烂在实现里。

export type Role = 'user' | 'assistant' | 'tool'

/** 模型吐回的一次工具请求。id 是把"哪个请求"和"哪个结果"缝在一起的线（Anthropic tool_use_id / OpenAI tool_call_id） */
export type ToolCall = { id: string; name: string; args: any }

/**
 * 一条对话消息（回扣概念 Blog 17：记忆不在模型脑里，在这个数组里，每轮原样重放）。
 * 实战02 从"一种"劈成可辨识联合（回扣 实战00b：全卷最核心的类型技巧）——
 * 因为带工具后，消息不止"纯文本"一种：模型要工具 / 工具回结果 都得进历史。
 */
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

/** 一个工具 = 一张说明书（给模型看）+ 一只手（harness 调）。自包含，加工具只是往清单塞一个新对象 */
export type Tool = {
  name: string
  description: string
  /** JSON Schema，描述参数长什么样——这部分被剥出来塞进请求，给模型看 */
  parameters: object
  /** 干活的手：模型点名要它时，harness 按名字找到并调用 */
  execute: (args: any) => Promise<string>
}

/** 归一化回复：无论后面接的是 Anthropic 还是 GLM，调用方只认这个形状 */
export type ChatReply = {
  text: string
  /**
   * 停止原因，已抹平两端字段名差异。⚠️ 只统一了"字段位置"没统一"取值词表"
   * （Anthropic end_turn/tool_use、OpenAI stop/tool_calls），别拿它跨端 switch。
   * 循环该不该继续，看 toolCalls.length，不看这个字符串（回扣源码 query.ts §554）。
   */
  stopReason: string
  /** 这一轮模型请求的工具（没请求就是空数组）。agent loop 的循环条件就靠它 */
  toolCalls: ToolCall[]
}

/** 模型层的契约：谁想当一个 provider，就得实现它 */
export interface ModelProvider {
  readonly name: string
  /**
   * tools 可选：不传就退化成 实战01 的纯聊天（回扣 Blog18：工具按需 opt-in）。
   * onToken 也可选：不传就是 实战04 的老样子（憋到底再拿完整 text）；
   * 传了，文本每到一个片段就喂一次——工具调用仍然是收完整参数字符串再解析一次，不逐 token 解析（这是实战06 的活）。
   */
  chat(messages: Message[], tools?: Tool[], onToken?: (delta: string) => void): Promise<ChatReply>
}
