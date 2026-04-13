# Harness

`harness/` is the Codex-facing workspace scaffold for repeatable task briefs, committed fixture truth, and smoke reports.

## Layout

```text
harness/
  README.md
  tasks/
    _template.md
    T-001.md
    T-002.md
  acceptance/
    create-backtest-optimize.md
  fixtures/
    seed_workspace/
      seed_workspace.sqlite3
      seed_workspace_market_data.sqlite3
      manifest.json
  reports/
    smoke/
```

## Fixed Entry Points

- `scripts/codex-reset-fixture.ps1`
  - Copies the committed seed workspace into `.tmp/codex-fixture/` by default.
  - Writes `harness/reports/smoke/latest-reset-fixture.txt`.
- `scripts/codex-test-backend.ps1`
  - Runs the fixed backend pytest slice.
  - Writes `harness/reports/smoke/latest-backend.txt`.
- `scripts/codex-test-frontend.ps1`
  - Runs the fixed frontend focused tests.
  - Always emits a global TypeScript report.
  - Optional live acceptance is gated behind `-IncludeLiveAcceptance`.
- `scripts/codex-smoke.ps1`
  - Pure orchestrator: reset fixture, backend fixed entry, frontend fixed entry.
  - Writes `harness/reports/smoke/latest-smoke-summary.md`.

## Fixture Truth

- The committed seed fixture lives in `harness/fixtures/seed_workspace/`.
- `manifest.json` is the only source of truth for live acceptance IDs.
- Runtime copies must stay in `.tmp/codex-fixture/`; do not point smoke flows at root-level `.sqlite3` files.

## Tasks

- Use `tasks/_template.md` for every Codex-scoped implementation brief.
- `T-001.md` and `T-002.md` are concrete examples for harness work, not archival notes.
- Keep tasks limited to the six required fields so scope, verification, and rollback stay visible.

## Reports

- `harness/reports/smoke/` is for generated smoke output only.
- Commit only the directory placeholder; generated `latest-*` files stay ignored.

## Acceptance Doc

- `acceptance/create-backtest-optimize.md` describes the repeatable fixture-backed chain for create -> backtest -> optimize verification.
