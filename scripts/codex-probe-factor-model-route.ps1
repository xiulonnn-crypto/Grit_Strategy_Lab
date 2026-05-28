[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$FactorId,

    [string]$RouteUrl = '',
    [string]$TaskSlug = 'factor-model-route-probe',
    [string]$OutputRoot = 'output\logs\grit-coder',
    [string]$BackendBaseUrl = 'http://127.0.0.1:8000',
    [string]$FrontendBaseUrl = 'http://127.0.0.1:4173',
    [string]$ModelName = 'Composite factor strategy',
    [string]$Direction = 'HIGH_IS_BETTER',
    [double]$Weight = 100,
    [int]$TopN = 50,
    [int]$TimeoutSec = 30,
    [string]$SelectAriaLabel = '',
    [string[]]$ExpectedSelectValues = @(),
    [string]$SelectValue = '',
    [string]$ExpectedSelectedLabel = '',
    [switch]$AllowDisabledCreate,
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
$browserProbeScript = Join-Path $taskDir 'factor-model-browser-probe.cjs'
$browserInputPath = Join-Path $taskDir 'browser-probe-input.json'

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
        [int]$Depth = 16
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

function Invoke-ApiJson {
    param(
        [string]$Path,
        [string]$Method = 'GET',
        [object]$Body = $null
    )
    $base = $BackendBaseUrl.TrimEnd('/')
    $uri = "$base$Path"
    if ($Method -eq 'POST') {
        $jsonBody = $Body | ConvertTo-Json -Depth 16
        return Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body $jsonBody -TimeoutSec $TimeoutSec
    }
    return Invoke-RestMethod -Uri $uri -TimeoutSec $TimeoutSec
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
    return [pscustomobject][ordered]@{
        ok = ($exitCode -eq 0 -and $null -ne $payload)
        skipped = $false
        exitCode = $exitCode
        output = $outPath
        stderr = $errPath
        quickstartOverall = Get-Prop $payload 'quickstartOverall'
        decision = Get-Prop $payload 'decision'
        nextAction = Get-Prop $payload 'nextAction'
        backendHealthy = Get-Prop $payload 'backendHealthy'
        frontendHealthy = Get-Prop $payload 'frontendHealthy'
        backendPid = Get-Prop $payload 'backendPid'
        frontendPid = Get-Prop $payload 'frontendPid'
        frontendDistStaleBySourceMtime = Get-Prop $payload 'frontendDistStaleBySourceMtime'
        backendStaleBySourceMtime = Get-Prop $payload 'backendStaleBySourceMtime'
        parseOk = ($null -ne $payload)
        error = if ($exitCode -eq 0) { $null } else { $stderr }
    }
}

function New-DefaultRouteUrl {
    $encodedFactorId = [uri]::EscapeDataString($FactorId)
    $encodedModelName = [uri]::EscapeDataString($ModelName)
    $base = $FrontendBaseUrl.TrimEnd('/')
    return "$base/#/factor-models/new?strategy_type=COMPOSITE_FACTOR&source=factor_library&factor_id=$encodedFactorId&factorIds=$encodedFactorId&weights=$Weight&directions=$Direction&modelName=$encodedModelName"
}

function ConvertTo-CacheBustedRoute {
    param([string]$Url)
    $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $inputUrl = if ([string]::IsNullOrWhiteSpace($Url)) { New-DefaultRouteUrl } else { $Url }
    if ($inputUrl -match '^(?<prefix>https?://[^#?]+)(?<query>\?[^#]*)?#(?<hash>.*)$') {
        return "$($Matches['prefix'])?v=$stamp#$($Matches['hash'])"
    }
    if ($inputUrl -match '^(?<prefix>https?://[^#]+)#(?<hash>.*)$') {
        return "$($Matches['prefix'])?v=$stamp#$($Matches['hash'])"
    }
    return $inputUrl
}

function New-PreviewPayload {
    return [pscustomobject][ordered]@{
        strategy_type = 'COMPOSITE_FACTOR'
        name = $ModelName
        universe = 'SP500'
        rebalance_frequency = 'monthly'
        top_n = $TopN
        scoring_method = 'zscore_weighted'
        components = @(
            [pscustomobject][ordered]@{
                factor_id = $FactorId
                weight = $Weight
                direction = $Direction
            }
        )
        neutralization = [pscustomobject][ordered]@{
            enabled = $false
            method = 'industry'
        }
        universe_filter = [pscustomobject][ordered]@{
            min_adv_usd = 5000000
            adv_window = '20D'
            exclude_halted = $true
            exclude_otc_pink = $true
            exclude_luld_paused = $true
            delisting_window_days = 30
            sector_overrides = [pscustomobject][ordered]@{
                utilities = $true
                real_estate = $false
            }
        }
        weight_mapping = [pscustomobject][ordered]@{
            method = 'equal_top_k'
            sector_cap_pct = 20
            max_position_pct = 8
            min_target_weight_pct = 0.25
            cap_redistribution_mode = 'proportional_refill'
        }
        rebalance_logic = [pscustomobject][ordered]@{
            frequency = 'monthly'
            calendar_rule = 'first_trading_day'
            exit_rank_percentile = 20
            min_trade_notional_usd = 10000
        }
        execution_constraints = [pscustomobject][ordered]@{
            notional_usd = 10000000
            commission_bps = 1.5
            stamp_tax_bps = 0
            base_slippage_bps = 2.5
            impact_beta = 0.65
            max_impact_bps = 75
        }
    }
}

function Invoke-ApiEvidence {
    $factorDetailPath = Join-Path $taskDir 'factor-detail.json'
    $factorListPath = Join-Path $taskDir 'factor-list-item.json'
    $previewPath = Join-Path $taskDir 'factor-model-preview.json'
    $summaryPath = Join-Path $taskDir 'api-summary.json'
    $errors = New-Object System.Collections.Generic.List[string]
    $detail = $null
    $listItem = $null
    $preview = $null

    try {
        $detail = Invoke-ApiJson "/factors/$([uri]::EscapeDataString($FactorId))"
        Write-JsonFile -Path $factorDetailPath -Value $detail -Depth 24
    } catch {
        [void]$errors.Add("factor_detail: $($_.Exception.Message)")
    }

    try {
        $list = Invoke-ApiJson '/factors?lifecycle=online'
        foreach ($item in @(ConvertTo-Array (Get-Prop $list 'items'))) {
            if ([string](Get-Prop $item 'id') -eq $FactorId) {
                $listItem = $item
                break
            }
        }
        Write-JsonFile -Path $factorListPath -Value $listItem -Depth 24
        if ($null -eq $listItem) {
            [void]$errors.Add("factor_list: factor not present in /factors?lifecycle=online")
        }
    } catch {
        [void]$errors.Add("factor_list: $($_.Exception.Message)")
    }

    try {
        $preview = Invoke-ApiJson '/factor-models/preview' -Method 'POST' -Body (New-PreviewPayload)
        Write-JsonFile -Path $previewPath -Value $preview -Depth 24
    } catch {
        [void]$errors.Add("factor_model_preview: $($_.Exception.Message)")
    }

    $blockedCount = Get-Prop (Get-Prop $preview 'strategy_creation_risk') 'blocked_count'
    $status = [string](Get-Prop $preview 'status')
    $blockedCountInt = 0
    if ($null -ne $blockedCount) {
        $blockedCountInt = [int]$blockedCount
    }
    $summary = [pscustomobject][ordered]@{
        ok = ($errors.Count -eq 0)
        factorId = $FactorId
        detail = [pscustomobject][ordered]@{
            present = ($null -ne $detail)
            factorLevel = Get-Prop $detail 'factor_level'
            factorLevelLabel = Get-Prop $detail 'factor_level_label'
            tierLevel = Get-Prop $detail 'tier_level'
            lifecycleStatus = Get-Prop $detail 'lifecycle_status'
            diagnosticStatus = Get-Prop $detail 'diagnostic_status'
            latestDiagnosticStatus = Get-Prop (Get-Prop $detail 'latest_diagnostic_summary') 'status'
        }
        listItem = [pscustomobject][ordered]@{
            present = ($null -ne $listItem)
            factorLevel = Get-Prop $listItem 'factor_level'
            factorLevelLabel = Get-Prop $listItem 'factor_level_label'
            tierLevel = Get-Prop $listItem 'tier_level'
            lifecycleStatus = Get-Prop $listItem 'lifecycle_status'
            diagnosticStatus = Get-Prop $listItem 'diagnostic_status'
            latestDiagnosticStatus = Get-Prop (Get-Prop $listItem 'latest_diagnostic_summary') 'status'
            uiState = Get-Prop $listItem 'ui_state'
            offlineAt = Get-Prop $listItem 'offline_at'
        }
        preview = [pscustomobject][ordered]@{
            present = ($null -ne $preview)
            status = $status
            blockedCount = $blockedCount
            warningCount = Get-Prop (Get-Prop $preview 'strategy_creation_risk') 'warning_count'
            canCreate = ($status -eq 'READY' -and $blockedCountInt -eq 0)
            readyFactorCount = Get-Prop (Get-Prop $preview 'coverage') 'ready_factor_count'
            pitBlockerCount = @(ConvertTo-Array (Get-Prop $preview 'pit_blockers')).Count
            normalizedWeightFactor = Get-Prop (@(ConvertTo-Array (Get-Prop $preview 'normalized_weights')) | Select-Object -First 1) 'factor_id'
            normalizedWeightDiagnostic = Get-Prop (@(ConvertTo-Array (Get-Prop $preview 'normalized_weights')) | Select-Object -First 1) 'diagnostic_status'
        }
        files = [pscustomobject][ordered]@{
            factorDetail = $factorDetailPath
            factorListItem = $factorListPath
            factorModelPreview = $previewPath
        }
        errors = @($errors.ToArray())
    }
    Write-JsonFile -Path $summaryPath -Value $summary -Depth 14
    return $summary
}

function Write-BrowserProbeScript {
    $script = @'
const fs = require('fs');
const path = require('path');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { chromium } = require(path.join(input.repoRoot, 'web', 'node_modules', 'playwright'));

async function runViewport(viewportName, viewport) {
  const screenshotPath = path.join(input.taskDir, `live-factor-model-route-${viewportName}.png`);
  const snapshotPath = path.join(input.taskDir, `live-route-dom-snapshot-${viewportName}.json`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });
  const apiResponses = [];
  const failedRequests = [];
  const consoleErrors = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/factors') || url.includes('/factor-models/preview')) {
      apiResponses.push({ url, status: response.status() });
    }
  });
  page.on('requestfailed', (request) => {
    failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? 'request failed' });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  await page.goto(input.routeUrl, { waitUntil: 'domcontentloaded', timeout: input.timeoutMs });
  await page.waitForFunction(
    (factorId) => document.body.innerText.includes(factorId),
    input.factorId,
    { timeout: input.timeoutMs },
  );
  const previewPromise = page
    .waitForResponse((response) => response.url().includes('/factor-models/preview') && response.status() === 200, {
      timeout: input.timeoutMs,
    })
    .catch(() => null);
  const refreshButtons = await page.locator('button').elementHandles();
  for (const button of refreshButtons) {
    const text = ((await button.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    if (text.includes('\u5237\u65b0\u9884\u68c0') || text.includes('\u9884\u89c8\u6253\u5206') || /Refresh/i.test(text)) {
      await button.click();
      break;
    }
  }
  await previewPromise;
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some((button) => {
      const text = button.textContent ?? '';
      return (
        (text.includes('\u521b\u5efa\u56de\u6d4b') || text.includes('\u521b\u5efa\u53ef\u56de\u6d4b\u7b56\u7565') || /Create/.test(text)) &&
        !button.hasAttribute('disabled')
      );
    }),
    { timeout: input.timeoutMs },
  ).catch(() => {});
  await page.waitForTimeout(1000);
  let selectProbe = {
    requested: Boolean(input.selectAriaLabel),
    present: false,
    options: [],
    selected: null,
    valuesMatch: true,
    selectedValueMatch: true,
    selectedLabelMatch: true,
  };
  if (input.selectAriaLabel) {
    const select = page.locator(`select[aria-label=${JSON.stringify(input.selectAriaLabel)}]`).first();
    await select.waitFor({ state: 'attached', timeout: input.timeoutMs });
    selectProbe.present = await select.count() > 0;
    if (selectProbe.present) {
      selectProbe.options = await select.locator('option').evaluateAll((items) =>
        items.map((item) => ({ value: item.value, label: item.textContent?.trim() || '' })),
      );
      if (input.selectValue) {
        await select.selectOption(input.selectValue);
      }
      selectProbe.selected = await select.evaluate((item) => ({
        value: item.value,
        label: item.selectedOptions[0]?.textContent?.trim() || '',
      }));
      if (Array.isArray(input.expectedSelectValues) && input.expectedSelectValues.length > 0) {
        const actualValues = selectProbe.options.map((item) => item.value);
        selectProbe.valuesMatch =
          actualValues.length === input.expectedSelectValues.length &&
          actualValues.every((value, index) => value === input.expectedSelectValues[index]);
      }
      if (input.selectValue) {
        selectProbe.selectedValueMatch = selectProbe.selected?.value === input.selectValue;
      }
      if (input.expectedSelectedLabel) {
        selectProbe.selectedLabelMatch = selectProbe.selected?.label === input.expectedSelectedLabel;
      }
    }
  }
  const bodyText = await page.locator('body').innerText();
  const sourceCards = await page.locator('.composite-factor-list .factor-pick, .factor-model-selector-list .factor-pick').evaluateAll((cards) =>
    cards.map((card) => card.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  ).catch(() => []);
  const checkedCount = await page.locator('.composite-factor-list input[type="checkbox"]:checked, .factor-model-selector-list input[type="checkbox"]:checked').count();
  const emptyVisible = await page.locator('.factor-phase2-empty, .factor-empty-state').evaluateAll((nodes) =>
    nodes.some((node) => {
      const element = node;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.textContent?.trim();
    }),
  ).catch(() => false);
  const createButtons = await page.locator('button').evaluateAll((buttons) =>
    buttons
      .map((button) => ({
        text: button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        disabled: button.hasAttribute('disabled'),
      }))
      .filter((button) => button.text.includes('\u521b\u5efa') || /Create/.test(button.text)),
  );
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      scrollHeight: Math.max(doc.scrollHeight, body.scrollHeight),
      horizontalOverflow: Math.max(doc.scrollWidth, body.scrollWidth) > window.innerWidth + 2,
    };
  });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const createEnabled = createButtons.some((button) =>
    (button.text.includes('\u521b\u5efa\u56de\u6d4b') || button.text.includes('\u521b\u5efa\u53ef\u56de\u6d4b\u7b56\u7565') || /Create/.test(button.text)) &&
    !button.disabled
  );
  const previewOk = apiResponses.some((response) => response.url.includes('/factor-models/preview') && response.status === 200);
  const summary = {
    routeUrl: input.routeUrl,
    viewportName,
    title: await page.title(),
    hasFactorId: bodyText.includes(input.factorId),
    hasRequiredCopy: input.requiredCopy ? bodyText.includes(input.requiredCopy) : true,
    hasExpectedLevelLabel: input.expectedLevelLabel ? bodyText.includes(input.expectedLevelLabel) : true,
    sourceCardCount: sourceCards.length,
    checkedCount,
    emptyVisible,
    createEnabled,
    previewOk,
    sourceCards,
    createButtons,
    selectProbe,
    apiResponses,
    failedRequests,
    consoleErrors,
    overflow,
    screenshotPath,
  };
  fs.writeFileSync(snapshotPath, JSON.stringify(summary, null, 2), 'utf8');
  await browser.close();
  return summary;
}

(async () => {
  fs.mkdirSync(input.taskDir, { recursive: true });
  const results = [];
  results.push(await runViewport('desktop', { width: 1440, height: 1000 }));
  results.push(await runViewport('mobile', { width: 390, height: 844 }));
  const ok = results.every((item) =>
    item.hasFactorId &&
    item.hasRequiredCopy &&
    item.hasExpectedLevelLabel &&
    item.sourceCardCount >= 1 &&
    item.checkedCount >= 1 &&
    !item.emptyVisible &&
    (input.allowDisabledCreate || item.createEnabled) &&
    (!item.selectProbe.requested ||
      (item.selectProbe.present &&
        item.selectProbe.valuesMatch &&
        item.selectProbe.selectedValueMatch &&
        item.selectProbe.selectedLabelMatch)) &&
    item.previewOk &&
    item.failedRequests.length === 0 &&
    item.consoleErrors.length === 0 &&
    !item.overflow.horizontalOverflow
  );
  const output = { ok, results };
  fs.writeFileSync(path.join(input.taskDir, 'browser-summary.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify(output, null, 2));
  if (!ok) {
    process.exitCode = 2;
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
'@
    Write-Utf8Text -Path $browserProbeScript -Text $script
}

function Invoke-BrowserEvidence {
    param(
        [string]$CacheBustedRoute,
        [string]$ExpectedLevelLabel
    )
    if ($SkipBrowser) {
        return [pscustomobject][ordered]@{
            ok = $true
            skipped = $true
            summary = $null
            output = $null
            error = $null
        }
    }
    Write-BrowserProbeScript
    $normalizedExpectedSelectValues = @()
    foreach ($rawValue in @($ExpectedSelectValues)) {
        foreach ($part in ([string]$rawValue -split ',')) {
            $trimmed = $part.Trim()
            if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                $normalizedExpectedSelectValues += $trimmed
            }
        }
    }
    $inputPayload = [pscustomobject][ordered]@{
        repoRoot = $repoRoot
        taskDir = $taskDir
        routeUrl = $CacheBustedRoute
        factorId = $FactorId
        expectedLevelLabel = $ExpectedLevelLabel
        requiredCopy = 'S/A/B'
        selectAriaLabel = $SelectAriaLabel
        expectedSelectValues = @($normalizedExpectedSelectValues)
        selectValue = $SelectValue
        expectedSelectedLabel = $ExpectedSelectedLabel
        allowDisabledCreate = [bool]$AllowDisabledCreate
        timeoutMs = [Math]::Max(5000, $TimeoutSec * 1000)
    }
    Write-JsonFile -Path $browserInputPath -Value $inputPayload -Depth 8
    $outPath = Join-Path $taskDir 'browser-probe.stdout.json'
    $errPath = Join-Path $taskDir 'browser-probe.stderr.txt'
    $nodeExe = 'node'
    $stdout = ''
    $stderr = ''
    $exitCode = 0
    try {
        Push-Location $repoRoot
        $stdout = (& $nodeExe $browserProbeScript $browserInputPath 2>$errPath) | Out-String
        $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    } catch {
        $exitCode = 1
        $stderr = $_.Exception.Message
    } finally {
        Pop-Location
    }
    if (Test-Path $errPath) {
        $capturedStderr = Get-Content -Path $errPath -Raw -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($capturedStderr)) {
            $stderr = $capturedStderr
        }
    }
    if ($exitCode -ne 0 -and -not [string]::IsNullOrWhiteSpace($stderr)) {
        Write-Utf8Text -Path $errPath -Text $stderr
    }
    Write-Utf8Text -Path $outPath -Text $stdout
    $summary = ConvertTo-JsonObject $stdout
    return [pscustomobject][ordered]@{
        ok = ($exitCode -eq 0 -and $null -ne $summary -and [bool](Get-Prop $summary 'ok'))
        skipped = $false
        exitCode = $exitCode
        output = $outPath
        stderr = $errPath
        summary = $summary
        error = if ($exitCode -eq 0) { $null } else { $stderr }
    }
}

$preflight = Invoke-Preflight
$route = ConvertTo-CacheBustedRoute $RouteUrl
$api = Invoke-ApiEvidence
$expectedLevelLabel = ''
$browser = Invoke-BrowserEvidence -CacheBustedRoute $route -ExpectedLevelLabel $expectedLevelLabel

$readyForBrowser = (
    [bool](Get-Prop $preflight 'ok') -and
    (($preflight.skipped) -or ([string](Get-Prop $preflight 'quickstartOverall') -eq 'ready')) -and
    [bool](Get-Prop $api 'ok')
)

$result = [pscustomobject][ordered]@{
    ok = (
        [bool](Get-Prop $preflight 'ok') -and
        (($preflight.skipped) -or ([string](Get-Prop $preflight 'quickstartOverall') -eq 'ready')) -and
        [bool](Get-Prop $api 'ok') -and
        [bool](Get-Prop $browser 'ok')
    )
    factorId = $FactorId
    taskSlug = $TaskSlug
    taskDir = $taskDir
    routeUrl = $route
    preflight = $preflight
    api = $api
    browser = $browser
    readyForBrowser = $readyForBrowser
    nextAction = if (-not [bool](Get-Prop $preflight 'ok')) {
        'Inspect runtime preflight failure before route review.'
    } elseif (-not $preflight.skipped -and [string](Get-Prop $preflight 'quickstartOverall') -ne 'ready') {
        Get-Prop $preflight 'nextAction'
    } elseif (-not [bool](Get-Prop $api 'ok')) {
        'Fix API evidence failures before UI review.'
    } elseif (-not [bool](Get-Prop $browser 'ok')) {
        'Inspect browser-summary.json, screenshots, console errors, failed requests, and overflow report.'
    } else {
        'Probe passed; use generated JSON and screenshots as Trace Matrix evidence.'
    }
}

Write-JsonFile -Path (Join-Path $taskDir 'probe-summary.json') -Value $result -Depth 18

if ($Json) {
    $result | ConvertTo-Json -Depth 18
} else {
    $result | Format-List
}

if ($Strict -and -not $result.ok) {
    exit 2
}
