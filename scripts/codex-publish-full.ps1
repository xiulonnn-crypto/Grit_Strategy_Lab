[CmdletBinding()]
param(
    [string]$Remote = 'origin',
    [string]$TargetBranch,
    [string]$CommitMessage,
    [switch]$SkipCommit,
    [switch]$SkipPush,
    [switch]$ConfirmExternalPush,
    [switch]$AllowTraceCandidates,
    [switch]$PlanOnly,
    [ValidateSet('all', 'backend', 'frontend')]
    [string]$Target = 'all',
    [switch]$IncludeLiveAcceptance,
    [switch]$StrictGlobalTypes,
    [string]$TargetRoot,
    [switch]$Sequential,
    [switch]$SkipFetch,
    [switch]$RequireSynced,
    [int]$MaxMetadataAttempts = 2
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fullScript = Join-Path $repoRoot 'scripts\codex-validate-full.ps1'
$attestationPath = Join-Path $repoRoot 'harness\reports\smoke\latest-full-push-attestation.md'
$managedMetadataFiles = @(
    'CHANGELOG.md',
    'src/grit_backtest_platform/_version.py'
)

Set-Location -LiteralPath $repoRoot

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

function Get-CurrentBranch {
    $branch = (Invoke-GitStrict -Arguments @('rev-parse', '--abbrev-ref', 'HEAD') | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($branch) -or $branch.Trim() -eq 'HEAD') {
        throw 'Cannot resolve the current branch. Pass -TargetBranch explicitly from a named branch.'
    }
    return $branch.Trim()
}

function Get-RemoteUrl {
    $result = Invoke-GitCapture -Arguments @('remote', 'get-url', $Remote)
    if ($result.ExitCode -ne 0) {
        return '<unresolved>'
    }
    return (($result.Output | Select-Object -First 1) -as [string]).Trim()
}

function Get-RemoteBaseRef {
    if ($TargetBranch.StartsWith('refs/heads/')) {
        return "$Remote/$($TargetBranch.Substring(11))"
    }
    return "$Remote/$TargetBranch"
}

function Get-StagedPaths {
    return @(Get-GitLines -Arguments @('diff', '--cached', '--name-only'))
}

function Get-StatusPaths {
    $result = Invoke-GitCapture -Arguments @('status', '--porcelain')
    if ($result.ExitCode -ne 0) {
        throw (($result.Output -join "`n").Trim())
    }
    $lines = @($result.Output | ForEach-Object { [string]$_ })
    $paths = foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        if ($line.Length -lt 4) {
            continue
        }
        $path = $line.Substring(3).Trim()
        if ($path.Contains(' -> ')) {
            $path = ($path -split ' -> ')[-1]
        }
        $path.Replace('\', '/')
    }
    return @($paths)
}

function Assert-NoUnstagedOrUntracked {
    [string[]]$unstaged = @(Get-GitLines -Arguments @('diff', '--name-only'))
    [string[]]$untracked = @(Get-GitLines -Arguments @('ls-files', '--others', '--exclude-standard'))
    if ($unstaged.Count -eq 0 -and $untracked.Count -eq 0) {
        return
    }

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('codex-publish-full requires all intended publish files to be staged before the release validation commit.')
    $lines.Add('This keeps the full gate attached to the exact commit that will be pushed.')
    if ($unstaged.Count -gt 0) {
        $lines.Add('Unstaged tracked files:')
        foreach ($path in $unstaged) {
            $lines.Add("  - $path")
        }
    }
    if ($untracked.Count -gt 0) {
        $lines.Add('Untracked files:')
        foreach ($path in $untracked) {
            $lines.Add("  - $path")
        }
    }
    throw ($lines -join "`n")
}

function Invoke-StagedWhitespaceCheck {
    param([string[]]$Paths)

    if ($Paths.Count -eq 0) {
        Write-Host 'No staged paths for whitespace check.' -ForegroundColor Yellow
        return
    }
    Invoke-GitStrict -Arguments (@('diff', '--cached', '--check', '--') + $Paths) | Out-Null
    Write-Host "Staged whitespace check passed for $($Paths.Count) paths." -ForegroundColor Green
}

function Get-StagedBlobText {
    param([string]$Path)

    $result = Invoke-GitCapture -Arguments @('show', ":$Path")
    if ($result.ExitCode -ne 0) {
        throw "Cannot read staged blob for $Path"
    }
    return ($result.Output -join "`n")
}

function Assert-TraceMatricesClosed {
    param([string[]]$Paths)

    [string[]]$tracePaths = @(
        $Paths |
            Where-Object { $_ -like 'output/ui-artifact-trace/*/trace-matrix.md' }
    )
    if ($tracePaths.Count -eq 0) {
        return
    }

    $openRows = [System.Collections.Generic.List[string]]::new()
    foreach ($path in $tracePaths) {
        $content = Get-StagedBlobText -Path $path
        foreach ($match in [regex]::Matches($content, '\|\s*(FAIL|BLOCKED|NOT_CHECKED)\s*\|')) {
            $openRows.Add("$path => $($match.Groups[1].Value)")
        }
    }

    if ($openRows.Count -eq 0) {
        Write-Host "Trace Matrix closure check passed for $($tracePaths.Count) files." -ForegroundColor Green
        return
    }

    if ($AllowTraceCandidates) {
        Write-Warning "Trace Matrix candidate rows are present; continuing because -AllowTraceCandidates was supplied."
        foreach ($row in $openRows) {
            Write-Warning "  $row"
        }
        return
    }

    throw (
        "Trace Matrix files contain FAIL/BLOCKED/NOT_CHECKED rows. " +
        "Fix them or rerun with -AllowTraceCandidates for an explicit acceptance-candidate full push.`n" +
        ($openRows -join "`n")
    )
}

function Test-HighSignalExternalPath {
    param([string]$Path)

    $lower = $Path.ToLowerInvariant()
    if ($lower.StartsWith('output/ui-artifact-trace/')) {
        return $true
    }
    if ($lower -match '(^|/)id-translation\.csv$') {
        return $true
    }
    if ($lower -match '(token|secret|credential|apikey|api_key|password)') {
        return $true
    }
    if ($lower -match '\.(csv|tsv|xlsx|xls|db|sqlite|sqlite3|png|jpg|jpeg|json)$') {
        return $true
    }
    return $false
}

function Write-ExternalPushSummary {
    param(
        [string[]]$Paths,
        [string]$RemoteUrl
    )

    [string[]]$highSignalPaths = @($Paths | Where-Object { Test-HighSignalExternalPath -Path $_ })
    Write-Host "Publish target: $Remote HEAD:$TargetBranch" -ForegroundColor Cyan
    Write-Host "Remote URL: $RemoteUrl" -ForegroundColor Cyan
    Write-Host "Full validation target: $Target" -ForegroundColor Cyan
    Write-Host "Staged path count: $($Paths.Count)" -ForegroundColor Cyan
    Write-Host "High-signal external path count: $($highSignalPaths.Count)" -ForegroundColor Cyan
    foreach ($path in ($highSignalPaths | Select-Object -First 30)) {
        Write-Host "  - $path" -ForegroundColor Yellow
    }
    if ($highSignalPaths.Count -gt 30) {
        Write-Host "  ... $($highSignalPaths.Count - 30) more" -ForegroundColor Yellow
    }
    return $highSignalPaths
}

function Invoke-FullGate {
    $baseRef = Get-RemoteBaseRef
    $arguments = @(
        '-ExecutionPolicy', 'Bypass',
        '-File', $fullScript,
        '-Target', $Target,
        '-Remote', $Remote,
        '-BaseRef', $baseRef
    )
    if ($IncludeLiveAcceptance) {
        $arguments += '-IncludeLiveAcceptance'
    }
    if ($StrictGlobalTypes) {
        $arguments += '-StrictGlobalTypes'
    }
    if (-not [string]::IsNullOrWhiteSpace($TargetRoot)) {
        $arguments += @('-TargetRoot', $TargetRoot)
    }
    if ($Sequential) {
        $arguments += '-Sequential'
    }
    if ($SkipFetch) {
        $arguments += '-SkipFetch'
    }
    if ($RequireSynced) {
        $arguments += '-RequireSynced'
    }

    Write-Host "Running full gate for target=$Target base=$baseRef." -ForegroundColor Cyan
    & powershell @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Full gate failed with exit code $LASTEXITCODE"
    }
}

function Test-ManagedMetadataDirty {
    $lines = Get-GitLines -Arguments (@('status', '--porcelain', '--') + $managedMetadataFiles)
    return $lines.Count -gt 0
}

function Assert-OnlyManagedMetadataDirty {
    [string[]]$dirtyPaths = @(Get-StatusPaths)
    $allowed = @{}
    foreach ($path in $managedMetadataFiles) {
        $allowed[$path] = $true
    }

    [string[]]$unexpected = @($dirtyPaths | Where-Object { -not $allowed.ContainsKey($_) })
    if ($unexpected.Count -gt 0) {
        throw "Push produced unexpected dirty files:`n$($unexpected -join "`n")"
    }
}

function Get-SuggestedMetadataCommitMessage {
    param([string[]]$Output)

    foreach ($line in $Output) {
        if ($line -match 'suggested commit message:\s*(.+)$') {
            return $Matches[1].Trim()
        }
    }
    return 'docs(changelog): snapshot generated push metadata'
}

function Invoke-MetadataSnapshotCommit {
    param([string]$Message)

    Assert-OnlyManagedMetadataDirty
    Invoke-GitStrict -Arguments (@('diff', '--check', '--') + $managedMetadataFiles) | Out-Null
    Invoke-GitStrict -Arguments (@('add', '--') + $managedMetadataFiles) | Out-Null
    Invoke-GitStrict -Arguments @('commit', '-m', $Message) | ForEach-Object { Write-Host $_ }
}

function Get-GateField {
    param([string]$Name)

    $summaryPath = Join-Path $repoRoot 'harness\reports\smoke\latest-full-gate.md'
    if (-not (Test-Path -LiteralPath $summaryPath)) {
        return '<missing>'
    }
    $pattern = '^- ' + [regex]::Escape($Name) + ':\s+(.*)$'
    foreach ($line in Get-Content -LiteralPath $summaryPath -Encoding utf8) {
        if ($line -match $pattern) {
            return $Matches[1].Trim()
        }
    }
    return '<missing>'
}

function Write-PushAttestation {
    param(
        [string]$PushedHead,
        [int]$MetadataAttempts
    )

    $parent = Split-Path -Parent $attestationPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $lines = @(
        '# Codex Full Publish',
        '',
        '- status: pushed',
        ('- pushed_at: ' + (Get-Date).ToString('o')),
        ('- remote: ' + $Remote),
        ('- target_branch: ' + $TargetBranch),
        ('- pushed_head: ' + $PushedHead),
        ('- full_target: ' + (Get-GateField -Name 'target')),
        ('- full_head_sha: ' + (Get-GateField -Name 'head_sha')),
        ('- full_base_sha: ' + (Get-GateField -Name 'base_sha')),
        ('- full_elapsed_seconds: ' + (Get-GateField -Name 'elapsed_seconds')),
        ('- include_live_acceptance: ' + (Get-GateField -Name 'include_live_acceptance')),
        ('- strict_global_types: ' + (Get-GateField -Name 'strict_global_types')),
        ('- metadata_attempts: ' + $MetadataAttempts)
    )
    $lines | Set-Content -LiteralPath $attestationPath -Encoding utf8
    Write-Host "Wrote full push attestation: $attestationPath" -ForegroundColor Green
}

function Invoke-PushWithMetadataLoop {
    $metadataAttempts = 0
    while ($true) {
        $pushResult = Invoke-GitCapture -Arguments @('push', $Remote, "HEAD:$TargetBranch")
        foreach ($line in $pushResult.Output) {
            Write-Host $line
        }
        if ($pushResult.ExitCode -eq 0) {
            $pushedHead = (Invoke-GitStrict -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
            Write-PushAttestation -PushedHead $pushedHead -MetadataAttempts $metadataAttempts
            return
        }

        if (-not (Test-ManagedMetadataDirty)) {
            throw "git push failed with exit code $($pushResult.ExitCode), and no generated metadata diff was found."
        }
        if ($metadataAttempts -ge $MaxMetadataAttempts) {
            throw "git push still generates metadata after $metadataAttempts metadata attempts."
        }

        $metadataAttempts += 1
        $message = Get-SuggestedMetadataCommitMessage -Output $pushResult.Output
        Write-Host "Committing generated push metadata: $message" -ForegroundColor Yellow
        Invoke-MetadataSnapshotCommit -Message $message
        Write-Host 'Refreshing full evidence after metadata snapshot.' -ForegroundColor Cyan
        Invoke-FullGate
    }
}

if (-not (Test-Path -LiteralPath $fullScript)) {
    throw "Full validation script is missing: $fullScript"
}

if ([string]::IsNullOrWhiteSpace($TargetBranch)) {
    $TargetBranch = Get-CurrentBranch
}

[string[]]$stagedPaths = @(Get-StagedPaths)
$remoteUrl = Get-RemoteUrl

if (-not $SkipPush -and $Target -ne 'all') {
    throw 'codex-publish-full only pushes after -Target all. Use -SkipPush for backend/frontend-only validation.'
}

if ($SkipCommit) {
    if ($stagedPaths.Count -gt 0) {
        throw 'SkipCommit requires an empty index. Commit or unstage pending changes before publishing existing commits.'
    }
    Assert-NoUnstagedOrUntracked
} else {
    if ($stagedPaths.Count -eq 0 -and -not $PlanOnly) {
        throw 'No staged files found. Stage the exact publish set before running codex-publish-full.'
    }
    if ([string]::IsNullOrWhiteSpace($CommitMessage) -and -not $PlanOnly) {
        throw 'CommitMessage is required unless -SkipCommit or -PlanOnly is supplied.'
    }
    Assert-NoUnstagedOrUntracked
}

if ($stagedPaths.Count -gt 0) {
    Invoke-StagedWhitespaceCheck -Paths $stagedPaths
    Assert-TraceMatricesClosed -Paths $stagedPaths
}

[string[]]$highSignalPaths = @(Write-ExternalPushSummary -Paths $stagedPaths -RemoteUrl $remoteUrl)
if (-not $SkipPush -and $highSignalPaths.Count -gt 0 -and -not $ConfirmExternalPush) {
    throw 'High-signal files would be pushed to an external remote. Review the summary and rerun with -ConfirmExternalPush to proceed.'
}

if ($PlanOnly) {
    Write-Host 'PlanOnly complete; no full validation, commit, or push was run.' -ForegroundColor Cyan
    exit 0
}

if (-not $SkipCommit) {
    Invoke-GitStrict -Arguments @('commit', '-m', $CommitMessage) | ForEach-Object { Write-Host $_ }
}

Invoke-FullGate

if ($SkipPush) {
    Write-Host 'SkipPush supplied; commit/full-validation flow complete without pushing.' -ForegroundColor Cyan
    exit 0
}

Invoke-PushWithMetadataLoop
