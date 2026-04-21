$ErrorActionPreference = 'Stop'
$repoRoot = 'C:\Fin\Grit_Strategy_Lab'
$logDir = Join-Path $repoRoot '.codex-logs'
$stdoutLog = Join-Path $logDir 'codex-live-backend.log'
$stderrLog = Join-Path $logDir 'codex-live-backend.err.log'

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location $repoRoot
. .\QuickStart-Grit.local.ps1
$env:PYTHONPATH = 'src'
Start-Process -FilePath '.\.venv\Scripts\python.exe' -ArgumentList @('-m','uvicorn','--app-dir','src','grit_backtest_platform.main:app','--host','127.0.0.1','--port','8000') -WorkingDirectory $repoRoot -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
