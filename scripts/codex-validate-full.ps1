[CmdletBinding()]
param(
    [ValidateSet('all', 'backend', 'frontend')]
    [string]$Target = 'all',
    [switch]$IncludeLiveAcceptance,
    [switch]$StrictGlobalTypes,
    [string]$TargetRoot,
    [switch]$Sequential,
    [string]$Remote = 'origin',
    [string]$BaseRef,
    [switch]$SkipFetch,
    [switch]$RequireSynced,
    [string]$SummaryPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$reportDir = Join-Path $repoRoot 'harness\reports\smoke'
$summaryPath = if ([string]::IsNullOrWhiteSpace($SummaryPath)) {
    Join-Path $reportDir 'latest-full-gate.md'
} else {
    $reportRoot = [System.IO.Path]::GetFullPath($reportDir).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $reportRootWithSeparator = $reportRoot + [System.IO.Path]::DirectorySeparatorChar
    $summaryCandidate = [System.IO.Path]::GetFullPath($SummaryPath)
    if (-not $summaryCandidate.StartsWith($reportRootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "SummaryPath must stay under $reportRoot"
    }
    $summaryCandidate
}
$backendScript = Join-Path $PSScriptRoot 'codex-test-backend.ps1'
$frontendScript = Join-Path $PSScriptRoot 'codex-test-frontend.ps1'
$startedAt = Get-Date
$script:LastStepAt = $startedAt
$script:ResolvedBaseRef = ''
$script:ResolvedBaseSha = ''
$script:ResolvedHeadSha = ''

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $summaryPath) -Force | Out-Null
Set-Location -LiteralPath $repoRoot

$steps = [System.Collections.Generic.List[string]]::new()

function Format-StepDuration {
    param(
        [TimeSpan]$Duration
    )

    if ($Duration.TotalSeconds -lt 1) {
        return ('{0}ms' -f [Math]::Round($Duration.TotalMilliseconds))
    }
    return ('{0:n1}s' -f $Duration.TotalSeconds)
}

function Add-StepResult {
    param(
        [string]$Label,
        [string]$Status,
        [string]$Details = '',
        [Nullable[TimeSpan]]$Duration = $null
    )

    $durationValue = if ($null -ne $Duration) {
        $Duration
    } else {
        $now = Get-Date
        $elapsed = $now - $script:LastStepAt
        $script:LastStepAt = $now
        $elapsed
    }
    $durationText = Format-StepDuration -Duration $durationValue
    [void]$steps.Add("- [$Status] $Label (duration=$durationText)")
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        [void]$steps.Add("  $Details")
    }
}

function Invoke-GitCapture {
    param([string[]]$Arguments)

    $output = & git @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = @($output | ForEach-Object { [string]$_ })
    }
}

function Invoke-GitStrict {
    param([string[]]$Arguments)

    $result = Invoke-GitCapture -Arguments $Arguments
    if ($result.ExitCode -ne 0) {
        $message = ($result.Output -join "`n").Trim()
        if ([string]::IsNullOrWhiteSpace($message)) {
            $message = "git $($Arguments -join ' ') failed with exit code $($result.ExitCode)"
        }
        throw $message
    }
    return @($result.Output)
}

function Get-GitLines {
    param([string[]]$Arguments)

    $result = Invoke-GitCapture -Arguments $Arguments
    if ($result.ExitCode -ne 0) {
        throw (($result.Output -join "`n").Trim())
    }
    return @(
        $result.Output |
            ForEach-Object { [string]$_ } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            ForEach-Object { $_.Trim().Replace('\', '/') }
    )
}

function Initialize-GitContext {
    if (-not $SkipFetch) {
        Invoke-GitStrict -Arguments @('fetch', $Remote) | Out-Null
        Add-StepResult -Label 'git fetch' -Status 'ok' -Details "remote=$Remote"
    } else {
        Add-StepResult -Label 'git fetch' -Status 'skip' -Details 'skipped by caller'
    }

    $headSha = @(Get-GitLines -Arguments @('rev-parse', 'HEAD'))
    if ($headSha.Count -gt 0) {
        $script:ResolvedHeadSha = $headSha[0]
    }

    if ([string]::IsNullOrWhiteSpace($BaseRef)) {
        $branch = @(Get-GitLines -Arguments @('rev-parse', '--abbrev-ref', 'HEAD'))
        if ($branch.Count -gt 0 -and $branch[0] -ne 'HEAD') {
            $script:ResolvedBaseRef = "$Remote/$($branch[0])"
        }
    } else {
        $script:ResolvedBaseRef = $BaseRef
    }

    if ([string]::IsNullOrWhiteSpace($script:ResolvedBaseRef)) {
        Add-StepResult -Label 'ahead/behind' -Status 'skip' -Details 'no base ref resolved'
        return
    }

    $baseSha = @(Get-GitLines -Arguments @('rev-parse', '--verify', $script:ResolvedBaseRef))
    if ($baseSha.Count -eq 0) {
        throw "Cannot resolve base ref $script:ResolvedBaseRef"
    }
    $script:ResolvedBaseSha = $baseSha[0]

    $counts = @(Get-GitLines -Arguments @('rev-list', '--left-right', '--count', "$script:ResolvedBaseRef...HEAD"))
    if ($counts.Count -gt 0) {
        $parts = $counts[0].Split("`t", [System.StringSplitOptions]::RemoveEmptyEntries)
        if ($parts.Count -eq 1) {
            $parts = $counts[0].Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)
        }
        if ($parts.Count -eq 2) {
            $behind = [int]$parts[0]
            $ahead = [int]$parts[1]
            Add-StepResult -Label 'ahead/behind' -Status 'ok' -Details "behind=$behind ahead=$ahead base=$script:ResolvedBaseRef"
            if ($behind -ne 0) {
                throw "Branch is behind $script:ResolvedBaseRef by $behind commit(s)."
            }
            if ($RequireSynced -and $ahead -ne 0) {
                throw "Branch is ahead of $script:ResolvedBaseRef by $ahead commit(s)."
            }
            return
        }
    }

    Add-StepResult -Label 'ahead/behind' -Status 'skip' -Details "unable to parse ahead/behind for $script:ResolvedBaseRef"
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
        ('- elapsed_seconds: ' + [Math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)),
        ('- remote: ' + $Remote),
        ('- base_ref: ' + $(if ([string]::IsNullOrWhiteSpace($script:ResolvedBaseRef)) { '<none>' } else { $script:ResolvedBaseRef })),
        ('- skip_fetch: ' + $SkipFetch.IsPresent),
        ('- require_synced: ' + $RequireSynced.IsPresent),
        ('- include_live_acceptance: ' + $IncludeLiveAcceptance.IsPresent),
        ('- strict_global_types: ' + $StrictGlobalTypes.IsPresent),
        ('- sequential: ' + $Sequential.IsPresent),
        ('- head_sha: ' + $(if ([string]::IsNullOrWhiteSpace($script:ResolvedHeadSha)) { '<none>' } else { $script:ResolvedHeadSha })),
        ('- base_sha: ' + $(if ([string]::IsNullOrWhiteSpace($script:ResolvedBaseSha)) { '<none>' } else { $script:ResolvedBaseSha })),
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
    Initialize-GitContext

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
        $parallelStartedAt = Get-Date
        $jobs = @(
            (Start-ValidationJob -Name 'codex-full-backend' -ScriptPath $backendScript),
            (Start-ValidationJob -Name 'codex-full-frontend' -ScriptPath $frontendScript -Arguments (Get-FrontendArguments))
        )

        Wait-Job -Job $jobs | Out-Null
        $parallelDuration = (Get-Date) - $parallelStartedAt
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

        Add-StepResult -Label 'backend fixed entry' -Status 'ok' -Details 'see harness/reports/smoke/latest-backend.txt' -Duration $parallelDuration
        Add-StepResult -Label 'frontend fixed entry' -Status 'ok' -Details 'see frontend reports under harness/reports/smoke' -Duration $parallelDuration
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
