// 两家 provider 的流式响应都是 SSE（Server-Sent Events）：一行行 `data: <json>\n\n`。
// 这个生成器只管拆行、吐 data 负载——不管里面的 json 长什么样，那是各 provider 自己的事。
export async function* readSSE(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? '' // 网络包可能把一行切成两半，留到下一轮拼完整
    for (const line of lines) {
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
}
