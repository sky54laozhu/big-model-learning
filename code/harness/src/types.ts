// harness 最底层的契约：可插拔的模型层
// 入口给中立的 messages（+ 这一轮可用的 tools），出口是一串归一化的 StreamEvent——provider 差异全烂在实现里。

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

/**
 * 流式事件，三种：文本碎片、一个已经解析完参数的工具调用、这一轮结束。
 * 实战06 之前 chat() 是"憋到底给一整包"，这一篇改成边流边吐——工具调用不再只活在
 * 收尾时打包好的数组里，它自己参数攒完那一刻，就该以一个独立事件的身份出现。
 */
export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | {
      type: 'done'
      /**
       * 停止原因，已抹平两端字段名差异。⚠️ 只统一了"字段位置"没统一"取值词表"
       * （Anthropic end_turn/tool_use、OpenAI stop/tool_calls），别拿它跨端 switch。
       * 循环该不该继续，看有没有收到过 tool_call 事件，不看这个字符串（回扣源码 query.ts §554）。
       */
      stopReason: string
    }

/** 模型层的契约：谁想当一个 provider，就得实现它 */
export interface ModelProvider {
  readonly name: string
  /**
   * tools 可选：不传就退化成 实战01 的纯聊天（回扣 Blog18：工具按需 opt-in）。
   * 文本每到一片就吐一个 text_delta；工具调用的参数字符串只在它自己那一块结束时
   * parse 一次（不逐 delta 解析，避免 O(n²)——实战05 的账，只是触发时机从"整个响应
   * 结束"提前到"这一块结束"），parse 完立刻吐一个 tool_call，不用等模型说完这一轮。
   *
   * system 可选（实战07 新增）：一整段拼好的系统提示词字符串，独立于 messages 之外传入——
   * 两端协议接它的方式不同（Anthropic 是请求体顶层 system 字段，OpenAI 兼容是 messages
   * 数组最前面一条 role:'system'），差异烂在各自 provider 实现里，调用方不用关心。
   */
  streamChat(messages: Message[], tools?: Tool[], system?: string): AsyncGenerator<StreamEvent>
}
