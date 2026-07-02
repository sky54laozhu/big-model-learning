import { makeProvider } from './provider'
import type { Message } from './types'

// —— 调用方：对 provider 零分支 ——
// 它不知道、也不关心底下接的是 Anthropic 还是 GLM，只跟 ModelProvider 契约打交道。
const provider = makeProvider()
const question = process.argv[2] ?? '用一句话解释什么是大语言模型。'

const messages: Message[] = [{ role: 'user', content: question }]
const reply = await provider.chat(messages)

console.log(`\n[provider]    ${provider.name}`)
console.log(`[you]         ${question}`)
console.log(`[assistant]   ${reply.text}`)
console.log(`[stop_reason] ${reply.stopReason}`)
