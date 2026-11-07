// 真实文档验收需显式提供路径；仅连接本机 Ollama，报告不包含正文，原文件只读。
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict'), JSZip = require('jszip')
const { expect } = require('@playwright/test')
const { launchPackaged } = require('./launchPackaged.cjs')
const { acceptNativeDialog } = require('./acceptExport.cjs')
const root = path.resolve('.validation', `document-real-${Date.now()}`)
// 默认复现已经完成效果对照的组合；其他模型需显式指定，不推断其效果或耗时。
const models = (process.env.LOCAL_DOCUMENT_MODELS || 'qwen3:8b').split(',')
const report = { kind: 'REAL supplied DOCX + REAL local Ollama + production Vue buttons/IPC/Word export', models: [] }
let app
async function main() {
  await fs.mkdir(root, { recursive: true })
  const document = process.env.LOCAL_DOCUMENT_PATH
  assert.ok(document && path.isAbsolute(document), '请通过 LOCAL_DOCUMENT_PATH 提供明确授权的绝对 DOCX 路径。')
  const original = await fs.readFile(document), digest = crypto.createHash('sha256').update(original).digest('hex')
  const sourceZip = await JSZip.loadAsync(original, { checkCRC32: true })
  // 原生 SendKeys 自动化不可靠地输入中文文件名；只给测试副本使用 ASCII 路径，字节与原件一致。
  const fixture = path.join(root, 'manual.docx'); await fs.writeFile(fixture, original)
  const exe = process.env.LOCAL_EDITION_TEST_EXE || path.resolve('release/win-unpacked/AutoDocxProofread-LocalEdition.exe')
  app = await launchPackaged(exe, path.join(root, 'profile'))
  const page = await app.firstWindow()
  await page.evaluate(async models => {
    const api = window.electronAPI, found = await api.discoverOllama()
    for (const name of models) {
      if (!found.success || !found.models.some(m => m.name === name)) throw new Error('待测本地模型未安装；不会自动下载。')
      await api.APISettings('http://127.0.0.1:11434', '', name, 'ollama')
    }
    const settings = await api.getLocalSettings()
    Object.assign(settings, { contextLength: 16384, maxTokens: 8192, concurrency: 1, timeoutSec: 300 })
    await api.saveLocalSettings(settings)
  }, models)
  report.runtime = await page.evaluate(async () => {
    const s = await window.electronAPI.getLocalSettings()
    return { contextLength: s.contextLength, maxTokens: s.maxTokens, concurrency: s.concurrency, documentPromptMode: s.documentPromptMode }
  })
  await page.reload()
  const open = acceptNativeDialog(app, fixture, '选择 DOCX 文件')
  await Promise.all([page.getByRole('button', { name: '选择文件', exact: true }).click(), open])
  await page.locator('.file-name-tag').waitFor()
  await page.locator('.mode-select').click(); await page.getByRole('option', { name: '降低AI率', exact: true }).click()
  await page.exposeFunction('recordLocalDocumentProgress', payload => {
    if (report.models.length) {
      const entry = report.models.at(-1)
      entry.progress = payload
      if (payload.completed != null) console.log(JSON.stringify({ kind: 'progress', model: entry.model, ...payload }))
    }
  })
  await page.evaluate(() => window.electronAPI.onProofreadProgress(p => window.recordLocalDocumentProgress({ stage: p.stage, completed: p.completed, total: p.total })))
  for (const model of models) {
    await page.getByTestId('document-model-select').click(); await page.getByRole('option').filter({ hasText: model }).click()
    assert.equal(await page.getByTestId('local-extra-review').locator('input').isChecked(), false)
    const entry = { model }; report.models.push(entry)
    const started = Date.now()
    // 整体等待有上限，超时仅关闭测试实例，后台请求随窗口销毁取消。
    await page.getByRole('button', { name: '开始校正', exact: true }).click()
    await expect(page.getByRole('button', { name: '导出结果', exact: true })).toBeEnabled({ timeout: 1200000 })
    Object.assign(entry, { elapsedMs: Date.now() - started, suggestions: await page.locator('.el-collapse-item').count(), warnings: await page.getByTestId('quality-warning').count(), failedAlert: await page.locator('.error-alert').count() })
    assert.ok(entry.suggestions > 0 && entry.failedAlert === 0, '真实文档未完整处理成功')
    const output = path.join(root, model.replace(/[^a-z0-9.-]/gi, '-') + '.docx')
    await page.locator('.apply-changes-btn').click(); await page.locator('.el-dropdown-menu__item').filter({ hasText: '应用全部修改' }).click()
    const save = acceptNativeDialog(app, output)
    await Promise.all([page.getByRole('button', { name: '导出结果', exact: true }).click(), save])
    // 对话框关闭后主进程仍需回写 ZIP，等待实际完整文件，不能把“窗口关闭”当作保存完成。
    let exported
    await expect.poll(async () => {
      try { exported = await JSZip.loadAsync(await fs.readFile(output), { checkCRC32: true }); return true } catch { return false }
    }, { timeout: 30000 }).toBe(true)
    const parts = Object.keys(sourceZip.files).filter(n => /^word\/(media\/|styles\.xml|header\d+\.xml|footer\d+\.xml|footnotes\.xml)/.test(n) && !sourceZip.files[n].dir)
    let binaryIdentical = 0
    for (const name of parts) {
      const before = await sourceZip.file(name).async('nodebuffer'), after = await exported.file(name).async('nodebuffer')
      if (before.equals(after)) binaryIdentical++
      if (!name.endsWith('.xml')) assert.deepEqual(after, before)
      else {
        // 原引擎会统一 XML 换行并为脚注分隔符追加无格式空文字 run；两者无正文或样式变化。
        const normalize = b => b.toString('utf8').replace(/\r\n/g, '\n').replace(/<w:r>\s*<w:t\s*\/>\s*<\/w:r>/g, '')
        assert.equal(normalize(after), normalize(before), `格式部件内容发生变化：${name}`)
      }
    }
    assert.equal(crypto.createHash('sha256').update(await fs.readFile(document)).digest('hex'), digest)
    entry.export = { CRC: true, originalUnchanged: true, checkedFormatParts: parts.length, binaryIdenticalParts: binaryIdentical, contentAndStylesPreserved: true, containsUnapprovedRiskCandidates: entry.warnings > 0 }
    console.log(JSON.stringify(entry)); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  }
}
main().catch(e => { report.error = String(e.stack || e); console.error(report.error); process.exitCode = 1 }).finally(async () => {
  if (app) await app.close().catch(() => {})
  await fs.mkdir(root, { recursive: true }); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log('REPORT', path.join(root, 'report.json'))
})
