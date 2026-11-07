$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$installation = Get-Content -LiteralPath (Join-Path $projectRoot '.validation\installation-current.json') -Encoding UTF8 -Raw | ConvertFrom-Json
function Get-Digest([string]$File) {
  $sha = [Security.Cryptography.SHA256]::Create()
  return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($File))).Replace('-', '').ToLowerInvariant()
}
$originalFiles = @('D:\autodocxproofread\AutoDocxProofreading\AutoDocxProofreading.exe', (Join-Path $env:APPDATA 'AutoDocxProofreading\data\app.db'), (Join-Path $env:APPDATA 'AutoDocxProofreading\vector-db\knowledge.db'))
$originalHashes = @{}
foreach ($file in $originalFiles) { if (Test-Path -LiteralPath $file) { $originalHashes[$file] = Get-Digest $file } }
$userData = Join-Path $env:APPDATA 'AutoDocxProofread-LocalEdition'
$dataExisted = Test-Path -LiteralPath $userData
[IO.Directory]::CreateDirectory($userData) | Out-Null
$marker = Join-Path $userData "codex-validation-$([Guid]::NewGuid().ToString('N')).txt"
[IO.File]::WriteAllText($marker, 'Local Edition uninstall retention acceptance')
$markerHash = Get-Digest $marker
$latestMock = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.validation') -Directory -Filter 'desktop-mock-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$profileDB = Join-Path $latestMock.FullName 'data\app.db'
$profileHash = Get-Digest $profileDB
# 仅重装本次任务创建的独立安装；不调用原版卸载器。
$upgrade = Start-Process -FilePath $installation.setup -ArgumentList "/S /currentuser /D=`"$($installation.installDir)`"" -PassThru -Wait -WindowStyle Hidden
if ($upgrade.ExitCode -ne 0 -or (Get-Digest $profileDB) -ne $profileHash) { throw 'Reinstall or settings retention failed.' }
$uninstaller = Join-Path $installation.installDir 'Uninstall AutoDocxProofread-LocalEdition.exe'
if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Task uninstaller missing.' }
$uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S /currentuser' -PassThru -Wait -WindowStyle Hidden
for ($attempt=0; $attempt -lt 50 -and (Test-Path -LiteralPath $installation.executable); $attempt++) { Start-Sleep -Milliseconds 100 }
if ((Test-Path -LiteralPath $installation.executable) -or (Get-Digest $marker) -ne $markerHash -or (Get-Digest $profileDB) -ne $profileHash) { throw 'Uninstall data retention failed.' }
$finalDirectory = Join-Path $env:LOCALAPPDATA 'Programs\AutoDocxProofread-LocalEdition'
if (Test-Path -LiteralPath $finalDirectory) { throw 'Final destination already exists; no existing installation was overwritten.' }
$finalInstall = Start-Process -FilePath $installation.setup -ArgumentList "/S /currentuser /D=`"$finalDirectory`"" -PassThru -Wait -WindowStyle Hidden
$finalExe = Join-Path $finalDirectory 'AutoDocxProofread-LocalEdition.exe'
if ($finalInstall.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $finalExe)) { throw 'Final current-user installation failed.' }
foreach ($file in $originalHashes.Keys) { if ((Get-Digest $file) -ne $originalHashes[$file]) { throw 'Original application or database changed.' } }
# 只清理由本脚本创建的随机标记，不删除目录或任何用户数据。
[IO.File]::Delete($marker)
$result = @{ reinstallExit=$upgrade.ExitCode; uninstallExit=$uninstall.ExitCode; finalInstallExit=$finalInstall.ExitCode; defaultDataRetained=$true; profileDBRetained=$true; originalFilesUnchanged=$originalHashes; finalExecutable=$finalExe; finalDataPath=$userData; dataDirectoryPreviouslyExisted=$dataExisted }
$json = $result | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $projectRoot '.validation\install-lifecycle.json'), $json, (New-Object Text.UTF8Encoding($false)))
Write-Output $json
exit 0
