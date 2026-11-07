const { _electron: electron } = require('@playwright/test')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { launchPackaged } = require('./launchPackaged.cjs')
const { acceptExport } = require('./acceptExport.cjs')
const { makeFixture, verifyExport } = require('./validationFixture.cjs')
const root = path.resolve('.validation', `real-ollama-${Date.now()}`)
const report = { kind: 'REAL existing local Ollama; no model download', model: process.env.LOCAL_TEST_MODEL || 'qwen3:8b', checks: [], limitations: [] }
let app
function check(name, condition) { assert.ok(condition, name); report.checks.push(name); console.log('PASS', name) }
async function main() {
  await fs.mkdir(root, { recursive: true })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  app = process.env.LOCAL_EDITION_TEST_EXE ? await launchPackaged(process.env.LOCAL_EDITION_TEST_EXE, root) : await electron.launch({ args: [path.resolve('out/main/main.js'), `--user-data-dir=${root}`], env, timeout: 30000 })
  report.packaged = Boolean(app.packaged)
  const page = await app.firstWindow(); page.setDefaultTimeout(30000)
  const discovered = await page.evaluate(() => window.electronAPI.discoverOllama())
  check('真实 Ollama 连接与模型发现', discovered.success && discovered.models.some(m => m.name === report.model))
  await page.evaluate(async model => {
    const api = window.electronAPI
    await api.APISettings('http://127.0.0.1:11434', '', model, 'ollama')
    const profile = (await api.getALLAPISettings()).find(r => r.modelName === model)
    const settings = await api.getLocalSettings()
    settings.roles = { chat: profile.id, proof: profile.id, reduce: profile.id, embedding: profile.id }
    settings.contextLength = 16384; settings.maxTokens = 4096; settings.timeoutSec = 300
    await api.saveLocalSettings(settings)
    await api.selectAPISetting(profile.apiURL, '', profile.modelName, 1, null, 'ollama')
  }, report.model)
  const text = await page.evaluate(() => window.electronAPI.generateLocalText({ id: 'real-normal', text: '只回复“本地连接成功”，不要解释。', stream: false }))
  report.normal = { chars: text.result.length, tokens: text.total_tokens }
  check('真实普通生成', text.result.includes('本地连接成功'))
  const stream = await page.evaluate(async () => {
    let chunks = ''; const off = window.electronAPI.onLocalTextChunk(data => { if (data.id === 'real-stream') chunks += data.chunk })
    try { const result = await window.electronAPI.generateLocalText({ id: 'real-stream', text: '只回复“流式输出成功”，不要解释。' }); return { result, chunks } } finally { off() }
  })
  check('真实流式输出与最终结果一致', stream.result.result.includes('流式输出成功') && stream.chunks === stream.result.result)
  await page.evaluate(() => { window.pendingReal = window.electronAPI.generateLocalText({ id: 'real-cancel', text: '写一篇2000字的中文说明，介绍如何整理读书笔记。' }).then(() => 'completed', e => String(e)) })
  await page.waitForTimeout(150)
  await page.evaluate(() => window.electronAPI.cancelLocalText('real-cancel'))
  check('真实请求取消', (await page.evaluate(() => window.pendingReal)).includes('取消'))
  const fixture = path.join(root, 'real-fixture.docx'), exported = path.join(root, 'real-export.docx')
  await makeFixture(fixture)
  for (const mode of ['ComprehensiveError', 'reduceAI']) {
    const started = Date.now()
    const result = await page.evaluate(({ mode, fixture }) => window.electronAPI.processDocx(mode, fixture, undefined, undefined, null, 1, null, `real-${mode}`, false), { mode, fixture })
    report[mode] = { ms: Date.now() - started, suggestions: result.proofResult?.length || 0, failedSegments: result.failedSegments || [], message: result.message }
    await fs.writeFile(path.join(root, `${mode}-result.json`), JSON.stringify(result, null, 2))
    check(`真实 ${mode} 任务完成且无运行错误`, !result.message && !result.failedSegments?.length)
    if (mode === 'ComprehensiveError') check('真实模型识别夹具错别字', result.proofResult?.some(item => item.original.includes('错务') && item.suggested.includes('错误')))
    if (mode === 'reduceAI') check('真实改写经质量门禁产生建议', result.proofResult?.length > 0)
  }
  const saved = await acceptExport(app, page, fixture, exported)
  check('真实桌面 Word 导出', saved.success && saved.appliedCount === 1)
  report.wordFormat = await verifyExport(fixture, exported)
  // 不假设聊天模型具备 Embedding 能力。此探测只使用极短的合成字符串。
  try {
    const config = await page.evaluate(() => window.electronAPI.getLocalEmbeddingConfig())
    const result = await page.evaluate(async config => {
      await window.electronAPI.createRepository({ repositoryName: '真实Embedding验收', ...config })
      await window.electronAPI.lancedbInsert({ repositoryName: '真实Embedding验收', fileName: '合成.txt', text: '本地校对知识。', metadata: {} }, config)
      return window.electronAPI.lancedbQuery({ repositoryName: '真实Embedding验收', queryText: '校对', limit: 1 }, config)
    }, config)
    check('真实 Embedding 与 RAG', result.length === 1)
  } catch (error) { report.limitations.push(`现有模型的真实 Embedding/RAG 未通过：${String(error)}`); console.log('LIMITATION', report.limitations.at(-1)) }
  await page.evaluate(() => { location.hash = '#/api' })
  await page.getByTestId('local-edition-panel').waitFor()
  await page.screenshot({ path: path.join(root, 'real-settings.png'), animations: 'disabled' })
}
main().catch(error => { report.error = String(error.stack || error); console.error(error); process.exitCode = 1 }).finally(async () => {
  if (app) await app.close().catch(() => {})
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log('REPORT', path.join(root, 'report.json'))
})
