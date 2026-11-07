import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

// 必须先于 database/logger/lancedb 的模块初始化执行，避免捕获原版数据路径。
app.setName('AutoDocxProofread-LocalEdition')
app.setAppUserModelId('com.localedition.autodocxproofread')
const dataPath = app.commandLine.getSwitchValue('user-data-dir') ||
  path.join(app.getPath('appData'), 'AutoDocxProofread-LocalEdition')
fs.mkdirSync(dataPath, { recursive: true })
app.setPath('userData', dataPath)
app.setPath('sessionData', dataPath)
