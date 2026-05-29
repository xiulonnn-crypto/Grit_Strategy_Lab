[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$JobId,

    [Parameter(Mandatory = $true)]
    [string]$FactorId,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedName,

    [string]$RejectName = '',
    [string]$DatasetText = '',
    [string]$BackendBaseUrl = 'http://127.0.0.1:8000',
    [string]$FrontendBaseUrl = 'http://127.0.0.1:4173',
    [string]$DbPath = $(if ($env:GRIT_BACKTEST_DB) { $env:GRIT_BACKTEST_DB } else { '.grit_backtest_platform.sqlite3' }),
    [string]$TaskSlug = 'factor-import-name-probe',
    [string]$OutputRoot = 'output\logs\grit-coder',
    [int]$TimeoutSec = 20,
    [switch]$SkipPreflight,
    [switch]$SkipBrowser,
    [switch]$Strict,
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
$factorProbeScript = Join-Path $repoRoot 'scripts\factor_naming_probe.py'
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$pythonExe = if (Test-Path $venvPython) { $venvPython } else { 'python' }
$browserProbeScript = Join-Path $taskDir 'browser-factor-import-name-probe.cjs'
$browserInputPath = Join-Path $taskDir 'browser-factor-import-name-input.json'

if (-not (Test-Path $factorProbeScript)) {
    throw "Missing factor naming probe script: $factorProbeScript"
}

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

function Get-FirstText {
    param([object[]]$Values)
    foreach ($value in $Values) {
        $text = [string]$value
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            return $text.Trim()
        }
    }
    return ''
}

function Normalize-Text {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ''
    }
    return (($Text -replace '\s+', ' ').Trim())
}

function Test-ContainsNormalized {
    param(
        [string]$Haystack,
        [string]$Needle
    )
    $normalizedNeedle = Normalize-Text $Needle
    if ([string]::IsNullOrWhiteSpace($normalizedNeedle)) {
        return $false
    }
    return (Normalize-Text $Haystack).Contains($normalizedNeedle)
}

function ConvertTo-SafeName {
    param([string]$Value)
    $safe = ($Value -replace '[^A-Za-z0-9_.-]', '_')
    if ([string]::IsNullOrWhiteSpace($safe)) {
        return 'factor'
    }
    return $safe
}

function Invoke-Preflight {
    $outPath = Join-Path $taskDir 'runtime-preflight.json'
    $errPath = Join-Path $taskDir 'runtime-preflight.stderr.txt'
    if ($SkipPreflight) {
        return [pscustomobject][ordered]@{
            ok = $true
            skipped = $true
            output = $null
            quickstartOverall = $null
            decision = 'skipped'
            nextAction = $null
        }
    }

    $stdout = ''
    $stderr = ''
    $exitCode = 0
    try {
        $stdout = (& powershell -NoProfile -ExecutionPolicy Bypass -File $preflightScript -Json 2>$errPath) | Out-String
        $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
        if (Test-Path $errPath) {
            $stderr = Get-Content -Path $errPath -Raw -Encoding UTF8
        }
        Write-Utf8Text -Path $outPath -Text $stdout
    } catch {
        $exitCode = 1
        $stderr = $_.Exception.Message
        Write-Utf8Text -Path $errPath -Text ($stderr + "`n")
    }

    $payload = ConvertTo-JsonObject $stdout
    $quickstartOverall = Get-Prop $payload 'quickstartOverall'
    $decision = Get-Prop $payload 'decision'
    $runtimeReady = ($quickstartOverall -eq 'ready' -and $decision -eq 'reuse')
    return [pscustomobject][ordered]@{
        ok = ($exitCode -eq 0 -and $null -ne $payload -and $runtimeReady)
        skipped = $false
        exitCode = $exitCode
        output = $outPath
        stderr = $errPath
        quickstartOverall = $quickstartOverall
        decision = $decision
        nextAction = Get-Prop $payload 'nextAction'
        backendHealthy = Get-Prop $payload 'backendHealthy'
        frontendHealthy = Get-Prop $payload 'frontendHealthy'
        portProbeStatus = Get-Prop $payload 'portProbeStatus'
        parseOk = ($null -ne $payload)
        runtimeReady = $runtimeReady
        error = if ($exitCode -eq 0) { $null } else { $stderr }
    }
}

function Invoke-ApiJson {
    param(
        [string]$Path,
        [string]$OutputPath
    )
    $uri = ($BackendBaseUrl.TrimEnd('/')) + $Path
    $payload = $null
    $ok = $false
    $errorText = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create($uri)
        $request.Method = 'GET'
        $request.Timeout = [Math]::Max(1000, $TimeoutSec * 1000)
        $request.ReadWriteTimeout = [Math]::Max(1000, $TimeoutSec * 1000)
        $response = $request.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
            try {
                $responseText = $reader.ReadToEnd()
            } finally {
                $reader.Dispose()
            }
        } finally {
            $response.Dispose()
        }
        $payload = $responseText | ConvertFrom-Json
        $ok = $true
    } catch {
        $errorText = $_.Exception.Message
        $payload = [pscustomobject][ordered]@{
            ok = $false
            error = $errorText
            uri = $uri
        }
    }
    Write-JsonFile -Path $OutputPath -Value $payload -Depth 30
    return [pscustomobject][ordered]@{
        ok = $ok
        uri = $uri
        output = $OutputPath
        error = $errorText
        payload = $payload
    }
}

function Invoke-FactorProbe {
    $safeFactor = ConvertTo-SafeName $FactorId
    $outPath = Join-Path $taskDir "factor-naming-probe-$safeFactor.json"
    $tracePath = Join-Path $taskDir "factor-naming-trace-$safeFactor.md"
    $stdoutPath = Join-Path $taskDir "factor-naming-probe-$safeFactor.stdout.txt"
    $stderrPath = Join-Path $taskDir "factor-naming-probe-$safeFactor.stderr.txt"
    $probeArgs = @(
        '-X', 'utf8',
        $factorProbeScript,
        '--factor-id', $FactorId,
        '--db', $DbPath,
        '--api-base', $BackendBaseUrl,
        '--timeout', ([string]$TimeoutSec),
        '--acceptance-surface', 'factory',
        '--expected-name', $ExpectedName,
        '--out', $outPath,
        '--trace-matrix', $tracePath
    )
    if (-not [string]::IsNullOrWhiteSpace($RejectName)) {
        $probeArgs += @('--reject-name', $RejectName)
    }
    if ($Strict) {
        $probeArgs += '--strict'
    }

    $stdout = ''
    $stderr = ''
    $exitCode = 0
    try {
        $stdout = (& $pythonExe @probeArgs 2>$stderrPath) | Out-String
        $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
        if (Test-Path $stderrPath) {
            $stderr = Get-Content -Path $stderrPath -Raw -Encoding UTF8
        }
        Write-Utf8Text -Path $stdoutPath -Text $stdout
    } catch {
        $exitCode = 1
        $stderr = $_.Exception.Message
        Write-Utf8Text -Path $stderrPath -Text ($stderr + "`n")
    }

    $payload = $null
    if (Test-Path $outPath) {
        $payload = ConvertTo-JsonObject (Get-Content -Path $outPath -Raw -Encoding UTF8)
    }
    $warnings = @(ConvertTo-Array (Get-Prop $payload 'warnings'))
    return [pscustomobject][ordered]@{
        ok = ($exitCode -eq 0 -and $null -ne $payload -and $warnings.Count -eq 0)
        exitCode = $exitCode
        status = Get-Prop $payload 'status'
        warnings = $warnings
        output = $outPath
        traceMatrix = $tracePath
        stdout = $stdoutPath
        stderr = $stderrPath
        payload = $payload
        error = if ($exitCode -eq 0) { $null } else { $stderr }
    }
}

function Get-JobCandidateId {
    param([object]$Payload)
    $quarantine = Get-Prop $Payload 'quarantine'
    $manifest = Get-Prop $Payload 'manifest'
    return Get-FirstText @(
        (Get-Prop $Payload 'candidate_id'),
        (Get-Prop $Payload 'factor_id'),
        (Get-Prop $quarantine 'candidate_id'),
        (Get-Prop $quarantine 'factor_id'),
        (Get-Prop $manifest 'candidate_id'),
        (Get-Prop $manifest 'factor_id')
    )
}

function Get-CandidateRows {
    param([object]$Overview)
    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($sectionName in @('external_import_quarantine', 'publishable_factors', 'quarantine_rows')) {
        $section = Get-Prop $Overview $sectionName
        $items = if ($null -ne (Get-Prop $section 'items')) { Get-Prop $section 'items' } else { $section }
        foreach ($row in (ConvertTo-Array $items)) {
            if ($null -eq $row) {
                continue
            }
            $row | Add-Member -NotePropertyName '_probe_section' -NotePropertyValue $sectionName -Force
            [void]$rows.Add($row)
        }
    }
    return @($rows.ToArray())
}

function Get-MatchedCandidate {
    param(
        [object]$Overview,
        [object]$JobDetail
    )
    $candidateId = Get-JobCandidateId $JobDetail
    foreach ($row in (Get-CandidateRows $Overview)) {
        $rowText = $row | ConvertTo-Json -Depth 30 -Compress
        $rowId = Get-FirstText @((Get-Prop $row 'id'), (Get-Prop $row 'candidate_id'), (Get-Prop $row 'factor_id'), (Get-Prop $row 'target_factor_id'))
        $rowSourceJob = Get-FirstText @((Get-Prop $row 'source_mining_job_id'), (Get-Prop $row 'source_job_id'), (Get-Prop $row 'job_id'))
        $rowFactor = Get-FirstText @((Get-Prop $row 'target_factor_id'), (Get-Prop $row 'factor_id'), (Get-Prop $row 'external_factor_id'))
        if (
            $rowSourceJob -eq $JobId -or
            $rowFactor -eq $FactorId -or
            (-not [string]::IsNullOrWhiteSpace($candidateId) -and $rowId -eq $candidateId) -or
            $rowText.Contains($JobId) -or
            $rowText.Contains($FactorId)
        ) {
            return $row
        }
    }
    return $null
}

function Invoke-BrowserProbe {
    if ($SkipBrowser) {
        return [pscustomobject][ordered]@{
            ok = $true
            skipped = $true
            summary = $null
            output = $null
            screenshot = $null
            exitCode = 0
        }
    }

    $summaryPath = Join-Path $taskDir 'browser-summary.json'
    $screenshotPath = Join-Path $taskDir 'factor-import-name-live.png'
    $stdoutPath = Join-Path $taskDir 'browser-factor-import-name.stdout.txt'
    $stderrPath = Join-Path $taskDir 'browser-factor-import-name.stderr.txt'

    $inputPayload = [pscustomobject][ordered]@{
        repoRoot = $repoRoot
        frontendBaseUrl = $FrontendBaseUrl.TrimEnd('/')
        jobId = $JobId
        expectedName = $ExpectedName
        rejectName = $RejectName
        datasetText = $DatasetText
        timeoutMs = [Math]::Max(5000, $TimeoutSec * 1000)
        summaryPath = $summaryPath
        screenshotPath = $screenshotPath
    }
    Write-JsonFile -Path $browserInputPath -Value $inputPayload -Depth 12

    $browserJs = @'
const fs = require('fs');
const path = require('path');

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { chromium } = require(path.join(input.repoRoot, 'web', 'node_modules', 'playwright'));

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function main() {
  const requests = [];
  const failedRequests = [];
  const consoleErrors = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/factor-factory/overview') || url.includes(`/factor-sources/import-jobs/${encodeURIComponent(input.jobId)}`)) {
      requests.push({ url, status: response.status(), ok: response.ok() });
    }
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.includes('/factor-factory') || url.includes('/factor-sources')) {
      failedRequests.push({ url, error: request.failure()?.errorText || 'request failed' });
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const routeUrl = `${input.frontendBaseUrl}/?v=${Date.now()}#/factors/imports`;
  await page.goto(routeUrl, { waitUntil: 'domcontentloaded', timeout: input.timeoutMs });
  await page.waitForTimeout(1500);
  if (input.datasetText) {
    const datasetMatch = page.getByText(input.datasetText, { exact: false }).first();
    try {
      await datasetMatch.waitFor({ state: 'visible', timeout: Math.min(input.timeoutMs, 5000) });
      await datasetMatch.click({ timeout: Math.min(input.timeoutMs, 5000) });
      await page.waitForTimeout(1000);
    } catch (error) {
      // The route may already render the candidate row without expanding the dataset.
    }
  }

  const bodyText = await page.locator('body').innerText({ timeout: input.timeoutMs });
  const normalizedBody = normalize(bodyText);
  const normalizedExpected = normalize(input.expectedName);
  const normalizedReject = normalize(input.rejectName);
  await page.screenshot({ path: input.screenshotPath, fullPage: true });
  await browser.close();

  const summary = {
    ok: normalizedBody.includes(normalizedExpected) &&
      (!normalizedReject || !normalizedBody.includes(normalizedReject)) &&
      failedRequests.length === 0 &&
      consoleErrors.length === 0,
    routeUrl,
    containsExpected: normalizedBody.includes(normalizedExpected),
    containsReject: normalizedReject ? normalizedBody.includes(normalizedReject) : false,
    requestCount: requests.length,
    requests,
    failedRequests,
    consoleErrors,
    screenshot: input.screenshotPath,
    bodyExcerpt: normalizedBody.slice(0, 2000)
  };
  fs.writeFileSync(input.summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  const summary = {
    ok: false,
    error: error && error.stack ? error.stack : String(error),
    screenshot: input.screenshotPath
  };
  fs.writeFileSync(input.summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.error(summary.error);
  process.exit(1);
});
'@
    Write-Utf8Text -Path $browserProbeScript -Text $browserJs

    $stdout = ''
    $stderr = ''
    $exitCode = 0
    try {
        $stdout = (& node $browserProbeScript $browserInputPath 2>$stderrPath) | Out-String
        $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
        if (Test-Path $stderrPath) {
            $stderr = Get-Content -Path $stderrPath -Raw -Encoding UTF8
        }
        Write-Utf8Text -Path $stdoutPath -Text $stdout
    } catch {
        $exitCode = 1
        $stderr = $_.Exception.Message
        Write-Utf8Text -Path $stderrPath -Text ($stderr + "`n")
    }

    $browserPayload = $null
    if (Test-Path $summaryPath) {
        $browserPayload = ConvertTo-JsonObject (Get-Content -Path $summaryPath -Raw -Encoding UTF8)
    }
    return [pscustomobject][ordered]@{
        ok = ($exitCode -eq 0 -and $null -ne $browserPayload -and [bool](Get-Prop $browserPayload 'ok'))
        skipped = $false
        exitCode = $exitCode
        summary = $browserPayload
        output = $summaryPath
        screenshot = $screenshotPath
        stdout = $stdoutPath
        stderr = $stderrPath
        error = if ($exitCode -eq 0) { $null } else { $stderr }
    }
}

$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$preflight = Invoke-Preflight
$factorProbe = Invoke-FactorProbe

$encodedJobId = [System.Uri]::EscapeDataString($JobId)
$jobDetailPath = Join-Path $taskDir 'job-detail.json'
$overviewPath = Join-Path $taskDir 'factor-factory-overview.json'
$jobDetail = Invoke-ApiJson -Path "/factor-sources/import-jobs/$encodedJobId" -OutputPath $jobDetailPath
$factoryOverview = Invoke-ApiJson -Path '/factor-factory/overview' -OutputPath $overviewPath

$matchedCandidate = Get-MatchedCandidate -Overview (Get-Prop $factoryOverview 'payload') -JobDetail (Get-Prop $jobDetail 'payload')
$matchedDisplayName = Get-FirstText @(
    (Get-Prop $matchedCandidate 'display_name_cn'),
    (Get-Prop $matchedCandidate 'name'),
    (Get-Prop $matchedCandidate 'base_display_name_cn')
)
$matchedBaseName = Get-FirstText @((Get-Prop $matchedCandidate 'base_display_name_cn'), (Get-Prop $matchedCandidate 'short_name_cn'))
$matchedShortName = Get-FirstText @((Get-Prop $matchedCandidate 'short_name_cn'), (Get-Prop $matchedCandidate 'compact_display_name_cn'))
$matchedCandidateId = Get-FirstText @((Get-Prop $matchedCandidate 'candidate_id'), (Get-Prop $matchedCandidate 'id'), (Get-Prop $matchedCandidate 'factor_id'))
$matchedSection = Get-FirstText @((Get-Prop $matchedCandidate '_probe_section'))
$candidateVisibleNameText = @($matchedDisplayName, $matchedBaseName, $matchedShortName) -join ' '
$apiContainsExpected = Test-ContainsNormalized -Haystack $candidateVisibleNameText -Needle $ExpectedName
$apiContainsReject = if ([string]::IsNullOrWhiteSpace($RejectName)) { $false } else { Test-ContainsNormalized -Haystack $candidateVisibleNameText -Needle $RejectName }

$browser = Invoke-BrowserProbe

$errors = New-Object System.Collections.Generic.List[string]
if (-not [bool](Get-Prop $preflight 'ok')) {
    [void]$errors.Add('runtime_preflight_failed')
}
if (-not [bool](Get-Prop $factorProbe 'ok')) {
    [void]$errors.Add('factor_naming_probe_failed')
}
if (-not [bool](Get-Prop $jobDetail 'ok')) {
    [void]$errors.Add('job_detail_api_failed')
}
if (-not [bool](Get-Prop $factoryOverview 'ok')) {
    [void]$errors.Add('factor_factory_overview_api_failed')
}
if ($null -eq $matchedCandidate) {
    [void]$errors.Add('candidate_not_found_in_factory_overview')
}
if (-not $apiContainsExpected) {
    [void]$errors.Add('expected_name_missing_in_api_candidate')
}
if ($apiContainsReject) {
    [void]$errors.Add('rejected_name_present_in_api_candidate')
}
if (-not [bool](Get-Prop $browser 'ok')) {
    [void]$errors.Add('browser_route_probe_failed')
}

$completedAt = (Get-Date).ToUniversalTime().ToString('o')
$ok = ($errors.Count -eq 0)
$jobPayload = Get-Prop $jobDetail 'payload'
$browserSkipped = [bool](Get-Prop $browser 'skipped')
$conclusionText = if ($ok -and $browserSkipped) {
    'PASS: import job, factory overview, and factory-only naming probe agree on the expected factor import display name; browser route probe was skipped.'
} elseif ($ok) {
    'PASS: import job, factory overview, naming probe, and browser route agree on the expected factor import display name.'
} else {
    'CHECK_REQUIRED: one or more import naming acceptance gates failed; inspect errors and evidence files.'
}
$summary = [pscustomobject][ordered]@{
    schema = 'grit.factor_import_name_probe.v1'
    ok = $ok
    status = if ($ok) { 'OK' } else { 'WARN' }
    started_at = $startedAt
    completed_at = $completedAt
    repo_root = $repoRoot
    task_slug = $TaskSlug
    output_dir = $taskDir
    inputs = [pscustomobject][ordered]@{
        job_id = $JobId
        factor_id = $FactorId
        expected_name = $ExpectedName
        reject_name = $RejectName
        dataset_text = $DatasetText
        backend_base_url = $BackendBaseUrl
        frontend_base_url = $FrontendBaseUrl
        db_path = $DbPath
        skip_preflight = [bool]$SkipPreflight
        skip_browser = [bool]$SkipBrowser
    }
    preflight = $preflight
    factor_probe = [pscustomobject][ordered]@{
        ok = Get-Prop $factorProbe 'ok'
        exitCode = Get-Prop $factorProbe 'exitCode'
        status = Get-Prop $factorProbe 'status'
        warnings = @(ConvertTo-Array (Get-Prop $factorProbe 'warnings'))
        output = Get-Prop $factorProbe 'output'
        traceMatrix = Get-Prop $factorProbe 'traceMatrix'
        stdout = Get-Prop $factorProbe 'stdout'
        stderr = Get-Prop $factorProbe 'stderr'
    }
    api = [pscustomobject][ordered]@{
        job_detail_ok = Get-Prop $jobDetail 'ok'
        job_detail_output = Get-Prop $jobDetail 'output'
        overview_ok = Get-Prop $factoryOverview 'ok'
        overview_output = Get-Prop $factoryOverview 'output'
        job_status = Get-Prop $jobPayload 'status'
        review_status = Get-Prop $jobPayload 'review_status'
        row_count = Get-FirstText @((Get-Prop $jobPayload 'row_count'), (Get-Prop $jobPayload 'manifest_row_count'), (Get-Prop (Get-Prop $jobPayload 'manifest') 'row_count'))
        matched_candidate_found = ($null -ne $matchedCandidate)
        matched_section = $matchedSection
        matched_candidate_id = $matchedCandidateId
        matched_display_name = $matchedDisplayName
        matched_base_name = $matchedBaseName
        matched_short_name = $matchedShortName
        contains_expected_name = $apiContainsExpected
        contains_reject_name = $apiContainsReject
    }
    browser = [pscustomobject][ordered]@{
        ok = Get-Prop $browser 'ok'
        skipped = Get-Prop $browser 'skipped'
        exitCode = Get-Prop $browser 'exitCode'
        output = Get-Prop $browser 'output'
        screenshot = Get-Prop $browser 'screenshot'
        summary = Get-Prop $browser 'summary'
        stderr = Get-Prop $browser 'stderr'
    }
    files = [pscustomobject][ordered]@{
        runtime_preflight = Get-Prop $preflight 'output'
        factor_probe = Get-Prop $factorProbe 'output'
        factor_probe_trace = Get-Prop $factorProbe 'traceMatrix'
        job_detail = $jobDetailPath
        factor_factory_overview = $overviewPath
        browser_summary = Get-Prop $browser 'output'
        browser_screenshot = Get-Prop $browser 'screenshot'
    }
    errors = @($errors.ToArray())
    conclusion = $conclusionText
}

$summaryPath = Join-Path $taskDir 'acceptance-summary.json'
Write-JsonFile -Path $summaryPath -Value $summary -Depth 32

if ($Json) {
    $summary | ConvertTo-Json -Depth 32
} else {
    if ($ok) {
        Write-Host "因子导入命名验收通过：$ExpectedName"
    } else {
        Write-Host "因子导入命名验收需要复核：$($errors -join ', ')"
    }
    Write-Host "汇总：$summaryPath"
    Write-Host "命名探针：$(Get-Prop $factorProbe 'output')"
    Write-Host "作业详情：$jobDetailPath"
    if (-not $SkipBrowser) {
        Write-Host "浏览器证据：$(Get-Prop $browser 'output')"
        Write-Host "截图：$(Get-Prop $browser 'screenshot')"
    }
}

if ($Strict -and -not $ok) {
    exit 2
}
