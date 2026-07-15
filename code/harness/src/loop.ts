import type { ModelProvider, Tool, Message, ToolCall, Usage } from './types'
import { checkPermission, askHuman, grantAlways, newSession } from './permission'
import { shouldAutoCompact, compactMessages } from './compact'
import { shouldRemindTodo, buildTodoReminderMessage } from './todoReminder'
import { appendSessionEntry } from './session'

/**
 * agent loop 骨架 = 把 实战01 的单圈 chat() 套进 while（回扣概念 24：agent 就这么点骨架，无黑魔法）。
 * 循环条件不看 stopReason 字符串，看这一轮攒到的 toolCalls 有没有——模型这轮还要不要工具
 * （回扣源码 query.ts §554）。maxTurns 是"炸"的护栏：死循环时强制刹车（回扣概念 24 三祸之一）。
 *
 * 实战04 新增：execute 前插一道权限闸门（gate=false 退回实战03 的"裸奔"= bypassPermissions mode）。
 * 实战06 重建：不再等 chat() 憋出一整包 ChatReply，而是 for await 消费 streamChat() 的事件流——
 * text_delta 边到边写 stdout，tool_call 边到边收进本轮的数组，直到 done 才知道这轮该不该收工。
 * 实战07 新增：system 可选，整场对话每一轮都原样带上同一份系统提示词——它不进 messages
 * 历史（那是"发生过什么"），是每轮请求单独一份"这轮该怎么表现"，回扣折叠点①。
 * 实战08 新增：streamChat 内部失败会自己重试，重试时吐一个独立频道的 retry 事件——收到它，
 * 已经打到屏幕上的碎片留在原地不撤回，但这一轮攒的 text/toolCalls 要清空重来（无状态协议，
 * 重试=整包重发，不是接着上次没说完的地方续），退避真的等完才会有下一条事件到达。
 * 实战10 新增：cwd/sessionId 齐了才落盘（Layer A）——resumeMessages 是 --resume 读回的历史，
 * 拼在新问题前面；messages 里每新增一条（含这轮的用户提问）都顺手 appendSessionEntry 一次，
 * 不等收工才一次性写完（回扣源码：我们的单发架构没有"来不及写完进程就死了"这道题）。
 * 实战11 新增：每轮开口前，跟压缩检查同一个位置，再看一眼"该不该提醒用 todo_write"——
 * 两把尺子都过线（好久没写、好久没提醒过）就塞一条 role:'user'+isMeta 的提醒消息进 messages
 * （回扣折叠点⑤：摆在这里，而不是另开一条独立的检查路径，因为它跟压缩检查是同一种"每轮开工前
 * 的自检"，没道理分成两处）。
 */
export async function runAgent(
  provider: ModelProvider,
  tools: Tool[],
  userInput: string,
  maxTurns = 10,
  gate = true,
  system?: string,
  cwd?: string,
  sessionId?: string,
  resumeMessages?: Message[],
): Promise<string> {
  const userMessage: Message = { role: 'user', content: userInput }
  const messages: Message[] = [...(resumeMessages ?? []), userMessage]
  const toolByName = new Map(tools.map(t => [t.name, t]))
  const session = newSession()   // 会话级"总是允许"规则，只活在这一次运行里

  /** cwd/sessionId 都给了才落盘；resume 读回的历史已经在磁盘上了，不重复写 */
  const record = (message: Message): Promise<void> =>
    cwd && sessionId ? appendSessionEntry(cwd, sessionId, message) : Promise.resolve()

  await record(userMessage)

  process.stdout.write('\n[assistant] ') // 实战05：字从这儿开始一个个蹦出来，不再等模型说完整段才见字

  for (let turn = 1; turn <= maxTurns; turn++) {
    // 实战09：每轮开口前先看这一眼——历史顶到阈值就先压缩，压缩后 messages 整段被摘要替换掉
    // （splice 就地整段换血，不是重新 const 一个数组：外面握着的是同一个引用，回扣 折叠点：
    // 本章只做"整段替换"，没有 messagesToKeep 那道局部保留的裁剪线）
    if (shouldAutoCompact(messages, provider.model)) {
      process.stdout.write('\n[压缩] 历史接近上下文窗口阈值，正在摘要…\n')
      const compacted = await compactMessages(provider, messages)
      messages.splice(0, messages.length, ...compacted)
      process.stdout.write('[压缩] 完成，继续对话\n[assistant] ')
    }

    // 实战11：好久没写 todo_write、好久没提醒过——两把尺子都过线才塞一条提醒消息，
    // 跟其他消息一样 push 进 messages 并 record，让它进入这轮请求也进入 Layer A 落盘
    if (shouldRemindTodo(messages)) {
      const reminder = buildTodoReminderMessage()
      messages.push(reminder)
      await record(reminder)
    }

    let text = ''
    const toolCalls: ToolCall[] = []
    let usage: Usage | undefined
    for await (const event of provider.streamChat(messages, tools, system)) {
      if (event.type === 'text_delta') {
        text += event.delta
        process.stdout.write(event.delta)
      } else if (event.type === 'tool_call') {
        toolCalls.push(event.call)
      } else if (event.type === 'retry') {
        // 独立频道通知：单独一行，不跟 assistant 的文本拼在一起；这一轮攒到一半的碎片作废重来
        const seconds = (event.delayMs / 1000).toFixed(1)
        process.stdout.write(`\n⚠ 请求失败，${seconds}s 后重试（第 ${event.attempt}/${event.maxRetries} 次）：${event.reason}\n[assistant] `)
        text = ''
        toolCalls.length = 0
      } else if (event.type === 'done') {
        // 实战09：这一轮真实的 token 用量随 done 事件到达——记下来，待会儿跟着这轮的 assistant
        // 消息一起存进历史（回扣源码 tokens.ts：用量长在消息自己身上，不是另开一个跨轮计数器）
        usage = event.usage
      }
    }

    // 模型这轮没请求工具 → 收工（谁决定停 = 模型不再吐 toolCall，把开关交给模型）
    if (toolCalls.length === 0) {
      process.stdout.write('\n')
      // 这条最终回复不会进 messages（循环马上就退出了），但 Layer A 仍要记下来——不然
      // 存下来的完整记录里会缺最后一句话
      await record({ role: 'assistant', content: text, usage })
      return text
    }

    // 模型要工具：先把它这轮的请求作为 assistant 轮记进历史（缝 id 用，下一轮结果要对回来）
    const assistantTurn: Message = { role: 'assistant', content: text, toolCalls, usage }
    messages.push(assistantTurn)
    await record(assistantTurn)

    console.log() // 跟刚流出来的文本隔开一行，工具日志另起一段

    // 逐个执行，结果作为 tool 消息塞回 messages，供下一轮模型看到
    for (const call of toolCalls) {
      const tool = toolByName.get(call.name)
      const result = tool
        ? await runWithGate(tool, call.args, session, gate)
        : `error: 未知工具 ${call.name}`
      const preview = result.slice(0, 60).replace(/\s+/g, ' ')
      console.log(`  [turn ${turn}] ${call.name}(${JSON.stringify(call.args)}) -> ${preview}…`)
      const toolTurn: Message = { role: 'tool', toolCallId: call.id, content: result }
      messages.push(toolTurn)
      await record(toolTurn)
    }
  }
  process.stdout.write('\n')
  return `（达到最大轮数 ${maxTurns}，强制停止）`
}

/**
 * 闸门 + 执行：唯一的收口。三态各走一条路——
 * deny → 不执行，把拒绝回灌给模型（响亮失败，让它换个安全做法，回扣实战03）；
 * ask  → 问人：拒就回灌"用户拒绝"，允许（或本会话总是允许）才真执行；
 * allow→ 直接执行。
 */
async function runWithGate(
  tool: Tool,
  args: any,
  session: ReturnType<typeof newSession>,
  gate: boolean,
): Promise<string> {
  if (!gate) return tool.execute(args)   // bypass mode：退回实战03 裸奔版

  const decision = checkPermission(tool, args, session)
  if (decision.behavior === 'deny') {
    return `error: 权限被拒——${decision.reason}。请换一个更安全的做法。`
  }
  if (decision.behavior === 'ask') {
    const approval = await askHuman(decision.reason)
    if (approval === 'no') return `error: 用户拒绝了这次 ${tool.name} 调用。`
    if (approval === 'always') grantAlways(session, tool.name, args)
  }
  return tool.execute(args)
}
