/** 下载任务只携带模型名和进度，不接收文档、提示词或 API Key。 */
export interface OllamaDownloadState {
  id: string
  model: string
  origin: string
  phase: 'idle' | 'downloading' | 'success' | 'error' | 'cancelled'
  status: string
  /** Ollama 逐层报告进度；这些字节数表示当前层，不是完整模型总量。 */
  total?: number
  completed?: number
  percent?: number
}

/** 官方模型库中的常用入口；体积仅供下载前参考，不表示运行内存需求。 */
export const COMMON_OLLAMA_MODELS = [
  { name: 'qwen3.5:2b', kind: '文本模型', size: '约 2.7–3.1 GB', description: '轻量多语言模型' },
  { name: 'qwen3.5:4b', kind: '文本模型', size: '约 3.3–4.0 GB', description: '中文文档与通用任务' },
  { name: 'qwen3:1.7b', kind: '文本模型', size: '约 1.4 GB', description: '轻量通用模型' },
  { name: 'qwen3:4b', kind: '文本模型', size: '约 2.5 GB', description: '中文文档与通用任务' },
  { name: 'qwen3:8b', kind: '文本模型', size: '约 5.2 GB', description: '需要更多内存的通用模型' },
  { name: 'qwen2.5:7b', kind: '文本模型', size: '约 4.7 GB', description: '中文与结构化文本' },
  { name: 'deepseek-r1:8b', kind: '文本模型', size: '约 5.2 GB', description: '推理模型，思考可能增加耗时' },
  { name: 'embeddinggemma:300m', kind: '向量模型', size: '约 622 MB', description: '知识库检索用，不能用于文档改写' }
] as const
