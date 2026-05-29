[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$FactorId,

    [string[]]$ExpectedFamily = @(),
    [string[]]$RejectFamily = @(),
    [string]$BackendBaseUrl = 'http://127.0.0.1:8000',
    [string]$FrontendBaseUrl = 'http://127.0.0.1:4173',
    [string]$TaskSlug = 'factor-family-route-probe',
    [string]$OutputRoot = 'output\logs\grit-coder',
    [int]$TimeoutSec = 10,
    [switch]$SkipPreflight,
    [switch]$SkipApi,
    [switch]$Browser,
    [switch]$StartPreview,
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
Add-Type -AssemblyName System.Net.Http

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$webRoot = Join-Path $repoRoot 'web'
$taskDir = Join-Path (Join-Path $repoRoot $OutputRoot) $TaskSlug
$tmpDir = Join-Path $repoRoot '.tmp'
$preflightScript = Join-Path $repoRoot 'scripts\codex-grit-runtime-preflight.ps1'

function Normalize-ListArgument {
    param([string[]]$Values)
    $items = New-Object System.Collections.Generic.List[string]
    foreach ($value in @($Values)) {
        foreach ($part in ([string]$value -split ',')) {
            $text = $part.Trim()
            if (-not [string]::IsNullOrWhiteSpace($text)) {
                [void]$items.Add($text)
            }
        }
    }
    return @($items.ToArray())
}

$FactorId = Normalize-ListArgument $FactorId
$ExpectedFamily = Normalize-ListArgument $ExpectedFamily
$RejectFamily = Normalize-ListArgument $RejectFamily

New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

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

function Get-IndexedArgument {
    param(
        [string[]]$Values,
        [int]$Index
    )
    if ($Values.Count -eq 0) {
        return ''
    }
    if ($Values.Count -eq 1) {
        return [string]$Values[0]
    }
    if ($Index -lt $Values.Count) {
        return [string]$Values[$Index]
    }
    return ''
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

function Invoke-Preflight {
    $outPath = Join-Path $taskDir 'runtime-preflight.json'
    $errPath = Join-Path $taskDir 'runtime-preflight.stderr.txt'
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
        exitCode = $exitCode
        output = $outPath
        stderr = $errPath
        quickstartOverall = Get-Prop $payload 'quickstartOverall'
        decision = Get-Prop $payload 'decision'
        nextAction = Get-Prop $payload 'nextAction'
        backendHealthy = Get-Prop $payload 'backendHealthy'
        frontendHealthy = Get-Prop $payload 'frontendHealthy'
        frontendDistStaleBySourceMtime = Get-Prop $payload 'frontendDistStaleBySourceMtime'
        portProbeStatus = Get-Prop $payload 'portProbeStatus'
        parseOk = ($null -ne $payload)
        error = if ($exitCode -eq 0) { $null } else { $stderr }
    }
}

function Invoke-ApiJson {
    param([string]$Path)
    $base = $BackendBaseUrl.TrimEnd('/')
    $client = [System.Net.Http.HttpClient]::new()
    try {
        $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
        $response = $client.GetAsync("$base$Path").GetAwaiter().GetResult()
        $response.EnsureSuccessStatusCode() | Out-Null
        $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        return $text | ConvertFrom-Json
    } finally {
        $client.Dispose()
    }
}

function Normalize-Token {
    param([object]$Value)
    return ([string]$Value).Trim()
}

function Invoke-ApiProbe {
    $outPath = Join-Path $taskDir 'api-factor-family.json'
    $checks = New-Object System.Collections.Generic.List[object]
    $errors = New-Object System.Collections.Generic.List[string]
    $payload = $null
    try {
        $payload = Invoke-ApiJson '/factors?lifecycle=all'
    } catch {
        [void]$errors.Add("factors_api: $($_.Exception.Message)")
    }
    $items = @(ConvertTo-Array (Get-Prop $payload 'items'))
    for ($index = 0; $index -lt $FactorId.Count; $index++) {
        $factor = [string]$FactorId[$index]
        $expected = Get-IndexedArgument -Values $ExpectedFamily -Index $index
        $reject = Get-IndexedArgument -Values $RejectFamily -Index $index
        $matches = @($items | Where-Object { [string](Get-Prop $_ 'id') -eq $factor } | Select-Object -First 1)
        $row = if ($matches.Count -gt 0) { $matches[0] } else { $null }
        $actualFamily = Normalize-Token (Get-Prop $row 'factor_family')
        $displayName = Normalize-Token (Get-Prop $row 'display_name_cn')
        $descriptor = Get-Prop $row 'descriptor'
        $audit = Get-Prop $row 'name_audit'
        $components = Get-Prop $audit 'structured_components'
        $expectedOk = ([string]::IsNullOrWhiteSpace($expected) -or $actualFamily -eq (Normalize-Token $expected))
        $rejectOk = ([string]::IsNullOrWhiteSpace($reject) -or $actualFamily -ne (Normalize-Token $reject))
        $present = ($null -ne $row)
        [void]$checks.Add([pscustomobject][ordered]@{
            factorId = $factor
            present = $present
            ok = ($present -and $expectedOk -and $rejectOk)
            expectedFamily = $expected
            rejectFamily = $reject
            actualFamily = $actualFamily
            displayName = $displayName
            descriptorCategory = Normalize-Token (Get-Prop $descriptor 'category')
            styleFamily = Normalize-Token (Get-Prop $components 'style_family')
            duplicateExternalPrefix = $displayName.Contains('[外部] - [外部]')
        })
    }
    $summary = [pscustomobject][ordered]@{
        ok = ($errors.Count -eq 0 -and @($checks.ToArray() | Where-Object { -not $_.ok }).Count -eq 0)
        output = $outPath
        errors = @($errors.ToArray())
        checks = @($checks.ToArray())
    }
    Write-JsonFile -Path $outPath -Value $summary -Depth 20
    return $summary
}

function Invoke-BrowserProbe {
    $configPath = Join-Path $tmpDir 'codex-factor-family-route-probe-config.json'
    $nodeScriptPath = Join-Path $tmpDir 'codex-factor-family-route-probe.mjs'
    $outPath = Join-Path $taskDir 'browser-factor-family.json'
    $screenshotPath = Join-Path $taskDir 'browser-factor-family.png'
    $stdoutPath = Join-Path $taskDir 'browser-factor-family.stdout.txt'
    $stderrPath = Join-Path $taskDir 'browser-factor-family.stderr.txt'

    $targets = New-Object System.Collections.Generic.List[object]
    for ($index = 0; $index -lt $FactorId.Count; $index++) {
        [void]$targets.Add([pscustomobject][ordered]@{
            factorId = [string]$FactorId[$index]
            expectedFamily = Get-IndexedArgument -Values $ExpectedFamily -Index $index
            rejectFamily = Get-IndexedArgument -Values $RejectFamily -Index $index
        })
    }

    $config = [pscustomobject][ordered]@{
        repoRoot = $repoRoot
        webRoot = $webRoot
        backendBaseUrl = $BackendBaseUrl
        frontendBaseUrl = $FrontendBaseUrl
        startPreview = [bool]$StartPreview
        timeoutMs = $TimeoutSec * 1000
        output = $outPath
        screenshot = $screenshotPath
        targets = @($targets.ToArray())
    }
    Write-JsonFile -Path $configPath -Value $config -Depth 16

    $nodeSource = @'
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const configPath = process.argv[2];
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const requireFromWeb = createRequire(path.join(config.webRoot, 'package.json'));
const { chromium } = requireFromWeb('playwright');
const uiFamilyMap = {
  '\u5176\u4ed6': '\u7efc\u5408',
  '[\u5916\u90e8]': '\u7efc\u5408',
};

function uiFamily(label) {
  const text = String(label || '').trim();
  return uiFamilyMap[text] || text;
}

let child;
let stdout = '';
let stderr = '';

async function frontendReady() {
  try {
    const response = await fetch(String(config.frontendBaseUrl || 'http://127.0.0.1:4173'), { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForPreview() {
  if (!config.startPreview) return;
  if (await frontendReady()) return;
  child = spawn(process.execPath, ['preview-server.mjs', '--watch', '--rebuild-on-start'], {
    cwd: config.webRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const started = Date.now();
  while (Date.now() - started < Math.max(config.timeoutMs, 90000)) {
    if (stdout.includes('Static preview listening')) return;
    if (child.exitCode !== null) {
      if ((stderr + stdout).includes('EADDRINUSE')) return;
      throw new Error(`preview exited ${child.exitCode}: ${stderr || stdout}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`preview did not become ready. stdout=${stdout.slice(-1000)} stderr=${stderr.slice(-1000)}`);
}

const result = {
  ok: false,
  url: '',
  checks: [],
  failedRequests: [],
  errors: [],
  stdoutTail: '',
  stderrTail: '',
};
let browser;
try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('requestfailed', (request) => {
    result.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText });
  });
  const base = String(config.frontendBaseUrl || 'http://127.0.0.1:4173').replace(/\/$/, '');
  result.url = `${base}/?v=${Date.now()}#/factors`;
  await page.goto(result.url, { waitUntil: 'networkidle', timeout: Math.max(config.timeoutMs, 60000) });
  await page.getByLabel('\u56e0\u5b50\u7ea7\u522b\u7b5b\u9009').getByRole('button', { name: '\u5168\u90e8\u56e0\u5b50\u7ea7\u522b', exact: true }).click().catch(() => undefined);
  await page.getByRole('tab', { name: /\u5168\u90e8\u751f\u547d\u5468\u671f/ }).click().catch(() => undefined);
  await page.waitForTimeout(500);

  const apiRows = await page.evaluate(async ({ backendBaseUrl, factorIds }) => {
    const response = await fetch(`${String(backendBaseUrl).replace(/\/$/, '')}/factors?lifecycle=all`);
    const payload = await response.json();
    return (payload.items || [])
      .filter((row) => factorIds.includes(row.id))
      .map((row) => ({
        id: row.id,
        displayName: row.display_name_cn || row.name || row.id,
        factorFamily: row.factor_family || '',
      }));
  }, { backendBaseUrl: config.backendBaseUrl, factorIds: config.targets.map((target) => target.factorId) });

  async function tableTextForFamily(label) {
    const familyFilter = page.getByLabel('\u56e0\u5b50\u65cf\u591a\u9009');
    await familyFilter.getByRole('button', { name: '\u5168\u90e8\u56e0\u5b50\u65cf', exact: true }).click();
    await familyFilter.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(500);
    return page.locator('.factor-table-wrap').innerText();
  }

  const cache = new Map();
  async function getFamilyText(label) {
    if (!cache.has(label)) {
      cache.set(label, await tableTextForFamily(label));
    }
    return cache.get(label);
  }

  for (const target of config.targets) {
    const row = apiRows.find((item) => item.id === target.factorId);
    const displayName = row?.displayName || target.factorId;
    const check = {
      factorId: target.factorId,
      displayName,
      apiFamily: row?.factorFamily || '',
      expectedFamily: target.expectedFamily || '',
      rejectFamily: target.rejectFamily || '',
      expectedUiFamily: uiFamily(target.expectedFamily),
      rejectUiFamily: uiFamily(target.rejectFamily),
      visibleInExpected: null,
      hiddenFromReject: null,
      ok: false,
    };
    if (check.expectedUiFamily) {
      const expectedText = await getFamilyText(check.expectedUiFamily);
      check.visibleInExpected = expectedText.includes(displayName) || expectedText.includes(target.factorId);
    }
    if (check.rejectUiFamily) {
      const rejectText = await getFamilyText(check.rejectUiFamily);
      check.hiddenFromReject = !(rejectText.includes(displayName) || rejectText.includes(target.factorId));
    }
    check.ok = (check.visibleInExpected !== false && check.hiddenFromReject !== false);
    result.checks.push(check);
  }

  await page.screenshot({ path: config.screenshot, fullPage: true });
  result.ok = result.failedRequests.length === 0 && result.checks.every((check) => check.ok);
} catch (error) {
  result.errors.push(String(error?.stack || error));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (child) child.kill();
  result.stdoutTail = stdout.slice(-2000);
  result.stderrTail = stderr.slice(-2000);
  await fs.writeFile(config.output, JSON.stringify(result, null, 2), 'utf8');
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
'@
    Write-Utf8Text -Path $nodeScriptPath -Text $nodeSource

    $stdout = ''
    $stderr = ''
    $exitCode = 0
    try {
        $stdout = (& node $nodeScriptPath $configPath 2>$stderrPath) | Out-String
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
    return [pscustomobject][ordered]@{
        ok = ($exitCode -eq 0 -and $null -ne $payload -and [bool](Get-Prop $payload 'ok'))
        exitCode = $exitCode
        output = $outPath
        screenshot = $screenshotPath
        stdout = $stdoutPath
        stderr = $stderrPath
        errors = @(ConvertTo-Array (Get-Prop $payload 'errors'))
        failedRequests = @(ConvertTo-Array (Get-Prop $payload 'failedRequests'))
        checks = @(ConvertTo-Array (Get-Prop $payload 'checks'))
    }
}

$preflightResult = if ($SkipPreflight) {
    [pscustomobject][ordered]@{ skipped = $true; ok = $true }
} else {
    Invoke-Preflight
}

$apiResult = if ($SkipApi) {
    [pscustomobject][ordered]@{ skipped = $true; ok = $true; checks = @() }
} else {
    Invoke-ApiProbe
}

$browserResult = if ($Browser) {
    Invoke-BrowserProbe
} else {
    [pscustomobject][ordered]@{ skipped = $true; ok = $true }
}

$failures = New-Object System.Collections.Generic.List[string]
if (-not [bool](Get-Prop $preflightResult 'ok')) {
    [void]$failures.Add('preflight_failed')
}
if (-not [bool](Get-Prop $apiResult 'ok')) {
    [void]$failures.Add('api_family_probe_failed')
}
if (-not [bool](Get-Prop $browserResult 'ok')) {
    [void]$failures.Add('browser_family_probe_failed')
}

$summary = [pscustomobject][ordered]@{
    ok = ($failures.Count -eq 0)
    taskDir = $taskDir
    strict = [bool]$Strict
    factors = $FactorId
    failures = @($failures.ToArray())
    preflight = $preflightResult
    api = $apiResult
    browser = $browserResult
}

$summaryPath = Join-Path $taskDir 'summary.json'
Write-JsonFile -Path $summaryPath -Value $summary -Depth 24

if ($Json) {
    $summary | ConvertTo-Json -Depth 24
} else {
    Write-Host "factor_family_route_probe ok=$($summary.ok) output=$summaryPath"
    if ($failures.Count -gt 0) {
        Write-Host ("failures=" + (($failures.ToArray()) -join ','))
    }
}

if ($Strict -and -not $summary.ok) {
    exit 1
}
