import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
const location = vi.hoisted(() => process.cwd() + '/.validation/legacy-schema')
vi.mock('electron', () => ({ app: { getPath: () => location }, safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text),
  decryptString: (bytes: Buffer) => bytes.toString()
} }))
import { DB } from '../src/main/database'
import { ModelProvider } from '../src/shared/modelProviders'
beforeAll(async () => {
  await fs.mkdir(location + '/data', { recursive: true })
  const raw = await open({ filename: location + '/data/app.db', driver: sqlite3.Database })
  await raw.exec("CREATE TABLE api_settings(id INTEGER PRIMARY KEY AUTOINCREMENT,apiURL TEXT NOT NULL,apiKey TEXT NOT NULL,modelName TEXT NOT NULL,created_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
  await raw.run('INSERT INTO api_settings(apiURL,apiKey,modelName) VALUES(?,?,?)', 'https://example.invalid/v1', 'legacy-fixture', 'legacy-model')
  await raw.close()
})
afterAll(async () => { await (await DB.getInstance()).close(); await fs.rm(location, { recursive: true, force: true }) })
describe('原版 SQLite 业务表兼容（只使用合成旧数据库）', () => {
  it('增加 provider 列并保留旧模型及旧明文兼容读取', async () => {
    const rows = await DB.getAllAPISettings()
    expect(rows[0]).toMatchObject({ apiKey: 'legacy-fixture', modelName: 'legacy-model', provider: ModelProvider.OPENAI_COMPATIBLE })
  })
  it('新增本地配置不覆盖旧行，存取接口保持兼容', async () => {
    const id = await DB.insertAPISetting('http://127.0.0.1:11434', 'ollama', 'local-model', ModelProvider.OLLAMA)
    expect(await DB.getAPISettingsCount()).toBe(2)
    expect((await DB.getAPISettingById(id))?.provider).toBe(ModelProvider.OLLAMA)
    const raw = await (await DB.getInstance()).get('SELECT apiKey FROM api_settings WHERE id=?', id)
    expect(raw.apiKey.startsWith('enc:v1:')).toBe(true)
  })
  it('历史记录写入读取不受新设置表与本地 Provider 影响', async () => {
    const id = await DB.insertOneHistory('fixture.docx', 'http://127.0.0.1:11434', 'local-model', '[]')
    expect((await DB.getHistoryById(id))?.result).toBe('[]')
    expect((await DB.getAllAPISettings()).find(row => row.modelName === 'legacy-model')).toBeTruthy()
  })
})
