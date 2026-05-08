[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$SupervisorArgs = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$supervisorScript = Join-Path $repoRoot 'scripts\runtime_supervisor.py'

if (Test-Path -LiteralPath $venvPython) {
    $pythonExe = $venvPython
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($null -eq $pythonCommand) {
        throw 'Python executable not found. Initialize .venv or make python available in PATH.'
    }
    $pythonExe = $pythonCommand.Source
}

& $pythonExe $supervisorScript @SupervisorArgs
exit $LASTEXITCODE
