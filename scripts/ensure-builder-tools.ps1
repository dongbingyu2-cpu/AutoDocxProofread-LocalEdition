$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$builderCacheRoot = if ($env:ELECTRON_BUILDER_CACHE) { $env:ELECTRON_BUILDER_CACHE } else { Join-Path $env:LOCALAPPDATA 'electron-builder\Cache' }
$signCache = Join-Path $builderCacheRoot 'winCodeSign'
$destination = Join-Path $signCache 'winCodeSign-2.6.0'
if (Test-Path -LiteralPath (Join-Path $destination 'rcedit-x64.exe')) { Write-Output 'Windows resource tools already present.'; exit 0 }
$artifactDir = Join-Path $projectRoot '.validation\tools'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$archive = Join-Path $artifactDir 'winCodeSign-2.6.0.7z'
if (-not (Test-Path -LiteralPath $archive) -or (Get-Item -LiteralPath $archive).Length -ne 5635384) {
  $cachedArtifact = Get-ChildItem -LiteralPath $signCache -Filter '*.7z' -ErrorAction SilentlyContinue | Where-Object Length -eq 5635384 | Select-Object -First 1
  # 按字节复制公开工具包，不继承 C 盘缓存的 EFS 属性，兼容不同卷。
  if ($cachedArtifact) { [IO.File]::WriteAllBytes($archive, [IO.File]::ReadAllBytes($cachedArtifact.FullName)) }
  else { Invoke-WebRequest -Uri 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z' -OutFile $archive }
}
New-Item -ItemType Directory -Force -Path $destination | Out-Null
# Windows 不使用 macOS 动态库；跳过这两个符号链接，避免要求管理员或修改开发者模式。
$sevenZip = Join-Path $projectRoot 'node_modules\7zip-bin\win\x64\7za.exe'
& $sevenZip x -bd -y $archive "-o$destination" '-xr!*.dylib' | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $destination 'rcedit-x64.exe'))) { throw 'Windows resource tool extraction failed.' }
$sha256 = [Security.Cryptography.SHA256]::Create()
$digest = [BitConverter]::ToString($sha256.ComputeHash([IO.File]::ReadAllBytes($archive))).Replace('-', '')
Write-Output "Official winCodeSign-2.6.0 archive SHA256: $digest"
