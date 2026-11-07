import { ipcMain } from 'electron'
import { DB } from '../database'
import { getLocalSettings, saveLocalSettings, resolveRole } from '../localSettings'
import { discoverOllama, ollamaOrigin } from '../ollama'
import { getModelResponse } from '../chat'
import { withLocalPolicy } from '../networkPolicy'
import { ModelProvider } from '../../shared/modelProviders'
import { normalizeLocalSettings } from '../../shared/localEdition'
import { registerOllamaDownloadHandlers } from './ollamaDownloadHandlers'

export function registerLocalEditionHandlers() {
  registerOllamaDownloadHandlers()
  const running = new Map<string, { controller: AbortController; owner: number }>()
  ipcMain.handle('local:get-settings', () => getLocalSettings())
  ipcMain.handle('local:save-settings', async (_event, value) => {
    if (running.size) throw new Error('请等待文本任务完成或取消后再更改设置。')
    const next = normalizeLocalSettings(value)
    // 只校验新修改的辅助模型绑定；旧 proof/reduce 角色已停用，不阻碍保存运行参数。
    const previous = getLocalSettings()
    for (const role of ['chat', 'embedding'] as const) {
      const id = next.roles[role]
      if (id == null || id === previous.roles[role]) continue
      const profile = await DB.getAPISettingById(id)
      if (!profile) throw new Error('模型配置已删除，请重新选择。')
    }
    return saveLocalSettings(value)
  })
  ipcMain.handle('ollama:discover', async (_event, url?: string) => {
    try { return { success: true, ...(await discoverOllama(url)) } }
    catch (error) { return { success: false, models: [], message: error instanceof Error ? error.message : '连接失败' } }
  })
  ipcMain.handle('local:embedding-config', async () => {
    const profile = await resolveRole('embedding')
    if (profile.provider === ModelProvider.OLLAMA) {
      return { ...profile, apiKey: 'ollama', apiURL: ollamaOrigin(profile.apiURL) }
    }
    return profile
  })
  ipcMain.handle('local:cancel-text', (event, id: string) => {
    const task = running.get(id)
    if (task?.owner === event.sender.id) task.controller.abort()
  })
  ipcMain.handle('local:generate-text', async (event, { id, text, stream = true }) => {
    if (typeof id !== 'string' || !id || running.has(id)) throw new Error('任务编号无效或重复。')
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new Error('请输入 1 至 100000 字文本。')
    const profile = await resolveRole('chat')
    const controller = new AbortController()
    running.set(id, { controller, owner: event.sender.id })
    const cancel = () => controller.abort()
    event.sender.once('destroyed', cancel)
    try {
      return await withLocalPolicy(profile.provider === ModelProvider.OLLAMA, () =>
        getModelResponse(profile.provider, '请准确回答用户问题，不编造事实。', text,
          profile.apiKey || 'ollama', profile.modelName, profile.apiURL,
          stream ? chunk => { if (!event.sender.isDestroyed()) event.sender.send('local:text-chunk', { id, chunk }) } : undefined,
          controller.signal))
    } finally { running.delete(id); event.sender.removeListener('destroyed', cancel) }
  })
}
