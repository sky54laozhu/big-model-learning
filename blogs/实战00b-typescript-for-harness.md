# 番外：读懂本卷代码要的 TypeScript

> 一个全栈工程师的大模型学习笔记（第六阶段 · 实战卷 · 番外）

上一篇番外 **00a** 把 TS 的地基铺好了：心智模型（类型运行时全擦掉）、类型注解、联合与字面量联合、`type`/`interface`、泛型「会读就行」、strict 三件套 `?.`/`??`/`!`。**这一篇假设你已经读过 00a**，不再重讲基础。

这篇只干一件事：**把「读懂/写本卷 harness 代码」需要的那几招进阶 TS，拿真代码讲透。** 全部以你已经看它跑通了的 `spike.ts` 当解剖标本（就是上一步验证「一个接口装两种模型」的那份 spike 代码）。翻开它，最容易把人绊住的其实就三处：`async function*` 是什么鬼？那个 `switch(ev.type)` 凭什么每个分支都不报错？为什么源码 `import` 后面跟着 `.js` 但文件明明是 `.ts`？

分两半：**语言层**（harness 真正吃劲的三招）和**生态层**（运行时、编译、模块、包管理这套你说不熟的东西）。

---

## 一、语言层：把 `spike.ts` 拆开看

### 1.1 可辨识联合 + `switch` 收窄（**全卷最核心的一招**）

这一节请慢读，它是整卷代码反复用的模式，也是 TS 最能打的地方。

先回扣 00a 第四节的**字面量联合**（`role: 'user' | 'assistant'`）。现在把它再往上叠一层：`spike.ts` 里的 `NormEvent` 是个联合类型——一个 `NormEvent` 值，要么是文本事件、要么是工具开始、要么是工具参数……五选一。而且每个成员都带一个**共同的字面量字段 `type`** 当"身份牌"：

```ts
type NormEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_arg'; id: string; deltaJson: string }
  | { type: 'tool_end'; id: string }
  | { type: 'done'; stopReason: string }
```

这种"用一个字面量字段区分成员"的联合，叫**可辨识联合（discriminated union）**。

> 顺带解决 00a 留的一个尾巴：`NormEvent` 用 `type`（因为它是**联合**，`interface` 表达不了），而下面的 `ModelProvider` 用 `interface`（因为它是**契约**，两个 provider 类都要 `implements` 它）。这正是 00a 那条"联合用 type、契约用 interface"经验法则的活标本。

可辨识联合的魔力在 `switch` 里：

```ts
for await (const ev of p.streamChat(messages, tools)) {
  switch (ev.type) {
    case 'text':
      text += ev.text          // ✅ 这里 ev 被收窄成 { type:'text'; text:string }，能点 .text
      break
    case 'tool_start':
      toolName.set(ev.id, ev.name)   // ✅ 收窄成有 id/name 的那支，能点 .name
      break
    case 'tool_arg':
      // ev.name 在这里会报错——因为这一支没有 name 字段
      ...
  }
}
```

进到 `case 'text'` 分支，编译器**自动把 `ev` 收窄**成"文本那一支"，于是 `ev.text` 合法、`ev.name` 报错（因为文本事件没有 `name`）。这叫**类型收窄（narrowing）**：你在 `case` 里判了 `ev.type`，编译器就顺着推断出此刻 `ev` 到底是哪一支。

![可辨识联合：一个 type 身份牌，switch 每个分支自动收窄成对应成员；漏一支编译器报错](assets/img/实战00b-discriminated-union.svg)

**为什么它对 harness 这么关键？** 回想上一步 spike 的结论：Anthropic 和 GLM 两端的流式格式天差地别，但我们把它们都翻译成**同一套 `NormEvent`**。调用方 `runOnce` 里那个 `switch(ev.type)`，对两端**零分支**——它根本不知道下面接的是哪家模型，只认这五种事件。**可辨识联合 + 收窄，就是"归一化"在类型层的落地。** 这也正是概念篇 Blog 18 那句"结构化输出"的类型层镜像：把不确定的外部输入，收进一组你穷举得清的确定形状。

**额外好处——穷尽检查**：如果 `NormEvent` 以后加了第六种事件，而你的 `switch` 忘了处理它，可以用一个小技巧让编译器**在编译期就报错**提醒你（给 `default` 分支塞一个 `const _exhaustive: never = ev`）。`never` 是"不可能有值"的类型，一旦漏了分支、`ev` 还剩某种可能，赋值给 `never` 就编译失败。这一手让"加了新状态忘了处理"从运行时 bug 变成编译期红线。

### 1.2 `class ... implements 接口`

```ts
class AnthropicProvider implements ModelProvider {
  readonly label = 'anthropic'
  constructor(private base: string, private key: string, ...) {}
  async *streamChat(messages: Msg[], tools: ToolDef[]): AsyncGenerator<NormEvent> { ... }
}
```

- `implements ModelProvider` = "**我保证长成 `ModelProvider` 那个契约的样子**"。少实现一个方法、或方法签名对不上，编译器立刻报错。这就是 00a 说 `interface` 擅长"契约"的意思——它是 provider 类必须签的合同。
- `constructor(private base: string, ...)` 是 TS 的**参数属性**语法糖：在构造函数参数前加 `private`，等于"声明一个私有字段 + 自动 `this.base = base`"，省掉一堆样板。这是纯 JS 没有的便利。

  > 呼应 00a §1 那条边界：`private`、`: string` 这些**类型部分会擦掉**，但它顺带触发的字段赋值 `this.base = base` 是**值**、会留在运行时。所以"类型标注被擦光"不等于"所有 TS 写法都凭空消失"。

- `readonly label` = 只读字段，构造后不能再改。

### 1.3 async 迭代器：`async function*` + `for await...of`（流式的骨架）

这个即使是全栈，平时也未必天天写，但它是**整个流式管线的骨架**，值得单拎出来。

普通函数 `return` 一次就结束。**生成器函数**（`function*`，带星号）能**多次 `yield`**、每次吐一个值、然后暂停，等你要下一个再继续。加上 `async`，就是**异步生成器**——可以在 `yield` 之间 `await`（比如等网络下一个数据块）：

```ts
async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()   // 等网络下一块
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()   // 吐一行出去，暂停
    }
  }
}
```

（这里的 `res.body!` 那个 `!` 是 00a §7 讲的非空断言——`fetch` 的流式响应体类型上是 `ReadableStream | null`，但流式请求成功后它一定在，所以用 `!` 担保。`AsyncGenerator<string>` 是泛型，读成"吐出 string 的异步生成器"。）

消费端用 **`for await...of`** 一个个接：

```ts
for await (const data of sseLines(res)) {   // 每 yield 一行，这里转一圈
  const ev = JSON.parse(data)
  ...
}
```

**为什么流式非它不可**：模型的回复是**一块一块从网络流回来**的，你不想等全部到齐才处理（那就不叫流式了）。异步生成器让你写成"每来一块就 `yield` 出去"，消费端用 `for await` 像遍历数组一样自然地边到边处理。`streamChat` 也是 `async function*`：provider 每解析出一个归一化事件就 `yield`，调用方 `for await` 逐个消费。**一条从网络字节到归一化事件的流水线，全靠这套语法串起来。**

---

## 二、生态与工具链地图（你说不熟的这块）

语言讲完，剩下这套"周边"——运行时、编译、模块、包管理。你说不熟，我给你一张地图。

### 2.1 运行时：Node / Deno / Bun 是什么关系

它们都是**在浏览器之外跑 JS 的运行时**，可以类比成"JS 世界的三种 JVM"：

- **Node.js**：最老牌、生态最大，业界默认。但它**原生只认 JS**——想跑 TS 得先编译，或挂个加载器。
- **Deno**：Node 原作者重做的，原生支持 TS——但和 Bun 一样，`deno run` **默认也只擦类型、跑时不做类型检查**（要检查得显式 `deno check` 或 `deno run --check`，只有 `deno test` 默认查）。它真正的差异化在**更严的安全沙箱**（默认无文件/网络权限）。
- **Bun**：最新、主打快，**原生直接跑 `.ts`**，内置打包器/测试器/包管理器，还内置了 `fetch`、Web Streams、`.env` 自动加载这些"开箱即用"的东西。

本卷用 **Bun**，因为**源码 `claude-code-rev` 本身就是 Bun 项目**，最贴近。副作用是很多便利白拿：`spike.ts` 里读 `process.env.OPENAI_API_KEY` 没引任何 dotenv 库，就是 Bun 自动加载了 `.env`。

### 2.2 为什么 TS 通常要"编译"、而 Bun 能直接跑

浏览器和 Node **看不懂 TS 语法**（那些类型标注不是合法 JS）。所以传统流程是：**`tsc` 把 `.ts` 编译成 `.js`**（这一步顺便做类型检查），再拿 Node 跑那个 `.js`。

Bun（和 Deno、以及很新的 Node）走的是另一条路：**运行时内置了转译器**，加载 `.ts` 时**当场把类型标注剥掉**、直接跑剩下的 JS。所以 `bun run spike.ts` 不用你先编译。

**但有个关键坑必须说清**（其实 00a §2 已经先立过这根弦，这里说透）：Bun 直接跑 = **只转译、不做类型检查**（它只是"擦掉"类型，不验证类型对不对）。也就是说，**代码里有类型错误，Bun 照样能跑起来**——直到那个错误在运行时真的炸了你才发现。真正的类型检查靠两处：**你的编辑器**（实时标红）和**手动跑 `tsc --noEmit`**（只检查、不产出文件）。所以本卷 `tsconfig` 里 `"noEmit": true`——我们从不用 `tsc` 产 `.js`（Bun 直接跑源码），`tsc` 只当"类型检查器"用。**心里要有这根弦：能跑 ≠ 类型没错。**

### 2.3 `tsc` / `tsx` / `ts-node` 各是什么

你在 TS 项目里会撞见这几个名字，一句话区分：

- **`tsc`**：官方编译器（TypeScript Compiler）。`.ts → .js`，或加 `--noEmit` 只做类型检查。
- **`ts-node`**：给 Node 挂的加载器，让 Node 能"直接跑" `.ts`（其实是运行时帮你编译）。老牌方案。
- **`tsx`**：更快的同类替代（基于 esbuild），现在更常用。

**本卷一个都不太需要**——Bun 把"直接跑 TS"这件事内置了。列出来是为了你在别的 TS 项目里看到不发懵。

### 2.4 模块系统：ESM vs CommonJS，和那个 `.js` 后缀之谜

JS 有两套"怎么把文件拆成模块、怎么互相 import"的体系：

- **CommonJS（CJS）**：Node 的老体系，`require()` / `module.exports`。
- **ESM（ES Modules）**：现代标准，`import` / `export`。本卷用这套（`package.json` 里 `"type": "module"` 就是声明"这个项目走 ESM"）。

（我们的 `spike.ts` 是自包含单文件，**没有任何 import**。）等**翻开源码 `claude-code-rev`**，你会看到大量这样的 import——注意这是**源码、不是我们的 spike**：

```ts
import type { AnalyticsMetadata } from '../../services/analytics/index.js'
```

这行有两个点值得说：

**`import type`** = "我只借这个**类型**，不借运行时的值"——转译后这行会被**整条删掉**（类型是编译期的，回扣 00a §1）。这里得说清一个 JS 老手会踩的坑：传统 `tsc` 会做"导入省略"，普通 `import { Foo }` 只当类型用时也会被自动删掉；但 **Bun 这种逐文件转译器**（还有 `isolatedModules`）**不做跨文件类型分析**，判断不出 `import { Foo }` 是不是纯类型，于是可能把它**当成运行时导入保留下来**——轻则触发副作用，重则找不到模块直接报错。所以在本卷（Bun）里，只当类型用的导入写 `import type` 更接近**"必须"**，而不只是"更干净"。

**那个"文件是 `.ts` 却 import `.js`"的怪事**：它**不是 ESM 语言规范逼的**，而是 **TypeScript 的约定**——TS 从不改写你 import 里的路径字符串。所以有些项目会把路径写成"**假设将来编译成 `.js` 后**该有的那个名字"（哪怕源文件是 `.ts`），运行时/打包器再把这个 `.js` 说明符**解析回对应的 `.ts`**——**并不真的存在一个被加载的 `.js` 文件**（Bun 直接跑 `.ts`，回扣 §2.2）。在 `node16`/`nodenext` 这类解析模式下它是硬性要求；在别的模式下（源码其实用的就是下面说的 `bundler`）更多是团队沿用的写法习惯。

**好消息**：本卷自己的 `tsconfig` 用 `"moduleResolution": "bundler"`，这个模式**不要求写扩展名**——所以我们自己的代码 `import './chat'` 就行，不用加 `.js`。你只在**翻源码**时会撞见那串 `.js` 后缀，知道它是"TS 不改写路径 + 写成 emit 后的名字"这套约定即可，别照抄到我们的代码里。

### 2.5 类型从哪来：`@types/*` 与 `tsconfig` 关键字段

很多 JS 库本身没带类型（它是纯 JS 写的）。社区把类型定义单独打包，放在一个叫 **DefinitelyTyped** 的仓库里，发布成 `@types/xxx` 包。比如给 Node 的内置 API 补类型就装 `@types/node`。

本卷 `package.json` 的 devDependencies 里有 `@types/bun`——给 Bun 的全局 API（像 `Bun.file`）补类型，**只在开发时给编辑器用**，跑的时候 Bun 自己知道，不需要它。

`tsconfig.json` 几个你会看到的关键字段：

- `"strict": true` —— 打开一整套严格检查（00a §7 那些 `?.`/`??`/`!`/下标可能 undefined）。
- `"module" / "target": "ESNext"` —— 用最新的模块语法和 JS 特性（Bun 都支持）。
- `"moduleResolution": "bundler"` —— §2.4 说的，让我们不用写 `.js` 后缀。
- `"noEmit": true` —— §2.2 说的，`tsc` 只检查不产文件。

装了 `@types/bun` 后，TypeScript 会**自动纳入**它（所有 `@types/*` 默认都自动纳入，不用在 `tsconfig` 里显式列 `types`）——于是 `Bun.file`、`process.env` 这些全局才有类型提示。

### 2.6 包管理：npm / pnpm / bun 一句话区分

- **npm**：Node 自带，最通用。
- **pnpm**：用硬链接共享依赖，省磁盘、装得快。
- **bun**：Bun 自带的包管理器，非常快，`bun install` 一步到位。

本卷用 `bun install`，命令、锁文件都归 Bun 管，你不用在它们之间纠结。

---

## 小结

- **语言层**（全在 `spike.ts` 里，接着 00a 的地基往上叠）：**可辨识联合 + `switch` 收窄**（全卷最核心，是"归一化"的类型层落地，也是把 00a 字面量联合叠上"身份牌"的一层）→ `class implements 接口`（provider 必须签的合同）→ **`async function*` + `for await`** 是流式骨架。
- **生态层**：Node/Deno/**Bun** 三种运行时，本卷用 Bun 因为源码是 Bun 项目；Bun **只转译不检查**（能跑 ≠ 类型没错，检查靠编辑器/`tsc --noEmit`）；ESM 走 `import/export`，源码那串 `.js` 后缀是 TS 约定（写成 emit 后的名字、不是 ESM 规范逼的），我们用 `bundler` 模式免了；`@types/*` 补类型；`bun install` 管依赖。

带着 00a 的地基 + 这篇的三招进阶，实战01 的代码你就能**逐行读懂**，而不是"大概看个意思"。

下一篇——**实战01《第一次对话：可插拔的模型层》**：我们把 spike 里验证过的那条缝，收敛成 `code/harness/` 里第一份正式代码——一个换个 key 就能切后端的 `chat()`。那是整台 harness 最底下、会抖的那块芯片。
