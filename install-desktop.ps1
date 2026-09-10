param([string]$InstallPath)
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'desktop-release/Momai-Setup-1.1.0-x64.exe'
if (-not (Test-Path -LiteralPath $installer)) { throw '未找到安装包，请先在 webapp 中运行 npm run desktop:installer。' }
$arguments = @('/NORESTART')
if ($InstallPath) {
    if (-not [IO.Path]::IsPathRooted($InstallPath) -or $InstallPath.Contains('"')) { throw '请填写完整的安装目录，例如 D:\应用\墨脉。' }
    $arguments += '/DIR="' + $InstallPath + '"'
}
# This is the interactive installer the user explicitly launched.
$process = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Normal -PassThru
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw ('安装未完成，返回代码：' + $process.ExitCode) }
