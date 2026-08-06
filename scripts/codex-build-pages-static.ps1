[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\.tmp\github-pages-static'),
    [string]$WorkspaceApiUrl = 'http://127.0.0.1:8000',
    [switch]$KeepExistingOutput
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputFullPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$tmpRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.tmp'))

if (-not $outputFullPath.StartsWith($tmpRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDirectory must be inside $tmpRoot."
}

if ((Test-Path -LiteralPath $outputFullPath) -and -not $KeepExistingOutput) {
    Remove-Item -LiteralPath $outputFullPath -Recurse -Force
}

New-Item -ItemType Directory -Path $outputFullPath -Force | Out-Null

$previousStaticDemo = $env:VITE_STATIC_DEMO
try {
    $env:VITE_STATIC_DEMO = 'true'
    & npm.cmd --prefix (Join-Path $repoRoot 'web') run build -- --base /Grit_Strategy_Lab/
    if ($LASTEXITCODE -ne 0) {
        throw "Vite build failed with exit code $LASTEXITCODE."
    }
}
finally {
    if ($null -eq $previousStaticDemo) {
        Remove-Item Env:VITE_STATIC_DEMO -ErrorAction SilentlyContinue
    }
    else {
        $env:VITE_STATIC_DEMO = $previousStaticDemo
    }
}

$distRoot = Join-Path $repoRoot 'web\dist'
Get-ChildItem -LiteralPath $distRoot -Force | Copy-Item -Destination $outputFullPath -Recurse -Force
Set-Content -LiteralPath (Join-Path $outputFullPath '.nojekyll') -Value '' -NoNewline -Encoding ascii

$apiRoot = $WorkspaceApiUrl.TrimEnd('/')
function Read-Utf8Json {
    param([Parameter(Mandatory = $true)][string]$Uri)

    $client = New-Object System.Net.WebClient
    try {
        $body = [System.Text.Encoding]::UTF8.GetString($client.DownloadData($Uri))
        $parsed = $body | ConvertFrom-Json
        if ($parsed -is [System.Array]) {
            foreach ($item in $parsed) {
                Write-Output $item
            }
            return
        }
        return $parsed
    }
    catch {
        throw "GET $Uri failed: $($_.Exception.Message)"
    }
    finally {
        $client.Dispose()
    }
}

try {
    $strategyLibrary = Read-Utf8Json -Uri "$apiRoot/strategy-library"
    $optimizationJobs = @(Read-Utf8Json -Uri "$apiRoot/optimization-jobs")
    $workspaceSeed = [ordered]@{
        overview = Read-Utf8Json -Uri "$apiRoot/workspace/overview"
        strategy_library = $strategyLibrary
        optimization_jobs = $optimizationJobs
    }
}
catch {
    throw "Unable to capture the local workspace API snapshot: $($_.Exception.Message)"
}

$seedPath = Join-Path $outputFullPath 'workspace-seed.json'
[System.IO.File]::WriteAllText($seedPath, ($workspaceSeed | ConvertTo-Json -Depth 50), (New-Object System.Text.UTF8Encoding($false)))

Write-Output "Static Pages branch artifact ready: $outputFullPath"
