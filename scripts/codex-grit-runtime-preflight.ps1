[CmdletBinding()]
param(
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$supervisorScript = Join-Path $repoRoot 'scripts\runtime-supervisor.ps1'
$backendUrl = 'http://127.0.0.1:8000/healthz'
$frontendUrl = 'http://127.0.0.1:4173/'

function Get-Prop {
    param(
        [object]$Object,
        [string]$Name
    )
    if ($null -eq $Object) {
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function ConvertTo-Array {
    param([object]$Value)
    if ($null -eq $Value) {
        return @()
    }
    if ($Value -is [array]) {
        return @($Value)
    }
    return @($Value)
}

function ConvertTo-IntArray {
    param([object]$Value)
    $items = ConvertTo-Array $Value
    $result = New-Object System.Collections.Generic.List[int]
    foreach ($item in $items) {
        try {
            $pidValue = [int]$item
            if ($pidValue -gt 0 -and -not $result.Contains($pidValue)) {
                [void]$result.Add($pidValue)
            }
        } catch {
            continue
        }
    }
    return @($result.ToArray())
}

function Get-Sha256ForText {
    param([string]$Text)
    if ($null -eq $Text) {
        return $null
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $sha.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Invoke-HttpProbe {
    param(
        [string]$Url,
        [string[]]$Fingerprints = @()
    )
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        $content = [string]$response.Content
        $fingerprintOk = $true
        foreach ($fingerprint in $Fingerprints) {
            if ($content -notlike "*$fingerprint*") {
                $fingerprintOk = $false
            }
        }
        return [pscustomobject][ordered]@{
            ok = ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 400)
            statusCode = [int]$response.StatusCode
            contentHash = Get-Sha256ForText $content
            fingerprintOk = $fingerprintOk
            contentLength = $content.Length
            error = $null
        }
    } catch {
        $statusCode = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        return [pscustomobject][ordered]@{
            ok = $false
            statusCode = $statusCode
            contentHash = $null
            fingerprintOk = $false
            contentLength = 0
            error = $_.Exception.Message
        }
    }
}

function Get-ListenerProbe {
    param([int]$Port)
    $method = $null
    $errors = New-Object System.Collections.Generic.List[string]
    $pids = New-Object System.Collections.Generic.List[int]

    try {
        $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
        foreach ($connection in $connections) {
            $pidValue = [int]$connection.OwningProcess
            if ($pidValue -gt 0 -and -not $pids.Contains($pidValue)) {
                [void]$pids.Add($pidValue)
            }
        }
        $method = 'Get-NetTCPConnection'
    } catch {
        [void]$errors.Add(("Get-NetTCPConnection: {0}" -f $_.Exception.Message))
    }

    if ($pids.Count -eq 0) {
        try {
            $lines = @(netstat -ano -p tcp 2>&1)
            foreach ($line in $lines) {
                if ([string]$line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
                    $pidValue = [int]$Matches[1]
                    if ($pidValue -gt 0 -and -not $pids.Contains($pidValue)) {
                        [void]$pids.Add($pidValue)
                    }
                }
            }
            if ($null -eq $method) {
                $method = 'netstat'
            }
        } catch {
            [void]$errors.Add(("netstat: {0}" -f $_.Exception.Message))
        }
    }

    $status = if ($null -eq $method) {
        'probe-degraded'
    } elseif ($errors.Count -gt 0 -and $pids.Count -eq 0) {
        'probe-degraded'
    } else {
        'ok'
    }

    return [pscustomobject][ordered]@{
        port = $Port
        pids = @($pids.ToArray())
        method = $method
        status = $status
        errors = @($errors.ToArray())
    }
}

function Get-ProcessSnapshot {
    param([Nullable[int]]$ProcessId)
    if ($null -eq $ProcessId -or [int]$ProcessId -le 0) {
        return [pscustomobject][ordered]@{
            pid = $null
            processName = $null
            path = $null
            startedAt = $null
            commandLine = $null
            commandLineError = $null
        }
    }

    $processName = $null
    $path = $null
    $startedAt = $null
    $commandLine = $null
    $commandLineError = $null

    try {
        $process = Get-Process -Id ([int]$ProcessId) -ErrorAction Stop
        $processName = $process.ProcessName
        $path = $process.Path
        if ($process.StartTime) {
            $startedAt = $process.StartTime.ToUniversalTime().ToString('o')
        }
    } catch {
        $commandLineError = $_.Exception.Message
    }

    try {
        $cim = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f [int]$ProcessId) -ErrorAction Stop
        if ($null -ne $cim) {
            if ($cim.ExecutablePath) {
                $path = [string]$cim.ExecutablePath
            }
            $commandLine = [string]$cim.CommandLine
        }
    } catch {
        $commandLineError = $_.Exception.Message
    }

    return [pscustomobject][ordered]@{
        pid = [int]$ProcessId
        processName = $processName
        path = $path
        startedAt = $startedAt
        commandLine = $commandLine
        commandLineError = $commandLineError
    }
}

function Get-NewestFileMtime {
    param(
        [string]$Path,
        [string[]]$Include = @('*'),
        [string[]]$ExcludeNameFragments = @()
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject][ordered]@{ path = $null; mtime = $null }
    }
    $extensions = @(
        $Include |
            Where-Object { [string]$_ -like '*.*' -and [string]$_ -ne '*' } |
            ForEach-Object { ([string]$_).Replace('*', '').ToLowerInvariant() }
    )
    $files = Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue
    if ($extensions.Count -gt 0) {
        $files = $files | Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() }
    }
    foreach ($fragment in $ExcludeNameFragments) {
        $files = $files | Where-Object { $_.FullName -notlike "*$fragment*" }
    }
    $newest = $files |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($null -eq $newest) {
        return [pscustomobject][ordered]@{ path = $null; mtime = $null }
    }
    $relativePath = $newest.FullName.Substring($repoRoot.Length).TrimStart('\', '/')
    return [pscustomobject][ordered]@{
        path = $relativePath
        mtime = $newest.LastWriteTimeUtc.ToString('o')
    }
}

function Test-IsAfter {
    param(
        [string]$LeftIso,
        [string]$RightIso
    )
    if ([string]::IsNullOrWhiteSpace($LeftIso) -or [string]::IsNullOrWhiteSpace($RightIso)) {
        return $null
    }
    try {
        return ([datetime]::Parse($LeftIso).ToUniversalTime() -gt [datetime]::Parse($RightIso).ToUniversalTime())
    } catch {
        return $null
    }
}

function Get-Component {
    param(
        [object]$SupervisorStatus,
        [string]$Service
    )
    $components = ConvertTo-Array (Get-Prop $SupervisorStatus 'components')
    foreach ($component in $components) {
        if ((Get-Prop $component 'service') -eq $Service) {
            return $component
        }
    }
    return $null
}

function Test-ComponentRepoOwned {
    param([object]$Component)
    $state = [string](Get-Prop $Component 'state')
    $health = [string](Get-Prop $Component 'health')
    if ($state -eq 'blocked' -or $health -eq 'foreign_listener') {
        return $false
    }
    if ($state -eq 'running' -or $state -eq 'degraded') {
        return $true
    }
    return $false
}

function Get-BrowserProbe {
    $playwrightPackage = Join-Path $repoRoot 'web\node_modules\playwright\package.json'
    $msPlaywrightRoot = Join-Path $env:LOCALAPPDATA 'ms-playwright'
    $chromePaths = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
    )
    $systemBrowser = $chromePaths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not (Test-Path -LiteralPath $playwrightPackage)) {
        return [pscustomobject][ordered]@{
            status = 'missing-module'
            detail = 'web/node_modules/playwright is not installed'
            playwrightPackage = $playwrightPackage
            browserPath = $systemBrowser
        }
    }
    if (Test-Path -LiteralPath $msPlaywrightRoot) {
        return [pscustomobject][ordered]@{
            status = 'ready'
            detail = 'Playwright module and browser cache are present'
            playwrightPackage = $playwrightPackage
            browserPath = $msPlaywrightRoot
        }
    }
    if ($systemBrowser) {
        return [pscustomobject][ordered]@{
            status = 'system-browser-fallback'
            detail = 'Playwright module is present; a system Chromium browser is available'
            playwrightPackage = $playwrightPackage
            browserPath = $systemBrowser
        }
    }
    return [pscustomobject][ordered]@{
        status = 'missing-browser'
        detail = 'Playwright module is present, but no browser cache or system browser was found'
        playwrightPackage = $playwrightPackage
        browserPath = $null
    }
}

function Invoke-SupervisorStatus {
    if (-not (Test-Path -LiteralPath $supervisorScript)) {
        return [pscustomobject][ordered]@{
            ok = $false
            status = $null
            error = "Missing supervisor wrapper: $supervisorScript"
        }
    }
    try {
        $raw = & powershell -ExecutionPolicy Bypass -File $supervisorScript --json status quickstart 2>&1
        if ($LASTEXITCODE -ne 0) {
            return [pscustomobject][ordered]@{
                ok = $false
                status = $null
                error = ($raw -join [Environment]::NewLine)
            }
        }
        return [pscustomobject][ordered]@{
            ok = $true
            status = (($raw -join [Environment]::NewLine) | ConvertFrom-Json)
            error = $null
        }
    } catch {
        return [pscustomobject][ordered]@{
            ok = $false
            status = $null
            error = $_.Exception.Message
        }
    }
}

$supervisor = Invoke-SupervisorStatus
$supervisorStatus = Get-Prop $supervisor 'status'
$backendComponent = Get-Component $supervisorStatus 'backend-api'
$frontendComponent = Get-Component $supervisorStatus 'frontend-preview'

$backendPid = Get-Prop $backendComponent 'pid'
$frontendPid = Get-Prop $frontendComponent 'pid'
$backendProcess = Get-ProcessSnapshot -ProcessId $backendPid
$frontendProcess = Get-ProcessSnapshot -ProcessId $frontendPid
$backendPort = Get-ListenerProbe -Port 8000
$frontendPort = Get-ListenerProbe -Port 4173

$backendProbe = Invoke-HttpProbe -Url $backendUrl
$frontendProbe = Invoke-HttpProbe -Url $frontendUrl -Fingerprints @('Grit Backtest Platform')

$distIndex = Join-Path $repoRoot 'web\dist\index.html'
$frontendDistHash = $null
$frontendDistMtime = $null
if (Test-Path -LiteralPath $distIndex) {
    $frontendDistHash = (Get-FileHash -LiteralPath $distIndex -Algorithm SHA256).Hash.ToLowerInvariant()
    $frontendDistMtime = (Get-Item -LiteralPath $distIndex).LastWriteTimeUtc.ToString('o')
}

$backendNewest = Get-NewestFileMtime -Path (Join-Path $repoRoot 'src\grit_backtest_platform') -Include @('*.py')
$frontendNewest = Get-NewestFileMtime -Path (Join-Path $repoRoot 'web\src') -Include @('*.ts', '*.tsx', '*.css') -ExcludeNameFragments @('.test.', '.spec.', '\__tests__\')
$backendStartedAt = Get-Prop $backendProcess 'startedAt'
$backendStaleBySourceMtime = Test-IsAfter -LeftIso (Get-Prop $backendNewest 'mtime') -RightIso $backendStartedAt
$frontendDistStaleBySourceMtime = Test-IsAfter -LeftIso (Get-Prop $frontendNewest 'mtime') -RightIso $frontendDistMtime

$backendRepoOwned = Test-ComponentRepoOwned $backendComponent
$frontendRepoOwned = Test-ComponentRepoOwned $frontendComponent
$backendHealthy = ([bool](Get-Prop $backendProbe 'ok') -and [string](Get-Prop $backendComponent 'health') -eq 'healthy')
$frontendHealthy = ([bool](Get-Prop $frontendProbe 'ok') -and [bool](Get-Prop $frontendProbe 'fingerprintOk') -and [string](Get-Prop $frontendComponent 'health') -eq 'healthy')

$portProbeStatus = if ((Get-Prop $backendPort 'status') -eq 'ok' -and (Get-Prop $frontendPort 'status') -eq 'ok') { 'ok' } else { 'probe-degraded' }
$portProbeMethod = @((Get-Prop $backendPort 'method'), (Get-Prop $frontendPort 'method')) |
    Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
    Select-Object -Unique

$decision = 'reuse'
$restartReason = 'Current supervisor-owned runtime appears ready for live acceptance.'
$nextAction = 'Use a cache-busting live URL and proceed with browser/API verification.'

if (-not [bool](Get-Prop $supervisor 'ok')) {
    $decision = 'probe-degraded'
    $restartReason = Get-Prop $supervisor 'error'
    $nextAction = 'Do not restart automatically; inspect runtime supervisor availability first.'
} elseif ($portProbeStatus -ne 'ok') {
    $decision = 'probe-degraded'
    $restartReason = 'Port listener probing was degraded; ownership cannot be proven safely.'
    $nextAction = 'Inspect listener ownership before restarting or accepting a live route.'
} elseif (-not $backendRepoOwned -and (ConvertTo-Array (Get-Prop $backendPort 'pids')).Count -gt 0) {
    $decision = 'blocked-nonrepo-backend'
    $restartReason = 'Port 8000 is occupied by a listener the supervisor did not classify as repo-owned.'
    $nextAction = 'Stop or move the foreign 8000 listener before starting QuickStart.'
} elseif (-not $frontendRepoOwned -and (ConvertTo-Array (Get-Prop $frontendPort 'pids')).Count -gt 0) {
    $decision = 'blocked-nonrepo-frontend'
    $restartReason = 'Port 4173 is occupied by a listener the supervisor did not classify as repo-owned.'
    $nextAction = 'Stop or move the foreign 4173 listener before starting QuickStart.'
} elseif (-not $backendHealthy) {
    $decision = 'restart-backend-via-supervisor'
    $restartReason = 'Backend listener is missing or /healthz is unhealthy.'
    $nextAction = 'Run scripts/runtime-supervisor.ps1 restart backend-api --force --reason "preflight backend unhealthy".'
} elseif (-not $frontendHealthy) {
    $decision = 'restart-frontend-via-supervisor'
    $restartReason = 'Frontend preview is missing, unhealthy, or not serving the Grit app fingerprint.'
    $nextAction = 'Run scripts/runtime-supervisor.ps1 restart frontend-preview --force --reason "preflight frontend unhealthy".'
} elseif ($backendStaleBySourceMtime -eq $true) {
    $decision = 'restart-backend-via-supervisor'
    $restartReason = 'Backend source is newer than the running backend process.'
    $nextAction = 'Run scripts/runtime-supervisor.ps1 restart backend-api --force --reason "backend source changed".'
} elseif ($frontendDistStaleBySourceMtime -eq $true) {
    $decision = 'rebuild-frontend-and-restart-preview'
    $restartReason = 'Frontend source is newer than web/dist/index.html.'
    $nextAction = 'Run npm build from web, then restart frontend-preview through runtime supervisor.'
} elseif ($frontendDistHash -and (Get-Prop $frontendProbe 'contentHash') -and $frontendDistHash -ne (Get-Prop $frontendProbe 'contentHash')) {
    $decision = 'rebuild-frontend-and-restart-preview'
    $restartReason = 'The preview listener is not serving the current web/dist/index.html.'
    $nextAction = 'Rebuild web/dist and restart frontend-preview through runtime supervisor.'
}

$quickstartOverall = if ($decision -eq 'reuse') {
    'ready'
} elseif ($decision -like 'blocked-*' -or $decision -eq 'probe-degraded') {
    'blocked'
} else {
    'needs-action'
}

$browserProbe = Get-BrowserProbe
$currentDb = if ([string]::IsNullOrWhiteSpace($env:GRIT_BACKTEST_DB)) {
    Join-Path $repoRoot '.grit_backtest_platform.sqlite3'
} else {
    $env:GRIT_BACKTEST_DB
}

$result = [pscustomobject][ordered]@{
    schema = 'grit.runtime.preflight.v1'
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
    repoRoot = $repoRoot
    quickstartOverall = $quickstartOverall
    decision = $decision
    restartReason = $restartReason
    nextAction = $nextAction
    backendUrl = $backendUrl
    frontendUrl = $frontendUrl
    backendHealthy = $backendHealthy
    backendPid = $backendPid
    backendRepoOwned = $backendRepoOwned
    backendCommandLine = Get-Prop $backendProcess 'commandLine'
    backendProcessPath = Get-Prop $backendProcess 'path'
    backendCommandLineError = Get-Prop $backendProcess 'commandLineError'
    backendHealthz = $backendProbe
    backendDbEnvPath = $currentDb
    backendStartedAt = $backendStartedAt
    newestBackendSourceMtime = Get-Prop $backendNewest 'mtime'
    newestBackendSourcePath = Get-Prop $backendNewest 'path'
    backendStaleBySourceMtime = $backendStaleBySourceMtime
    frontendHealthy = $frontendHealthy
    frontendPid = $frontendPid
    frontendRepoOwned = $frontendRepoOwned
    frontendCommandLine = Get-Prop $frontendProcess 'commandLine'
    frontendProcessPath = Get-Prop $frontendProcess 'path'
    frontendCommandLineError = Get-Prop $frontendProcess 'commandLineError'
    frontendDistHash = $frontendDistHash
    frontendDistMtime = $frontendDistMtime
    frontendServedHash = Get-Prop $frontendProbe 'contentHash'
    newestFrontendSourceMtime = Get-Prop $frontendNewest 'mtime'
    newestFrontendSourcePath = Get-Prop $frontendNewest 'path'
    frontendDistStaleBySourceMtime = $frontendDistStaleBySourceMtime
    portProbeMethod = @($portProbeMethod)
    portProbeStatus = $portProbeStatus
    ports = [pscustomobject][ordered]@{
        backend = $backendPort
        frontend = $frontendPort
    }
    browserProbeStatus = Get-Prop $browserProbe 'status'
    browserProbe = $browserProbe
    supervisorStatus = $supervisorStatus
}

if ($Json) {
    $result | ConvertTo-Json -Depth 8
} else {
    Write-Host 'Grit runtime preflight'
    Write-Host ("  Overall : {0}" -f $result.quickstartOverall)
    Write-Host ("  Decision: {0}" -f $result.decision)
    Write-Host ("  Reason  : {0}" -f $result.restartReason)
    Write-Host ("  Action  : {0}" -f $result.nextAction)
    Write-Host ("  Backend : healthy={0} pid={1} repoOwned={2}" -f $result.backendHealthy, $result.backendPid, $result.backendRepoOwned)
    Write-Host ("  Frontend: healthy={0} pid={1} repoOwned={2}" -f $result.frontendHealthy, $result.frontendPid, $result.frontendRepoOwned)
    Write-Host ("  Browser : {0}" -f $result.browserProbeStatus)
}
