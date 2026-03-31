Param(
    [string]$SourceBranch = "main",
    [string]$TargetBranch = "restore/skeleton",
    [string]$Remote = "origin",
    [switch]$UseCurrentBranch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $repoRoot

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
