[CmdletBinding()]
param(
    [ValidateSet('All', 'Committed', 'WorkingTree', 'Auto')]
    [string]$Scope = 'All',
    [string]$Remote = 'origin',
    [string]$BaseRef,
    [string]$SinceLastValidated,
    [switch]$SkipFetch,
    [switch]$RequireSynced,
    [switch]$SkipTests,
    [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$fastScript = Join-Path $PSScriptRoot 'codex-validate-fast.ps1'
$parameters = @{
    GateMode = 'impact'
    Scope = $Scope
    Remote = $Remote
}

if (-not [string]::IsNullOrWhiteSpace($BaseRef)) {
    $parameters.BaseRef = $BaseRef
}
if (-not [string]::IsNullOrWhiteSpace($SinceLastValidated)) {
    $parameters.SinceLastValidated = $SinceLastValidated
}
if ($SkipFetch) {
    $parameters.SkipFetch = $true
}
if ($RequireSynced) {
    $parameters.RequireSynced = $true
}
if ($SkipTests) {
    $parameters.SkipTests = $true
}
if ($PlanOnly) {
    $parameters.PlanOnly = $true
}

& $fastScript @parameters
exit $LASTEXITCODE
