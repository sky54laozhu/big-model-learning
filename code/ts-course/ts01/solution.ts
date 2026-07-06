// ts01 参考答案 —— 先自己做 exercises.ts，卡住了再看这里。
// 这个文件本身也能过 typecheck（正确答案的活体证明）。

import type { Expect, Equal } from '../type-utils'

// 练习 1：boolean 就是集合 {true, false}
type Flag = boolean
type _1 = Expect<Equal<Flag, boolean>>

// 练习 2：字面量值升格成类型 = 只装一个值的单元素集合
type Red = '红'
type _2 = Expect<Equal<Red, '红'>>

// 练习 3：竖线 | = 求并集，把三个单元素集合并成三元素子集
type Color = '红' | '绿' | '蓝'
type _3 = Expect<Equal<Color, '红' | '绿' | '蓝'>>

// 练习 3b：'紫' 不在 Color 集合里，编译期红线，@ts-expect-error 命中
// @ts-expect-error
const badColor: Color = '紫'

// 练习 4：typeof 守卫把 unknown 收窄成 string，之后 .toUpperCase() 合法
function shout(x: unknown): string {
  if (typeof x === 'string') {
    return x.toUpperCase()
  }
  return ''
}

// 练习 5：永不返回的函数，返回值集合是空集 = never
function boom(): never {
  throw new Error('我永远不会正常返回')
}
type _5 = Expect<Equal<ReturnType<typeof boom>, never>>

export { shout, boom }
export type { Flag, Red, Color }
