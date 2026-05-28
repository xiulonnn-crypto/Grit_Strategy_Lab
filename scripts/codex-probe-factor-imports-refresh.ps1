[CmdletBinding()]
param(
    [string]$BackendBaseUrl = 'http://127.0.0.1:8000',
    [switch]$Json,
    [switch]$ExpectSubmitted,
    [switch]$ExpectPendingPrecheck,
    [string]$SourceId = '',
    [string]$DatasetKey = '',
    [string]$JobId = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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

function Invoke-ApiJson {
    param([string]$Path)
    $base = $BackendBaseUrl.TrimEnd('/')
    return Invoke-RestMethod -Uri "$base$Path" -TimeoutSec 10
}

function Get-TimeScore {
    param([object]$Value)
    if ($null -eq $Value) {
        return 0
    }
    try {
        return [DateTimeOffset]::Parse([string]$Value).ToUnixTimeSeconds()
    } catch {
        return 0
    }
}

function Normalize-Token {
    param([object]$Value)
    return ([string]$Value).Trim()
}

function Test-OptionalMatch {
    param(
        [object]$Actual,
        [string]$Expected
    )
    $expectedValue = Normalize-Token $Expected
    if ([string]::IsNullOrWhiteSpace($expectedValue)) {
        return $true
    }
    return (Normalize-Token $Actual) -eq $expectedValue
}

function Add-JobCandidate {
    param(
        [System.Collections.Generic.List[object]]$Candidates,
        [object]$Item,
        [string]$Id,
        [string]$Source
    )
    if ([string]::IsNullOrWhiteSpace($Id)) {
        return
    }
    $candidateMetrics = Get-Prop $Item 'candidate_metrics'
    $sourceId = Get-Prop $Item 'source_id'
    if ([string]::IsNullOrWhiteSpace([string]$sourceId)) {
        $sourceId = Get-Prop $candidateMetrics 'external_source_id'
    }
    if ([string]::IsNullOrWhiteSpace([string]$sourceId)) {
        $sourceId = Get-Prop $candidateMetrics 'source_id'
    }
    $datasetKey = Get-Prop $Item 'dataset_key'
    if ([string]::IsNullOrWhiteSpace([string]$datasetKey)) {
        $datasetKey = Get-Prop $candidateMetrics 'external_dataset_key'
    }
    if ([string]::IsNullOrWhiteSpace([string]$datasetKey)) {
        $datasetKey = Get-Prop $candidateMetrics 'dataset_key'
    }
    $scores = @(
        Get-TimeScore (Get-Prop $Item 'updated_at')
        Get-TimeScore (Get-Prop $Item 'submitted_at')
        Get-TimeScore (Get-Prop $Item 'published_at')
        Get-TimeScore (Get-Prop $Item 'created_at')
    )
    $score = ($scores | Measure-Object -Maximum).Maximum
    [void]$Candidates.Add([pscustomobject][ordered]@{
        id = $Id
        source = $Source
        score = [int64]$score
        status = Get-Prop $Item 'status'
        review_status = Get-Prop $Item 'review_status'
        source_id = $sourceId
        dataset_key = $datasetKey
    })
}

function Find-LatestExternalImportJob {
    param(
        [object]$Overview,
        [string]$JobId = '',
        [string]$SourceId = '',
        [string]$DatasetKey = ''
    )
    $candidates = New-Object System.Collections.Generic.List[object]

    foreach ($item in @(ConvertTo-Array (Get-NestedProp $Overview @('external_import_precheck_jobs', 'items')))) {
        Add-JobCandidate -Candidates $candidates -Item $item -Id ([string](Get-Prop $item 'id')) -Source 'external_import_precheck_jobs'
    }

    foreach ($item in @(ConvertTo-Array (Get-NestedProp $Overview @('external_import_review_queue', 'items')))) {
        Add-JobCandidate -Candidates $candidates -Item $item -Id ([string](Get-Prop $item 'id')) -Source 'external_import_review_queue'
    }

    foreach ($item in @(ConvertTo-Array (Get-NestedProp $Overview @('external_import_quarantine', 'items')))) {
        $candidateMetrics = Get-Prop $item 'candidate_metrics'
        $sourceJobId = Get-Prop $item 'source_mining_job_id'
        if ([string]::IsNullOrWhiteSpace([string]$sourceJobId)) {
            $sourceJobId = Get-Prop $candidateMetrics 'external_import_job_id'
        }
        if ([string]::IsNullOrWhiteSpace([string]$sourceJobId)) {
            $itemId = [string](Get-Prop $item 'id')
            if ($itemId.StartsWith('extimp_')) {
                $sourceJobId = $itemId
            }
        }
        Add-JobCandidate -Candidates $candidates -Item $item -Id ([string]$sourceJobId) -Source 'external_import_quarantine'
    }

    $filtered = @($candidates.ToArray() | Where-Object {
        (Test-OptionalMatch $_.id $JobId) -and
        (Test-OptionalMatch $_.source_id $SourceId) -and
        (Test-OptionalMatch $_.dataset_key $DatasetKey)
    })
    return @($filtered | Sort-Object -Property score -Descending | Select-Object -First 1)
}

$registry = $null
$overview = $null
$job = $null
$latest = $null
$errors = New-Object System.Collections.Generic.List[string]

if ($ExpectSubmitted -and $ExpectPendingPrecheck) {
    [void]$errors.Add('expectation: use only one of -ExpectSubmitted or -ExpectPendingPrecheck')
}

try {
    $registry = Invoke-ApiJson '/factor-sources/registry'
} catch {
    [void]$errors.Add("registry: $($_.Exception.Message)")
}

try {
    $overview = Invoke-ApiJson '/factor-factory/overview'
    $latest = Find-LatestExternalImportJob $overview -JobId $JobId -SourceId $SourceId -DatasetKey $DatasetKey
} catch {
    [void]$errors.Add("overview: $($_.Exception.Message)")
}

if ($null -ne $latest -and -not [string]::IsNullOrWhiteSpace([string]$latest.id)) {
    try {
        $escapedJobId = [uri]::EscapeDataString([string]$latest.id)
        $job = Invoke-ApiJson "/factor-sources/import-jobs/$escapedJobId"
    } catch {
        [void]$errors.Add("job_detail: $($_.Exception.Message)")
    }
}

$registrySources = @(ConvertTo-Array (Get-Prop $registry 'sources'))
$registryDatasets = 0
foreach ($source in $registrySources) {
    $registryDatasets += @(ConvertTo-Array (Get-Prop $source 'datasets')).Count
}

$jobStatus = Get-Prop $job 'status'
$reviewStatus = Get-Prop $job 'review_status'
$nextActions = @(ConvertTo-Array (Get-Prop $job 'next_actions'))
$sourceOk = Test-OptionalMatch (Get-Prop $job 'source_id') $SourceId
$datasetOk = Test-OptionalMatch (Get-Prop $job 'dataset_key') $DatasetKey
$jobIdOk = Test-OptionalMatch (Get-Prop $job 'id') $JobId
$submittedOk = (
    $null -ne $job -and
    @('REVIEW_SUBMITTED', 'SUBMITTED') -contains [string]$jobStatus -and
    @('SUBMITTED', 'REVIEW_SUBMITTED') -contains [string]$reviewStatus
)
$pendingPrecheckOk = (
    $null -ne $job -and
    [string]$jobStatus -eq 'REVIEW_GATED' -and
    @('PENDING_REVIEW', 'NEEDS_MAPPING', 'READY_FOR_REVIEW') -contains [string]$reviewStatus
)
$expectationsOk = (
    (-not $ExpectSubmitted -or $submittedOk) -and
    (-not $ExpectPendingPrecheck -or $pendingPrecheckOk) -and
    $sourceOk -and
    $datasetOk -and
    $jobIdOk
)

$result = [pscustomobject][ordered]@{
    ok = ($errors.Count -eq 0 -and $expectationsOk)
    backendBaseUrl = $BackendBaseUrl.TrimEnd('/')
    filters = [pscustomobject][ordered]@{
        jobId = Normalize-Token $JobId
        sourceId = Normalize-Token $SourceId
        datasetKey = Normalize-Token $DatasetKey
    }
    registry = [pscustomobject][ordered]@{
        ok = ($null -ne $registry)
        sourceCount = $registrySources.Count
        datasetCount = $registryDatasets
    }
    overview = [pscustomobject][ordered]@{
        ok = ($null -ne $overview)
        precheckTotal = Get-NestedProp $overview @('external_import_precheck_jobs', 'summary', 'total')
        reviewQueueTotal = Get-NestedProp $overview @('external_import_review_queue', 'summary', 'total')
        quarantineTotal = Get-NestedProp $overview @('external_import_quarantine', 'summary', 'total')
        latestJobId = if ($null -ne $latest) { $latest.id } else { $null }
        latestJobSource = if ($null -ne $latest) { $latest.source } else { $null }
        latestJobSourceId = if ($null -ne $latest) { $latest.source_id } else { $null }
        latestJobDatasetKey = if ($null -ne $latest) { $latest.dataset_key } else { $null }
    }
    job = [pscustomobject][ordered]@{
        ok = ($null -ne $job)
        id = Get-Prop $job 'id'
        status = $jobStatus
        reviewStatus = $reviewStatus
        sourceId = Get-Prop $job 'source_id'
        datasetKey = Get-Prop $job 'dataset_key'
        datasetName = Get-Prop $job 'dataset_name'
        rowCount = Get-NestedProp $job @('manifest', 'row_count')
        nextActions = $nextActions
        updatedAt = Get-Prop $job 'updated_at'
    }
    expectations = [pscustomobject][ordered]@{
        submittedRequired = [bool]$ExpectSubmitted
        pendingPrecheckRequired = [bool]$ExpectPendingPrecheck
        submittedOk = [bool]$submittedOk
        pendingPrecheckOk = [bool]$pendingPrecheckOk
        sourceOk = [bool]$sourceOk
        datasetOk = [bool]$datasetOk
        jobIdOk = [bool]$jobIdOk
    }
    browserFollowup = 'If the route still looks stale, confirm browser requests include /factor-factory/overview, the relevant external_import_precheck_jobs or quarantine queue item, and /factor-sources/import-jobs/{id}; then verify the row action/status on the cache-busted route.'
    errors = @($errors.ToArray())
}

if ($Json) {
    $result | ConvertTo-Json -Depth 8
} else {
    $result | Format-List
}

if (-not $result.ok) {
    exit 2
}
