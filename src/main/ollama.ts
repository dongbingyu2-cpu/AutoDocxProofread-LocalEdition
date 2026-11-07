import { DEFAULT_LOCAL_SETTINGS, normalizeLocalSettings, type LocalEditionSettings } from '../shared/localEdition'
import { assertModelNetwork } from './networkPolicy'
import type { LocalPromptBudget } from './localPromptBudget'
import { AsyncLocalStorage } from 'node:async_hooks'

let settings = { ...DEFAULT_LOCAL_SETTINGS }
const taskSettings = new AsyncLocalStorage<LocalEditionSettings>()
export function configureOllama(value: LocalEditionSettings) { settings = normalizeLocalSettings(value) }
export function getOllamaSettings() { return structuredClone(taskSettings.getStore() || settings) }
/** 文档规划与生成共用任务快照，其他窗口保存参数不会改变在途请求的预算。 */
export function withOllamaSettings<T>(value: LocalEditionSettings, run: () => Promise<T>): Promise<T> {
  return taskSettings.run(normalizeLocalSettings(value), run)
}

export function ollamaOrigin(value = 'http://127.0.0.1:11434'): string {
  assertModelNetwork('ollama', value)
  const url = new URL(value)
  if (!['', '/', '/v1', '/v1/', '/api', '/api/'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('Ollama 地址请使用服务根地址或 /v1 地址。')
  }
  return url.origin
}

function abortError() { return new Error('Ollama 请求已取消或超时。') }
function checkAbort(signal: AbortSignal) { if (signal.aborted) throw abortError() }

let active = 0
const waiting = new Set<() => void>()
/** 排队阶段也接受取消，finally 总会归还并发名额。 */
async function withSlot<T>(signal: AbortSignal, limit: number, fn: () => Promise<T>): Promise<T> {
  while (active >= limit) {
    checkAbort(signal)
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { waiting.delete(wake); signal.removeEventListener('abort', cancel) }
      const wake = () => { cleanup(); resolve() }
      const cancel = () => { cleanup(); reject(abortError()) }
      waiting.add(wake)
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    })
  }
  checkAbort(signal)
  active++
  try { return await fn() } finally {
    active--
    for (const wake of [...waiting]) wake()
  }
}

async function bounded<T>(signal: AbortSignal | undefined, timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const timer = setTimeout(cancel, timeoutMs)
  try { return await fn(controller.signal) } catch (error) {
    if (controller.signal.aborted) throw abortError()
    throw error
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}

async function request(origin: string, route: string, signal: AbortSignal, body?: unknown): Promise<Response> {
  checkAbort(signal)
  // 禁止重定向，避免回环服务以 30x 将正文转发至外部地址。
  const response = await fetch(`${origin}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    redirect: 'error'
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Ollama HTTP ${response.status}：请检查服务、模型名称和模型能力；不会下载模型或回退云端。`)
  }
  return response
}

function assertLocalModel(model: any, name: string) {
  if (/:cloud(?:$|[-:])/i.test(name) || /-cloud$/i.test(name) || model?.remote_model || model?.remote_host || model?.details?.remote_model) {
    throw new Error('本地模式拒绝 Ollama 云模型，请选择已下载的本地模型。')
  }
}

async function showModel(origin: string, model: string, signal: AbortSignal) {
  if (!model?.trim()) throw new Error('请先选择或输入本地模型名称。')
  assertLocalModel(null, model)
  const info = await (await request(origin, '/api/show', signal, { model })).json()
  assertLocalModel(info, model)
  return info
}

export async function discoverOllama(url?: string) {
  const origin = ollamaOrigin(url)
  return bounded(undefined, 5000, async signal => {
    const data = await (await request(origin, '/api/tags', signal)).json()
    if (!Array.isArray(data.models)) throw new Error('Ollama 模型列表格式无效。')
    return { origin, models: data.models.filter((m: any) => {
      try { assertLocalModel(m, m.name); return typeof m.name === 'string' } catch { return false }
    }).map((m: any) => ({ name: m.name, size: m.size, digest: m.digest, details: m.details })) }
  })
}

function promptBudget(config: LocalEditionSettings, info: any): LocalPromptBudget {
  const modelContext = Object.entries(info.model_info || {}).find(([key]) => key.endsWith('.context_length'))?.[1]
  const context = Math.min(config.contextLength, typeof modelContext === 'number' ? modelContext : config.contextLength)
  const values = info.thinking?.values
  return { context, inputBytes: context - config.maxTokens - 256, maxTokens: config.maxTokens,
    thinkingOnly: Array.isArray(values) && values.includes(true) && !values.includes(false) }
}

/** 截断响应不可采用，但已发生的用量仍需计入任务；调用方可尝试更小的同模型子片。 */
export class OllamaOutputLimitError extends Error {
  constructor(public total_tokens: number) {
    super('Ollama 输出达到上限，结果未采用，请增大输出上限或选择支持关闭思考的模型。')
  }
}

/** 文档分片与发送前检查使用同一预算，计入系统提示、输出和模型实际上限。 */
export async function getOllamaPromptBudget(model: string, url?: string, signal?: AbortSignal): Promise<LocalPromptBudget> {
  const config = getOllamaSettings(), origin = ollamaOrigin(url)
  return bounded(signal, config.timeoutSec * 1000, async inner => promptBudget(config, await showModel(origin, model, inner)))
}

export async function generateOllama(
  system: string, prompt: string, model: string, url?: string,
  onChunk?: (text: string) => void, signal?: AbortSignal, onThinking?: (text: string) => void,
  timeoutMs?: number
): Promise<{ result: string; total_tokens: number }> {
  const origin = ollamaOrigin(url)
  const config = getOllamaSettings()
  return bounded(signal, timeoutMs || config.timeoutSec * 1000, inner => withSlot(inner, config.concurrency, async () => {
    const info = await showModel(origin, model, inner)
    const { context, inputBytes } = promptBudget(config, info)
    // 按 UTF-8 字节做保守预算，预留输出与模板；宁可提示拆分，也不静默截断原文。
    if (Buffer.byteLength(system + prompt, 'utf8') > inputBytes) {
      throw new Error(`输入超过本地上下文预算（${context}）。请增大上下文、减少输出上限或缩小文档章节。`)
    }
    // 新版 Ollama 的 thinking.values 是权威控制列表。部分 Qwen3 标签仅支持 true，
    // 不能强传 false，否则推理可能进入正文；有命名等级时使用服务声明的默认值。
    const thinkingValues = info.thinking?.values
    const think = Array.isArray(thinkingValues)
      ? thinkingValues.includes(false) ? false : thinkingValues.includes(true) ? true : info.thinking.default ?? thinkingValues[0]
      : info.capabilities?.includes('thinking') ? false : undefined
    const response = await request(origin, '/api/chat', inner, {
      model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      stream: Boolean(onChunk),
      ...(think !== undefined ? { think } : {}),
      options: { num_ctx: context, num_predict: config.maxTokens, temperature: 0.5 }
    })
    const processItem = (item: any) => {
      if (item.error) throw new Error('Ollama 生成失败，请检查服务日志或模型能力。')
      if (item.message?.thinking) onThinking?.(item.message.thinking)
      const chunk = item.message?.content || ''
      if (typeof chunk !== 'string') throw new Error('Ollama 返回格式无效。')
      onChunk?.(chunk)
      return chunk
    }
    if (!onChunk) {
      const item = await response.json()
      const result = processItem(item)
      if (item.done_reason === 'length') throw new OllamaOutputLimitError((item.prompt_eval_count || 0) + (item.eval_count || 0))
      if (!item.done) throw new Error('Ollama 输出未完整结束，请增大输出上限或选择支持关闭思考的模型。')
      if (!result.trim()) throw new Error('Ollama 未返回正文，请检查模型能力与输出上限。')
      return { result, total_tokens: (item.prompt_eval_count || 0) + (item.eval_count || 0) }
    }
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = '', result = '', total_tokens = 0, done = false
    const consume = (line: string) => {
      if (!line.trim()) return
      const item = JSON.parse(line)
      result += processItem(item)
      if (item.done_reason === 'length') throw new OllamaOutputLimitError((item.prompt_eval_count || 0) + (item.eval_count || 0))
      if (item.done) { done = true; total_tokens = (item.prompt_eval_count || 0) + (item.eval_count || 0) }
    }
    try {
      while (true) {
        checkAbort(inner)
        const part = await reader.read()
        buffer += decoder.decode(part.value, { stream: !part.done })
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1) }
        if (buffer.length + result.length > 4 * 1024 * 1024) throw new Error('Ollama 响应超出大小限制。')
        if (part.done) break
      }
      consume(buffer)
      if (!done) throw new Error('Ollama 流式连接提前关闭，结果未采用。')
      if (!result.trim()) throw new Error('Ollama 未返回正文，请检查模型能力与输出上限。')
      checkAbort(inner)
      return { result, total_tokens }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  }))
}

export async function embedOllama(input: string | string[], model: string, url: string, signal?: AbortSignal) {
  const origin = ollamaOrigin(url)
  const config = getOllamaSettings()
  return bounded(signal, config.timeoutSec * 1000, inner => withSlot(inner, config.concurrency, async () => {
    await showModel(origin, model, inner)
    const data = await (await request(origin, '/api/embed', inner, { model, input, truncate: false })).json()
    const expected = Array.isArray(input) ? input.length : 1
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== expected ||
      !data.embeddings.every((v: any) => Array.isArray(v) && v.length > 0 && v.every(Number.isFinite)) ||
      !data.embeddings.every((v: number[]) => v.length === data.embeddings[0].length)) {
      throw new Error('Ollama 返回的 Embedding 数量、维度或数值无效。请使用支持 Embedding 的本地模型。')
    }
    return Array.isArray(input) ? data.embeddings as number[][] : data.embeddings[0] as number[]
  }))
}
