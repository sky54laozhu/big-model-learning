import { access, mkdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

/**
 * Layer B：备忘录（回扣源码 memdir/paths.ts、memdir/memdir.ts）。
 * 跟 Layer A（session.ts）的区别：Layer A 是"这一次对话完整说了什么"的原始记录，keyed by cwd；
 * Layer B 是"这个项目做到哪了"的蒸馏进度，keyed by 仓库的 git 根目录——不管你在哪个子目录、
 * 甚至哪个 worktree 里跑 mini-harness，只要是同一个仓库，看到的都是同一份备忘录（回扣折叠点：
 * "共享"）。
 *
 * 存储位置同样在仓库之外，不进 git——git 只被用来"认出这是哪个项目"，不被当成同步/存储机制。
 *
 * 诚实简化：真源码 findCanonicalGitRoot 在 findGitRoot 之后还有一步 resolveCanonicalRoot——
 * 如果 .git 是一个文件（说明这是个 worktree），要跟着它指向的 commondir 找到主仓库的真实
 * 工作目录，这样同一个仓库的不同 worktree 才能共享同一份备忘录（源码这段还有一节专门的安全
 * 校验，防止恶意仓库靠篡改 commondir 把路径指向别处）。我们的教学场景不涉及 worktree，
 * 这里只做到 findGitRoot 这一步——找不到 worktree 就是找不到，直接把 gitRoot 当成根，不是
 * 漏掉了这个分支，是这道题在我们不处理 worktree 的前提下不会被触发。
 */

const ENTRYPOINT_NAME = 'MEMORY.md'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 从 cwd 往上找第一个包含 .git 的目录——不区分 .git 是文件还是目录，找到就算数 */
async function findGitRoot(startPath: string): Promise<string | null> {
  let dir = startPath
  for (;;) {
    if (await exists(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null // 到根目录了，没找到
    dir = parent
  }
}

function sanitizePath(path: string): string {
  return path.replace(/[/\\]/g, '-').replace(/^-+/, '')
}

/** 备忘录的存储路径——git 仓库就按仓库根算，不在仓库里就退化成按 cwd 算（跟真源码 getAutoMemBase 一致的兜底顺序） */
export async function getMemoryDir(cwd: string): Promise<string> {
  const base = (await findGitRoot(cwd)) ?? cwd
  return join(homedir(), '.mini-harness', 'memory', sanitizePath(base))
}

const MEMORY_INSTRUCTIONS = `# 备忘录
你在这台机器上，针对当前这个 git 仓库，有一个持久化的记忆目录：\`{{memDir}}\`。
这份记忆跨会话存在——只要还在同一个仓库里跑 mini-harness（不管在哪个子目录），下次调用还能看到。

记忆分两层，为的是省上下文：
- \`${ENTRYPOINT_NAME}\` 是索引，每条一行，会整份读进这份系统提示词（下面就是它当前的内容）
- 具体内容存在各自的主题文件里（比如 \`feedback_xxx.md\`），只有你判断确实需要时才用 read_file 去读

记忆分四类：
- **user**：关于用户角色、偏好、知识背景的信息
- **feedback**：用户对你做法的纠正或认可——记录规则本身，以及为什么（Why）
- **project**：项目里正在进行的工作、决定、未完成的进度
- **reference**：外部系统里能查到更多信息的指引（比如"bug 都记在某个 Linear 项目里"）

如果这一轮的工作构成了值得记录的进度（一个功能做完了、一个明确的用户偏好、一个项目决定），
顺手用 write_file 按下面格式记下来，并在 \`${ENTRYPOINT_NAME}\` 里加一行索引指向它：

\`\`\`markdown
---
name: {{记忆名}}
type: user | feedback | project | reference
---

{{记忆内容}}
\`\`\`

一次性的琐碎问题、或者能直接从代码/git 历史看出来的东西，不用记——那不是这份记忆该存的东西。
如果这份工作不值得记，就什么都不用做，不用勉强凑一条。`

/** 组装喂给模型看的那段备忘录提示词——指令 + 当前 MEMORY.md 的实际内容 */
export async function loadMemoryPrompt(cwd: string): Promise<string> {
  const memDir = await getMemoryDir(cwd)
  await mkdir(memDir, { recursive: true })

  const entrypointPath = join(memDir, ENTRYPOINT_NAME)
  let index: string
  try {
    index = (await readFile(entrypointPath, 'utf-8')).trim() || '（空，还没有任何记忆）'
  } catch {
    index = '（空，还没有任何记忆）'
  }

  return `${MEMORY_INSTRUCTIONS.replace('{{memDir}}', memDir)}\n\n当前 ${ENTRYPOINT_NAME} 内容：\n${index}`
}
