# GitHub Pages Landing Trace Matrix

| Requirement | Implementation target | Desktop gate | Mobile gate | Interaction/evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Workbench UI and routes | `web/src/app-runtime-cn.tsx`, `web/index.html` | 1280px: existing workspace shell and route modules are built unchanged, `static-workspace-desktop.png` inspected | 390px: existing responsive layout rules are built unchanged, `static-workspace-mobile.png` inspected with no horizontal overflow | Static API mode supplies the same page contracts without a local FastAPI process | PASS (Pages-shaped browser acceptance) |
| Interactive demo persistence | `web/src/lib/staticDemoApi.ts` | N/A | N/A | Every demo API completion snapshots state to browser storage; a reload restores it | PASS (Vitest plus browser localStorage assertion) |
| Cloud demo persistence | `web/src/lib/staticDemoApi.ts`, `web/src/components/static-demo-cloud-sync.tsx` | Floating connection control and open dialog inspected in `static-cloud-sync-desktop.png` | Floating control stays within the mobile viewport | A private GitHub Gist is created or restored with a memory-only token; later interactions patch the same Gist | PASS (mocked GitHub API contract and browser storage check) |
| GitHub Pages deployment | `.github/workflows/deploy-pages.yml` | N/A | N/A | Workflow builds `web/` with static demo mode and deploys only `web/dist` | PASS (workflow source inspection) |

Approved deviation: GitHub Pages runs the existing workbench UI against a static interactive demo store. Production FastAPI/SQLite behavior is intentionally not exposed from the public static host.
