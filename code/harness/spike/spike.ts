export {} // 让本文件成为 ES 模块（顶层 await 需要）
// provider 双端 spike —— 实战01 写码前的关卡验证
//
// 问题：Anthropic 流式 tool_use（content_block + input_json_delta 增量拼 JSON）
//       与 OpenAI/GLM 流式 tool_calls（choices[].delta.tool_calls[].function.arguments 分片）
//       线格式完全不同。一个 ModelProvider 接口能同时装下两端吗？
//
// 做法：定义一套「归一化事件流」，两个 provider 各自把自家 SSE 翻成同一套事件。
//       若调用方（下面的 runOnce）对两端代码零分支、拿到结构一致的 tool call，即证明抽象成立。
//
// 运行：bun run spike/spike.ts anthropic | glm | both

// ---------- 归一化事件（ModelProvider 对外吐这些，调用方只认这些） ----------
type NormEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_arg'; id: string; deltaJson: string }
  | { type: 'tool_end'; id: string }
  | { type: 'done'; stopReason: string }

type ToolDef = { name: string; description: string; parameters: Record<string, unknown> }
type Msg = { role: 'user' | 'assistant'; content: string }

interface ModelProvider {
  readonly label: string
  streamChat(messages: Msg[], tools: ToolDef[]): AsyncGenerator<NormEvent>
}

// ---------- 通用 SSE 逐行解析（把 chunk 拆成 data: 行） ----------
async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
}

// ---------- Anthropic 协议 provider ----------
class AnthropicProvider implements ModelProvider {
  readonly label = 'anthropic'
  constructor(
    private base: string,
    private key: string,
    private authToken: string,
    private model: string,
  ) {}

  async *streamChat(messages: Msg[], tools: ToolDef[]): AsyncGenerator<NormEvent> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    }
    // 直连用 x-api-key；聚合器（zenmux 等）多用 Authorization: Bearer
    if (this.authToken) headers['authorization'] = `Bearer ${this.authToken}`
    else headers['x-api-key'] = this.key

    const res = await fetch(`${this.base}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        stream: true,
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        messages,
      }),
    })
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`)

    // content block index → tool id（只有 tool_use 块记）
    const blockTool = new Map<number, string>()
    let stopReason = 'end_turn'

    for await (const data of sseLines(res)) {
      if (!data || data === '[DONE]') continue
      const ev = JSON.parse(data)
      switch (ev.type) {
        case 'content_block_start': {
          const cb = ev.content_block
          if (cb?.type === 'tool_use') {
            blockTool.set(ev.index, cb.id)
            yield { type: 'tool_start', id: cb.id, name: cb.name }
          }
          break
        }
        case 'content_block_delta': {
          const d = ev.delta
          if (d?.type === 'text_delta') yield { type: 'text', text: d.text }
          else if (d?.type === 'input_json_delta') {
            const id = blockTool.get(ev.index)
            if (id) yield { type: 'tool_arg', id, deltaJson: d.partial_json }
          }
          break
        }
        case 'content_block_stop': {
          const id = blockTool.get(ev.index)
          if (id) yield { type: 'tool_end', id }
          break
        }
        case 'message_delta': {
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason
          break
        }
      }
    }
    yield { type: 'done', stopReason }
  }
}

// ---------- OpenAI 兼容 provider（GLM 等） ----------
class OpenAICompatProvider implements ModelProvider {
  readonly label = 'openai-compat'
  constructor(
    private base: string,
    private key: string,
    private model: string,
  ) {}

  async *streamChat(messages: Msg[], tools: ToolDef[]): AsyncGenerator<NormEvent> {
    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.key}`,
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        tools: tools.map(t => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        messages,
      }),
    })
    if (!res.ok) throw new Error(`openai-compat ${res.status}: ${await res.text()}`)

    // tool_calls 分片按 index 聚合；只有首片带 id+name，后续片只有 arguments
    const idxId = new Map<number, string>()
    const started = new Set<number>()
    let stopReason = 'stop'

    for await (const data of sseLines(res)) {
      if (!data || data === '[DONE]') continue
      const ev = JSON.parse(data)
      const choice = ev.choices?.[0]
      if (!choice) continue
      const delta = choice.delta
      if (delta?.content) yield { type: 'text', text: delta.content }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0
          if (tc.id && !idxId.has(i)) idxId.set(i, tc.id)
          const id = idxId.get(i) ?? `idx-${i}`
          if (!started.has(i) && tc.function?.name) {
            started.add(i)
            yield { type: 'tool_start', id, name: tc.function.name }
          }
          if (tc.function?.arguments) {
            yield { type: 'tool_arg', id, deltaJson: tc.function.arguments }
          }
        }
      }
      if (choice.finish_reason) {
        stopReason = choice.finish_reason
        for (const i of started) yield { type: 'tool_end', id: idxId.get(i) ?? `idx-${i}` }
      }
    }
    yield { type: 'done', stopReason }
  }
}

// ---------- 调用方：对两端零分支，只认归一化事件 ----------
async function runOnce(p: ModelProvider) {
  console.log(`\n===== provider: ${p.label} =====`)
  const tools: ToolDef[] = [
    {
      name: 'get_weather',
      description: '查询某城市当前天气',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: '城市名' } },
        required: ['city'],
      },
    },
  ]
  const messages: Msg[] = [{ role: 'user', content: '北京现在天气怎么样？用工具查一下。' }]

  const toolArgs = new Map<string, string>()
  const toolName = new Map<string, string>()
  let text = ''
  let stop = ''

  for await (const ev of p.streamChat(messages, tools)) {
    switch (ev.type) {
      case 'text':
        text += ev.text
        process.stdout.write(ev.text)
        break
      case 'tool_start':
        toolName.set(ev.id, ev.name)
        toolArgs.set(ev.id, '')
        console.log(`\n[tool_start] ${ev.name} (${ev.id})`)
        break
      case 'tool_arg':
        toolArgs.set(ev.id, (toolArgs.get(ev.id) ?? '') + ev.deltaJson)
        break
      case 'tool_end':
        console.log(`[tool_end]   ${toolName.get(ev.id)} args=${toolArgs.get(ev.id)}`)
        break
      case 'done':
        stop = ev.stopReason
        break
    }
  }
  console.log(`\n[done] stop_reason=${stop}`)
  // 归一化产物：两端跑完这里结构完全一致
  console.log('[normalized tool calls]', [...toolArgs.entries()].map(([id, args]) => ({
    name: toolName.get(id), args: safeParse(args),
  })))
}

function safeParse(s: string) {
  try { return JSON.parse(s) } catch { return s }
}

// ---------- 装配 ----------
function buildAnthropic(): ModelProvider {
  const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
  const key = process.env.ANTHROPIC_API_KEY || ''
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN || ''
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
  if (!key && !authToken) throw new Error('缺 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN')
  return new AnthropicProvider(base, key, authToken, model)
}

function buildGLM(): ModelProvider {
  const base = process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
  const key = process.env.OPENAI_API_KEY || process.env.ZHIPUAI_API_KEY || ''
  const model = process.env.OPENAI_MODEL || 'glm-4.6'
  if (!key) throw new Error('缺 OPENAI_API_KEY / ZHIPUAI_API_KEY')
  return new OpenAICompatProvider(base, key, model)
}

const which = process.argv[2] || 'both'
try {
  if (which === 'anthropic' || which === 'both') await runOnce(buildAnthropic())
  if (which === 'glm' || which === 'both') await runOnce(buildGLM())
} catch (e) {
  console.error('spike 失败：', (e as Error).message)
  process.exit(1)
}
