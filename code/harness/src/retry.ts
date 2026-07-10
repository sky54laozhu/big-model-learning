import type { StreamEvent } from './types'

/**
 * 带 HTTP 状态码的错误——两个 provider 的 `!res.ok` 分支都该抛这个，
 * 好让下面按状态码分类，而不是只有一句拼好的文本可读。
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** 重试用尽后的"响亮失败"——带上试了几次、最后一次错在哪，不把原因吞掉（回扣实战03 响亮 vs 无声失败） */
export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`重试 ${attempts} 次后仍失败：${reason}`)
    this.name = 'RetryExhaustedError'
  }
}

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

/**
 * 分类：网络层错误（fetch 自己抛的，没有 HTTP 状态码——DNS/连接/超时）和 429/5xx，大概率是"这次
 * 临时不巧"，换个时机很可能就好；400/401 这类"请求本身就有问题"，重试只是原样再犯一次错，纯粹
 * 浪费用户的等待时间（回扣源码 errors.ts 的 shouldRetry：4xx 只有 429 这类会重试，5xx 都重试）。
 */
export function isRetryable(status: number | undefined): boolean {
  if (status === undefined) return true
  if (status === 429) return true
  return status >= 500
}

/** 指数退避：1s → 2s → 4s——给过载的服务器留出喘气的时间，别按固定节奏接着捶（实战08 折叠点） */
export function backoffDelay(attempt: number): number {
  return BASE_DELAY_MS * 2 ** (attempt - 1)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function extractHttpStatus(error: unknown): number | undefined {
  return error instanceof HttpError ? error.status : undefined
}

/**
 * 把"值不值得重试、等多久、试几次"这套节奏，套在任意一次流式请求外面——两个 provider 共用。
 * runOnce 每次调用都是一次全新的请求：Messages/Chat Completions 都是无状态协议，没有"接着上次
 * 没说完的地方续吐"这个概念，重试只能是整包重发，上一次攒到哪个字、哪个工具调用，这次全部作废
 * （实战08 折叠点：无状态 → 重试 = 整包重发）。
 *
 * runOnce 一次成功跑完（没抛错，走到它自己的 done 事件）就直接收工；跑到底还失败，
 * 抛 RetryExhaustedError 让它响亮地炸出去，不在这里悄悄吞掉。
 */
export async function* withRetry(runOnce: () => AsyncGenerator<StreamEvent>): AsyncGenerator<StreamEvent> {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      yield* runOnce()
      return
    } catch (err) {
      const status = extractHttpStatus(err)
      if (!isRetryable(status)) throw err // 400/401 这类：重试只是原样再犯一次错，直接原样抛出，不算"耗尽"
      if (attempt > MAX_RETRIES) throw new RetryExhaustedError(attempt - 1, err)
      const delayMs = backoffDelay(attempt)
      // 独立频道的系统通知，不混进 assistant 的文本流——上一次已经吐到屏幕上的碎片留在原地，
      // 但逻辑上这次要干净重开，消费端（loop.ts）看到这个事件就该清空这一轮攒到一半的 text/toolCalls
      yield {
        type: 'retry',
        attempt,
        maxRetries: MAX_RETRIES,
        delayMs,
        reason: err instanceof Error ? err.message : String(err),
      }
      await sleep(delayMs)
    }
  }
}
