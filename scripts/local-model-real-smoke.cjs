// 真实本地模型验收：只用合成短文，独立 profile；不下载模型、不读取用户文件。
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict'), JSZip = require('jszip')
const { launchPackaged } = require('./launchPackaged.cjs')
const { makeFixture } = require('./validationFixture.cjs')
const { acceptNativeDialog } = require('./acceptExport.cjs')
const root = path.resolve('.validation', `local-model-real-${Date.now()}`)
const models = (process.env.LOCAL_REAL_MODELS || 'qwen3:8b,qwen3:4b,qwen3.5:4b').split(',')
const report = { kind: 'REAL local Ollama + production EXE + synthetic DOCX', models: [] }
let app
async function main() {
  await fs.mkdir(root, { recursive: true })
  const fixture = path.join(root, 'synthetic.docx')
  await makeFixture(fixture)
  const zip = await JSZip.loadAsync(await fs.readFile(fixture))
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>系统接收用户输入后完成校验，并将处理结果显示在界面上。用户可以查看处理记录，也可以将结果导出为文档。该流程保留原始数据，便于核对和追溯。</w:t></w:r></w:p></w:body></w:document>')
  await fs.writeFile(fixture, await zip.generateAsync({ type: 'nodebuffer' }))
  const exe = process.env.LOCAL_EDITION_TEST_EXE || path.resolve('release/win-unpacked/AutoDocxProofread-LocalEdition.exe')
  app = await launchPackaged(exe, path.join(root, 'profile'))
  const page = await app.firstWindow()
  for (const model of models) {
    const started = Date.now(), runId = `real-${model}`
    await page.evaluate(async model => {
      const api = window.electronAPI, found = await api.discoverOllama()
      if (!found.success || !found.models.some(item => item.name === model)) throw new Error(`本机未安装 ${model}；不会自动下载。`)
      const settings = await api.getLocalSettings()
      settings.contextLength = 16384; settings.maxTokens = 8192; settings.timeoutSec = 180
      await api.saveLocalSettings(settings)
      await api.selectAPISetting('http://127.0.0.1:11434', '', model, 1, null, 'ollama')
    }, model)
    const timer = setTimeout(() => page.evaluate(id => window.electronAPI.cancelProofread(id), runId).catch(() => {}), 360000)
    let result
    try { result = await page.evaluate(({ fixture, runId }) => window.electronAPI.processDocx('reduceAI', fixture, undefined, undefined, null, 1, null, runId, false), { fixture, runId }) }
    finally { clearTimeout(timer) }
    const item = { model, suggestions: result.proofResult?.length || 0, tokens: result.token_usage, failures: result.failedSegments?.map(item => item.message) || [], cancelled: Boolean(result.cancelled), elapsedMs: Date.now() - started }
    report.models.push(item)
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(item))
    assert.ok(item.suggestions > 0 && !item.cancelled, `${model} 未产生通过质量检查的修改；见报告，不将其记为通过。`)
    const output = path.join(root, model.replace(/[^a-z0-9.-]/gi, '-') + '.docx')
    const save = acceptNativeDialog(app, output)
    const [saved] = await Promise.all([page.evaluate(({ fixture, corrections }) => window.electronAPI.exportCorrectedDocx({ originalFilePath: fixture, appliedCorrections: corrections }), { fixture, corrections: result.proofResult }), save])
    const exported = await JSZip.loadAsync(await fs.readFile(output), { checkCRC32: true })
    assert.ok(saved.success && saved.appliedCount > 0)
    assert.notEqual(await exported.file('word/document.xml').async('string'), await zip.file('word/document.xml').async('string'))
    const parts = ['word/styles.xml', 'word/header1.xml', 'word/footer1.xml', 'word/footnotes.xml', 'word/media/test.png']
    for (const name of parts) assert.deepEqual(await zip.file(name).async('nodebuffer'), await exported.file(name).async('nodebuffer'))
    item.export = { appliedCount: saved.appliedCount, docxCRC: true, unchangedFormatParts: parts.length }
    console.log('PASS real rewrite and Word export:', model)
  }
}
main().catch(error => { report.error = String(error.stack || error); console.error(error); process.exitCode = 1 }).finally(async () => {
  if (app) await app.close().catch(() => {})
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log('REPORT', path.join(root, 'report.json'))
})
