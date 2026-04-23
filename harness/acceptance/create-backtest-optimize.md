# Create, Backtest, Optimize Acceptance

## Goal

Verify the fixture-backed main chain with a reproducible local setup.

## Steps

1. Reset the seed fixture:
   - `powershell -ExecutionPolicy Bypass -File .\scripts\codex-reset-fixture.ps1`
2. Point the backend at the staged fixture in the same shell:
   - `$env:GRIT_BACKTEST_DB = (Resolve-Path .\.tmp\codex-fixture\seed_workspace.sqlite3).Path`
3. Start the local app:
   - `powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -NoBrowser`
4. Verify these routes against the staged fixture:
   - `#/workspace`
   - `#/creation/sessions/<manifest.creation_session_id>`
   - `#/strategies/<manifest.strategy_id>`
   - `#/runs/<manifest.run_id>`
   - `#/optimization-jobs/new/config?strategy_id=<manifest.optimization_strategy_id>`
5. Run the live acceptance entry when route wiring needs a fixture-backed check:
   - `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -IncludeLiveAcceptance`

## Expected Outcomes

- Workspace loads with at least one completed run and one completed optimization job.
- The creation session route hydrates from the staged fixture instead of a root runtime database.
- The run detail route resolves the completed seed backtest.
- The optimization config route resolves the seed optimization strategy without hardcoded IDs.
