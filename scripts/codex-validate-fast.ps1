[CmdletBinding()]
param(
    [ValidateSet('All', 'Committed', 'WorkingTree', 'Auto')]
    [string]$Scope = 'All',
    [string]$Remote = 'origin',
    [string]$BaseRef,
    [switch]$SkipFetch,
    [switch]$RequireSynced,
    [switch]$SkipTests,
    [switch]$PlanOnly,
    [int]$MaxSeconds = 300,
    [ValidateSet('fast', 'impact')]
    [string]$GateMode = 'fast'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$webDir = Join-Path $repoRoot 'web'
$reportDir = Join-Path $repoRoot 'harness\reports\smoke'
$gateTitle = if ($GateMode -eq 'impact') { 'Impact' } else { 'Fast' }
$reportPrefix = if ($GateMode -eq 'impact') { 'impact' } else { 'fast' }
$summaryPath = Join-Path $reportDir "latest-$reportPrefix-gate.md"
$backendReportPath = Join-Path $reportDir "latest-$reportPrefix-backend.txt"
$typesReportPath = Join-Path $reportDir "latest-$reportPrefix-frontend-types.txt"
$vitestReportPath = Join-Path $reportDir "latest-$reportPrefix-frontend-vitest.txt"
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$plannerPath = Join-Path $PSScriptRoot 'git_gate_plan.py'

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
Set-Location -LiteralPath $repoRoot

$startedAt = Get-Date
$stepResults = [System.Collections.Generic.List[string]]::new()
$script:ResolvedBaseRef = ''
$script:Plan = $null

function Add-StepResult {
    param(
        [string]$Label,
        [string]$Status,
        [string]$Details = ''
    )

    [void]$stepResults.Add("- [$Status] $Label")
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        [void]$stepResults.Add("  $Details")
    }
}

function ConvertTo-StringArray {
    param(
        [object]$Value
    )

    if ($null -eq $Value) {
        return @()
    }
    if ($Value -is [System.Array]) {
        return @($Value | ForEach-Object { [string]$_ })
    }
    return @([string]$Value)
}

function Format-ListSection {
    param(
        [System.Collections.Generic.List[string]]$Lines,
        [string]$Title,
        [string[]]$Items
    )

    [void]$Lines.Add('')
    [void]$Lines.Add($Title)
    if ($Items.Count -eq 0) {
        [void]$Lines.Add('- <none>')
        return
    }
    foreach ($item in $Items) {
        [void]$Lines.Add("- $item")
    }
}

function Write-Summary {
    param(
        [string]$Status,
        [string]$Failure = ''
    )

    $finishedAt = Get-Date
    $plan = $script:Plan
    $rawChanged = @(ConvertTo-StringArray $plan.raw_changed_files)
    $evidenceFiles = @(ConvertTo-StringArray $plan.evidence_asset_files)
    $docFiles = @(ConvertTo-StringArray $plan.documentation_files)
    $engineeringFiles = @(ConvertTo-StringArray $plan.engineering_files)
    $backendTests = @(ConvertTo-StringArray $plan.backend_tests)
    $frontendTests = @(ConvertTo-StringArray $plan.frontend_tests)
    $domains = @(ConvertTo-StringArray $plan.domains)
    $reasons = @(ConvertTo-StringArray $plan.ineligible_reasons)

    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in @(
        "# Codex $gateTitle Gate",
        '',
        ('- status: ' + $Status),
        ('- started_at: ' + $startedAt.ToString('o')),
        ('- finished_at: ' + $finishedAt.ToString('o')),
        ('- scope: ' + $Scope),
        ('- remote: ' + $Remote),
        ('- base_ref: ' + $(if ([string]::IsNullOrWhiteSpace($script:ResolvedBaseRef)) { '<none>' } else { $script:ResolvedBaseRef })),
        ('- skip_fetch: ' + $SkipFetch.IsPresent),
        ('- require_synced: ' + $RequireSynced.IsPresent),
        ('- skip_tests: ' + $SkipTests.IsPresent),
        ('- plan_only: ' + $PlanOnly.IsPresent),
        ('- max_seconds: ' + $(if ($GateMode -eq 'fast') { $MaxSeconds } else { '<none>' })),
        ('- raw_changed_count: ' + $rawChanged.Count),
        ('- evidence_asset_count: ' + $evidenceFiles.Count),
        ('- documentation_count: ' + $docFiles.Count),
        ('- engineering_count: ' + $engineeringFiles.Count),
        ('- domains: ' + $(if ($domains.Count -eq 0) { '<none>' } else { $domains -join ', ' })),
        ('- contract_changed: ' + $plan.contract_changed),
        ('- validation_tooling_changed: ' + $plan.validation_tooling_changed),
        ('- eligible: ' + $plan.eligible),
        ''
    )) {
        [void]$lines.Add($line)
    }

    Format-ListSection -Lines $lines -Title '## Ineligible reasons' -Items $reasons
    Format-ListSection -Lines $lines -Title '## Evidence assets excluded from impact' -Items $evidenceFiles
    Format-ListSection -Lines $lines -Title '## Engineering files' -Items $engineeringFiles
    Format-ListSection -Lines $lines -Title '## Selected backend tests' -Items $backendTests
    Format-ListSection -Lines $lines -Title '## Selected frontend tests' -Items $frontendTests

    [void]$lines.Add('')
    [void]$lines.Add('## Steps')
    foreach ($step in $stepResults) {
        [void]$lines.Add($step)
    }

    if (-not [string]::IsNullOrWhiteSpace($Failure)) {
        [void]$lines.Add('')
        [void]$lines.Add('## Failure')
        [void]$lines.Add($Failure)
    }

    $lines | Set-Content -LiteralPath $summaryPath -Encoding utf8
}

function Get-PythonExecutable {
    if (Test-Path -LiteralPath $venvPython) {
        return $venvPython
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand) {
        return $pythonCommand.Source
    }

    throw 'Python executable not found. Initialize .venv or make python available in PATH.'
}

function Get-NodeExecutable {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        throw 'Node executable not found in PATH.'
    }
    return $nodeCommand.Source
}

function Get-GitLines {
    param(
        [string[]]$Arguments
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & git @Arguments 2>$null
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($exitCode -ne 0 -or $null -eq $output) {
        return @()
    }
    return @($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { [string]$_ })
}

function Invoke-GitCheck {
    param(
        [string[]]$Arguments,
        [string]$Label
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & git @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($output) {
        $output | ForEach-Object { Write-Host $_ }
    }
    if ($exitCode -ne 0) {
        throw "Git check failed: $Label"
    }
}

function Invoke-GitCheckForPaths {
    param(
        [string[]]$Arguments,
        [string[]]$Paths,
        [string]$Label
    )

    if ($Paths.Count -eq 0) {
        Add-StepResult -Label $Label -Status 'skip' -Details 'only evidence assets changed'
        return
    }

    Invoke-GitCheck -Arguments ($Arguments + @('--') + $Paths) -Label $Label
    Add-StepResult -Label $Label -Status 'ok' -Details (($Arguments + @('--') + $Paths) -join ' ')
}

function Test-GitCommitRef {
    param(
        [string]$Ref
    )

    if ([string]::IsNullOrWhiteSpace($Ref)) {
        return $false
    }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & git rev-parse --verify --quiet "$Ref^{commit}" 1>$null 2>$null
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return $exitCode -eq 0
}

function Resolve-BaseRef {
    if (-not [string]::IsNullOrWhiteSpace($BaseRef) -and (Test-GitCommitRef -Ref $BaseRef)) {
        return $BaseRef
    }

    $upstream = @(Get-GitLines -Arguments @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'))
    if ($upstream.Count -gt 0 -and (Test-GitCommitRef -Ref $upstream[0])) {
        return $upstream[0]
    }

    $currentBranch = @(Get-GitLines -Arguments @('rev-parse', '--abbrev-ref', 'HEAD'))
    if ($currentBranch.Count -gt 0 -and $currentBranch[0] -ne 'HEAD') {
        $remoteBranch = "$Remote/$($currentBranch[0])"
        if (Test-GitCommitRef -Ref $remoteBranch) {
            return $remoteBranch
        }
    }

    return ''
}

function Invoke-GatePlan {
    $pythonExe = Get-PythonExecutable
    if (-not (Test-Path -LiteralPath $plannerPath)) {
        throw "Gate planner is missing: $plannerPath"
    }

    $args = @($plannerPath, '--mode', $GateMode, '--scope', $Scope, '--remote', $Remote, '--repo-root', $repoRoot)
    if (-not [string]::IsNullOrWhiteSpace($script:ResolvedBaseRef)) {
        $args += @('--base-ref', $script:ResolvedBaseRef)
    }

    $json = & $pythonExe @args
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($json | Out-String))) {
        throw 'Gate planner failed.'
    }
    $script:Plan = $json | ConvertFrom-Json
    $rawCount = @(ConvertTo-StringArray $script:Plan.raw_changed_files).Count
    $engineeringCount = @(ConvertTo-StringArray $script:Plan.engineering_files).Count
    $evidenceCount = @(ConvertTo-StringArray $script:Plan.evidence_asset_files).Count
    Add-StepResult -Label 'gate plan' -Status 'ok' -Details "mode=$GateMode raw=$rawCount engineering=$engineeringCount evidence=$evidenceCount"
}

function Get-ValidationPaths {
    $docs = @(ConvertTo-StringArray $script:Plan.documentation_files)
    $engineering = @(ConvertTo-StringArray $script:Plan.engineering_files)
    return @($docs + $engineering)
}

function Assert-FastBudget {
    param(
        [string]$Step
    )

    if ($GateMode -ne 'fast' -or $MaxSeconds -le 0) {
        return
    }
    $elapsed = ((Get-Date) - $startedAt).TotalSeconds
    if ($elapsed -gt $MaxSeconds) {
        throw "Fast gate exceeded ${MaxSeconds}s before $Step."
    }
}

function Invoke-PythonCompile {
    $targets = @(ConvertTo-StringArray $script:Plan.python_compile_files)
    if ($targets.Count -eq 0) {
        Add-StepResult -Label 'python source compile' -Status 'skip' -Details 'no changed Python source files'
        return
    }

    Assert-FastBudget -Step 'python compile'
    $pythonExe = Get-PythonExecutable
    Write-Host "$reportPrefix-gate: python compile -> $($targets -join ', ')" -ForegroundColor Cyan
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $pythonExe -m py_compile @targets 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($output) {
        $output | ForEach-Object { Write-Host $_ }
    }
    if ($exitCode -ne 0) {
        throw "Python source compile failed for $($targets -join ', ')."
    }
    Add-StepResult -Label 'python source compile' -Status 'ok' -Details ($targets -join ', ')
}

function Invoke-PowerShellSyntax {
    $engineering = @(ConvertTo-StringArray $script:Plan.engineering_files)
    $targets = @($engineering | Where-Object { $_ -like '*.ps1' })
    if ($targets.Count -eq 0) {
        Add-StepResult -Label 'PowerShell syntax checks' -Status 'skip' -Details 'no changed PowerShell targets'
        return
    }

    foreach ($path in $targets) {
        $fullPath = Join-Path $repoRoot ($path -replace '/', '\')
        if (-not (Test-Path -LiteralPath $fullPath)) {
            continue
        }
        $errors = $null
        [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $fullPath), [ref]$null, [ref]$errors) | Out-Null
        if ($errors.Count -gt 0) {
            $messages = ($errors | ForEach-Object { $_.Message }) -join '; '
            throw "PowerShell syntax check failed for ${path}: $messages"
        }
    }

    Add-StepResult -Label 'PowerShell syntax checks' -Status 'ok' -Details ($targets -join ', ')
}

function Invoke-BackendTests {
    $tests = @(ConvertTo-StringArray $script:Plan.backend_tests)
    if ($tests.Count -eq 0) {
        Add-StepResult -Label 'backend targeted tests' -Status 'skip' -Details 'no backend owner tests selected'
        return
    }

    Assert-FastBudget -Step 'backend targeted tests'
    $pythonExe = Get-PythonExecutable
    $pytestTempRoot = Join-Path $repoRoot '.tmp\pytest-runtime'
    $pythonTemp = Join-Path $pytestTempRoot 'python-temp'
    $baseTemp = Join-Path $pytestTempRoot ("codex-$reportPrefix-{0}" -f (Get-Date -Format 'yyyyMMddHHmmssfff'))
    New-Item -ItemType Directory -Path $pythonTemp -Force | Out-Null
    New-Item -ItemType Directory -Path $baseTemp -Force | Out-Null

    $originalTemp = $env:TEMP
    $originalTmp = $env:TMP
    $originalTmpDir = $env:TMPDIR

    try {
        $env:TEMP = $pythonTemp
        $env:TMP = $pythonTemp
        $env:TMPDIR = $pythonTemp

        $args = @('-m', 'pytest') + $tests + @('--basetemp', $baseTemp)
        Write-Host "$reportPrefix-gate: backend targeted pytest -> $($tests -join ', ')" -ForegroundColor Cyan
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = & $pythonExe @args 2>&1
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        @(
            "# Codex $gateTitle Backend",
            "started_at = $(Get-Date -Format o)",
            "command = $pythonExe $($args -join ' ')",
            ''
        ) + $output | Set-Content -LiteralPath $backendReportPath -Encoding utf8
        $output | ForEach-Object { Write-Host $_ }
        if ($exitCode -ne 0) {
            throw "Backend targeted tests failed. See $backendReportPath"
        }
        Add-StepResult -Label 'backend targeted tests' -Status 'ok' -Details "see $backendReportPath"
    } finally {
        if ($null -ne $originalTemp) { $env:TEMP = $originalTemp } else { Remove-Item Env:TEMP -ErrorAction SilentlyContinue }
        if ($null -ne $originalTmp) { $env:TMP = $originalTmp } else { Remove-Item Env:TMP -ErrorAction SilentlyContinue }
        if ($null -ne $originalTmpDir) { $env:TMPDIR = $originalTmpDir } else { Remove-Item Env:TMPDIR -ErrorAction SilentlyContinue }
    }
}

function Invoke-FrontendTypes {
    if ($GateMode -ne 'impact') {
        Add-StepResult -Label 'frontend TypeScript' -Status 'skip' -Details 'fast gate skips global tsc'
        return
    }

    $frontendTests = @(ConvertTo-StringArray $script:Plan.frontend_tests)
    $domains = @(ConvertTo-StringArray $script:Plan.domains)
    if ($frontendTests.Count -eq 0 -and -not $domains.Contains('frontend')) {
        Add-StepResult -Label 'frontend TypeScript' -Status 'skip' -Details 'no frontend impact'
        return
    }

    $nodeExe = Get-NodeExecutable
    $tscEntry = Join-Path $webDir 'node_modules\typescript\bin\tsc'
    if (-not (Test-Path -LiteralPath $tscEntry)) {
        throw "Required TypeScript entrypoint missing: $tscEntry"
    }
    $tsconfigPath = Join-Path $webDir 'tsconfig.json'
    if (-not (Test-Path -LiteralPath $tsconfigPath)) {
        throw "Required TypeScript config missing: $tsconfigPath"
    }

    Write-Host 'impact-gate: frontend TypeScript -> tsc --project web/tsconfig.json --noEmit' -ForegroundColor Cyan
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $nodeExe $tscEntry '--project' $tsconfigPath '--noEmit' 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    @(
        "# Codex $gateTitle Frontend Types",
        "started_at = $(Get-Date -Format o)",
        "command = $nodeExe $tscEntry --project $tsconfigPath --noEmit",
        ''
    ) + $output | Set-Content -LiteralPath $typesReportPath -Encoding utf8
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0) {
        throw "Frontend TypeScript validation failed. See $typesReportPath"
    }
    Add-StepResult -Label 'frontend TypeScript' -Status 'ok' -Details "see $typesReportPath"
}

function Invoke-FrontendTests {
    $tests = @(ConvertTo-StringArray $script:Plan.frontend_tests)
    if ($tests.Count -eq 0) {
        Add-StepResult -Label 'frontend targeted tests' -Status 'skip' -Details 'no frontend owner tests selected'
        return
    }

    Assert-FastBudget -Step 'frontend targeted tests'
    $nodeExe = Get-NodeExecutable
    $vitestRunner = Join-Path $webDir 'scripts\run-vitest-fixed.cjs'
    if (-not (Test-Path -LiteralPath $vitestRunner)) {
        throw "Required Vitest runner missing: $vitestRunner"
    }

    Write-Host "$reportPrefix-gate: frontend targeted Vitest -> $($tests -join ', ')" -ForegroundColor Cyan
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $previousLocation = Get-Location
    try {
        Set-Location -LiteralPath $webDir
        $output = & $nodeExe $vitestRunner @tests 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        Set-Location -LiteralPath $previousLocation
        $ErrorActionPreference = $previousErrorActionPreference
    }
    @(
        "# Codex $gateTitle Frontend Vitest",
        "started_at = $(Get-Date -Format o)",
        "cwd = $webDir",
        "command = $nodeExe $vitestRunner $($tests -join ' ')",
        ''
    ) + $output | Set-Content -LiteralPath $vitestReportPath -Encoding utf8
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0) {
        throw "Frontend targeted tests failed. See $vitestReportPath"
    }
    Add-StepResult -Label 'frontend targeted tests' -Status 'ok' -Details "see $vitestReportPath"
}

try {
    if (-not $SkipFetch) {
        Invoke-GitCheck -Arguments @('fetch', $Remote) -Label "git fetch $Remote"
        Add-StepResult -Label 'git fetch' -Status 'ok' -Details "remote=$Remote"
    } else {
        Add-StepResult -Label 'git fetch' -Status 'skip' -Details 'skipped by caller'
    }

    $script:ResolvedBaseRef = Resolve-BaseRef
    if (-not [string]::IsNullOrWhiteSpace($script:ResolvedBaseRef)) {
        Invoke-GitCheck -Arguments @('merge-base', '--is-ancestor', $script:ResolvedBaseRef, 'HEAD') -Label "merge-base $script:ResolvedBaseRef -> HEAD"
        $divergence = @(Get-GitLines -Arguments @('rev-list', '--left-right', '--count', "$script:ResolvedBaseRef...HEAD"))
        if ($divergence.Count -gt 0) {
            $parts = $divergence[0].Split([char[]]" `t", [System.StringSplitOptions]::RemoveEmptyEntries)
            if ($parts.Count -eq 2) {
                $behind = [int]$parts[0]
                $ahead = [int]$parts[1]
                Add-StepResult -Label 'ahead/behind' -Status 'ok' -Details "behind=$behind ahead=$ahead base=$script:ResolvedBaseRef"
                if ($behind -ne 0) {
                    throw "Branch is behind $script:ResolvedBaseRef by $behind commit(s)."
                }
                if ($RequireSynced -and ($behind -ne 0 -or $ahead -ne 0)) {
                    throw "Branch is not synced with $script:ResolvedBaseRef (behind=$behind ahead=$ahead)."
                }
            }
        }
    } else {
        Add-StepResult -Label 'merge-base/ahead-behind' -Status 'skip' -Details 'no upstream or base ref found'
    }

    Invoke-GatePlan
    $validationPaths = @(Get-ValidationPaths)
    if (@(ConvertTo-StringArray $script:Plan.raw_changed_files).Count -eq 0) {
        Add-StepResult -Label 'change scope' -Status 'ok' -Details 'no changed files detected'
        Write-Summary -Status 'ok'
        Write-Host "$reportPrefix-gate: no changed files detected." -ForegroundColor Green
        exit 0
    }

    Invoke-GitCheckForPaths -Arguments @('diff', '--cached', '--check') -Paths $validationPaths -Label 'cached whitespace check'

    $includeWorkingTreeChecks = $Scope -in @('All', 'WorkingTree', 'Auto')
    $includeCommittedChecks = $Scope -in @('All', 'Committed', 'Auto')

    if ($includeWorkingTreeChecks) {
        Invoke-GitCheckForPaths -Arguments @('diff', '--check') -Paths $validationPaths -Label 'working-tree whitespace check'
    } else {
        Add-StepResult -Label 'working-tree whitespace check' -Status 'skip' -Details "scope=$Scope"
    }

    if ($includeCommittedChecks -and -not [string]::IsNullOrWhiteSpace($script:ResolvedBaseRef)) {
        Invoke-GitCheckForPaths -Arguments @('diff', '--check', "$script:ResolvedBaseRef...HEAD") -Paths $validationPaths -Label 'committed whitespace check'
    } elseif ($includeCommittedChecks) {
        Add-StepResult -Label 'committed whitespace check' -Status 'skip' -Details 'no upstream or base ref found'
    } else {
        Add-StepResult -Label 'committed whitespace check' -Status 'skip' -Details "scope=$Scope"
    }

    if ($PlanOnly) {
        $status = if ($GateMode -eq 'fast' -and -not [bool]$script:Plan.eligible) { 'not-fast' } else { 'ok' }
        Add-StepResult -Label 'tests' -Status 'skip' -Details 'plan only'
        Write-Summary -Status $status
        Write-Host "$reportPrefix-gate: plan written. Summary: $summaryPath" -ForegroundColor Cyan
        exit 0
    }

    if ($GateMode -eq 'fast' -and -not [bool]$script:Plan.eligible) {
        Add-StepResult -Label 'fast eligibility' -Status 'not-fast' -Details (@(ConvertTo-StringArray $script:Plan.ineligible_reasons) -join '; ')
        Write-Summary -Status 'not-fast'
        Write-Host "fast-gate: not fast eligible. Summary: $summaryPath" -ForegroundColor Yellow
        Write-Host 'fast-gate: run .\scripts\codex-validate-impact.ps1 -Scope Committed for broad impacted validation, or .\scripts\codex-validate-full.ps1 for release/full validation.' -ForegroundColor Yellow
        exit 2
    }

    if ($SkipTests) {
        Add-StepResult -Label 'tests' -Status 'skip' -Details 'skipped by caller'
        Write-Summary -Status 'ok'
        exit 0
    }

    Invoke-PowerShellSyntax
    Invoke-PythonCompile
    Invoke-BackendTests
    Invoke-FrontendTypes
    Invoke-FrontendTests

    Assert-FastBudget -Step 'summary'
    Write-Summary -Status 'ok'
    Write-Host "$reportPrefix-gate: passed. Summary: $summaryPath" -ForegroundColor Green
} catch {
    $message = $_.Exception.Message
    Add-StepResult -Label "$reportPrefix gate" -Status 'failed' -Details $message
    if ($null -eq $script:Plan) {
        $script:Plan = [pscustomobject]@{
            raw_changed_files = @()
            evidence_asset_files = @()
            documentation_files = @()
            engineering_files = @()
            backend_tests = @()
            frontend_tests = @()
            domains = @()
            ineligible_reasons = @()
            contract_changed = $false
            validation_tooling_changed = $false
            eligible = $false
        }
    }
    Write-Summary -Status 'failed' -Failure $message
    Write-Host "$reportPrefix-gate: failed. Summary: $summaryPath" -ForegroundColor Red
    throw
}
