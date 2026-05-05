param(
  [string]$DatasetId = "borismarjanovic/price-volume-data-for-all-us-stocks-etfs",
  [string]$CacheDir = "C:\tmp\grit-pit-bulk-cache",
  [string]$License = "verify_before_import",
  [string]$Kaggle = "kaggle",
  [switch]$NoUnzip
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
  $Python = "python"
}
$VenvKaggle = Join-Path $RepoRoot ".venv\Scripts\kaggle.exe"
if ($Kaggle -eq "kaggle" -and (Test-Path -LiteralPath $VenvKaggle)) {
  $Kaggle = $VenvKaggle
}

$ArgsList = @(
  (Join-Path $PSScriptRoot "pit_external_sources.py"),
  "--cache-dir", $CacheDir,
  "kaggle-download",
  "--dataset-id", $DatasetId,
  "--license", $License,
  "--kaggle", $Kaggle
)
if (-not $NoUnzip) {
  $ArgsList += "--unzip"
}

& $Python @ArgsList
