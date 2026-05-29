# Local Artifact Cleanup

This repository keeps local runtime files under `.tmp/`, `artifacts/`, and `output/logs/`.
Use the repo-owned cleanup helper to prevent long-running repair, test, and evidence jobs
from filling the system disk.

## Command

Dry-run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\codex-clean-stale-local-artifacts.ps1 -Json
```

The default dry-run is a fast free-space guard. When free space is already above
`-MinFreeGB`, it records `scanSkippedReason = free-space-above-threshold` and does not
walk large artifact trees.

Full dry-run scan:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\codex-clean-stale-local-artifacts.ps1 -ForceScan -Json
```

Apply expired safe cleanup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\codex-clean-stale-local-artifacts.ps1 -Apply -PruneExpired -MinFreeGB 200 -Json
```

The helper writes its report to `harness/reports/smoke/latest-local-artifact-cleanup.json`.
`-Json` prints the summary only; pass `-FullJson` when the terminal needs the full
planned/removed/skipped detail. The full detail is always written to the report file.
The summary includes `elapsedSeconds` so scheduled runs and review passes can compare
cleanup overhead without wrapping the script in a separate timer. For recovery-only
runs, pass `-OnlyRelativePathPrefix artifacts/recovery` and a task report path such as
`output/logs/grit-coder/<task-slug>/recovery-cleanup-summary.json`.

## Safety Contract

- Deletes only paths under the current repository root.
- Skips Git-tracked files and directories.
- Skips reparse points.
- Skips current root runtime databases:
  `.grit_backtest_platform.sqlite3`,
  `.grit_backtest_platform_market_data.sqlite3`,
  and their WAL/SHM companions.
- Also protects the active `GRIT_BACKTEST_DB` path and its derived
  `<stem>_market_data.sqlite3` companion, including WAL/SHM files.
- Refuses to scan or delete when `GRIT_BACKTEST_DB` or its companion resolves under
  `artifacts/recovery`; recovery archives are not a valid active runtime DB location.
- Keeps PIT bulk cache unless `-IncludePitBulkCache` is explicitly passed.
- Keeps the newest `artifacts/recovery` entries, the newest full DB backup pair, the
  newest targeted PIT preimage, and manifest/source evidence. Superseded `l1-*` full
  DB payloads are eligible for cleanup only after those protection rules are applied.
- Defaults to dry-run; deletion requires `-Apply`.
- Uses a single cached `git ls-files` snapshot for tracking checks instead of one Git
  command per cleanup candidate.
- Skips expensive skipped-candidate size scans by default. Use `-DetailedSkippedSizes`
  only when auditing skipped entries.
- When `-OnlyRelativePathPrefix` is supplied, scopes candidate enumeration to matching
  cleanup roots before expensive artifact-tree walks.

## Default Retention

| Area | Default |
| --- | --- |
| `.tmp` known stale repair/test/benchmark dirs | 7 days |
| `.tmp/pytest-runtime/tmp-paths` | 2 days |
| `output/logs/grit-coder/codex-logs-archive-*` | 21 days |
| Heavy root `artifacts` evidence/backup files | 21 days |
| `artifacts/recovery` | keep newest 5 and expire older than 14 days |
| `.tmp/pit-bulk-cache` | report only unless explicitly included |

If a cleanup report has `failedCount > 0`, treat it as non-fatal for product behavior but
investigate before claiming the cleanup lane is fully healthy.
