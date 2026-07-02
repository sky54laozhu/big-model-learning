import { makeProvider } from './provider'
import { runAgent } from './loop'
import { readFileTool } from './tools/read_file'

// —— 调用方：对 provider 零分支，也对"转了几圈工具"零感知 ——
// 它只管把工具清单和问题交给 runAgent，剩下的循环/分流/翻译全在 harness 里。
const provider = makeProvider()
const question = process.argv[2] ?? '读一下 package.json，告诉我这个项目叫什么、有哪些 npm 脚本。'

console.log(`\n[provider] ${provider.name}`)
console.log(`[you]      ${question}\n`)

const answer = await runAgent(provider, [readFileTool], question)

console.log(`\n[assistant] ${answer}`)
