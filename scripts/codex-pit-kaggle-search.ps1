param(
  [string]$CacheDir = "",
  [string[]]$Terms = @(
    "survivorship bias free",
    "delisted",
    "US stock market historical data delisted",
    "EOD historical data stocks"
  ),
  [string]$Kaggle = "kaggle"
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
$VenvKaggle = Join-Path $RepoRoot ".venv\Scripts\kaggle.exe"
if ($Kaggle -eq "kaggle" -and (Test-Path -LiteralPath $VenvKaggle)) {
  $Kaggle = $VenvKaggle
}

& $Python (Join-Path $PSScriptRoot "pit_external_sources.py") --cache-dir $CacheDir kaggle-search --kaggle $Kaggle --terms $Terms
