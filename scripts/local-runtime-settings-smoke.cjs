// 模拟另一启动副本保存参数：只用合成 DOCX、隔离数据库和本机 Mock，不触及用户数据。
const { launchPackaged } = require('./launchPackaged.cjs')
const { makeFixture } = require('./validationFixture.cjs')
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http')
const assert = require('node:assert/strict'), { execFileSync } = require('node:child_process'), JSZip = require('jszip')
const root = path.resolve('.validation', `runtime-settings-${Date.now()}`)
const report = { kind: 'Production EXE + isolated DB + 23 synthetic paragraphs + loopback Mock', chatRequests: 0 }
let app, server
;(async () => {
  await fs.mkdir(root, { recursive: true })
  const fixture = path.join(root, 'runtime.docx'); await makeFixture(fixture)
  const zip = await JSZip.loadAsync(await fs.readFile(fixture))
  const paragraphs = Array.from({ length: 23 }, (_, i) => `<w:p><w:r><w:t>系统通过本地模型处理文档，并在预览窗口展示建议。用户核对事实和术语后确认修改，原始文件保持独立保存。这是第${i + 1}段说明。</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`)
  await fs.writeFile(fixture, await zip.generateAsync({ type: 'nodebuffer' }))
  server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const data = raw ? JSON.parse(raw) : {}
    const send = value => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.url === '/api/show') return send({ capabilities: ['completion'], model_info: { 'test.context_length': 40960 } })
    if (req.url === '/api/tags') return send({ models: [{ name: 'runtime-local' }] })
    if (req.url !== '/api/chat') { res.writeHead(404); return res.end() }
    report.chatRequests++
    if (report.scopeProbe && report.chatRequests === 24) {
      // 正在生成时保存下一任务的参数，当前已规划的 23 段必须仍用同一快照。
      await page.evaluate(async () => {
        const api = window.electronAPI, s = await api.getLocalSettings()
        await api.saveLocalSettings({ ...s, contextLength: 8192, maxTokens: 8192 })
      })
    }
    if (report.scopeProbe) assert.equal(data.options.num_ctx, 16384)
    const prompt = data.messages.at(-1).content
    const target = prompt.split('[需要改写的段落]\n')[1].split('\n\n[下一段]')[0]
    const item = { message: { content: target.replace('系统通过', '该系统通过') }, done: true, prompt_eval_count: 50, eval_count: 30 }
    if (data.stream) { res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); res.end(JSON.stringify(item) + '\n') }
    else send(item)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`, profile = path.join(root, 'profile')
  app = await launchPackaged(process.env.LOCAL_EDITION_TEST_EXE || path.resolve('release/win-unpacked/AutoDocxProofread-LocalEdition.exe'), profile)
  const page = await app.firstWindow()
  await page.evaluate(async origin => {
    const api = window.electronAPI
    await api.APISettings(origin, '', 'runtime-local', 'ollama')
    await api.selectAPISetting(origin, 'ollama', 'runtime-local', 1, null, 'ollama')
    const s = await api.getLocalSettings()
    await api.saveLocalSettings({ ...s, contextLength: 8192, maxTokens: 8192, documentPromptMode: 'original' })
  }, origin)
  // 直接持久化模拟其他进程的正常保存，故意不更新当前主进程内存缓存。
  execFileSync('python', ['-c', "import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); s=json.loads(c.execute('SELECT value FROM local_edition_settings WHERE id=1').fetchone()[0]); s.update(contextLength=16384,maxTokens=8192); c.execute('UPDATE local_edition_settings SET value=? WHERE id=1',(json.dumps(s),)); c.commit(); c.close()", path.join(profile, 'data/app.db')])
  report.savedContext = 16384
  report.runtimeMaxTokensBeforeTask = await page.evaluate(async () => (await window.electronAPI.getLocalSettings()).maxTokens)
  report.runtimeContextBeforeTask = await page.evaluate(async () => (await window.electronAPI.getLocalSettings()).contextLength)
  const result = await page.evaluate(fixture => window.electronAPI.processDocx('reduceAI', fixture, undefined, undefined, null, 1, null, 'runtime-settings', false), fixture)
  report.suggestions = result.proofResult?.length
  report.failures = result.failedSegments?.map(x => x.message) || []
  report.runtimeContextAfterTask = await page.evaluate(async () => (await window.electronAPI.getLocalSettings()).contextLength)
  console.log(JSON.stringify(report))
  assert.equal(report.failures.length, 0, 'Saved 16K context must replace stale 8K runtime before planning')
  assert.equal(report.suggestions, 23)
  assert.equal(report.chatRequests, 23)
  assert.equal(report.runtimeContextAfterTask, 16384)
  report.scopeProbe = true
  const second = await page.evaluate(fixture => window.electronAPI.processDocx('reduceAI', fixture, undefined, undefined, null, 1, null, 'runtime-snapshot', false), fixture)
  assert.equal(second.failedSegments?.length, 0)
  assert.equal(second.proofResult.length, 23)
  assert.equal(report.chatRequests, 46)
  report.midTaskSavePreservesAll23Requests = true
  await page.evaluate(async () => {
    const api = window.electronAPI, s = await api.getLocalSettings()
    await api.saveLocalSettings({ ...s, contextLength: 4096, maxTokens: 2048 })
  })
  const third = await page.evaluate(fixture => window.electronAPI.processDocx('reduceAI', fixture, undefined, undefined, null, 1, null, 'runtime-invalid-next', false), fixture)
  assert.equal(third.failedSegments.length, 23)
  assert.match(third.failedSegments[0].message, /上下文 4096.*输出预留 2048.*输入预算 1792.*系统提示 6553/)
  assert.equal(report.chatRequests, 46)
  report.invalidSavedBudgetExplainedWithoutGeneration = true
  await page.evaluate(async () => {
    const api = window.electronAPI, s = await api.getLocalSettings()
    await api.saveLocalSettings({ ...s, contextLength: 16384, maxTokens: 8192 })
  })
  console.log('PASS persisted refresh, in-flight snapshot, numeric budget error')
})().catch(error => { report.error = String(error); console.error(error); process.exitCode = 1 }).finally(async () => {
  if (app) await app.close().catch(() => {})
  if (server) { server.closeAllConnections(); server.close() }
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log('REPORT', path.join(root, 'report.json'))
})
