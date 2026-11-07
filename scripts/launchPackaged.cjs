// 通过 Chromium CDP 验收正式包；保留正式版禁用 Node inspector 的安全 Fuse。
const { chromium } = require('@playwright/test')
const { spawn } = require('node:child_process')
const net = require('node:net')
async function launchPackaged(executable, userData, requireLocalEdition = true) {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
  const args = [`--remote-debugging-port=${port}`, ...(userData ? [`--user-data-dir=${userData}`] : [])]
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, args, { env, windowsHide: true, stdio: 'ignore' })
  let browser
  try {
    for (let i = 0; i < 100; i++) {
      if (child.exitCode != null) throw new Error(`应用启动退出：${child.exitCode}`)
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 500 }); break }
      catch { await new Promise(resolve => setTimeout(resolve, 100)) }
    }
    if (!browser) throw new Error('无法连接正式应用的本机验收端口。')
    const context = browser.contexts()[0]
    // 首次安装会先初始化数据库；CDP 可能早于 BrowserWindow 建立连接。
    const page = context.pages()[0] || await context.waitForEvent('page', { timeout: 30000 })
    page.setDefaultTimeout(30000)
    await page.waitForFunction(requireLocalEdition => Boolean(window.electronAPI && (!requireLocalEdition || window.electronAPI.getLocalSettings)), requireLocalEdition)
    return {
      packaged: true, pid: child.pid,
      firstWindow: async () => page,
      close: async () => {
        await Promise.race([page.evaluate(() => window.electronAPI.closeWindow()).catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))])
        await browser.close().catch(() => {})
        if (child.exitCode == null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))])
        if (child.exitCode == null) child.kill()
      }
    }
  } catch (error) { if (browser) await browser.close().catch(() => {}); child.kill(); throw error }
}
module.exports = { launchPackaged }
