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

git -c http.proxy= -c https.proxy= -c http.sslVerify=true push -u $Remote $refSpec
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    Write-Host "Push command failed with exit code $exitCode." -ForegroundColor Yellow
    Write-Host "If you see proxy errors, the script already clears proxy variables."
    Write-Host "If you still see credential errors, run:"
    Write-Host "  git -c http.proxy= -c https.proxy= -c credential.helper=manager-core push -u $Remote $refSpec"
    Write-Host "or log in to GitHub and retry this script."
    exit $exitCode
}

Write-Host "Push completed." -ForegroundColor Green
