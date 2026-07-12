// 验证"长对话不爆窗口"：先拿纯函数摆边界值，再整合跑一遍 runAgent，逼真实的循环走一次压缩
// （照 retry-test.ts 的两段式风格：先孤立测算法，再整合验证真的经过它、不是绕开它）。
import { getAutoCompactThreshold, tokenCountWithEstimation, shouldAutoCompact } from './src/compact'
import { runAgent } from './src/loop'
import type { ModelProvider, StreamEvent, Message, Tool } from './src/types'

console.log('===== 验证①：阈值三常量算出来的门槛 =====')
const threshold = getAutoCompactThreshold('fake-model')
console.log(`  getAutoCompactThreshold('fake-model') = ${threshold}`)
console.log(`  等价于 200_000 - 20_000(摘要预留) - 13_000(安全垫) = ${200_000 - 20_000 - 13_000}`)

console.log('\n===== 验证②：tokenCountWithEstimation 边界——按最后一条带 usage 的 assistant 消息算，不是数字符串 =====')
const below: Message[] = [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '你好呀', usage: { inputTokens: 100, outputTokens: 20 } },
]
const atThreshold: Message[] = [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '你好呀', usage: { inputTokens: threshold - 10, outputTokens: 10 } },
]
const overThreshold: Message[] = [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '你好呀', usage: { inputTokens: threshold + 500, outputTokens: 0 } },
]
console.log(`  below 用量 120，够不着阈值：tokenCount=${tokenCountWithEstimation(below)}，shouldAutoCompact=${shouldAutoCompact(below, 'fake-model')}`)
console.log(`  atThreshold 卡在门槛上：tokenCount=${tokenCountWithEstimation(atThreshold)}，shouldAutoCompact=${shouldAutoCompact(atThreshold, 'fake-model')}`)
console.log(`  overThreshold 越过门槛：tokenCount=${tokenCountWithEstimation(overThreshold)}，shouldAutoCompact=${shouldAutoCompact(overThreshold, 'fake-model')}`)

// —— 整合验证：真的走到 runAgent 的每轮检查点，不是只测孤立的 shouldAutoCompact ——
console.log('\n===== 验证③：整合跑一遍 runAgent——用量越过阈值后，下一轮开口前自动压缩，对话继续不崩 =====')

// 回扣 compact.ts 里 compactMessages 用的那句压缩专用 system——测试用假 provider 靠这句话
// 分辨"这次 streamChat 调用是不是压缩请求"，跟真实 loop.ts 走的是同一条判断路径。
const COMPACT_SYSTEM_PROMPT = 'You are a helpful AI assistant tasked with summarizing conversations.'

class FakeProvider implements ModelProvider {
  readonly name = 'fake'
  readonly model = 'fake-model'
  turnCount = 0
  compactCallCount = 0

  async *streamChat(_messages: Message[], _tools?: Tool[], system?: string): AsyncGenerator<StreamEvent> {
    if (system === COMPACT_SYSTEM_PROMPT) {
      this.compactCallCount++
      yield { type: 'text_delta', delta: '<analysis>省略</analysis><summary>前面一大段对话已经摘要成这几句</summary>' }
      yield { type: 'done', stopReason: 'end_turn' }
      return
    }

    this.turnCount++
    if (this.turnCount === 1) {
      // 第一轮：故意报一份越过阈值的巨额用量，并带一个工具调用逼着循环走进第二轮
      yield { type: 'text_delta', delta: '我需要先查一下环境' }
      yield { type: 'tool_call', call: { id: 'call_1', name: 'noop', args: {} } }
      yield { type: 'done', stopReason: 'tool_use', usage: { inputTokens: threshold + 500, outputTokens: 500 } }
      return
    }

    // 压缩之后的这一轮：正常收尾，不再要工具
    yield { type: 'text_delta', delta: '压缩之后，继续把任务做完' }
    yield { type: 'done', stopReason: 'end_turn' }
  }
}

const noopTool: Tool = {
  name: 'noop',
  description: '什么都不做，只用来逼一轮工具循环，好让第二轮触发压缩检查',
  parameters: {},
  execute: async () => 'ok',
}

const provider = new FakeProvider()
const result = await runAgent(provider, [noopTool], '帮我做一件需要先查环境的事', 5, false)
console.log(`\n[最终回复] ${result}`)
console.log(`[压缩调用次数] ${provider.compactCallCount}（应为 1：只在越过阈值的那一轮触发一次，之后不再重复触发）`)
