import { ollamaOrigin } from './ollama'

export interface PullProgress {
  status: string
  total?: number
  completed?: number
  percent?: number
}

/** 仅接收官方模型库名称，不把任意 URL、命令或第三方注册表交给 Ollama。 */
export function normalizeDownloadModel(value: unknown): string {
  const model = typeof value === 'string' ? value.trim() : ''
  if (model.length > 160 || !/^(?:[a-zA-Z0-9][a-zA-Z0-9_-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(model)) {
    throw new Error('请输入 Ollama 官方模型库名称，例如 qwen3.5:4b 或 namespace/model:tag。')
  }
  const base = model.split(':')[0]
  if (base.includes('..') || base.startsWith('.') || (base.includes('/') && base.split('/')[0].includes('.'))) {
    throw new Error('仅支持 Ollama 官方模型库名称，不支持下载网址或第三方注册表。')
  }
  if (/(?:^|[-_:])cloud(?:$|[-_:])/i.test(model)) throw new Error('请选择可下载到本机的模型，云端模型不能作为本地模型下载。')
  return model
}

/**
 * 调用本机 Ollama /api/pull；断开流即取消本程序的下载请求。
 * 超时按“无进度时间”计，避免正常的大文件下载因总耗时较长而被中断。
 */
export async function pullOllamaModel(
  modelName: string,
  url: string | undefined,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
  idleTimeoutMs = 120000
): Promise<void> {
  const model = normalizeDownloadModel(modelName), origin = ollamaOrigin(url || undefined)
  const controller = new AbortController()
  let timedOut = false, timer: ReturnType<typeof setTimeout> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const cancel = () => controller.abort()
  const resetTimeout = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { timedOut = true; controller.abort() }, idleTimeoutMs)
  }
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try {
    if (controller.signal.aborted) throw new Error('下载已取消。')
    resetTimeout()
    const response = await fetch(`${origin}/api/pull`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }), signal: controller.signal, redirect: 'error'
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(response.status === 404
        ? 'Ollama 下载接口不可用（HTTP 404），请检查服务地址并更新 Ollama。'
        : `Ollama 下载失败（HTTP ${response.status}），请检查服务与网络后重试。`)
    }
    if (!response.body) throw new Error('Ollama 未返回下载进度。')
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '', success = false
    const consume = (line: string) => {
      if (!line.trim()) return
      let item: any
      try { item = JSON.parse(line) } catch { throw new Error('Ollama 下载进度格式无效，请检查服务地址。') }
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Ollama 下载进度格式无效。')
      if (item.error) {
        const detail = String(item.error)
        if (/not exist|not found|manifest.*404/i.test(detail)) throw new Error('模型不存在，请检查完整模型名称及标签。')
        if (/space|disk full/i.test(detail)) throw new Error('模型下载失败：Ollama 模型所在磁盘空间不足。')
        // 仅展示有限长度的服务错误，不展示完整响应或请求内容。
        throw new Error(`Ollama 下载失败：${detail.slice(0, 240)}`)
      }
      if (typeof item.status !== 'string' || !item.status) throw new Error('Ollama 下载进度缺少状态。')
      const total = Number.isFinite(item.total) && item.total > 0 ? item.total : undefined
      const completed = Number.isFinite(item.completed) && item.completed >= 0 ? item.completed : undefined
      onProgress({ status: item.status.slice(0, 180), total, completed,
        percent: total !== undefined && completed !== undefined ? Math.min(100, Math.floor(completed / total * 100)) : undefined })
      success = item.status === 'success'
    }
    while (true) {
      if (controller.signal.aborted) throw new Error('下载已取消。')
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      if (buffer.length > 1024 * 1024) throw new Error('Ollama 下载进度响应过大。')
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1)
      }
      if (chunk.done) { consume(buffer); break }
      resetTimeout()
    }
    if (!success) throw new Error('下载连接提前结束，模型尚未完成。请重试，Ollama 会复用已有下载。')
  } catch (error) {
    if (signal?.aborted) throw new Error('下载已取消。')
    if (timedOut) throw new Error('下载长时间无响应，请检查网络后重试。')
    if (error instanceof TypeError) throw new Error('无法连接 Ollama 或下载连接已中断，请确认本机 Ollama 已启动。')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    await reader?.cancel().catch(() => {})
    reader?.releaseLock()
  }
}
