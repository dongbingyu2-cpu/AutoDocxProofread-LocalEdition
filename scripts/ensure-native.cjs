// SQLite 使用稳定 N-API 预编译件；仅在缺失时从其官方 prebuild 安装器恢复。
const path = require('node:path')
const { spawnSync } = require('node:child_process')
try { require('sqlite3'); console.log('SQLite native binding ready.') }
catch {
  const installer = require.resolve('prebuild-install/bin.js')
  const result = spawnSync(process.execPath, [installer, '--runtime', 'napi'], {
    cwd: path.dirname(require.resolve('sqlite3/package.json')),
    // 缓存与工程在同一卷，避免 Windows 沙箱重定向导致 EXDEV 原子重命名失败。
    env: { ...process.env, npm_config_cache: path.resolve('.validation/npm-cache') },
    stdio: 'inherit', windowsHide: true
  })
  if (result.status !== 0) process.exit(result.status || 1)
  require('sqlite3')
  console.log('SQLite native binding restored and loaded.')
}
