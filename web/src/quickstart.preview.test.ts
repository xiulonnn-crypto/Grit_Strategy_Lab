import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const quickStartSource = readFileSync("../QuickStart-Grit.ps1", "utf8");

describe("QuickStart frontend preview bootstrap", () => {
  it("passes rebuild-on-start to the static preview server", () => {
    expect(quickStartSource).toContain("$frontendPreviewScript");
    expect(quickStartSource).toMatch(
      /\$previewArgs\s*=\s*@\(\$frontendPreviewScript,\s*'--host',\s*'127\.0\.0\.1',\s*'--port',\s*'4173',\s*'--watch',\s*'--rebuild-on-start'\)/s,
    );
  });
});
