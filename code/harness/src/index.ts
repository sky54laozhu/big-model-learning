import { makeProvider } from './provider'
import { runAgent } from './loop'
import { allTools } from './tools'
import { buildSystemPrompt } from './systemPrompt'

// —— 调用方：对 provider 零分支，也对"转了几圈工具"零感知 ——
// 加工具后这里依然一个字没改：工具清单从注册表 allTools 整份取，不再手拼数组。
const provider = makeProvider()
const question = process.argv[2] ?? '读一下 package.json，告诉我这个项目叫什么、有哪些 npm 脚本。'

console.log(`\n[provider] ${provider.name}`)
console.log(`[you]      ${question}`)

// 实战07：每轮都带同一份系统提示词——静态基础指令 + 项目 CLAUDE.md + 环境信息/git 快照
const system = await buildSystemPrompt({ cwd: process.cwd() })

// 实战05：answer 已经在 runAgent 里边流边打到 stdout 了，这里不用再 console.log 一遍
await runAgent(provider, allTools, question, 10, true, system)
