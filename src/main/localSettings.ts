import { DB } from './database'
import { DEFAULT_LOCAL_SETTINGS, normalizeLocalSettings, type LocalEditionSettings } from '../shared/localEdition'
import { configureOllama } from './ollama'
import { app } from 'electron'
import { writeLog } from './logger'

let current = structuredClone(DEFAULT_LOCAL_SETTINGS)
export function getLocalSettings(): LocalEditionSettings { return structuredClone(current) }

export async function loadLocalSettings() {
  const db = await DB.getInstance()
  await db.exec('CREATE TABLE IF NOT EXISTS local_edition_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
  const row = await db.get('SELECT value FROM local_edition_settings WHERE id=1')
  // 兼容旧设置；废弃的全局 localOnly 字段不再生效，已保存模型和运行参数继续保留。
  try { current = normalizeLocalSettings(row ? JSON.parse(row.value) : DEFAULT_LOCAL_SETTINGS) }
  catch { current = structuredClone(DEFAULT_LOCAL_SETTINGS) }
  configureOllama(current)
  const database = await db.get('PRAGMA database_list')
  writeLog(`[runtime-config] pid=${process.pid}, version=${app.getVersion()}, database=${database?.file || 'unknown'}, context=${current.contextLength}, output=${current.maxTokens}, promptMode=${current.documentPromptMode}`)
  return getLocalSettings()
}

export async function saveLocalSettings(value: unknown) {
  const next = normalizeLocalSettings(value)
  const db = await DB.getInstance()
  await db.run('INSERT INTO local_edition_settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(next))
  current = next
  configureOllama(current)
  return getLocalSettings()
}

/** 显式角色失效时报错，禁止悄悄改用另一个供应商。 */
export async function resolveRole(role: keyof LocalEditionSettings['roles'], fallback?: any) {
  const id = current.roles[role]
  if (id == null) {
    if (fallback?.modelName) return { ...fallback }
    throw new Error(`请先为 ${role} 选择模型配置。`)
  }
  const profile = await DB.getAPISettingById(id)
  if (!profile) throw new Error(`角色 ${role} 的模型配置已删除，请重新选择。`)
  return { ...profile }
}
