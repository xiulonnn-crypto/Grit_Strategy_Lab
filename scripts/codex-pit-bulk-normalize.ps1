param(
  [string]$CacheDir = "C:\tmp\grit-pit-bulk-cache",
  [string]$InputDir = "",
  [string]$Catalog = "",
  [switch]$NoParquet
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
  $Python = "python"
}

$ArgsList = @(
  (Join-Path $PSScriptRoot "pit_external_sources.py"),
  "--cache-dir", $CacheDir,
  "bulk-normalize"
)
if ($InputDir) {
  $ArgsList += @("--input-dir", $InputDir)
}
if ($Catalog) {
  $ArgsList += @("--catalog", $Catalog)
}
if (-not $NoParquet) {
  $ArgsList += "--write-parquet"
}

& $Python @ArgsList
