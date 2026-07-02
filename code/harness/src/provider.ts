import type { ModelProvider } from './types'
import { AnthropicProvider } from './providers/anthropic'
import { OpenAICompatProvider } from './providers/openai'

/**
 * 按环境变量装配 provider —— 这就是"可插拔"的落点：
 * 换个 PROVIDER 环境变量（或换一端的 key），调用方一行都不用改。
 */
export function makeProvider(): ModelProvider {
  const kind = process.env.PROVIDER ?? 'anthropic'

  if (kind === 'anthropic') {
    const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
    const apiKey = process.env.ANTHROPIC_API_KEY || ''
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN || ''
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
    if (!apiKey && !authToken) throw new Error('缺 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN')
    return new AnthropicProvider(base, apiKey, authToken, model)
  }

  if (kind === 'openai' || kind === 'glm') {
    const base = process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
    const apiKey = process.env.OPENAI_API_KEY || ''
    const model = process.env.OPENAI_MODEL || 'glm-5'
    if (!apiKey) throw new Error('缺 OPENAI_API_KEY')
    return new OpenAICompatProvider(base, apiKey, model)
  }

  throw new Error(`未知 PROVIDER: ${kind}（用 anthropic | openai | glm）`)
}
