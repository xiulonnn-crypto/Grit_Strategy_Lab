[CmdletBinding()]
param(
    [string]$RuntimeHome,
    [string]$SourcePath,
    [switch]$ForceRecreate,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:QuickStartRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:QuickStartManifestPath = Join-Path $script:QuickStartRepoRoot '.python-runtime-manifest.json'
$script:QuickStartLegacyVenvConfigPath = Join-Path $script:QuickStartRepoRoot '.venv\pyvenv.cfg'
$script:QuickStartDefaultKnownSource = 'C:\Users\GRIT\AppData\Local\Programs\Python\Python314'
$script:QuickStartDefaultRuntimeHome = Join-Path $script:QuickStartRepoRoot '.python314-home'

function Get-QuickStartEffectiveRuntimeHome {
    param([string]$ConfiguredHome)

    if ([string]::IsNullOrWhiteSpace($ConfiguredHome)) {
        $ConfiguredHome = $env:GRIT_PYTHON_RUNTIME_HOME
    }
    if ([string]::IsNullOrWhiteSpace($ConfiguredHome)) {
        $ConfiguredHome = $script:QuickStartDefaultRuntimeHome
    }

    return [System.IO.Path]::GetFullPath($ConfiguredHome)
}

function Get-QuickStartEffectiveSourcePath {
    param(
        [string]$ConfiguredSourcePath,
        [string]$DefaultKnownSource
    )

    if ([string]::IsNullOrWhiteSpace($ConfiguredSourcePath)) {
        $ConfiguredSourcePath = $env:GRIT_PYTHON_RUNTIME_SOURCE
    }
    if ([string]::IsNullOrWhiteSpace($ConfiguredSourcePath)) {
        $ConfiguredSourcePath = $DefaultKnownSource
    }

    return $ConfiguredSourcePath
}

function Normalize-QuickStartPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\').ToLowerInvariant()
}

function Resolve-QuickStartDirectoryCandidate {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    $fullPath = [System.IO.Path]::GetFullPath($Value)
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        if ([System.IO.Path]::GetFileName($fullPath).Equals('python.exe', [System.StringComparison]::OrdinalIgnoreCase)) {
            return Split-Path -Parent $fullPath
        }
        return $null
    }

    if (Test-Path -LiteralPath $fullPath -PathType Container) {
        return $fullPath
    }

    return $null
}

function Get-QuickStartLegacyVenvHome {
    if (-not (Test-Path -LiteralPath $script:QuickStartLegacyVenvConfigPath)) {
        return $null
    }

    $homeLine = Get-Content -LiteralPath $script:QuickStartLegacyVenvConfigPath |
        Where-Object { $_ -match '^home\s*=' } |
        Select-Object -First 1

    if (-not $homeLine) {
        return $null
    }

    $homePath = ($homeLine -split '=', 2)[1].Trim()
    return (Resolve-QuickStartDirectoryCandidate -Value $homePath)
}

function Invoke-QuickStartPythonProbe {
    param(
        [string]$PythonExe,
        [version]$MinimumVersion = [version]'3.12.0'
    )

    if ([string]::IsNullOrWhiteSpace($PythonExe) -or -not (Test-Path -LiteralPath $PythonExe)) {
        return $null
    }

    $probe = "import json, sqlite3, struct, sys; print(json.dumps({'version': '.'.join(map(str, sys.version_info[:3])), 'executable': sys.executable, 'sqlite3_version': sqlite3.sqlite_version, 'sqlite3_ok': True, 'arch': struct.calcsize('P') * 8}))"

    try {
        $output = & $PythonExe -c $probe 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $output) {
            return $null
        }

        $info = ($output | Select-Object -Last 1) | ConvertFrom-Json
        $version = [version]$info.version
        if ($version -lt $MinimumVersion) {
            return $null
        }

        return [pscustomobject]@{
            RuntimeHome = Split-Path -Parent (Resolve-Path -LiteralPath $PythonExe).Path
            PythonExe = (Resolve-Path -LiteralPath $PythonExe).Path
            Version = $version.ToString()
            VersionObject = $version
            SQLiteVersion = $info.sqlite3_version
            SQLiteOk = [bool]$info.sqlite3_ok
            Architecture = [int]$info.arch
        }
    } catch {
        return $null
    }
}

function Get-QuickStartValidatedRuntimeInfo {
    param(
        [string]$RuntimeDirectory,
        [version]$MinimumVersion = [version]'3.12.0'
    )

    $resolvedHome = Resolve-QuickStartDirectoryCandidate -Value $RuntimeDirectory
    if (-not $resolvedHome) {
        return $null
    }

    $pythonExe = Join-Path $resolvedHome 'python.exe'
    return (Invoke-QuickStartPythonProbe -PythonExe $pythonExe -MinimumVersion $MinimumVersion)
}

function Get-QuickStartVenvEnvironmentState {
    param([string]$PreferredHome)

    $venvPath = Join-Path $script:QuickStartRepoRoot '.venv'
    $configuredHome = Get-QuickStartLegacyVenvHome

    return [pscustomobject]@{
        VenvPath = $venvPath
        ConfiguredHome = $configuredHome
        IsDerivedFromPreferred = (
            -not [string]::IsNullOrWhiteSpace($configuredHome) -and
            -not [string]::IsNullOrWhiteSpace($PreferredHome) -and
            (Normalize-QuickStartPath -Path $configuredHome) -eq (Normalize-QuickStartPath -Path $PreferredHome)
        )
    }
}

function Write-QuickStartRuntimeManifest {
    param(
        [Parameter(Mandatory)]
        [string]$PreferredHome,
        [Parameter(Mandatory)]
        [string]$EffectivePython,
        [Parameter(Mandatory)]
        [string]$SourceOrigin,
        [Parameter(Mandatory)]
        [bool]$PreferredIsReady,
        [Parameter(Mandatory)]
        [string]$RepairResult,
        [string]$LastRepairAttempt,
        [string]$ManifestPath = $script:QuickStartManifestPath,
        [string[]]$CheckedPaths = @(),
        [string]$AlignmentMode = 'unknown'
    )

    $venvState = Get-QuickStartVenvEnvironmentState -PreferredHome $PreferredHome
    $manifest = [pscustomobject]@{
        schema_version = '2.0'
        status = [pscustomobject]@{
            preferred_is_ready = $PreferredIsReady
            last_repair_attempt = $LastRepairAttempt
            repair_result = $RepairResult
        }
        runtime = [pscustomobject]@{
            preferred_home = $PreferredHome
            effective_python = $EffectivePython
            source_origin = $SourceOrigin
        }
        environment = [pscustomobject]@{
            venv_path = $venvState.VenvPath
            is_derived_from_preferred = $venvState.IsDerivedFromPreferred
            alignment_mode = $AlignmentMode
        }
        diagnostics = [pscustomobject]@{
            checked_paths_last = @($CheckedPaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        }
    }

    $tempPath = "$ManifestPath.tmp"
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $tempPath -Encoding UTF8
    Move-Item -LiteralPath $tempPath -Destination $ManifestPath -Force
    return $manifest
}

function Add-QuickStartSourceCandidate {
    param(
        [System.Collections.Generic.List[object]]$List,
        [hashtable]$Seen,
        [string]$Label,
        [string]$HomePath
    )

    if ([string]::IsNullOrWhiteSpace($HomePath)) {
        return
    }

    $normalized = Normalize-QuickStartPath -Path $HomePath
    if (-not $normalized -or $Seen.ContainsKey($normalized)) {
        return
    }

    $Seen[$normalized] = $true
    $List.Add([pscustomobject]@{
        Label = $Label
        HomePath = [System.IO.Path]::GetFullPath($HomePath)
    }) | Out-Null
}

function Get-QuickStartSourceCandidates {
    param(
        [string]$RuntimeHome,
        [string]$SourcePath,
        [string]$DefaultKnownSource = $script:QuickStartDefaultKnownSource
    )

    $items = New-Object 'System.Collections.Generic.List[object]'
    $seen = @{}

    Add-QuickStartSourceCandidate -List $items -Seen $seen -Label 'preferred-runtime-home' -HomePath $RuntimeHome
    Add-QuickStartSourceCandidate -List $items -Seen $seen -Label 'legacy-venv-home' -HomePath (Get-QuickStartLegacyVenvHome)

    $effectiveSource = Get-QuickStartEffectiveSourcePath -ConfiguredSourcePath $SourcePath -DefaultKnownSource $DefaultKnownSource
    Add-QuickStartSourceCandidate -List $items -Seen $seen -Label 'configured-source' -HomePath $effectiveSource
    Add-QuickStartSourceCandidate -List $items -Seen $seen -Label 'known-user-python314' -HomePath $DefaultKnownSource

    return $items.ToArray()
}

function Repair-QuickStartPreferredRuntime {
    param(
        [Parameter(Mandatory)]
        [string]$RuntimeHome,
        [Parameter(Mandatory)]
        [pscustomobject]$SourceInfo,
        [version]$MinimumVersion = [version]'3.12.0'
    )

    if ((Normalize-QuickStartPath -Path $SourceInfo.RuntimeHome) -eq (Normalize-QuickStartPath -Path $RuntimeHome)) {
        return (Get-QuickStartValidatedRuntimeInfo -RuntimeDirectory $RuntimeHome -MinimumVersion $MinimumVersion)
    }

    $tempHome = "$RuntimeHome.__new__"
    $backupHome = "$RuntimeHome.__old__"

    if (Test-Path -LiteralPath $tempHome) {
        Remove-Item -LiteralPath $tempHome -Recurse -Force
    }
    if (Test-Path -LiteralPath $backupHome) {
        Remove-Item -LiteralPath $backupHome -Recurse -Force
    }

    $parentDirectory = Split-Path -Parent $RuntimeHome
    if (-not [string]::IsNullOrWhiteSpace($parentDirectory) -and -not (Test-Path -LiteralPath $parentDirectory)) {
        New-Item -ItemType Directory -Path $parentDirectory -Force | Out-Null
    }

    New-Item -ItemType Directory -Path $tempHome -Force | Out-Null

    try {
        Get-ChildItem -LiteralPath $SourceInfo.RuntimeHome -Force | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $tempHome -Recurse -Force
        }

        $copiedInfo = Get-QuickStartValidatedRuntimeInfo -RuntimeDirectory $tempHome -MinimumVersion $MinimumVersion
        if (-not $copiedInfo) {
            throw "Copied runtime at $tempHome did not validate for Python >= $MinimumVersion with sqlite3 support."
        }

        if (Test-Path -LiteralPath $RuntimeHome) {
            Move-Item -LiteralPath $RuntimeHome -Destination $backupHome
        }

        Move-Item -LiteralPath $tempHome -Destination $RuntimeHome
        $finalInfo = Get-QuickStartValidatedRuntimeInfo -RuntimeDirectory $RuntimeHome -MinimumVersion $MinimumVersion
        if (-not $finalInfo) {
            throw "Preferred runtime at $RuntimeHome failed validation after replacement."
        }

        if (Test-Path -LiteralPath $backupHome) {
            Remove-Item -LiteralPath $backupHome -Recurse -Force
        }

        return $finalInfo
    } catch {
        if (Test-Path -LiteralPath $tempHome) {
            Remove-Item -LiteralPath $tempHome -Recurse -Force
        }
        if (-not (Test-Path -LiteralPath $RuntimeHome) -and (Test-Path -LiteralPath $backupHome)) {
            Move-Item -LiteralPath $backupHome -Destination $RuntimeHome
        }
        throw
    }
}

function Get-QuickStartFatalRuntimeMessage {
    param([string[]]$CheckedPaths)

    $checkedList = if ($CheckedPaths -and $CheckedPaths.Count -gt 0) {
        $CheckedPaths -join ', '
    } else {
        '(none)'
    }

    return "Fatal: No valid Python infrastructure found. Checked: $checkedList"
}

if ($MyInvocation.InvocationName -ne '.') {
    $resolvedRuntimeHome = Get-QuickStartEffectiveRuntimeHome -ConfiguredHome $RuntimeHome
    $runtimeInfo = Get-QuickStartValidatedRuntimeInfo -RuntimeDirectory $resolvedRuntimeHome
    if ($ValidateOnly -and -not $runtimeInfo) {
        throw "Preferred runtime is missing or invalid at $resolvedRuntimeHome."
    }
    if ($runtimeInfo) {
        Write-Host "Preferred Python runtime ready at $($runtimeInfo.PythonExe)" -ForegroundColor Green
        Write-Host "Manifest written to $script:QuickStartManifestPath" -ForegroundColor Green
    }
}
