import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureOllama, discoverOllama, embedOllama, generateOllama, ollamaOrigin, getOllamaPromptBudget, OllamaOutputLimitError, withOllamaSettings } from '../src/main/ollama'
import { DEFAULT_LOCAL_SETTINGS, normalizeLocalSettings } from '../src/shared/localEdition'
import { assertModelNetwork, withLocalPolicy } from '../src/main/networkPolicy'
import { REDUCE_AI_RATE_SYSTEM_PROMPT } from '../src/shared/prompts/zh-CN'
import { passedSemanticReview, validateRewrite } from '../src/main/rewriteQuality'

const json = (value: any, status = 200) => new Response(JSON.stringify(value), { status })
const info = { capabilities: ['completion', 'thinking'], model_info: { 'qwen3.context_length': 16384 } }
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => {
  configureOllama(structuredClone(DEFAULT_LOCAL_SETTINGS))
  fetcher = vi.fn(async (url: string) => url.endsWith('/api/show') ? json(info) : json({ message: { content: '连接成功' }, done: true, prompt_eval_count: 5, eval_count: 3 }))
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Ollama 官方原生传输（Mock）', () => {
  it('任务中保存其他参数不会改变已规划的上下文或实际发送预算', async () => {
    await withOllamaSettings({ ...DEFAULT_LOCAL_SETTINGS }, async () => {
      configureOllama({ ...DEFAULT_LOCAL_SETTINGS, contextLength: 8192, maxTokens: 4096 })
      expect((await getOllamaPromptBudget('model')).context).toBe(16384)
      await generateOllama('规则', '正文', 'model')
      const request = JSON.parse(fetcher.mock.calls.at(-1)![1].body)
      expect(request.options).toMatchObject({ num_ctx: 16384, num_predict: 8192 })
    })
    expect((await getOllamaPromptBudget('model')).context).toBe(8192)
  })
  it('并行异步任务分别保留各自参数，失败后不污染下一任务', async () => {
    const configs = [
      { ...DEFAULT_LOCAL_SETTINGS, contextLength: 8192, maxTokens: 4096 },
      { ...DEFAULT_LOCAL_SETTINGS, contextLength: 16384, maxTokens: 8192 }
    ]
    const values = await Promise.all(configs.map(s => withOllamaSettings(s, async () => {
      await Promise.resolve()
      return getOllamaPromptBudget('model')
    })))
    expect(values.map(v => v.context)).toEqual([8192, 16384])
    await expect(withOllamaSettings(configs[0], async () => { throw new Error('fixture') })).rejects.toThrow('fixture')
    expect((await getOllamaPromptBudget('model')).context).toBe(16384)
  })
  it('规范化根地址、/v1 与 /api，并拒绝外部主机、凭据和任意路径', () => {
    expect(ollamaOrigin()).toBe('http://127.0.0.1:11434')
    expect(ollamaOrigin('http://localhost:11434/v1/')).toBe('http://localhost:11434')
    expect(ollamaOrigin('http://[::1]:11434/api')).toBe('http://[::1]:11434')
    for (const value of ['https://example.org', 'http://127.0.0.1.evil.com', 'http://key@localhost', 'file:///x', 'http://localhost/other']) expect(() => ollamaOrigin(value)).toThrow()
  })
  it('发现本地模型并过滤云模型，未发起模型下载', async () => {
    fetcher.mockResolvedValue(json({ models: [{ name: 'qwen3:8b' }, { name: 'test:cloud' }, { name: 'remote', remote_model: 'remote' }] }))
    const result = await discoverOllama()
    expect(result.models.map((m: { name: string }) => m.name)).toEqual(['qwen3:8b'])
    expect(fetcher.mock.calls[0][0]).toMatch('/api/tags')
  })
  it('默认配置能容纳原版降 AI 系统提示和短段落', async () => {
    await expect(generateOllama(REDUCE_AI_RATE_SYSTEM_PROMPT, '系统接收输入并显示结果。', 'model')).resolves.toHaveProperty('result')
  })
  it('普通生成传入真实上下文和输出上限，关闭思考且禁止重定向', async () => {
    const result = await generateOllama('系统', '用户', 'qwen3:8b')
    expect(result).toEqual({ result: '连接成功', total_tokens: 8 })
    const options = fetcher.mock.calls[1][1] as RequestInit
    expect(JSON.parse(options.body as string)).toMatchObject({ stream: false, think: false, options: { num_ctx: 16384, num_predict: 8192 } })
    expect(options.redirect).toBe('error')
  })
  it('文档规划预算遵循模型较小上下文并标明只能思考的模型', async () => {
    configureOllama({ ...DEFAULT_LOCAL_SETTINGS, maxTokens: 2048 })
    fetcher.mockImplementation(async () => json({ model_info: { 'qwen3.context_length': 4096 }, thinking: { values: [true] } }))
    expect(await getOllamaPromptBudget('small')).toEqual({ context: 4096, inputBytes: 1792, maxTokens: 2048, thinkingOnly: true })
  })
  it('截断结果带回已发生的用量，拒绝把半截正文当成功', async () => {
    fetcher.mockImplementation(async (url: string) => url.endsWith('/api/show') ? json(info) : json({ message: { content: '不完整' }, done: true, done_reason: 'length', prompt_eval_count: 50, eval_count: 4096 }))
    await expect(generateOllama('', 'text', 'model')).rejects.toMatchObject({ total_tokens: 4146 })
    await expect(generateOllama('', 'text', 'model')).rejects.toBeInstanceOf(OllamaOutputLimitError)
  })
  it('流式跨 UTF-8 和换行边界，保留最后一行，分离思考', async () => {
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/show')) return json(info)
      const bytes = new TextEncoder().encode('{"message":{"thinking":"思考","content":"你好"}}\n{"message":{"content":"世界"},"done":true,"eval_count":4}')
      return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close() } }))
    })
    const chunks: string[] = [], thoughts: string[] = []
    expect((await generateOllama('', '', 'qwen3:8b', undefined, t => chunks.push(t), undefined, t => thoughts.push(t))).result).toBe('你好世界')
    expect(chunks.join('')).toBe('你好世界')
    expect(thoughts).toEqual(['思考'])
  })
  it('思考模型只声明 true 时不强传 false，遵守实际元数据', async () => {
    fetcher.mockImplementation(async (url: string, options: RequestInit) => {
      if (url.endsWith('/api/show')) return json({ ...info, thinking: { values: [true], default: true } })
      expect(JSON.parse(options.body as string).think).toBe(true)
      return json({ message: { thinking: '内部思考', content: '最终答案' }, done: true })
    })
    const thinking: string[] = []
    expect((await generateOllama('', '', 'thinking-only', undefined, undefined, undefined, text => thinking.push(text))).result).toBe('最终答案')
    expect(thinking).toEqual(['内部思考'])
  })
  it('拒绝流式提前断开或输出截断', async () => {
    fetcher.mockImplementation(async (url: string) => url.endsWith('/api/show') ? json(info) : new Response('{"message":{"content":"一半"}}\n'))
    await expect(generateOllama('', '', 'model', undefined, () => {})).rejects.toThrow('提前关闭')
    fetcher.mockImplementation(async (url: string) => url.endsWith('/api/show') ? json(info) : json({ message: { content: '一半' }, done: true, done_reason: 'length' }))
    await expect(generateOllama('', '', 'model')).rejects.toBeInstanceOf(OllamaOutputLimitError)
  })
  it('在发出正文前拒绝云模型名称及远端元数据', async () => {
    await expect(generateOllama('', '正文', 'test:cloud')).rejects.toThrow('云模型')
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockResolvedValue(json({ remote_host: 'https://ollama.com', remote_model: 'remote' }))
    await expect(generateOllama('', '正文', 'aliased-remote')).rejects.toThrow('云模型')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('输入预算超限时不发送生成请求', async () => {
    await expect(generateOllama('', '中文'.repeat(2000), 'model')).rejects.toThrow('上下文预算')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('HTTP 异常不重试，不回退另一端点，不泄漏正文', async () => {
    fetcher.mockImplementation(async (url: string) => url.endsWith('/api/show') ? json(info) : json({ error: 'secret document content' }, 500))
    await expect(generateOllama('', 'secret document content', 'model')).rejects.toThrow('HTTP 500')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('预先取消不发请求', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(generateOllama('', '', 'model', undefined, undefined, controller.signal)).rejects.toThrow('取消')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('在途和排队任务均可取消，随后请求能继续取得名额', async () => {
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    fetcher.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      started(); options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const first = new AbortController(), queued = new AbortController()
    const p1 = generateOllama('', '', 'model', undefined, undefined, first.signal).catch(e => e.message)
    await ready
    const p2 = generateOllama('', '', 'model', undefined, undefined, queued.signal).catch(e => e.message)
    queued.abort(); expect(await p2).toContain('取消')
    expect(fetcher).toHaveBeenCalledTimes(1)
    first.abort(); expect(await p1).toContain('取消')
    fetcher.mockImplementation(async (url: string) => url.endsWith('/api/show') ? json(info) : json({ message: { content: 'ok' }, done: true }))
    expect((await generateOllama('', '', 'model')).result).toBe('ok')
  })
  it('超时中止服务请求', async () => {
    fetcher.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error('aborted')))))
    await expect(generateOllama('', '', 'model', undefined, undefined, undefined, undefined, 20)).rejects.toThrow('超时')
  })
  it('Embedding 支持单条和批量，不静默截断；拒绝数量与维度无效响应', async () => {
    fetcher.mockImplementation(async (url: string, options: RequestInit) => {
      if (url.endsWith('/api/show')) return json(info)
      const body = JSON.parse(options.body as string)
      expect(body.truncate).toBe(false)
      return json({ embeddings: Array.from({ length: Array.isArray(body.input) ? body.input.length : 1 }, () => [0.2, 0.8]) })
    })
    expect(await embedOllama('text', 'model', 'http://localhost:11434/v1')).toEqual([0.2, 0.8])
    expect(await embedOllama(['a', 'b'], 'model', 'http://localhost:11434')).toHaveLength(2)
    fetcher.mockImplementation(async (url: string) => url.endsWith('/api/show') ? json(info) : json({ embeddings: [[1], [1, 2]] }))
    await expect(embedOllama(['a', 'b'], 'model', 'http://localhost')).rejects.toThrow('维度')
  })
})

describe('本地隐私与质量门禁', () => {
  it('本地任务阻止云审核及 Embedding，策略跨 await 保持并与其他任务隔离', async () => {
    await withLocalPolicy(true, async () => {
      await Promise.resolve()
      expect(() => assertModelNetwork('openai_compatible', 'https://cloud')).toThrow('本地模型')
      expect(() => assertModelNetwork('openai_compatible', 'http://localhost')).toThrow('本地模型')
      expect(() => assertModelNetwork('ollama', 'http://127.0.0.1:11434')).not.toThrow()
    })
    expect(() => assertModelNetwork('openai_compatible', 'https://cloud')).not.toThrow()
    expect(() => assertModelNetwork('anthropic')).not.toThrow()
    await withLocalPolicy(true, async () => {
      await withLocalPolicy(false, async () => {
        expect(() => assertModelNetwork('anthropic')).toThrow('本地模型')
      })
    })
  })
  it('设置范围校验保留本地默认并发与合法角色', () => {
    expect(normalizeLocalSettings({ concurrency: 99, contextLength: 1, roles: { chat: -1 } })).toMatchObject({ concurrency: 1, contextLength: 16384, roles: { chat: null } })
  })
  it('旧全局模式字段不再生效，旧模型绑定和运行参数仍保留', () => {
    const legacy = { localOnly: true, roles: { proof: 12, reduce: 13, embedding: 14 }, contextLength: 16384 }
    const next = normalizeLocalSettings(legacy)
    expect(next).not.toHaveProperty('localOnly')
    expect(next).toMatchObject({ roles: legacy.roles, contextLength: 16384 })
    expect(normalizeLocalSettings({ ...legacy, localOnly: false })).toEqual(next)
  })
  it('拒绝改动数字、术语、否定和占位符', () => {
    const source = 'Qwen 系统不得超过 10%，保留[[MATH:x]]。'
    expect(validateRewrite(source, '系统必须超过 20%，保留公式。')).toHaveLength(4)
    expect(validateRewrite('系统使用量子算法。', '系统使用其他算法。', '量子算法')).toContain('专业术语缺失')
    expect(validateRewrite('系统响应时间为10ms。', '系统的响应时间为10ms。')).toEqual([])
  })
  it('语义、事实、术语、逻辑和表达五项均明确通过才采用', () => {
    const result = { semanticPreserved: true, factsPreserved: true, termsPreserved: true, logicPreserved: true, expressionImproved: true }
    expect(passedSemanticReview(JSON.stringify(result))).toBe(true)
    expect(passedSemanticReview(JSON.stringify({ ...result, factsPreserved: false }))).toBe(false)
    expect(passedSemanticReview('无法确定')).toBe(false)
  })
})
