# 实战10：跨会话状态——关掉重开，接着干

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 实战10）

从实战01 到实战09，`mini-harness` 每次运行都是一锤子买卖：进程起来，问一句，模型答完，退出。哪怕实战09 刚教会它在历史顶到窗口之前自己压缩瘦身，这份瘦身后的历史也只活在这一次进程的内存里——`bun run start` 一退出，`messages` 数组连同它装的一切，随进程一起烟消云散。明天你再跑一次，harness 对昨天聊过什么、做到哪一步，完全没有记忆。

这跟你自己用 Claude Code 的真实体验对不上——你关掉终端，第二天 `claude --resume` 接着昨天的活儿往下说；你换一个项目子目录跑，它却记得"这个仓库上次让你别用感叹号回复"。这一篇要把这两件事焊上：**退出之后，状态不会跟着没**。

## 一、设计摊开：状态要往哪儿放，认谁

### 折叠点①：要保存的"状态"，是一整场对话，还是"做到哪了"这个结论？

先问一个最朴素的问题：明天接着聊，模型到底需要知道什么？

第一种答案：把昨天说的每一句话——用户问了什么、模型答了什么、调用过哪些工具、工具吐回了什么——原样存一份，明天读回来，从那句话继续往下说，就像按了暂停键又按了播放。这解决的是"这一场没聊完的对话，怎么接着聊"。

第二种答案：不需要整场对话，只需要一份浓缩过的结论——"用户是谁、上次犯过什么错、这个项目做到第几步了"。这解决的是完全不同的问题：哪怕这是一场全新的对话（不同的问题、不同的上下文），只要还在同一个项目里，这些沉淀下来的经验也该继续生效。

这两种需求听起来像是同一件事的两种说法，但仔细看会发现它们连"什么时候该被读到"这件事本身都不一样：第一种只在你明确说"接着上次那场聊"时才用得上；第二种不需要你显式要求，只要你还在这个项目里跑 harness，**每一次全新的对话**都该自动看到它——哪怕你压根不知道昨天存过什么。一份是"暂停/播放"的完整录像带，一份是随身携带、自动生效的备忘录。把两件事混成一份存储，会让"什么时候读、按什么规则读"变得没法说清楚——所以这里要分两层：**Layer A（完整对话记录）** 负责"接着上次那场聊"，**Layer B（备忘录）** 负责"这个项目沉淀下来的经验，每次开工自动带上"。

### 折叠点②：Layer A 认谁——凭什么判断"这是同一场对话"？

Layer A 要靠一个身份证才能找到"上次那场对话"存在哪。这个身份证该是什么？

如果用一个全局递增的编号，或者干脆不设身份证、永远只有"最近一次"能被续上，那你在 A 项目跑一次、切到 B 项目又跑一次，"最近一次"到底该指哪场？两个项目的对话被搅在一起，续上的可能是风马牛不相及的历史。

真正能自然分开对话的，是你**跑 harness 时所在的那个目录**——`cwd`。你在 `~/work/project-a` 跑，产生的对话天然归 project-a；换到 `~/work/project-b` 跑，是另一码事。这跟你人脑里的直觉完全一致：你不会指望在 A 项目的终端里，接上 B 项目昨天聊的话题。所以 Layer A 的存储路径按 `cwd` 分桶，每个目录一份独立的对话历史，互不可见。

### 折叠点③：Layer B 认谁——为什么不能也用 cwd？

Layer B 存的是"这个项目沉淀下来的经验"，直觉上也该按目录分桶，对吧？但设想一个真实场景：同一个 git 仓库，你在根目录跑过一次 harness，也在 `packages/api` 子目录跑过一次——这是不是"同一个项目"？

如果按 `cwd` 分桶，根目录和 `packages/api` 会被当成两个完全不相干的项目，各自攒一份互相看不见的备忘录。但你脑子里的"项目"显然是那个 git 仓库整体，不是你敲命令时恰好站在哪个子目录。备忘录记的是"这个项目做到哪了""用户在这个项目里有什么偏好"，这些结论理应对整个仓库通用，不该因为你换了个子目录就读不到。

所以 Layer B 不能用 `cwd` 当身份证，得往上找一层更稳定的边界——**这个仓库的 git 根目录**。不管你在根目录跑，还是钻进某个子目录跑，只要能找到同一个 `.git`，就该共享同一份备忘录。这也是 Layer A 和 Layer B 唯一的结构性差异：一个按 `cwd` 分桶（对话历史天然该分开），一个按 git 根目录分桶（项目经验理应共享）。

### 折叠点④：这两份状态该存在仓库里面，还是外面？

既然都要落盘，一个直觉的想法是存进项目目录里，比如 `.harness/session.json`，跟代码放在一起，方便查看。

但转念一想：这些文件是给谁看的？Layer A 是完整对话原始记录，Layer B 是模型自己攒的备忘录——它们都是**harness 运行时产生的边车数据**，不是项目本身的源代码，也不该被 git 追踪、被提交、被 push 到远程仓库给同事看到（备忘录里可能记着"用户这个人经常骂骂咧咧"这种不适合公开的观察）。更实际的问题是：如果这些文件进了 `.git`，`git status` 会一直显示"有未提交改动"，污染你正常的开发工作流。

所以两层状态都存在仓库**之外**——固定放在用户主目录下（比如 `~/.mini-harness/...`）。git 只被用来**认出"这是哪个项目"**（提供身份证：`cwd` 或者 git 根目录），完全不被当成存储或同步机制。

### 折叠点⑤：备忘录会越攒越长，怎么喂给模型才不会把上下文撑爆？

Layer B 这份备忘录，理论上会随着项目推进越攒越多——今天记一条用户偏好，明天记一条项目决定，攒上几十条之后，如果每次开工都把全部内容原文塞进系统提示词，这份"沉淀经验"自己就先把上下文window吃掉一大块，这跟实战09 费劲压缩历史的初衷正好相反。

解决办法是分两级：一份**索引**（`MEMORY.md`），每条记忆只占一行，整份都很短，可以放心地每次都整份读进系统提示词；索引里每一行指向一个**主题文件**（比如 `feedback_xxx.md`），装着这条记忆的完整内容，只有模型**判断确实需要**时才会主动用 `read_file` 去读那份详情。这样系统提示词里常驻的只有"目录页"，真正的大段内容按需加载，规模再大也不会被动撑爆上下文。

### 折叠点⑥：备忘录该分几类？

如果不分类，备忘录就是一份越来越长的流水账，模型很难判断"这条该不该用来指导现在这个决定"。分类能让模型按"这是什么性质的信息"来决定权重——比如"用户偏好"该一直生效，"项目某个阶段的临时状态"过了那个阶段可能就作废了。

这里直接照搬真实 Claude Code 划的四类：**user**（用户角色、偏好、知识背景）、**feedback**（用户对做法的纠正或认可，连带记下"为什么"）、**project**（项目里正在进行的工作、决定、进度）、**reference**（外部系统的指引，比如"bug 都记在某个地方"）。这四类边界经过真实产品打磨过，直接搬没有重新发明的必要。

### 折叠点⑦：谁来写这份备忘录、什么时候写、要不要一个开关随时关掉？

备忘录不会自己长出来，得有人往里写。最省事的路径是：主 agent 在正常回答问题的过程中，如果判断"这轮工作构成了值得记录的进度"，顺手用已有的 `write_file` 工具写一份新的主题文件、再更新一行索引——不需要额外架设任何新机制，系统提示词里交代清楚格式和判断标准就够了。

这里刻意不做一件事：不给它加一个"要不要开启自动记忆"的功能开关。理由很直接——这一篇的教学场景里，备忘录机制本身就是这一章要教的东西，装了个默认关闭的开关，读者跑起来大概率看不到任何效果，反而增加一层"到底要不要开"的困惑。所以设计成**常开**，没有配置项。

### 折叠点⑧：断点续传要靠什么钥匙——精确到什么程度？

Layer A 存在了，接下来要解决"怎么读回来接着说"。这需要两个 flag：一个是**指定用哪个身份证存这次新对话**（不给就随机生成一个），一个是**指定接着哪场旧对话往下说**。

这里的关键问题是：用户拿什么来指认"就是那一场"？如果允许用一个序号（"最近第 3 场"）或者模糊搜索（"上次聊 auth 的那场"），实现起来要么得先列一份清单、要么得做搜索排序，逻辑复杂度立刻上一个台阶，而且模糊匹配本身就有"匹配错了怎么办"的歧义空间。

这一篇选择只认**精确、合法的 UUID**——用户必须原样给出上次那场对话的身份证，一个字符都不能错，错了直接报错，不做任何"猜你可能想要哪个"的兜底。这跟真实做法（后面"翻源码"细讲）比是收窄的，但换来的是这一篇的实现只需要"读一个文件存不存在"这一件事，没有列表 UI、没有排序、没有搜索，复杂度降到最低。

![骨架定位图：调用方入口 index.ts 新增 --session-id/--resume 两个 flag 的解析与 UUID 校验。两条独立的状态支线从这里分叉。Layer A 支线：新增 src/uuid.ts（validateUuid 纯函数）+ src/session.ts（createSessionId/sessionIdExists/appendSessionEntry/loadSessionMessages，按 cwd 分桶存进 ~/.mini-harness/sessions/），loop.ts 内部每写一条新消息就顺手调用 appendSessionEntry。Layer B 支线：新增 src/memdir.ts（findGitRoot/getMemoryDir/loadMemoryPrompt，按 git 根目录分桶存进 ~/.mini-harness/memory/，两级结构 MEMORY.md 索引 + 主题文件），systemPrompt.ts 新增 includeAutoMemory 选项，把 loadMemoryPrompt 的结果拼进系统提示词，紧跟在 CLAUDE.md 项目规则之后。底部灰色虚线框：streamChat 消费、权限闸门、重试机制、压缩检查全部沿用实战02-09，一个字没改——这一篇加的是"进程退出前后，状态怎么活下来"这一层，不碰主控制流程本身。](assets/img/实战10-skeleton.svg)

---

## 二、代码落地

改动清单：新增 `src/uuid.ts`（UUID 校验）、`src/session.ts`（Layer A：会话记录持久化）、`src/memdir.ts`（Layer B：备忘录）；`systemPrompt.ts` 拼入备忘录提示词；`loop.ts` 每条新消息顺手落盘；`index.ts` 解析 `--session-id`/`--resume` 两个 flag。

### `src/uuid.ts`：一个纯函数，卡死格式

```typescript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 合法就原样返回，不合法返回 null——调用方拿到 null 就该直接报错退出，不做任何兜底猜测 */
export function validateUuid(maybeUuid: string | undefined): string | null {
  if (typeof maybeUuid !== 'string') return null
  return UUID_REGEX.test(maybeUuid) ? maybeUuid : null
}
```

### `src/session.ts`：Layer A，按 `cwd` 分桶，每条消息落定就追加一行

```typescript
async function getProjectDir(cwd: string): Promise<string> {
  const dir = join(homedir(), '.mini-harness', 'sessions', sanitizeCwd(cwd))
  await mkdir(dir, { recursive: true })
  return dir
}

/** 没指定 --session-id 时的默认路径：生成一个新 UUID，跟查重逻辑复用同一个存在性检查 */
export async function createSessionId(cwd: string): Promise<string> {
  let id = randomUUID()
  while (await sessionIdExists(cwd, id)) id = randomUUID()
  return id
}

/** 每有一条新消息落定，就追加一行 JSONL——不是等到进程退出才一次性写完 */
export async function appendSessionEntry(cwd: string, sessionId: string, message: Message): Promise<void> {
  const path = await sessionFilePath(cwd, sessionId)
  await appendFile(path, JSON.stringify(message) + '\n', 'utf-8')
}

/** --resume 用：读回整份历史，文件不存在返回 null */
export async function loadSessionMessages(cwd: string, sessionId: string): Promise<Message[] | null> {
  const path = await sessionFilePath(cwd, sessionId)
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return null
  }
  return raw.split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line) as Message)
}
```

### `src/memdir.ts`：Layer B，按 git 根目录分桶，两级结构装进系统提示词

```typescript
/** 从 cwd 往上找第一个包含 .git 的目录——不区分 .git 是文件还是目录，找到就算数 */
async function findGitRoot(startPath: string): Promise<string | null> {
  let dir = startPath
  for (;;) {
    if (await exists(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** 备忘录的存储路径——git 仓库就按仓库根算，不在仓库里就退化成按 cwd 算 */
export async function getMemoryDir(cwd: string): Promise<string> {
  const base = (await findGitRoot(cwd)) ?? cwd
  return join(homedir(), '.mini-harness', 'memory', sanitizePath(base))
}
```

`MEMORY_INSTRUCTIONS` 是折叠点⑤⑥⑦的字面落地——一段固定文案交代"记忆分两层""记忆分四类""什么值得记、什么不值得记、怎么用 `write_file` 写"，`loadMemoryPrompt` 把这段说明和当前 `MEMORY.md` 的实际内容拼在一起，作为一整块塞进系统提示词。

### `systemPrompt.ts`：备忘录紧跟在 CLAUDE.md 项目规则之后

```typescript
export interface SystemPromptOptions {
  cwd: string
  includeMemory?: boolean
  includeEnvInfo?: boolean
  /** 关掉它 = 没有跨会话备忘录，模型看不到之前记过的东西，也不会顺手记新的 */
  includeAutoMemory?: boolean
}

export async function buildSystemPrompt(opts: SystemPromptOptions): Promise<string> {
  const { cwd, includeMemory = true, includeEnvInfo = true, includeAutoMemory = true } = opts
  const sections = [BASE_INSTRUCTIONS]

  if (includeMemory) {
    const memory = await loadMemory(cwd)
    if (memory) sections.push(`# 项目规则（来自 CLAUDE.md）\n${memory}`)
  }

  // 备忘录跟 CLAUDE.md 项目规则不是一回事——CLAUDE.md 是这个项目本身定死的规矩，
  // 备忘录是模型自己在历次调用里攒下的、关于"做到哪了"的活的记忆，两者都属于"持久上下文"，所以紧挨着放
  if (includeAutoMemory) {
    sections.push(await loadMemoryPrompt(cwd))
  }

  if (includeEnvInfo) {
    // ……环境信息、git 状态快照，沿用实战07，不变……
  }

  return sections.join('\n\n')
}
```

### `src/loop.ts`：`runAgent` 新增两个参数，每条新消息顺手落盘

```typescript
export async function runAgent(
  provider: ModelProvider,
  tools: Tool[],
  userInput: string,
  maxTurns = 10,
  gate = true,
  system?: string,
  cwd?: string,
  sessionId?: string,
  resumeMessages?: Message[],
): Promise<string> {
  const userMessage: Message = { role: 'user', content: userInput }
  const messages: Message[] = [...(resumeMessages ?? []), userMessage]
  const toolByName = new Map(tools.map(t => [t.name, t]))
  const session = newSession()

  /** cwd/sessionId 都给了才落盘；resume 读回的历史已经在磁盘上了，不重复写 */
  const record = (message: Message): Promise<void> =>
    cwd && sessionId ? appendSessionEntry(cwd, sessionId, message) : Promise.resolve()

  await record(userMessage)
  // ……

  if (toolCalls.length === 0) {
    process.stdout.write('\n')
    // 这条最终回复不会进 messages（循环马上就退出了），但 Layer A 仍要记下来——
    // 不然存下来的完整记录里会缺最后一句话
    await record({ role: 'assistant', content: text, usage })
    return text
  }

  const assistantTurn: Message = { role: 'assistant', content: text, toolCalls, usage }
  messages.push(assistantTurn)
  await record(assistantTurn)

  for (const call of toolCalls) {
    // ……执行工具……
    const toolTurn: Message = { role: 'tool', toolCallId: call.id, content: result }
    messages.push(toolTurn)
    await record(toolTurn)
  }
}
```

四个落盘点覆盖了一场对话里出现的全部消息类型：开场的用户提问、不再调用工具时的最终回复、要调用工具时那一轮的 assistant 消息、每一次工具执行完的结果——一条都不漏，`--resume` 读回来的才是完整的历史，不会缺最后一句话。

### `src/index.ts`：解析 `--session-id`/`--resume`，二选一，都要精确 UUID

```typescript
if (resumeId !== undefined) {
  const validId = validateUuid(resumeId)
  if (!validId) {
    console.error(`error: --resume 后面必须是合法 UUID，收到的是 "${resumeId}"`)
    process.exit(1)
  }
  const loaded = await loadSessionMessages(cwd, validId)
  if (!loaded) {
    console.error(`error: 在当前目录下找不到会话 ${validId}`)
    process.exit(1)
  }
  sessionId = validId
  resumeMessages = loaded
} else if (sessionIdFlag !== undefined) {
  const validId = validateUuid(sessionIdFlag)
  if (!validId) {
    console.error(`error: --session-id 后面必须是合法 UUID，收到的是 "${sessionIdFlag}"`)
    process.exit(1)
  }
  if (await sessionIdExists(cwd, validId)) {
    console.error(`error: 会话 ${validId} 已经存在，换一个 id 或用 --resume 接着用这个`)
    process.exit(1)
  }
  sessionId = validId
} else {
  sessionId = await createSessionId(cwd)
}
```

三条路径分别对应折叠点⑧的三种场景：什么都不传（随机生成新会话）、`--session-id` 指定一个新会话（查重防止覆盖已有文件）、`--resume` 接上一个已有会话（读不到就直接报错，不做模糊猜测）。

![主控制流程图：index.ts 解析 argv，三分支决定 sessionId/resumeMessages——默认分支调 createSessionId 随机生成新会话；--session-id 分支先 validateUuid 再 sessionIdExists 查重；--resume 分支先 validateUuid 再 loadSessionMessages 读回历史，读不到直接 process.exit(1)。三条分支收敛到同一处 runAgent 调用，resumeMessages 拼在新问题前面组成完整 messages 数组。runAgent 内部循环的每一个消息产生点（初始 user 消息、无工具调用时的最终 assistant 回复、有工具调用时的 assistant 轮次、每条工具结果）都各自调用一次 record()——record 内部是 cwd && sessionId 双重判断后才真正调用 appendSessionEntry，向 ~/.mini-harness/sessions/<sanitize(cwd)>/<sessionId>.jsonl 追加一行。另一条独立支线：buildSystemPrompt 调用 loadMemoryPrompt(cwd)，内部先 findGitRoot 定位到 git 根目录（找不到就退化用 cwd），据此算出 ~/.mini-harness/memory/<sanitize(gitRoot)>/ 路径，读取其中的 MEMORY.md 索引拼进系统提示词一起发给模型；模型如果判断这轮工作值得记录，会在工具调用阶段主动用已有的 write_file 工具写入新的主题文件并更新 MEMORY.md 索引——这条写入路径完全复用实战03 已有的工具执行机制，loop.ts 本身不需要为"写备忘录"这件事新增任何专门代码。](assets/img/实战10-flow.svg)

### 验证：Layer A 断点续传 + Layer B 记忆写入，两条链路各跑一遍

Layer A：默认跑一次生成新会话，确认 JSONL 文件按预期写出四行消息；用同一个 `--session-id` 再跑一次触发"已存在"报错；用 `--resume` 接上刚才那场会话，模型正确说出了"上次问的是 package.json 里的内容"，证明历史确实被原样读回并接上了：

```
[session]  a1b2c3d4-...（接着 4 条历史往下说）
[assistant] 你刚才问的是 package.json 里项目叫什么、有哪些 npm 脚本……
```

Layer B：绕开交互式权限闸门（`gate=false`），喂给模型一句"这是个值得记住的用户偏好"，观察它是否会主动写备忘录。模型的实际行为：先按 CLAUDE.md 规则跑了一次 `git status` 自检，然后调用 `write_file` 新建了一份规范的 `feedback_no_exclamation.md`（带 `name`/`type: feedback`/规则原文/Why 三段），再调用一次 `write_file` 更新 `MEMORY.md` 索引，加了一行指向刚才那份文件——两次调用都没人提示它该怎么做格式，完全是照着系统提示词里那段 `MEMORY_INSTRUCTIONS` 自己拼出来的。

![序列图：两条独立链路。Layer A 链路——三条生命线 index.ts、session.ts、~/.mini-harness/sessions/。第①拍 index.ts 收到 --resume <uuid>，调 validateUuid 校验格式；第②拍格式合法后调 loadSessionMessages(cwd, uuid)，session.ts 读取对应 jsonl 文件、按行 JSON.parse，返回消息数组；第③拍 index.ts 把这份历史连同新问题一起传给 runAgent；第④拍 runAgent 内部循环，每产生一条新消息就调 appendSessionEntry 追加写入同一个 jsonl 文件；第⑤拍循环结束，磁盘上的这份文件比 resume 时读到的又多了本轮新增的几行，下次 --resume 同一个 uuid 会读到更完整的历史。Layer B 链路——三条生命线 systemPrompt.ts、memdir.ts、模型。第①拍 buildSystemPrompt 调 loadMemoryPrompt(cwd)；第②拍 memdir.ts 内部 findGitRoot 定位仓库根、拼出 memDir 路径、读取当前 MEMORY.md 内容；第③拍把 MEMORY_INSTRUCTIONS 说明文案 + 当前索引内容拼成一段，混进这一轮的系统提示词发给模型；第④拍模型这一轮的回答中，判断这是值得记录的信息，主动发起 write_file 工具调用写新主题文件；第⑤拍模型再发起一次 write_file 更新 MEMORY.md 索引；第⑥拍下一次全新对话（哪怕是全新的 --session-id）再次调用 loadMemoryPrompt 时，会读到刚才写入的这份索引，备忘录持续生效。两条链路唯一的交汇点是 index.ts 里都用到了 cwd 这同一个变量，但分桶的方式（Layer A 按 cwd 本身、Layer B 按 findGitRoot(cwd) 的结果）从这里开始彻底分叉。](assets/img/实战10-sequence.svg)

当篇 checkpoint：`git tag harness-ch10-cross-session-state`。

---

## 三、🔬 翻开源码

去 `claude-code-rev` 里核对了真实 Claude Code 的会话持久化与记忆机制（`git.ts`、`memdir/paths.ts`、`memdir/memoryTypes.ts`、`utils/uuid.ts`、`utils/sessionStorage.ts`、`utils/sessionUrl.ts`、`utils/listSessionsImpl.ts`、`services/extractMemories/extractMemories.ts`），核心思路一致，但真源码要应付的场景复杂得多。

### 1. `findGitRoot` 一致，但真源码多一步 worktree 的 `commondir` 归一化

真源码 `findCanonicalGitRoot`（`git.ts`）不是简单的"往上找到 `.git` 就算数"，它内部由 `resolveCanonicalRoot`（用 `memoizeWithLRU` 包裹做缓存）完成第二步归一化：如果找到的 `.git` 是一个**文件**（说明当前目录是一个 git worktree，而不是主仓库），就要读这个文件里指向的 `commondir`，顺着它找到主仓库的真实工作目录——这样同一个仓库的不同 worktree 才能被认成"同一个项目"、共享同一份备忘录。这一步在源码里还带一段专门的安全校验，防止恶意构造的 `commondir` 把路径导向仓库之外。

我们的 `findGitRoot` 只做到"往上找到包含 `.git` 的目录"这一步——不区分它是文件还是目录，找到就直接当根用。教学场景不涉及 worktree，这不是漏掉了这个分支，是这道题在我们不处理 worktree 的前提下压根不会被触发；真要补，也只是在 `findGitRoot` 返回后多加一步"读文件内容、跟着走"的归一化。

### 2. `getMemoryDir` 思路一致，但真源码是一整条环境变量/设置项覆盖链

真源码 `memdir/paths.ts` 里，最终落盘路径 `getAutoMemPath`（用 `memoizeWithLRU` 缓存）不是直接拿 `getAutoMemBase()` 算出来就完了，前面还有一条覆盖链：先看有没有 `getAutoMemPathOverride()`（环境变量强制指定路径，通常用于测试或调试），没有的话再看 `getAutoMemPathSetting()`（用户在配置文件里显式指定的路径），都没有才落到默认的 `join(projectsDir, sanitizePath(getAutoMemBase()), AUTO_MEM_DIRNAME)`。另外真源码整套机制还挂在 `isAutoMemoryEnabled()` 这个总开关后面——关掉这个开关，备忘录读写全部跳过。

我们的 `getMemoryDir` 只实现最后那一环默认路径计算，没有环境变量/设置项的覆盖链，也没有总开关（折叠点⑦已经交代过：故意做成常开，没有配置项）。这是结构性裁剪，不是数值上的缩水。

### 3. 记忆四类完全一致，但真源码还有我们没做的 COMBINED 多租户模式

`memdir/memoryTypes.ts` 里的 `MEMORY_TYPES` 常量，`user`/`feedback`/`project`/`reference` 四个值跟我们 `MEMORY_INSTRUCTIONS` 里写的四类逐字对应——这套分类是产品打磨过的边界，直接照搬。

但真源码还支持一种我们完全没实现的场景：**COMBINED 模式**，同时存在私人记忆目录和团队共享记忆目录，生成的系统提示词里会用 `<scope>` 标签区分"这条是我个人的""这条是团队共享的"。这是面向多人协作场景的多租户设计——我们的 `mini-harness` 是单用户、单目录的教学场景，从需求上就不存在"团队共享"这件事，这条没有对应的简化版本，纯粹是范围之外。

### 4. `validateUuid` 正则逐字一致，类型签名有细微差别

真源码 `utils/uuid.ts` 的正则 `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`，跟我们 `uuid.ts` 里的正则逐字符相同——这条规则没有任何简化空间，UUID 格式就是这么定的。唯一的差别是类型签名：真源码 `validateUuid(maybeUUID: unknown)` 返回值是从 Node `crypto` 模块引入的一个打了品牌（branded）的 `UUID` 类型，我们的版本参数是 `string | undefined`、返回 `string | null`——一处无关紧要的类型精细度差异，行为完全等价。

### 5. Layer A 落盘思路一致，但真源码是防抖写队列，我们是同步 `await`

真源码 `sessionStorage.ts` 里，每条消息落盘不是来一条就直接写一条磁盘 I/O，而是走一套**100ms 防抖的写队列**（`FLUSH_INTERVAL_MS = 100`）——短时间内连续到达的多条消息会被合并成一次磁盘写入，单个 chunk 还设了 `MAX_CHUNK_BYTES = 100 * 1024 * 1024` 的上限防止单次写入过大。更关键的是它配了 `registerCleanup`/`gracefulShutdownSync` 这套兜底：万一进程被信号杀掉（比如用户按 Ctrl-C），也要在退出前把队列里还没落盘的内容强制 flush 掉，不能丢消息。

这整套复杂度是为了应付**长期运行、频繁追加消息的交互式 REPL**场景——消息来得又快又密，来不及每条都同步写磁盘，也随时可能被用户中断。我们的 `mini-harness` 是单次进程从头跑到尾、跑完自然退出的架构，消息数量以十为量级，`await appendFile(...)` 直接同步写完完全够用，没有"来不及写完进程就死了"的风险——这不是漏做了防抖优化，是这道题在我们的单发架构里根本不存在。

### 6. `--resume` 语义一致，但真源码支持 UUID/`.jsonl` 路径/URL 三种形式

真源码 `sessionUrl.ts` 的 `parseSessionIdentifier` 会依次尝试三种解析：先看是不是以 `.jsonl` 结尾的文件路径（连 Windows 盘符路径 `C:\path\file.jsonl` 会被误判成 URL 这种边界情况都专门处理了），再看是不是合法 UUID，最后尝试当 URL 解析（用于连到一个远程 session ingress 服务）。`print.ts` 里的 `hasValidResumeSessionId` 就是拿这个解析结果的合法性来判断"这次调用到底有没有带一个能用的 resume 目标"。

折叠点⑧已经交代过这处收窄：我们只认精确 UUID 这一种，不接受 `.jsonl` 路径也不接受 URL——真源码这几种形式服务的是"本地文件/远程会话枢纽"两种不同的会话来源，我们的存储模型只有本地这一种，`.jsonl` 路径和 URL 两条分支没有对应的落地场景，故意不搬。

### 7. Layer B 写入路径一致，但真源码还有一条我们完全没碰的并行分支

我们的备忘录写入完全依赖"主 agent 在正常回答的过程中，按系统提示词的指引主动调用 `write_file`"这一条路径——这跟真源码里同样存在的一条路径完全一致。

但真源码还有**第二条并行路径**：`services/extractMemories/extractMemories.ts` 里一整套由 `stopHooks` 触发的**独立 forked agent**，专门在每轮对话结束后扫一遍消息、判断有没有遗漏该记的东西、自己去写。这条路径和主 agent 内联写入路径是**互斥**的——`hasMemoryWritesSince(messages, sinceUuid)` 这个函数专门检查"自上次记忆游标之后，主 agent 是不是已经自己写过了"，写过了就跳过这次 forked agent 抽取（函数里的注释写得很直白："主 agent 的提示词里已经有完整的记忆指导，它自己写的时候，forked extraction 就是多余的"）。这套机制是为了兜底"模型这一轮虽然该记但没记"的情况，是主路径的安全网。

我们只实现了主 agent 内联写入这一条路径，没有对应的 forked-agent 兜底抽取——这跟实战09"这次调用不给模型工具，比源码留的 `FileReadTool` 保底更激进"是同一种取舍：更简单，但没有安全网，模型这轮没判断出"这值得记"，这条记忆就真的漏了，没有第二次机会。

### 8. `listSessionsImpl` 确实存在，但没有被暴露成用户可见的功能

`utils/listSessionsImpl.ts` 这个文件是真实存在的，但搜遍整个源码，它唯一的调用方是 `services/autoDream/consolidationLock.ts`（通过 `listCandidates`）——一个内部使用的辅助函数，不是挂在任何用户可触发的命令或 UI 上。这印证了折叠点⑧划定的范围：这一篇不做"列出所有历史会话"这个功能，不是因为真源码没有相关代码，而是因为这段代码本身也不是一个面向用户的功能入口，我们没有理由单独为了教学去搭一个真源码自己都没暴露出来的 UI。

### 9. 会话自动命名（`generate_session_title`）确认只在 SDK 协议里触发

`print.ts` 里 `generate_session_title` 只作为 `message.request.subtype` 出现，专门响应外部宿主通过 `stream-json` 协议发来的控制请求——这是给"Claude Code 被作为 SDK/子进程集成进别的工具"这种场景用的，普通命令行单次调用完全不会触发这条路径。我们的 `mini-harness` 没有这种被外部宿主控制的协议层，所以这一篇没有实现"给会话自动生成标题"这个功能——不是遗漏，是这个功能本身依赖的触发场景我们不存在。

## 小结

- 状态要分两层：Layer A 存"一整场对话原始说了什么"，Layer B 存"这个项目沉淀下来的经验"——两者读取时机完全不同，一份要显式 `--resume` 才读，一份每次开工自动读（折叠点①）。
- Layer A 按 `cwd` 分桶——对话历史天然该按你在哪个目录跑来区分（折叠点②）。
- Layer B 按 git 根目录分桶，不是 `cwd`——同一个仓库不同子目录/worktree 该共享同一份项目经验（折叠点③）。
- 两层都存在仓库之外，不进 git——git 只用来"认出这是哪个项目"，不当存储或同步机制（折叠点④）。
- 备忘录分两级防止撑爆上下文：`MEMORY.md` 索引常驻系统提示词，主题文件按需 `read_file`（折叠点⑤）。
- 记忆分四类：user / feedback / project / reference，直接照搬真实产品打磨过的边界（折叠点⑥）。
- 只做"主 agent 顺手用已有工具写"这一条路径，常开、无配置开关——比真源码"主路径 + forked-agent 兜底"的双保险更简化（折叠点⑦）。
- `--session-id`/`--resume` 只认精确合法的 UUID，不做列表、不做模糊匹配、不支持 `.jsonl` 路径/URL（折叠点⑧）。

🔬 源码对照：
- `git.ts` — `findCanonicalGitRoot`/`resolveCanonicalRoot`，我们没做 worktree 的 `commondir` 归一化
- `memdir/paths.ts` — `getAutoMemBase`/`getAutoMemPath`/`isAutoMemoryEnabled`，我们没有环境变量/设置项覆盖链，也没有总开关
- `memdir/memoryTypes.ts` — 四类记忆逐字一致；COMBINED 多租户/团队共享模式我们完全没做
- `utils/uuid.ts` — 正则逐字一致；类型签名（`unknown`→品牌 `UUID` vs `string|undefined`→`string|null`）有细微差别
- `utils/sessionStorage.ts` — 落盘思路一致；真源码是 100ms 防抖写队列 + 信号兜底 flush，我们是同步 `await appendFile`
- `utils/sessionUrl.ts` — `--resume` 语义一致；真源码支持 UUID/`.jsonl` 路径/URL 三种形式，我们只认 UUID
- `services/extractMemories/extractMemories.ts` — 我们只做了主 agent 内联写入这一条路径，没有对应的 `stopHooks` forked-agent 兜底抽取（`hasMemoryWritesSince` 互斥逻辑）
- `utils/listSessionsImpl.ts` — 确实存在，但只被内部的 `autoDream/consolidationLock.ts` 调用，不是面向用户的功能入口
- `print.ts` — `generate_session_title` 只在 SDK 协议的 `stream-json` 控制请求里触发，普通单发调用不会命中

Harness 现在能在关掉重开之后接着聊，也能在跨越多次全新对话之间记住项目经验。但这一篇解决的还只是"记不记得住"——真实交互体验里，你不会每次都敲一长串 `--resume <uuid>`，而是直接进一个能一直开着、随时接话的对话框。下一篇看这个。
