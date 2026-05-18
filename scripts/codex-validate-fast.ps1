[CmdletBinding()]
param(
    [ValidateSet('All', 'Committed', 'WorkingTree', 'Auto')]
    [string]$Scope = 'All',
    [string]$Remote = 'origin',
    [string]$BaseRef,
    [switch]$SkipFetch,
    [switch]$RequireSynced,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$webDir = Join-Path $repoRoot 'web'
$reportDir = Join-Path $repoRoot 'harness\reports\smoke'
$summaryPath = Join-Path $reportDir 'latest-fast-gate.md'
$backendReportPath = Join-Path $reportDir 'latest-fast-backend.txt'
$typesReportPath = Join-Path $reportDir 'latest-fast-frontend-types.txt'
$vitestReportPath = Join-Path $reportDir 'latest-fast-frontend-vitest.txt'
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
Set-Location -LiteralPath $repoRoot

$startedAt = Get-Date
$stepResults = [System.Collections.Generic.List[string]]::new()

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

function Write-Summary {
    param(
        [string]$Status,
        [string[]]$ChangedFiles,
        [string[]]$BackendTests,
        [string[]]$FrontendTests,
        [string]$Failure = ''
    )

    $finishedAt = Get-Date
    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in @(
        '# Codex Fast Gate',
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
        ''
    )) {
        [void]$lines.Add($line)
    }

    [void]$lines.Add('## Changed files')
    if ($ChangedFiles.Count -eq 0) {
        [void]$lines.Add('- <none>')
    } else {
        foreach ($file in $ChangedFiles) {
            [void]$lines.Add("- $file")
        }
    }

    [void]$lines.Add('')
    [void]$lines.Add('## Selected backend tests')
    if ($BackendTests.Count -eq 0) {
        [void]$lines.Add('- <none>')
    } else {
        foreach ($test in $BackendTests) {
            [void]$lines.Add("- $test")
        }
    }

    [void]$lines.Add('')
    [void]$lines.Add('## Selected frontend tests')
    if ($FrontendTests.Count -eq 0) {
        [void]$lines.Add('- <none>')
    } else {
        foreach ($test in $FrontendTests) {
            [void]$lines.Add("- $test")
        }
    }

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
    if ($exitCode -ne 0) {
        return @()
    }

    return @($output | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
}

function Invoke-GitCheck {
    param(
        [string[]]$Arguments,
        [string]$Label
    )

    Write-Host "fast-gate: $Label" -ForegroundColor Cyan
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
        throw "$Label failed with exit code $exitCode."
    }
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

function Add-UniqueString {
    param(
        [System.Collections.Generic.List[string]]$List,
        [string]$Value
    )

    $normalized = Normalize-RepoPath -PathValue $Value
    if (-not [string]::IsNullOrWhiteSpace($normalized) -and -not $List.Contains($normalized)) {
        [void]$List.Add($normalized)
    }
}

function Normalize-RepoPath {
    param(
        [string]$PathValue
    )

    return ([string]$PathValue).Trim() -replace '\\', '/'
}

function Add-ChangedFilesFromGit {
    param(
        [System.Collections.Generic.List[string]]$List,
        [string[]]$Arguments
    )

    foreach ($line in (Get-GitLines -Arguments $Arguments)) {
        Add-UniqueString -List $List -Value $line
    }
}

function Get-ChangedFiles {
    $files = [System.Collections.Generic.List[string]]::new()

    $includeCommitted = $Scope -in @('All', 'Committed', 'Auto')
    $includeWorkingTree = $Scope -in @('All', 'WorkingTree', 'Auto')

    if ($includeCommitted) {
        if (-not [string]::IsNullOrWhiteSpace($script:ResolvedBaseRef)) {
            Add-ChangedFilesFromGit -List $files -Arguments @('diff', '--name-only', "$script:ResolvedBaseRef...HEAD")
        } elseif ($Scope -eq 'Committed') {
            Add-ChangedFilesFromGit -List $files -Arguments @('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')
        }
    }

    if ($includeWorkingTree) {
        Add-ChangedFilesFromGit -List $files -Arguments @('diff', '--cached', '--name-only')
        Add-ChangedFilesFromGit -List $files -Arguments @('diff', '--name-only')
        Add-ChangedFilesFromGit -List $files -Arguments @('ls-files', '--others', '--exclude-standard')
    }

    return [string[]]$files
}

function Test-DocPath {
    param(
        [string]$PathValue
    )

    $path = Normalize-RepoPath -PathValue $PathValue
    if ($path -eq 'CHANGELOG.md') { return $true }
    if ($path -match '^(docs|harness/acceptance|output/ui-artifact-trace)/') { return $true }
    if ($path -match '^(src|tests|web/src|web/scripts|scripts)/') { return $false }
    if ($path -match '\.(md|mdx|rst|adoc|txt|png|jpg|jpeg|gif)$') { return $true }
    return $false
}

function Test-ContractPath {
    param(
        [string]$PathValue
    )

    $path = Normalize-RepoPath -PathValue $PathValue
    return $path -in @(
        'src/grit_backtest_platform/api.py',
        'src/grit_backtest_platform/models.py',
        'web/src/types.ts',
        'web/src/lib/workspace-adapters.ts',
        'web/src/lib/demoStoreContext.tsx'
    )
}

function Test-BackendRelatedPath {
    param(
        [string]$PathValue
    )

    $path = Normalize-RepoPath -PathValue $PathValue
    return (
        $path -like 'src/grit_backtest_platform/*' -or
        $path -like 'tests/*' -or
        $path -eq 'pyproject.toml' -or
        $path -eq 'scripts/pre_push_hook.py'
    )
}

function Test-FrontendRelatedPath {
    param(
        [string]$PathValue
    )

    $path = Normalize-RepoPath -PathValue $PathValue
    return (
        $path -like 'web/src/*' -or
        $path -like 'web/scripts/*' -or
        $path -eq 'web/package.json' -or
        $path -eq 'web/package-lock.json' -or
        $path -eq 'web/vite.config.ts' -or
        $path -eq 'web/preview-server.mjs'
    )
}

function Add-BackendTest {
    param(
        [System.Collections.Generic.List[string]]$Tests,
        [string]$TestPath
    )

    if ((Test-Path -LiteralPath (Join-Path $repoRoot $TestPath)) -and -not $Tests.Contains($TestPath)) {
        [void]$Tests.Add($TestPath)
    }
}

function Get-BackendTargetTests {
    param(
        [string[]]$ChangedFiles,
        [bool]$ContractChanged
    )

    $tests = [System.Collections.Generic.List[string]]::new()

    foreach ($file in $ChangedFiles) {
        $path = Normalize-RepoPath -PathValue $file
        if ($path -like 'tests/test_*.py') {
            Add-BackendTest -Tests $tests -TestPath ($path -replace '/', '\')
        }

        if ($path -match 'release_workflow|pre_push_hook') { Add-BackendTest -Tests $tests -TestPath 'tests\test_release_workflow.py' }
        if ($path -match 'composition') { Add-BackendTest -Tests $tests -TestPath 'tests\test_composition_api.py' }
        if ($path -match 'creation') { Add-BackendTest -Tests $tests -TestPath 'tests\test_creation_session_refresh.py' }
        if ($path -match 'real_backtest|backtest') { Add-BackendTest -Tests $tests -TestPath 'tests\test_real_backtest_api.py' }
        if ($path -match 'factor_research') { Add-BackendTest -Tests $tests -TestPath 'tests\test_factor_research_api.py' }
        if ($path -match 'factor_expression') { Add-BackendTest -Tests $tests -TestPath 'tests\test_factor_expression_engine.py' }
        if ($path -match 'factor_factory') { Add-BackendTest -Tests $tests -TestPath 'tests\test_factor_factory_api.py' }
        if ($path -match 'factor_mining') { Add-BackendTest -Tests $tests -TestPath 'tests\test_factor_mining_api.py' }
        if ($path -match 'factor_quarantine') { Add-BackendTest -Tests $tests -TestPath 'tests\test_factor_quarantine_api.py' }
        if ($path -match 'multi_factor') { Add-BackendTest -Tests $tests -TestPath 'tests\test_multi_factor_strategy_api.py' }
        if ($path -match 'optimization') {
            Add-BackendTest -Tests $tests -TestPath 'tests\test_optimization_execution_resume.py'
            Add-BackendTest -Tests $tests -TestPath 'tests\test_optimization_resume_api.py'
        }
        if ($path -match 'runtime_supervisor') { Add-BackendTest -Tests $tests -TestPath 'tests\test_runtime_supervisor.py' }
        if ($path -match 'strateg') { Add-BackendTest -Tests $tests -TestPath 'tests\test_strategies_smoke.py' }
        if ($path -match 'snapshot|pit|provider|market_data|universe') {
            Add-BackendTest -Tests $tests -TestPath 'tests\test_backend_api.py'
            Add-BackendTest -Tests $tests -TestPath 'tests\test_snapshot_data_plane.py'
        }
    }

    if ($ContractChanged) {
        Add-BackendTest -Tests $tests -TestPath 'tests\test_backend_api.py'
    }

    if ($tests.Count -eq 0) {
        Add-BackendTest -Tests $tests -TestPath 'tests\test_backend_api.py'
    }

    return [string[]]$tests
}

function Add-FrontendTest {
    param(
        [System.Collections.Generic.List[string]]$Tests,
        [string]$TestPath
    )

    if ((Test-Path -LiteralPath (Join-Path $webDir ("src\" + ($TestPath -replace '/', '\')))) -and -not $Tests.Contains($TestPath)) {
        [void]$Tests.Add($TestPath)
    }
}

function Get-FrontendTargetTests {
    param(
        [string[]]$ChangedFiles,
        [bool]$ContractChanged
    )

    $tests = [System.Collections.Generic.List[string]]::new()

    foreach ($file in $ChangedFiles) {
        $path = Normalize-RepoPath -PathValue $file
        if ($path -like 'web/src/*.test.ts' -or $path -like 'web/src/*.test.tsx' -or $path -like 'web/src/page-sections/*.test.tsx') {
            Add-FrontendTest -Tests $tests -TestPath ($path.Substring('web/src/'.Length))
        }

        if ($path -match 'workspace') { Add-FrontendTest -Tests $tests -TestPath 'workspace.dashboard.test.tsx' }
        if ($path -match 'snapshots') { Add-FrontendTest -Tests $tests -TestPath 'snapshots.page.test.tsx' }
        if ($path -match 'composition') {
            Add-FrontendTest -Tests $tests -TestPath 'composition.dashboard.test.tsx'
            Add-FrontendTest -Tests $tests -TestPath 'composition.workbench.test.tsx'
            Add-FrontendTest -Tests $tests -TestPath 'composition.detail.test.tsx'
            Add-FrontendTest -Tests $tests -TestPath 'composition.global-index.test.tsx'
        }
        if ($path -match 'leg') { Add-FrontendTest -Tests $tests -TestPath 'leg.inventory.test.tsx' }
        if ($path -match 'factor') {
            Add-FrontendTest -Tests $tests -TestPath 'factor.factory.test.tsx'
            Add-FrontendTest -Tests $tests -TestPath 'factor.sandbox.test.tsx'
            Add-FrontendTest -Tests $tests -TestPath 'factor.quarantine.test.tsx'
            Add-FrontendTest -Tests $tests -TestPath 'factor.model-builder.test.tsx'
        }
        if ($path -match 'optimization') { Add-FrontendTest -Tests $tests -TestPath 'optimization.module.test.tsx' }
        if ($path -match 'creation') {
            Add-FrontendTest -Tests $tests -TestPath 'creation-template.route.test.tsx'
            Add-FrontendTest -Tests $tests -TestPath 'creation.flow.test.tsx'
        }
        if ($path -match 'run-detail|runs') {
            Add-FrontendTest -Tests $tests -TestPath 'run-detail.page.test.tsx'
            Add-FrontendTest -Tests $tests -TestPath 'runs.index.page.test.tsx'
        }
        if ($path -match 'shell|route|app-runtime|appRouteContext|demoStoreContext') {
            Add-FrontendTest -Tests $tests -TestPath 'app.routes.foundation.test.tsx'
            Add-FrontendTest -Tests $tests -TestPath 'shell-frame.page-heading.test.tsx'
        }
        if ($path -match 'quickstart|preview-server') { Add-FrontendTest -Tests $tests -TestPath 'quickstart.preview.test.ts' }
    }

    if ($ContractChanged) {
        Add-FrontendTest -Tests $tests -TestPath 'app.routes.foundation.test.tsx'
    }

    if ($tests.Count -eq 0) {
        Add-FrontendTest -Tests $tests -TestPath 'app.routes.foundation.test.tsx'
    }

    return [string[]]$tests
}

function Invoke-BackendTests {
    param(
        [string[]]$Tests
    )

    $pythonExe = Get-PythonExecutable
    $pytestTempRoot = Join-Path $repoRoot '.tmp\pytest-runtime'
    $pythonTemp = Join-Path $pytestTempRoot 'python-temp'
    $baseTemp = Join-Path $pytestTempRoot ("codex-fast-{0}" -f (Get-Date -Format 'yyyyMMddHHmmssfff'))
    New-Item -ItemType Directory -Path $pythonTemp -Force | Out-Null
    New-Item -ItemType Directory -Path $baseTemp -Force | Out-Null

    $originalTemp = $env:TEMP
    $originalTmp = $env:TMP
    $originalTmpDir = $env:TMPDIR

    try {
        $env:TEMP = $pythonTemp
        $env:TMP = $pythonTemp
        $env:TMPDIR = $pythonTemp

        $args = @('-m', 'pytest') + $Tests + @('--basetemp', $baseTemp)
        Write-Host "fast-gate: backend targeted pytest -> $($Tests -join ', ')" -ForegroundColor Cyan
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = & $pythonExe @args 2>&1
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        @(
            '# Codex Fast Backend',
            "started_at = $(Get-Date -Format o)",
            "command = $pythonExe $($args -join ' ')",
            ''
        ) + $output | Set-Content -LiteralPath $backendReportPath -Encoding utf8
        $output | ForEach-Object { Write-Host $_ }
        if ($exitCode -ne 0) {
            throw "Backend targeted tests failed. See $backendReportPath"
        }
    } finally {
        if ($null -ne $originalTemp) { $env:TEMP = $originalTemp } else { Remove-Item Env:TEMP -ErrorAction SilentlyContinue }
        if ($null -ne $originalTmp) { $env:TMP = $originalTmp } else { Remove-Item Env:TMP -ErrorAction SilentlyContinue }
        if ($null -ne $originalTmpDir) { $env:TMPDIR = $originalTmpDir } else { Remove-Item Env:TMPDIR -ErrorAction SilentlyContinue }
    }
}

function Invoke-FrontendTypes {
    $nodeExe = Get-NodeExecutable
    $tscEntry = Join-Path $webDir 'node_modules\typescript\bin\tsc'
    if (-not (Test-Path -LiteralPath $tscEntry)) {
        throw "Required TypeScript entrypoint missing: $tscEntry"
    }

    Write-Host 'fast-gate: frontend TypeScript -> tsc --noEmit' -ForegroundColor Cyan
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $nodeExe $tscEntry '--noEmit' 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    @(
        '# Codex Fast Frontend Types',
        "started_at = $(Get-Date -Format o)",
        "command = $nodeExe $tscEntry --noEmit",
        ''
    ) + $output | Set-Content -LiteralPath $typesReportPath -Encoding utf8
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0) {
        throw "Frontend TypeScript validation failed. See $typesReportPath"
    }
}

function Invoke-FrontendTests {
    param(
        [string[]]$Tests
    )

    $nodeExe = Get-NodeExecutable
    $vitestRunner = Join-Path $webDir 'scripts\run-vitest-fixed.cjs'
    if (-not (Test-Path -LiteralPath $vitestRunner)) {
        throw "Required Vitest runner missing: $vitestRunner"
    }

    Write-Host "fast-gate: frontend targeted Vitest -> $($Tests -join ', ')" -ForegroundColor Cyan
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $nodeExe $vitestRunner @Tests 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    @(
        '# Codex Fast Frontend Vitest',
        "started_at = $(Get-Date -Format o)",
        "command = $nodeExe $vitestRunner $($Tests -join ' ')",
        ''
    ) + $output | Set-Content -LiteralPath $vitestReportPath -Encoding utf8
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0) {
        throw "Frontend targeted tests failed. See $vitestReportPath"
    }
}

function Get-ToolingSyntaxTargets {
    param(
        [string[]]$ChangedFiles
    )

    $targets = [ordered]@{
        PowerShell = [System.Collections.Generic.List[string]]::new()
        Python = [System.Collections.Generic.List[string]]::new()
    }

    foreach ($file in $ChangedFiles) {
        $path = Normalize-RepoPath -PathValue $file
        if ($path -like 'scripts/*.ps1' -or $path -like '.githooks/*.ps1') {
            if (-not $targets.PowerShell.Contains($path)) {
                [void]$targets.PowerShell.Add($path)
            }
        }
        if ($path -like 'scripts/*.py') {
            if (-not $targets.Python.Contains($path)) {
                [void]$targets.Python.Add($path)
            }
        }
    }

    return $targets
}

function Invoke-ToolingSyntaxChecks {
    param(
        [string[]]$ChangedFiles
    )

    $targets = Get-ToolingSyntaxTargets -ChangedFiles $ChangedFiles
    $checked = [System.Collections.Generic.List[string]]::new()

    foreach ($path in $targets.PowerShell) {
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
        [void]$checked.Add($path)
    }

    if ($targets.Python.Count -gt 0) {
        $pythonExe = Get-PythonExecutable
        $pythonTargets = @()
        foreach ($path in $targets.Python) {
            $fullPath = Join-Path $repoRoot ($path -replace '/', '\')
            if (Test-Path -LiteralPath $fullPath) {
                $pythonTargets += $path
            }
        }
        if ($pythonTargets.Count -gt 0) {
            $previousErrorActionPreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                $output = & $pythonExe -m py_compile @pythonTargets 2>&1
                $exitCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $previousErrorActionPreference
            }
            if ($output) {
                $output | ForEach-Object { Write-Host $_ }
            }
            if ($exitCode -ne 0) {
                throw "Python script compile check failed for $($pythonTargets -join ', ')."
            }
            foreach ($path in $pythonTargets) {
                [void]$checked.Add($path)
            }
        }
    }

    if ($checked.Count -gt 0) {
        Add-StepResult -Label 'tooling syntax checks' -Status 'ok' -Details ($checked -join ', ')
    } else {
        Add-StepResult -Label 'tooling syntax checks' -Status 'skip' -Details 'no changed PowerShell or scripts/*.py targets'
    }
}

$script:ResolvedBaseRef = ''
$changedFiles = @()
$backendTests = @()
$frontendTests = @()

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

    Invoke-GitCheck -Arguments @('diff', '--cached', '--check') -Label 'git diff --cached --check'
    Add-StepResult -Label 'cached whitespace check' -Status 'ok' -Details 'git diff --cached --check'

    $includeWorkingTreeChecks = $Scope -in @('All', 'WorkingTree', 'Auto')
    $includeCommittedChecks = $Scope -in @('All', 'Committed', 'Auto')

    if ($includeWorkingTreeChecks) {
        Invoke-GitCheck -Arguments @('diff', '--check') -Label 'git diff --check'
        Add-StepResult -Label 'working-tree whitespace check' -Status 'ok' -Details 'git diff --check'
    } else {
        Add-StepResult -Label 'working-tree whitespace check' -Status 'skip' -Details "scope=$Scope"
    }

    if ($includeCommittedChecks -and -not [string]::IsNullOrWhiteSpace($script:ResolvedBaseRef)) {
        Invoke-GitCheck -Arguments @('diff', '--check', "$script:ResolvedBaseRef...HEAD") -Label "git diff --check $script:ResolvedBaseRef...HEAD"
        Add-StepResult -Label 'committed whitespace check' -Status 'ok' -Details "git diff --check $script:ResolvedBaseRef...HEAD"
    } elseif ($includeCommittedChecks) {
        Add-StepResult -Label 'committed whitespace check' -Status 'skip' -Details 'no upstream or base ref found'
    } else {
        Add-StepResult -Label 'committed whitespace check' -Status 'skip' -Details "scope=$Scope"
    }

    $changedFiles = @(Get-ChangedFiles)
    if ($changedFiles.Count -eq 0) {
        Add-StepResult -Label 'change scope' -Status 'ok' -Details 'no changed files detected'
        Write-Host 'fast-gate: no changed files detected; no backend/frontend tests selected.' -ForegroundColor Green
        Write-Summary -Status 'ok' -ChangedFiles $changedFiles -BackendTests @() -FrontendTests @()
        exit 0
    }

    $docOnly = $true
    $contractChanged = $false
    $backendNeeded = $false
    $frontendNeeded = $false

    foreach ($file in $changedFiles) {
        if (-not (Test-DocPath -PathValue $file)) { $docOnly = $false }
        if (Test-ContractPath -PathValue $file) { $contractChanged = $true }
        if (Test-BackendRelatedPath -PathValue $file) { $backendNeeded = $true }
        if (Test-FrontendRelatedPath -PathValue $file) { $frontendNeeded = $true }
    }

    Invoke-ToolingSyntaxChecks -ChangedFiles $changedFiles

    if ($contractChanged) {
        $backendNeeded = $true
        $frontendNeeded = $true
    }

    if ($docOnly) {
        Add-StepResult -Label 'affected validation' -Status 'skip' -Details 'documentation/changelog/artifact-only changes'
        Write-Host 'fast-gate: documentation-only change set; backend/frontend tests skipped.' -ForegroundColor Green
        Write-Summary -Status 'ok' -ChangedFiles $changedFiles -BackendTests @() -FrontendTests @()
        exit 0
    }

    if ($backendNeeded) {
        $backendTests = @(Get-BackendTargetTests -ChangedFiles $changedFiles -ContractChanged $contractChanged)
    }
    if ($frontendNeeded) {
        $frontendTests = @(Get-FrontendTargetTests -ChangedFiles $changedFiles -ContractChanged $contractChanged)
    }

    Add-StepResult -Label 'affected validation' -Status 'ok' -Details "backend=$backendNeeded frontend=$frontendNeeded contract=$contractChanged"

    if ($SkipTests) {
        Add-StepResult -Label 'tests' -Status 'skip' -Details 'skipped by caller'
        Write-Summary -Status 'ok' -ChangedFiles $changedFiles -BackendTests $backendTests -FrontendTests $frontendTests
        exit 0
    }

    if ($backendNeeded) {
        Invoke-BackendTests -Tests $backendTests
        Add-StepResult -Label 'backend targeted tests' -Status 'ok' -Details "see $backendReportPath"
    } else {
        Add-StepResult -Label 'backend targeted tests' -Status 'skip' -Details 'no backend/API contract changes detected'
    }

    if ($frontendNeeded) {
        Invoke-FrontendTypes
        Add-StepResult -Label 'frontend TypeScript' -Status 'ok' -Details "see $typesReportPath"
        Invoke-FrontendTests -Tests $frontendTests
        Add-StepResult -Label 'frontend targeted tests' -Status 'ok' -Details "see $vitestReportPath"
    } else {
        Add-StepResult -Label 'frontend TypeScript/Vitest' -Status 'skip' -Details 'no frontend/API contract changes detected'
    }

    Write-Summary -Status 'ok' -ChangedFiles $changedFiles -BackendTests $backendTests -FrontendTests $frontendTests
    Write-Host "fast-gate: passed. Summary: $summaryPath" -ForegroundColor Green
} catch {
    $message = $_.Exception.Message
    Add-StepResult -Label 'fast gate' -Status 'failed' -Details $message
    Write-Summary -Status 'failed' -ChangedFiles $changedFiles -BackendTests $backendTests -FrontendTests $frontendTests -Failure $message
    Write-Host "fast-gate: failed. Summary: $summaryPath" -ForegroundColor Red
    throw
}
