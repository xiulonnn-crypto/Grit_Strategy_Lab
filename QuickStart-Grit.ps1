[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$DryRun,
    [switch]$ValidatePythonOnly,
    [switch]$RepairPython,
    [int]$BackendStartupTimeoutSeconds = 30,
    [int]$FrontendStartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$projectName = 'Grit Strategy Lab'
$preferredRuntimeHome = Join-Path $repoRoot '.python-runtime'
$legacyRuntimeHome = Join-Path $repoRoot '.python314-home'
$venvPath = Join-Path $repoRoot '.venv'
$venvPython = Join-Path $venvPath 'Scripts\python.exe'
$venvCfgPath = Join-Path $venvPath 'pyvenv.cfg'
$backendHealthUrl = 'http://127.0.0.1:8000/workspace/overview'
$frontendHealthUrl = 'http://127.0.0.1:4173/'
$workspaceUrl = 'http://127.0.0.1:4173/#/workspace'
$frontendDir = Join-Path $repoRoot 'web'
$frontendPreviewScript = Join-Path $frontendDir 'preview-server.mjs'
$frontendDistIndex = Join-Path $frontendDir 'dist\index.html'
$frontendCacheDir = Join-Path $frontendDir '.npm-cache'
$apiBaseUrl = 'http://127.0.0.1:8000'
$manifestPath = Join-Path $repoRoot '.python-runtime-manifest.json'

function Get-RepoRelativePath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }
    $normalizedRoot = $repoRoot.TrimEnd('\')
    $normalizedPath = $Path
    if ($normalizedPath.StartsWith($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $suffix = $normalizedPath.Substring($normalizedRoot.Length).TrimStart('\')
        if ([string]::IsNullOrWhiteSpace($suffix)) {
            return '.'
        }
        return ".\$suffix"
    }
    return $Path
}

function Test-HttpReady {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Wait-HttpReady {
    param([string]$Name, [string]$Url, [int]$TimeoutSeconds)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpReady -Url $Url) {
            Write-Host "$Name is ready at $Url" -ForegroundColor Green
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Test-PythonCandidate {
    param([string]$PythonExe)
    if ([string]::IsNullOrWhiteSpace($PythonExe) -or -not (Test-Path -LiteralPath $PythonExe)) {
        return $null
    }
    $probe = "import json, sqlite3, sys; print(json.dumps({'version': '.'.join(map(str, sys.version_info[:3])), 'executable': sys.executable, 'sqlite_ok': True}))"
    try {
        $output = & $PythonExe -c $probe 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $output) {
            return $null
        }
        $info = ($output | Select-Object -Last 1) | ConvertFrom-Json
        return [pscustomobject]@{
            PythonExe = [string]$info.executable
            Version = [string]$info.version
            VersionMajorMinor = (([string]$info.version).Split('.')[0..1] -join '.')
        }
    } catch {
        return $null
    }
}

function Add-UniqueString {
    param(
        [System.Collections.Generic.List[string]]$List,
        [string]$Value
    )
    if (-not [string]::IsNullOrWhiteSpace($Value) -and -not $List.Contains($Value)) {
        $List.Add($Value) | Out-Null
    }
}

function Get-SystemPythonCandidates {
    $candidates = New-Object 'System.Collections.Generic.List[object]'
    $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
    foreach ($item in @(
        @{ Label = 'system:3.14'; Path = (Join-Path $localAppData 'Programs\Python\Python314\python.exe') },
        @{ Label = 'system:3.13'; Path = (Join-Path $localAppData 'Programs\Python\Python313\python.exe') }
    )) {
        $candidates.Add([pscustomobject]$item) | Out-Null
    }

    $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        foreach ($version in @('3.14', '3.13')) {
            try {
                $resolved = & $pyLauncher.Source "-$version" -c "import sys; print(sys.executable)" 2>$null
                if ($LASTEXITCODE -eq 0 -and $resolved) {
                    $candidates.Add(
                        [pscustomobject]@{
                            Label = "py:$version"
                            Path = [string](($resolved | Select-Object -Last 1).Trim())
                        }
                    ) | Out-Null
                }
            } catch {
            }
        }
    }
    return $candidates
}

function Migrate-LegacyRuntimeIfNeeded {
    $preferredPython = Join-Path $preferredRuntimeHome 'python.exe'
    $legacyPython = Join-Path $legacyRuntimeHome 'python.exe'
    if (Test-Path -LiteralPath $preferredPython) {
        return 'none'
    }
    if (-not (Test-Path -LiteralPath $legacyPython)) {
        return 'none'
    }
    Write-Host 'Migrating embedded runtime from .python314-home to .python-runtime...' -ForegroundColor Yellow
    try {
        Move-Item -LiteralPath $legacyRuntimeHome -Destination $preferredRuntimeHome
        return 'migrated'
    } catch {
        Write-Warning 'Direct runtime move was blocked. Falling back to a local runtime copy.'
        New-Item -ItemType Directory -Force -Path $preferredRuntimeHome | Out-Null
        foreach ($item in Get-ChildItem -LiteralPath $legacyRuntimeHome -Force) {
            Copy-Item -LiteralPath $item.FullName -Destination $preferredRuntimeHome -Recurse -Force
        }
        if (-not (Test-Path -LiteralPath $preferredPython)) {
            throw
        }
        return 'copied'
    }
}

function Resolve-RuntimePython {
    $checked = New-Object 'System.Collections.Generic.List[string]'
    $repoCandidates = @(
        [pscustomobject]@{ Label = 'repo:.python-runtime'; Path = (Join-Path $preferredRuntimeHome 'python.exe') }
    )
    foreach ($candidate in @($repoCandidates + (Get-SystemPythonCandidates))) {
        Add-UniqueString -List $checked -Value $candidate.Label
        $info = Test-PythonCandidate -PythonExe $candidate.Path
        if ($info) {
            return [pscustomobject]@{
                Python = $info
                Checked = $checked.ToArray()
                Source = $candidate.Label
            }
        }
    }
    throw "Fatal: No valid Python runtime found. Checked: $($checked -join ', ')"
}

function Write-VenvConfig {
    param(
        [string]$RuntimePython,
        [string]$RuntimeVersion
    )
    $runtimeHome = Split-Path -Parent $RuntimePython
    $cfg = @(
        "home = $runtimeHome"
        'include-system-site-packages = true'
        "version = $RuntimeVersion"
        "executable = $RuntimePython"
        "command = $RuntimePython -m venv --without-pip --system-site-packages $venvPath"
    )
    $cfg | Set-Content -LiteralPath $venvCfgPath -Encoding UTF8
}

function Ensure-VenvBinding {
    param([pscustomobject]$RuntimeState)
    if (-not (Test-Path -LiteralPath $venvPath)) {
        Write-Host 'Creating repo-local virtual environment...' -ForegroundColor Yellow
        & $RuntimeState.Python.PythonExe -m venv --system-site-packages --without-pip $venvPath
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create virtual environment at $venvPath"
        }
    }
    if (-not (Test-Path -LiteralPath $venvPython)) {
        Write-Host 'Upgrading repo-local virtual environment...' -ForegroundColor Yellow
        & $RuntimeState.Python.PythonExe -m venv --upgrade --system-site-packages --without-pip $venvPath
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to repair virtual environment at $venvPath"
        }
    }

    Write-VenvConfig -RuntimePython $RuntimeState.Python.PythonExe -RuntimeVersion $RuntimeState.Python.Version
    $venvInfo = Test-PythonCandidate -PythonExe $venvPython
    if ($venvInfo) {
        return [pscustomobject]@{
            Python = $venvInfo
            Checked = @('.\.venv\Scripts\python.exe')
            Source = 'repo:.venv'
        }
    }

    Write-Host 'Repairing repo-local virtual environment metadata...' -ForegroundColor Yellow
    & $RuntimeState.Python.PythonExe -m venv --upgrade --system-site-packages --without-pip $venvPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to repair virtual environment at $venvPath"
    }
    Write-VenvConfig -RuntimePython $RuntimeState.Python.PythonExe -RuntimeVersion $RuntimeState.Python.Version
    $venvInfo = Test-PythonCandidate -PythonExe $venvPython
    if (-not $venvInfo) {
        throw "Virtual environment is not runnable at $venvPython"
    }
    return [pscustomobject]@{
        Python = $venvInfo
        Checked = @('.\.venv\Scripts\python.exe')
        Source = 'repo:.venv'
    }
}

function Write-RuntimeManifest {
    param(
        [pscustomobject]$RuntimeState,
        [pscustomobject]$EffectiveState,
        [string]$RepairResult,
        [string[]]$CheckedPaths
    )
    $manifest = [pscustomobject]@{
        schema_version = '3.0'
        status = [pscustomobject]@{
            preferred_is_ready = (Test-Path -LiteralPath (Join-Path $preferredRuntimeHome 'python.exe'))
            legacy_runtime_present = (Test-Path -LiteralPath $legacyRuntimeHome)
            last_repair_attempt = if ($RepairPython) { (Get-Date).ToString('s') } else { $null }
            repair_result = $RepairResult
        }
        runtime = [pscustomobject]@{
            preferred_home = '.\.python-runtime'
            runtime_python = (Get-RepoRelativePath $RuntimeState.Python.PythonExe)
            effective_python = (Get-RepoRelativePath $EffectiveState.Python.PythonExe)
            version = $EffectiveState.Python.Version
            source_origin = $RuntimeState.Source
        }
        environment = [pscustomobject]@{
            venv_path = '.\.venv'
            venv_is_ready = (Test-Path -LiteralPath $venvPython)
        }
        diagnostics = [pscustomobject]@{
            checked_paths_last = $CheckedPaths
        }
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
}

function Test-NodeModulesIntegrity {
    $requiredFiles = @(
        (Join-Path $frontendDir 'node_modules\react\package.json'),
        (Join-Path $frontendDir 'node_modules\vite\package.json')
    )
    foreach ($required in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $required)) {
            return $false
        }
    }
    return $true
}

function Ensure-FrontendDependencies {
    if (Test-NodeModulesIntegrity) {
        return
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw 'npm is required to install frontend dependencies.'
    }
    Write-Host 'node_modules is incomplete. Running npm install...' -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $frontendCacheDir | Out-Null
    Push-Location $frontendDir
    try {
        $env:npm_config_cache = $frontendCacheDir
        npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function Start-BackendWindow {
    param([string]$PythonExe)
    $command = @"
Set-Location '$repoRoot'
`$env:GRIT_BACKTEST_DB = '$(Join-Path $repoRoot '.grit_backtest_platform.sqlite3')'
`$env:PYTHONPATH = '$(Join-Path $repoRoot 'src');$(Join-Path $repoRoot '.venv\Lib\site-packages')'
& '$PythonExe' @('-m', 'uvicorn', '--app-dir', 'src', 'grit_backtest_platform.main:app', '--host', '127.0.0.1', '--port', '8000')
"@
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $command) | Out-Null
}

$runtimeMigrationMode = Migrate-LegacyRuntimeIfNeeded
$runtimeState = Resolve-RuntimePython
$effectiveState = Ensure-VenvBinding -RuntimeState $runtimeState
$checkedPaths = @($effectiveState.Checked + $runtimeState.Checked)
$repairResult = if ($RepairPython) { 'manual' } elseif ($runtimeMigrationMode -eq 'migrated') { 'migrated_legacy_runtime' } elseif ($runtimeMigrationMode -eq 'copied') { 'copied_legacy_runtime' } else { 'none' }
Write-RuntimeManifest -RuntimeState $runtimeState -EffectiveState $effectiveState -RepairResult $repairResult -CheckedPaths $checkedPaths

if ($ValidatePythonOnly) {
    Write-Host 'Python runtime validation passed.' -ForegroundColor Green
    Write-Host "Runtime python    : $($runtimeState.Python.PythonExe)"
    Write-Host "Effective python  : $($effectiveState.Python.PythonExe)"
    Write-Host "Version           : $($effectiveState.Python.Version)"
    Write-Host "Checked paths     : $($checkedPaths -join ', ')"
    exit 0
}

if ($RepairPython) {
    Write-Host 'Runtime repair completed.' -ForegroundColor Green
    Write-Host "Runtime python    : $($runtimeState.Python.PythonExe)"
    Write-Host "Effective python  : $($effectiveState.Python.PythonExe)"
    exit 0
}

Write-Host "Quick start launcher for $projectName" -ForegroundColor Cyan
Write-Host "Repository : $repoRoot"
Write-Host 'Config     : embedded in QuickStart-Grit.ps1'
Write-Host "Backend    : $backendHealthUrl"
Write-Host "Frontend   : $workspaceUrl"

if ($DryRun) {
    Write-Host ''
    Write-Host 'Backend command:' -ForegroundColor Yellow
    Write-Host "& '$($effectiveState.Python.PythonExe)' -m uvicorn --app-dir src grit_backtest_platform.main:app --host 127.0.0.1 --port 8000"
    Write-Host ''
    Write-Host 'Checked runtime paths:' -ForegroundColor Yellow
    foreach ($path in $checkedPaths) {
        Write-Host "- $path"
    }
    exit 0
}

if (-not (Test-HttpReady -Url $backendHealthUrl)) {
    Write-Host 'Starting backend...' -ForegroundColor Yellow
    Start-BackendWindow -PythonExe $effectiveState.Python.PythonExe
    if (-not (Wait-HttpReady -Name 'Backend' -Url $backendHealthUrl -TimeoutSeconds $BackendStartupTimeoutSeconds)) {
        throw "Backend failed to become ready at $backendHealthUrl within $BackendStartupTimeoutSeconds seconds."
    }
}

if (-not (Test-Path -LiteralPath $frontendDir)) {
    throw "Frontend directory not found at $frontendDir"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required to serve the frontend preview.'
}
if (-not (Test-Path -LiteralPath $frontendPreviewScript)) {
    throw "Static preview script not found at $frontendPreviewScript"
}

Ensure-FrontendDependencies

if (Test-HttpReady -Url $frontendHealthUrl) {
    Write-Host "Frontend already running at $frontendHealthUrl" -ForegroundColor DarkGreen
    if (-not $NoBrowser) {
        Start-Process $workspaceUrl | Out-Null
    }
    exit 0
}

Write-Host 'Building frontend for static preview...' -ForegroundColor Yellow
Push-Location $frontendDir
try {
    $env:VITE_API_BASE_URL = $apiBaseUrl
    npm run build
    if ($LASTEXITCODE -ne 0) {
        if (-not (Test-Path -LiteralPath $frontendDistIndex)) {
            throw "Frontend build failed with exit code $LASTEXITCODE and no existing dist bundle was found."
        }
        Write-Warning 'Frontend build failed, but an existing dist bundle was found. Reusing the last successful build.'
    }
} finally {
    Pop-Location
}

$nodeExe = (Get-Command node -ErrorAction Stop).Source
$previewArgs = @($frontendPreviewScript, '--host', '127.0.0.1', '--port', '4173')
if (-not $NoBrowser) {
    $previewArgs += @('--open-url', $workspaceUrl)
}

Write-Host 'Starting frontend static preview in this window...' -ForegroundColor Green
Write-Host 'Keep this window open while using the local app.' -ForegroundColor Yellow
& $nodeExe @previewArgs
