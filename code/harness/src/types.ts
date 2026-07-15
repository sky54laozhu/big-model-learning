// harness 最底层的契约：可插拔的模型层
// 入口给中立的 messages（+ 这一轮可用的 tools），出口是一串归一化的 StreamEvent——provider 差异全烂在实现里。

export type Role = 'user' | 'assistant' | 'tool'

/** 模型吐回的一次工具请求。id 是把"哪个请求"和"哪个结果"缝在一起的线（Anthropic tool_use_id / OpenAI tool_call_id） */
export type ToolCall = { id: string; name: string; args: any }

/** 一次请求的 token 用量（回扣源码 tokens.ts：用量不是另开一个计数器，是长在这条消息自己身上） */
export type Usage = { inputTokens: number; outputTokens: number }

/**
 * 一条对话消息（回扣概念 Blog 17：记忆不在模型脑里，在这个数组里，每轮原样重放）。
 * 实战02 从"一种"劈成可辨识联合（回扣 实战00b：全卷最核心的类型技巧）——
 * 因为带工具后，消息不止"纯文本"一种：模型要工具 / 工具回结果 都得进历史。
 * 实战09 新增：assistant 消息可选带上这一轮的 usage——压缩阈值判断要读的就是这个字段，
 * 从历史里由近及远找最后一条带 usage 的 assistant 消息，不是另开一个跨轮累加的计数器
 * （回扣源码 tokens.ts 的 tokenCountWithEstimation：用量是消息自身的属性，按需读回）。
 * 实战11 新增：user 消息可选带 isMeta——true 表示这条不是人类这一轮真正敲的字，是 harness
 * 自己合成塞进去的（比如 TodoWrite 提醒）。角色仍是 'user'（模型该把它当输入读），但
 * isMeta 让 Layer A 落盘、未来的回放 UI 等下游消费者能把"真人说的话"和"系统合成的话"分开
 * （回扣源码 messages.ts：真源码没有单独的 role，靠 UserMessage 上的同名 isMeta 字段区分）。
 */
export type Message =
  | { role: 'user'; content: string; isMeta?: boolean }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; usage?: Usage }
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
      /** 实战09 新增：这一轮真实的 token 用量，两端协议各自的字段名已经在 provider 内部抹平 */
      usage?: Usage
    }
  | {
      /**
       * 实战08 新增：独立频道的系统通知，不是 assistant 说的话——请求失败、判断值得重试时吐出来。
       * 消费端（loop.ts）看到这个事件，该做两件事：把它打印成单独一行（别跟 text_delta 拼在一起），
       * 并清空这一轮已经攒到一半的 text/toolCalls——无状态协议的重试是整包重发，上一次的碎片作废。
       */
      type: 'retry'
      attempt: number
      maxRetries: number
      delayMs: number
      reason: string
    }

/** 模型层的契约：谁想当一个 provider，就得实现它 */
export interface ModelProvider {
  readonly name: string
  /** 实战09 新增：压缩阈值要按模型算窗口大小（尽管眼下 getContextWindowForModel 对哪个模型都兜底同一个数） */
  readonly model: string
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
