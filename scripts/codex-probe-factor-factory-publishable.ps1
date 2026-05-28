[CmdletBinding()]
param(
    [string]$BackendBaseUrl = 'http://127.0.0.1:8000',
    [string]$DbPath = $(if ($env:GRIT_BACKTEST_DB) { $env:GRIT_BACKTEST_DB } else { '.grit_backtest_platform.sqlite3' }),
    [string]$FactorId = 's_f2_mom_raw_cur_external_fama_french_us_research_factors_monthly',
    [string]$Needle = 'Monthly|monthly',
    [string]$TaskSlug = 'factor-factory-publishable-probe',
    [string]$OutputRoot = 'output\logs\grit-coder',
    [int]$TimeoutSec = 15,
    [switch]$SkipPreflight,
    [switch]$SkipLineage,
    [switch]$ExpectPublishable,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskDir = Join-Path (Join-Path $repoRoot $OutputRoot) $TaskSlug
$preflightScript = Join-Path $repoRoot 'scripts\codex-grit-runtime-preflight.ps1'
$lineageScript = Join-Path $repoRoot 'scripts\factor_factory_lineage_preflight.py'
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$pythonExe = if (Test-Path $venvPython) { $venvPython } else { 'python' }

New-Item -ItemType Directory -Force -Path $taskDir | Out-Null

function Write-Utf8Text {
    param(
        [string]$Path,
        [string]$Text
    )
    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Write-JsonFile {
    param(
        [string]$Path,
        [object]$Value,
        [int]$Depth = 24
    )
    Write-Utf8Text -Path $Path -Text (($Value | ConvertTo-Json -Depth $Depth) + "`n")
}

function ConvertTo-JsonObject {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }
    try {
        return $Text | ConvertFrom-Json
    } catch {
        return $null
    }
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

function Get-NestedProp {
    param(
        [object]$Object,
        [string[]]$Path
    )
    $current = $Object
    foreach ($name in $Path) {
        $current = Get-Prop $current $name
        if ($null -eq $current) {
            return $null
        }
    }
    return $current
}

function Invoke-ApiJson {
    param([string]$Path)
    $base = $BackendBaseUrl.TrimEnd('/')
    $request = [System.Net.WebRequest]::Create("$base$Path")
    $request.Method = 'GET'
    $request.Accept = 'application/json'
    $request.Timeout = $TimeoutSec * 1000
    $response = $null
    $reader = $null
    try {
        $response = $request.GetResponse()
        $stream = $response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $text = $reader.ReadToEnd()
        return $text | ConvertFrom-Json
    } finally {
        if ($null -ne $reader) {
            $reader.Dispose()
        }
        if ($null -ne $response) {
            $response.Dispose()
        }
    }
}

function Invoke-Preflight {
    $outPath = Join-Path $taskDir 'runtime-preflight.json'
    if ($SkipPreflight) {
        return [pscustomobject][ordered]@{
            ok = $true
            skipped = $true
            output = $null
            quickstartOverall = $null
            decision = 'skipped'
            backendHealthy = $null
            frontendHealthy = $null
            nextAction = $null
        }
    }
    if (-not (Test-Path $preflightScript)) {
        return [pscustomobject][ordered]@{
            ok = $false
            skipped = $false
            output = $null
            error = "missing preflight script: $preflightScript"
        }
    }
    try {
        $stdout = (& powershell -NoProfile -ExecutionPolicy Bypass -File $preflightScript -Json) | Out-String
        Write-Utf8Text -Path $outPath -Text $stdout
        $payload = ConvertTo-JsonObject $stdout
        return [pscustomobject][ordered]@{
            ok = $null -ne $payload
            skipped = $false
            output = $outPath
            quickstartOverall = Get-Prop $payload 'quickstartOverall'
            decision = Get-Prop $payload 'decision'
            backendHealthy = Get-Prop $payload 'backendHealthy'
            frontendHealthy = Get-Prop $payload 'frontendHealthy'
            backendDbEnvPath = Get-Prop $payload 'backendDbEnvPath'
            frontendDistHash = Get-Prop $payload 'frontendDistHash'
            frontendServedHash = Get-Prop $payload 'frontendServedHash'
            nextAction = Get-Prop $payload 'nextAction'
        }
    } catch {
        return [pscustomobject][ordered]@{
            ok = $false
            skipped = $false
            output = $outPath
            error = $_.Exception.Message
        }
    }
}

function Invoke-Lineage {
    $outPath = Join-Path $taskDir 'lineage-preflight.json'
    if ($SkipLineage) {
        return [pscustomobject][ordered]@{
            ok = $true
            skipped = $true
            output = $null
            status = 'skipped'
        }
    }
    if (-not (Test-Path $lineageScript)) {
        return [pscustomobject][ordered]@{
            ok = $false
            skipped = $false
            output = $null
            error = "missing lineage script: $lineageScript"
        }
    }
    try {
        $stdout = (& $pythonExe $lineageScript --db $DbPath) | Out-String
        Write-Utf8Text -Path $outPath -Text $stdout
        $payload = ConvertTo-JsonObject $stdout
        return [pscustomobject][ordered]@{
            ok = $null -ne $payload
            skipped = $false
            output = $outPath
            status = Get-Prop $payload 'status'
            current_batch_id = Get-Prop $payload 'current_batch_id'
            source_job_id = Get-Prop $payload 'source_job_id'
            artifact_id = Get-Prop $payload 'artifact_id'
            quarantine_total = Get-Prop $payload 'quarantine_total'
            publishable_total = Get-Prop $payload 'publishable_total'
            preview_count = Get-Prop $payload 'preview_count'
            warnings = @(ConvertTo-Array (Get-Prop $payload 'warnings'))
            ui_summary_source = Get-Prop $payload 'ui_summary_source'
        }
    } catch {
        return [pscustomobject][ordered]@{
            ok = $false
            skipped = $false
            output = $outPath
            error = $_.Exception.Message
        }
    }
}

function Project-Candidate {
    param(
        [object]$Item,
        [string]$Source
    )
    $metrics = Get-Prop $Item 'candidate_metrics'
    $publishEligibility = Get-Prop $Item 'publish_eligibility'
    $id = [string](Get-Prop $Item 'id')
    $candidateId = [string](Get-Prop $Item 'candidate_id')
    $factorId = [string](Get-Prop $Item 'factor_id')
    if ([string]::IsNullOrWhiteSpace($factorId)) {
        $factorId = [string](Get-Prop $Item 'target_factor_id')
    }
    if ([string]::IsNullOrWhiteSpace($factorId)) {
        $factorId = [string](Get-Prop $Item 'factor_id')
    }
    $displayName = [string](Get-Prop $Item 'display_name_cn')
    if ([string]::IsNullOrWhiteSpace($displayName)) {
        $displayName = [string](Get-Prop $Item 'factor_name')
    }
    if ([string]::IsNullOrWhiteSpace($displayName)) {
        $displayName = [string](Get-Prop $Item 'name')
    }
    [pscustomobject][ordered]@{
        source = $Source
        id = $id
        candidate_id = $candidateId
        factor_id = $factorId
        source_mining_job_id = Get-Prop $Item 'source_mining_job_id'
        external_import_job_id = Get-Prop $metrics 'external_import_job_id'
        external_dataset_key = Get-Prop $metrics 'external_dataset_key'
        status = Get-Prop $Item 'status'
        publish_status = Get-Prop $Item 'publish_status'
        quarantine_status = Get-Prop $Item 'quarantine_status'
        quarantine_result = Get-Prop $Item 'quarantine_result'
        publish_eligibility_status = Get-Prop $publishEligibility 'status'
        display_name_cn = $displayName
        factor_name = Get-Prop $Item 'factor_name'
        expression = Get-Prop $Item 'expression'
        created_at = Get-Prop $Item 'created_at'
        updated_at = Get-Prop $Item 'updated_at'
    }
}

function Test-CandidateMatch {
    param([object]$Candidate)
    $identityParts = @(
        Get-Prop $Candidate 'id'
        Get-Prop $Candidate 'candidate_id'
        Get-Prop $Candidate 'factor_id'
    ) | ForEach-Object { [string]$_ }
    if (-not [string]::IsNullOrWhiteSpace($FactorId)) {
        foreach ($part in $identityParts) {
            if (-not [string]::IsNullOrWhiteSpace($part) -and $part -ieq $FactorId) {
                return $true
            }
        }
        return $false
    }
    $parts = @(
        $identityParts
        Get-Prop $Candidate 'source_mining_job_id'
        Get-Prop $Candidate 'external_import_job_id'
        Get-Prop $Candidate 'external_dataset_key'
        Get-Prop $Candidate 'display_name_cn'
        Get-Prop $Candidate 'factor_name'
        Get-Prop $Candidate 'expression'
    ) | ForEach-Object { [string]$_ }
    $haystack = ($parts -join "`n")
    if (-not [string]::IsNullOrWhiteSpace($Needle)) {
        return [regex]::IsMatch($haystack, $Needle, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
    return $false
}

function Get-NormalizedState {
    param(
        [object]$Candidate,
        [string]$Name
    )
    $value = [string](Get-Prop $Candidate $Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        return ''
    }
    return $value.Trim().ToUpperInvariant()
}

function Test-AnyState {
    param(
        [object]$Candidate,
        [string]$State
    )
    $expected = $State.Trim().ToUpperInvariant()
    foreach ($name in @('status', 'publish_status', 'publish_eligibility_status', 'quarantine_status', 'quarantine_result')) {
        if ((Get-NormalizedState -Candidate $Candidate -Name $name) -eq $expected) {
            return $true
        }
    }
    return $false
}

function Test-EligibleExternalCandidate {
    param([object]$Candidate)
    $status = Get-NormalizedState -Candidate $Candidate -Name 'status'
    $publishStatus = Get-NormalizedState -Candidate $Candidate -Name 'publish_status'
    $eligibility = Get-NormalizedState -Candidate $Candidate -Name 'publish_eligibility_status'
    $passed = $status -in @('PASS', 'PASSED', 'ELIGIBLE')
    $eligible = $publishStatus -eq 'ELIGIBLE' -or $eligibility -eq 'ELIGIBLE'
    return $passed -and $eligible
}

function Find-Matches {
    param(
        [object[]]$Items,
        [string]$Source
    )
    $projected = foreach ($item in $Items) {
        Project-Candidate -Item $item -Source $Source
    }
    return @($projected | Where-Object { Test-CandidateMatch $_ })
}

$preflight = Invoke-Preflight
$lineage = Invoke-Lineage
$overview = $null
$overviewError = $null
try {
    $overview = Invoke-ApiJson '/factor-factory/overview'
} catch {
    $overviewError = $_.Exception.Message
}

$externalItems = @(ConvertTo-Array (Get-NestedProp $overview @('external_import_quarantine', 'items')))
$publishableItems = @(ConvertTo-Array (Get-Prop $overview 'publishable_factors'))
$quarantineItems = @(ConvertTo-Array (Get-NestedProp $overview @('quarantine', 'items')))
$resultRows = @(ConvertTo-Array (Get-Prop $overview 'quarantine_result_rows'))

$externalMatches = @(Find-Matches -Items $externalItems -Source 'external_import_quarantine')
$publishableMatches = @(Find-Matches -Items $publishableItems -Source 'publishable_factors')
$quarantineMatches = @(Find-Matches -Items $quarantineItems -Source 'quarantine.items')
$resultRowMatches = @(Find-Matches -Items $resultRows -Source 'quarantine_result_rows')

$externalPresent = $externalMatches.Count -gt 0
$publishablePresent = $publishableMatches.Count -gt 0
$allMatches = @($externalMatches + $publishableMatches + $quarantineMatches + $resultRowMatches)
$publishedMatches = @($allMatches | Where-Object { Test-AnyState -Candidate $_ -State 'PUBLISHED' })
$eligibleExternalMatches = @($externalMatches | Where-Object { Test-EligibleExternalCandidate -Candidate $_ })
$publishedPresent = $publishedMatches.Count -gt 0
$eligibleExternalPresent = $eligibleExternalMatches.Count -gt 0
$likelyGap = if ($null -ne $overviewError) {
    'overview_unavailable'
} elseif ($publishablePresent) {
    'publishable_present'
} elseif ($publishedPresent) {
    'already_published_not_pending'
} elseif ($eligibleExternalPresent) {
    'external_b3_present_b4_publishable_missing'
} elseif ($externalPresent) {
    'external_present_not_publishable_state'
} elseif (-not $externalPresent -and -not $publishablePresent) {
    'factor_missing_from_b3_and_b4'
} else {
    'unknown'
}

$status = if ($ExpectPublishable -and -not $publishablePresent -and -not $publishedPresent) {
    'FAIL'
} elseif ($null -ne $overviewError -or -not [bool](Get-Prop $preflight 'ok') -or -not [bool](Get-Prop $lineage 'ok')) {
    'WARN'
} else {
    'PASS'
}

$summaryPath = Join-Path $taskDir 'publishable-probe-summary.json'
$summary = [pscustomobject][ordered]@{
    schema = 'grit.factor_factory_publishable_probe.v1'
    status = $status
    ok = $status -ne 'FAIL'
    query = [pscustomobject][ordered]@{
        factor_id = $FactorId
        needle = $Needle
        backend_base_url = $BackendBaseUrl
        db_path = $DbPath
    }
    outputs = [pscustomobject][ordered]@{
        summary = $summaryPath
        task_dir = $taskDir
    }
    preflight = $preflight
    lineage = $lineage
    overview = [pscustomobject][ordered]@{
        ok = $null -eq $overviewError
        error = $overviewError
        external_import_quarantine_count = $externalItems.Count
        publishable_factors_count = $publishableItems.Count
        quarantine_items_count = $quarantineItems.Count
        quarantine_result_rows_count = $resultRows.Count
    }
    matches = [pscustomobject][ordered]@{
        external_import_quarantine = $externalMatches
        publishable_factors = $publishableMatches
        quarantine_items = $quarantineMatches
        quarantine_result_rows = $resultRowMatches
    }
    diagnosis = [pscustomobject][ordered]@{
        external_present = $externalPresent
        publishable_present = $publishablePresent
        eligible_external_present = $eligibleExternalPresent
        published_present = $publishedPresent
        likely_gap = $likelyGap
    }
}

Write-JsonFile -Path $summaryPath -Value $summary -Depth 32

if ($Json) {
    $summary | ConvertTo-Json -Depth 32
} else {
    Write-Output ("status={0} external={1} publishable={2} gap={3} summary={4}" -f $status, $externalPresent, $publishablePresent, $likelyGap, $summaryPath)
}

if ($status -eq 'FAIL') {
    exit 1
}
