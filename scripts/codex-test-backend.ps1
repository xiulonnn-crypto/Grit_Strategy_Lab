[CmdletBinding()]
param(
    [string[]]$PytestArgs = @(),
    [ValidateRange(0, 86400)]
    [int]$TimeoutSeconds = 1200,
    [string]$PythonExecutable
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$reportDir = Join-Path $repoRoot 'harness\reports\smoke'
$reportPath = Join-Path $reportDir 'latest-backend.txt'
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'

function Get-PythonExecutable {
    if (-not [string]::IsNullOrWhiteSpace($PythonExecutable)) {
        if (Test-Path -LiteralPath $PythonExecutable) {
            return (Resolve-Path -LiteralPath $PythonExecutable).Path
        }

        $overrideCommand = Get-Command $PythonExecutable -ErrorAction SilentlyContinue
        if ($null -ne $overrideCommand) {
            return $overrideCommand.Source
        }

        throw "Python executable override not found: $PythonExecutable"
    }

    if (Test-Path -LiteralPath $venvPython) {
        return $venvPython
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand) {
        return $pythonCommand.Source
    }

    throw 'Python executable not found. Initialize .venv or make python available in PATH.'
}

function Stop-ProcessTree {
    param(
        [int]$TargetProcessId
    )

    $taskkillExe = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    if (Test-Path -LiteralPath $taskkillExe) {
        $taskkillExitCode = -1
        try {
            $previousErrorActionPreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            & $taskkillExe /PID $TargetProcessId /T /F 1>$null 2>$null
            $taskkillExitCode = $LASTEXITCODE
        } catch {
            $taskkillExitCode = -1
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        $parentStillRunning = $null -ne (Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
        if ($taskkillExitCode -eq 0 -and -not $parentStillRunning) {
            return [pscustomobject]@{
                Succeeded = $true
                Method = 'taskkill-tree'
            }
        }
    }

    $childrenConfirmed = $true
    try {
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$TargetProcessId" -ErrorAction Stop
        foreach ($child in $children) {
            $childResult = Stop-ProcessTree -TargetProcessId ([int]$child.ProcessId)
            if (-not $childResult.Succeeded) {
                $childrenConfirmed = $false
            }
        }
    } catch {
        $childrenConfirmed = $false
    }

    try {
        Stop-Process -Id $TargetProcessId -Force -ErrorAction SilentlyContinue
    } catch {
        $childrenConfirmed = $false
    }

    $parentStillRunning = $null -ne (Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
    return [pscustomobject]@{
        Succeeded = $childrenConfirmed -and -not $parentStillRunning
        Method = if ($childrenConfirmed) { 'cim-recursive' } else { 'parent-only-unconfirmed' }
    }
}

function Join-ProcessArguments {
    param(
        [string[]]$Arguments
    )

    $quotedArguments = $Arguments | ForEach-Object {
        $argument = [string]$_
        if ($argument -match '[\s"]') {
            '"' + ($argument -replace '"', '\"') + '"'
        } else {
            $argument
        }
    }
    return [string]::Join(' ', $quotedArguments)
}

function Write-LoggedLine {
    param(
        [System.IO.StreamWriter]$Writer,
        [AllowEmptyString()]
        [string]$Line,
        [switch]$StandardError
    )

    $renderedLine = if ($StandardError) { "[stderr] $Line" } else { $Line }
    $Writer.WriteLine($renderedLine)
    if ($StandardError) {
        Write-Host $renderedLine -ForegroundColor DarkRed
    } else {
        Write-Host $renderedLine
    }
}

function Set-ReportStatus {
    param(
        [System.IO.StreamWriter]$Writer,
        [long]$StatusOffset,
        [string]$Status
    )

    $statusValue = $Status.ToUpperInvariant().PadRight(9)
    if ($statusValue.Length -ne 9) {
        throw "Unsupported backend report status: $Status"
    }

    $Writer.Flush()
    $endPosition = $Writer.BaseStream.Position
    [void]$Writer.BaseStream.Seek($StatusOffset, [System.IO.SeekOrigin]::Begin)
    $statusBytes = [System.Text.Encoding]::UTF8.GetBytes("status = $statusValue")
    $Writer.BaseStream.Write($statusBytes, 0, $statusBytes.Length)
    $Writer.BaseStream.Flush()
    [void]$Writer.BaseStream.Seek($endPosition, [System.IO.SeekOrigin]::Begin)
}

$jobSetupWarning = $null
if ($null -eq ('CodexBackendKillOnCloseJob' -as [type])) {
    try {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

public sealed class CodexBackendKillOnCloseJob : IDisposable
{
    private const uint JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private IntPtr handle;

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        uint informationClass,
        IntPtr information,
        uint informationLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public CodexBackendKillOnCloseJob()
    {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed.");
        }

        var information = new ExtendedLimitInformation();
        information.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        int length = Marshal.SizeOf(typeof(ExtendedLimitInformation));
        IntPtr pointer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(information, pointer, false);
            if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, pointer, (uint)length))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject failed.");
            }
        }
        catch
        {
            CloseHandle(handle);
            handle = IntPtr.Zero;
            throw;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    public void Assign(Process process)
    {
        if (handle == IntPtr.Zero)
        {
            throw new ObjectDisposedException("CodexBackendKillOnCloseJob");
        }
        if (!AssignProcessToJobObject(handle, process.Handle))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed.");
        }
    }

    public void Dispose()
    {
        if (handle != IntPtr.Zero)
        {
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }
        GC.SuppressFinalize(this);
    }
}
'@
    } catch {
        $jobSetupWarning = "Job Object type initialization failed: $($_.Exception.Message)"
    }
}
$jobTypeAvailable = $null -ne ('CodexBackendKillOnCloseJob' -as [type])
if (-not $jobTypeAvailable -and [string]::IsNullOrWhiteSpace($jobSetupWarning)) {
    $jobSetupWarning = 'Job Object type is unavailable.'
}

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null

$pythonExe = Get-PythonExecutable
$defaultTests = @(
    'tests\test_backend_api.py'
    'tests\test_composition_api.py'
    'tests\test_creation_session_refresh.py'
    'tests\test_real_backtest_api.py'
    'tests\test_factor_research_api.py'
    'tests\test_factor_expression_engine.py'
    'tests\test_factor_factory_api.py'
    'tests\test_factor_mining_api.py'
    'tests\test_factor_quarantine_api.py'
    'tests\test_multi_factor_strategy_api.py'
    'tests\test_optimization_execution_resume.py'
    'tests\test_optimization_resume_api.py'
    'tests\test_runtime_supervisor.py'
    'tests\test_strategies_smoke.py'
)

Set-Location -LiteralPath $repoRoot

if ($PytestArgs | Where-Object { $_ -eq '--basetemp' -or $_ -like '--basetemp=*' }) {
    throw 'scripts/codex-test-backend.ps1 owns pytest --basetemp. Use the default .tmp\pytest location instead of passing a root-level temp path.'
}

$pytestTempRoot = Join-Path $repoRoot '.tmp\pytest-runtime'
$pythonTemp = Join-Path $pytestTempRoot 'python-temp'
$baseTemp = Join-Path $pytestTempRoot ("codex-backend-{0}" -f (Get-Date -Format 'yyyyMMddHHmmssfff'))
New-Item -ItemType Directory -Path $pythonTemp -Force | Out-Null
New-Item -ItemType Directory -Path $baseTemp -Force | Out-Null

$pytestArgsWithTemp = @('--basetemp', $baseTemp) + $PytestArgs
$processArguments = @('-m', 'pytest') + $defaultTests + $pytestArgsWithTemp
$startedAt = Get-Date
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$reportWriter = [System.IO.StreamWriter]::new(
    $reportPath,
    $false,
    [System.Text.UTF8Encoding]::new($false)
)
$reportWriter.AutoFlush = $true
$reportWriter.WriteLine('# Codex Backend')
$reportWriter.WriteLine('report_schema = codex-backend-v2')
$reportWriter.WriteLine("run_id = $([Guid]::NewGuid().ToString('N'))")
$reportWriter.Flush()
$reportStatusOffset = $reportWriter.BaseStream.Position
$reportWriter.WriteLine("status = $('RUNNING'.PadRight(9))")
$reportWriter.WriteLine("started_at = $($startedAt.ToString('o'))")
$reportWriter.WriteLine("timeout_seconds = $TimeoutSeconds")
$reportWriter.WriteLine("command = $pythonExe $(Join-ProcessArguments -Arguments $processArguments)")
$reportWriter.WriteLine('')
$reportWriter.WriteLine('# Pytest Output')
if (-not [string]::IsNullOrWhiteSpace($jobSetupWarning)) {
    $singleLineJobWarning = $jobSetupWarning -replace '[\r\n]+', ' | '
    $reportWriter.WriteLine("[runner-warning] $singleLineJobWarning Process-tree fallback will be used.")
}

$process = $null
$processStarted = $false
$killOnCloseJob = $null
$jobAssigned = $false
$exitCode = 1
$finalStatus = 'FAILED'
$failureMessage = $null
$timedOut = $false
$cleanupStatus = 'NOT_REQUIRED'
$cleanupMethod = '<none>'

try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $pythonExe
    $startInfo.Arguments = Join-ProcessArguments -Arguments $processArguments
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables['TEMP'] = $pythonTemp
    $startInfo.EnvironmentVariables['TMP'] = $pythonTemp
    $startInfo.EnvironmentVariables['TMPDIR'] = $pythonTemp
    $startInfo.EnvironmentVariables['PYTHONUNBUFFERED'] = '1'
    $startInfo.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'
    $startInfo.EnvironmentVariables['PYTHONUTF8'] = '1'

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $processStarted = $true
    if ($jobTypeAvailable) {
        try {
            $killOnCloseJob = New-Object CodexBackendKillOnCloseJob
            $killOnCloseJob.Assign($process)
            $jobAssigned = $true
        } catch {
            if ($null -ne $killOnCloseJob) {
                $killOnCloseJob.Dispose()
                $killOnCloseJob = $null
            }
            $jobAssignmentWarning = $_.Exception.Message -replace '[\r\n]+', ' | '
            $reportWriter.WriteLine("[runner-warning] Job Object assignment failed: $jobAssignmentWarning Process-tree fallback will be used.")
        }
    }

    $stdoutClosed = $false
    $stderrClosed = $false
    $stdoutTask = $process.StandardOutput.ReadLineAsync()
    $stderrTask = $process.StandardError.ReadLineAsync()
    $streamDrainDeadline = $null
    $maxDrainItemsPerCycle = 128

    while ($true) {
        $madeProgress = $false
        $drainItemCount = 0

        do {
            $drainedLine = $false
            if (-not $stdoutClosed -and $stdoutTask.IsCompleted) {
                $stdoutLine = ($stdoutTask.GetAwaiter()).GetResult()
                if ($null -eq $stdoutLine) {
                    $stdoutClosed = $true
                } else {
                    Write-LoggedLine -Writer $reportWriter -Line $stdoutLine
                    $stdoutTask = $process.StandardOutput.ReadLineAsync()
                }
                $drainedLine = $true
                $madeProgress = $true
                $drainItemCount += 1
            }

            if (-not $stderrClosed -and $stderrTask.IsCompleted) {
                $stderrLine = ($stderrTask.GetAwaiter()).GetResult()
                if ($null -eq $stderrLine) {
                    $stderrClosed = $true
                } else {
                    Write-LoggedLine -Writer $reportWriter -Line $stderrLine -StandardError
                    $stderrTask = $process.StandardError.ReadLineAsync()
                }
                $drainedLine = $true
                $madeProgress = $true
                $drainItemCount += 1
            }
        } while ($drainedLine -and $drainItemCount -lt $maxDrainItemsPerCycle)

        if (-not $process.HasExited) {
            if ($TimeoutSeconds -gt 0 -and $stopwatch.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
                $timedOut = $true
                if ($jobAssigned) {
                    $killOnCloseJob.Dispose()
                    $killOnCloseJob = $null
                    $jobAssigned = $false
                    $cleanupStatus = 'CONFIRMED'
                    $cleanupMethod = 'job-object-kill-on-close'
                } else {
                    $cleanupResult = Stop-ProcessTree -TargetProcessId $process.Id
                    $cleanupStatus = if ($cleanupResult.Succeeded) { 'CONFIRMED' } else { 'FAILED' }
                    $cleanupMethod = $cleanupResult.Method
                }
                if (-not $process.WaitForExit(5000)) {
                    $cleanupStatus = 'FAILED'
                    $cleanupMethod = "$cleanupMethod+wait-timeout"
                    break
                }
            } elseif (-not $madeProgress) {
                [void]$process.WaitForExit(25)
            }
        }

        if ($process.HasExited -and $null -eq $streamDrainDeadline) {
            $streamDrainDeadline = (Get-Date).AddSeconds(5)
        }

        if ($process.HasExited -and $stdoutClosed -and $stderrClosed) {
            break
        }
        if ($null -ne $streamDrainDeadline -and (Get-Date) -ge $streamDrainDeadline) {
            break
        }
        if (-not $madeProgress -and $process.HasExited -and (-not $stdoutClosed -or -not $stderrClosed)) {
            Start-Sleep -Milliseconds 10
        }
    }

    if ($timedOut) {
        $exitCode = -1
        $finalStatus = 'TIMED_OUT'
        $failureMessage = if ($cleanupStatus -eq 'CONFIRMED') {
            "Command exceeded $TimeoutSeconds seconds; process-tree cleanup was confirmed via $cleanupMethod."
        } else {
            "Command exceeded $TimeoutSeconds seconds; process-tree cleanup could not be confirmed ($cleanupMethod)."
        }
    } else {
        $process.WaitForExit()
        $exitCode = $process.ExitCode
        $finalStatus = if ($exitCode -eq 0) { 'PASSED' } else { 'FAILED' }
    }
} catch [System.Management.Automation.PipelineStoppedException] {
    $finalStatus = 'CANCELLED'
    $failureMessage = $_.Exception.Message
} catch {
    $finalStatus = 'FAILED'
    $failureMessage = $_.Exception.Message
} finally {
    if ($processStarted -and -not $process.HasExited) {
        if ($jobAssigned) {
            $killOnCloseJob.Dispose()
            $killOnCloseJob = $null
            $jobAssigned = $false
            $cleanupStatus = 'CONFIRMED'
            $cleanupMethod = 'job-object-kill-on-close'
        } else {
            $cleanupResult = Stop-ProcessTree -TargetProcessId $process.Id
            $cleanupStatus = if ($cleanupResult.Succeeded) { 'CONFIRMED' } else { 'FAILED' }
            $cleanupMethod = $cleanupResult.Method
        }
        if (-not $process.WaitForExit(5000)) {
            $cleanupStatus = 'FAILED'
            $cleanupMethod = "$cleanupMethod+wait-timeout"
        }
    }
    if ($null -ne $killOnCloseJob) {
        $killOnCloseJob.Dispose()
        $killOnCloseJob = $null
        $jobAssigned = $false
    }

    $finishedAt = Get-Date
    $stopwatch.Stop()
    $reportWriter.WriteLine('')
    $reportWriter.WriteLine('# Result')
    $reportWriter.WriteLine("finished_at = $($finishedAt.ToString('o'))")
    $reportWriter.WriteLine("elapsed_seconds = $([Math]::Round($stopwatch.Elapsed.TotalSeconds, 3))")
    $reportWriter.WriteLine("exit_code = $exitCode")
    $reportWriter.WriteLine("cleanup_status = $cleanupStatus")
    $reportWriter.WriteLine("cleanup_method = $cleanupMethod")
    if (-not [string]::IsNullOrWhiteSpace($failureMessage)) {
        $singleLineFailure = $failureMessage -replace '[\r\n]+', ' | '
        $reportWriter.WriteLine("failure = $singleLineFailure")
    }
    Set-ReportStatus -Writer $reportWriter -StatusOffset $reportStatusOffset -Status $finalStatus
    $reportWriter.Dispose()
    if ($null -ne $process) {
        $process.Dispose()
    }
}

if ($timedOut) {
    throw "Backend codex test timed out after $TimeoutSeconds seconds. See $reportPath"
}
if (-not [string]::IsNullOrWhiteSpace($failureMessage)) {
    throw "Backend codex test did not complete successfully: $failureMessage See $reportPath"
}
if ($exitCode -ne 0) {
    throw "Backend codex test failed. See $reportPath"
}
