import { app } from 'electron' // 新增导入
import { Database, open } from 'sqlite'
import sqlite3 from 'sqlite3'
import path from 'path' // 新增导入
import fs from 'fs'
import { promises } from 'dns'
import { getEmbedding } from './chat'
import { ModelProvider } from '../shared/modelProviders'
import { encryptApiKey, decryptApiKey } from './apiKeyCrypto'

// 定义数据类型（TypeScript 类型安全）
export interface User {
  id?: number
  name: string
  email: string
  created_at?: string
}

export interface apiSettings {
  id?: number
  apiURL: string
  apiKey: string
  modelName: string
  provider: ModelProvider
  created_at?: string
}

export interface proofHistory {
  id?: number
  filePath: string
  apiURL: string
  modelName: string
  created_at?: string
  result: string
}

/**
 * 工作区文档：以「源文件路径」为唯一键，自动登记用户导入 / 校对 / 导出过的文档。
 *
 * 与 proof_history 的分工：
 * - proof_history 记录「每一次校对动作」（同一文档多次校对会有多条）
 * - workspace_documents 记录「文档这个实体」（同一文档只有一条，聚合次数与最后状态）
 *
 * 状态流转：imported（仅导入）→ proofed（校对过）→ exported（导出过）。
 * 导出后再校对会回到 proofed，但 exportCount 保留，便于判断「改过没导」。
 */
export interface workspaceDoc {
  id?: number
  filePath: string
  fileName: string
  status: 'imported' | 'proofed' | 'exported'
  proofCount: number
  /** 历次校对产生的建议条数累计（不是用户实际采纳数） */
  suggestionCount: number
  exportCount: number
  lastProofAt?: string | null
  lastExportPath?: string | null
  createdAt?: string
  updatedAt?: string
}

// 该类实现了对api数据和历史记录的数据库的管理操作
export class DB {
  private static instance: Database
  // 使用系统标准路径
  private static get DB_PATH(): string {
    // 获取系统标准用户数据目录
    const userDataPath = app.getPath('userData')
    // 创建 data 子目录（避免污染根目录）
    return path.join(userDataPath, 'data', 'app.db')
  }
  static async getInstance(): Promise<Database> {
    if (!DB.instance) {
      // 确保目录存在（自动创建）
      const dir = path.dirname(DB.DB_PATH)
      await fs.promises.mkdir(dir, { recursive: true })

      DB.instance = await open({
        filename: DB.DB_PATH,
        driver: sqlite3.Database
      })

      // 初始化表结构
      // 创建存储API设置的表
      await DB.instance.exec(`
        CREATE TABLE IF NOT EXISTS api_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          apiURL TEXT NOT NULL,
          apiKey TEXT NOT NULL,
          modelName TEXT NOT NULL,
          provider TEXT DEFAULT 'openai_compatible',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)

      // 为现有表添加provider列（如果不存在）
      try {
        await DB.instance.exec(`ALTER TABLE api_settings ADD COLUMN provider TEXT DEFAULT 'openai_compatible'`)
      } catch (error) {
        // 忽略列已存在的错误
      }
      // 创建存储校对历史的表
      await DB.instance.exec(
        `
        CREATE TABLE IF NOT EXISTS proof_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filePath TEXT NOT NULL,
          apiURL TEXT NOT NULL,
          modelName TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          result TEXT NOT NULL
        )
        `
      )
      // 创建存储审核模型设置的表（兼容旧版本，不再使用）
      await DB.instance.exec(`
        CREATE TABLE IF NOT EXISTS review_model_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          apiId INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)

      // 工作区文档：filePath 唯一，导入/校对/导出时 upsert
      await DB.instance.exec(`
        CREATE TABLE IF NOT EXISTS workspace_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filePath TEXT NOT NULL UNIQUE,
          fileName TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'imported',
          proofCount INTEGER NOT NULL DEFAULT 0,
          suggestionCount INTEGER NOT NULL DEFAULT 0,
          exportCount INTEGER NOT NULL DEFAULT 0,
          lastProofAt DATETIME,
          lastExportPath TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)
      await DB.instance.exec(
        `CREATE INDEX IF NOT EXISTS idx_workspace_updated ON workspace_documents(updatedAt DESC)`
      )

      // 首次升级：把已有的校对历史回填进工作区，
      // 否则老用户升级后侧栏文档列表是空的（新表只记录此后的导入/校对/导出）。
      await DB.backfillWorkspaceFromHistory(DB.instance)
    }
    return DB.instance
  }

  // 查询记录的条目数量
  static async getAPISettingsCount(): Promise<number> {
    const db = await DB.getInstance()
    const result = await db.get(`SELECT COUNT(*) as count FROM api_settings`)
    return result.count
  }

  static async getHistoryCount(): Promise<number> {
    const db = await DB.getInstance()
    const result = await db.get(`SELECT COUNT(*) as count FROM proof_history`)
    return result.count
  }
  /**
   * 插入一条 API 设置记录
   * @param setting apiSettings 对象（不含 id）
   * @returns 新记录的 id
   */
  static async insertAPISetting(
    apiURL: string,
    apiKey: string,
    modelName: string,
    provider: ModelProvider = ModelProvider.OPENAI_COMPATIBLE
  ): Promise<number> {
    const db = await DB.getInstance()
    try {
      const result = await db.run(
        `INSERT INTO api_settings (apiURL, apiKey, modelName, provider) VALUES (?, ?, ?, ?)`,
        apiURL,
        encryptApiKey(apiKey),
        modelName,
        provider
      )
      return result.lastID
    } catch (error) {
      console.error('插入 API 设置失败:', error)
      throw error // 或根据需求返回 -1 / null
    }
  }

  static async updateAPISettingById(
    id: number,
    apiURL: string,
    apiKey: string,
    modelName: string,
    provider?: ModelProvider
  ): Promise<boolean> {
    const db = await DB.getInstance()
    try {
      let query = `UPDATE api_settings SET apiURL = ?, apiKey = ?, modelName = ?`
      const params: any[] = [apiURL, encryptApiKey(apiKey), modelName]

      if (provider !== undefined && provider !== null) {
        query += `, provider = ?`
        params.push(provider)
      }

      query += ` WHERE id = ?`
      params.push(id)

      const result = await db.run(query, ...params)
      return result.changes > 0
    } catch (error) {
      console.error('更新 API 设置失败:', error)
      throw error
    }
  }

  static async insertOneHistory(filePath: string, apiURL: string, modelName: string, result: string): Promise<number> {
    const db = await DB.getInstance()
    if (!filePath || !apiURL || !modelName || !result) {
      const errorMsg = '插入历史记录参数不完整: ' + JSON.stringify({ filePath, apiURL, modelName, result: !!result })
      console.error(errorMsg)
      throw new Error(errorMsg)
    }

    // 验证JSON格式
    try {
      JSON.parse(result)
    } catch (parseError) {
      const errorMsg = 'result参数不是有效的JSON: ' + parseError.message
      console.error(errorMsg)
      throw new Error(errorMsg)
    }

    try {
      const res = await db.run(
        `INSERT INTO proof_history (filePath, apiURL, modelName, result) VALUES (?, ?, ?, ?)`,
        filePath,
        apiURL,
        modelName,
        result
      )
      return res.lastID
    } catch (error) {
      console.error('插入校对记录失败:', error)
      throw error
    }
  }

  // 根据id查询api记录（apiKey 解密后返回，兼容旧明文记录）
  static async getAPISettingById(id: number): Promise<apiSettings | null> {
    const db = await DB.getInstance()
    const result = await db.get(`SELECT * FROM api_settings WHERE id = ?`, id)
    return result ? { ...result, apiKey: decryptApiKey(result.apiKey) } : null
  }

  static async getHistoryById(id: number): Promise<proofHistory | null> {
    const db = await DB.getInstance()
    const result = await db.get(`SELECT * FROM proof_history WHERE id = ?`, id)
    return result || null
  }

  // 删除指定的数据集
  static async deleteAPISettingById(id: number): Promise<boolean> {
    const db = await DB.getInstance()
    const result = await db.run(`DELETE FROM api_settings WHERE id = ?`, id)
    return result.changes > 0 // 如果有行被删除，返回 true，否则返回 false
  }

  static async deleteHistoryById(id: number): Promise<boolean> {
    const db = await DB.getInstance()
    const result = await db.run(`DELETE FROM proof_history WHERE id = ?`, id)
    return result.changes > 0 // 如果有行被删除，返回 true，否则返回 false
  }

  static async deleteALLHistory(): Promise<boolean> {
    const db = await DB.getInstance()
    await db.run(`DELETE FROM proof_history`)
    const count = await DB.getHistoryCount()
    if (count === 0) {
      return true
    } else {
      return false
    }
  }

  // ==================== 工作区文档 ====================
  // 说明：全部用 UPSERT（ON CONFLICT(filePath)），调用方无需先查是否存在。

  /**
   * 从 proof_history 回填工作区。
   * 每次启动都会跑，但只补「工作区里还没有的 filePath」——已存在的文档跳过，
   * 避免与 markWorkspaceProofed 的累加重复计数。这样老用户升级后侧栏不会是空的。
   */
  private static async backfillWorkspaceFromHistory(db: Database): Promise<void> {
    try {
      const knownRows = await db.all(`SELECT filePath FROM workspace_documents`)
      const known = new Set((knownRows || []).map(row => String(row.filePath)))

      const rows = await db.all(
        `SELECT filePath, result, created_at FROM proof_history ORDER BY created_at ASC`
      )
      if (!rows?.length) return

      const stats = new Map<string, { proofCount: number; suggestionCount: number; lastProofAt: string | null }>()
      for (const row of rows) {
        const filePath = String(row.filePath || '')
        if (!filePath || known.has(filePath)) continue

        let suggestionCount = 0
        try {
          const parsed = JSON.parse(row.result)
          if (Array.isArray(parsed)) suggestionCount = parsed.length
          else if (parsed && Array.isArray(parsed.corrections)) suggestionCount = parsed.corrections.length
        } catch {
          suggestionCount = 0
        }

        const stat = stats.get(filePath) || { proofCount: 0, suggestionCount: 0, lastProofAt: null }
        stat.proofCount += 1
        stat.suggestionCount += suggestionCount
        stat.lastProofAt = row.created_at || stat.lastProofAt
        stats.set(filePath, stat)
      }

      if (stats.size === 0) return

      for (const [filePath, stat] of stats) {
        await db.run(
          `INSERT INTO workspace_documents
             (filePath, fileName, status, proofCount, suggestionCount, lastProofAt, createdAt, updatedAt)
           VALUES (?, ?, 'proofed', ?, ?, ?, ?, ?)
           ON CONFLICT(filePath) DO NOTHING`,
          filePath,
          path.basename(filePath),
          stat.proofCount,
          stat.suggestionCount,
          stat.lastProofAt,
          stat.lastProofAt,
          stat.lastProofAt
        )
      }
      console.log(`[workspace] 已从校对历史回填 ${stats.size} 个文档`)
    } catch (error) {
      // 回填失败不能阻断应用启动
      console.error('[workspace] 历史回填失败:', error)
    }
  }

  /** 导入 / 再次打开文档：只刷新文件名与时间，不改状态与计数 */
  static async touchWorkspaceDoc(filePath: string, fileName: string): Promise<void> {
    const db = await DB.getInstance()
    await db.run(
      `INSERT INTO workspace_documents (filePath, fileName, status, updatedAt)
       VALUES (?, ?, 'imported', CURRENT_TIMESTAMP)
       ON CONFLICT(filePath) DO UPDATE SET
         fileName = excluded.fileName,
         updatedAt = CURRENT_TIMESTAMP`,
      filePath,
      fileName
    )
  }

  /**
   * 校对完成：次数 +1，状态回到 proofed。
   * 若此前是 exported，说明「导出后又改过」，状态回落以便用户看出还有未导出的改动。
   * @param suggestionCount 本次校对产生的建议条数，累加进文档统计
   */
  static async markWorkspaceProofed(filePath: string, suggestionCount = 0): Promise<void> {
    const db = await DB.getInstance()
    const delta = Math.max(0, Math.floor(suggestionCount) || 0)
    await db.run(
      `INSERT INTO workspace_documents (filePath, fileName, status, proofCount, suggestionCount, lastProofAt, updatedAt)
       VALUES (?, ?, 'proofed', 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(filePath) DO UPDATE SET
         status = 'proofed',
         proofCount = workspace_documents.proofCount + 1,
         suggestionCount = workspace_documents.suggestionCount + ?,
         lastProofAt = CURRENT_TIMESTAMP,
         updatedAt = CURRENT_TIMESTAMP`,
      filePath,
      path.basename(filePath),
      delta,
      delta
    )
  }

  /** 导出成功：状态置 exported，记录最近一次输出路径 */
  static async markWorkspaceExported(filePath: string, exportPath: string): Promise<void> {
    const db = await DB.getInstance()
    await db.run(
      `INSERT INTO workspace_documents (filePath, fileName, status, exportCount, lastExportPath, updatedAt)
       VALUES (?, ?, 'exported', 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(filePath) DO UPDATE SET
         status = 'exported',
         exportCount = workspace_documents.exportCount + 1,
         lastExportPath = excluded.lastExportPath,
         updatedAt = CURRENT_TIMESTAMP`,
      filePath,
      path.basename(filePath),
      exportPath
    )
  }

  /** 工作区列表：按最近操作时间倒序 */
  static async listWorkspaceDocs(keyword = ''): Promise<workspaceDoc[]> {
    const db = await DB.getInstance()
    const trimmed = (keyword || '').trim()
    const where = trimmed ? `WHERE fileName LIKE ? OR filePath LIKE ?` : ''
    const params: any[] = trimmed ? [`%${trimmed}%`, `%${trimmed}%`] : []
    return db.all<workspaceDoc[]>(`SELECT * FROM workspace_documents ${where} ORDER BY updatedAt DESC`, ...params)
  }

  static async getWorkspaceDocById(id: number): Promise<workspaceDoc | null> {
    const db = await DB.getInstance()
    const row = await db.get(`SELECT * FROM workspace_documents WHERE id = ?`, id)
    return row || null
  }

  static async deleteWorkspaceDocById(id: number): Promise<boolean> {
    const db = await DB.getInstance()
    const result = await db.run(`DELETE FROM workspace_documents WHERE id = ?`, id)
    return result.changes > 0
  }

  /** 取某文档最近一次校对记录（用于从工作区恢复上次的校对结果） */
  static async getLatestProofByFilePath(filePath: string): Promise<proofHistory | null> {
    const db = await DB.getInstance()
    const row = await db.get(
      `SELECT * FROM proof_history WHERE filePath = ? ORDER BY created_at DESC LIMIT 1`,
      filePath
    )
    return row || null
  }

  /**
   * 查询所有 API 设置记录
   * @returns apiSettings 数组
   */
  static async getAllAPISettings(): Promise<apiSettings[]> {
    // 返回apiSettings 数组（apiKey 解密后返回，兼容旧明文记录）
    const db = await DB.getInstance()
    const rows = await db.all<apiSettings[]>(
      `SELECT id, apiURL, apiKey, modelName, provider, created_at FROM api_settings ORDER BY created_at DESC`
    )
    return rows.map(row => ({ ...row, apiKey: decryptApiKey(row.apiKey) }))
  }

  /**
   * 分页查询校对历史（result 为完整 JSON，条数多时全量返回很重）。
   * keyword 模糊匹配 filePath / modelName，与旧前端客户端搜索的字段一致。
   */
  static async getHistoryPage(
    page: number,
    pageSize: number,
    keyword = ''
  ): Promise<{ items: proofHistory[]; total: number }> {
    const db = await DB.getInstance()
    const trimmed = (keyword || '').trim()
    const where = trimmed ? `WHERE filePath LIKE ? OR modelName LIKE ?` : ''
    const params: any[] = trimmed ? [`%${trimmed}%`, `%${trimmed}%`] : []
    const totalRow = await db.get(`SELECT COUNT(*) as count FROM proof_history ${where}`, ...params)
    const items = await db.all<proofHistory[]>(
      `SELECT id, filePath, apiURL, modelName, created_at, result
       FROM proof_history ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      Math.max(0, (page - 1) * pageSize)
    )
    return { items, total: totalRow.count }
  }

  static async getAPISettings(): Promise<apiSettings | null> {
    const db = await DB.getInstance()
    const row = await db.get<apiSettings>(`SELECT * FROM api_settings ORDER BY created_at DESC LIMIT 1`)
    return row ? { ...row, apiKey: decryptApiKey(row.apiKey) } : null
  }
}
