// 从锁文件和已安装包生成可审计的许可证清单，并把运行依赖的许可证文本带入安装包。
const fs = require('node:fs')
const path = require('node:path')
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const packages = [], missing = [], sections = []
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || (entry.dev && location !== 'node_modules/electron')) continue
  if (!fs.existsSync(path.join(location, 'package.json'))) continue // 可选的其他操作系统包未安装。
  const metadata = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'))
  const licenses = fs.readdirSync(location).filter(name => /^(licen[cs]e|copying|notice)(?:[._-]|$)/i.test(name) && fs.statSync(path.join(location, name)).isFile())
  const item = { name: metadata.name, version: metadata.version, license: metadata.license || entry.license || 'UNDECLARED', location, texts: licenses }
  packages.push(item)
  sections.push(`\n${'='.repeat(72)}\n${item.name}@${item.version}\nLicense: ${JSON.stringify(item.license)}\nSource: ${typeof metadata.repository === 'object' ? metadata.repository.url : metadata.repository || entry.resolved || ''}\n`)
  for (const license of licenses) sections.push(`--- ${license} ---\n${fs.readFileSync(path.join(location, license), 'utf8')}\n`)
  if (!licenses.length) missing.push(item.name)
}
// Chromium/Electron 自带的完整许可证仍由 electron-builder 保留 LICENSES.chromium.html。
if (fs.existsSync('docs/licenses')) {
  for (const file of fs.readdirSync('docs/licenses').filter(name => name.endsWith('.txt'))) sections.push(fs.readFileSync(path.join('docs/licenses', file), 'utf8'))
}
sections.unshift('AutoDocxProofread Local Edition - Third Party Notices\nGenerated from package-lock.json and installed runtime dependencies.\nOriginal project: Copyright (c) 2025 CZ600, MIT.\nBuild-only tools are excluded. Optional packages for other OS are excluded.\n')
fs.mkdirSync('docs', { recursive: true })
fs.writeFileSync('docs/THIRD_PARTY_NOTICES.txt', sections.join('\n'))
fs.writeFileSync('docs/DEPENDENCY_LICENSES.json', JSON.stringify({ packages, missingLicenseFiles: missing }, null, 2) + '\n')
const licenses = [...new Set(packages.map(p => typeof p.license === 'string' ? p.license : JSON.stringify(p.license)))].sort()
console.log(JSON.stringify({ installedRuntimePackages: packages.length, licenses, missingLicenseFiles: missing }, null, 2))
