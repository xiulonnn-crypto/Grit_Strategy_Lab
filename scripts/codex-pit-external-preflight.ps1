param(
  [string]$CacheDir = "",
  [string]$ApiBase = "http://127.0.0.1:8000"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $CacheDir) {
  $CacheDir = Join-Path $RepoRoot ".tmp\pit-bulk-cache"
}
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
  $Python = "python"
}

& $Python (Join-Path $PSScriptRoot "pit_external_sources.py") --cache-dir $CacheDir preflight --api-base $ApiBase
