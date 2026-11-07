// 新版源码构建的真实 Electron 窗口 + 回环 Mock；不下载模型、不读写用户配置。
const { _electron: electron, expect } = require('@playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { launchPackaged } = require('./launchPackaged.cjs')
const root = path.resolve('.validation', 'model-download-' + Date.now())
const report = { kind: 'New source build + Electron UI + isolated profile + loopback Mock', checks: [], pulls: [] }
let app, server, finishSuccess, installed = [], cancellationObserved = false
const check = (name, value) => { assert.ok(value, name); report.checks.push(name) }
;(async () => {
  await fs.mkdir(root, { recursive: true })
  server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    if (req.url === '/api/tags') {
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ models: installed.map(name => ({ name })) }))
    }
    if (req.url !== '/api/pull') { res.statusCode = 404; return res.end() }
    const body = JSON.parse(raw); report.pulls.push(body)
    res.setHeader('Content-Type', 'application/x-ndjson')
    if (body.model === 'missing-test:4b') return res.end('{"error":"pull model manifest: file does not exist"}\n')
    res.write('{"status":"pulling manifest"}\n')
    res.write('{"status":"pulling mock-layer","total":1000000000,"completed":250000000}\n')
    if (body.model === 'cancel-test:4b') {
      res.once('close', () => { cancellationObserved = true })
      return
    }
    finishSuccess = () => {
      installed = [...new Set([...installed, body.model])]
      res.end('{"status":"verifying sha256 digest"}\n{"status":"success"}\n')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  app = process.env.LOCAL_EDITION_TEST_EXE
    ? await launchPackaged(process.env.LOCAL_EDITION_TEST_EXE, path.join(root, 'profile'))
    : await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('.'), '--user-data-dir=' + path.join(root, 'profile')], env })
  if (process.env.LOCAL_EDITION_TEST_EXE) report.kind = 'Packaged desktop + isolated profile + loopback Mock'
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => Boolean(window.electronAPI?.downloadOllamaModel))
  // preload 就绪早于 Vue 路由，先等首屏挂载，避免初始重定向覆盖测试导航。
  await page.getByTestId('document-model-panel').waitFor()
  await page.evaluate(() => { location.hash = '#/api' })
  await page.getByTestId('local-edition-panel').waitFor()
  await page.locator('.detect-row input').fill(origin)
  await page.getByTestId('detect-local-models').click()
  await expect(page.getByTestId('local-model-status')).toContainText('发现 0')
  check('进入设置和检测不会自动下载', report.pulls.length === 0)

  await page.getByTestId('open-model-download').click()
  const select = page.getByTestId('download-model-select')
  await select.click()
  await page.getByRole('option').filter({ hasText: 'qwen3.5:2b' }).click()
  await expect(page.getByTestId('download-model-description')).toContainText('2.7')
  await page.getByTestId('start-model-download').click()
  await expect(page.getByTestId('download-state')).toContainText('25%')
  check('常见模型下载按钮接通 IPC 并显示字节及分层进度', report.pulls[0].model === 'qwen3.5:2b')
  await page.getByTestId('model-download-dialog').getByRole('button', { name: '后台下载', exact: true }).click()
  await page.evaluate(() => { location.hash = '#/proof' })
  await page.getByTestId('local-edition-panel').waitFor({ state: 'detached' })
  await page.evaluate(() => { location.hash = '#/api' })
  await expect(page.getByTestId('download-state')).toContainText('25%')
  check('切换页面后恢复主进程下载进度', report.pulls.length === 1)
  finishSuccess()
  await expect(page.getByTestId('download-state')).toContainText('已完成')
  await expect(page.locator('.model-list')).toContainText('qwen3.5:2b')
  check('完成后自动按下载服务地址刷新本地模型列表', true)
  const settings = await page.evaluate(() => window.electronAPI.getALLAPISettings())
  check('下载不会自动保存或切换执行模型', settings.length === 0)

  const setManualModel = async name => {
    await page.getByTestId('open-model-download').click()
    const input = page.getByTestId('download-model-select').locator('input')
    await input.fill(name)
    await input.press('Enter')
    await page.getByTestId('start-model-download').click()
  }
  await setManualModel('cancel-test:4b')
  await expect(page.getByTestId('download-state')).toContainText('下载中')
  await page.getByTestId('model-download-dialog').getByRole('button', { name: '取消下载', exact: true }).click()
  await expect(page.getByTestId('download-state')).toContainText('已取消')
  await expect.poll(() => cancellationObserved).toBe(true)
  check('取消中止实际 HTTP 流，不产生完成状态', true)
  await page.getByTestId('model-download-dialog').getByRole('button', { name: '关闭', exact: true }).click()

  await setManualModel('missing-test:4b')
  await expect(page.getByTestId('download-state')).toContainText('模型不存在')
  check('手动输入的不存在模型显示服务错误且可重试', true)
  await page.getByTestId('model-download-dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByTestId('open-model-download').click()
  const input = page.getByTestId('download-model-select').locator('input')
  await input.fill('qwen3:4b'); await input.press('Enter')
  await page.getByTestId('start-model-download').click()
  await expect(page.getByTestId('download-state')).toContainText('下载中')
  await expect.poll(() => report.pulls.length).toBe(4)
  finishSuccess()
  await expect(page.getByTestId('download-state')).toContainText('已完成')
  check('失败和取消后均可启动新下载', true)
  await page.getByTestId('model-download-dialog').getByRole('button', { name: '关闭', exact: true }).click()
  check('下载请求只含模型名称和流式标志', report.pulls.every(p => Object.keys(p).sort().join(',') === 'model,stream' && p.stream === true))
  check('界面没有未处理异常', errors.length === 0)
  await page.screenshot({ path: path.join(root, 'download-complete.png'), fullPage: true, animations: 'disabled' })
  await page.getByTestId('open-model-download').click()
  await page.getByTestId('model-download-dialog').waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(root, 'download-dialog.png'), fullPage: true, animations: 'disabled' })
  report.passed = true
  report.directory = root
})().catch(async error => {
  report.passed = false; report.error = String(error.stack || error)
  if (app) {
    const page = await app.firstWindow()
    await page.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {})
    report.pageText = (await page.locator('body').innerText().catch(() => '')).slice(0, 3000)
  }
  console.error(report.error); process.exitCode = 1
})
  .finally(async () => {
    if (app) await app.close()
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  })
