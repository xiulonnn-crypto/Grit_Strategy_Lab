[CmdletBinding()]
param(
    [ValidateSet('all', 'backend', 'frontend')]
    [string]$Target = 'all',
    [switch]$IncludeLiveAcceptance,
    [switch]$StrictGlobalTypes,
    [string]$TargetRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$reportDir = Join-Path $repoRoot 'harness\reports\smoke'
$summaryPath = Join-Path $reportDir 'latest-smoke-summary.md'
$resolvedTargetRoot = if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.tmp\codex-fixture'))
} else {
    [System.IO.Path]::GetFullPath($TargetRoot)
}

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null

$steps = New-Object System.Collections.Generic.List[string]
$startedAt = Get-Date

function Add-StepResult {
    param(
        [string]$Label,
        [string]$Status,
        [string]$Details
    )

    $steps.Add("- [$Status] $Label")
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        $steps.Add("  $Details")
    }
}

try {
    if ($IncludeLiveAcceptance) {
        $fixtureDbPath = & (Join-Path $PSScriptRoot 'codex-reset-fixture.ps1') -TargetRoot $resolvedTargetRoot
        $fixtureDbPath = ($fixtureDbPath | Select-Object -Last 1).Trim()
        Add-StepResult -Label 'reset fixture' -Status 'ok' -Details ("staged at " + $fixtureDbPath)
    } else {
        Add-StepResult -Label 'reset fixture' -Status 'skip' -Details 'skipped because live acceptance was not requested'
    }

    if ($Target -in @('all', 'backend')) {
        & (Join-Path $PSScriptRoot 'codex-test-backend.ps1')
        Add-StepResult -Label 'backend fixed entry' -Status 'ok' -Details 'see harness/reports/smoke/latest-backend.txt'
    }

    if ($Target -in @('all', 'frontend')) {
        $frontendArgs = @{}
        if ($StrictGlobalTypes) {
            $frontendArgs.StrictGlobalTypes = $true
        }
        if ($IncludeLiveAcceptance) {
            $frontendArgs.IncludeLiveAcceptance = $true
            $frontendArgs.TargetRoot = $resolvedTargetRoot
        }
        & (Join-Path $PSScriptRoot 'codex-test-frontend.ps1') @frontendArgs
        $frontendDetail = if ($IncludeLiveAcceptance) {
            'see latest-frontend-focused.txt, latest-frontend-global-types.txt, and latest-live-acceptance.txt'
        } else {
            'see latest-frontend-focused.txt and latest-frontend-global-types.txt'
        }
        Add-StepResult -Label 'frontend fixed entry' -Status 'ok' -Details $frontendDetail
    }

    $finishedAt = Get-Date
    $summaryLines = @(
        '# Codex Smoke Summary',
        '',
        ('- target: ' + $Target),
        ('- started_at: ' + $startedAt.ToString('o')),
        ('- finished_at: ' + $finishedAt.ToString('o')),
        ('- include_live_acceptance: ' + $IncludeLiveAcceptance.IsPresent),
        ('- strict_global_types: ' + $StrictGlobalTypes.IsPresent),
        ('- target_root: ' + $resolvedTargetRoot),
        ''
    ) + [string[]]$steps
    $summaryLines | Set-Content -LiteralPath $summaryPath -Encoding utf8
} catch {
    $failedAt = Get-Date
    $failureLines = @(
        '# Codex Smoke Summary',
        '',
        ('- target: ' + $Target),
        ('- started_at: ' + $startedAt.ToString('o')),
        ('- finished_at: ' + $failedAt.ToString('o')),
        ('- include_live_acceptance: ' + $IncludeLiveAcceptance.IsPresent),
        ('- strict_global_types: ' + $StrictGlobalTypes.IsPresent),
        ('- target_root: ' + $resolvedTargetRoot),
        ''
    ) + [string[]]$steps + @(
        '- [failed] smoke orchestration',
        ('  ' + $_.Exception.Message)
    )
    $failureLines | Set-Content -LiteralPath $summaryPath -Encoding utf8
    throw
}
