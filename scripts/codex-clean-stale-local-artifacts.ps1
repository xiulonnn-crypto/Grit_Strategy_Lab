[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$PruneExpired,
    [switch]$Json,
    [decimal]$MinFreeGB = 200,
    [int]$TmpRetentionDays = 7,
    [int]$PytestTmpPathRetentionDays = 2,
    [int]$OutputLogRetentionDays = 21,
    [int]$ArtifactRetentionDays = 21,
    [int]$RecoveryRetentionDays = 14,
    [int]$RecoveryKeepNewest = 5,
    [int]$RecoveryKeepNewestFullPairs = 1,
    [int]$RecoveryKeepNewestTargetedPreimages = 1,
    [switch]$IncludePitBulkCache,
    [int]$PitBulkCacheRetentionDays = 30,
    [switch]$ForceScan,
    [switch]$DetailedSkippedSizes,
    [switch]$FullJson,
    [string]$OnlyRelativePathPrefix,
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:CleanupStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$reportDir = Join-Path $repoRoot 'harness\reports\smoke'
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path $reportDir 'latest-local-artifact-cleanup.json'
}

$script:NormalizedOnlyRelativePathPrefix = $null
if (-not [string]::IsNullOrWhiteSpace($OnlyRelativePathPrefix)) {
    $script:NormalizedOnlyRelativePathPrefix = $OnlyRelativePathPrefix.Replace('\', '/').Trim('/')
}
$script:TrackedPathPrefixes = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$script:ProtectedRuntimeRelativePaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

function Initialize-TrackedPathCache {
    $trackedPaths = @(& git -C $repoRoot ls-files 2>$null)
    foreach ($path in $trackedPaths) {
        if ([string]::IsNullOrWhiteSpace($path)) {
            continue
        }
        $normalized = $path.Replace('\', '/').Trim('/')
        if ([string]::IsNullOrWhiteSpace($normalized)) {
            continue
        }
        [void]$script:TrackedPathPrefixes.Add($normalized)
        $parts = $normalized.Split('/')
        if ($parts.Count -le 1) {
            continue
        }
        $prefix = $parts[0]
        [void]$script:TrackedPathPrefixes.Add($prefix)
        for ($index = 1; $index -lt ($parts.Count - 1); $index++) {
            $prefix = "$prefix/$($parts[$index])"
            [void]$script:TrackedPathPrefixes.Add($prefix)
        }
    }
}

function Get-NormalizedFullPath {
    param([string]$PathValue)
    return [System.IO.Path]::GetFullPath($PathValue).TrimEnd([char]'\')
}

function Get-RelativeRepoPath {
    param([string]$FullPath)
    $normalizedRepo = Get-NormalizedFullPath -PathValue $repoRoot
    $normalizedPath = Get-NormalizedFullPath -PathValue $FullPath
    if (-not $normalizedPath.StartsWith($normalizedRepo, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the repository root: $normalizedPath"
    }
    return $normalizedPath.Substring($normalizedRepo.Length).TrimStart([char]'\').Replace('\', '/')
}

function Get-NormalizedRelativePath {
    param([string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($RelativePath)) {
        return ''
    }
    return $RelativePath.Replace('\', '/').Trim('/')
}

function Test-RelativePathInScope {
    param([string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($script:NormalizedOnlyRelativePathPrefix)) {
        return $true
    }
    $prefix = $script:NormalizedOnlyRelativePathPrefix
    $normalized = Get-NormalizedRelativePath -RelativePath $RelativePath
    return (
        $normalized -eq $prefix -or
        $normalized.StartsWith(($prefix + '/'), [System.StringComparison]::OrdinalIgnoreCase)
    )
}

function Test-ScanRootMayMatchScope {
    param([string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($script:NormalizedOnlyRelativePathPrefix)) {
        return $true
    }
    $prefix = $script:NormalizedOnlyRelativePathPrefix
    $normalized = Get-NormalizedRelativePath -RelativePath $RelativePath
    return (
        $normalized -eq $prefix -or
        $normalized.StartsWith(($prefix + '/'), [System.StringComparison]::OrdinalIgnoreCase) -or
        $prefix.StartsWith(($normalized + '/'), [System.StringComparison]::OrdinalIgnoreCase)
    )
}

function Test-WithinRepo {
    param([string]$FullPath)
    $normalizedRepo = Get-NormalizedFullPath -PathValue $repoRoot
    $normalizedPath = Get-NormalizedFullPath -PathValue $FullPath
    return $normalizedPath.StartsWith($normalizedRepo, [System.StringComparison]::OrdinalIgnoreCase)
}

function Resolve-RepoRelativeOrAbsolutePath {
    param([string]$PathValue)
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }
    $expanded = [System.Environment]::ExpandEnvironmentVariables($PathValue)
    if ([System.IO.Path]::IsPathRooted($expanded)) {
        return Get-NormalizedFullPath -PathValue $expanded
    }
    return Get-NormalizedFullPath -PathValue (Join-Path $repoRoot $expanded)
}

function Get-CompanionMarketDataPath {
    param([string]$WorkspaceDbPath)
    if ([string]::IsNullOrWhiteSpace($WorkspaceDbPath)) {
        return $null
    }
    $directory = Split-Path -Parent $WorkspaceDbPath
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($WorkspaceDbPath)
    return Get-NormalizedFullPath -PathValue (Join-Path $directory ("{0}_market_data.sqlite3" -f $stem))
}

function Test-PathUnderRepoRelativeRoot {
    param(
        [string]$FullPath,
        [string]$RelativeRoot
    )
    if ([string]::IsNullOrWhiteSpace($FullPath)) {
        return $false
    }
    $root = Get-NormalizedFullPath -PathValue (Join-Path $repoRoot $RelativeRoot)
    $path = Get-NormalizedFullPath -PathValue $FullPath
    return (
        $path -eq $root -or
        $path.StartsWith(($root + [System.IO.Path]::DirectorySeparatorChar), [System.StringComparison]::OrdinalIgnoreCase)
    )
}

function Add-ProtectedRuntimePath {
    param([string]$FullPath)
    if ([string]::IsNullOrWhiteSpace($FullPath)) {
        return
    }
    foreach ($candidate in @($FullPath, "$FullPath-wal", "$FullPath-shm")) {
        if (Test-WithinRepo -FullPath $candidate) {
            $relative = Get-RelativeRepoPath -FullPath $candidate
            if (-not [string]::IsNullOrWhiteSpace($relative)) {
                [void]$script:ProtectedRuntimeRelativePaths.Add($relative.Trim('/'))
            }
        }
    }
}

function Get-FileSizeGBOrNull {
    param([string]$FullPath)
    if ([string]::IsNullOrWhiteSpace($FullPath) -or -not (Test-Path -LiteralPath $FullPath -PathType Leaf)) {
        return $null
    }
    $item = Get-Item -LiteralPath $FullPath -Force
    return [math]::Round(($item.Length / 1GB), 3)
}

function Test-ReparsePoint {
    param([System.IO.FileSystemInfo]$Item)
    return (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Get-TrackedCount {
    param([string]$FullPath)
    $relativePath = Get-RelativeRepoPath -FullPath $FullPath
    if ($script:TrackedPathPrefixes.Contains($relativePath.Trim('/'))) {
        return 1
    }
    return 0
}

function Get-PathSizeBytes {
    param([System.IO.FileSystemInfo]$Item)
    if (-not $Item.PSIsContainer) {
        return [int64]$Item.Length
    }
    $measure = (
        Get-ChildItem -LiteralPath $Item.FullName -Recurse -Force -File -ErrorAction SilentlyContinue |
            Where-Object { -not (Test-ReparsePoint -Item $_) } |
            Measure-Object -Property Length -Sum
    )
    if ($null -eq $measure) {
        return [int64]0
    }
    $sum = $measure.Sum
    if ($null -eq $sum) {
        return [int64]0
    }
    return [int64]$sum
}

function Get-ObjectCount {
    param([object]$Items)
    if ($null -eq $Items) {
        return 0
    }
    if ($Items -is [System.Collections.ICollection]) {
        return $Items.Count
    }
    return @($Items).Count
}

function Get-ByteSum {
    param(
        [object]$Items,
        [string]$PropertyName
    )
    $sum = [int64]0
    if ($null -eq $Items) {
        return $sum
    }
    foreach ($item in $Items) {
        if ($null -eq $item) {
            continue
        }
        $property = $item.PSObject.Properties[$PropertyName]
        if ($null -eq $property -or $null -eq $property.Value) {
            continue
        }
        $sum += [int64]$property.Value
    }
    return $sum
}

function Get-NumberSum {
    param(
        [object]$Items,
        [string]$PropertyName
    )
    $sum = [decimal]0
    if ($null -eq $Items) {
        return $sum
    }
    foreach ($item in $Items) {
        if ($null -eq $item) {
            continue
        }
        $property = $item.PSObject.Properties[$PropertyName]
        if ($null -eq $property -or $null -eq $property.Value) {
            continue
        }
        $sum += [decimal]$property.Value
    }
    return $sum
}

function Get-CurrentFreeGB {
    $driveRoot = [System.IO.Path]::GetPathRoot($repoRoot)
    $drive = New-Object System.IO.DriveInfo($driveRoot)
    return [math]::Round(($drive.AvailableFreeSpace / 1GB), 3)
}

function Get-Cutoff {
    param([int]$Days)
    return (Get-Date).AddDays(-1 * $Days)
}

function Add-Candidate {
    param(
        [System.Collections.Generic.List[object]]$List,
        [System.IO.FileSystemInfo]$Item,
        [string]$Policy,
        [string]$Reason,
        [int]$RetentionDays,
        [int]$Priority,
        [switch]$Protected
    )

    $relativePath = $null
    $sizeBytes = [int64]0
    $trackedCount = 0
    $skipReason = $null
    $eligible = $true

    try {
        if (-not (Test-WithinRepo -FullPath $Item.FullName)) {
            $eligible = $false
            $skipReason = 'outside-repo'
        } elseif (Test-ReparsePoint -Item $Item) {
            $eligible = $false
            $skipReason = 'reparse-point'
        } elseif ($Item.LastWriteTime -ge (Get-Cutoff -Days $RetentionDays)) {
            $eligible = $false
            $skipReason = 'too-new'
        }

        $relativePath = Get-RelativeRepoPath -FullPath $Item.FullName
        if ($relativePath -in @(
            '.grit_backtest_platform.sqlite3',
            '.grit_backtest_platform.sqlite3-wal',
            '.grit_backtest_platform.sqlite3-shm',
            '.grit_backtest_platform_market_data.sqlite3',
            '.grit_backtest_platform_market_data.sqlite3-wal',
            '.grit_backtest_platform_market_data.sqlite3-shm'
        )) {
            $eligible = $false
            $skipReason = 'runtime-db'
        }
        if ($script:ProtectedRuntimeRelativePaths.Contains($relativePath.Trim('/'))) {
            $eligible = $false
            $skipReason = 'runtime-db'
        }
        if (-not (Test-RelativePathInScope -RelativePath $relativePath)) {
            return
        }
        $trackedCount = Get-TrackedCount -FullPath $Item.FullName
        if ($trackedCount -gt 0) {
            $eligible = $false
            $skipReason = "git-tracked:$trackedCount"
        }
        if ($Protected) {
            $eligible = $false
            $skipReason = 'protected'
        }
        if ($eligible -or $DetailedSkippedSizes) {
            $sizeBytes = Get-PathSizeBytes -Item $Item
        }
    } catch {
        $eligible = $false
        $skipReason = "inspect-failed:$($_.Exception.Message)"
    }

    [void]$List.Add([pscustomobject][ordered]@{
        policy = $Policy
        reason = $Reason
        eligible = $eligible
        skipReason = $skipReason
        priority = $Priority
        retentionDays = $RetentionDays
        lastWriteTime = $Item.LastWriteTime.ToString('o')
        sizeBytes = $sizeBytes
        sizeGB = [math]::Round(($sizeBytes / 1GB), 3)
        trackedCount = $trackedCount
        path = $relativePath
        fullPath = $Item.FullName
    })
}

function Add-ChildrenByPattern {
    param(
        [System.Collections.Generic.List[object]]$List,
        [string]$BaseRelativePath,
        [string[]]$Patterns,
        [string]$Policy,
        [string]$Reason,
        [int]$RetentionDays,
        [int]$Priority
    )

    $basePath = Join-Path $repoRoot $BaseRelativePath
    if (-not (Test-ScanRootMayMatchScope -RelativePath $BaseRelativePath)) {
        return
    }
    if (-not (Test-Path -LiteralPath $basePath)) {
        return
    }
    foreach ($pattern in $Patterns) {
        $items = @(Get-ChildItem -LiteralPath $basePath -Force -Filter $pattern -ErrorAction SilentlyContinue)
        foreach ($item in $items) {
            Add-Candidate -List $List -Item $item -Policy $Policy -Reason $Reason -RetentionDays $RetentionDays -Priority $Priority
        }
    }
}

function Add-DirectPath {
    param(
        [System.Collections.Generic.List[object]]$List,
        [string]$RelativePath,
        [string]$Policy,
        [string]$Reason,
        [int]$RetentionDays,
        [int]$Priority
    )

    $path = Join-Path $repoRoot $RelativePath
    if (-not (Test-ScanRootMayMatchScope -RelativePath $RelativePath)) {
        return
    }
    $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if ($null -ne $item) {
        Add-Candidate -List $List -Item $item -Policy $Policy -Reason $Reason -RetentionDays $RetentionDays -Priority $Priority
    }
}

function Test-RecoveryFullPairDir {
    param([System.IO.DirectoryInfo]$Directory)
    return (
        (Test-Path -LiteralPath (Join-Path $Directory.FullName '.grit_backtest_platform.sqlite3')) -and
        (Test-Path -LiteralPath (Join-Path $Directory.FullName '.grit_backtest_platform_market_data.sqlite3'))
    )
}

function Test-RecoveryTargetedPreimageDir {
    param([System.IO.DirectoryInfo]$Directory)
    return (
        (Test-Path -LiteralPath (Join-Path $Directory.FullName 'targeted-preimage-ds-price-symbols.json')) -or
        (Test-Path -LiteralPath (Join-Path $Directory.FullName 'pit-price-preimage.json'))
    )
}

function Test-RecoveryManifestDir {
    param([System.IO.DirectoryInfo]$Directory)
    return (
        (Test-Path -LiteralPath (Join-Path $Directory.FullName 'manifest.json')) -or
        (Test-Path -LiteralPath (Join-Path $Directory.FullName 'backup-manifest.json'))
    )
}

function Get-RecoveryDirLatestWriteTime {
    param([System.IO.DirectoryInfo]$Directory)
    $latest = (
        Get-ChildItem -LiteralPath $Directory.FullName -Force -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
    )
    if ($null -ne $latest) {
        return $latest.LastWriteTime
    }
    return $Directory.LastWriteTime
}

function Add-RecoverySqliteFileCandidates {
    param(
        [System.Collections.Generic.List[object]]$List,
        [System.IO.DirectoryInfo]$Directory,
        [string]$Reason
    )
    $dbFiles = @(
        Get-ChildItem -LiteralPath $Directory.FullName -Force -File -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -like '.grit_backtest_platform*.sqlite3' -or
                $_.Name -like '.grit_backtest_platform*.sqlite3.before'
            }
    )
    foreach ($dbFile in $dbFiles) {
        Add-Candidate -List $List -Item $dbFile -Policy 'recovery-l1-full-db-superseded' -Reason $Reason -RetentionDays 0 -Priority 1
    }
}

function Add-RecoveryCandidates {
    param([System.Collections.Generic.List[object]]$List)
    if (-not (Test-ScanRootMayMatchScope -RelativePath 'artifacts\recovery')) {
        return
    }
    $recoveryRoot = Join-Path $repoRoot 'artifacts\recovery'
    if (-not (Test-Path -LiteralPath $recoveryRoot)) {
        return
    }
    $items = @(
        Get-ChildItem -LiteralPath $recoveryRoot -Force -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending
    )
    $directories = @($items | Where-Object { $_.PSIsContainer })
    $protectedFullPairDirs = @(
        $directories |
            Where-Object { Test-RecoveryFullPairDir -Directory $_ } |
            Sort-Object @{ Expression = { Get-RecoveryDirLatestWriteTime -Directory $_ } } -Descending |
            Select-Object -First $RecoveryKeepNewestFullPairs |
            ForEach-Object { $_.FullName }
    )
    $protectedTargetedPreimageDirs = @(
        $directories |
            Where-Object { Test-RecoveryTargetedPreimageDir -Directory $_ } |
            Sort-Object @{ Expression = { Get-RecoveryDirLatestWriteTime -Directory $_ } } -Descending |
            Select-Object -First $RecoveryKeepNewestTargetedPreimages |
            ForEach-Object { $_.FullName }
    )
    $kept = 0
    foreach ($item in $items) {
        if ($item.PSIsContainer -and $protectedFullPairDirs -contains $item.FullName) {
            Add-Candidate -List $List -Item $item -Policy 'recovery-protected-latest-full-pair' -Reason "retained as newest $RecoveryKeepNewestFullPairs full DB backup pair" -RetentionDays 365000 -Priority 40 -Protected
            continue
        }
        if ($item.PSIsContainer -and $protectedTargetedPreimageDirs -contains $item.FullName) {
            Add-Candidate -List $List -Item $item -Policy 'recovery-protected-targeted-preimage' -Reason "retained as newest $RecoveryKeepNewestTargetedPreimages targeted PIT preimage backup" -RetentionDays 365000 -Priority 40 -Protected
            continue
        }
        if (
            $item.PSIsContainer -and
            $item.Name -like 'l1-*' -and
            (
                (Test-Path -LiteralPath (Join-Path $item.FullName '.grit_backtest_platform.sqlite3')) -or
                (Test-Path -LiteralPath (Join-Path $item.FullName '.grit_backtest_platform_market_data.sqlite3')) -or
                (Test-Path -LiteralPath (Join-Path $item.FullName '.grit_backtest_platform.sqlite3.before')) -or
                (Test-Path -LiteralPath (Join-Path $item.FullName '.grit_backtest_platform_market_data.sqlite3.before'))
            )
        ) {
            $reason = 'superseded L1 full database backup; active DB, newest full pair, and latest targeted preimage are protected'
            if (Test-RecoveryManifestDir -Directory $item) {
                Add-RecoverySqliteFileCandidates -List $List -Directory $item -Reason "$reason; manifest preserved"
            } else {
                Add-Candidate -List $List -Item $item -Policy 'recovery-l1-full-db-superseded' -Reason $reason -RetentionDays 0 -Priority 1
            }
            continue
        }
        if ($item.PSIsContainer -and (Test-RecoveryManifestDir -Directory $item)) {
            Add-Candidate -List $List -Item $item -Policy 'recovery-protected-manifest-evidence' -Reason 'retained recovery manifest/source evidence; only superseded DB payloads are cleanup targets' -RetentionDays 365000 -Priority 40 -Protected
            continue
        }
        $reason = 'artifacts/recovery entry older than retention'
        $retentionDays = $RecoveryRetentionDays
        if ($kept -lt $RecoveryKeepNewest) {
            $kept += 1
            $retentionDays = 365000
            $reason = "retained as one of newest $RecoveryKeepNewest recovery entries"
            Add-Candidate -List $List -Item $item -Policy 'recovery-retention' -Reason $reason -RetentionDays $retentionDays -Priority 40 -Protected
            continue
        }
        Add-Candidate -List $List -Item $item -Policy 'recovery-retention' -Reason $reason -RetentionDays $retentionDays -Priority 40
    }
}

$activeWorkspaceDbSource = if ([string]::IsNullOrWhiteSpace($env:GRIT_BACKTEST_DB)) { 'default-root' } else { 'GRIT_BACKTEST_DB' }
$activeWorkspaceDbPath = if ([string]::IsNullOrWhiteSpace($env:GRIT_BACKTEST_DB)) {
    Get-NormalizedFullPath -PathValue (Join-Path $repoRoot '.grit_backtest_platform.sqlite3')
} else {
    Resolve-RepoRelativeOrAbsolutePath -PathValue $env:GRIT_BACKTEST_DB
}
$activeMarketDbPath = Get-CompanionMarketDataPath -WorkspaceDbPath $activeWorkspaceDbPath
$activeWorkspaceDbInRecovery = Test-PathUnderRepoRelativeRoot -FullPath $activeWorkspaceDbPath -RelativeRoot 'artifacts\recovery'
$activeMarketDbInRecovery = Test-PathUnderRepoRelativeRoot -FullPath $activeMarketDbPath -RelativeRoot 'artifacts\recovery'
$activeDbGuardStatus = if ($activeWorkspaceDbInRecovery -or $activeMarketDbInRecovery) {
    'blocked-active-db-under-recovery'
} else {
    'ok'
}
Add-ProtectedRuntimePath -FullPath $activeWorkspaceDbPath
Add-ProtectedRuntimePath -FullPath $activeMarketDbPath

New-Item -ItemType Directory -Path (Split-Path -Parent $ReportPath) -Force | Out-Null

$freeBeforeGB = Get-CurrentFreeGB
$targetFreeGB = [decimal]$MinFreeGB
$scanSkippedReason = $null

if ($activeDbGuardStatus -ne 'ok') {
    $summary = [pscustomobject][ordered]@{
        generatedAt = (Get-Date).ToString('o')
        repoRoot = $repoRoot
        apply = [bool]$Apply
        pruneExpired = [bool]$PruneExpired
        forceScan = [bool]$ForceScan
        minFreeGB = $MinFreeGB
        onlyRelativePathPrefix = $OnlyRelativePathPrefix
        recoveryKeepNewestFullPairs = $RecoveryKeepNewestFullPairs
        recoveryKeepNewestTargetedPreimages = $RecoveryKeepNewestTargetedPreimages
        activeDbGuardStatus = $activeDbGuardStatus
        activeWorkspaceDbSource = $activeWorkspaceDbSource
        activeWorkspaceDbPath = $activeWorkspaceDbPath
        activeMarketDbPath = $activeMarketDbPath
        activeWorkspaceDbInRecovery = $activeWorkspaceDbInRecovery
        activeMarketDbInRecovery = $activeMarketDbInRecovery
        activeWorkspaceDbSizeGB = Get-FileSizeGBOrNull -FullPath $activeWorkspaceDbPath
        activeMarketDbSizeGB = Get-FileSizeGBOrNull -FullPath $activeMarketDbPath
        scanSkippedReason = 'active-db-under-recovery'
        elapsedSeconds = [math]::Round($script:CleanupStopwatch.Elapsed.TotalSeconds, 2)
        freeBeforeGB = $freeBeforeGB
        freeAfterGB = $freeBeforeGB
        candidateCount = 0
        eligibleCount = 0
        plannedCount = 0
        plannedGB = 0
        removedCount = 0
        removedGB = 0
        failedCount = 1
        failedGB = 0
        reportPath = $ReportPath
    }
    $report = [pscustomobject][ordered]@{
        summary = $summary
        removed = @()
        failed = @(
            [pscustomobject][ordered]@{
                path = $activeWorkspaceDbPath
                policy = 'active-db-guard'
                sizeGB = Get-FileSizeGBOrNull -FullPath $activeWorkspaceDbPath
                error = 'GRIT_BACKTEST_DB or its companion market-data DB points under artifacts/recovery'
            }
        )
        planned = @()
        skipped = @()
    }
    $reportJson = $report | ConvertTo-Json -Depth 8
    $reportJson | Set-Content -LiteralPath $ReportPath -Encoding utf8
    if ($Json -and $FullJson) {
        $reportJson
    } elseif ($Json) {
        $summary | ConvertTo-Json -Depth 4
    } else {
        $summary | Format-List
    }
    exit 2
}

if (
    -not $PruneExpired `
    -and -not $ForceScan `
    -and [string]::IsNullOrWhiteSpace($OnlyRelativePathPrefix) `
    -and $freeBeforeGB -ge $targetFreeGB
) {
    $scanSkippedReason = 'free-space-above-threshold'
    $summary = [pscustomobject][ordered]@{
        generatedAt = (Get-Date).ToString('o')
        repoRoot = $repoRoot
        apply = [bool]$Apply
        pruneExpired = [bool]$PruneExpired
        forceScan = [bool]$ForceScan
        minFreeGB = $MinFreeGB
        onlyRelativePathPrefix = $OnlyRelativePathPrefix
        recoveryKeepNewestFullPairs = $RecoveryKeepNewestFullPairs
        recoveryKeepNewestTargetedPreimages = $RecoveryKeepNewestTargetedPreimages
        activeDbGuardStatus = $activeDbGuardStatus
        activeWorkspaceDbSource = $activeWorkspaceDbSource
        activeWorkspaceDbPath = $activeWorkspaceDbPath
        activeMarketDbPath = $activeMarketDbPath
        activeWorkspaceDbInRecovery = $activeWorkspaceDbInRecovery
        activeMarketDbInRecovery = $activeMarketDbInRecovery
        activeWorkspaceDbSizeGB = Get-FileSizeGBOrNull -FullPath $activeWorkspaceDbPath
        activeMarketDbSizeGB = Get-FileSizeGBOrNull -FullPath $activeMarketDbPath
        scanSkippedReason = $scanSkippedReason
        elapsedSeconds = [math]::Round($script:CleanupStopwatch.Elapsed.TotalSeconds, 2)
        freeBeforeGB = $freeBeforeGB
        freeAfterGB = $freeBeforeGB
        candidateCount = 0
        eligibleCount = 0
        plannedCount = 0
        plannedGB = 0
        removedCount = 0
        removedGB = 0
        failedCount = 0
        failedGB = 0
        reportPath = $ReportPath
    }
    $report = [pscustomobject][ordered]@{
        summary = $summary
        removed = @()
        failed = @()
        planned = @()
        skipped = @()
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding utf8
    if ($Json) {
        $summary | ConvertTo-Json -Depth 4
    } else {
        $summary | Format-List
    }
    exit 0
}

Initialize-TrackedPathCache

$candidates = New-Object System.Collections.Generic.List[object]

Add-ChildrenByPattern -List $candidates -BaseRelativePath '.tmp' -Patterns @(
    'backup',
    'backups',
    'bench-*',
    'c-tmp-grit-relocated-*',
    'gate4-api-*',
    'grit-review-*',
    'mf-profile*',
    'opt-3s-*',
    'perf',
    'perf-*',
    'root-pytest-*',
    'root-temp-*',
    'run-repair-*'
) -Policy 'tmp-known-stale' -Reason 'known local temp, benchmark, repair, or backup directory' -RetentionDays $TmpRetentionDays -Priority 10

Add-ChildrenByPattern -List $candidates -BaseRelativePath '.tmp\pytest-runtime\tmp-paths' -Patterns @('*') -Policy 'pytest-tmp-paths' -Reason 'pytest tmp_path fixture output' -RetentionDays $PytestTmpPathRetentionDays -Priority 5
Add-ChildrenByPattern -List $candidates -BaseRelativePath '.tmp\pytest-runtime' -Patterns @('python-temp-*', 'codex-backend-*', 'factor-*', 'provider-unit') -Policy 'pytest-runtime' -Reason 'pytest runtime temp output' -RetentionDays $TmpRetentionDays -Priority 8
Add-ChildrenByPattern -List $candidates -BaseRelativePath 'output\logs\grit-coder' -Patterns @('codex-logs-archive-*') -Policy 'old-log-archive' -Reason 'old migrated Codex log archive' -RetentionDays $OutputLogRetentionDays -Priority 20

Add-ChildrenByPattern -List $candidates -BaseRelativePath 'artifacts' -Patterns @(
    '*before*.sqlite3',
    '*restore*.sqlite3',
    '*restart*.sqlite3',
    '*repair*.sqlite3',
    'run*-repair-*',
    'factor-diagnostic-backfill',
    'openbb-*',
    'provider-openbb-*'
) -Policy 'artifact-evidence-retention' -Reason 'old heavy evidence or database backup artifact' -RetentionDays $ArtifactRetentionDays -Priority 30

Add-RecoveryCandidates -List $candidates

if ($IncludePitBulkCache) {
    Add-DirectPath -List $candidates -RelativePath '.tmp\pit-bulk-cache' -Policy 'pit-bulk-cache' -Reason 'optional PIT bulk source cache' -RetentionDays $PitBulkCacheRetentionDays -Priority 50
}

$eligibleCandidates = @($candidates | Where-Object { $_.eligible -and $_.sizeBytes -gt 0 } | Sort-Object priority, lastWriteTime)
if (-not [string]::IsNullOrWhiteSpace($script:NormalizedOnlyRelativePathPrefix)) {
    $normalizedPrefix = $script:NormalizedOnlyRelativePathPrefix
    $eligibleCandidates = @(
        $eligibleCandidates |
            Where-Object {
                $_.path -eq $normalizedPrefix -or $_.path.StartsWith(($normalizedPrefix + '/'), [System.StringComparison]::OrdinalIgnoreCase)
            }
    )
}
$planned = New-Object System.Collections.Generic.List[object]

if ($PruneExpired) {
    foreach ($candidate in $eligibleCandidates) {
        [void]$planned.Add($candidate)
    }
} elseif ($freeBeforeGB -lt $targetFreeGB) {
    $plannedBytes = [int64]0
    $neededBytes = [int64](($targetFreeGB - $freeBeforeGB) * 1GB)
    foreach ($candidate in $eligibleCandidates) {
        [void]$planned.Add($candidate)
        $plannedBytes += [int64]$candidate.sizeBytes
        if ($plannedBytes -ge $neededBytes) {
            break
        }
    }
}

$removed = New-Object System.Collections.Generic.List[object]
$failed = New-Object System.Collections.Generic.List[object]

if ($Apply) {
    foreach ($candidate in $planned) {
        try {
            if (-not (Test-WithinRepo -FullPath $candidate.fullPath)) {
                throw 'outside-repo-before-delete'
            }
            if ((Get-TrackedCount -FullPath $candidate.fullPath) -gt 0) {
                throw 'git-tracked-before-delete'
            }
            Remove-Item -LiteralPath $candidate.fullPath -Recurse -Force -ErrorAction Stop
            [void]$removed.Add($candidate)
        } catch {
            [void]$failed.Add([pscustomobject][ordered]@{
                path = $candidate.path
                policy = $candidate.policy
                sizeGB = $candidate.sizeGB
                error = $_.Exception.Message
            })
        }
    }
}

$freeAfterGB = Get-CurrentFreeGB
$summary = [pscustomobject][ordered]@{
    generatedAt = (Get-Date).ToString('o')
    repoRoot = $repoRoot
    apply = [bool]$Apply
    pruneExpired = [bool]$PruneExpired
    forceScan = [bool]$ForceScan
    minFreeGB = $MinFreeGB
    onlyRelativePathPrefix = $OnlyRelativePathPrefix
    recoveryKeepNewestFullPairs = $RecoveryKeepNewestFullPairs
    recoveryKeepNewestTargetedPreimages = $RecoveryKeepNewestTargetedPreimages
    activeDbGuardStatus = $activeDbGuardStatus
    activeWorkspaceDbSource = $activeWorkspaceDbSource
    activeWorkspaceDbPath = $activeWorkspaceDbPath
    activeMarketDbPath = $activeMarketDbPath
    activeWorkspaceDbInRecovery = $activeWorkspaceDbInRecovery
    activeMarketDbInRecovery = $activeMarketDbInRecovery
    activeWorkspaceDbSizeGB = Get-FileSizeGBOrNull -FullPath $activeWorkspaceDbPath
    activeMarketDbSizeGB = Get-FileSizeGBOrNull -FullPath $activeMarketDbPath
    scanSkippedReason = $scanSkippedReason
    elapsedSeconds = [math]::Round($script:CleanupStopwatch.Elapsed.TotalSeconds, 2)
    freeBeforeGB = $freeBeforeGB
    freeAfterGB = $freeAfterGB
    candidateCount = Get-ObjectCount -Items $candidates
    eligibleCount = Get-ObjectCount -Items $eligibleCandidates
    plannedCount = Get-ObjectCount -Items $planned
    plannedGB = [math]::Round(((Get-ByteSum -Items $planned -PropertyName 'sizeBytes') / 1GB), 3)
    removedCount = Get-ObjectCount -Items $removed
    removedGB = [math]::Round(((Get-ByteSum -Items $removed -PropertyName 'sizeBytes') / 1GB), 3)
    failedCount = Get-ObjectCount -Items $failed
    failedGB = [math]::Round((Get-NumberSum -Items $failed -PropertyName 'sizeGB'), 3)
    reportPath = $ReportPath
}

$report = [pscustomobject][ordered]@{
    summary = $summary
    removed = @($removed.ToArray() | Select-Object policy, reason, sizeGB, retentionDays, lastWriteTime, path)
    failed = @($failed.ToArray())
    planned = @($planned.ToArray() | Select-Object policy, reason, sizeGB, retentionDays, lastWriteTime, path)
    skipped = @($candidates.ToArray() | Where-Object { -not $_.eligible } | Select-Object policy, reason, skipReason, sizeGB, retentionDays, lastWriteTime, path)
}

$reportJson = $report | ConvertTo-Json -Depth 8
$reportJson | Set-Content -LiteralPath $ReportPath -Encoding utf8

if ($Json -and $FullJson) {
    $reportJson
} elseif ($Json) {
    $summary | ConvertTo-Json -Depth 4
} else {
    $summary | Format-List
    if ($failed.Count -gt 0) {
        'Failed cleanup items:'
        $failed | Format-Table -AutoSize
    }
    if ($planned.Count -gt 0 -and -not $Apply) {
        'Dry-run planned cleanup items:'
        $planned | Select-Object -First 40 policy, sizeGB, lastWriteTime, path | Format-Table -AutoSize
    }
}

if ($failed.Count -gt 0) {
    exit 2
}
exit 0
