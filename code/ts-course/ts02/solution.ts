// ts02 参考答案 —— 先自己做 exercises.ts，卡住了再看这里。
// 这个文件本身也能过 typecheck（正确答案的活体证明）。

import type { Expect, Equal } from '../type-utils'

// 练习 1：let 以后能重新赋值，宽化成整个 string 集合
let a = 'hello'
type _1 = Expect<Equal<typeof a, string>>

// 练习 2：const 锁死不变，精确成单元素集合 "hello"
const b = 'hello'
type _2 = Expect<Equal<typeof b, 'hello'>>

// 练习 3：注解收窄默认的宽化结果
let c: 'on' | 'off' = 'on'
c = 'off' // 应该放行

// @ts-expect-error
c = 'other'

// 练习 4：注解是契约——把值改成属于 number 集合的成员
let d: number = 42

// 练习 5：函数参数不能反推，必须手写注解
function greet(name: string) {
  return name.toUpperCase()
}

// 练习 6：evolving any 沿路径边走边攒，最终攒成联合类型
let arr = []
arr.push(1)
arr.push('hello')
type _6 = Expect<Equal<typeof arr, (string | number)[]>>

// 练习 6b：闭包捕获打断"边走边攒"，list 退回隐式 any
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
