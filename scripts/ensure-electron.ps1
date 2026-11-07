$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$electronPackage = Join-Path $projectRoot 'node_modules\electron'
$electronInfo = Get-Content -LiteralPath (Join-Path $electronPackage 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$runtimeDir = Join-Path $electronPackage 'dist'
if ((Test-Path -LiteralPath (Join-Path $runtimeDir 'electron.exe')) -and
    (Test-Path -LiteralPath (Join-Path $electronPackage 'path.txt')) -and
    (Test-Path -LiteralPath (Join-Path $runtimeDir 'version')) -and
    ((Get-Content -LiteralPath (Join-Path $runtimeDir 'version') -Raw).Trim().TrimStart('v') -eq $electronInfo.version)) {
  Write-Output "Electron $($electronInfo.version) runtime already present."
  exit 0
}
$runtimeName = "electron-v$($electronInfo.version)-win32-x64.zip"
$runtimeUrl = "https://github.com/electron/electron/releases/download/v$($electronInfo.version)/$runtimeName"
$urlDirectory = $runtimeUrl.Substring(0, $runtimeUrl.LastIndexOf('/'))
$sha = [System.Security.Cryptography.SHA256]::Create()
$cacheKey = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($urlDirectory))).Replace('-', '').ToLowerInvariant()
$cacheFile = Join-Path $env:LOCALAPPDATA "electron\Cache\$cacheKey\$runtimeName"
if (-not (Test-Path -LiteralPath $cacheFile)) {
  $artifactDir = Join-Path $projectRoot '.validation\runtime'
  New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
  $cacheFile = Join-Path $artifactDir $runtimeName
  Invoke-WebRequest -Uri $runtimeUrl -OutFile $cacheFile
}
# 只接纳官方 Electron 包自带校验表中的 SHA256，不跳过校验、不更换下载来源。
$checksums = Get-Content -LiteralPath (Join-Path $electronPackage 'checksums.json') -Raw | ConvertFrom-Json
$expected = $checksums.$runtimeName
$actual = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($cacheFile))).Replace('-', '').ToLowerInvariant()
if (-not $expected -or $actual -ne $expected) { throw "Electron SHA256 校验失败：$actual" }
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Expand-Archive -LiteralPath $cacheFile -DestinationPath $runtimeDir -Force
Set-Content -LiteralPath (Join-Path $electronPackage 'path.txt') -Value 'electron.exe' -NoNewline -Encoding ascii
if (-not (Test-Path -LiteralPath (Join-Path $runtimeDir 'electron.exe'))) { throw 'Electron 可执行文件缺失' }
Write-Output "Electron $($electronInfo.version) Windows x64 verified: $actual"
