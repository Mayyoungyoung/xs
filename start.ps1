param()
$ErrorActionPreference = 'Stop'
$projectDirectory = Join-Path $PSScriptRoot 'webapp'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 22.15 或更高版本。' }
$nodeVersion = [version]((node --version).TrimStart('v'))
if ($nodeVersion -lt [version]'22.15.0') { throw '请升级至 Node.js 22.15 或更高版本。' }
Push-Location -LiteralPath $projectDirectory
try {
    if (-not (Test-Path -LiteralPath '.env.local')) { Copy-Item -LiteralPath '.env.example' -Destination '.env.local' }
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查网络后重试。' }
    }
    Write-Host '墨脉正在启动。请打开 http://localhost:5173'
    Write-Host 'AI 配置：在 webapp/.env.local 填写 DEEPSEEK_API_KEY，重启后在设置中测试连接。'
    & npm.cmd run dev
    if ($LASTEXITCODE -ne 0) { Write-Host '如果应用已启动，请直接打开上面的地址。否则请查看前面的错误信息。' }
}
finally { Pop-Location }
