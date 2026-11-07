const { _electron: electron } = require('@playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { acceptExport } = require('./acceptExport.cjs')
const { launchPackaged } = require('./launchPackaged.cjs')
const { SOURCE, makeFixture, verifyExport } = require('./validationFixture.cjs')
const root = path.resolve('.validation', `desktop-mock-${Date.now()}`)
const report = { kind: 'Mock Ollama + real Electron/SQLite/vec0/DOCX', checks: [], requests: {} }
const packagedExe = process.env.LOCAL_EDITION_TEST_EXE
if (packagedExe) { report.kind = 'Mock Ollama + INSTALLED production EXE/SQLite/vec0/DOCX'; report.executable = packagedExe }
let app, server
let denyQuality = false
let slowDocument = false, documentStarted
function check(name, value) { assert.ok(value, name); report.checks.push(name); console.log('PASS', name) }

async function main() {
  await fs.mkdir(root, { recursive: true })
  const fixture = path.join(root, 'fixture.docx'), exported = path.join(root, 'exported.docx')
  await makeFixture(fixture)
  server = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part
    const data = body ? JSON.parse(body) : {}
    report.requests[req.url] = (report.requests[req.url] || 0) + 1
    const send = value => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.url === '/api/tags') return send({ models: [{ name: 'mock-chat', size: 100 }, { name: 'mock-embed', size: 10 }, { name: 'remote:cloud', remote_model: 'cloud' }] })
    if (req.url === '/api/show') return send({ capabilities: ['completion', 'embedding'], model_info: { 'test.context_length': 131072 } })
    if (req.url === '/api/embed') return send({ embeddings: (Array.isArray(data.input) ? data.input : [data.input]).map(() => [1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) })
    if (req.url === '/api/chat') {
      const prompt = data.messages.at(-1).content, system = data.messages[0].content
      if (prompt === 'slow' || slowDocument) { res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); res.write('{"message":{"content":"等待"}}\n'); documentStarted?.(); return }
      let content = '本地文本生成成功。'
      if (system.includes('semanticPreserved')) content = JSON.stringify({ semanticPreserved: !denyQuality, factsPreserved: true, termsPreserved: true, logicPreserved: true, expressionImproved: true })
      else if (prompt.includes('[需要改写的段落]')) content = prompt.split('[需要改写的段落]\n')[1].split('\n\n[下一段]')[0].replace('系统通过', '该系统通过')
      else if (prompt.includes('错务')) content = JSON.stringify([{ original: '错务', suggested: '错误', reason: '错别字', type: 'Typo' }])
      if (data.stream) {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
        for (let i = 0; i < content.length; i += 8) res.write(JSON.stringify({ message: { content: content.slice(i, i + 8) } }) + '\n')
        res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 5, eval_count: 4 }) + '\n')
      } else send({ message: { content }, done: true, prompt_eval_count: 5, eval_count: 4 })
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const launch = () => packagedExe ? launchPackaged(packagedExe, root) : electron.launch({ args: [path.resolve('out/main/main.js'), `--user-data-dir=${root}`], env })
  app = await launch()
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.electronAPI?.getLocalSettings))
  if (app.packaged) check('正式包名称及独立测试数据目录', (await page.title()).includes('Local Edition') && Boolean(await fs.stat(path.join(root, 'data/app.db'))))
  else {
    const paths = await app.evaluate(({ app }) => ({ name: app.getName(), userData: app.getPath('userData') }))
    check('独立应用名称及数据目录', paths.name === 'AutoDocxProofread-LocalEdition' && paths.userData === root)
  }
  check('无需全局模式且本地默认并发 1', await page.evaluate(async () => { const s = await window.electronAPI.getLocalSettings(); return !('localOnly' in s) && s.concurrency === 1 }))
  const found = await page.evaluate(url => window.electronAPI.discoverOllama(url), url)
  check('模型发现过滤云模型', found.success && found.models.length === 2)
  const ids = await page.evaluate(async url => {
    const api = window.electronAPI
    await api.APISettings(url, '', 'mock-chat', 'ollama')
    await api.APISettings(url + '/v1', '', 'mock-embed', 'ollama')
    const rows = await api.getALLAPISettings()
    const chat = rows.find(r => r.modelName === 'mock-chat').id, embedding = rows.find(r => r.modelName === 'mock-embed').id
    const s = await api.getLocalSettings(); s.roles = { chat, proof: chat, reduce: chat, embedding }; s.contextLength = 32768
    await api.saveLocalSettings(s)
    await api.selectAPISetting(url, '', 'mock-chat', 1, null, 'ollama')
    return { chat, embedding }
  }, url)
  check('多配置保存及独立模型角色', ids.chat !== ids.embedding)
  await page.evaluate(() => { location.hash = '#/api' })
  await page.getByTestId('local-edition-panel').waitFor()
  await page.locator('.btn-add').click()
  await page.locator('.api-dialog').waitFor()
  check('Ollama 配置界面无需 API Key', await page.locator('.api-dialog input[type=password]').count() === 0)
  await page.screenshot({ path: path.join(root, 'ollama-dialog.png'), animations: 'disabled' })
  await page.locator('.api-dialog .el-dialog__headerbtn').click()
  const streamed = await page.evaluate(async () => {
    let chunks = ''; const off = window.electronAPI.onLocalTextChunk(data => { if (data.id === 'stream') chunks += data.chunk })
    try { const result = await window.electronAPI.generateLocalText({ id: 'stream', text: '测试本地生成' }); return chunks === result.result && chunks.includes('本地文本') } finally { off() }
  })
  check('IPC 流式生成与最终结果一致', streamed)
  check('普通非流式生成', (await page.evaluate(() => window.electronAPI.generateLocalText({ id: 'plain', text: '测试普通生成', stream: false }))).result.includes('本地文本'))
  await page.evaluate(() => { window.slow = window.electronAPI.generateLocalText({ id: 'cancel-text', text: 'slow' }).catch(e => String(e)) })
  await page.waitForTimeout(100)
  await page.evaluate(() => window.electronAPI.cancelLocalText('cancel-text'))
  check('真实 IPC 取消在途文本任务', (await page.evaluate(() => window.slow)).includes('取消'))
  const embedding = await page.evaluate(() => window.electronAPI.getLocalEmbeddingConfig())
  const knowledge = await page.evaluate(async config => {
    const api = window.electronAPI
    await api.createRepository({ repositoryName: '验收知识库', ...config })
    await api.lancedbInsert({ repositoryName: '验收知识库', fileName: '虚构知识.txt', text: '系统可以校对文档。', metadata: {} }, config)
    return api.lancedbQuery({ repositoryName: '验收知识库', queryText: '校对', limit: 2 }, config)
  }, embedding)
  check('原生 Embedding 接入真实 vec0 和 RAG IPC', knowledge.length === 1)
  const runProof = (mode, rag = false, review = false) => page.evaluate(async ({ mode, fixture, rag, embedding, review }) => window.electronAPI.processDocx(mode, fixture, rag ? ['验收知识库'] : undefined, rag ? embedding : undefined, null, 1, null, `proof-${Date.now()}`, review), { mode, fixture, rag, embedding, review })
  for (const mode of ['wordError', 'ComprehensiveError', 'polish']) {
    const result = await runProof(mode, mode === 'ComprehensiveError')
    check(`${mode} Word 业务贯通`, !result.message && result.proofResult?.some(r => r.original === '错务') && !result.failedSegments?.length)
  }
  const reduced = await runProof('reduceAI')
  check('降 AI 默认生成与风险提示贯通', reduced.proofResult?.some(r => r.suggested.startsWith('该系统')))
  slowDocument = true
  const ready = new Promise(resolve => { documentStarted = resolve })
  await page.evaluate(fixture => { window.pendingDocument = window.electronAPI.processDocx('polish', fixture, undefined, undefined, null, 1, null, 'cancel-document', false) }, fixture)
  await ready
  await page.evaluate(() => window.electronAPI.cancelProofread('cancel-document'))
  check('真实 IPC 取消在途 Word 任务', (await page.evaluate(() => window.pendingDocument)).cancelled === true)
  slowDocument = false; documentStarted = null
  denyQuality = true
  const rejected = await runProof('reduceAI', false, true)
  check('语义复核失败保留原文并报告失败分片', !rejected.proofResult?.length && rejected.failedSegments?.length > 0)
  denyQuality = false
  const exportResult = await acceptExport(app, page, fixture, exported)
  check('Word 导出实际成功且匹配修改', exportResult.success && exportResult.appliedCount === 1)
  report.wordFormat = await verifyExport(fixture, exported)
  check('样式、页眉、页脚、脚注、媒体逐字节保持，关系集合与表格公式页设置保留', report.wordFormat.unchangedParts === 5 && report.wordFormat.relationshipSetsPreserved)
  check('无需全局开关即可保存云配置', await page.evaluate(async () => {
    const api = window.electronAPI
    await api.APISettings('https://example.com/v1', 'fixture-key-only', 'cloud-fixture', 'openai_compatible')
    const cloud = (await api.getALLAPISettings()).find(r => r.modelName === 'cloud-fixture')
    return Boolean(cloud?.id)
  }))
  // 上一条通过 IPC 添加了云配置，重新挂载界面加载新列表，再验证用户选择后的持久化。
  await page.reload()
  await page.getByTestId('local-edition-panel').waitFor()
  await page.locator('.api-select').first().click()
  await page.getByRole('option').filter({ hasText: 'cloud-fixture' }).click()
  check('选择云配置后 localStorage 不持久化 API Key', await page.evaluate(() => !localStorage.getItem('apiSettings').includes('fixture-key-only')))
  await page.screenshot({ path: path.join(root, 'settings.png') })
  await app.close(); app = null
  app = await launch()
  const restarted = await app.firstWindow()
  const persisted = await restarted.evaluate(() => window.electronAPI.getLocalSettings())
  check('重启后角色及设置持久化', persisted.roles.chat === ids.chat && persisted.contextLength === 32768)
  const db = await require('sqlite').open({ filename: path.join(root, 'data/app.db'), driver: require('sqlite3').Database, mode: require('sqlite3').OPEN_READONLY })
  const storedCloud = await db.get('SELECT apiKey FROM api_settings WHERE modelName=?', 'cloud-fixture')
  check('真实 Windows safeStorage 密文落库', storedCloud.apiKey.startsWith('enc:v1:') && !storedCloud.apiKey.includes('fixture-key-only'))
  await db.close()
  const logs = await fs.readFile(path.join(root, 'logs/main.log'), 'utf8').catch(() => '')
  check('运行日志不包含夹具正文', !logs.includes(SOURCE) && !logs.includes('fixture-key-only'))
  check('未请求下载模型或云接口', Object.keys(report.requests).every(route => ['/api/tags', '/api/show', '/api/chat', '/api/embed'].includes(route)))
}
main().catch(error => { report.error = String(error.stack || error); console.error(error); process.exitCode = 1 }).finally(async () => {
  if (app) await app.close().catch(() => {})
  if (server) { server.closeAllConnections(); server.close() }
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log('REPORT', path.join(root, 'report.json'))
})
