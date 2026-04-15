Param(
    [string]$SourceBranch = "main",
    [string]$TargetBranch = "restore/skeleton",
    [string]$Remote = "origin",
    [switch]$UseCurrentBranch,
    [switch]$Release,
    [string]$ReleaseVersion,
    [string]$ReleaseDate
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $repoRoot

if ($ReleaseVersion -and -not $Release) {
    throw "ReleaseVersion requires the -Release switch."
}

function Ensure-VersionedPrePushHook {
    $hookPath = Join-Path $repoRoot '.githooks\pre-push'
    if (-not (Test-Path -LiteralPath $hookPath)) {
        throw "Versioned pre-push hook not found at $hookPath"
    }

    $configured = (& git config --local --get core.hooksPath 2>$null)
    if ($LASTEXITCODE -ne 0) {
        $configured = $null
    }
    $configured = [string]$configured
    if ($configured.Trim() -ne '.githooks') {
        & git config --local core.hooksPath .githooks
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to configure core.hooksPath=.githooks"
        }
        Write-Host "Configured versioned git hooks path: .githooks" -ForegroundColor Cyan
    }
}

function Test-ManagedMetadataDirty {
    $managedFiles = @(
        'CHANGELOG.md'
        'src/grit_backtest_platform/_version.py'
    )
    $status = (& git status --porcelain -- $managedFiles)
    return -not [string]::IsNullOrWhiteSpace((($status | Out-String).Trim()))
}

if ($UseCurrentBranch) {
    $current = (git rev-parse --abbrev-ref HEAD).Trim()
    if (-not $current -or $current -eq "HEAD") {
        throw "Cannot resolve current checked-out branch."
    }
    $SourceBranch = $current
}

if (-not ($SourceBranch -and $TargetBranch -and $Remote)) {
    throw "Usage error: SourceBranch, TargetBranch, and Remote are required."
}

Ensure-VersionedPrePushHook

$env:GRIT_CHANGELOG_RELEASE = if ($Release) { '1' } else { '0' }
if ($ReleaseVersion) {
    $env:GRIT_CHANGELOG_RELEASE_VERSION = $ReleaseVersion
} elseif (Test-Path -Path Env:GRIT_CHANGELOG_RELEASE_VERSION) {
    Remove-Item -Path Env:GRIT_CHANGELOG_RELEASE_VERSION
}
if ($ReleaseDate) {
    $env:GRIT_CHANGELOG_RELEASE_DATE = $ReleaseDate
} elseif (Test-Path -Path Env:GRIT_CHANGELOG_RELEASE_DATE) {
    Remove-Item -Path Env:GRIT_CHANGELOG_RELEASE_DATE
}

$proxyEnvVars = @(
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy"
)

foreach ($name in $proxyEnvVars) {
    if (Test-Path -Path "Env:$name") {
        Set-Item -Path "Env:$name" -Value ""
    } else {
        New-Item -Path "Env:$name" -Value "" | Out-Null
    }
}

$refSpec = "${SourceBranch}:${TargetBranch}"
Write-Host "Pushing ${refSpec} to ${Remote} with direct Git transport settings." -ForegroundColor Cyan

function Invoke-GitPush {
    param(
        [string[]]$Arguments
    )

    & git @Arguments
    return $LASTEXITCODE
}

$baseArgs = @(
    "-c", "http.proxy=",
    "-c", "https.proxy=",
    "-c", "http.sslVerify=true",
    "push",
    "-u",
    $Remote,
    $refSpec
)

$first = Invoke-GitPush -Arguments $baseArgs
if ($first -eq 0) {
    Write-Host "Push completed." -ForegroundColor Green
    exit 0
}

if (Test-ManagedMetadataDirty) {
    Write-Host "Push stopped because the versioned pre-push hook updated changelog metadata." -ForegroundColor Yellow
    Write-Host "Commit CHANGELOG/version updates first, then rerun the same push command." -ForegroundColor Yellow
    exit $first
}

Write-Host "Direct transport push failed with exit code $first." -ForegroundColor Yellow
Write-Host "Retrying with manager-core credential helper." -ForegroundColor Cyan

$managerArgs = @(
    "-c", "http.proxy=",
    "-c", "https.proxy=",
    "-c", "credential.helper=manager-core",
    "-c", "http.sslVerify=true",
    "push",
    "-u",
    $Remote,
    $refSpec
)

$second = Invoke-GitPush -Arguments $managerArgs
if ($second -eq 0) {
    Write-Host "Push completed." -ForegroundColor Green
    exit 0
}

Write-Host "Push still failed with exit code $second." -ForegroundColor Yellow
Write-Host "If you still see proxy errors, the script already clears proxy variables."
Write-Host "If you still see credential errors, confirm your GitHub credentials helper is available:"
Write-Host "  git config --global credential.helper manager-core"
Write-Host "Then run: $PSCommandPath again."
exit $second
