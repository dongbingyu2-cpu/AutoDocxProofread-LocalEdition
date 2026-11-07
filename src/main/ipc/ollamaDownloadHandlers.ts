import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { ollamaOrigin } from '../ollama'
import { normalizeDownloadModel, pullOllamaModel } from '../ollamaDownload'
import type { OllamaDownloadState } from '../../shared/ollamaDownload'

export function registerOllamaDownloadHandlers() {
  // 下载状态由主进程持有，切换页面后重新订阅仍能看到同一任务。
  let state: OllamaDownloadState = { id: '', model: '', origin: '', phase: 'idle', status: '' }
  let owner = -1, controller: AbortController | undefined
  ipcMain.handle('ollama:download-state', event => owner === event.sender.id ? { ...state } : null)
  ipcMain.handle('ollama:cancel-download', (event, id: string) => {
    if (owner !== event.sender.id || state.id !== id || state.phase !== 'downloading') return false
    controller?.abort()
    return true
  })
  ipcMain.handle('ollama:download', (event, value: { model: string; url?: string }) => {
    if (state.phase === 'downloading') throw new Error('已有模型正在下载，请等待完成或先取消。')
    const model = normalizeDownloadModel(value?.model), origin = ollamaOrigin(value?.url || undefined)
    const id = randomUUID(), sender = event.sender
    const taskController = new AbortController()
    controller = taskController; owner = sender.id
    state = { id, model, origin, phase: 'downloading', status: '正在连接 Ollama…' }
    const publish = () => { if (!sender.isDestroyed()) sender.send('ollama:download-progress', { ...state }) }
    const cancelOnClose = () => taskController.abort()
    sender.once('destroyed', cancelOnClose)
    publish()
    let lastSentAt = 0
    let progressTimer: ReturnType<typeof setTimeout> | undefined
    const sendProgress = () => { clearTimeout(progressTimer); progressTimer = undefined; publish(); lastSentAt = Date.now() }
    void pullOllamaModel(model, origin, progress => {
      const changedStage = state.status !== progress.status
      state = { id, model, origin, phase: 'downloading', ...progress }
      // 合并高频字节更新，但保留尾部刷新；暂停传输时也能看到最后收到的进度。
      if (changedStage || Date.now() - lastSentAt >= 150 || progress.percent === 100) sendProgress()
      else if (!progressTimer) progressTimer = setTimeout(sendProgress, Math.max(1, 150 - (Date.now() - lastSentAt)))
    }, taskController.signal).then(() => {
      state = { id, model, origin, phase: 'success', status: '模型下载完成，可刷新列表并保存模型配置。', percent: 100 }
    }).catch(error => {
      state = { id, model, origin, phase: taskController.signal.aborted ? 'cancelled' : 'error',
        status: taskController.signal.aborted ? '下载已取消；再次下载时由 Ollama 复用已有缓存。' : error instanceof Error ? error.message : '模型下载失败。' }
    }).finally(() => {
      clearTimeout(progressTimer)
      sender.removeListener('destroyed', cancelOnClose)
      controller = undefined
      publish()
    })
    return { ...state }
  })
}
