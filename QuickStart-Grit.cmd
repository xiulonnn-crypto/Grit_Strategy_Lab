@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "QUICKSTART_PS1=%SCRIPT_DIR%QuickStart-Grit.ps1"
set "GRIT_NO_PAUSE=%GRIT_QUICKSTART_NO_PAUSE%"

title Grit Strategy Lab QuickStart

if not exist "%POWERSHELL_EXE%" (
    echo PowerShell executable not found: "%POWERSHELL_EXE%"
    if /I not "%GRIT_NO_PAUSE%"=="1" pause
    exit /b 1
)

if not exist "%QUICKSTART_PS1%" (
    echo QuickStart script not found: "%QUICKSTART_PS1%"
    if /I not "%GRIT_NO_PAUSE%"=="1" pause
    exit /b 1
)

pushd "%SCRIPT_DIR%" >nul 2>&1

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%QUICKSTART_PS1%" %*
set "EXIT_CODE=%ERRORLEVEL%"

popd >nul 2>&1

if not "%EXIT_CODE%"=="0" (
    echo.
    echo QuickStart failed with exit code %EXIT_CODE%.
    echo Review the message above, then press any key to close this launcher.
    if /I not "%GRIT_NO_PAUSE%"=="1" pause >nul
)

exit /b %EXIT_CODE%
