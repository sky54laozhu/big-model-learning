import { makeProvider } from './provider'
import { runAgent } from './loop'
import { allTools } from './tools'

// —— 调用方：对 provider 零分支，也对"转了几圈工具"零感知 ——
// 加工具后这里依然一个字没改：工具清单从注册表 allTools 整份取，不再手拼数组。
const provider = makeProvider()
const question = process.argv[2] ?? '读一下 package.json，告诉我这个项目叫什么、有哪些 npm 脚本。'

console.log(`\n[provider] ${provider.name}`)
console.log(`[you]      ${question}\n`)

const answer = await runAgent(provider, allTools, question)

console.log(`\n[assistant] ${answer}`)
