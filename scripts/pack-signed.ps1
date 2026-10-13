#requires -Version 5.1
<#
.SYNOPSIS
    用 .certs/ 里的自签名证书打包并签名（electron-builder）。

.DESCRIPTION
    配合 scripts\sign-app.ps1 使用：先跑那个脚本生成 .certs\todolist-codesign.pfx，
    再用本脚本打包。electron-builder 会自动下载 signtool 并给主程序与安装包签名。

    打完之后还需要把 .certs\todolist-codesign.cer 导入本机信任库，
    SmartScreen 才会真正放行（导入命令见 sign-app.ps1 的输出）。

.PARAMETER Password
    .pfx 的密码。也可通过环境变量 CSC_KEY_PASSWORD 提供。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\pack-signed.ps1 -Password "xxx"
#>
[CmdletBinding()]
param(
    [string]$Password,
    # 不能叫 -Out：会和 PowerShell 通用参数 -OutVariable / -OutBuffer 前缀歧义
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pfxPath = Join-Path $root '.certs\todolist-codesign.pfx'
# 默认输出到项目内的 release/。
# 有些机器上（工作区里有文件监视或杀软实时扫描）electron-builder 解压 Electron 后的
# 目录改名会报 EPERM，这时用 -OutDir 指到工作区外的目录即可绕开，再把产物拷回来。
$outDir = if ($OutDir) { $OutDir } else { Join-Path $root 'release' }

if (-not (Test-Path $pfxPath)) {
    throw "找不到证书：$pfxPath`n请先执行：powershell -ExecutionPolicy Bypass -File scripts\sign-app.ps1"
}

if (-not $Password) { $Password = $env:CSC_KEY_PASSWORD }
if (-not $Password) {
    throw '缺少 pfx 密码。请用 -Password 传入，或设置环境变量 CSC_KEY_PASSWORD。'
}

$env:CSC_LINK = $pfxPath
$env:CSC_KEY_PASSWORD = $Password

# Electron 二进制与打包工具都走国内镜像，否则基本下不动
if (-not $env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' }
if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
}

# 优先用项目内的 electron-builder CLI，避免依赖 PATH 里的 pnpm
$cli = Join-Path $root 'node_modules\electron-builder\out\cli\cli.js'
Push-Location $root
try {
    if (Test-Path $cli) {
        $node = (Get-Command node -ErrorAction SilentlyContinue).Source
        if (-not $node) { $node = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' }
        & $node $cli --win --x64 "-c.directories.output=$outDir"
    } else {
        & pnpm exec electron-builder --win --x64 "-c.directories.output=$outDir"
    }
} finally {
    Pop-Location
}

Write-Host "`n=== 验签结果 ===" -ForegroundColor Cyan
$targets = @()
$targets += Get-ChildItem $outDir -Filter '*.exe' -ErrorAction SilentlyContinue
$unpacked = Join-Path $outDir 'win-unpacked\今日待办.exe'
if (Test-Path $unpacked) { $targets += Get-Item $unpacked }

foreach ($t in $targets) {
    $sig = Get-AuthenticodeSignature -LiteralPath $t.FullName
    $who = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '-' }
    Write-Host ("  {0,-42} {1,-14} {2}" -f $t.Name, $sig.Status, $who)
}

Write-Host "`n如果状态不是 Valid，说明证书还没被本机信任，执行：" -ForegroundColor Yellow
Write-Host "  certutil -user -addstore Root `"$root\.certs\todolist-codesign.cer`"" -ForegroundColor Yellow
Write-Host "  certutil -user -addstore TrustedPublisher `"$root\.certs\todolist-codesign.cer`"" -ForegroundColor Yellow
