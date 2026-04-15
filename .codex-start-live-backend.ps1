$ErrorActionPreference = 'Stop'
Set-Location 'C:\Fin\Grit_Strategy_Lab'
. .\QuickStart-Grit.local.ps1
$env:PYTHONPATH = 'src'
Start-Process -FilePath '.\.venv\Scripts\python.exe' -ArgumentList @('-m','uvicorn','--app-dir','src','grit_backtest_platform.main:app','--host','127.0.0.1','--port','8000') -WorkingDirectory 'C:\Fin\Grit_Strategy_Lab' -RedirectStandardOutput 'C:\Fin\Grit_Strategy_Lab\.codex-live-backend.log' -RedirectStandardError 'C:\Fin\Grit_Strategy_Lab\.codex-live-backend.err.log'
