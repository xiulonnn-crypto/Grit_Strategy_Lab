[CmdletBinding()]
param(
    [ValidateSet('all', 'backend', 'frontend')]
    [string]$Target = 'all',
    [switch]$IncludeLiveAcceptance,
    [switch]$StrictGlobalTypes,
    [string]$TargetRoot,
    [switch]$Sequential
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$reportDir = Join-Path $repoRoot 'harness\reports\smoke'
$summaryPath = Join-Path $reportDir 'latest-full-gate.md'
$backendScript = Join-Path $PSScriptRoot 'codex-test-backend.ps1'
$frontendScript = Join-Path $PSScriptRoot 'codex-test-frontend.ps1'
$startedAt = Get-Date

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
Set-Location -LiteralPath $repoRoot

$steps = [System.Collections.Generic.List[string]]::new()

function Add-StepResult {
    param(
        [string]$Label,
        [string]$Status,
        [string]$Details = ''
    )

    [void]$steps.Add("- [$Status] $Label")
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        [void]$steps.Add("  $Details")
    }
}

function Write-Summary {
    param(
        [string]$Status,
        [string]$Failure = ''
    )

    $finishedAt = Get-Date
    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in @(
        '# Codex Full Gate',
        '',
        ('- status: ' + $Status),
        ('- target: ' + $Target),
        ('- started_at: ' + $startedAt.ToString('o')),
        ('- finished_at: ' + $finishedAt.ToString('o')),
        ('- include_live_acceptance: ' + $IncludeLiveAcceptance.IsPresent),
        ('- strict_global_types: ' + $StrictGlobalTypes.IsPresent),
        ('- sequential: ' + $Sequential.IsPresent),
        ''
    )) {
        [void]$lines.Add($line)
    }

    [void]$lines.Add('## Steps')
    foreach ($step in $steps) {
        [void]$lines.Add($step)
    }

    if (-not [string]::IsNullOrWhiteSpace($Failure)) {
        [void]$lines.Add('')
        [void]$lines.Add('## Failure')
        [void]$lines.Add($Failure)
    }

    $lines | Set-Content -LiteralPath $summaryPath -Encoding utf8
}

function Get-FrontendArguments {
    $args = [System.Collections.Generic.List[string]]::new()
    if ($StrictGlobalTypes) {
        [void]$args.Add('-StrictGlobalTypes')
    }
    if ($IncludeLiveAcceptance) {
        [void]$args.Add('-IncludeLiveAcceptance')
        if (-not [string]::IsNullOrWhiteSpace($TargetRoot)) {
            [void]$args.Add('-TargetRoot')
            [void]$args.Add($TargetRoot)
        }
    }
    return [string[]]$args
}

function Invoke-BackendFull {
    & $backendScript
}

function Invoke-FrontendFull {
    $frontendArgs = Get-FrontendArguments
    & $frontendScript @frontendArgs
}

function Start-ValidationJob {
    param(
        [string]$Name,
        [string]$ScriptPath,
        [string[]]$Arguments = @()
    )

    return Start-Job -Name $Name -ScriptBlock {
        param(
            [string]$WorkingDirectory,
            [string]$InnerScriptPath,
            [string[]]$InnerArguments
        )
        Set-Location -LiteralPath $WorkingDirectory
        & $InnerScriptPath @InnerArguments
    } -ArgumentList $repoRoot, $ScriptPath, $Arguments
}

try {
    if ($Target -eq 'backend') {
        Invoke-BackendFull
        Add-StepResult -Label 'backend fixed entry' -Status 'ok' -Details 'see harness/reports/smoke/latest-backend.txt'
    } elseif ($Target -eq 'frontend') {
        Invoke-FrontendFull
        Add-StepResult -Label 'frontend fixed entry' -Status 'ok' -Details 'see frontend reports under harness/reports/smoke'
    } elseif ($Sequential) {
        Invoke-BackendFull
        Add-StepResult -Label 'backend fixed entry' -Status 'ok' -Details 'see harness/reports/smoke/latest-backend.txt'
        Invoke-FrontendFull
        Add-StepResult -Label 'frontend fixed entry' -Status 'ok' -Details 'see frontend reports under harness/reports/smoke'
    } else {
        Write-Host 'full-gate: running backend and frontend validation in parallel.' -ForegroundColor Cyan
        $jobs = @(
            (Start-ValidationJob -Name 'codex-full-backend' -ScriptPath $backendScript),
            (Start-ValidationJob -Name 'codex-full-frontend' -ScriptPath $frontendScript -Arguments (Get-FrontendArguments))
        )

        Wait-Job -Job $jobs | Out-Null
        $failedJobs = @()
        foreach ($job in $jobs) {
            Receive-Job -Job $job
            if ($job.State -ne 'Completed') {
                $failedJobs += $job.Name
            }
            Remove-Job -Job $job -Force
        }

        if ($failedJobs.Count -gt 0) {
            throw "Parallel validation failed: $($failedJobs -join ', ')"
        }

        Add-StepResult -Label 'backend fixed entry' -Status 'ok' -Details 'see harness/reports/smoke/latest-backend.txt'
        Add-StepResult -Label 'frontend fixed entry' -Status 'ok' -Details 'see frontend reports under harness/reports/smoke'
    }

    Write-Summary -Status 'ok'
    Write-Host "full-gate: passed. Summary: $summaryPath" -ForegroundColor Green
} catch {
    $message = $_.Exception.Message
    Add-StepResult -Label 'full gate' -Status 'failed' -Details $message
    Write-Summary -Status 'failed' -Failure $message
    Write-Host "full-gate: failed. Summary: $summaryPath" -ForegroundColor Red
    throw
}
