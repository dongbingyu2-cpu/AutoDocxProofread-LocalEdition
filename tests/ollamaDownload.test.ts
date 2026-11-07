import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeDownloadModel, pullOllamaModel } from '../src/main/ollamaDownload'

afterEach(() => vi.unstubAllGlobals())
const response = (text: string) => new Response(text)

describe('Ollama 模型下载传输（Mock，无模型权重下载）', () => {
  it('校验官方名称并拒绝网址、命令、第三方注册表及云端模型', () => {
    for (const name of ['qwen3.5:4b', 'qwen3:8b', 'embeddinggemma:300m', 'user/my-model:q4_0']) {
      expect(normalizeDownloadModel(' ' + name + ' ')).toBe(name)
    }
    for (const name of ['', 'https://example.com/model', 'hf.co/user/model:Q4', 'host.com/model:8b', '../model', 'qwen; whoami', 'qwen3:8b-cloud', 'model:cloud', 'x'.repeat(161)]) {
      expect(() => normalizeDownloadModel(name)).toThrow()
    }
  })
  it('只发送模型名；任意网络分块、UTF-8 和末行无换行均正常解析', async () => {
    const text = '{"status":"pulling manifest"}\n{"status":"下载中","total":100,"completed":50}\n{"status":"success"}'
    const bytes = new TextEncoder().encode(text)
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close() }
    })))
    vi.stubGlobal('fetch', fetcher)
    const progress: any[] = []
    await pullOllamaModel('qwen3.5:4b', 'http://localhost:11434/v1', p => progress.push(p))
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, options] = fetcher.mock.calls[0] as any
    expect(url).toBe('http://localhost:11434/api/pull')
    expect(JSON.parse(options.body)).toEqual({ model: 'qwen3.5:4b', stream: true })
    expect(options.redirect).toBe('error')
    expect(progress[1]).toMatchObject({ status: '下载中', percent: 50, total: 100, completed: 50 })
    expect(progress.at(-1).status).toBe('success')
  })
  it('不连接非回环服务，已取消任务不发送任何请求', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(pullOllamaModel('qwen3:4b', 'https://example.com', () => {})).rejects.toThrow('回环')
    const controller = new AbortController(); controller.abort()
    await expect(pullOllamaModel('qwen3:4b', undefined, () => {}, controller.signal)).rejects.toThrow('取消')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    ['{"status":"pulling manifest"}', '提前结束'],
    ['{"error":"pull model manifest: file does not exist"}', '模型不存在'],
    ['{"error":"no space left on device"}', '空间不足'],
    ['not json', '格式无效'],
    ['null', '格式无效'],
    ['{}', '缺少状态']
  ])('未完成或错误响应不能报成功：%s', async (body, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(body)))
    await expect(pullOllamaModel('qwen3:4b', undefined, () => {})).rejects.toThrow(message)
  })
  it('拒绝接口错误并给出服务连接提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(pullOllamaModel('qwen3:4b', undefined, () => {})).rejects.toThrow('HTTP 404')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(pullOllamaModel('qwen3:4b', undefined, () => {})).rejects.toThrow('本机 Ollama 已启动')
  })
  it('停滞下载可超时，也可主动取消；错误后关闭流', async () => {
    let streamCancelled = false
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => new Response(new ReadableStream({
      start(controller) { options.signal.addEventListener('abort', () => controller.error(new Error('aborted'))) },
      cancel() { streamCancelled = true }
    }))))
    await expect(pullOllamaModel('qwen3:4b', undefined, () => {}, undefined, 15)).rejects.toThrow('长时间无响应')
    const controller = new AbortController()
    const task = pullOllamaModel('qwen3:4b', undefined, () => {}, controller.signal)
    setTimeout(() => controller.abort(), 10)
    await expect(task).rejects.toThrow('已取消')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('invalid\n')) },
      cancel() { streamCancelled = true }
    }))))
    await expect(pullOllamaModel('qwen3:4b', undefined, () => {})).rejects.toThrow('格式无效')
    expect(streamCancelled).toBe(true)
  })
  it('已下载字节按当前层计算并限制百分比范围', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('{"status":"pulling a","total":10,"completed":12}\n{"status":"pulling b","total":20,"completed":2}\n{"status":"success"}')))
    const values: any[] = []
    await pullOllamaModel('qwen3:4b', undefined, p => values.push(p))
    expect(values.map(p => p.percent)).toEqual([100, 10, undefined])
  })
})
