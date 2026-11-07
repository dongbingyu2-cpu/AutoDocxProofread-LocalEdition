const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const asar = require('@electron/asar')
async function main() {
  const root = path.resolve('release/win-unpacked'), archive = path.join(root, 'resources/app.asar')
  const entries = asar.listPackage(archive)
  assert.ok(!entries.some(entry => /\.(gguf|safetensors|db|log)$|ollama\.exe$|[\\/]\.env$/i.test(entry)))
  // asar 在 Windows 按 path.sep 拆分查找路径，不能硬编码 POSIX 分隔符。
  assert.deepEqual(asar.extractFile(archive, path.join('out', 'main', 'main.js')), fs.readFileSync('out/main/main.js'))
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json'))
  assert.equal(pkg.version, require('../package.json').version)
  const resources = ['resources/app.asar.unpacked/node_modules/sqlite3/build/Release/node_sqlite3.node', 'resources/sqlite-vec/vec0.dll', 'resources/THIRD_PARTY_NOTICES.txt', 'LICENSES.chromium.html']
  for (const item of resources) assert.ok(fs.statSync(path.join(root, item)).size > 0)
  const { getCurrentFuseWire } = require('@electron/fuses')
  const fuses = await getCurrentFuseWire(path.join(root, 'AutoDocxProofread-LocalEdition.exe'))
  const report = { packageVersion: pkg.version, mainBundleMatchesSource: true, noOllamaOrModelsOrUserDatabase: true, resources, fuses }
  fs.writeFileSync('.validation/package-content.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
