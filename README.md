# Grit Backtest Platform

Grit Backtest Platform is a local strategy research and backtesting workspace. The restored build ships the current vertical slice end to end: workspace compare, conversation-based strategy creation, snapshot refresh, real backtest submission and review, optimization manual lab management, and interactive trade audit.

## What Is Implemented

Available workflow:

1. Workspace strategy board with compare cockpit and hidden cleanup audit contract
2. Template-driven conversation-based strategy creation
3. Editable confirmation draft before materialization
4. Strategy detail with explicit parameter history and revision comments
5. Snapshot refresh that ingests local historical market data
6. Real backtest preview before submission
7. Real backtest run detail with metrics, chart series, trade audit items, and interactive trade audit
8. Optimization manual lab with candidate creation, deletion, compare top 3, and promote-with-note flow
9. Data snapshot remediation page

Important product constraints in this slice:

- Frontend behavior is driven by explicit status fields, `allowed_actions`, and confirmation revisions.
- Workspace cards bind strictly to the current `parameter_version`; cards in `PENDING_RUN` or `RUNNING_CURRENT_VERSION` are excluded from the compare cockpit.
- Formal backtests execute against local SQLite snapshots, not live network data during the run.
- Signals and total-return math use `adj_close`; fills use next-session raw `open` plus stored adjustment metadata for split-aware auditability.
- The last 20% of the requested window is always marked as the `Blind Test Zone` for OOS review.
- Coverage below 80% raises warnings but does not automatically block submission.
- Mobile mode remains read-only.
- Manual lab promote flows carry a revision note into the new parameter version comment field.
- Interactive trade audit is position-episode based, not raw fill-based.

## Tech Stack

- Backend: Python, FastAPI, Pydantic, SQLite
- Frontend: React, TypeScript, Vite
- Tests: pytest, Vitest, Testing Library

## Repository Layout

```text
./
  src/grit_backtest_platform/   backend app
  tests/                        backend tests
  web/                          frontend app and tests
  ARCHITECTURE.md               implementation architecture
  README.md                     project guide
```

## Quick Start

The fastest local entrypoint is the repo-root launcher:

- `QuickStart-Grit.ps1`

What it does:

- starts the FastAPI backend on `http://127.0.0.1:8000`
- starts the frontend on `http://127.0.0.1:4173/#/workspace`
- reuses already running local services instead of spawning duplicate windows
- bootstraps or validates the repo-local runtime at `.python-runtime\`
- rewrites `.venv\pyvenv.cfg` so the derived environment points at the current runtime home
- prefers Python 3.14 if it is available, then falls back cleanly to 3.13
- self-heals `web/node_modules` with `npm install` when the dependency tree is incomplete
- never falls back to a hidden user-profile Python install as the steady-state runtime
- opens the browser only after the frontend preview is ready
- fails explicitly if the backend cannot start instead of silently switching to demo/mock data

Useful options:

```powershell
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -NoBrowser
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -ValidatePythonOnly
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -RepairPython -NoBrowser
```

## Prerequisites

### Backend

- Python 3.13+ is sufficient for the restored runtime path
- the launcher will discover or repair the repo-local `.python-runtime\` automatically
- `.venv\` is a derived environment and can be rebuilt at any time

### Frontend

- Node 18+
- npm

The frontend toolchain is pinned to a Node 18-compatible Vite stack. `npm run dev`, `npm run build`, and `npm run test` are expected to work on the current local runtime.

## Backend Setup

From the repository root, run the launcher once to repair or validate the local runtime:

```powershell
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -RepairPython -NoBrowser
```

If the launcher needs a manual source Python, point it at a known-good 3.14 or 3.13 install once:

```powershell
$env:GRIT_PYTHON_RUNTIME_SOURCE='C:\Users\GRIT\AppData\Local\Programs\Python\Python314'
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -RepairPython -NoBrowser
```

The application stores local state in a SQLite file named `.grit_backtest_platform.sqlite3` in the repo root by default. To override that location:

```powershell
$env:GRIT_BACKTEST_DB='C:\path\to\custom.sqlite3'
```

## Run the Backend

```powershell
.\.venv\Scripts\python.exe -m uvicorn grit_backtest_platform.main:app --host 127.0.0.1 --port 8000
```

## Frontend Setup

From `web/`:

```powershell
npm install
```

Point the frontend at the backend before starting the dev server:

```powershell
$env:VITE_API_BASE_URL='http://127.0.0.1:8000'
npm run dev
```

The app uses hash routing. The primary entry routes are:

- `#/workspace`
- `#/creation/new`
- `#/runs/{runId}`
- `#/optimization-jobs/{jobId}`
- `#/strategies/{id}/backtest-runs/new`

## Core Flows

### Workspace and Compare

The workspace page reads `/workspace/overview` and can opt into cleanup audit with `?include_cleanup_audit=1`. The cleanup count stays hidden in the UI, but it is still part of the contract for maintenance tooling.

### Manual Lab

The optimization manual lab supports candidate creation, candidate deletion, deleting all losing candidates, compare-top-3, and promote-with-note. Promote flows require a revision note and persist it into the new parameter version comment.

### Interactive Trade Audit

Run detail now includes trade audit items and per-trade audit payloads. Clicking a trade row re-selects the episode, updates the chart band, and shows the trigger snapshot and risk evaluation for that episode.

## Real Backtest Flow

The formal backtest path is now:

1. Create or edit a strategy until the confirmation draft is ready.
2. Refresh snapshots from the snapshot remediation page or `POST /admin/snapshot-refresh-jobs`.
3. Open `#/strategies/{id}/backtest-runs/new`.
4. Review the preview contract, coverage warnings, effective date range, and Blind Test Zone split.
5. Submit the run.
6. Review the completed run detail with metrics, chart series, trade audit items, and the interactive trade audit panel.

The backend enforces local-data gating. If snapshot storage is empty or stale, submission is blocked with a structured `409` payload.

## Run Tests

### Backend tests

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_backend_api.py tests\test_real_backtest_api.py tests\test_creation_templates.py tests\test_creation_session_refresh.py -q
```

### Frontend tests

```powershell
Set-Location web
npm run test
```

### Frontend production build

```powershell
Set-Location web
$env:VITE_API_BASE_URL='http://127.0.0.1:8000'
npm run build
```

## GitHub 推送修复（当前会话）

若当前 PowerShell 会话出现 `connect to github.com port 443 via 127.0.0.1` 的推送错误，先用以下脚本走一条无代理路径推送远端引用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1 -SourceBranch main -TargetBranch restore/skeleton
```

脚本会自动清理环境变量中的 `HTTP(S)_PROXY` / `ALL_PROXY`，并把 `git push` 限制为不走这类代理配置。  
如仍报证书/凭据类错误，请先执行 `git -c credential.helper=manager-core push ...` 触发一次登录后再重试。

## Current Verification Baseline

The current implementation has been verified with:

- `pytest tests/test_backend_api.py -q`
- `pytest tests/test_real_backtest_api.py -q`
- `pytest tests/test_creation_templates.py tests/test_creation_session_refresh.py -q`
- `npm test -- --run src/workspace.compare.phase3.test.tsx src/optimization.manual-lab.test.tsx src/run-detail.audit.test.tsx src/App.phase4.test.tsx`
- `npm run build`

At the time this README was updated, the known result was:

- backend regression tests passing for creation, real backtest contracts, cleanup, optimization lab flows, and trade audit flows
- frontend targeted Phase 3 and Phase 4 route and UI contract tests passing for the workspace compare cockpit, optimization manual lab, and interactive run detail audit
- frontend quick-start launcher using the repo-local runtime and self-healing the Node toolchain when needed

## Key API Behaviors

- `GET /workspace/overview` returns the workspace contract; `?include_cleanup_audit=1` also returns `last_cleanup_count`.
- `POST /strategy-creation-sessions/{id}/messages` is revision-aware and rebuilds the template-backed confirmation draft.
- `PATCH /strategy-creation-sessions/{id}/confirmation` persists manual overrides and can switch `strategy_type`.
- `POST /strategy-creation-sessions/{id}/materialize` requires an `idempotency_key`.
- `POST /strategies/{id}/backtest-runs/preview` returns effective dates, coverage warnings, and Blind Test Zone metadata.
- `POST /strategies/{id}/backtest-runs` requires an `idempotency_key` and executes a real in-process backtest against local snapshot tables.
- `GET /backtest-runs/{id}/detail` returns cockpit fields plus `trade_audit_items` when available.
- `GET /backtest-runs/{id}/trades/{tradeId}/audit` returns the episode-level audit payload for a single trade.
- `GET /backtest-runs/{id}/trades` returns paginated trade-journal rows with IS/OOS segmentation.
- `POST /backtest-runs/{id}/clone` requires an `idempotency_key` and carries forward execution configuration and source-run lineage.
- `POST /optimization-jobs/{id}/candidates` accepts a full `parameter_snapshot` and returns the updated optimization job detail.
- `DELETE /optimization-jobs/{job_id}/candidates/{trial_id}` removes a candidate from the manual lab.
- `POST /optimization-jobs/{id}/candidates/{trial_id}/promote` accepts an optional `comment` that becomes the revision note on the new parameter version.
- blocked writes return a structured `409` with `blocking_code`, `blocking_target`, and `next_action`.

## Current Limitations

This slice still has important scope limits:

- Yahoo is the only market-data provider.
- Market data is daily-bar only.
- The execution path runs in-process rather than on a distributed worker queue.
- Fractional shares are assumed for portfolio math.
- The compare cockpit only compares the latest completed formal backtest for each strategy's current `parameter_version`; arbitrary historical run comparison is not shipped yet.
- `legacy_demo_run` records remain viewable for audit continuity, but the UI now marks them `Not for Execution`.
- Ticker alias chains and delisted-symbol resolution are not implemented.
- Authentication and authorization are not implemented.
- Real-time push updates are not implemented.
- End-to-end browser automation is not bundled in the repo.

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md)
