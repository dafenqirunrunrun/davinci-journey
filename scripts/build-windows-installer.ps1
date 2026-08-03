# 达芬奇的奇妙之旅 - Windows 安装包构建脚本
#
# 职责：
#   1. 检查 Node / pnpm / Rust / Cargo / MSVC
#   2. 检查工作区状态（不读取未跟踪 Markdown）
#   3. 运行前端门禁
#   4. 运行 Rust 门禁
#   5. 执行 Tauri Release Build（NSIS）
#   6. 查找生成的安装包，输出路径、大小、SHA-256
#   7. 不自动安装、不自动 Push、不清理用户文件
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File ".\scripts\build-windows-installer.ps1"
#
# 禁止：git clean / git reset --hard / git add .

param(
    [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$srcTauri = Join-Path $projectRoot "apps\desktop\src-tauri"

Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " 达芬奇的奇妙之旅 - Windows 安装包构建" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan

function Get-VersionFromJson([string]$File) {
    if (Test-Path -LiteralPath $File) {
        $j = Get-Content -Raw -Encoding UTF8 -LiteralPath $File | ConvertFrom-Json
        return $j.version
    }
    return "?"
}

$appVersion = Get-VersionFromJson (Join-Path $srcTauri "tauri.conf.json")
Write-Host "应用版本：$appVersion"

# ── 1. 工具链检查 ───────────────────────────────────────────────────────────
if (-not $SkipChecks) {
    Write-Host "`n[1/6] 检查工具链..." -ForegroundColor Cyan

    $checks = @(
        @{ Name = "node"; Test = { Get-Command node -ErrorAction SilentlyContinue } },
        @{ Name = "pnpm"; Test = { Get-Command pnpm -ErrorAction SilentlyContinue } },
        @{ Name = "rustc"; Test = { Get-Command rustc -ErrorAction SilentlyContinue } },
        @{ Name = "cargo"; Test = { Get-Command cargo -ErrorAction SilentlyContinue } }
    )

    $allPresent = $true
    foreach ($c in $checks) {
        if (& $c.Test) {
            Write-Host "  [OK] $($c.Name)" -ForegroundColor Green
        } else {
            Write-Host "  [MISSING] $($c.Name)" -ForegroundColor Red
            $allPresent = $false
        }
    }

    if (-not $allPresent) {
        Write-Host "缺少必要工具链，请先安装 Node.js、pnpm、Rust（含 MSVC toolchain）。" -ForegroundColor Red
        exit 1
    }

    # MSVC / link.exe check
    $link = Get-Command link -ErrorAction SilentlyContinue
    if (-not $link) {
        Write-Host "  [WARN] 未在 PATH 检测到 link.exe（MSVC）。" -ForegroundColor Yellow
        Write-Host "        若构建失败，请从“开发者命令提示符 (VS)”运行，或先调用 VsDevCmd.bat。" -ForegroundColor Yellow
    }
}

# ── 2. 工作区状态检查 ───────────────────────────────────────────────────────
Write-Host "`n[2/6] 检查工作区状态..." -ForegroundColor Cyan
Set-Location $projectRoot
$status = git status --porcelain
$untracked = $status | Where-Object { $_ -match "^\?\?" }
Write-Host "  未跟踪文件：$($untracked.Count) 个（不会读取内容，不会参与构建）"
Write-Host "  当前 HEAD：$(git rev-parse --short HEAD)"

# ── 3. 前端门禁 ─────────────────────────────────────────────────────────────
Write-Host "`n[3/6] 运行前端门禁..." -ForegroundColor Cyan
Write-Host "  pnpm lint ..."
pnpm lint
if ($LASTEXITCODE -ne 0) { Write-Host "lint 失败" -ForegroundColor Red; exit 1 }

Write-Host "  pnpm typecheck ..."
pnpm typecheck
if ($LASTEXITCODE -ne 0) { Write-Host "typecheck 失败" -ForegroundColor Red; exit 1 }

Write-Host "  pnpm test ..."
pnpm test
if ($LASTEXITCODE -ne 0) { Write-Host "test 失败" -ForegroundColor Red; exit 1 }

Write-Host "  pnpm build ..."
pnpm build
if ($LASTEXITCODE -ne 0) { Write-Host "build 失败" -ForegroundColor Red; exit 1 }

# ── 4. Rust 门禁 ────────────────────────────────────────────────────────────
Write-Host "`n[4/6] 运行 Rust 门禁..." -ForegroundColor Cyan
Set-Location $srcTauri

Write-Host "  cargo fmt --check ..."
cargo fmt --check
if ($LASTEXITCODE -ne 0) { Write-Host "fmt 失败" -ForegroundColor Red; exit 1 }

Write-Host "  cargo check --all-targets --all-features ..."
cargo check --all-targets --all-features
if ($LASTEXITCODE -ne 0) { Write-Host "cargo check 失败" -ForegroundColor Red; exit 1 }

Write-Host "  cargo clippy -- -D warnings ..."
cargo clippy --all-targets --all-features -- -D warnings
if ($LASTEXITCODE -ne 0) { Write-Host "clippy 失败" -ForegroundColor Red; exit 1 }

Write-Host "  cargo test --all-targets --all-features ..."
cargo test --all-targets --all-features
if ($LASTEXITCODE -ne 0) { Write-Host "cargo test 失败" -ForegroundColor Red; exit 1 }

# ── 5. Tauri Release Build ───────────────────────────────────────────────────
Write-Host "`n[5/6] 执行 Tauri Release Build (NSIS)..." -ForegroundColor Cyan
Set-Location $projectRoot
pnpm --filter @davinci-journey/desktop tauri:build
if ($LASTEXITCODE -ne 0) {
    Write-Host "tauri:build 失败" -ForegroundColor Red
    exit 1
}

# ── 6. 定位安装包 ───────────────────────────────────────────────────────────
Write-Host "`n[6/6] 定位 NSIS 安装包..." -ForegroundColor Cyan
$bundleDir = Join-Path $srcTauri "target\release\bundle\nsis"
if (-not (Test-Path -LiteralPath $bundleDir)) {
    Write-Host "未找到安装包目录：$bundleDir" -ForegroundColor Red
    exit 1
}

$installers = Get-ChildItem -LiteralPath $bundleDir -Filter "*.exe" | Where-Object { -not $_.Name -match "\.msi$" }
if (-not $installers) {
    Write-Host "未找到 .exe 安装包。" -ForegroundColor Red
    exit 1
}

$installer = $installers | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer.FullName).Hash.ToLowerInvariant()
$sizeMB = [Math]::Round($installer.Length / 1MB, 2)

Write-Host ""
Write-Host "════════════════════════════════════════════" -ForegroundColor Green
Write-Host " 构建完成" -ForegroundColor Green
Write-Host " 安装包路径：$($installer.FullName)" -ForegroundColor Green
Write-Host " 文件大小：$sizeMB MB ($($installer.Length) bytes)" -ForegroundColor Green
Write-Host " SHA-256：$hash" -ForegroundColor Green
Write-Host " 应用版本：$appVersion" -ForegroundColor Green
Write-Host "════════════════════════════════════════════" -ForegroundColor Green

# 输出到临时清单文件，便于 CI 或后续脚本读取
$outFile = Join-Path $env:TEMP "davinci-installer-info.json"
[ordered]@{
    installerPath = $installer.FullName
    fileSize = $installer.Length
    sha256 = $hash
    version = $appVersion
    productName = "达芬奇的奇妙之旅"
} | ConvertTo-Json | Out-File -Encoding utf8 -LiteralPath $outFile
Write-Host "清单已写入：$outFile"

Write-Host ""
Write-Host "提示：" -ForegroundColor Yellow
Write-Host "  - 未签名应用首次运行可能触发 SmartScreen，选择“更多信息 → 仍要运行”。"
Write-Host "  - 未自动安装、未自动 Push、未清理用户文件。"
