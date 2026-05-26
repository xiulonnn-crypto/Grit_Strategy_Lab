[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$DryRun,
    [switch]$ValidatePythonOnly,
    [switch]$RepairPython,
    [switch]$ForceRestart,
    [string]$RestartReason = 'operator requested QuickStart restart',
    [int]$BackendStartupTimeoutSeconds = 75,
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
$backendHealthUrl = 'http://127.0.0.1:8000/healthz'
$frontendHealthUrl = 'http://127.0.0.1:4173/'
$workspaceUrl = 'http://127.0.0.1:4173/#/workspace'
$frontendDir = Join-Path $repoRoot 'web'
$frontendMainEntry = Join-Path $frontendDir 'src\main.tsx'
$frontendRuntimeEntry = Join-Path $frontendDir 'src\app-runtime.tsx'
$frontendPreviewScript = Join-Path $frontendDir 'preview-server.mjs'
$frontendDistIndex = Join-Path $frontendDir 'dist\index.html'
$frontendCacheDir = Join-Path $frontendDir '.npm-cache'
$apiBaseUrl = 'http://127.0.0.1:8000'
$manifestPath = Join-Path $repoRoot '.python-runtime-manifest.json'
$backendDbPath = Join-Path $repoRoot '.grit_backtest_platform.sqlite3'
$marketDataDbPath = Join-Path $repoRoot '.grit_backtest_platform_market_data.sqlite3'
$marketDataJournalPath = "$marketDataDbPath-journal"
$backendRecoveryDir = Join-Path $repoRoot 'artifacts\quickstart-recovery'
$localQuickStartConfigPath = Join-Path $repoRoot 'QuickStart-Grit.local.ps1'
$localQuickStartExamplePath = Join-Path $repoRoot 'QuickStart-Grit.local.example.ps1'
$runtimeSupervisorScript = Join-Path $repoRoot 'scripts\runtime_supervisor.py'

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
    param(
        [string]$Url,
        [int]$TimeoutSec = 3,
        [int[]]$ExpectedStatusCodes = @(200)
    )
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec
        if ($ExpectedStatusCodes -and $ExpectedStatusCodes.Count -gt 0) {
            return $ExpectedStatusCodes -contains [int]$response.StatusCode
        }
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Wait-HttpReady {
    param(
        [string]$Name,
        [string]$Url,
        [int]$TimeoutSeconds,
        [int]$ProbeTimeoutSec = 3,
        [int[]]$ExpectedStatusCodes = @(200)
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpReady -Url $Url -TimeoutSec $ProbeTimeoutSec -ExpectedStatusCodes $ExpectedStatusCodes) {
            Write-Host "$Name is ready at $Url" -ForegroundColor Green
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Open-WorkspaceBrowserIfRequested {
    param([string]$Reason = 'workspace ready')
    if ($NoBrowser) {
        return
    }
    try {
        Start-Process -FilePath $workspaceUrl | Out-Null
        Write-Host "Opened workspace in browser: $workspaceUrl" -ForegroundColor Green
    } catch {
        Write-Warning "Workspace is ready at $workspaceUrl, but QuickStart could not open the browser automatically ($Reason): $($_.Exception.Message)"
    }
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
    $desiredContent = (($cfg -join [Environment]::NewLine) + [Environment]::NewLine)
    if (Test-Path -LiteralPath $venvCfgPath) {
        try {
            $currentContent = Get-Content -LiteralPath $venvCfgPath -Raw -ErrorAction Stop
            if ($currentContent -eq $desiredContent) {
                return
            }
        } catch {
        }
    }
    $desiredContent | Set-Content -LiteralPath $venvCfgPath -Encoding UTF8
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

function Get-FrontendBundleFreshness {
    $sourcePaths = @(
        (Join-Path $frontendDir 'index.html'),
        $frontendMainEntry,
        $frontendRuntimeEntry,
        $frontendPreviewScript
    )
    $sourceFiles = New-Object 'System.Collections.Generic.List[System.IO.FileInfo]'
    foreach ($sourcePath in $sourcePaths) {
        if (Test-Path -LiteralPath $sourcePath) {
            $sourceFiles.Add((Get-Item -LiteralPath $sourcePath)) | Out-Null
        }
    }
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $frontendDir 'src') -File -Recurse) {
        if (
            $file.Name -match '\.(test|spec)\.[^.]+$' -or
            $file.Name -match '\.stories\.[^.]+$' -or
            $file.FullName -match '[\\/](?:__tests__|__mocks__)[\\/]'
        ) {
            continue
        }
        $sourceFiles.Add($file) | Out-Null
    }

    $distInfo = if (Test-Path -LiteralPath $frontendDistIndex) {
        Get-Item -LiteralPath $frontendDistIndex
    } else {
        $null
    }
    $latestSource = $sourceFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1

    [pscustomobject]@{
        DistExists = ($null -ne $distInfo)
        DistIndex = $distInfo
        LatestSource = $latestSource
        IsFresh = ($null -ne $distInfo) -and ($null -ne $latestSource) -and ($distInfo.LastWriteTimeUtc -ge $latestSource.LastWriteTimeUtc)
    }
}

function Format-FrontendBundleFreshnessMessage {
    param([pscustomobject]$Freshness)

    if (-not $Freshness.DistExists) {
        return 'No frontend dist bundle exists yet.'
    }

    $distStamp = $Freshness.DistIndex.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    $sourceStamp = if ($Freshness.LatestSource) {
        $Freshness.LatestSource.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    } else {
        'unknown'
    }
    $sourcePath = if ($Freshness.LatestSource) {
        Get-RepoRelativePath $Freshness.LatestSource.FullName
    } else {
        'unknown'
    }

    return "dist/index.html timestamp: $distStamp; latest source: $sourceStamp at $sourcePath"
}

function Assert-FrontendEntryChain {
    if (-not (Test-Path -LiteralPath $frontendMainEntry)) {
        throw "Frontend main entry not found at $frontendMainEntry"
    }
    if (-not (Test-Path -LiteralPath $frontendRuntimeEntry)) {
        throw "Frontend runtime entry not found at $frontendRuntimeEntry"
    }

    $mainEntrySource = Get-Content -LiteralPath $frontendMainEntry -Raw
    if ($mainEntrySource -notmatch "import\s+App\s+from\s+'\.\/app-runtime';") {
        throw "Frontend startup entry drifted. Expected $frontendMainEntry to import './app-runtime'."
    }
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

function Join-OutputLines {
    param([object[]]$Lines)
    return (($Lines | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ }) -join [Environment]::NewLine).Trim()
}

function Import-QuickStartLocalEnvironment {
    param([switch]$Quiet)

    $state = [ordered]@{
        Loaded = $false
        Path = (Get-RepoRelativePath $localQuickStartConfigPath)
        ExamplePath = (Get-RepoRelativePath $localQuickStartExamplePath)
    }

    if (-not (Test-Path -LiteralPath $localQuickStartConfigPath)) {
        return [pscustomobject]$state
    }

    try {
        . $localQuickStartConfigPath
    } catch {
        throw "Failed to load local QuickStart environment from $($state.Path). $($_.Exception.Message)"
    }

    $state.Loaded = $true
    if (-not $Quiet) {
        Write-Host "Loaded local startup environment from $($state.Path)." -ForegroundColor Green
    }
    return [pscustomobject]$state
}

function Get-BackendListenerProcessIds {
    param([int]$Port = 8000)

    $ids = New-Object 'System.Collections.Generic.List[int]'
    $pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
    foreach ($line in (netstat -ano -p TCP 2>$null)) {
        if ($line -match $pattern) {
            $listenerPid = [int]$matches[1]
            if (-not $ids.Contains($listenerPid)) {
                $ids.Add($listenerPid) | Out-Null
            }
        }
    }
    return $ids.ToArray()
}

function Get-FrontendListenerProcessIds {
    param([int]$Port = 4173)

    $ids = New-Object 'System.Collections.Generic.List[int]'
    $pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
    foreach ($line in (netstat -ano -p TCP 2>$null)) {
        if ($line -match $pattern) {
            $listenerId = [int]$matches[1]
            if (-not $ids.Contains($listenerId)) {
                $ids.Add($listenerId) | Out-Null
            }
        }
    }
    return $ids.ToArray()
}

function Get-ProcessPathSafely {
    param([int]$ProcessId)

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        return [string]$process.Path
    } catch {
        return $null
    }
}

function Get-ProcessCommandLineSafely {
    param([int]$ProcessId)

    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        return [string]$process.CommandLine
    } catch {
        return $null
    }
}

function Test-RepoFrontendPreviewProcess {
    param(
        [AllowNull()][string]$ProcessPath,
        [AllowNull()][string]$CommandLine,
        [int]$Port = 4173
    )

    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return $false
    }

    foreach ($repoPath in @($repoRoot, $frontendDir, $frontendPreviewScript)) {
        if (
            -not [string]::IsNullOrWhiteSpace($repoPath) -and
            $CommandLine.IndexOf($repoPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
        ) {
            return $true
        }
    }

    $processName = if (-not [string]::IsNullOrWhiteSpace($ProcessPath)) {
        [System.IO.Path]::GetFileName($ProcessPath)
    } else {
        ''
    }
    $looksLikeNode =
        $processName -in @('node.exe', 'node') -or
        $CommandLine -match '(?i)(^|\s|")node(\.exe)?("|\s|$)'
    if (-not $looksLikeNode) {
        return $false
    }

    # `npm run preview:auto` and older launcher windows can expose only a relative script path.
    $normalizedCommandLine = $CommandLine.Replace('/', '\')
    $hasRelativePreviewScript =
        $normalizedCommandLine.IndexOf('.\preview-server.mjs', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $CommandLine -match '(?i)(^|\s|")preview-server\.mjs(?=\s|"|$)'
    if (-not $hasRelativePreviewScript) {
        return $false
    }

    $hasWatch = $CommandLine.IndexOf('--watch', [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    $hasRebuildOnStart = $CommandLine.IndexOf('--rebuild-on-start', [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    $escapedPort = [regex]::Escape([string]$Port)
    $hasExpectedPort = $CommandLine -match "(?i)(^|\s)--port(\s+|=)$escapedPort(\s|$)"
    $hasAnyPort = $CommandLine -match '(?i)(^|\s)--port(\s+|=)\d+(\s|$)'
    $usesDefaultPreviewPort = $Port -eq 4173 -and -not $hasAnyPort

    return $hasWatch -and $hasRebuildOnStart -and ($hasExpectedPort -or $usesDefaultPreviewPort)
}

function Test-RepoFrontendPreviewHttpFingerprint {
    param([string]$Url = $frontendHealthUrl)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
        $content = [string]$response.Content
        return (
            $content.IndexOf('Grit Backtest Platform', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $content.IndexOf('<div id="root"', [System.StringComparison]::OrdinalIgnoreCase) -ge 0
        )
    } catch {
        return $false
    }
}

function Test-RepoBackendProcess {
    param(
        [AllowNull()][string]$ProcessPath,
        [AllowNull()][string]$CommandLine,
        [int]$Port = 8000
    )

    if (
        -not [string]::IsNullOrWhiteSpace($ProcessPath) -and
        $ProcessPath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        return $true
    }
    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return $false
    }
    if ($CommandLine.IndexOf($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        return $true
    }

    $escapedPort = [regex]::Escape([string]$Port)
    $hasExpectedPort = $CommandLine -match "(?i)(^|\s)--port(\s+|=)$escapedPort(\s|$)"
    $isGritBackend =
        $CommandLine.IndexOf('grit_backtest_platform.main:app', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $CommandLine.IndexOf('grit_backtest_platform.main', [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    return $isGritBackend -and $hasExpectedPort
}

function Assert-RepoBackendListeners {
    param([int]$Port = 8000)

    $blocked = New-Object 'System.Collections.Generic.List[string]'
    foreach ($listenerId in @(Get-BackendListenerProcessIds -Port $Port)) {
        $processPath = Get-ProcessPathSafely -ProcessId $listenerId
        $commandLine = Get-ProcessCommandLineSafely -ProcessId $listenerId
        if (-not (Test-RepoBackendProcess -ProcessPath $processPath -CommandLine $commandLine -Port $Port)) {
            $details = if ($commandLine) { $commandLine } elseif ($processPath) { $processPath } else { 'unknown process' }
            $blocked.Add(("PID {0} ({1})" -f $listenerId, $details)) | Out-Null
        }
    }
    if ($blocked.Count -gt 0) {
        throw "Port $Port is already occupied by a non-repo backend process. Listener(s): $($blocked -join ', ')"
    }
}

function Assert-RepoFrontendListeners {
    param([int]$Port = 4173)

    $blocked = New-Object 'System.Collections.Generic.List[string]'
    foreach ($listenerId in @(Get-FrontendListenerProcessIds -Port $Port)) {
        $processPath = Get-ProcessPathSafely -ProcessId $listenerId
        $commandLine = Get-ProcessCommandLineSafely -ProcessId $listenerId
        $belongsToRepo =
            (Test-RepoFrontendPreviewProcess -ProcessPath $processPath -CommandLine $commandLine -Port $Port) -or
            (Test-RepoFrontendPreviewHttpFingerprint -Url $frontendHealthUrl)
        if (-not $belongsToRepo) {
            $details = if ($commandLine) { $commandLine } elseif ($processPath) { $processPath } else { 'unknown process' }
            $blocked.Add(("PID {0} ({1})" -f $listenerId, $details)) | Out-Null
        }
    }
    if ($blocked.Count -gt 0) {
        throw "Port $Port is already occupied by a non-repo frontend process. Listener(s): $($blocked -join ', ')"
    }
}

function Stop-UnhealthyBackendListeners {
    param([int]$Port = 8000)

    $listenerIds = @(Get-BackendListenerProcessIds -Port $Port)
    if (-not $listenerIds -or $listenerIds.Count -eq 0) {
        return
    }

    $stopped = New-Object 'System.Collections.Generic.List[int]'
    $blocked = New-Object 'System.Collections.Generic.List[string]'
    foreach ($listenerId in $listenerIds) {
        $processPath = Get-ProcessPathSafely -ProcessId $listenerId
        $commandLine = Get-ProcessCommandLineSafely -ProcessId $listenerId
        if (Test-RepoBackendProcess -ProcessPath $processPath -CommandLine $commandLine -Port $Port) {
            Write-Host "Stopping repo-owned backend listener on port $Port (PID $listenerId)." -ForegroundColor Yellow
            Stop-Process -Id $listenerId -Force -ErrorAction Stop
            $stopped.Add($listenerId) | Out-Null
            continue
        }

        $details = if ($commandLine) { $commandLine } elseif ($processPath) { $processPath } else { 'unknown process' }
        $blocked.Add(("PID {0} ({1})" -f $listenerId, $details)) | Out-Null
    }

    if ($blocked.Count -gt 0) {
        throw "Port $Port is already occupied by a non-repo process. Listener(s): $($blocked -join ', ')"
    }

    if ($stopped.Count -gt 0) {
        Start-Sleep -Seconds 1
    }
}

function Stop-StaleFrontendListeners {
    param([int]$Port = 4173)

    $listenerIds = @(Get-FrontendListenerProcessIds -Port $Port)
    if (-not $listenerIds -or $listenerIds.Count -eq 0) {
        return
    }

    $stopped = New-Object 'System.Collections.Generic.List[int]'
    $blocked = New-Object 'System.Collections.Generic.List[string]'
    foreach ($listenerId in $listenerIds) {
        $processPath = Get-ProcessPathSafely -ProcessId $listenerId
        $commandLine = Get-ProcessCommandLineSafely -ProcessId $listenerId
        $belongsToRepo = Test-RepoFrontendPreviewProcess -ProcessPath $processPath -CommandLine $commandLine -Port $Port

        if ($belongsToRepo) {
            Write-Host "Stopping repo-owned frontend listener on port $Port (PID $listenerId)." -ForegroundColor Yellow
            Stop-Process -Id $listenerId -Force -ErrorAction Stop
            $stopped.Add($listenerId) | Out-Null
            continue
        }

        $details = if ($commandLine) { $commandLine } elseif ($processPath) { $processPath } else { 'unknown process' }
        $blocked.Add(("PID {0} ({1})" -f $listenerId, $details)) | Out-Null
    }

    if ($blocked.Count -gt 0) {
        throw "Port $Port is already occupied by a non-repo frontend process. Listener(s): $($blocked -join ', ')"
    }

    if ($stopped.Count -gt 0) {
        Start-Sleep -Seconds 1
    }
}

function Invoke-BackendProbe {
    param([string]$PythonExe)

    $probe = @"
import os
import sys
import traceback

os.environ['GRIT_BACKTEST_DB'] = r'$backendDbPath'
sys.path.insert(0, r'$(Join-Path $repoRoot 'src')')
sys.path.insert(0, r'$(Join-Path $repoRoot '.venv\Lib\site-packages')')

try:
    from grit_backtest_platform.real_service import RealBacktestPlatformService
    service = RealBacktestPlatformService(r'$backendDbPath')
    service.get_workspace_overview()
    print('BACKEND_PROBE_OK')
except Exception:
    traceback.print_exc()
    sys.exit(1)
"@

    $output = & $PythonExe -c $probe 2>&1
    return [pscustomobject]@{
        Succeeded = ($LASTEXITCODE -eq 0)
        Output = @($output)
        Summary = (Join-OutputLines -Lines $output)
    }
}

function Repair-MarketDataHotJournal {
    if (-not (Test-Path -LiteralPath $marketDataJournalPath)) {
        return $false
    }

    $journalInfo = Get-Item -LiteralPath $marketDataJournalPath
    if ($journalInfo.Length -le 0) {
        return $false
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $recoveryDir = Join-Path $backendRecoveryDir "market-data-$timestamp"
    New-Item -ItemType Directory -Force -Path $recoveryDir | Out-Null

    if (Test-Path -LiteralPath $marketDataDbPath) {
        Copy-Item -LiteralPath $marketDataDbPath -Destination (Join-Path $recoveryDir 'market_data.sqlite3') -Force
    }
    Copy-Item -LiteralPath $marketDataJournalPath -Destination (Join-Path $recoveryDir 'market_data.sqlite3-journal') -Force

    $stream = [System.IO.File]::Open($marketDataJournalPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $stream.SetLength(0)
    } finally {
        $stream.Dispose()
    }

    Write-Warning "Recovered market-data hot journal by truncating $(Get-RepoRelativePath $marketDataJournalPath). Backup saved to $(Get-RepoRelativePath $recoveryDir)."
    return $true
}

function Ensure-BackendProbeReady {
    param([string]$PythonExe)

    $probe = Invoke-BackendProbe -PythonExe $PythonExe
    if ($probe.Succeeded) {
        return
    }

    if ($probe.Summary -match 'disk I/O error' -and (Repair-MarketDataHotJournal)) {
        $probe = Invoke-BackendProbe -PythonExe $PythonExe
        if ($probe.Succeeded) {
            return
        }
    }

    $summary = if ([string]::IsNullOrWhiteSpace($probe.Summary)) { 'No backend probe output was captured.' } else { $probe.Summary }
    throw "Backend probe failed before startup.`n$summary"
}

function Invoke-QuickStartSupervisorGuard {
    param(
        [string]$PythonExe,
        [bool]$Force = $false,
        [AllowNull()][string]$Reason = $null
    )

    if ($env:GRIT_RUNTIME_SUPERVISOR_CHILD -eq '1') {
        return $true
    }
    if (-not (Test-Path -LiteralPath $runtimeSupervisorScript)) {
        Write-Warning "Runtime supervisor not found at $(Get-RepoRelativePath $runtimeSupervisorScript). Continuing without the startup guard."
        return $true
    }

    $guardArgs = @('--json', 'guard', 'quickstart', '--owner-pid', [string]$PID, '--requested-by', 'QuickStart-Grit.ps1')
    if ($Force) {
        $guardArgs += '--force'
        if (-not [string]::IsNullOrWhiteSpace($Reason)) {
            $guardArgs += @('--reason', $Reason)
        }
    }
    $guardOutput = & $PythonExe $runtimeSupervisorScript @guardArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        $guardText = Join-OutputLines -Lines $guardOutput
        throw "QuickStart supervisor guard failed.`n$guardText"
    }
    $guardLine = ($guardOutput | Select-Object -Last 1)
    try {
        $guard = $guardLine | ConvertFrom-Json
    } catch {
        throw "QuickStart supervisor guard returned non-JSON output: $guardLine"
    }
    if (-not [bool]$guard.allowed) {
        $message = if ($guard.message) { [string]$guard.message } else { 'QuickStart startup was skipped by runtime supervisor.' }
        Write-Host $message -ForegroundColor Green
        Write-Host "Workspace URL: $workspaceUrl" -ForegroundColor Green
        Write-Host "Status: powershell -ExecutionPolicy Bypass -File .\scripts\runtime-supervisor.ps1 status quickstart" -ForegroundColor Yellow
        if ([string]($guard.status) -eq 'already_running') {
            Open-WorkspaceBrowserIfRequested -Reason 'QuickStart reused an existing supervisor-owned runtime'
        }
        return $false
    }
    return $true
}

function Start-BackendWindow {
    param([string]$PythonExe)
    $command = @"
Set-Location '$repoRoot'
if (Test-Path -LiteralPath '$localQuickStartConfigPath') { . '$localQuickStartConfigPath' }
`$env:GRIT_BACKTEST_DB = '$backendDbPath'
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
$localEnvironmentState = Import-QuickStartLocalEnvironment

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
Write-Host "Local env  : $($localEnvironmentState.Path)$(if ($localEnvironmentState.Loaded) { ' (loaded)' } else { ' (optional, not found)' })"
Write-Host "Backend    : $backendHealthUrl"
Write-Host "Frontend   : $workspaceUrl"
Write-Host "UI Entry   : $(Get-RepoRelativePath $frontendMainEntry) -> $(Get-RepoRelativePath $frontendRuntimeEntry)"

Assert-FrontendEntryChain

if ($DryRun) {
    $bundleFreshness = Get-FrontendBundleFreshness
    Write-Host ''
    Write-Host 'Backend command:' -ForegroundColor Yellow
    Write-Host "& '$($effectiveState.Python.PythonExe)' -m uvicorn --app-dir src grit_backtest_platform.main:app --host 127.0.0.1 --port 8000"
    Write-Host ''
    Write-Host 'Frontend entry chain:' -ForegroundColor Yellow
    Write-Host "- $(Get-RepoRelativePath $frontendMainEntry) imports ./app-runtime"
    Write-Host "- $(Get-RepoRelativePath $frontendRuntimeEntry) is the active route orchestrator"
    Write-Host "- Dist freshness: $((Format-FrontendBundleFreshnessMessage -Freshness $bundleFreshness))"
    Write-Host ''
    Write-Host 'Checked runtime paths:' -ForegroundColor Yellow
    foreach ($path in $checkedPaths) {
        Write-Host "- $path"
    }
    exit 0
}

if (-not (Invoke-QuickStartSupervisorGuard -PythonExe $effectiveState.Python.PythonExe -Force ([bool]$ForceRestart) -Reason $RestartReason)) {
    exit 0
}

$skipBackendStart = $false
if (@(Get-BackendListenerProcessIds -Port 8000).Count -gt 0) {
    Assert-RepoBackendListeners -Port 8000
    if ($ForceRestart) {
        Write-Host "ForceRestart requested: replacing the healthy repo-owned backend so new environment values are loaded." -ForegroundColor Yellow
        Stop-UnhealthyBackendListeners -Port 8000
    } elseif (Test-HttpReady -Url $backendHealthUrl -TimeoutSec 5 -ExpectedStatusCodes @(200)) {
        Write-Host 'Backend already healthy on port 8000; reusing the existing listener.' -ForegroundColor Green
        $skipBackendStart = $true
    } else {
        Write-Host 'Existing backend listener on port 8000 is not healthy; stopping repo-owned stale listener.' -ForegroundColor Yellow
        Stop-UnhealthyBackendListeners -Port 8000
    }
}

if (-not $skipBackendStart) {
    Ensure-BackendProbeReady -PythonExe $effectiveState.Python.PythonExe
    Write-Host 'Starting backend...' -ForegroundColor Yellow
    Start-BackendWindow -PythonExe $effectiveState.Python.PythonExe
    if (-not (Wait-HttpReady -Name 'Backend' -Url $backendHealthUrl -TimeoutSeconds $BackendStartupTimeoutSeconds -ProbeTimeoutSec 5 -ExpectedStatusCodes @(200))) {
        $probe = Invoke-BackendProbe -PythonExe $effectiveState.Python.PythonExe
        if (Test-HttpReady -Url $backendHealthUrl -TimeoutSec 10 -ExpectedStatusCodes @(200)) {
            Write-Host "Backend became ready after the startup probe at $backendHealthUrl" -ForegroundColor Green
        } else {
            $probeStatus = if ($probe.Succeeded) {
                'Backend import/storage probe succeeded, but HTTP health was still unavailable.'
            } else {
                'Backend import/storage probe failed after startup.'
            }
            $probeSummary = if ([string]::IsNullOrWhiteSpace($probe.Summary)) { 'No backend probe output was captured after startup.' } else { $probe.Summary }
            throw "Backend failed to become ready at $backendHealthUrl within $BackendStartupTimeoutSeconds seconds.`n$probeStatus`n$probeSummary"
        }
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

$initialBundleFreshness = Get-FrontendBundleFreshness

$skipFrontendStart = $false
if (@(Get-FrontendListenerProcessIds -Port 4173).Count -gt 0) {
    Assert-RepoFrontendListeners -Port 4173
    if ($ForceRestart) {
        Write-Host "ForceRestart requested: replacing the healthy repo-owned frontend preview." -ForegroundColor Yellow
        Stop-StaleFrontendListeners -Port 4173
    } elseif (Test-HttpReady -Url $frontendHealthUrl -TimeoutSec 5 -ExpectedStatusCodes @(200)) {
        Write-Host 'Frontend preview already healthy on port 4173; reusing the existing listener.' -ForegroundColor Green
        $skipFrontendStart = $true
    } else {
        if (-not $initialBundleFreshness.IsFresh) {
            Write-Host "Existing frontend preview is unhealthy and the local dist bundle is stale. $(Format-FrontendBundleFreshnessMessage -Freshness $initialBundleFreshness)" -ForegroundColor Yellow
        } else {
            Write-Host 'Existing frontend preview on port 4173 is not healthy; stopping repo-owned stale listener.' -ForegroundColor Yellow
        }
        Stop-StaleFrontendListeners -Port 4173
    }
}

if (-not $skipFrontendStart) {
    Write-Host 'Building frontend for static preview...' -ForegroundColor Yellow
    Push-Location $frontendDir
    try {
        $env:VITE_API_BASE_URL = $apiBaseUrl
        npm run build
        if ($LASTEXITCODE -ne 0) {
            $bundleFreshness = Get-FrontendBundleFreshness
            if (-not $bundleFreshness.DistExists) {
                throw "Frontend build failed with exit code $LASTEXITCODE and no existing dist bundle was found."
            }
            if (-not $bundleFreshness.IsFresh) {
                throw "Frontend build failed with exit code $LASTEXITCODE and the existing dist bundle is stale. $(Format-FrontendBundleFreshnessMessage -Freshness $bundleFreshness) This machine is currently hitting vite/esbuild spawn EPERM, so QuickStart cannot refresh the UI bundle here."
            }
            Write-Warning 'Frontend build failed, but an existing dist bundle was found. Reusing the last successful build.'
        }
    } finally {
        Pop-Location
    }

    $nodeExe = (Get-Command node -ErrorAction Stop).Source
    $previewArgs = @($frontendPreviewScript, '--host', '127.0.0.1', '--port', '4173', '--watch')
    if (-not $NoBrowser) {
        $previewArgs += @('--open-url', $workspaceUrl)
    }

    Write-Host 'Starting frontend static preview with auto rebuild in this window...' -ForegroundColor Green
    Write-Host 'Keep this window open while using the local app. Frontend edits under web/ will rebuild dist automatically.' -ForegroundColor Yellow
    $env:GRIT_RUNTIME_SUPERVISOR_CHILD = '1'
    & $nodeExe @previewArgs
} else {
    Write-Host "Workspace URL: $workspaceUrl" -ForegroundColor Green
    Open-WorkspaceBrowserIfRequested -Reason 'frontend preview was already healthy'
}
