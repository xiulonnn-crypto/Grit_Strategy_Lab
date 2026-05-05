param(
  [string]$CacheDir = "C:\tmp\grit-pit-bulk-cache",
  [string]$ApiBase = "http://127.0.0.1:8000",
  [string]$PitJson = "",
  [string]$Catalog = "",
  [string]$Db = ".grit_backtest_platform_market_data.sqlite3",
  [string[]]$Symbols = @(),
  [int]$MaxSymbols = 0,
  [double]$ConflictThresholdPct = 25.0,
  [string]$MatrixCsv = "",
  [string]$MatrixSourceUrl = "https://github.com/fja05680/sp500",
  [string]$MatrixSourceRevisionId = "",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
  $Python = "python"
}

if ($MatrixCsv) {
  $MatrixArgs = @(
    (Join-Path $PSScriptRoot "pit_external_sources.py"),
    "--cache-dir", $CacheDir,
    "ingest-matrix",
    "--matrix-csv", $MatrixCsv,
    "--source-url", $MatrixSourceUrl
  )
  if ($MatrixSourceRevisionId) {
    $MatrixArgs += @("--source-revision-id", $MatrixSourceRevisionId)
  }
  if ($Apply) {
    $MatrixArgs += @("--apply", "--db", $Db)
  }
  & $Python @MatrixArgs
}

$RepairArgs = @(
  (Join-Path $PSScriptRoot "pit_external_sources.py"),
  "--cache-dir", $CacheDir,
  "diff-repair",
  "--max-symbols", $MaxSymbols,
  "--conflict-threshold-pct", $ConflictThresholdPct
)
if ($ApiBase) {
  $RepairArgs += @("--api-base", $ApiBase)
}
if ($PitJson) {
  $RepairArgs += @("--pit-json", $PitJson)
}
if ($Catalog) {
  $RepairArgs += @("--catalog", $Catalog)
}
if ($Symbols.Count -gt 0) {
  $RepairArgs += @("--symbols")
  $RepairArgs += $Symbols
}
if ($Apply) {
  $RepairArgs += @("--apply", "--db", $Db)
}

& $Python @RepairArgs
