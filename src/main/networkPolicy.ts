import { AsyncLocalStorage } from 'node:async_hooks'

// 按任务所选 Provider 决定隐私边界：本地任务禁止云审核/Embedding，独立云任务可直接执行。
const taskPolicy = new AsyncLocalStorage<boolean>()
export function withLocalPolicy<T>(value: boolean, fn: () => T): T {
  // 嵌套调用不可降低外层本地任务的隐私保护。
  return taskPolicy.run(isLocalOnly() || value, fn)
}
export function isLocalOnly() { return taskPolicy.getStore() === true }

export function isLoopbackURL(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password
  } catch { return false }
}

export function assertModelNetwork(provider: string, url = ''): void {
  if (provider === 'ollama' && !isLoopbackURL(url || 'http://127.0.0.1:11434')) {
    throw new Error('Ollama 本地配置只允许回环地址（127.0.0.1 / localhost / ::1）。')
  }
  // 本地任务只接纳经过云模型检查的 Ollama 路径；任意兼容代理都不能代替该检查。
  if (isLocalOnly() && provider !== 'ollama') {
    throw new Error('当前任务使用本地模型，不能调用云端审核或 Embedding。请为该任务选择本地辅助模型。')
  }
}
