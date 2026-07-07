// ts02 练习：注解 vs 推断 + 编译期擦除
//
// 玩法跟 ts01 一样——把每个 TODO 处填对。验证方式：
//   在 code/ts-course/ 目录下跑：  bun run typecheck   （即 tsc --noEmit）
//   一个错都不报 = 你全对了。
// 卡住了再看同目录 solution.ts，别先偷看。

import type { Expect, Equal } from '../type-utils'

// ── 练习 1：宽化。let 以后能重新赋值，推断结果会放宽成什么？──
let a = 'hello'
// TODO: 把 unknown 换成 a 被推断出的类型
type _1 = Expect<Equal<typeof a, unknown>>

// ── 练习 2：const 不宽化。锁死不变，推断结果精确成什么？──
const b = 'hello'
// TODO: 把 unknown 换成 b 被推断出的类型
type _2 = Expect<Equal<typeof b, unknown>>

// ── 练习 3：用注解收窄默认的宽化结果 ──
// c 还是 let（以后要能变），但只允许在 'on' / 'off' 之间切换
// TODO: 给 c 补一个类型注解，把它收窄成 'on' | 'off'
let c = 'on'
c = 'off' // 应该放行

// 说明：把上面的注解补对后，'other' 就不在集合里、下面这行会红线，
// ts-expect-error 才会"命中"。（c 还没收窄时它命不中、反而报"未使用"——
// 这就是提示你上面的注解没写对）
// @ts-expect-error
c = 'other'

// ── 练习 4：注解是契约，不是盲目照单全收。这一行错在哪？改到能通过编译 ──
// TODO: 右边的值不属于 number 集合，改成一个真正的 number（不要改注解类型）
let d: number = 'hello'

// ── 练习 5：函数参数不能反推。编译器不会因为函数体里 name.toUpperCase() 就推出 name 是 string ──
// TODO: 给 name 写类型注解，去掉 TS7006 implicit any 报错
function greet(name) {
  return name.toUpperCase()
}

// ── 练习 6：evolving any——沿着一条编译器看得到的路径边走边攒类型 ──
let arr = []
arr.push(1)
arr.push('hello')
// TODO: 把 unknown 换成 arr 最终被攒出的类型
type _6 = Expect<Equal<typeof arr, unknown>>

// ── 练习 6b（演示，不用你填）：闭包捕获会打断"边走边攒" ──
// 说明：readFirst 什么时候被调用是不确定的，编译器在那一刻看不到 list 攒到哪一步了，
// 于是 list 又滑回了 any——这两行的 @ts-expect-error 已经替你验证过，直接读懂就好。
function makeReader() {
  // @ts-expect-error   list 在下面 readFirst 内被捕获时，类型无法确定
  let list = []
  function readFirst() {
    // @ts-expect-error   同上：list 在这个分支里退回了隐式 any
    return list[0].toFixed(2)
  }
  list.push(1)
  return readFirst
}

export { greet, makeReader }
