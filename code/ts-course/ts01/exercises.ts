// ts01 练习：类型 = 一组允许的值（集合）
//
// 玩法：把每个 TODO 处的类型填对。本篇是纯类型题，验证方式——
//   在 code/ts-course/ 目录下跑：  bun run typecheck   （即 tsc --noEmit）
//   一个错都不报 = 你全对了。
// 一开始它会报一堆错，那是故意的（占位类型是错的）。你的活就是把红字消干净。
// 卡住了再看同目录 solution.ts，别先偷看。

import type { Expect, Equal } from '../type-utils'

// ── 练习 1：类型就是集合。把 Flag 定义成"只允许 true / false"的类型 ──
// TODO: 把 unknown 换成正确的类型
type Flag = unknown
type _1 = Expect<Equal<Flag, boolean>>

// ── 练习 2：单元素集合。把 Red 定义成"只允许字符串 '红' 这一个值" ──
// 提示：一个字面量值本身就能当类型
// TODO
type Red = unknown
type _2 = Expect<Equal<Red, '红'>>

// ── 练习 3：并集 = 圈出子集。Color 恰好允许 '红' '绿' '蓝' 三个值 ──
// TODO
type Color = unknown
type _3 = Expect<Equal<Color, '红' | '绿' | '蓝'>>

// ── 练习 3b：验证栅栏真的生效 ──
// 说明：把练习 3 的 Color 填对后，'紫' 不在集合里、下面这行就会红线，
// 下面那行的 ts-expect-error 才会"命中"、这行才通过。
// （Color 还是 unknown 时它命不中、反而报"未使用"——这就是提示你练习 3 没做完）
// @ts-expect-error
const badColor: Color = '紫'

// ── 练习 4：unknown 是全集，用前必须收窄 ──
// 补全 if 的判断条件，把 x 收窄成 string，让 .toUpperCase() 不再报错
function shout(x: unknown): string {
  // TODO: 把 false 换成"判断 x 是不是 string"的条件
  if (false) {
    return x.toUpperCase()
  }
  return ''
}

// ── 练习 5：空集 = never。只会抛异常、永不返回的函数，返回类型该是什么？ ──
// TODO: 把 unknown 换成正确的返回类型
function boom(): unknown {
  throw new Error('我永远不会正常返回')
}
type _5 = Expect<Equal<ReturnType<typeof boom>, never>>

export { shout, boom }
export type { Flag, Red, Color }
