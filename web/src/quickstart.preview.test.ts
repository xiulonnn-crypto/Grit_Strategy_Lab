import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const quickStartSource = readFileSync("../QuickStart-Grit.ps1", "utf8");
const quickStartLocalExampleSource = readFileSync("../QuickStart-Grit.local.example.ps1", "utf8");
const previewServerSource = readFileSync("preview-server.mjs", "utf8");

describe("QuickStart frontend preview bootstrap", () => {
  it("builds once before starting the static preview server", () => {
    expect(quickStartSource).toContain("$frontendPreviewScript");
    expect(quickStartSource).toContain("npm run build");
  });

  it("does not ask the preview server to repeat the startup build", () => {
    expect(quickStartSource).toMatch(
      /\$previewArgs\s*=\s*@\(\$frontendPreviewScript,\s*'--host',\s*'127\.0\.0\.1',\s*'--port',\s*'4173',\s*'--watch'\)/s,
    );
  });

  it("treats the repo preview:auto command line as a restartable frontend listener", () => {
    expect(quickStartSource).toContain("function Test-RepoFrontendPreviewProcess");
    expect(quickStartSource).toContain("$hasRelativePreviewScript");
    expect(quickStartSource).toContain(".\\preview-server.mjs");
    expect(quickStartSource).toContain("--rebuild-on-start");
    expect(quickStartSource).toMatch(
      /\$belongsToRepo\s*=\s*Test-RepoFrontendPreviewProcess\s+-ProcessPath\s+\$processPath\s+-CommandLine\s+\$commandLine\s+-Port\s+\$Port/s,
    );
  });

  it("checks the runtime supervisor before starting local services", () => {
    expect(quickStartSource).toContain("$runtimeSupervisorScript");
    expect(quickStartSource).toContain("function Invoke-QuickStartSupervisorGuard");
    expect(quickStartSource).toContain("'guard', 'quickstart'");
    expect(quickStartSource).toContain("'--owner-pid', [string]$PID");
  });

  it("supports protected forced restarts for configuration updates", () => {
    expect(quickStartSource).toContain("[switch]$ForceRestart");
    expect(quickStartSource).toContain("[string]$RestartReason");
    expect(quickStartSource).toContain("$guardArgs += '--force'");
    expect(quickStartSource).toContain("ForceRestart requested: replacing the healthy repo-owned backend");
    expect(quickStartSource).toContain("ForceRestart requested: replacing the healthy repo-owned frontend preview");
  });

  it("reuses healthy backend and preview listeners instead of restarting them", () => {
    expect(quickStartSource).toContain("$skipBackendStart");
    expect(quickStartSource).toContain("Backend already healthy on port 8000; reusing the existing listener.");
    expect(quickStartSource).toContain("$skipFrontendStart");
    expect(quickStartSource).toContain("Frontend preview already healthy on port 4173; reusing the existing listener.");
  });

  it("can recognize a healthy repo preview even when Windows hides the command line", () => {
    expect(quickStartSource).toContain("function Test-RepoFrontendPreviewHttpFingerprint");
    expect(quickStartSource).toContain("Grit Backtest Platform");
    expect(quickStartSource).toContain("Test-RepoFrontendPreviewHttpFingerprint -Url $frontendHealthUrl");
  });
});

describe("Static preview server rebuild safety", () => {
  it("does not return the SPA HTML fallback for missing hashed asset requests", () => {
    expect(previewServerSource).toContain("function isAssetRequest");
    expect(previewServerSource).toMatch(/if \(isAssetRequest\(pathname\)\) \{[\s\S]*statusCode: 404/);
  });

  it("keeps the previous successful bundle available for in-flight asset requests", () => {
    expect(previewServerSource).toContain("const retainedBuildsDir");
    expect(previewServerSource).toContain("let activeDistDir = distDir");
    expect(previewServerSource).toContain("function activeFallbackRoots");
    expect(previewServerSource).not.toMatch(/renameSync\(distDir,/);
  });

  it("promotes watch rebuilds by switching to a retained build directory instead of emptying dist", () => {
    expect(previewServerSource).toContain("const promotedDistDir = path.join(retainedBuildsDir");
    expect(previewServerSource).toContain("renameSync(stagingDistDir, promotedDistDir)");
    expect(previewServerSource).toContain("activeDistDir = promotedDistDir");
    expect(previewServerSource).toContain("cleanupRetainedBuilds()");
  });
});

describe("QuickStart backend readiness bootstrap", () => {
  it("uses a slow-start tolerant backend timeout by default", () => {
    expect(quickStartSource).toMatch(/\[int\]\$BackendStartupTimeoutSeconds\s*=\s*(?:[6-9]\d|\d{3,})/);
  });

  it("rechecks HTTP readiness after the startup probe before failing", () => {
    const backendStartupBlock = quickStartSource.slice(
      quickStartSource.indexOf("Start-BackendWindow -PythonExe"),
      quickStartSource.indexOf("if (-not (Test-Path -LiteralPath $frontendDir))"),
    );

    expect(backendStartupBlock).toContain("Invoke-BackendProbe");
    expect(backendStartupBlock).toContain("Test-HttpReady -Url $backendHealthUrl");
    expect(backendStartupBlock).toContain("Backend became ready after the startup probe");
  });
});

describe("QuickStart local provider environment", () => {
  it("documents the external PIT source keys that QuickStart can load locally", () => {
    expect(quickStartSource).toContain("QuickStart-Grit.local.ps1");
    expect(quickStartLocalExampleSource).toContain("$env:KAGGLE_API_TOKEN");
    expect(quickStartLocalExampleSource).toContain("$env:NASDAQ_DATA_LINK_API_KEY");
    expect(quickStartLocalExampleSource).toContain("$env:FINNHUB_API_KEY");
    expect(quickStartLocalExampleSource).toContain("$env:CRSP_DATA_PATH");
    expect(quickStartLocalExampleSource).toContain("$env:NORGATE_DATA_PATH");
  });
});
