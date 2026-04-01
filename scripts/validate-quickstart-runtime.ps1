[CmdletBinding()]
param(
    [ValidateSet('All', 'DryRun', 'Validate')]
    [string]$Mode = 'All'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcherPath = Join-Path $repoRoot 'QuickStart-Grit.ps1'
$powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$manifestPath = Join-Path $repoRoot '.python-runtime-manifest.json'
$frontendMainEntry = Join-Path $repoRoot 'web\src\main.tsx'
$frontendRuntimeEntry = Join-Path $repoRoot 'web\src\app-runtime.tsx'

function Write-Section {
    param([string]$Title)
    Write-Host ''
    Write-Host $Title -ForegroundColor Cyan
}

function Invoke-LauncherMode {
    param([string]$Name, [string[]]$Arguments)
    try {
        $output = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $launcherPath @Arguments 2>&1
        return [pscustomobject]@{
            Name = $Name
            ExitCode = $LASTEXITCODE
            Output = @($output)
            Succeeded = ($LASTEXITCODE -eq 0)
        }
    } catch {
        return [pscustomobject]@{
            Name = $Name
            ExitCode = 1
            Output = @($_ | Out-String)
            Succeeded = $false
        }
    }
}

function Assert-FrontendEntryChain {
    if (-not (Test-Path -LiteralPath $frontendMainEntry)) {
        throw "Frontend main entry not found: $frontendMainEntry"
    }
    if (-not (Test-Path -LiteralPath $frontendRuntimeEntry)) {
        throw "Frontend runtime entry not found: $frontendRuntimeEntry"
    }

    $mainEntrySource = Get-Content -LiteralPath $frontendMainEntry -Raw
    if ($mainEntrySource -notmatch "import\s+App\s+from\s+'\.\/app-runtime';") {
        throw "Expected web/src/main.tsx to import './app-runtime'."
    }
}

$modes = if ($Mode -eq 'All') { @('DryRun', 'Validate') } else { @($Mode) }

Write-Section 'Grit QuickStart Runtime Validation'
Write-Host "Repository : $repoRoot"
Write-Host "Launcher   : $launcherPath"
Write-Host "UI Entry   : .\\web\\src\\main.tsx -> .\\web\\src\\app-runtime.tsx"

Assert-FrontendEntryChain

foreach ($modeName in $modes) {
    $args = switch ($modeName) {
        'DryRun' { @('-DryRun') }
        'Validate' { @('-ValidatePythonOnly') }
    }

    $result = Invoke-LauncherMode -Name $modeName -Arguments $args
    Write-Section ("Mode: {0}" -f $modeName)
    if ($result.Succeeded) {
        Write-Host ("[PASS] {0}" -f $modeName) -ForegroundColor Green
    } else {
        Write-Host ("[FAIL] {0}" -f $modeName) -ForegroundColor Red
    }

    foreach ($line in $result.Output) {
        if ($null -ne $line -and -not [string]::IsNullOrWhiteSpace([string]$line)) {
            Write-Host ("  {0}" -f $line)
        }
    }

    if (-not $result.Succeeded) {
        exit 1
    }
}

Write-Section 'Manifest Checks'
if (-not (Test-Path -LiteralPath $manifestPath)) {
    Write-Host '[FAIL] Manifest missing.' -ForegroundColor Red
    exit 1
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifestJson = Get-Content -LiteralPath $manifestPath -Raw
$preferredHome = [string]$manifest.runtime.preferred_home
if ($preferredHome -ne '.\.python-runtime') {
    Write-Host ("[FAIL] preferred_home should be .\\.python-runtime, found: {0}" -f $preferredHome) -ForegroundColor Red
    exit 1
}
if ($manifestJson -match '\.python314-home') {
    Write-Host '[FAIL] Manifest still references .python314-home.' -ForegroundColor Red
    exit 1
}
Write-Host '[PASS] Runtime manifest references .python-runtime only.' -ForegroundColor Green

Write-Host ''
Write-Host 'All selected launcher flows passed.' -ForegroundColor Green
