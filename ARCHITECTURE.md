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
- `backtest_runs` records whether a run is permanent or temporary through `is_permanent`.
- `backtest_runs` also stores `artifact_paths_json` and `trade_audit_json` so artifacts and audits can be replayed or cleaned up consistently.
- `app_runtime_state` stores cleanup bookkeeping, including `last_cleanup_count` and `last_cleanup_at`.

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
3. `GET /backtest-runs/{id}/detail` projects a lightweight `trade_audit_items` list.
4. `GET /backtest-runs/{run_id}/trades/{trade_id}/audit` returns the full episode-level audit payload for a single trade.

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
- `/optimization-jobs/*` covers job detail, candidate creation, candidate deletion, and promote-with-note.
- `/admin/snapshot-refresh-jobs` refreshes local snapshot state.

The frontend and backend tests are written against these contracts rather than against internal implementation details.

## 8. Design Principles

A few practical rules guide the shipped system:

- Prefer explicit state and revision markers over implicit UI guesses.
- Keep permanent runs separate from disposable temporary runs.
- Store the data needed to audit a result, not just the final score.
- Keep the restore path reversible by preserving indirection instead of hard-renaming everything at once.
- Let the launcher repair the runtime before asking the user to debug the runtime.

That is the shape of the current baseline: recoverable, auditable, and practical enough to keep working locally.
