// 类型级断言工具 —— 全卷练习共用
//
// 玩法（借自 type-challenges，MIT）：
//   Expect<Equal<你写的类型, 期望的类型>>
// 如果两个类型完全相等，Equal 求出 true，Expect<true> 通过；
// 否则 Equal 求出 false，Expect<false> 会让 `tsc --noEmit` 报错。
// 所以「typecheck 一个错都不报」= 你全填对了。

/** 只接受字面量 true。传进 false 会编译报错 —— 这就是"断言失败"。 */
export type Expect<T extends true> = T

/**
 * 判断两个类型是否严格相等（连 any/never 这些边角都能分清）。
 * 原理不必现在懂，阶段五讲条件类型时你会回来看它。
 */
export type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false

/** 反过来：断言两个类型不相等。 */
export type NotEqual<X, Y> = Equal<X, Y> extends true ? false : true
