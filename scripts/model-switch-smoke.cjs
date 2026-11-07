// 文档页模型切换验收：本机 Mock 分别模拟 Ollama 与云端兼容接口，不读取真实密钥或发送用户文档。
const { expect } = require('@playwright/test')
const { launchPackaged } = require('./launchPackaged.cjs')
const { acceptNativeDialog, acceptExport } = require('./acceptExport.cjs')
const { makeFixture, verifyExport } = require('./validationFixture.cjs')
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict')
const root = path.resolve('.validation', `model-switch-${Date.now()}`)
const exe = process.env.LOCAL_EDITION_TEST_EXE || path.resolve('release/win-unpacked/AutoDocxProofread-LocalEdition.exe')
const report = { kind: 'Production EXE + real Vue/IPC/SQLite/DOCX; local Mock Ollama and cloud-compatible API', checks: [], requests: [] }
let app, server, failLocal = false
function check(name, condition) { assert.ok(condition, name); report.checks.push(name); console.log('PASS', name) }
async function main() {
  await fs.mkdir(root, { recursive: true })
  const fixture = path.join(root, 'switch.docx')
  await makeFixture(fixture)
  server = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    const data = raw ? JSON.parse(raw) : {}
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.url === '/api/tags') return send({ models: [{ name: 'local-a' }, { name: 'old-role' }] })
    if (req.url === '/api/show') return send({ capabilities: ['completion'], model_info: { 'test.context_length': 131072 } })
    if (!['/api/chat', '/v1/chat/completions'].includes(req.url)) return send({}, 404)
    const lane = req.url === '/api/chat' ? 'local' : 'cloud'
    report.requests.push({ lane, model: data.model, stream: Boolean(data.stream) })
    if (lane === 'local' && failLocal) return send({ error: 'fixture unavailable' }, 400)
    const prompt = data.messages.at(-1).content, system = data.messages[0].content
    let content = JSON.stringify([{ original: '错务', suggested: '错误', reason: '错别字', type: 'Typo' }])
    if (system.includes('semanticPreserved')) content = JSON.stringify({ semanticPreserved: true, factsPreserved: true, termsPreserved: true, logicPreserved: true, expressionImproved: true })
    else if (prompt.includes('[需要改写的段落]')) content = prompt.split('[需要改写的段落]\n')[1].split('\n\n[下一段]')[0].replace('系统通过', '该系统通过')
    // 保持请求短暂在途，检查运行时选择器锁定；这里只延迟 Mock，不影响生产行为。
    await new Promise(resolve => setTimeout(resolve, 500))
    if (res.destroyed) return
    if (!data.stream) return send(lane === 'local' ? { message: { content }, done: true, prompt_eval_count: 5, eval_count: 4 } : { choices: [{ message: { content } }], usage: { total_tokens: 9 } })
    if (lane === 'local') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.end(JSON.stringify({ message: { content }, done: true, prompt_eval_count: 5, eval_count: 4 }) + '\n')
    } else {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }], usage: { total_tokens: 9 } }) + '\n\n')
      res.end('data: [DONE]\n\n')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const profileDir = path.join(root, 'profile')
  app = await launchPackaged(exe, profileDir)
  let page = await app.firstWindow()
  const ids = await page.evaluate(async origin => {
    const api = window.electronAPI
    for (const name of ['old-role', 'local-a']) await api.APISettings(origin, '', name, 'ollama')
    for (const name of ['cloud-a', 'cloud-b']) await api.APISettings(origin + '/v1', 'fixture-key-only', name, 'openai_compatible')
    const rows = await api.getALLAPISettings(), ids = Object.fromEntries(rows.map(p => [p.modelName, p.id]))
    const s = await api.getLocalSettings(); s.roles.proof = ids['old-role']; s.roles.reduce = ids['old-role']; s.contextLength = 16384; s.maxTokens = 4096
    await api.saveLocalSettings(s)
    return ids
  }, origin)
  await app.close(); app = null
  // 模拟上一版本保留的 localOnly=true 数据库记录，必须无需用户迁移即可直接选择云模型。
  const db = await require('sqlite').open({ filename: path.join(profileDir, 'data/app.db'), driver: require('sqlite3').Database })
  const old = JSON.parse((await db.get('SELECT value FROM local_edition_settings WHERE id=1')).value)
  old.localOnly = true
  old.roles.proof = 999999; old.roles.reduce = 999998
  await db.run('UPDATE local_edition_settings SET value=? WHERE id=1', JSON.stringify(old)); await db.close()
  app = await launchPackaged(exe, profileDir); page = await app.firstWindow()
  await page.getByTestId('document-model-select').waitFor()
  check('旧全局开关忽略且旧角色配置保留', await page.evaluate(async () => { const s = await window.electronAPI.getLocalSettings(); return !('localOnly' in s) && s.roles.proof != null }))
  const choose = async name => {
    await page.getByTestId('document-model-select').click()
    await page.getByRole('option').filter({ hasText: `${name} (#${ids[name]})` }).click()
    await expect(page.getByTestId('document-model-destination')).toContainText(name.startsWith('cloud') ? '云端处理' : '本地处理')
  }
  await choose('local-a')
  check('本地严格复核默认关闭', !await page.getByTestId('local-extra-review').locator('input').isChecked())
  await choose('cloud-b')
  await expect(page.getByTestId('cloud-extra-review').locator('input')).not.toBeChecked()
  await page.getByTestId('cloud-extra-review').check()
  await choose('local-a')
  check('云端复核不会隐式开启本地严格复核', !await page.getByTestId('local-extra-review').locator('input').isChecked())
  await choose('cloud-b'); await page.getByTestId('cloud-extra-review').uncheck(); await choose('local-a')
  const open = acceptNativeDialog(app, fixture, '选择 DOCX 文件')
  await Promise.all([page.getByRole('button', { name: '选择文件', exact: true }).click(), open])
  await page.locator('.file-name-tag').filter({ hasText: 'switch.docx' }).waitFor()
  const runUi = async (name, mode) => {
    await choose(name)
    await page.locator('.mode-select').click()
    await page.getByRole('option', { name: mode, exact: true }).click()
    const before = report.requests.length
    await page.getByRole('button', { name: '开始校正', exact: true }).click()
    await expect.poll(() => report.requests.length).toBeGreaterThan(before)
    await expect(page.getByTestId('document-model-select').locator('input')).toBeDisabled()
    await expect(page.getByRole('button', { name: '导出结果', exact: true })).toBeEnabled({ timeout: 30000 })
    await expect(page.getByTestId('document-model-select').locator('input')).toBeEnabled()
    const actual = report.requests.slice(before)
    check(`${name} / ${mode} 按文档页所选模型执行且忽略旧角色`, actual.length > 0 && actual.every(r => r.model === name && r.lane === (name.startsWith('cloud') ? 'cloud' : 'local')))
  }
  await runUi('local-a', '逐段校正')
  await runUi('cloud-a', '逐段校正')
  await page.screenshot({ path: path.join(root, 'document-cloud.png') })
  await runUi('cloud-b', '降低AI率')
  await runUi('local-a', '降低AI率')
  await page.screenshot({ path: path.join(root, 'document-local.png') })
  const invoke = (extras = {}) => page.evaluate(({ fixture, extras }) => window.electronAPI.processDocx('ComprehensiveError', fixture, extras.repositories, extras.embedding, null, 1, extras.reviewId ?? null, `policy-${Date.now()}`, Boolean(extras.reviewId)), { fixture, extras })
  let count = report.requests.length
  const blockedReview = await invoke({ reviewId: ids['cloud-a'] })
  check('本地任务禁止云审核且不发送请求', blockedReview.message?.includes('本地模型') && report.requests.length === count)
  const blockedRag = await invoke({ repositories: ['fixture'], embedding: { apiURL: origin + '/v1', apiKey: 'fixture-key-only', modelName: 'cloud-a', provider: 'openai_compatible' } })
  check('本地任务禁止云 Embedding 且不发送请求', blockedRag.message?.includes('本地模型') && report.requests.length === count)
  const cloudBefore = report.requests.filter(r => r.lane === 'cloud').length
  failLocal = true
  const failed = await invoke()
  failLocal = false
  check('本地模型失败不回退云端', (failed.failedSegments?.length > 0 || Boolean(failed.message)) && report.requests.filter(r => r.lane === 'cloud').length === cloudBefore)
  const target = path.join(root, 'exported.docx')
  const exported = await acceptExport(app, page, fixture, target)
  check('模型切换后仍可导出 Word', exported.success && (await verifyExport(fixture, target)).relationshipSetsPreserved)
  await page.locator('.sidebar-nav .sidebar-btn').nth(3).click()
  await page.getByTestId('local-edition-panel').waitFor()
  check('设置页移除模式开关、文档角色和文本生成面板', await page.getByText('允许云端配置', { exact: true }).count() === 0 && await page.getByTestId('role-proof').count() === 0 && await page.getByTestId('local-text-input').count() === 0)
  await page.locator('.local-panel .el-collapse-item__header').click()
  await expect(page.getByTestId('local-prompt-mode')).toContainText('原版降 AI 提示')
  await page.getByTestId('local-prompt-mode').click()
  await page.getByRole('option', { name: '简洁编辑（可选，检测效果未验证）', exact: true }).click()
  await page.getByTestId('save-local-settings').click()
  await expect.poll(async () => (await page.evaluate(() => window.electronAPI.getLocalSettings())).documentPromptMode).toBe('compact')
  check('明确选择简洁编辑仍可保存，不被原版默认覆盖', (await page.evaluate(() => window.electronAPI.getLocalSettings())).documentPromptMode === 'compact')
  await page.getByTestId('local-prompt-mode').click()
  await page.getByRole('option', { name: '原版降 AI 提示（默认）', exact: true }).click()
  await page.getByTestId('save-local-settings').click()
  await expect.poll(async () => (await page.evaluate(() => window.electronAPI.getLocalSettings())).documentPromptMode).toBe('original')
  check('本地改写可在设置页明确切回原版提示', (await page.evaluate(() => window.electronAPI.getLocalSettings())).documentPromptMode === 'original')
  await page.getByLabel('Ollama 服务地址', { exact: true }).fill(origin)
  await page.getByTestId('detect-local-models').click()
  await expect(page.getByTestId('local-model-status')).toContainText('发现 2 个')
  check('设置页本地模型检测可用', true)
  check('云接口连接测试无需全局开关', await page.evaluate(origin => window.electronAPI.testAPIWithProvider('openai_compatible', origin + '/v1', 'fixture-key-only', 'cloud-a'), origin))
  check('Ollama 连接测试无需 API Key', await page.evaluate(origin => window.electronAPI.testAPIWithProvider('ollama', origin, '', 'local-a'), origin))
  await page.locator('.api-select').first().click()
  await page.getByRole('option').filter({ hasText: 'cloud-a' }).click()
  check('设置页切换管理对象不改变文档执行模型', (await page.evaluate(() => window.electronAPI.getAPISettings())).modelName === 'local-a')
  await page.screenshot({ path: path.join(root, 'settings.png') })
  await page.locator('.sidebar-nav .sidebar-btn').first().click()
  await page.getByTestId('local-extra-review').check()
  await choose('cloud-b')
  await app.close(); app = null
  app = await launchPackaged(exe, profileDir); page = await app.firstWindow()
  await expect(page.getByTestId('document-model-select')).toContainText('cloud-b')
  check('重启保留文档页选中配置和全部已保存模型', (await page.evaluate(() => window.electronAPI.getALLAPISettings())).length === 4)
  check('原版提示选择在重启后保留', (await page.evaluate(() => window.electronAPI.getLocalSettings())).documentPromptMode === 'original')
  await expect(page.getByTestId('cloud-extra-review').locator('input')).not.toBeChecked()
  await choose('local-a')
  check('本地严格复核与云端额外复核独立持久化', await page.getByTestId('local-extra-review').locator('input').isChecked())
  const stored = await fs.readFile(path.join(profileDir, 'logs/main.log'), 'utf8').catch(() => '')
  check('日志未包含 Mock 密钥', !stored.includes('fixture-key-only'))
}
main().catch(error => { report.error = String(error.stack || error); console.error(error); process.exitCode = 1 }).finally(async () => {
  if (app) await app.close().catch(() => {})
  if (server) { server.closeAllConnections(); server.close() }
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log('REPORT', path.join(root, 'report.json'))
})
