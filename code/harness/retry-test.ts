// 直接喂假的 runOnce 给 withRetry，绕开真实网络（照 gate-test.ts 的"直调绕开外层壳"风格）——
// 重试这件事最难用真实 API 复现的就是"什么时候失败"，不如自己控制假请求第几次失败、失败成什么样。
import { withRetry, HttpError, RetryExhaustedError } from './src/retry'
import type { StreamEvent } from './src/types'

function fakeRunOnce(failTimes: number, status: number | undefined): () => AsyncGenerator<StreamEvent> {
  let calls = 0
  return async function* () {
    calls++
    if (calls <= failTimes) {
      const message = status === undefined ? 'network error: connect ECONNREFUSED' : `boom ${status}`
      throw status === undefined ? new Error(message) : new HttpError(status, message)
    }
    yield { type: 'text_delta', delta: `第 ${calls} 次成功` }
    yield { type: 'done', stopReason: 'end_turn' }
  }
}

async function run(label: string, runOnce: () => AsyncGenerator<StreamEvent>): Promise<void> {
  console.log(`\n===== ${label} =====`)
  try {
    for await (const event of withRetry(runOnce)) {
      if (event.type === 'text_delta') console.log(`  text_delta: ${event.delta}`)
      else if (event.type === 'retry') console.log(`  retry: 第 ${event.attempt}/${event.maxRetries} 次，${event.delayMs}ms 后重试——${event.reason}`)
      else if (event.type === 'done') console.log(`  done: ${event.stopReason}`)
    }
  } catch (err) {
    const kind = err instanceof RetryExhaustedError ? 'RetryExhaustedError' : (err as Error).name
    console.log(`  抛出 ${kind}: ${(err as Error).message}`)
  }
}

await run('502 失败 2 次，第 3 次成功——该重试且重试后活了', fakeRunOnce(2, 502))
await run('401 第 1 次就失败——不该重试，直接原样抛出', fakeRunOnce(99, 401))
await run('429 连续失败 4 次——超过上限 3 次，响亮抛出 RetryExhaustedError', fakeRunOnce(99, 429))
await run('网络层错误（没有状态码）失败 1 次，第 2 次成功——归类为可重试', fakeRunOnce(1, undefined))

// —— 整合验证：真的走到 AnthropicProvider.streamChat，不是只测孤立的 withRetry ——
// monkeypatch 掉全局 fetch：前两次回 502，第三次回一份真实形状的 SSE 流。
console.log('\n===== 整合验证：AnthropicProvider 真的经过 withRetry 重试，不是绕开它 =====')
const { AnthropicProvider } = await import('./src/providers/anthropic')

const sse = [
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"重试后活了"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
].join('')

let fetchCalls = 0
globalThis.fetch = (async () => {
  fetchCalls++
  if (fetchCalls <= 2) return new Response('upstream overloaded', { status: 502 })
  return new Response(sse, { status: 200 })
}) as typeof fetch

const provider = new AnthropicProvider('https://fake.local', 'fake-key', '', 'fake-model')
for await (const event of provider.streamChat([{ role: 'user', content: 'hi' }])) {
  if (event.type === 'text_delta') console.log(`  text_delta: ${event.delta}`)
  else if (event.type === 'retry') console.log(`  retry: 第 ${event.attempt}/${event.maxRetries} 次，${event.delayMs}ms 后重试——${event.reason}`)
  else if (event.type === 'done') console.log(`  done: ${event.stopReason}`)
}
console.log(`  一共调用了 fetch ${fetchCalls} 次`)
