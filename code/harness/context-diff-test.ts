// 三版 system prompt 对比：同一个问题，同一个 provider，真跑模型（照 gate-test.ts 的"直接调用绕开外层壳"风格，
// 但这一篇要看的是模型的真实反应，不是纯函数返回值，所以少不了真实 API 调用）。
// 纯聊天模式（不传 tools）——隔离掉"模型自己用工具查出环境"这个混淆变量，只看 system prompt 本身的效果。
import { makeProvider } from './src/provider'
import { buildSystemPrompt } from './src/systemPrompt'
import type { Message } from './src/types'

const provider = makeProvider()
const question = '你好，请介绍一下你自己，并说说你知不知道当前 git 仓库的分支和未提交改动。'

async function ask(label: string, system?: string): Promise<void> {
  console.log(`\n===== ${label} =====`)
  console.log(system ? `--- system prompt ---\n${system}\n--- end system prompt ---\n` : '(无 system prompt)\n')

  const messages: Message[] = [{ role: 'user', content: question }]
  for await (const event of provider.streamChat(messages, undefined, system)) {
    if (event.type === 'text_delta') process.stdout.write(event.delta)
  }
  console.log('\n')
}

const minimal = await buildSystemPrompt({ cwd: process.cwd(), includeMemory: false, includeEnvInfo: false })
const full = await buildSystemPrompt({ cwd: process.cwd() })

await ask('版本 A：完全没有 system prompt（实战07 之前的样子）', undefined)
await ask('版本 B：只有静态基础指令（没读 CLAUDE.md，没有环境信息）', minimal)
await ask('版本 C：完整版（静态指令 + CLAUDE.md + 环境信息 + git 快照）', full)
