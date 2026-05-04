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
- If `#/snapshots` stock and bond tabs share the top health module, verify both tabs with a cache-busting live reload and confirm the module title/subtitle keep the same screen coordinates across tab switches. Bond workstation source cards should show only the first three runtime bonds sorted by duration with a remaining progress bar, and the raw snapshot/scheduler section must not leak English implementation strings such as `Runtime fixed-income snapshot row`.
- On `#/snapshots` stock/equity checks, keep the health-card semantics separated: `权益篮子` availability counts S&P/Nasdaq universe constituent lists when `member_count > 0`, `指数与基准` readiness comes from SPY/QQQ benchmark ETF price-history coverage in `ds-price.metadata.benchmark_etf_coverage`, and `最新刷新` should show this-run additions from `latest_job.summary.refresh_stats` rather than cumulative row/member totals.
- If OpenBB is enabled for snapshots, remember it is an optional enhancement only. It must be gated by `GRIT_ENABLE_OPENBB_PROVIDER=1`, use environment keys without persisting secrets, and keep `/data-snapshots/overview` unchanged. OpenBB current index constituents are auxiliary metadata only and must never make PIT universe snapshots `READY`.
- If `#/compositions` or `#/legs` shows approved-looking analytics, verify the content source before accepting it. The dashboard observation section must be derived from `GET /compositions`, the strategy-leg drawer must use latest completed run metrics through `web/src/lib/saved-strategy-leg-inventory.ts`, and the asset-leg drawer must not expose `Bond-*` or `Equity-*` static preset IDs unless a matching runtime source contract exists.
- If `#/compositions/:id` metrics or charts do not change after editing cash weight or rebalance frequency, inspect `return_quality_summary`, `returns_preview`, and `/compositions/preview` first. Composition detail metrics should use the latest 120 monthly labels and include cash/asset legs through profile-based fallback returns when aligned price streams are missing, with `fallback_used` exposing the quality gap.
- If `#/legs` “创建策略腿” reports no eligible versions while completed backtests exist, check whether the drawer is building one candidate from the latest completed run per strategy plus strategy metadata, rather than relying only on default `/leg-inventory` rows or slicing the list to three. The right validation summary should bind to the selected candidate metrics.
- If `#/legs` “创建资产腿” reports `Bond asset legs must use an eligible bond fixed-income snapshot, not a fallback source`, first check whether the asset drawer is using live `GET /data-snapshots/overview.bond_fixed_income.eligible_instruments` rows and whether the source search is empty by default so all READY runtime bonds, including T-Bill, remain selectable.
- Optimization Results regressions usually belong in `web/src/optimization.module.test.tsx`. Reuse that file for results-center row selection, constraint refiltering, candidate labels, shelf copy, and localization guards.
- For `#/optimization-jobs/:id`, keep the compact “参数候选盘” and “快速切换候选版本” surfaces to the top 3 ranked matching combinations plus the “当前组合” baseline; the “查看全部组合” modal is the place for the full `matching_combinations` set. If `request.source_run_id` no longer resolves, fall back to the strategy latest completed run/latest run so the baseline row still renders.
- If an optimization promotion or selection path reports `Optimization candidate not found: trial_*`, first check whether the UI used transient trial ids from a filtered subset instead of the persisted/full matching-combination candidate identity.
- If `#/optimization-jobs/:id` promotion reports `stale_base_parameter_version` while the page has already loaded a newer `strategy.current_parameter_version_id`, check whether the frontend promotion request omitted `base_parameter_version_id`. The Optimization Results page should submit the currently loaded strategy version as the explicit promotion base, not silently fall back to the job's older `base_parameter_version_id`.
- For `#/workspace` copy changes, treat visible page sections and route metadata as separate text owners. Check `web/src/pages/workspace-page-lane-b.tsx`, `web/src/page-sections/workspace-lane-b.tsx`, `web/src/page-sections/workspace-recent-runs-lane-b.tsx`, `web/src/shell-route-meta-cn.ts`, and the legacy shell metadata before claiming the copy changed; run an `rg` old-copy sweep plus a live DOM text scan after rebuild.

## Route performance rules

- Treat sub-1s first paint on a cache-busting `http://127.0.0.1:4173/?v=<timestamp>#/...` document reload as the default acceptance target for every new page and old page rewrite. If a route misses the target, inspect backend/API payload and fan-out first before changing visual code.
- Do not inline large candidate grids, trial ledgers, order ledgers, trace arrays, or raw diagnostics into list, summary, or route-initial JSON. Persist the full set behind checkpoint/detail storage and expose only bounded previews or aggregate counts for first paint.
- For Optimization Lab detail pages, first paint must keep using `matching_limit` and preserve `matching_combination_count` plus source metadata; the full `matching_combinations` set belongs behind explicit actions such as viewing all combinations, export, or drilldown.
- PIT, snapshot, strategy, backtest, and composition overview APIs are hot-path read models. Use service-level short caches or signed projection reuse when the data is read-heavy, and invalidate those caches from the write paths that change the visible governance state.
- `#/legs` and other inventory pages must consume aggregate counts from their list contracts, such as `strategy_reference_counts`, latest-run summaries, and readiness summaries. Do not fan out to composition or run detail endpoints just to render badges, counts, or first-screen KPI labels.
- If a page needs the full ledger, full candidate set, or full source trace, make that an explicit drilldown/export/modal state and test both the preview path and the full-load path.

## Working rules for agents

- Preserve existing uncommitted user changes. The worktree is already dirty.
- If you change API payloads or response shapes, keep `src/grit_backtest_platform/models.py` and `web/src/types.ts` aligned.
- If you touch workspace or optimization summary data, also inspect `web/src/lib/workspace-adapters.ts` and the matching dashboard or optimization tests.
- If you touch UI routing or shared shell behavior, stay inside the established runtime boundaries instead of creating a second routing layer.
- All UI implementation pages, including new pages, redesigned pages, approved-spec fixes, and visual regression repairs, must close through the UI Trace Matrix flow. Before final handoff, record the design source, exact route/query/object ID, page modules, selectors/components, copy/status/data mappings, interactions, responsive states, and approved deviations; then verify the user-facing route with screenshot, DOM geometry, text/state, and interaction evidence. Route reachability, page-title checks, keyword assertions, mock fixtures, or green unit tests are necessary signals only, never proof that the page matches the design.
- For UI fixes against an approved HTML/SPEC, do not close on class-name or existence assertions alone. Record a small trace matrix from design requirement to selector/file, and verify spacing, scrolling, sticky positioning, charts, colors, and responsive states with either browser screenshots/DOM geometry evidence or CSS contract tests.
- For composite UI surfaces such as drawers, rails, and cards, the trace matrix must also cover content architecture: section titles, status chips, source/card counts and titles, field labels and values, KPI labels and values, and key controls that must be present or absent. Do not accept shell geometry or screenshot similarity alone when the approved HTML/SPEC defines structured content.
- Any user-triggered logical delete must require a second confirmation surface before the write. This includes `status: ARCHIVED`, `status: DELETED`, `deleted_at` writes, and local preference removals that hide saved strategy legs; the confirmation should name the object, show the stable ID, and explain that records are hidden rather than physically purged.
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
