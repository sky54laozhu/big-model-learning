import { makeProvider } from './provider'
import { runAgent } from './loop'
import { createAllTools } from './tools'
import { buildSystemPrompt } from './systemPrompt'
import { validateUuid } from './uuid'
import { createSessionId, sessionIdExists, loadSessionMessages } from './session'
import type { Message } from './types'

const DEFAULT_QUESTION = '读一下 package.json，告诉我这个项目叫什么、有哪些 npm 脚本。'

/** 只认两个 flag（各带一个值），剩下的 token 拼回去当问题——不用第三方 argv 解析库，够简单 */
function parseArgs(argv: string[]): { question: string; sessionIdFlag?: string; resumeId?: string } {
  let sessionIdFlag: string | undefined
  let resumeId: string | undefined
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--session-id') sessionIdFlag = argv[++i]
    else if (argv[i] === '--resume') resumeId = argv[++i]
    else rest.push(argv[i] as string)
  }
  return { question: rest.join(' '), sessionIdFlag, resumeId }
}

const cwd = process.cwd()
const { question: parsedQuestion, sessionIdFlag, resumeId } = parseArgs(process.argv.slice(2))

// 实战10：--resume 和 --session-id 二选一，都给严格 UUID 校验——不接受 .jsonl 路径/URL，
// 也不做模糊匹配（回扣折叠点：这道题真源码支持更宽，我们故意只留 UUID 这一种）
let sessionId: string
let resumeMessages: Message[] | undefined

if (resumeId !== undefined) {
  const validId = validateUuid(resumeId)
  if (!validId) {
    console.error(`error: --resume 后面必须是合法 UUID，收到的是 "${resumeId}"`)
    process.exit(1)
  }
  const loaded = await loadSessionMessages(cwd, validId)
  if (!loaded) {
    console.error(`error: 在当前目录下找不到会话 ${validId}`)
    process.exit(1)
  }
  sessionId = validId
  resumeMessages = loaded
} else if (sessionIdFlag !== undefined) {
  const validId = validateUuid(sessionIdFlag)
  if (!validId) {
    console.error(`error: --session-id 后面必须是合法 UUID，收到的是 "${sessionIdFlag}"`)
    process.exit(1)
  }
  if (await sessionIdExists(cwd, validId)) {
    console.error(`error: 会话 ${validId} 已经存在，换一个 id 或用 --resume 接着用这个`)
    process.exit(1)
  }
  sessionId = validId
} else {
  sessionId = await createSessionId(cwd)
}

const question = parsedQuestion || DEFAULT_QUESTION

// —— 调用方：对 provider 零分支，也对"转了几圈工具"零感知 ——
// 实战12 起，工具清单不再是静态 import：task 工具要闭包住 provider/gate，只能等 provider
// 造出来之后再组装（回扣 tools/index.ts 的 createAllTools 工厂函数）。
const provider = makeProvider()
const tools = createAllTools(provider, true)

console.log(`\n[provider] ${provider.name}`)
console.log(`[session]  ${sessionId}${resumeMessages ? `（接着 ${resumeMessages.length} 条历史往下说）` : ''}`)
console.log(`[you]      ${question}`)

// 实战07：每轮都带同一份系统提示词——静态基础指令 + 项目 CLAUDE.md + 环境信息/git 快照
const system = await buildSystemPrompt({ cwd })

// 实战05：answer 已经在 runAgent 里边流边打到 stdout 了，这里不用再 console.log 一遍
await runAgent(provider, tools, question, 10, true, system, cwd, sessionId, resumeMessages)
