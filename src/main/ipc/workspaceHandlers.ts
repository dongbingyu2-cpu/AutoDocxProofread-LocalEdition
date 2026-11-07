/**
 * workspace 域：工作区文档
 *
 * 工作区以「源文件路径」为唯一键，自动登记用户导入 / 校对 / 导出过的文档。
 * 本模块只负责读写与系统交互（定位文件、打开导出产物），
 * 业务写入时机由 proofHandlers / dialogHandlers / 渲染层触发。
 */
import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { DB } from '../database'

/** proof_history.result 的兼容解析：老数据可能是裸数组，新数据是 { corrections: [] } */
const parseResult = (raw?: string): any[] => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.corrections)) return parsed.corrections
    return []
  } catch {
    return []
  }
}

export const registerWorkspaceHandlers = () => {
  // 列表：附 fileExists，前端可提示「文件已被移动或删除」
  ipcMain.handle('workspace:list', async (_event, keyword = '') => {
    const items = await DB.listWorkspaceDocs(keyword)
    return items.map(doc => ({ ...doc, fileExists: fs.existsSync(doc.filePath) }))
  })

  // 登记一次「导入/打开」（不改状态，只刷新时间）
  ipcMain.handle('workspace:touch', async (_event, filePath: string, fileName: string) => {
    if (!filePath) return false
    await DB.touchWorkspaceDoc(filePath, fileName)
    return true
  })

  ipcMain.handle('workspace:remove', async (_event, id: number) => {
    return DB.deleteWorkspaceDocById(id)
  })

  // 恢复到校对页：返回文档路径 + 最近一次校对结果
  ipcMain.handle('workspace:restore', async (_event, id: number) => {
    const doc = await DB.getWorkspaceDocById(id)
    if (!doc) return { success: false, reason: 'not-found' as const }
    if (!fs.existsSync(doc.filePath)) {
      return { success: false, reason: 'file-missing' as const, doc }
    }
    const latest = await DB.getLatestProofByFilePath(doc.filePath)
    return {
      success: true as const,
      filePath: doc.filePath,
      fileName: doc.fileName,
      modelName: latest?.modelName || '',
      results: parseResult(latest?.result)
    }
  })

  // 在资源管理器中定位源文件
  ipcMain.handle('workspace:reveal', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) return false
    shell.showItemInFolder(filePath)
    return true
  })

  // 用系统默认程序打开导出后的文档
  ipcMain.handle('workspace:openExport', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) return false
    const message = await shell.openPath(filePath)
    return message === ''
  })
}
