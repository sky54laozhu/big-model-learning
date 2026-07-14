// 回扣源码 uuid.ts：纯正则校验，只认 8-4-4-4-12 十六进制格式，不校验 version/variant 位
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 校验通过返回原值，否则 null——调用方拿 null 当"这不是合法 UUID"处理，不抛异常 */
export function validateUuid(maybeUuid: string | undefined): string | null {
  if (typeof maybeUuid !== 'string') return null
  return UUID_REGEX.test(maybeUuid) ? maybeUuid : null
}
