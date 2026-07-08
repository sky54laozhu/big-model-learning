import type { ModelProvider, Tool, Message, ToolCall } from './types'
import { checkPermission, askHuman, grantAlways, newSession } from './permission'

/**
 * agent loop 骨架 = 把 实战01 的单圈 chat() 套进 while（回扣概念 24：agent 就这么点骨架，无黑魔法）。
 * 循环条件不看 stopReason 字符串，看这一轮攒到的 toolCalls 有没有——模型这轮还要不要工具
 * （回扣源码 query.ts §554）。maxTurns 是"炸"的护栏：死循环时强制刹车（回扣概念 24 三祸之一）。
 *
 * 实战04 新增：execute 前插一道权限闸门（gate=false 退回实战03 的"裸奔"= bypassPermissions mode）。
 * 实战06 重建：不再等 chat() 憋出一整包 ChatReply，而是 for await 消费 streamChat() 的事件流——
 * text_delta 边到边写 stdout，tool_call 边到边收进本轮的数组，直到 done 才知道这轮该不该收工。
 */
export async function runAgent(
  provider: ModelProvider,
  tools: Tool[],
  userInput: string,
  maxTurns = 10,
  gate = true,
): Promise<string> {
  const messages: Message[] = [{ role: 'user', content: userInput }]
  const toolByName = new Map(tools.map(t => [t.name, t]))
  const session = newSession()   // 会话级"总是允许"规则，只活在这一次运行里

  process.stdout.write('\n[assistant] ') // 实战05：字从这儿开始一个个蹦出来，不再等模型说完整段才见字

  for (let turn = 1; turn <= maxTurns; turn++) {
    let text = ''
    const toolCalls: ToolCall[] = []
    for await (const event of provider.streamChat(messages, tools)) {
      if (event.type === 'text_delta') {
        text += event.delta
        process.stdout.write(event.delta)
      } else if (event.type === 'tool_call') {
        toolCalls.push(event.call)
      }
      // done 事件本身不用管——收没收到过 tool_call 才是"这轮要不要继续"的判断依据
    }

    // 模型这轮没请求工具 → 收工（谁决定停 = 模型不再吐 toolCall，把开关交给模型）
    if (toolCalls.length === 0) {
      process.stdout.write('\n')
      return text
    }

    // 模型要工具：先把它这轮的请求作为 assistant 轮记进历史（缝 id 用，下一轮结果要对回来）
    messages.push({ role: 'assistant', content: text, toolCalls })

    console.log() // 跟刚流出来的文本隔开一行，工具日志另起一段

    // 逐个执行，结果作为 tool 消息塞回 messages，供下一轮模型看到
    for (const call of toolCalls) {
      const tool = toolByName.get(call.name)
      const result = tool
        ? await runWithGate(tool, call.args, session, gate)
        : `error: 未知工具 ${call.name}`
      const preview = result.slice(0, 60).replace(/\s+/g, ' ')
      console.log(`  [turn ${turn}] ${call.name}(${JSON.stringify(call.args)}) -> ${preview}…`)
      messages.push({ role: 'tool', toolCallId: call.id, content: result })
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
