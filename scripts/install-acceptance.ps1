$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $projectRoot 'release\AutoDocxProofread-LocalEdition-Setup.exe'
$testRoot = Join-Path $projectRoot ".validation\installation-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$installDir = Join-Path $testRoot 'installed'
if (Test-Path -LiteralPath $installDir) { throw 'Test installation destination already exists.' }
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
# electron-builder 使用 StdUtils 解析 /D，路径含空格时需要为参数值加引号。
$process = Start-Process -FilePath $setup -ArgumentList "/S /currentuser /D=`"$installDir`"" -PassThru -Wait -WindowStyle Hidden
if ($process.ExitCode -ne 0) { throw "Installer exit: $($process.ExitCode)" }
$executable = Join-Path $installDir 'AutoDocxProofread-LocalEdition.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Installed executable not found.' }
$version = (Get-Item -LiteralPath $executable).VersionInfo
$registry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*AutoDocxProofread*Local*' } | Select-Object DisplayName,DisplayVersion,InstallLocation,UninstallString
$report = @{ setup=$setup; testRoot=$testRoot; installDir=$installDir; executable=$executable; installerExit=$process.ExitCode; productName=$version.ProductName; productVersion=$version.ProductVersion; registry=$registry }
$json = $report | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $projectRoot '.validation\installation-current.json'), $json, (New-Object Text.UTF8Encoding($false)))
Write-Output $json
exit 0
