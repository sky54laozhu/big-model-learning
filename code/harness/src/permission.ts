import type { Tool } from './types'

/**
 * 权限闸门：模型每次动手前，都要从这儿过一道。
 *
 * 三态决策（回扣真源码 PermissionBehavior = 'allow' | 'deny' | 'ask'，types/permissions.ts）：
 * - allow：直接放行（只读工具、或本会话已被"总是允许"的）
 * - deny ：硬拒，不执行，把拒绝回灌给模型（响亮失败，回扣实战03）
 * - ask  ：交给人拍板——判断"意图坏不坏"这件事，只有人能做（回扣 Blog24/30）
 *
 * 闸门为什么不放进每个工具、而放在 loop 的 execute 前？因为 loop 是所有工具调用的
 * 唯一收口——一处闸门覆盖全部工具，加工具不用重写一遍安全（回扣真源码 canUseTool 由 loop 调，不是每个工具自查）。
 */
export type Decision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; reason: string }
  | { behavior: 'ask'; reason: string }

/** 只读工具：碰不坏东西，默认放行（回扣 Blog30 工具即权限——读/列是最左侧的窄口子） */
const READONLY = new Set(['read_file', 'list_dir'])

/**
 * bash 命令"一眼致命"黑名单（回扣 Blog30 致命三件套）。
 * ⚠️ 这不是"安全判定"，只是"明显危险直接拒"。判不出的一律落到 ask，绝不默认放行——
 * 因为判断一条任意 shell 命令安不安全是打地鼠（复合命令、管道、变量展开），正则永远兜不干净。
 * 真源码为这件事写了逾万行，且核心正则校验现已标 _DEPRECATED、改用 AI 分类器（见博客翻源码）。
 */
const DANGEROUS: { pattern: RegExp; why: string }[] = [
  { pattern: /\brm\s+(?:\S+\s+)*(?:-\w*[rR]\w*|--recursive)/, why: 'rm 递归删除（-r/-rf）' },
  { pattern: /:\s*\(\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;/, why: 'fork 炸弹' },
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/, why: '下载脚本直接管道执行' },
  { pattern: /\bdd\b[^\n]*\bof=\/dev\//, why: 'dd 写入裸设备' },
  { pattern: />\s*\/dev\/(sd|nvme|disk)/, why: '覆写磁盘设备' },
  { pattern: /\bchmod\s+-R\s+777\b|\bchmod\s+777\s+-R\b/, why: 'chmod -R 777 放开全部权限' },
  { pattern: /\bmkfs\.?\w*\b/, why: '格式化文件系统' },
]

/**
 * 会话级"总是允许"规则：人在审批时选 [a]，本次运行内该工具/命令前缀不再问。
 * 回扣真源码：ask 决策带 suggestions: PermissionUpdate[]，选"always"= addRules 到 session destination（不落盘）。
 */
export type SessionRules = { allowTools: Set<string>; allowBashPrefix: Set<string> }
export function newSession(): SessionRules {
  return { allowTools: new Set(), allowBashPrefix: new Set() }
}

/** 取命令的稳定前缀（命令+子命令两个词）当匹配键（回扣真源码 getSimpleCommandPrefix，bashPermissions.ts:161——Bash(npm test:*)） */
function bashPrefix(cmd: string): string {
  return cmd.trim().split(/\s+/).slice(0, 2).join(' ')
}

/**
 * 决策核心。精度顺序照真源码 checkRuleBasedPermissions（permissions.ts:1071）：
 * 先看硬拒，再看放行规则，最后落到"问"——冲突一律往更保守的那侧收。
 */
export function checkPermission(tool: Tool, args: any, session: SessionRules): Decision {
  // 本会话已"总是允许"的工具：放行（bash 的前缀放行在下面单独处理）
  if (tool.name !== 'bash' && session.allowTools.has(tool.name)) return { behavior: 'allow' }

  // 只读工具：默认放行
  if (READONLY.has(tool.name)) return { behavior: 'allow' }

  // 逃生舱 bash：先过命令安全体检
  if (tool.name === 'bash') {
    const cmd = String(args?.command ?? '')
    for (const rule of DANGEROUS) {
      if (rule.pattern.test(cmd)) {
        return { behavior: 'deny', reason: `命令疑似危险（${rule.why}）` }
      }
    }
    if (session.allowBashPrefix.has(bashPrefix(cmd))) return { behavior: 'allow' }
    return { behavior: 'ask', reason: `将执行 shell 命令：${cmd}` }
  }

  // write_file / edit_file 等会改文件系统的：判不出好坏，交人
  return { behavior: 'ask', reason: `${tool.name} 将改动 ${args?.path ?? '文件系统'}` }
}

/** 人选了 [a]：把这个工具/命令前缀记进会话，下次不再问 */
export function grantAlways(session: SessionRules, toolName: string, args: any): void {
  if (toolName === 'bash') session.allowBashPrefix.add(bashPrefix(String(args?.command ?? '')))
  else session.allowTools.add(toolName)
}

export type Approval = 'yes' | 'always' | 'no'

/**
 * 人工审批：把"意图坏不坏"的判断交给唯一能判的人（回扣 Blog24 的"坏"护栏、Blog30 语义层只能逼近）。
 * 无人值守（非 TTY）时读不到输入 → 一律当拒绝，宁可不做也不误做（fail closed）。
 * 用 AUTO_APPROVE=yes|always|no 可跳过交互，方便脚本化演示。
 */
export async function askHuman(reason: string): Promise<Approval> {
  const forced = process.env.AUTO_APPROVE?.trim().toLowerCase()
  if (forced === 'yes' || forced === 'always' || forced === 'no') {
    console.log(`\n⛔ 需要授权：${reason}\n   [AUTO_APPROVE=${forced}]`)
    return forced
  }
  // 无 prompt（非交互 / Node 运行时读不到 stdin）→ 一律当拒绝（fail closed）
  if (typeof globalThis.prompt !== 'function') return 'no'
  const ans = (globalThis.prompt(
    `\n⛔ 需要授权：${reason}\n   [y] 允许一次   [a] 本会话总是允许   [其它] 拒绝 > `,
  ) ?? '').trim().toLowerCase()
  if (ans === 'y' || ans === 'yes') return 'yes'
  if (ans === 'a' || ans === 'always') return 'always'
  return 'no'
}
