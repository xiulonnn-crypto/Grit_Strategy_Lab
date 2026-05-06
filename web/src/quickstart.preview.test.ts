import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const quickStartSource = readFileSync("../QuickStart-Grit.ps1", "utf8");

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
