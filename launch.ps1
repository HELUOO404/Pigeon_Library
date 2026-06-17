# launch.ps1 — PigeonLib 启动器 / Launcher(中英双语 / bilingual)
# 说明:cmd 在本机无法可靠解析含中文的 .bat,故启动逻辑放在 PowerShell(可靠 Unicode 输出),
#       由同名 启动PigeonLib.bat 薄包装(纯 ASCII)调起。
chcp 65001 > $null 2>&1
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Set-Location -Path $PSScriptRoot

function Pause-Exit($code) {
  Write-Host ''
  Read-Host '按回车键退出 / Press Enter to exit' | Out-Null
  exit $code
}

Write-Host '============================================'
Write-Host '  PigeonLib 启动器 / Launcher'
Write-Host '============================================'
Write-Host ''

Write-Host '[1/4] 检测 Node.js / npm ... / Checking Node.js / npm ...'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '  [X] 未找到 node,请安装 Node.js 并加入系统 PATH。'
  Write-Host '  [X] node not found. Install Node.js and add it to PATH.'
  Write-Host '      下载 / Download: https://nodejs.org/'
  Pause-Exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host '  [X] 找到 node 但未找到 npm,请重装含 npm 的 Node.js。'
  Write-Host '  [X] Found node but not npm. Reinstall Node.js with npm.'
  Pause-Exit 1
}
Write-Host "  [OK] node $(node -v)"
Write-Host ''

Write-Host '[2/4] 检查内置课程包 / Checking built-in course package ...'
if (-not (Test-Path 'dist-courses\ic-packaging.pigeon')) {
  Write-Host '  未找到,正在打包 / Not found, building ic-packaging ...'
  node tools\build-pigeon.mjs ic-packaging
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  [X] 打包失败,请看上面报错。 / Build failed, see the error above.'
    Pause-Exit 1
  }
}
Write-Host '  [OK] dist-courses\ic-packaging.pigeon'
Write-Host ''

Write-Host '[3/4] 检查依赖 / Checking dependencies ...'
Set-Location -Path (Join-Path $PSScriptRoot 'app')
if (-not (Test-Path 'node_modules')) {
  Write-Host '  首次运行,安装依赖,约 1-2 分钟 ... / First run, installing dependencies (~1-2 min) ...'
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  [X] npm install 失败,请看上面报错。 / npm install failed, see the error above.'
    Pause-Exit 1
  }
}
Write-Host '  [OK] 依赖就绪 / dependencies ready'
Write-Host ''

Write-Host '[4/4] 启动本地服务器 / Starting local server  http://localhost:5173  ...'
Write-Host '      浏览器将自动打开;保持此窗口开启即保持服务运行。'
Write-Host '      Browser opens automatically; keep this window open to keep serving.'
Write-Host ''
npm run dev

Write-Host ''
Write-Host '[PigeonLib] 服务器已退出 / Server has exited.'
Pause-Exit 0
