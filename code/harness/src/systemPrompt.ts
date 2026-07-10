import { readFile } from 'node:fs/promises'

/**
 * 系统提示词装配（实战07）——静态基础指令是硬编码在这个文件里的字符串，跟任何运行时状态零依赖；
 * 项目 CLAUDE.md、环境信息、git 状态这三段才是"动态"的——但"动态"在这里的意思不是"每轮重算"，
 * 是"绑定会话生命周期、会随 /clear 一类事件失效重算"（回扣折叠点⑦）。这一篇的 harness 一次运行
 * 就是一场会话，所以进程级缓存（下面的 cachedGitStatus）恰好等价于会话级缓存，不是偷懒。
 *
 * 装配顺序：静态指令 → 记忆（CLAUDE.md） → 环境信息 → git 状态快照——跟折叠点⑤核对过的真实
 * 顺序一致（memory 排在 env_info 前面）。工具描述不出现在这里：它走独立的 tools 参数（折叠点①）。
 */
const BASE_INSTRUCTIONS = `你是运行在终端里的编程助手 mini-harness。
- 回答用中文，简洁直接，不说无意义的客套话
- 需要动手（读写文件、跑命令）时用工具，不要凭空猜文件内容
- 不确定的事情，明确说"不确定"，不要编答案`

let cachedGitStatus: string | null = null

/** 项目自己的记忆文件——真源码是四层来源+多级目录发现（翻源码那节细讲），这里只读 cwd 这一层，诚实简化 */
async function loadMemory(cwd: string): Promise<string | null> {
  try {
    const content = await readFile(`${cwd}/CLAUDE.md`, 'utf-8')
    return content.trim() || null
  } catch {
    return null // 文件不存在就静默跳过——真源码同样是"找不到就算了"，不报错
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return proc.exitCode === 0 ? out.trim() : ''
  } catch {
    return ''
  }
}

/** 真实 git 状态快照——只在本次进程里算一次（≈一场会话算一次），不是每轮重算 */
async function computeGitStatus(cwd: string): Promise<string> {
  const [branch, status, log] = await Promise.all([
    runGit(cwd, ['branch', '--show-current']),
    runGit(cwd, ['status', '--short']),
    runGit(cwd, ['log', '--oneline', '-n', '5']),
  ])
  return [
    '这是对话开始时的 git 状态快照，只代表那一刻——对话过程中不会自动更新（回扣折叠点②③：',
    '模型如果怀疑这份快照过期了，应该自己用 bash 工具跑 git 去核实，不是伸手等 harness 喂新的）。',
    `当前分支: ${branch || '(unknown)'}`,
    `未提交改动:\n${status || '(clean)'}`,
    `最近提交:\n${log || '(no history)'}`,
  ].join('\n')
}

export interface SystemPromptOptions {
  cwd: string
  /** 关掉它 = 折叠点⑤对比实验里的"精简版"：没有项目规则，模型只剩静态指令 */
  includeMemory?: boolean
  /** 关掉它 = 没有环境信息和 git 快照，模型对"自己在哪、仓库什么状态"一无所知 */
  includeEnvInfo?: boolean
}

export async function buildSystemPrompt(opts: SystemPromptOptions): Promise<string> {
  const { cwd, includeMemory = true, includeEnvInfo = true } = opts
  const sections = [BASE_INSTRUCTIONS]

  if (includeMemory) {
    const memory = await loadMemory(cwd)
    if (memory) sections.push(`# 项目规则（来自 CLAUDE.md）\n${memory}`)
  }

  if (includeEnvInfo) {
    const isGitRepo = (await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])) === 'true'
    sections.push(
      ['# 环境信息', `工作目录: ${cwd}`, `平台: ${process.platform}`, `是否 git 仓库: ${isGitRepo ? '是' : '否'}`].join(
        '\n',
      ),
    )
    if (isGitRepo) {
      if (cachedGitStatus === null) cachedGitStatus = await computeGitStatus(cwd)
      sections.push(`# Git 状态\n${cachedGitStatus}`)
    }
  }

  return sections.join('\n\n')
}
