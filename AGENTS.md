# AGENTS Guidelines for This Repository

This repository is a local-first strategy research and backtest workbench. Treat this file as the quick-start guide for coding agents, and prefer current code plus fixed scripts over stale prose when documentation disagrees.

## Project snapshot

- Main delivered flow: `workspace -> creation -> backtest -> run detail -> optimization`, plus a formal `#/snapshots` route for dataset and universe refresh status.
- Backend stack: FastAPI + Pydantic + SQLite under `src/grit_backtest_platform/`.
- Frontend stack: React 19 + TypeScript + Vite under `web/`.
- Primary local databases: `.grit_backtest_platform.sqlite3` and `.grit_backtest_platform_market_data.sqlite3`.
- Public backend imports stay stable through `src/grit_backtest_platform/__init__.py`, which maps `service`, `real_service`, `storage`, and related modules to `*_rebuilt.py` or `*_restored.py`.
- Formal frontend routes currently include `#/workspace`, `#/creation/new`, `#/creation/sessions/:id`, `#/strategies/:id`, `#/strategies/:id/backtest-runs/new`, `#/runs`, `#/runs/:id`, `#/optimization-jobs`, `#/optimization-jobs/new`, `#/optimization-jobs/:id`, and `#/snapshots`.

## Current status (2026-04-17)

- The repo is actively changing around Optimization Lab and workspace integration. Current local edits touch backend services, shared contracts, optimization pages, workspace adapters, tests, and docs.
- `CHANGELOG.md` shows the current unreleased focus: Optimization Lab objective sorting cleanup, constraint model cleanup, and result consistency fixes.
- The latest recorded frontend focused run in `harness/reports/smoke/latest-frontend-focused.txt` passed: `68` tests across `6` files.
- The latest recorded backend fixed slice in `harness/reports/smoke/latest-backend.txt` had `122` passing tests and `3` failures. The failures are all in optimization candidate create/delete and snapshot-stability flows.
- The latest recorded global TypeScript report in `harness/reports/smoke/latest-frontend-global-types.txt` is failing. Current issues include missing `updateOptimizationJobConstraints` on demo stores, stale test fixture types around `ApiStrategyDetail.parameter_history`, and one narrowing issue in `web/src/pages/optimization-lab-page.tsx`.
- `scripts/codex-reset-fixture.ps1` expects `harness/fixtures/seed_workspace/`, but that directory is missing in the current worktree. Any fixture-backed live acceptance or smoke flow that depends on reset should be treated as blocked until fixture assets are restored.

## Read this before editing

1. Read `TECHNICAL.md` first for repo workflow, validation commands, and completion rules.
2. Read `README.md` for startup commands, operator paths, and top-level navigation.
3. Read `ARCHITECTURE.md` when touching runtime boundaries, storage, recovery behavior, optimization execution, or snapshot data flows.
4. Read `DESIGN.md` before UI work.
5. Prefer current code and scripts over stale docs when they conflict.

## Source of truth by area

- API and shared contracts: `src/grit_backtest_platform/models.py`, `src/grit_backtest_platform/api.py`, `web/src/types.ts`
- Backend runtime and storage: `src/grit_backtest_platform/_service_rebuilt.py`, `src/grit_backtest_platform/_real_service_rebuilt.py`, `src/grit_backtest_platform/_storage_restored.py`, `src/grit_backtest_platform/_market_data_repository_restored.py`
- Frontend runtime boundaries: `web/src/app-runtime-cn.tsx`, `web/src/lib/appRouteContext.tsx`, `web/src/lib/demoStoreContext.tsx`
- Shared shell and route meta: `web/src/shell-frame-cn.tsx`, `web/src/shell-route-meta-cn.ts`, `web/src/app-shell-frame.css`
- Workspace projection truth: `web/src/lib/workspace-adapters.ts`
- Harness and fixed validation entry points: `harness/README.md`, `scripts/codex-*.ps1`

## Dev environment tips

- Use `powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1` for normal interactive startup.
- Default local URLs:
  - Backend: `http://127.0.0.1:8000`
  - Frontend: `http://127.0.0.1:4173/#/workspace`
- Prefer the repo-local `.python-runtime` and `.venv` over a system Python when possible.
- Node `18+` and Python `3.13+` are safe assumptions; `pyproject.toml` currently requires `>=3.12`.
- For frontend iteration, prefer the dev server or the QuickStart flow over production preview/build loops unless the task explicitly needs build verification.
- Do not rename restored or rebuilt module files just to normalize naming. The indirection is intentional and part of the recovery architecture.
- Project docs are the first-stop memory surface. Use this file for promoted agent behavior and `ARCHITECTURE.md` for promoted system facts, data flows, troubleshooting steps, regression test locations, and validation commands without using external memory lookup.

## Testing instructions

- Backend fixed slice:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1`
- Frontend fixed slice:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1`
- Frontend strict global types:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes`
- Full smoke orchestration:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\codex-smoke.ps1`
  - In the current worktree, treat fixture-backed paths as unreliable because `harness/fixtures/seed_workspace/` is missing.
- The frontend fixed script always emits a `tsc --noEmit` report to `harness/reports/smoke/latest-frontend-global-types.txt`, even when type failures are not blocking.
- If you change API payloads or response shapes, update both backend and frontend contract mirrors and rerun the relevant fixed slices.

## Promoted Memory Quick Checks

- If `http://127.0.0.1:4173` returns `Frontend build not ready yet.`, inspect the process listening on port `4173` before changing application code. The healthy QuickStart path launches `web/preview-server.mjs` with `--watch --rebuild-on-start`; `web/package.json` `preview:auto` is the known-good baseline. A listener command line like `node ./preview-server.mjs --watch --rebuild-on-start` is repo-local preview even when it lacks an absolute repo path.
- If a user reports a live page under `http://127.0.0.1:4173`, treat the active localhost listeners as the acceptance target. Before claiming delivery, confirm the `8000` backend and `4173` preview processes were started after the final code, rebuild `web/dist` when serving preview, and verify the reported route with real browser/API checks instead of relying only on fixed slices or mocked tests.
- Before restarting localhost for a user-reported data regression, verify the active `GRIT_BACKTEST_DB` and companion market-data DB are the intended runtime databases. If root `.grit_backtest_platform.sqlite3` is unexpectedly empty while a richer runtime copy exists under `.tmp/`, back up both root databases before restoring or repointing; do not let a restart against a fresh empty DB look like deleted workspace history.
- When verifying a rebuilt SPA on `4173`, force a document reload rather than only changing the hash route. Use a cache-busting URL such as `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`, because `#/...` navigation alone can keep the old JavaScript bundle alive in the browser.
- Snapshot stock and bond tabs must preserve the approved Compose First information architecture while rendering live runtime rows. Stock uses global view, workstation + diagnostics, and raw list + readiness two-column sections; bond must stay attached to the shared snapshots header density with no fixed large spacer, while keeping global health cards, three-column workstation, asset-leg creation rail, audit matrix, and raw registry/scheduler sections. Bond source rows and the asset-leg creation rail must stay linked to the selected runtime instrument. Do not “fix” a drift by swapping back to static approved rows, and do not replace the approved structure with raw runtime table labels.
- If `#/legs` “创建策略腿” reports no eligible versions while completed backtests exist, check whether the drawer is building one candidate from the latest completed run per strategy plus strategy metadata, rather than relying only on default `/leg-inventory` rows or slicing the list to three. The right validation summary should bind to the selected candidate metrics.
- Optimization Results regressions usually belong in `web/src/optimization.module.test.tsx`. Reuse that file for results-center row selection, constraint refiltering, candidate labels, shelf copy, and localization guards.
- If an optimization promotion or selection path reports `Optimization candidate not found: trial_*`, first check whether the UI used transient trial ids from a filtered subset instead of the persisted/full matching-combination candidate identity.

## Working rules for agents

- Preserve existing uncommitted user changes. The worktree is already dirty.
- If you change API payloads or response shapes, keep `src/grit_backtest_platform/models.py` and `web/src/types.ts` aligned.
- If you touch workspace or optimization summary data, also inspect `web/src/lib/workspace-adapters.ts` and the matching dashboard or optimization tests.
- If you touch UI routing or shared shell behavior, stay inside the established runtime boundaries instead of creating a second routing layer.
- For UI fixes against an approved HTML/SPEC, do not close on class-name or existence assertions alone. Record a small trace matrix from design requirement to selector/file, and verify spacing, scrolling, sticky positioning, charts, colors, and responsive states with either browser screenshots/DOM geometry evidence or CSS contract tests.
- Add or update tests for the code you change, especially around optimization jobs, candidate materialization, snapshots, and workspace projections.
- For non-trivial work, read promoted project memory first: this `AGENTS.md` for workflow rules and `ARCHITECTURE.md` for system facts, data flows, troubleshooting steps, regression tests, and validation commands.
- Update `TECHNICAL.md` when repo-specific workflow, validation commands, or truth sources change.
- Update `ARCHITECTURE.md` when storage layout, recovery mapping, snapshot data plane, or runtime ownership changes.
- Keep `CHANGELOG.md` in Keep a Changelog format with `## [Unreleased]` at the top.

## Change and PR instructions

- Before committing, run the relevant fixed slices and report both passes and known blocked checks.
- Do not claim smoke or live acceptance passed if fixture reset was unavailable.
- In summaries, call out whether the change touched contracts, runtime boundaries, storage, or docs.

## Useful paths

- Backend package: `src/grit_backtest_platform/`
- Frontend app: `web/src/`
- Backend tests: `tests/`
- Harness tasks and reports: `harness/`
- Acceptance note: `harness/acceptance/create-backtest-optimize.md`
