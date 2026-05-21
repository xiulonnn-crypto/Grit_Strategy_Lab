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
- `harness/fixtures/seed_workspace/` is present with committed workspace/market-data SQLite fixtures and a manifest. `scripts/codex-reset-fixture.ps1` stages them into `.tmp/codex-fixture/`, and fixture-backed live acceptance should now report the actual reset/API/UI result rather than a missing-fixture blocker.

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
- Temporary pytest bases, debug databases, browser dumps, and scratch outputs must be written under `.tmp/` or `artifacts/`; repo pytest startup now rejects project-external pytest basetemp/cache paths and in-repo temp paths outside `.tmp/`, and agents must not leave root-level `pytesttmp-*`, `pytest-cache-files-*`, `tmp_dbg_*`, `tmp-promote-*`, or `tmp/` directories.
- Recovery evidence belongs under `docs/recovery/`, recovery helper scripts under `scripts/recovery/`, archived Git/database backups under `artifacts/recovery/`, and Codex/runtime logs under `output/logs/grit-coder/` or `artifacts/`; do not create new `.codex-logs/` or root-level recovery files.

## Testing instructions

- Backend fixed slice:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1`
- Frontend fixed slice:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1`
- Frontend strict global types:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes`
- Full smoke orchestration:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\codex-smoke.ps1`
  - Fixture-backed live acceptance is available through the committed `harness/fixtures/seed_workspace/` seed assets; if it fails, report the concrete reset, API, or UI assertion failure.
- The frontend fixed script always emits a `tsc --noEmit` report to `harness/reports/smoke/latest-frontend-global-types.txt`, even when type failures are not blocking.
- If you change API payloads or response shapes, update both backend and frontend contract mirrors and rerun the relevant fixed slices.
- If you change backend/API/shared contracts, run the owner slice before staging; the impact planner must also force the same slice:
  `.\.venv\Scripts\python.exe -m pytest tests/test_factor_research_api.py tests/test_backend_api.py tests/test_factor_mining_api.py tests/test_factor_factory_api.py tests/test_factor_quarantine_api.py -q`
- If you change async jobs, background runners, progress, completed status, or candidate materialization order, run the race-sensitive lifecycle test before broader impact; the impact gate must also repeat it through the async lifecycle repeat step:
  `.\.venv\Scripts\python.exe -m pytest tests/test_factor_mining_api.py::test_factor_mining_api_runs_one_thousand_candidates_without_factor_library_write -q`
- If you change F1/F2 factor library or factor factory frontend surfaces, run the focused Vitest owner slice from `web/`; the impact planner must also force this Vitest slice:
  `node scripts/run-vitest-fixed.cjs factors.phase0.f1.test.tsx factor.model-builder.test.tsx factor.factory.test.tsx app.routes.foundation.test.tsx`
- If you change `scripts/codex-validate-*`, `scripts/git_gate_plan.py`, pre-push behavior, or gate report format, self-test the gate before treating it as release evidence:
  `powershell -ExecutionPolicy Bypass -File .\scripts\codex-validate-impact.ps1 -PlanOnly`
  and `powershell -ExecutionPolicy Bypass -File .\scripts\codex-validate-fast.ps1`.
- Before the final commit/push path for broad contract, validation-tooling, or cross-stack work, run `powershell -ExecutionPolicy Bypass -File .\scripts\codex-validate-impact.ps1 -Scope WorkingTree` so impact failures surface during implementation rather than at the last git operation.
- `latest-fast-gate.md` and `latest-impact-gate.md` must keep per-step `duration=...` entries for git checks, backend targeted tests, frontend TypeScript, and frontend Vitest. Use those durations in closeout reports instead of guessing from file timestamps.
- The pre-push hook may consume `latest-impact-gate.md` only when it is `status=ok`, `scope=Committed`, not PlanOnly, did not skip tests, includes step duration evidence, and matches the remote push base. It may bypass fast gate when the report already matches current `HEAD`. It may also reuse a matching parent `HEAD` when the current tip is a single generated metadata commit that changes only `CHANGELOG.md` and/or `src/grit_backtest_platform/_version.py`, but only after the current pre-push changelog preparation and metadata whitespace checks pass; any other head mismatch must rerun impact/full instead of assuming the report is reusable.
- For validation reuse, `codex-validate-fast.ps1` and `codex-validate-impact.ps1` support `-SinceLastValidated <sha>` and write `since_last_validated` plus `validation_fingerprint` to the gate summary. Backend contract fanout is reserved for core backend contract files (`api.py` / `models.py`); frontend contract mirrors should use their frontend owner slices unless core backend contracts are also touched.
- Gate cancellation must be treated as non-evidence: tracked pytest/node child processes should be stopped, and a cancelled run must not overwrite the latest gate summary after the abort.

## Promoted Memory Quick Checks

- If `http://127.0.0.1:4173` returns `Frontend build not ready yet.`, inspect the process listening on port `4173` before changing application code. The healthy QuickStart path launches `web/preview-server.mjs` with `--watch --rebuild-on-start`; `web/package.json` `preview:auto` is the known-good baseline. A listener command line like `node ./preview-server.mjs --watch --rebuild-on-start` is repo-local preview even when it lacks an absolute repo path.
- If a user reports a live page under `http://127.0.0.1:4173`, treat the active localhost listeners as the acceptance target. Before claiming delivery, confirm the `8000` backend and `4173` preview processes were started after the final code, rebuild `web/dist` when serving preview, and verify the reported route with real browser/API checks instead of relying only on fixed slices or mocked tests.
- Before any live-route acceptance, build/restart decision, or localhost handoff, run `powershell -ExecutionPolicy Bypass -File .\scripts\codex-grit-runtime-preflight.ps1 -Json`. Proceed directly only when `quickstartOverall=ready` and `decision=reuse`; otherwise follow `nextAction`, then rerun the preflight. Treat `probe-degraded` and `blocked-*` as blockers rather than silently restarting.
- Before restarting localhost for a user-reported data regression, verify the active `GRIT_BACKTEST_DB` and companion market-data DB are the intended runtime databases. If root `.grit_backtest_platform.sqlite3` is unexpectedly empty while a richer runtime copy exists under `.tmp/`, back up both root databases before restoring or repointing; do not let a restart against a fresh empty DB look like deleted workspace history.
- For historical `MULTI_FACTOR` run mismatches, start with `python .\scripts\recovery\compare_backtest_runs.py --run-a <run_id_a> --run-b <run_id_b>` before replaying code. The tool compares persisted `request.start_date`, `effective_date`, first chart/trade date, first basket, rebalance schedule, parameter snapshot, and `multi_factor_precheck` directly from `backtest_runs`; if parameter/precheck match but the first basket diverges, treat it as possible historical engine or data drift and follow `docs/recovery/multi-factor-backtest-forensics-playbook.md`.
- When snapshot provider keys such as `KAGGLE_API_TOKEN`, `MASSIVE_API_KEY`, or `NASDAQ_DATA_LINK_API_KEY` are written from the UI or manually, do not rerun plain `QuickStart-Grit.ps1` and expect a healthy backend to reload them. Use `QuickStart-Grit.ps1 -ForceRestart -RestartReason "snapshot provider credentials updated"` so supervisor records the forced restart and repo-owned `8000/4173` listeners are replaced.
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
- For Optimization Results full-combination regressions, test the three boundaries separately: persisted `optimization_jobs.request_json/summary_json` may compact large `matching_combinations`, explicit `PATCH /optimization-jobs/{id}` refilter responses and full detail hydration must preserve the full `matching_combinations` collection, and the frontend modal pagination/sort must run against that full collection rather than the top candidate preview.
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
- For large cross-stack factor/PIT/operator work, pick a thin slice before editing: `Contract Skeleton`, `Execution Core`, or `UI Parity`. Do not combine contract, execution, UI, tests, and docs into one worker delivery unless the user explicitly asks for one-shot end-to-end work and the diff is small.
- Multi-agent factor work must split by write boundary, not only by product responsibility. Assign a single integration owner for hotspot files such as `models.py`, `api.py`, `web/src/types.ts`, factor factory pages, and shared tests.
- Before multi-agent factor-factory implementation starts, create `output/logs/grit-coder/<task-slug>/agent-task-matrix.md` with each task's owner, branch/worktree, base commit, write set, forbidden hotspot files, focused tests, runtime boundary, merge order, and final integration gate. If worktree isolation is skipped, record the skip reason and compensating validation there.
- For approved UI/spec work, create the Trace Matrix skeleton before UI edits, not after implementation. It must already name design sources, route, desktop/mobile viewports, measurable overflow/geometry gates, interaction states, screenshot filenames, and approved deviations.
- For design-locked UI handoff, do not call the slice complete until the Trace Matrix is fully signed off and `git status --short -- <owned paths>` proves source, tests, trace files, screenshots, and new files are either tracked/staged intentionally or explicitly listed as evidence assets. An untracked core source, test, or view-model file is a blocker, even if the live page currently looks correct.
- Before live route verification or localhost restart decisions, save `powershell -ExecutionPolicy Bypass -File .\scripts\codex-grit-runtime-preflight.ps1 -Json` output to `output/logs/grit-coder/<task-slug>/runtime-preflight.json`; terminal summaries and `/healthz` alone are not enough final evidence.
- If an owner slice fails on an unrelated dirty-worktree area, record it in `output/logs/grit-coder/<task-slug>/known-blockers.md` with the failing command, file/test, owner area, and out-of-scope reason before claiming the current slice passed.
- If you touch workspace or optimization summary data, also inspect `web/src/lib/workspace-adapters.ts` and the matching dashboard or optimization tests.
- If you touch UI routing or shared shell behavior, stay inside the established runtime boundaries instead of creating a second routing layer.
- For strategy-type backtest bugs or new strategy-type execution paths, prove the declared strategy parameters reach the engine with a differential regression. Explicit asset-allocation baskets must require every configured symbol to have price history instead of silently reweighting the remaining assets, and multi-factor baskets must produce factor-specific rankings rather than generic template fallback results.
- For Milestone 3 factor work, mined sandbox candidates must pass through D2 quarantine before any Auto-Mined factor is published; never write sandbox candidates directly into the formal factor library.
- Factor model suggestions created from governance actions must stay as draft or review-needed recommendations and must not overwrite current production strategy versions automatically.
- Factor library and factor detail UI scope is intentionally narrow: only the fourth summary card becomes the governance queue, and only the right-side trail module becomes the audit trail, unless the user explicitly widens the scope.
- Runtime workbench pages must not substitute mock or sample rows when the API returns empty or fails. Show a real empty/error state, wire visible action buttons to live APIs, and verify the user-facing route against live API state before claiming acceptance.
- Legacy sandbox quarantine intake may mirror the mining sandbox top-candidate projection for compatibility only. Phase 1 Factor Factory runs must treat the persisted Raw_F2 batch ledger as the quarantine source of truth, with `top_candidates` limited to preview/page projection. The workbench queue must dedupe by normalized expression, and PIT evidence that is not Full Ready should enter review/observation unless another hard gate fails; it must not auto-publish.
- Before changing factor-factory batch-count, Raw_F2/Refined_F2, WNZT, quarantine, or publishable-factor behavior, run `python scripts/factor_factory_lineage_preflight.py` against the active DB and use the output as the first evidence item. Treat `top_candidates`, first-page rows, default `page_size=50`, and other previews as non-canonical. If preflight shows a ledger/source-job/count mismatch, solve lineage before changing UI copy or filters.
- Factor-factory artifact-producing changes must preserve a manifest contract for full ledgers: `job_id`, `source_job_id`, `formula_count`, `refined_count`, `hash`, and `created_at`. API/detail surfaces should expose enough manifest evidence to prove the displayed Raw/Refined/WNZT details belong to the current batch, not an older reused candidate.
- For factor-factory debugging, prefer a small-budget red repro first, usually 20-50 formulas, then run the 1470+ acceptance batch once. Final live evidence should compare the route's task cards, pagination range, publishable duplicate groups, and detail-modal Raw/Refined/WNZT evidence against API and artifact/manifest values.
- Before changing factor Chinese display naming, V4/V4-structured projection fields, alias/search keywords, display-name backfill, quarantine publish, governance publish, or factor display UI, build a read-only duplicate-name fact table for online-visible F2/F3 factors. Include `factor_id`, current stored name, projected/base name, tier, lifecycle status, expression, parent ids, processing chain, benchmark/residual control, and collision group.
- Factor naming work must prove parser coverage outside the API path for `Return`, `Std(Return)`, `DownsideStd(Return)`, `Residual`, `FFBlend`, cashflow/volatility ratios, window parameters, and missing benchmark metadata. Missing benchmark data is an audit gap, not permission to default to `SP500`.
- Display-name backfill must be identity-invariant: do not change `id`, `canonical_id`, factor-version expressions, lineage edges, diagnostic summaries, or historical publish events. Preserve old names as alias/search keywords so historical runs and strategy details remain searchable.
- Use the same naming resolver for `/factors`, factor detail, dry-run/apply backfill, quarantine publish, and governance optimized-factor publish. If two paths can produce different Chinese names or dedupe suffixes for the same factor, treat that as a blocking contract bug.
- Publishable-factor and quarantine UI must make same-base-name candidates visibly distinguishable with collision styling, difference chips, and a detail/audit modal; making the name longer without showing the differentiating evidence is not enough.
- For ad hoc Python while debugging this area on Windows, use PowerShell-safe `@' ... '@ | python -` or a short script under `.tmp/`; do not rely on Bash heredoc syntax in repro notes.
- All UI implementation pages, including new pages, redesigned pages, approved-spec fixes, and visual regression repairs, must close through the UI Trace Matrix flow. Before final handoff, record the design source, exact route/query/object ID, page modules, selectors/components, copy/status/data mappings, interactions, responsive states, and approved deviations; then verify the user-facing route with screenshot, DOM geometry, text/state, and interaction evidence. Route reachability, page-title checks, keyword assertions, mock fixtures, or green unit tests are necessary signals only, never proof that the page matches the design.
- For UI fixes against an approved HTML/SPEC, do not close on class-name or existence assertions alone. Record a small trace matrix from design requirement to selector/file, and verify spacing, scrolling, sticky positioning, charts, colors, and responsive states with either browser screenshots/DOM geometry evidence or CSS contract tests.
- For design-locked routes, the trace matrix is a pre-implementation acceptance contract, not a post-hoc report. Declare measurable geometry and interaction gates before final review, including module heights, table/container width, right-side blank space, text overlap, button wrapping, sticky/floating positions, modal initial/open/close states, and screenshot filenames. A verification agent or reviewer must be allowed to block delivery if these gates are missing or fail.
- For design-locked routes with conditional modules, the trace matrix must force those modules into visible states before approval. Examples include publishable queues, non-empty ledgers, empty states, WARN/FAIL/PASS rows, disabled controls, and opened modals. If the live API cannot naturally produce the approved-artifact state, use an auditable fixture/seed or mark the review blocked; do not treat a hidden conditional module as design parity.
- For every approved HTML/SPEC/PNG implementation, record both the approved design screenshot and the live screenshot in the matrix, then compare module order, card/list counts, field labels, controls, density, and allowed deviations. Runtime behavior proof is necessary but cannot replace visual/content parity proof.
- Before claiming UI parity, open and inspect the final screenshots. Saving a screenshot file or passing DOM/class-name assertions is not enough; the final report must state what was visually checked and any approved deviation.
- For composite UI surfaces such as drawers, rails, and cards, the trace matrix must also cover content architecture: section titles, status chips, source/card counts and titles, field labels and values, KPI labels and values, and key controls that must be present or absent. Do not accept shell geometry or screenshot similarity alone when the approved HTML/SPEC defines structured content.
- When a technical plan and an approved design artifact both exist, treat them as different contracts: the plan governs data/read-model ownership and interaction semantics, while the approved artifact governs visible module count, order, copy, and density. Do not surface every newly available backend field on the page unless the approved artifact or trace matrix explicitly gives it a slot.
- For design-locked routes that specify exact frontstage copy, status labels, timestamps, or KPI numbers, freeze those values through a view-model/formatter or approved constants until the trace matrix explicitly marks a field as live-substitutable. Do not let raw runtime counters, waiver totals, diagnostic windows, or provider gaps leak into the visible main stage by default.
- For design-locked routes, create the trace matrix before editing code, not after implementation. It must include a content/status semantic matrix, prove visible controls are real interactions, require desktop and mobile screenshots, and reject raw engineering language such as `NaN`, fill-value rules, enum keys, or conflicting status/risk copy in the user-facing main stage.
- After implementing a design-locked route, do not hand off or close until every trace-matrix row is signed as `PASS`, with `FAIL=0`, `BLOCKED=0`, and `NOT_CHECKED=0`. Self-review is only a pre-review gate; a missing screenshot inspection, unproven interaction, unverified mobile state, or unapproved visual/copy deviation must block delivery.
- For additive governance routes such as `#/snapshots` and `#/pit-data`, do not leave page-local `buildApproved*` or other hard-coded approved-builder arrays in control of live cards, ledgers, matrices, or action lists once the backend contract exists. Preserve the approved layout, but switch the visible content to explicit live view-model mappers and keep tests aligned to the approved structure plus runtime contract projection rather than frozen synthetic row ids or demo-only counts.
- Before claiming live/design parity, explicitly record whether the shared shell is in scope and wait for the first real content module, not just the route heading, before taking screenshots. If the shell is in scope, verify sidebar inventory and selected state together with the page body.
- Any user-triggered logical delete must require a second confirmation surface before the write. This includes `status: ARCHIVED`, `status: DELETED`, `deleted_at` writes, and local preference removals that hide saved strategy legs; the confirmation should name the object, show the stable ID, and explain that records are hidden rather than physically purged.
- Add or update tests for the code you change, especially around optimization jobs, candidate materialization, snapshots, and workspace projections.
- For non-trivial work, read promoted project memory first: this `AGENTS.md` for workflow rules and `ARCHITECTURE.md` for system facts, data flows, troubleshooting steps, regression tests, and validation commands.
- When a new approved plan conflicts with this file, `TECHNICAL.md`, `ARCHITECTURE.md`, or `DESIGN.md`, stop before implementation and record which rule is superseded, which rule remains legacy-compatible, and which tests prove the new source of truth. Do not silently follow the older document.
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
