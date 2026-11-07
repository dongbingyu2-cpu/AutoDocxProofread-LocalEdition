const { launchPackaged } = require('./launchPackaged.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
let original, local
async function main() {
  const lifecycle = JSON.parse(await fs.readFile('.validation/install-lifecycle.json', 'utf8'))
  const originalProfile = path.resolve('.validation', `original-coexistence-${Date.now()}`)
  original = await launchPackaged('D:\\autodocxproofread\\AutoDocxProofreading\\AutoDocxProofreading.exe', originalProfile, false)
  local = await launchPackaged(lifecycle.finalExecutable)
  const oldPage = await original.firstWindow(), newPage = await local.firstWindow()
  const oldCount = (await oldPage.evaluate(() => window.electronAPI.getALLAPISettings())).length
  const settings = await newPage.evaluate(() => window.electronAPI.getLocalSettings())
  if (oldCount !== 0 || 'localOnly' in settings || !settings.roles.proof) throw new Error('Coexistence isolation check failed')
  const report = { simultaneousStartup: true, distinctProcesses: original.pid !== local.pid, originalIsolatedProfile: originalProfile, localProfile: lifecycle.finalDataPath, originalFixtureProfileEmpty: oldCount === 0, localSettingsAvailable: true }
  await fs.writeFile('.validation/coexistence.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { if (local) await local.close(); if (original) await original.close() })
