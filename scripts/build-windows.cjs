// 将所有构建工具缓存固定在工程卷，规避 Windows 沙箱 C/E 跨卷原子重命名问题。
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const env = { ...process.env, ELECTRON_BUILDER_CACHE: path.resolve('.validation/builder-cache') }
const prepare = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/ensure-builder-tools.ps1')], { env, stdio: 'inherit', windowsHide: true })
if (prepare.status !== 0) process.exit(prepare.status || 1)
const build = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', '--config', 'electron-builder.yml', '--publish', 'never'], { env, stdio: 'inherit', windowsHide: true })
if (build.error) throw build.error
process.exit(build.status ?? 1)
