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

## Working rules for agents

- Preserve existing uncommitted user changes. The worktree is already dirty.
- If you change API payloads or response shapes, keep `src/grit_backtest_platform/models.py` and `web/src/types.ts` aligned.
- If you touch workspace or optimization summary data, also inspect `web/src/lib/workspace-adapters.ts` and the matching dashboard or optimization tests.
- If you touch UI routing or shared shell behavior, stay inside the established runtime boundaries instead of creating a second routing layer.
- Add or update tests for the code you change, especially around optimization jobs, candidate materialization, snapshots, and workspace projections.
- For non-trivial work, recall durable memory before repeating repo-specific decisions; after verified reusable outcomes, record a short durable memory summary or explicitly note why memory was skipped.
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

<!-- cam:codex-agents-guidance:start -->
## Codex Auto Memory

<!-- cam:agents-guidance-version codex-agents-guidance-v1 -->
- Before repeating prior work or repo-specific decisions, recall durable memory first.
- Use progressive disclosure: search -> timeline -> details.
- Prefer retrieval MCP when it is already wired in: search_memories -> timeline_memories -> get_memory_details.
- When using search_memories, pass state: "auto" and limit: 8.
- If the retrieval MCP server is unavailable and the local bridge bundle is installed, fall back to `memory-recall.sh search "<query>"`, then `memory-recall.sh timeline "<ref>"`, then `memory-recall.sh details "<ref>"`.
- If the local bridge bundle is unavailable, fall back to `cam recall search "<query>" --state auto --limit 8`, then `cam recall timeline "<ref>"`, then `cam recall details "<ref>"`.
- After finishing work that should affect durable memory, run `cam sync` or review `cam memory --recent` instead of assuming temporary continuity already updated Markdown memory.
- Use cam memory for inspect/audit surfaces and startup payload review.
- Use cam session only for temporary continuity, not durable memory retrieval.
- Treat archived memory as historical context that does not participate in default startup recall.
- When the local bridge bundle is installed, `post-work-memory-review.sh` combines `cam sync` with `cam memory --recent`.
- Hook assets in this repository are local bridge and fallback helpers, not an official Codex hook surface.
<!-- cam:codex-agents-guidance:end -->
