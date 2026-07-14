import { access, mkdir, appendFile, readFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Message } from './types'

/**
 * Layer A：完整对话记录持久化（回扣源码 sessionStorage.ts）。
 * Keyed by cwd——同一个目录下跑的每一次 mini-harness，都归到同一个"项目"名下，
 * 换个目录跑就是另一个项目，历史互不可见（回扣源码 getProjectDir(getOriginalCwd())）。
 *
 * 存储位置故意选在仓库之外（~/.mini-harness/sessions/），不进 git——这是完整对话记录，
 * 不是给人看的文档，也不该被 git 当成项目文件追踪。
 *
 * 诚实简化：真源码是 100ms 防抖的写队列 + SIGINT 时 flush（应付长期运行、频繁追加的交互式
 * REPL）。我们的 harness 一次进程只发生"跑完 runAgent、退出"这一件事，消息数量以十为量级，
 * 没有"来不及写完进程就死了"的风险，所以直接 await 同步写完，不搭这套队列——不是漏做，
 * 是这道题在我们的单发架构里不存在（翻源码那节细讲）。
 */

function sanitizeCwd(cwd: string): string {
  // 真源码的 sanitizePath 要应付更多边界情况（Windows 盘符、特殊字符）；这里只处理路径分隔符
  return cwd.replace(/[/\\]/g, '-').replace(/^-+/, '')
}

async function getProjectDir(cwd: string): Promise<string> {
  const dir = join(homedir(), '.mini-harness', 'sessions', sanitizeCwd(cwd))
  await mkdir(dir, { recursive: true })
  return dir
}

async function sessionFilePath(cwd: string, sessionId: string): Promise<string> {
  return join(await getProjectDir(cwd), `${sessionId}.jsonl`)
}

/** 回扣源码 sessionIdExists：单纯的存在性检查，用来做 --session-id 的查重 */
export async function sessionIdExists(cwd: string, sessionId: string): Promise<boolean> {
  try {
    await access(await sessionFilePath(cwd, sessionId), fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

/** 没指定 --session-id 时的默认路径：生成一个新 UUID，跟查重逻辑复用同一个存在性检查 */
export async function createSessionId(cwd: string): Promise<string> {
  let id = randomUUID()
  while (await sessionIdExists(cwd, id)) id = randomUUID() // 概率极低，仍按源码留这道查重
  return id
}

/** 每有一条新消息落定，就追加一行 JSONL——不是等到进程退出才一次性写完 */
export async function appendSessionEntry(cwd: string, sessionId: string, message: Message): Promise<void> {
  const path = await sessionFilePath(cwd, sessionId)
  await appendFile(path, JSON.stringify(message) + '\n', 'utf-8')
}

/** --resume 用：读回整份历史，文件不存在返回 null（调用方拿 null 当"没这个会话"处理） */
export async function loadSessionMessages(cwd: string, sessionId: string): Promise<Message[] | null> {
  const path = await sessionFilePath(cwd, sessionId)
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return null
  }
  return raw
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Message)
}
