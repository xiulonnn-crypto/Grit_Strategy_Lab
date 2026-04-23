[CmdletBinding()]
param(
    [string]$TargetRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceRoot = Join-Path $repoRoot 'harness\fixtures\seed_workspace'
$resolvedTargetRoot = if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.tmp\codex-fixture'))
} else {
    [System.IO.Path]::GetFullPath($TargetRoot)
}
$reportDir = Join-Path $repoRoot 'harness\reports\smoke'
$reportPath = Join-Path $reportDir 'latest-reset-fixture.txt'

function Assert-PathWithinRepo {
    param(
        [string]$PathToCheck
    )

    $normalizedRepoRoot = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\')
    $normalizedTarget = [System.IO.Path]::GetFullPath($PathToCheck).TrimEnd('\')
    if (-not $normalizedTarget.StartsWith($normalizedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside the repository root: $normalizedTarget"
    }
}

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null

$sourceWorkspaceDb = Join-Path $sourceRoot 'seed_workspace.sqlite3'
$sourceMarketDb = Join-Path $sourceRoot 'seed_workspace_market_data.sqlite3'
$sourceManifest = Join-Path $sourceRoot 'manifest.json'

foreach ($requiredPath in @($sourceWorkspaceDb, $sourceMarketDb, $sourceManifest)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Seed fixture asset is missing: $requiredPath"
    }
}

Assert-PathWithinRepo -PathToCheck $resolvedTargetRoot

if (Test-Path -LiteralPath $resolvedTargetRoot) {
    Remove-Item -LiteralPath $resolvedTargetRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $resolvedTargetRoot -Force | Out-Null

$targetWorkspaceDb = Join-Path $resolvedTargetRoot 'seed_workspace.sqlite3'
$targetMarketDb = Join-Path $resolvedTargetRoot 'seed_workspace_market_data.sqlite3'
$targetManifest = Join-Path $resolvedTargetRoot 'manifest.json'

Copy-Item -LiteralPath $sourceWorkspaceDb -Destination $targetWorkspaceDb -Force
Copy-Item -LiteralPath $sourceMarketDb -Destination $targetMarketDb -Force
Copy-Item -LiteralPath $sourceManifest -Destination $targetManifest -Force

$manifest = Get-Content -Raw -LiteralPath $targetManifest | ConvertFrom-Json
$report = @(
    '# Codex Fixture Reset'
    "reset_at = $(Get-Date -Format o)"
    "source_root = $sourceRoot"
    "target_root = $resolvedTargetRoot"
    "workspace_db = $targetWorkspaceDb"
    "market_data_db = $targetMarketDb"
    "manifest = $targetManifest"
    "creation_session_id = $($manifest.creation_session_id)"
    "strategy_id = $($manifest.strategy_id)"
    "optimization_strategy_id = $($manifest.optimization_strategy_id)"
    "run_id = $($manifest.run_id)"
    "optimization_job_id = $($manifest.optimization_job_id)"
)
$report | Set-Content -LiteralPath $reportPath -Encoding utf8

Write-Output $targetWorkspaceDb
