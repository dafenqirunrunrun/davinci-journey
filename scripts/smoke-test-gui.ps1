# 达芬奇的奇妙之旅 — 真实 Tauri GUI Smoke Test
#
# 用法：
#   1. 运行本脚本创建隔离测试仓库
#   2. 手动运行桌面应用完成 GUI 流程
#   3. 运行本脚本的验证部分确认结果
#
# 要求：
#   - 必须使用 fixtures/publish/valid-note/note.md（含两张真实图片）
#   - 严禁使用 笔记—7.30.md

param(
    [switch]$Verify
)

$ErrorActionPreference = "Stop"
$projectRoot = "D:\个人笔记管理"

if (-not $Verify) {
    # ── 创建隔离测试仓库 ──────────────────────────────────────────────
    $smokeDir = Join-Path $env:TEMP ("davinci-publish-smoke-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $smokeDir -Force | Out-Null
    Set-Location $smokeDir

    git init | Out-Null
    git config user.name "Davinci Smoke Test"
    git config user.email "smoke@example.invalid"

    # 最小必要结构
    New-Item -ItemType Directory -Path "content/ai-agent/langgraph" -Force | Out-Null
    New-Item -ItemType Directory -Path "public/assets/notes" -Force | Out-Null
    New-Item -ItemType Directory -Path "config" -Force | Out-Null
    Copy-Item "$projectRoot\config\archive-profiles.yml" "config\"
    "`# Smoke Test Repo" | Out-File -Encoding utf8 README.md

    git add README.md config/archive-profiles.yml
    git commit -m "initial commit" | Out-Null

    Write-Host "════════════════════════════════════════════════════════"
    Write-Host "  隔离测试仓库已创建：" -ForegroundColor Cyan
    Write-Host "  $smokeDir" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  请在桌面应用中手动完成以下流程：" -ForegroundColor Cyan
    Write-Host "  1. 启动应用：pnpm --filter @davinci-journey/desktop tauri:dev"
    Write-Host "  2. 选择 Markdown：fixtures\publish\valid-note\note.md"
    Write-Host "  3. 确认解析两张图片（architecture.png、flow.jpg）"
    Write-Host "  4. 选择归档方案：AI Agent / LangGraph"
    Write-Host "  5. 生成发布工作区"
    Write-Host "  6. 点击『写入正式仓库』→ 确认目标仓库为上面路径"
    Write-Host "  7. 查看 Git Diff → 精确 Stage → 编辑/确认 Commit Message"
    Write-Host "  8. 确认创建本地 Commit"
    Write-Host ""
    Write-Host "  完成后运行：$PSCommandPath -Verify" -ForegroundColor Yellow
    Write-Host "  （需要先执行：cd $PSCommandPath 所在目录）" -ForegroundColor DarkGray
    Write-Host "════════════════════════════════════════════════════════"
    Set-Location $projectRoot

} else {
    # ── 验证模式 ──────────────────────────────────────────────────────
    $latest = Get-ChildItem $env:TEMP -Directory -Filter "davinci-publish-smoke-*" |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if (-not $latest) {
        Write-Host "未找到测试仓库。请先运行：$PSCommandPath（不带 -Verify）" -ForegroundColor Red
        exit 1
    }

    $repo = $latest.FullName
    Set-Location $repo

    Write-Host "验证仓库：$repo" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "── git status --short ──" -ForegroundColor Cyan
    git status --short
    Write-Host ""
    Write-Host "── git log -1 --oneline ──" -ForegroundColor Cyan
    git log -1 --oneline
    Write-Host ""
    Write-Host "── git show --stat --oneline HEAD ──" -ForegroundColor Cyan
    git show --stat --oneline HEAD
    Write-Host ""
    Write-Host "── git show --name-only --format= HEAD ──" -ForegroundColor Cyan
    git show --name-only --format= HEAD

    Write-Host ""
    Write-Host "── 检查要求 ──" -ForegroundColor Cyan
    $files = git show --name-only --format= HEAD
    $checks = @(
        @{ Name = "Markdown 已提交"; Test = ($files -match "\.md$") },
        @{ Name = "architecture.webp 已提交"; Test = ($files -match "architecture\.webp") },
        @{ Name = "flow.webp 已提交"; Test = ($files -match "flow\.webp") },
        @{ Name = "不含 note.md 源文件（相对路径应重写）"; Test = (-not ($files -match "note\.md$")) }
    )
    $allPass = $true
    foreach ($c in $checks) {
        if ($c.Test) {
            Write-Host "  [PASS] $($c.Name)" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] $($c.Name)" -ForegroundColor Red
            $allPass = $false
        }
    }

    Set-Location $projectRoot
    Write-Host ""
    if ($allPass) {
        Write-Host "Smoke Test 验证通过。可安全删除测试仓库：Remove-Item -Recurse -Force '$repo'" -ForegroundColor Green
    } else {
        Write-Host "Smoke Test 验证失败，请检查提交内容。" -ForegroundColor Red
    }
}
