# GitHub Pages Landing Trace Matrix

| Requirement | Implementation target | Desktop gate | Mobile gate | Interaction/evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Workbench UI and routes | `web/src/app-runtime-cn.tsx`, `web/index.html` | 1280px: `pages-branch-static-desktop.png` visually inspected | 390px: `pages-branch-static-mobile.png` visually inspected with no horizontal overflow | Static API mode supplies the same page contracts without a local FastAPI process | PASS |
| Interactive demo persistence | `web/src/lib/staticDemoApi.ts` | N/A | N/A | Every demo API completion snapshots state to browser storage; a reload restores it | PASS (Vitest plus browser localStorage assertion) |
| Optional cloud demo persistence | `web/src/lib/staticDemoApi.ts`, `web/src/components/static-demo-cloud-sync.tsx` | The cloud-sync dialog is available only through `?demo-sync=1`, keeping the default workspace visually identical to localhost | The optional control stays within the mobile viewport | A private GitHub Gist is created or restored with a memory-only token; later interactions patch the same Gist | PASS (mocked GitHub API contract and browser storage check) |
| Branch deployment artifact | `gh-pages` branch root `index.html` | Bundle is served from branch root without a GitHub Actions deployment | Same built responsive CSS is served | `scripts/codex-build-pages-static.ps1` creates `index.html`, `.nojekyll`, `assets/`, and `workspace-seed.json` | PASS (local branch-shaped server) |
| Workspace parity | local `#/workspace` and branch-shaped static `#/workspace` | Shell, module ordering, visible copy, and controls match at 1280px | No horizontal overflow at 390px | `workspace-parity.json`: body text, headings, navigation, root structure equal; strategy and recent-run click-through pass | PASS |
| Direct Pages URL | GitHub repository Pages settings | Public Pages URL opens the built workspace | N/A | GitHub Pages source is `gh-pages` at repository root; public Playwright check passed (workspace text equals local static artifact, no console/request errors, no overflow, and strategy-card navigation works) | PASS |

Approved deviation: GitHub Pages runs the existing workbench UI against a static interactive demo store. Production FastAPI/SQLite behavior is intentionally not exposed from the public static host.
