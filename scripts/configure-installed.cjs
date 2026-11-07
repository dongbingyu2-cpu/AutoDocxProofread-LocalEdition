// 只在本版首次使用且没有任何模型配置时初始化本机现有模型，不改用户已有设置。
const { launchPackaged } = require('./launchPackaged.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
let app
async function main() {
  const lifecycle = JSON.parse(await fs.readFile('.validation/install-lifecycle.json', 'utf8'))
  app = await launchPackaged(lifecycle.finalExecutable)
  const page = await app.firstWindow()
  const result = await page.evaluate(async () => {
    const api = window.electronAPI
    const found = await api.discoverOllama()
    const rows = await api.getALLAPISettings()
    let initialized = false
    if (!rows.length && found.success && found.models.some(model => model.name === 'qwen3:8b')) {
      await api.APISettings('http://127.0.0.1:11434', '', 'qwen3:8b', 'ollama')
      const profile = (await api.getALLAPISettings())[0]
      const settings = await api.getLocalSettings()
      settings.roles = { chat: profile.id, proof: profile.id, reduce: profile.id, embedding: null }
      settings.concurrency = 1; settings.contextLength = 16384; settings.maxTokens = 4096
      await api.saveLocalSettings(settings)
      initialized = true
    }
    return { initialized, model: initialized ? 'qwen3:8b' : undefined, foundModels: found.models.map(model => model.name), settings: await api.getLocalSettings() }
  })
  await page.evaluate(() => { location.hash = '#/api' })
  await page.getByTestId('local-edition-panel').waitFor()
  await page.screenshot({ path: path.resolve('.validation/final-installed.png'), animations: 'disabled' })
  await fs.writeFile('.validation/final-installed.json', JSON.stringify({ executable: lifecycle.finalExecutable, ...result }, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.close() })
