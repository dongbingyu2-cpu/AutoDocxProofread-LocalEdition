const { spawn } = require('node:child_process')
const path = require('node:path')
/** 使用正式保存 UI；开发态允许用 Electron 官方调试接口指定测试输出路径。 */
function acceptNativeDialog(app, target, title = '导出修正后的 DOCX 文件') {
    const helper = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/windows-save-dialog.ps1'), '-TargetProcessId', String(app.pid), '-FilePath', target, '-DialogKind', title === '选择 DOCX 文件' ? 'open' : 'save'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    return new Promise((resolve, reject) => {
      let error = ''
      helper.stderr.on('data', part => { error += part })
      helper.stdout.on('data', part => { error += part })
      helper.once('error', reject)
      helper.once('exit', code => code === 0 ? resolve() : reject(new Error(error || `Native save helper exited ${code}`)))
    })
}
async function acceptExport(app, page, source, target) {
  let nativeSave = Promise.resolve()
  if (app.packaged) nativeSave = acceptNativeDialog(app, target)
  else await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, target)
  const [result] = await Promise.all([
    page.evaluate(source => window.electronAPI.exportCorrectedDocx({ originalFilePath: source, appliedCorrections: [{ original: '错务', suggested: '错误' }] }), source),
    nativeSave
  ])
  return result
}
module.exports = { acceptExport, acceptNativeDialog }
