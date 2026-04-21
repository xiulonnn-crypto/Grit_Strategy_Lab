# Root Main-Path Temp Archive

This folder keeps temporary root-level Codex and GRIT session artifacts that were moved out of the repository root.

- Archived logs:
  - `.codex-live-backend.err.log`
  - `.codex-live-backend.log`
  - `.codex-opt-backend.err.log`
  - `.codex-opt-backend.log`
  - `.codex-restart-backend.err.log`
  - `.codex-restart-backend.log`
  - `.codex-restart-frontend.err.log`
  - `.codex-restart-frontend.log`
- Archived helper script:
  - `.codex-start-live-backend.ps1`

Notes:
- Moved from the repository root on 2026-04-17.
- No files were deleted during this cleanup.
- Repo-local untracked scratch should still prefer `.tmp/` and `artifacts/` per the current repo conventions.
