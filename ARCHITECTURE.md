# Architecture

This document describes the shipped restored baseline for Grit Strategy Lab. It is intentionally practical: it records the mechanisms that make the current workspace runnable, auditable, and recoverable.

## 1. Restored Module Indirection

The backend keeps a restored-module indirection layer on purpose.

- Public imports stay stable under `grit_backtest_platform`.
- The package resolves to rebuilt/restored implementation modules such as `_service_rebuilt.py`, `_real_service_rebuilt.py`, and `_storage_restored.py`.
- This indirection lets the repo hot-swap repaired modules without forcing a destructive rename cycle across the whole codebase.
- In practice, that means the package can keep shipping while individual recovered modules continue to evolve behind the same import surface.

This is not a temporary hack. It is the current high-availability mechanism for a repository that has already survived partial corruption and recovery.

## 2. Runtime Self-Heal

The launcher and repository-local runtime are designed to repair themselves.

- `QuickStart-Grit.ps1` prefers a repo-local runtime at `.python-runtime`.
- The older `.python314-home` directory is treated as a legacy source and can be migrated into `.python-runtime` when needed.
- `.venv` is derived from the repo-local runtime and is rebound through `pyvenv.cfg` so it points at the current runtime home.
- The launcher can discover a suitable Python 3.14 or 3.13 source, then repair the local runtime from that source.
- The launcher also checks frontend dependencies and will reinstall `web/node_modules` if the tree is incomplete.

The goal is to make the repo self-contained. A healthy local checkout should not depend on a hidden user-profile Python install or a manually curated node_modules tree.

## 3. Storage and Cleanup

The storage layer persists the workspace contract, strategy records, backtest runs, optimization jobs, and runtime audit state in SQLite.

Key pieces:

- `strategy_parameter_versions` is the authoritative parameter-version table.
- `strategies` keeps `dataset_snapshot_id` and `universe_snapshot_id` so formal backtests stay bound to explicit snapshot records instead of ambient market data.
- `backtest_runs` records whether a run is permanent or temporary through `is_permanent`.
- `backtest_runs` also stores `artifact_paths_json` and `trade_audit_json` so artifacts and audits can be replayed or cleaned up consistently.
- `backtest_runs.trade_audit_items_json` is the lightweight evidence-list projection used by run detail. The full `trade_audit_json` remains the source of truth for single-trade audit drill-downs, but the detail endpoint is not allowed to decode the full audit blob on the hot path.
- `optimization_jobs` stores the job-level request, summary, and result projections for the optimization lab.
- `optimization_job_trials` is the checkpoint truth for optimization search progress. Each completed or failed trial is persisted by `job_id + trial_index` with `parameter_snapshot_json`, `metrics_json`, `chart_series_json`, `score`, and timestamps so interrupted jobs can continue without replaying finished combinations.
- `optimization_job_trials.chart_series_json` is now tiered storage: running jobs persist lightweight `[]` payloads for most trials, and only the final top-K candidates are backfilled with full chart series for the result center.
- Optimization execution now keeps a parent-controller runtime available: one background thread owns the job lifecycle and all SQLite writes, while optional child processes can compute trial summaries and return them over IPC. For the current synthetic evaluator path, that multiprocessing fan-out is intentionally disabled by default because sequential execution benchmarks faster.
- The market-data SQLite now carries snapshot-scoped tables: `dataset_snapshots`, `universe_snapshots`, `dataset_price_bars`, `dataset_corporate_actions`, `dataset_symbol_coverage`, and `universe_membership_snapshots`.
- `symbol_identity_cache` is the internal identity-repair table for delisted symbols, ticker lifecycle fixes, and CIK/exchange metadata stitched from Alpha Vantage, SEC EDGAR, and FMP.
- `snapshot_refresh_jobs` is the refresh audit log for both the API and the CLI entrypoint. Its `summary_json` now carries refresh heartbeat fields such as `current_stage`, `current_stage_label`, `heartbeat_at`, `progress`, and partial `refresh_stats` so running jobs are observable before completion.
- `snapshot_recovery.py` is the cold-backup probe/import boundary for `C:\Fin\Grit_Strategy_Lab2`; Lab2 is treated as a recovery source, never as a live runtime dependency.
- `universe_history.py` now owns the point-in-time universe source chain: `FMP historical constituent` first when available, then wikipedia revision-history snapshots plus official index announcements, with the current wikipedia page and the old static seed only as softer fallbacks.
- `app_runtime_state` stores cleanup bookkeeping, including `last_cleanup_count` and `last_cleanup_at`. It also mirrors the active snapshot-refresh heartbeat so interrupted worker recovery can distinguish “still running” from “stalled”.

Cleanup behavior:

- `purge_expired_temporary_runs()` removes runs where `is_permanent == 0` and `created_at` is older than 24 hours.
- The cleanup path removes the database record and also deletes associated artifact paths.
- Plot artifacts under `web/dist/plots/{run_id}` are treated as disposable cleanup targets.
- Cleanup runs once at startup and then every 6 hours in a background thread.
- `GET /workspace/overview?include_cleanup_audit=1` exposes the last cleanup count as `last_cleanup_count`; the default workspace contract stays unchanged unless the query flag is set.

The intent is to keep the local lab from filling up with short-lived experiments while preserving permanent runs and their audit trail.

## 4. Parameter Version Truth

Parameter version truth lives in the parameter-version tables, not in ad hoc UI state.

- `strategy_parameter_versions` is the source of truth for versioned strategy parameters.
- `strategy.parameter_history` is a projection of that truth for the UI and API consumers.
- Each history entry can carry a `comment`, which is populated when a candidate is promoted with a revision note.
- Creation sessions can be started in `CREATE` or `REVISION` mode, with `base_strategy_id` and `base_parameter_version_id` carried through the session contract.
- Promotion and materialization paths enforce base-version checks and return `409 stale_base_parameter_version` when the baseline has moved.

The important rule is that the UI never invents a version. It always reflects the persisted version history, including the note that explains why a new version exists.

## 5. Trade Audit Pipeline

Backtest execution now produces a trade audit that is more descriptive than a flat trade journal.

Pipeline summary:

1. A backtest is submitted.
2. The engine computes the run result and assembles `trade_audit_json`.
3. The service also persists `trade_audit_items_json`, a lightweight projection for the evidence rail.
4. `GET /backtest-runs/{id}/detail` reads the lightweight projection and avoids decoding the full audit payload.
5. `GET /backtest-runs/{run_id}/trades/{trade_id}/audit` returns the full episode-level audit payload for a single trade.

The audit model is episode-based:

- One audit record represents a symbol-level position episode from entry to exit.
- The model is not fill-level or tick-level.
- The UI uses `trade_audit_items` for the row list and the full audit endpoint for chart sync and diagnostics.

The full audit payload includes:

- `price_series` for the relevant symbol context
- `trigger_snapshot` for the signal state that justified the trade
- `risk_evaluation` with MFE, MAE, MFE/MAE ratio, slippage cost, and commentary
- `entry_marker` and `exit_marker` for chart anchoring
- `chart_band` for the colored open-to-close interval

This makes the run detail useful for human review without pretending that a flat trade table is enough to explain why a trade happened.

## 6. Metrics Baseline

The recovered math layer is intentionally conservative.

- `relative_metrics` and `drawdown_events` are treated as the Python 3.13 baseline.
- The implementation assumes stdlib-only numeric behavior for the restored path.
- No numpy or pandas dependency is assumed for the shipped metrics layer.
- The acceptance bar is reproducibility across the current runtime, not matching an external analytics stack.

This matters because the repo has already been recovered across runtime changes. The current baseline should stay stable on Python 3.13 even if the original environment was different.

## 7. Public API Contract

The stable API surface is intentionally narrow and concrete.

- `/workspace/overview` keeps the top-level workspace contract stable.
- `/strategy-creation-sessions/*` handles create and revision workflows.
- `/backtest-runs/*` covers preview, submit, clone, detail, trades, and single-trade audit.
- `GET /backtest-runs/{id}/detail` is intentionally optimized for page load. It may include `trade_audit_items`, but it must not materialize full `trade_audit` records; those belong to `GET /backtest-runs/{run_id}/trades/{trade_id}/audit`.
- `/optimization-jobs` lists optimization jobs ordered by `updated_at DESC`, projecting task status, strategy linkage, budget progress, `progress_pct`, `current_stage`, `latest_update`, `estimated_remaining_minutes`, `estimated_completed_at`, and a typed `best_metrics_summary` trial summary for the optimization lab index and workspace mixed timeline.
- `POST /strategies/{strategy_id}/optimization-jobs` now accepts `base_parameter_version_id`, `source_run_id`, `entry_point`, `validation_mode`, `budget_combinations`, and `search_space`; the job is created only when the parameter-config screen explicitly starts optimization.
- `POST /optimization-jobs/{id}/resume` accepts `idempotency_key` and resumes only `INTERRUPTED` jobs from `next_trial_index`; duplicate calls with the same key are treated idempotently.
- `/optimization-jobs/*` covers job detail, candidate creation, candidate deletion, resume, and promote-with-note.
- `GET /optimization-jobs/{id}` returns hydrated `request`, `summary`, and `result` sections. `summary.best_metrics_summary` is no longer a loose metrics bag; it uses the persisted trial-summary shape (`trial_index`, `label`, `status`, `parameter_snapshot`, `metrics`, `score`, `error_message`, `started_at`, `completed_at`). `QUEUED`, `RUNNING`, and `INTERRUPTED` responses are intentionally lightweight: they expose progress, ETA, best-so-far metrics, and resume metadata without materializing the full candidate grid. Terminal states materialize the full result center from persisted trial records, including `annualized_return` in validation windows, but they only load full chart series for the ranked top-K candidates.
- Large optimization jobs still have a Windows-safe `spawn` process fan-out implementation behind the service boundary. It is not user-configurable at the API boundary, it can auto-adjust the worker target from runtime memory pressure, and it can fall back to single-worker mode without changing the persisted job contract; however, the current synthetic evaluator keeps this path off by default until a heavier evaluator actually benefits from it.
- The current optimization evaluator path is intentionally detached from `_prepare_backtest_run_context()`. The active `_service_rebuilt.py` evaluator is synthetic and summary-driven, so prepared snapshot bars are not loaded during optimization execution.
- `/data-snapshots/overview` returns the formal snapshot contract: `overall_status`, `last_refreshed_at`, `dataset_snapshots[]`, `universe_snapshots[]`, `latest_job`, `blocking_code`, `blocking_target`, `message`, and `allowed_actions`.
- `/admin/snapshot-refresh-jobs` accepts `reason`, `mode`, and `targets`, then returns the refreshed overview contract instead of a bare job payload.
- `python -m grit_backtest_platform.main refresh-snapshots --reason ... --mode incremental|repair|full --targets price,corporate,universes` is the scheduler-safe CLI entrypoint used by Windows Task Scheduler; the API process does not own the 18:00 trigger.
- Running refresh jobs now emit heartbeat checkpoints and partially merged dataset snapshots while they are still `RUNNING`; overview consumers should expect `latest_job.summary.refresh_stats` to change before the terminal job write lands.
- The runtime market-data chain is role-based: `Yahoo -> Tiingo -> Longbridge -> AkShare -> FMP` for prices, `Yahoo/Tiingo -> Alpha Vantage -> SEC EDGAR` for canonical company events, and `Tiingo symbology -> Longbridge static info -> FMP delisted -> Alpha listing status` for ticker lifecycle repair.
- `Longbridge` is a cloud-based enhancer for current/latest-window US data only; it is never used as the canonical 1996-start full-history source and it never participates in historical universe anchors.
- Universe snapshots are only `READY` when every anchor came from a historical source (`FMP historical constituent` or a historical revision snapshot); current-page or static-seed fallbacks remain explicitly incomplete so formal backtests do not silently drift into survivorship-biased universes.

The frontend and backend tests are written against these contracts rather than against internal implementation details.

## 8. Frontend Runtime Truth

The restored frontend now has an explicit runtime boundary and should be treated as a first-class architectural surface.

- `web/src/app-runtime.tsx` is the stable entry shim.
- `web/src/app-runtime-cn.tsx` is the active runtime implementation.
- `web/src/lib/appRouteContext.tsx` is the only hash-route parser and navigation truth.
- `web/src/shell-frame-cn.tsx`, `web/src/shell-route-meta-cn.ts`, and `web/src/app-shell-frame.css` define the shared application shell.
- `web/src/lib/demoStoreContext.tsx` is the real browser HTTP client boundary through `useApiClient`.
- `web/src/app.routes.foundation.test.tsx` is the route smoke truth file; `web/src/app.routes.test.tsx` is compatibility-only.
- `web/src/pages/optimization-lab-page.tsx` treats optimization detail as a three-state screen: progress (`QUEUED/RUNNING`), interrupted (`INTERRUPTED`), and terminal (full result center).
- The optimization results page polls running job detail on a single-flight loop: production uses a 3000 ms cadence, while test mode uses a shorter cadence so polling behavior stays directly testable.

The formal frontend route map is fixed to:

- `#/workspace`
- `#/creation/new`
- `#/creation/sessions/:id`
- `#/strategies/:id`
- `#/strategies/:id/backtest-runs/new`
- `#/runs`
- `#/runs/:id`
- `#/optimization-jobs`
- `#/optimization-jobs/new`
- `#/optimization-jobs/new/config?...`
- `#/optimization-jobs/:id`
- `#/snapshots`

Optimization lifecycle truth is fixed to:

- Jobs move through `QUEUED -> RUNNING -> COMPLETED|PARTIALLY_FAILED|FAILED`, and any service restart converts in-flight `QUEUED/RUNNING` jobs into `INTERRUPTED`.
- `INTERRUPTED` jobs keep `completed_combinations`, `persisted_trial_count`, `next_trial_index`, and `best_metrics_summary`; the detail page shows a lightweight progress panel plus `继续优化`.
- The frontend does not render half-built candidates while a job is running or interrupted. The full candidate shelf, stability center, heatmap, and validation windows only appear after terminal materialization.
- Terminal optimization rendering is data-gated, not title-gated: candidate table and shelf require real `candidates[]`, stability center requires candidate metrics or checks, heatmap requires `heatmap.cells[]`, and multi-window validation requires `validation_windows[]`. Empty result shells are intentionally hidden.

The orchestrator rule is simple: workers may build page-local views, but they do not redefine route parsing, shell layout, shared tokens, or runtime client boundaries.

## 9. Frontend View-Model Boundaries

The screenshot-driven restore depends on frontend view models, not on changing backend contracts.

- `web/src/types.ts` now models snapshots as two explicit arrays: `dataset_snapshots[]` and `universe_snapshots[]`.
- `web/src/pages/snapshots-page.tsx` consumes only the formal overview contract and renders a single header card plus the two snapshot cards; it no longer derives UI from legacy `coverages`.
- While a refresh job is `RUNNING`, the snapshots page may surface incremental `新增...` summary text as soon as partial `refresh_stats` have been persisted; if no partial stats exist yet, it falls back to the bare “最近刷新 ...” timestamp.
- The snapshots page maps backend source codes such as `longbridge`, `akshare_us`, `fmp_historical_constituent`, `tiingo`, `alpha_vantage`, `sec_edgar`, `official_announcement`, `wikipedia_revision_history`, `wikipedia_current_page`, `static_seed`, and `local_cold_backup` into user-facing source-chain labels instead of exposing raw provider ids.
- The snapshots page keeps status semantics human-readable: incomplete snapshots render as “部分可用”, only running jobs render “后台更新中”, and legacy-contract responses surface a backend-restart hint instead of silently failing.
- `web/src/shell-route-meta-cn.ts` keeps `#/snapshots` shell headings disabled so the page owns its single in-card heading.
- These fields are still real backend contract fields; the frontend must treat them as optional and must not narrow them into screenshot-only shapes.
- `web/src/lib/workspace-adapters.ts` is the sole workspace adapter truth for dashboard cards, compare state, and recent-run projections.
- `web/src/lib/adapters.ts` remains only as a compatibility export surface for non-workspace consumers.
- `web/src/pages/workspace-page-lane-b.tsx` and `web/src/page-sections/workspace-recent-runs-lane-b.tsx` now treat the right rail as a mixed activity timeline, not a backtest-only list: backtests and optimization jobs are merged by `completed_at ?? updated_at ?? created_at`, capped at the latest 8 items, and optimization cards consume only the `/optimization-jobs` list projection so the workspace never fan-outs into per-job detail requests.

This keeps the UI expressive without inventing a second source of truth outside the API.

## 10. Design Principles

A few practical rules guide the shipped system:

- Prefer explicit state and revision markers over implicit UI guesses.
- Keep permanent runs separate from disposable temporary runs.
- Store the data needed to audit a result, not just the final score.
- Keep the restore path reversible by preserving indirection instead of hard-renaming everything at once.
- Let the launcher repair the runtime before asking the user to debug the runtime.

That is the shape of the current baseline: recoverable, auditable, and practical enough to keep working locally.
