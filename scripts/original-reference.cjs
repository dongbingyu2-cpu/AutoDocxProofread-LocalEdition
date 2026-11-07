// 原版只作为界面参考；显式使用独立测试 profile，禁止进入原版用户数据目录。
const { chromium } = require('@playwright/test')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const net = require('node:net')
const root = path.resolve('.validation', `original-reference-${Date.now()}`)
const executable = 'D:\\autodocxproofread\\AutoDocxProofreading\\AutoDocxProofreading.exe'
let child, browser
const report = { executable, isolatedProfile: root }
const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')
async function main() {
  await fs.mkdir(root, { recursive: true })
  report.beforeHash = await hash(executable)
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
  child = spawn(executable, [`--user-data-dir=${root}`, `--remote-debugging-port=${port}`], { windowsHide: true, stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 500 }); break } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  if (!browser) throw new Error('原版调试连接不可用，未修改原版安装文件。')
  const page = browser.contexts()[0].pages()[0]
  await page.waitForFunction(() => Boolean(window.electronAPI))
  await page.waitForFunction(() => document.body.innerText.length > 50)
  report.launch = true
  report.apiConfigCount = (await page.evaluate(() => window.electronAPI.getALLAPISettings())).length
  report.initialURL = page.url()
  report.initialText = (await page.locator('body').innerText()).slice(0, 1500)
  await page.screenshot({ path: path.join(root, 'original-home.png'), animations: 'disabled' })
  await page.evaluate(() => { location.hash = '#/about' })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: path.join(root, 'original-about.png'), animations: 'disabled' })
  report.aboutURL = page.url()
  report.about = (await page.locator('body').innerText()).slice(0, 1800)
  report.afterHash = await hash(executable)
  if (report.beforeHash !== report.afterHash) throw new Error('原版文件校验值发生变化')
  console.log(JSON.stringify({ launch: true, isolatedProfile: root, executableUnchanged: true, apiConfigCount: report.apiConfigCount }, null, 2))
}
main().catch(error => { report.error = String(error); console.error(error); process.exitCode = 1 }).finally(async () => {
  if (browser) await browser.close().catch(() => {})
  if (child && child.exitCode == null) child.kill()
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
})
