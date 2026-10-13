#requires -Version 5.1
<#
.SYNOPSIS
    生成本机自签名代码签名证书，用于给「今日待办」签名。

.DESCRIPTION
    Windows 的 SmartScreen 会拦下**未签名**的安装包，提示
    「Windows 已保护你的电脑 / Microsoft Defender SmartScreen 阻止了无法识别的应用启动」。
    这不是安装包坏了，而是它没有代码签名证书——未签名的 exe 首次运行本来就会被拦。
    点「更多信息 → 仍要运行」可以放行一次，但那只是绕过，不是修复。

    真正的修复是代码签名。个人自用可以用自签名证书：

        1) 本脚本生成证书并导出 .pfx 与 .cer（放进 .certs/，已被 .gitignore 忽略）
        2) 用 pnpm app:pack:signed 打包（electron-builder 会下载 signtool 并签名）
        3) 把 .cer 导入「受信任的根证书颁发机构」与「受信任的发布者」
           —— 这一步做完，SmartScreen 才会真正放行（脚本会打印现成命令）

    第 3 步会改动系统信任库，所以本脚本不自动执行它，需要你自己确认后运行。

    注意：自签名证书只在导入了它的机器上受信任。要分发给别人，
    必须购买 OV/EV 代码签名证书（EV 证书才有即时的 SmartScreen 信誉）。

.PARAMETER Password
    .pfx 的密码。不传则自动生成并打印。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\sign-app.ps1
#>
[CmdletBinding()]
param(
    [string]$Password
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root '.certs'
$pfxPath = Join-Path $certDir 'todolist-codesign.pfx'
$cerPath = Join-Path $certDir 'todolist-codesign.cer'
$subject = 'CN=YOUNG877 TodoList Code Signing'

if (-not $Password) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $Password = [Convert]::ToBase64String($bytes).Replace('/', 'A').Replace('+', 'B').Substring(0, 24)
}

New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $subject } |
    Select-Object -First 1

if ($existing) {
    $cert = $existing
    Write-Host "复用已有证书：$($cert.Thumbprint)" -ForegroundColor Cyan
} else {
    Write-Host '生成本机自签名代码签名证书…' -ForegroundColor Cyan
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $subject `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -KeyUsage DigitalSignature `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -NotAfter (Get-Date).AddYears(5)
    Write-Host "已生成证书：$($cert.Thumbprint)" -ForegroundColor Green
}

$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $secure | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

Write-Host "已导出 pfx：$pfxPath" -ForegroundColor Green
Write-Host "已导出 cer：$cerPath" -ForegroundColor Green

Write-Host @"

=== 下一步 ===

1) 用这个证书打包（会在 release/ 下生成已签名的安装包与绿色版）：

     `$env:CSC_LINK = "$pfxPath"
     `$env:CSC_KEY_PASSWORD = "<下面打印的密码>"
     pnpm app:pack

   或者直接用现成的脚本：

     pnpm app:pack:signed -Password "<下面打印的密码>"

2) 让本机信任这张证书（会弹安全警告，点「是」；用管理员运行则无弹窗）：

     certutil -user -addstore Root "$cerPath"
     certutil -user -addstore TrustedPublisher "$cerPath"

   做完这两步，双击安装包就不会再被 SmartScreen 拦了。

"@ -ForegroundColor Yellow

Write-Host "pfx 密码（请自行保存，不要提交到仓库）：$Password" -ForegroundColor Yellow
