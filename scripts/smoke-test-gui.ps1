# Davinci Journey - real Tauri GUI smoke test helper.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\smoke-test-gui.ps1 -Setup
#   powershell -ExecutionPolicy Bypass -File scripts\smoke-test-gui.ps1 -Verify -ManifestPath <manifest>
#   powershell -ExecutionPolicy Bypass -File scripts\smoke-test-gui.ps1 -Cleanup -ManifestPath <manifest>
#
# Setup creates two separated locations:
#   Source directory: a non-git directory that contains fixture note.md and images.
#   Target repository: a temporary git repository with the minimal site structure.

param(
    [switch]$Setup,
    [switch]$Verify,
    [switch]$Cleanup,
    [string]$ManifestPath
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

if (-not $Setup -and -not $Verify -and -not $Cleanup) {
    $Setup = $true
}

function Get-Sha256([string]$Path) {
    (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Assert-ExactSmokePath([string]$Path, [string]$Prefix) {
    $resolved = [System.IO.Path]::GetFullPath($Path)
    $temp = [System.IO.Path]::GetFullPath($env:TEMP)
    if (-not $resolved.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean non-TEMP path: $resolved"
    }
    if ([System.IO.Path]::GetFileName($resolved) -notlike "$Prefix*") {
        throw "Refusing to clean path not created by this script: $resolved"
    }
    return $resolved
}

function Read-SmokeManifest {
    if (-not $ManifestPath) {
        throw "Missing -ManifestPath."
    }
    if (-not (Test-Path -LiteralPath $ManifestPath)) {
        throw "Smoke manifest not found: $ManifestPath"
    }
    Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestPath | ConvertFrom-Json
}

if ($Setup) {
    $id = [guid]::NewGuid().ToString("N")
    $sourceDir = Join-Path $env:TEMP "davinci-smoke-source-$id"
    $targetRepo = Join-Path $env:TEMP "davinci-smoke-repository-$id"
    $manifest = Join-Path $env:TEMP "davinci-smoke-manifest-$id.json"
    $fixture = Join-Path $projectRoot "fixtures\publish\valid-note"

    New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null
    New-Item -ItemType Directory -Path $targetRepo -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $fixture "note.md") -Destination $sourceDir
    Copy-Item -LiteralPath (Join-Path $fixture "images") -Destination $sourceDir -Recurse

    git -C $targetRepo init | Out-Null
    git -C $targetRepo config user.name "Davinci Smoke Test"
    git -C $targetRepo config user.email "smoke@example.invalid"

    New-Item -ItemType Directory -Path (Join-Path $targetRepo "content\ai-agent\langgraph") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $targetRepo "public\assets\notes") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $targetRepo "config") -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot "config\archive-profiles.yml") -Destination (Join-Path $targetRepo "config\archive-profiles.yml")
    "# Smoke Test Repo" | Out-File -Encoding utf8 -LiteralPath (Join-Path $targetRepo "README.md")

    git -C $targetRepo add README.md config/archive-profiles.yml
    git -C $targetRepo commit -m "initial commit" | Out-Null

    $notePath = Join-Path $sourceDir "note.md"
    $sourceHashes = [ordered]@{
        note = Get-Sha256 $notePath
    }
    Get-ChildItem -LiteralPath (Join-Path $sourceDir "images") -File | ForEach-Object {
        $sourceHashes[$_.Name] = Get-Sha256 $_.FullName
    }

    [ordered]@{
        id = $id
        sourceDir = $sourceDir
        targetRepo = $targetRepo
        notePath = $notePath
        sourceHashes = $sourceHashes
        createdAt = (Get-Date).ToString("o")
    } | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 -LiteralPath $manifest

    Write-Host "Source directory:" -ForegroundColor Cyan
    Write-Host $sourceDir -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Target repository:" -ForegroundColor Cyan
    Write-Host $targetRepo -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Source Markdown:" -ForegroundColor Cyan
    Write-Host $notePath -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Smoke manifest:" -ForegroundColor Cyan
    Write-Host $manifest -ForegroundColor Yellow
    Write-Host ""
    Write-Host "GUI flow: select target repo, select note.md, generate workspace, write, diff, stage, commit." -ForegroundColor Cyan
    exit 0
}

if ($Verify) {
    $m = Read-SmokeManifest
    $sourceDir = [string]$m.sourceDir
    $targetRepo = [string]$m.targetRepo
    $notePath = [string]$m.notePath

    Write-Host "Source directory: $sourceDir" -ForegroundColor Cyan
    Write-Host "Target repository: $targetRepo" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "-- target git status --short --" -ForegroundColor Cyan
    git -C $targetRepo status --short
    Write-Host ""
    Write-Host "-- target git log -1 --oneline --" -ForegroundColor Cyan
    git -C $targetRepo log -1 --oneline
    Write-Host ""
    Write-Host "-- target HEAD files --" -ForegroundColor Cyan
    $files = git -C $targetRepo show --name-only --format= HEAD
    $files

    $checks = @()
    $checks += @{ Name = "target commit contains markdown"; Pass = [bool]($files -match "^content/.+\.md$") }
    $checks += @{ Name = "target commit contains architecture.webp"; Pass = [bool]($files -match "architecture.*\.webp$") }
    $checks += @{ Name = "target commit contains flow.webp"; Pass = [bool]($files -match "flow.*\.webp$") }
    $checks += @{ Name = "source directory is not a git repo"; Pass = -not (Test-Path -LiteralPath (Join-Path $sourceDir ".git")) }
    $checks += @{ Name = "source markdown remains"; Pass = Test-Path -LiteralPath $notePath }
    $checks += @{ Name = "source directory has no publish workspace"; Pass = -not (Test-Path -LiteralPath (Join-Path $sourceDir ".publish-workspaces")) }
    $checks += @{ Name = "dev repo has no fixture output"; Pass = -not (Test-Path -LiteralPath (Join-Path $projectRoot "content\ai-agent\langgraph\langgraph-checkpoint.md")) }

    foreach ($key in $m.sourceHashes.PSObject.Properties.Name) {
        $path = if ($key -eq "note") { $notePath } else { Join-Path (Join-Path $sourceDir "images") $key }
        $checks += @{ Name = "source hash unchanged: $key"; Pass = ((Get-Sha256 $path) -eq $m.sourceHashes.$key) }
    }

    $allPass = $true
    foreach ($check in $checks) {
        if ($check.Pass) {
            Write-Host "[PASS] $($check.Name)" -ForegroundColor Green
        } else {
            Write-Host "[FAIL] $($check.Name)" -ForegroundColor Red
            $allPass = $false
        }
    }

    if (-not $allPass) {
        exit 1
    }
    exit 0
}

if ($Cleanup) {
    $m = Read-SmokeManifest
    $sourceDir = Assert-ExactSmokePath ([string]$m.sourceDir) "davinci-smoke-source-"
    $targetRepo = Assert-ExactSmokePath ([string]$m.targetRepo) "davinci-smoke-repository-"
    $manifest = Assert-ExactSmokePath $ManifestPath "davinci-smoke-manifest-"

    if (Test-Path -LiteralPath $sourceDir) {
        Remove-Item -LiteralPath $sourceDir -Recurse -Force
    }
    if (Test-Path -LiteralPath $targetRepo) {
        Remove-Item -LiteralPath $targetRepo -Recurse -Force
    }
    if (Test-Path -LiteralPath $manifest) {
        Remove-Item -LiteralPath $manifest -Force
    }
    Write-Host "Smoke test paths cleaned." -ForegroundColor Green
}
