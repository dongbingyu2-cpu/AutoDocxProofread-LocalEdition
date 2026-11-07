/**
 * window 域：窗口控制（配合渲染层自定义标题栏）与应用级杂项通道
 */
import { app, ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { setLocale } from '../proof'

export const registerWindowHandlers = () => {
  // 窗口控制：配合渲染层自定义标题栏按钮（top-toolbar 右上角的最小化/最大化/关闭）
  const getWindow = (event: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender)
  ipcMain.handle('window:minimize', (event) => {
    getWindow(event)?.minimize()
  })
  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = getWindow(event)
    if (!win) return false
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
    return win.isMaximized()
  })
  ipcMain.handle('window:close', (event) => {
    getWindow(event)?.close()
  })
  ipcMain.handle('window:isMaximized', (event) => {
    return getWindow(event)?.isMaximized() ?? false
  })

  // 应用版本号：渲染层状态栏展示用（打包后取 package.json 的 version）
  ipcMain.handle('app:getVersion', () => app.getVersion())

  // 数据存放位置：关于页「数据与隐私」展示，方便用户备份/迁移
  ipcMain.handle('app:getDataPaths', () => {
    const userData = app.getPath('userData')
    return {
      userData,
      database: path.join(userData, 'data', 'app.db'),
      logs: path.join(userData, 'logs'),
      knowledge: path.join(userData, 'vector-db')
    }
  })

  // 单向通信：接收渲染进程的消息
  // 监听消息，通道是message
  ipcMain.on('message', (event, message: string) => {
    console.log('Received message', message)
  })

  // 双向通信：接收渲染进程的消息，并返回结果
  ipcMain.handle('receiveAndReturn', (event, message: string) => {
    console.log('receiveAndReturn', message)

    // 想返回什么都可以
    const ret = {
      rawData: message,
      newData: `neight-peiqi${message}`
    }
    return ret
  })

  ipcMain.on('set-locale', (_event, locale: 'zh-CN' | 'en') => {
    setLocale(locale)
  })
}
