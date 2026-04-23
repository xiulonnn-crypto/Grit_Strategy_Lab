import { readFileSync } from "node:fs";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./app-runtime";
import { installMockApiServer } from "./testApiMock";

const optimizationLabPageCss = readFileSync(
  "./src/pages/optimization-lab-page.css",
  "utf8",
);

let mockServer: ReturnType<typeof installMockApiServer> | null = null;

async function renderApp(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash;
    render(<App />);
  });
}

beforeEach(() => {
  mockServer = installMockApiServer();
});

afterEach(() => {
  mockServer?.restore();
  mockServer = null;
  cleanup();
  window.location.hash = "";
});

describe("Optimization results candidate table layout", () => {
  it("keeps the candidate table within the results panel width", async () => {
    await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(document.querySelector(".optimization-results-grid")).not.toBeNull(),
    );

    await waitFor(() =>
      expect(
        document.querySelector(".optimization-results-grid .optimization-lab-table-shell"),
      ).not.toBeNull(),
    );
    expect(
      document.querySelector(".optimization-results-grid .optimization-lab-table"),
    ).not.toBeNull();
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-results-grid\s+\.optimization-lab-table-shell\s*\{[^}]*overflow-x:\s*hidden;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-results-grid\s+\.optimization-lab-table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-results-grid\s+\.optimization-lab-table\s+th,\s*\.optimization-results-grid\s+\.optimization-lab-table\s+td\s*\{[^}]*white-space:\s*normal;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-results-grid[\s\S]*\.optimization-lab-table__cell--wrap\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*none;/s,
    );
  });

  it("anchors the empty-filter toast at the top center with shared error styling", () => {
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-results-toast\s*\{[^}]*position:\s*fixed;[^}]*top:\s*24px;[^}]*left:\s*50%;[^}]*transform:\s*translateX\(-50%\);/s,
    );
    expect(optimizationLabPageCss).not.toMatch(
      /\.optimization-results-toast\s*\{[^}]*right:\s*24px;[^}]*bottom:\s*24px;/s,
    );
  });
});
