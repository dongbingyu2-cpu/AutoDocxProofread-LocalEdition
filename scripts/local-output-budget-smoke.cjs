// 复现实际 8K/2048 报错：正式包、23 段合成 DOCX 和回环 Mock；不读取用户数据。
const { launchPackaged } = require('./launchPackaged.cjs')
const { makeFixture } = require('./validationFixture.cjs')
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http')
const assert = require('node:assert/strict'), JSZip = require('jszip')
const root = path.resolve('.validation', `output-budget-${Date.now()}`)
const report = { kind: 'Production EXE + isolated 8K/2048 settings + 23 synthetic paragraphs + loopback Mock', requests: [], budgetViolations: 0 }
let app, server, thinkingOnly = false
;(async () => {
  await fs.mkdir(root, { recursive: true })
  const file = path.join(root, 'output.docx'); await makeFixture(file)
  const zip = await JSZip.loadAsync(await fs.readFile(file))
  const paragraphs = Array.from({ length: 23 }, (_, i) => `<w:p><w:r><w:t>系统通过本地模型处理文档，用户确认建议后可以导出结果，原始文件独立保存。系统记录任务状态和失败原因，用户检查专业术语、操作步骤和数值后决定是否接受修改。这是第${i + 1}段说明。</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`)
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
  server = http.createServer(async (req, res) => {
    let raw = ''; for await (const p of req) raw += p
    const data = raw ? JSON.parse(raw) : {}
    const send = value => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.url === '/api/show') return send({ capabilities: ['completion'], thinking: { values: thinkingOnly ? [true] : [false, true] }, model_info: { 'test.context_length': 40960 } })
    if (req.url === '/api/tags') return send({ models: [{ name: 'output-local' }] })
    if (req.url !== '/api/chat') { res.writeHead(404); return res.end() }
    const system = data.messages[0].content, prompt = data.messages.at(-1).content
    report.requests.push({ context: data.options.num_ctx, output: data.options.num_predict, systemBytes: Buffer.byteLength(system, 'utf8') })
    if (Buffer.byteLength(system + prompt, 'utf8') + data.options.num_predict + 256 > data.options.num_ctx) report.budgetViolations++
    const target = prompt.split('[需要改写的段落]\n')[1].split('\n\n[下一段]')[0]
    const item = { message: { content: target.replace('系统通过', '该系统通过') }, done: true, prompt_eval_count: 50, eval_count: 30 }
    if (data.stream) { res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); res.end(JSON.stringify(item) + '\n') }
    else send(item)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  app = await launchPackaged(process.env.LOCAL_EDITION_TEST_EXE || path.resolve('release/win-unpacked/AutoDocxProofread-LocalEdition.exe'), path.join(root, 'profile'))
  const page = await app.firstWindow()
  await page.evaluate(async origin => {
    const api = window.electronAPI; await api.APISettings(origin, '', 'output-local', 'ollama')
    await api.selectAPISetting(origin, 'ollama', 'output-local', 1, null, 'ollama')
    await api.saveLocalSettings({ ...(await api.getLocalSettings()), contextLength: 8192, maxTokens: 2048, documentPromptMode: 'original' })
  }, origin)
  const run = () => page.evaluate(file => window.electronAPI.processDocx('reduceAI', file, undefined, undefined, null, 1, null, `output-${Date.now()}`, false), file)
  const result = await run()
  report.suggestions = result.proofResult?.length; report.failures = result.failedSegments?.map(x => x.message)
  console.log(JSON.stringify({ suggestions: report.suggestions, failures: report.failures, requestCount: report.requests.length }))
  assert.equal(report.failures.length, 0, '8K/2048 should use a smaller per-request output allowance instead of rejecting all 23 paragraphs')
  assert.equal(report.suggestions, 23); assert.ok(report.requests.length >= 23)
  assert.ok(report.requests.every(r => r.context === 8192 && r.output === 1024 && r.systemBytes === 6553))
  assert.equal(report.budgetViolations, 0)
  const settings = await page.evaluate(() => window.electronAPI.getLocalSettings())
  assert.equal(settings.contextLength, 8192); assert.equal(settings.maxTokens, 2048)
  report.savedSettingsRetained = true
  thinkingOnly = true; const count = report.requests.length
  // 使用另一个模型名，避免模型能力缓存影响只能思考的分支。
  await page.evaluate(origin => window.electronAPI.selectAPISetting(origin, 'ollama', 'thinking-local', 1, null, 'ollama'), origin)
  const thinking = await run(); assert.equal(thinking.failedSegments.length, 23); assert.equal(report.requests.length, count)
  report.thinkingBudgetNotSilentlyReduced = true
  console.log('PASS exact 8K/2048 scenario, unchanged prompt/context/settings, thinking-only guard')
})().catch(e => { report.error = String(e); console.error(e); process.exitCode = 1 }).finally(async () => {
  if (app) await app.close().catch(() => {})
  if (server) { server.closeAllConnections(); server.close() }
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log('REPORT', path.join(root, 'report.json'))
})
