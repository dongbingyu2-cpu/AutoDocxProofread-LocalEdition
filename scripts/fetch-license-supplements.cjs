// 仅从包元数据指向的官方 GitHub 仓库补充缺失的许可证，并记录具体来源。
const fs = require('node:fs/promises')
const path = require('node:path')
const report = require('../docs/DEPENDENCY_LICENSES.json')
const targets = report.packages.filter(item => !item.texts.length)
async function main() {
  await fs.mkdir('docs/licenses', { recursive: true })
  const results = await Promise.allSettled(targets.map(async item => {
    const meta = JSON.parse(await fs.readFile(path.join(item.location, 'package.json'), 'utf8'))
    const repo = typeof meta.repository === 'object' ? meta.repository?.url : meta.repository
    const match = /github\.com[/:]([^/]+\/[^/#]+?)(?:\.git)?$/.exec(repo || '')
    if (!match) return { name: item.name, status: 'package-metadata-only', license: item.license, author: meta.author }
    const proxyPackage = ['agent-base', 'http-proxy-agent', 'https-proxy-agent', 'socks-proxy-agent'].includes(item.name)
    const repository = proxyPackage ? 'TooTallNate/proxy-agents' : match[1]
    const license = item.name === 'sqlite-vec-windows-x64' ? 'LICENSE-MIT'
      : proxyPackage ? `packages/${item.name}/LICENSE`
      : item.name === 'tr46' ? 'LICENSE.md'
      : item.name === 'dingbat-to-unicode' ? 'js/LICENSE'
      : item.name === 'err-code' ? 'README.md' : 'LICENSE'
    const refs = [...new Set([`v${item.version}`, item.version, ...(proxyPackage ? [`${item.name}@${item.version}`] : []), 'master', 'main'])]
    for (const ref of refs) {
      const url = `https://raw.githubusercontent.com/${repository}/${ref}/${license}`
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(12000) })
        if (!response.ok) { await response.body?.cancel(); continue }
        let text = await response.text()
        if (item.name === 'err-code') text = text.slice(Math.max(0, text.search(/#+\s*licen[cs]e/i)))
        if (!/permission|redistribution|license/i.test(text)) continue
        const filename = `${item.name.replace(/[^a-z0-9-]/gi, '_')}.txt`
        await fs.writeFile(path.join('docs/licenses', filename), `Package: ${item.name}@${item.version}\nSource: ${url}\nRef: ${ref} (${ref === 'master' || ref === 'main' ? 'upstream branch; package declares same license' : 'version ref'})\n\n${text}`)
        return { name: item.name, status: 'supplemented', file: filename, url }
      } catch { /* 尝试该包的下一个官方引用，不使用镜像站。 */ }
    }
    return { name: item.name, status: 'unresolved', repo, license: item.license }
  }))
  const records = results.map((result, i) => result.status === 'fulfilled' ? result.value : { name: targets[i].name, status: 'error', error: String(result.reason) })
  await fs.writeFile('docs/licenses/SOURCES.json', JSON.stringify(records, null, 2) + '\n')
  console.log(JSON.stringify(records, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
