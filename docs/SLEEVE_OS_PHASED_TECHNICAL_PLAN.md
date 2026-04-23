# Sleeve OS Phased Technical Plan

## Goal

Ship `Phase 1: Compose First` on top of the current Grit Strategy Lab runtime without forking the product shell or inventing a second routing system.

Phase 1 must add:

- a persisted `组合 (composition)` object that can be previewed, saved, reopened, and audited
- a unified `资产库` read model named `leg inventory`
- minimal persisted definitions for `资产腿` and `现金腿`
- projection-only `策略腿` entries sourced from existing strategy, parameter-version, and eligible-run data
- a new `组合` navigation group with `组合仪表板` and `资产库`
- a new `组合工作台` and `组合详情页`
- a `债券/固定收益` tab inside the existing `#/snapshots` route

Phase 1 must not add:

- a unified `sleeve registry`
- a persistent `strategy_leg` truth table
- a second snapshot route
- a separate product shell for compositions
- Global Allocation execution flows
- factor-sidecar execution flows

## Locked Decisions

- Frontend copy hides the word `Sleeve`.
- Frontend nouns are fixed to `组合` / `策略腿` / `资产腿` / `现金腿`.
- `策略腿` is a projection read model only.
- `资产腿` and `现金腿` use minimal persistence in phase 1.
- `组合` is the only new first-class persisted business object in phase 1.
- `#/snapshots` stays the only snapshot page route. Bond governance is a tabbed extension of the existing page.
- Existing routes for `workspace -> creation -> backtest -> run detail -> optimization` remain valid and visually consistent.

## Current Baseline

As of the current worktree:

- backend contracts are centered in [src/grit_backtest_platform/models.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/models.py)
- backend routes are centered in [src/grit_backtest_platform/api.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/api.py)
- backend persistence is centered in [src/grit_backtest_platform/_storage_restored.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/_storage_restored.py)
- frontend shared contracts are centered in [web/src/types.ts](/C:/Fin/Grit_Strategy_Lab/web/src/types.ts)
- frontend routing is centered in [web/src/lib/appRouteContext.tsx](/C:/Fin/Grit_Strategy_Lab/web/src/lib/appRouteContext.tsx)
- frontend runtime selection is centered in [web/src/app-runtime-cn.tsx](/C:/Fin/Grit_Strategy_Lab/web/src/app-runtime-cn.tsx)
- shell labels are centered in [web/src/shell-route-meta-cn.ts](/C:/Fin/Grit_Strategy_Lab/web/src/shell-route-meta-cn.ts)

The current public API does not yet expose composition or leg resources. The current storage layer does not yet persist composition or leg tables.

## Scope Split

### Phase 1

Deliverable and implementation-complete:

- composition persistence, preview, detail, and list surfaces
- projection-based strategy leg inventory
- minimal asset-leg and cash-leg creation
- composition dashboard, asset library, workbench, and detail pages
- bond/fixed-income snapshot governance tab
- route wiring, tests, and docs closure

### Phase 2

Reserve boundaries only:

- asset-level allocation products
- risk parity and generalized weight allocator promotion
- rebalance policy expansion beyond phase 1 summaries
- institution-oriented allocation templates

Phase 2 must build on the same return-stream allocator contract created in phase 1.

### Phase 3

Reserve boundaries only:

- factor universe, factor scoring, and cross-sectional ranking
- parallel compute backends for factor-heavy workloads
- factor-specific storage partitions and intermediate materialization layers

## Approved UI Artifact Lane

Implementation must follow the approved design deliverables:

- [compose-first-design-spec.md](C:/Users/TradeAdmin/.gstack/projects/grit-strategy-lab/designs/compose-first-2026-04-21/compose-first-design-spec.md)
- [compose-first-approved-preview.html](C:/Users/TradeAdmin/.gstack/projects/grit-strategy-lab/designs/compose-first-2026-04-21/compose-first-approved-preview.html)
- [DESIGN.md](/C:/Fin/Grit_Strategy_Lab/DESIGN.md)

The design lane is frozen on `Direction A: 操作台优先`.

## Contract Truth And Mirror Rules

### Backend truth

- request and response types: [src/grit_backtest_platform/models.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/models.py)
- route signatures: [src/grit_backtest_platform/api.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/api.py)
- service semantics: [src/grit_backtest_platform/_service_rebuilt.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/_service_rebuilt.py)
- storage semantics: [src/grit_backtest_platform/_storage_restored.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/_storage_restored.py)

### Frontend mirror

- mirrored API types: [web/src/types.ts](/C:/Fin/Grit_Strategy_Lab/web/src/types.ts)
- route parser: [web/src/lib/appRouteContext.tsx](/C:/Fin/Grit_Strategy_Lab/web/src/lib/appRouteContext.tsx)
- runtime page mapping: [web/src/app-runtime-cn.tsx](/C:/Fin/Grit_Strategy_Lab/web/src/app-runtime-cn.tsx)
- shell labels: [web/src/shell-route-meta-cn.ts](/C:/Fin/Grit_Strategy_Lab/web/src/shell-route-meta-cn.ts)

### Phase 1 mirror rule

- Worker 1 owns any schema or response-shape change in both backend truth and frontend mirror.
- Workers 2, 3, and 4 consume the Worker 1 contract and must not invent local type forks.
- If a frontend worker needs a contract change after Wave 1, the change returns to main control for rescoping.

## Phase 1 Domain Model

### Strategy leg projection

`策略腿` is a read-model entry produced from:

- `strategies`
- current or selected `strategy_parameter_versions`
- latest eligible completed run summary

It is not persisted into a new `strategy_leg_definitions` table in phase 1.

Projection requirements:

- stable inventory row id derived from strategy id plus parameter-version id
- strategy name, version label, latest eligible run, status, reference count, and orphan/new-version signals
- action semantics limited to `查看策略`, `加入工作台`, and related projection actions

### Asset leg persistence

`资产腿` is minimally persisted with:

- identity and display fields
- source snapshot reference
- asset classification
- rebalance and freeze metadata needed by composition assembly

No version tree is required in phase 1.

### Cash leg persistence

`现金腿` is minimally persisted with:

- identity and display fields
- rule summary
- carry or buffer inputs needed by preview logic

No version tree is required in phase 1.

### Composition persistence

`组合` is the phase 1 core object and must support:

- save as draft
- save as named composition
- reopen by id
- stable detail report
- source freeze evidence
- rebalance configuration
- maintenance-cost summary

## Storage Plan

Worker 1 will extend [src/grit_backtest_platform/_storage_restored.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/_storage_restored.py) with the following tables.

### `asset_leg_definitions`

Columns:

- `id`
- `name`
- `symbol`
- `asset_kind`
- `source_snapshot_id`
- `source_provider`
- `freeze_mode`
- `summary_json`
- `status`
- `created_at`
- `updated_at`

### `cash_leg_definitions`

Columns:

- `id`
- `name`
- `cash_rule_kind`
- `buffer_bps`
- `yield_source`
- `freeze_mode`
- `summary_json`
- `status`
- `created_at`
- `updated_at`

### `compositions`

Columns:

- `id`
- `name`
- `description`
- `status`
- `benchmark_definition_json`
- `rebalance_frequency`
- `cost_policy_json`
- `summary_json`
- `analysis_json`
- `created_at`
- `updated_at`

### `composition_legs`

Columns:

- `id`
- `composition_id`
- `leg_kind`
- `source_ref_id`
- `source_ref_type`
- `display_name`
- `weight_pct`
- `weight_locked`
- `ordering`
- `config_json`
- `created_at`
- `updated_at`

### `composition_source_freezes`

Columns:

- `id`
- `composition_id`
- `leg_id`
- `freeze_ref_type`
- `freeze_ref_id`
- `freeze_hash`
- `snapshot_json`
- `created_at`

### Explicit non-goal

Do not add:

- `strategy_leg_definitions`
- `sleeve_registry`
- a generalized leg version graph

## Frozen API Surface

Phase 1 freezes the following additions and extensions.

### New endpoints

- `GET /leg-inventory`
- `POST /asset-legs`
- `POST /cash-legs`
- `GET /compositions`
- `GET /compositions/{id}`
- `POST /compositions/preview`
- `POST /compositions`
- `PATCH /compositions/{id}`

### Existing endpoint extension

- `GET /data-snapshots/overview`
  - extend response with `bond_fixed_income`

### Existing semantics that must not regress

- `GET /workspace/overview`
- `GET /backtest-runs*`
- `GET /optimization-jobs*`
- `GET /strategies*`

Existing fields may be extended additively where safe, but current field meaning must remain unchanged.

## Contract Shapes

### `GET /leg-inventory`

Returns:

- grouped counts for `all`, `strategy`, `asset`, `cash`
- filter metadata for status and optional attribute tags
- list rows with normalized fields:
  - `id`
  - `leg_type`
  - `name`
  - `version_label`
  - `proof_label`
  - `reference_count`
  - `reference_summary`
  - `status`
  - `status_label`
  - `has_new_version`
  - `is_orphan`
  - `attribute_tags`
  - `allowed_actions`

Projection mapping:

- strategy rows resolve from strategy plus parameter-version plus eligible run
- asset rows resolve from `asset_leg_definitions`
- cash rows resolve from `cash_leg_definitions`

### `POST /asset-legs`

Accepts a minimal persisted definition:

- `name`
- `symbol`
- `asset_kind`
- `source_snapshot_id`
- `freeze_mode`
- optional `notes`

Returns:

- created asset leg row
- `allowed_actions`
- optional `eligibility_summary`

### `POST /cash-legs`

Accepts:

- `name`
- `cash_rule_kind`
- `buffer_bps`
- optional `yield_source`
- `freeze_mode`
- optional `notes`

Returns:

- created cash leg row
- `allowed_actions`

### `GET /compositions`

Returns list rows for dashboard and table use:

- `id`
- `name`
- `status`
- `composition_score`
- `leg_count`
- `rebalance_frequency`
- `benchmark_label`
- `annualized_return`
- `max_drawdown`
- `updated_at`
- `latest_activity_label`
- `allowed_actions`

### `POST /compositions/preview`

Accepts a draft structure without persistence.

Payload responsibilities:

- composition-level name and optional benchmark definition
- rebalance frequency
- maintenance cost policy
- legs with `leg_kind`, source refs, weight, and lock state

Returns preview-only analytics:

- validated weight summary
- normalized leg rows for UI echo
- returns preview series
- benchmark series
- spread series
- correlation preview matrix
- risk-contribution preview
- maintenance-cost summary
- composition score and score factors
- warnings and advisories

### `POST /compositions`

Accepts the same assembly payload plus save metadata.

Persists:

- composition
- composition legs
- source freezes

Returns:

- composition detail payload
- generated source freeze evidence

### `PATCH /compositions/{id}`

Supports:

- rename and description updates
- rebalance frequency update
- benchmark update
- maintenance policy update
- composition leg reorder and weight update
- save-as-draft or activate transitions

### `GET /compositions/{id}`

Returns detail payload for the approved `组合详情页`:

- hero summary
- 7 KPI cards
- returns flow and spread views
- rebalance point markers
- risk and attribution view
- correlation matrix
- source evidence rail
- maintenance and cost summary
- scenario module summary
- deep-link actions

### `GET /data-snapshots/overview` extension

Add `bond_fixed_income` with:

- `global_pulse`
- `pillar_groups`
- `curve_preview`
- `audit_matrix`
- `raw_registry`
- `scheduler`
- `selected_source_summary`
- `system_diagnostics`

No second snapshot endpoint is allowed.

## Preview Logic Requirements

Worker 1 preview logic must compute, or synthesize deterministically for the current seed data, the following outputs:

- total weight and residual checks
- per-leg normalized contribution rows
- returns-flow preview
- benchmark comparison preview
- spread or excess-return preview
- correlation matrix
- maintenance cost summary
- rebalance frequency summary
- composition score factors

Phase 1 preview may be lightweight and synthetic where the current dataset does not yet support production-grade composition analytics, but the payload shape must already match the intended runtime contract.

## Frozen Frontend Route Surface

### New navigation groups

- `组合`
  - `组合仪表板`
  - `资产库`
- `策略`
  - `策略工作台`
  - `新建策略`
  - `回测列表`
  - `优化实验室`
  - `数据快照`

### New phase 1 routes

- `#/compositions`
- `#/legs`
- `#/compositions/workbench`
- `#/compositions/:id`

### Existing routes retained

- `#/workspace` remains the current strategy workbench page and is labeled `策略工作台`
- `#/creation/new`
- `#/runs`
- `#/optimization-jobs`
- `#/snapshots`

## Worker Ownership

### Main controller

Owns:

- this document
- final route wiring in [web/src/lib/appRouteContext.tsx](/C:/Fin/Grit_Strategy_Lab/web/src/lib/appRouteContext.tsx)
- runtime page mapping in [web/src/app-runtime-cn.tsx](/C:/Fin/Grit_Strategy_Lab/web/src/app-runtime-cn.tsx)
- shell labels in [web/src/shell-route-meta-cn.ts](/C:/Fin/Grit_Strategy_Lab/web/src/shell-route-meta-cn.ts)
- closure updates to [TECHNICAL.md](/C:/Fin/Grit_Strategy_Lab/TECHNICAL.md), [ARCHITECTURE.md](/C:/Fin/Grit_Strategy_Lab/ARCHITECTURE.md), and [CHANGELOG.md](/C:/Fin/Grit_Strategy_Lab/CHANGELOG.md)

Main controller focused checks:

- document self-consistency
- route and shell integration
- final regression scripts

Main controller rejection criteria:

- phase 1 doc reintroduces persistent strategy legs
- route wiring creates a parallel router
- docs fail to reflect the merged truth

### Worker 1: backend compositions

Branch target:

- `codex/phase1-backend-compositions`

Owns:

- [src/grit_backtest_platform/models.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/models.py)
- [src/grit_backtest_platform/api.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/api.py)
- [src/grit_backtest_platform/_service_rebuilt.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/_service_rebuilt.py)
- [src/grit_backtest_platform/_storage_restored.py](/C:/Fin/Grit_Strategy_Lab/src/grit_backtest_platform/_storage_restored.py)
- [web/src/types.ts](/C:/Fin/Grit_Strategy_Lab/web/src/types.ts)
- backend tests required for the new contract

Focused tests:

- `python -m pytest tests/test_composition_api.py tests/test_backend_api.py -q`
- `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1`

Hard constraints:

- no `strategy_leg_definitions` table
- no semantic break to current workspace, backtest, strategy, or optimization payloads
- exclusive ownership of `web/src/types.ts`

Rejection criteria:

- contract mismatch between backend and `web/src/types.ts`
- strategy legs persisted as a new truth table
- snapshot extension implemented as a second API

### Worker 2: composition dashboard and asset library

Branch target:

- `codex/phase1-dashboard-leg-inventory`

Owns:

- `web/src/pages/composition-dashboard-page.tsx`
- `web/src/pages/leg-inventory-page.tsx`
- `web/src/components/composition-dashboard/`
- `web/src/components/legs/`
- `web/src/composition.dashboard.test.tsx`
- `web/src/leg.inventory.test.tsx`

Focused tests:

- `npx vitest run src/composition.dashboard.test.tsx src/leg.inventory.test.tsx src/app.routes.foundation.test.tsx`

Hard constraints:

- no edits to `web/src/types.ts`
- no runtime route wiring
- strategy leg actions stay projection-based

Rejection criteria:

- local ad hoc type forks
- strategy leg create drawer or persistent strategy-leg record flow
- UI drift away from approved compose spec

### Worker 3: composition workbench and detail

Branch target:

- `codex/phase1-workbench-detail`

Owns:

- `web/src/pages/composition-workbench-page.tsx`
- `web/src/pages/composition-detail-page.tsx`
- `web/src/components/composition-workbench/`
- `web/src/components/composition-detail/`
- `web/src/composition.workbench.test.tsx`
- `web/src/composition.detail.test.tsx`

Focused tests:

- `npx vitest run src/composition.workbench.test.tsx src/composition.detail.test.tsx`

Hard constraints:

- no shell or route-parser edits
- do not skin the existing run-detail page as a shortcut implementation
- keep chart minimum heights, matrix minimum cells, and sticky save zone aligned with the approved spec

Rejection criteria:

- route or shell edits outside ownership
- direct reuse of the old run-detail as the new detail implementation
- unstable chart or matrix layout below design minimums

### Worker 4: bond snapshots tab

Branch target:

- `codex/phase1-bond-snapshots-tab`

Owns:

- [web/src/pages/snapshots-page.tsx](/C:/Fin/Grit_Strategy_Lab/web/src/pages/snapshots-page.tsx)
- `web/src/page-sections/snapshots-bond-fixed-income.tsx`
- optional local CSS or helper files for the new snapshot section
- [web/src/snapshots.page.test.tsx](/C:/Fin/Grit_Strategy_Lab/web/src/snapshots.page.test.tsx)

Focused tests:

- `npx vitest run src/snapshots.page.test.tsx`

Hard constraints:

- no new snapshot route
- no new snapshot API
- user-facing copy stays Chinese-first, with English only as term parentheses

Rejection criteria:

- second snapshot page or second snapshot API invention
- untranslated copy
- design drift against the approved bond snapshot spec

### Explorer reviewer

Reviewer responsibilities:

- review Worker 1 after Wave 1 for contract and storage correctness
- review Workers 2, 3, and 4 after Wave 2 for design and ownership correctness

Reviewer must refuse on:

- scope drift
- contract mismatch
- design drift
- ownership overlap

## Merge Order

### Wave 0

- main controller writes this phase plan
- API, storage, route, and ownership boundaries become frozen for workers

### Wave 1

- run Worker 1 only
- treat Worker 1 output as the rebase baseline for frontend workers

### Wave 2

- run Worker 2, Worker 3, and Worker 4 in parallel
- all three frontend workers consume the Worker 1 contract and must not reshape it

### Wave 3

- main controller integrates route parsing, runtime page selection, and shell metadata
- reviewer performs final pass
- main controller runs fixed validation scripts
- main controller updates docs and changelog

## Focused Validation Plan

### Wave-local

- Worker 1 runs backend-focused tests only
- Worker 2, 3, and 4 run only their narrow Vitest slices

### Final validation

- `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1`
- `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1`
- `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes`

### Baseline note

The repo currently has known baseline TypeScript and fixture-backed smoke constraints. Final closeout must distinguish:

- new failures introduced by this phase
- already-known baseline failures
- fixture-blocked flows that cannot be honestly claimed as passed

## Rejection Criteria

Reject a slice if any of the following are true:

- it persists strategy legs as first-class truth
- it introduces a second routing system
- it introduces a second snapshot page or snapshot API
- it modifies existing workspace, backtest, or optimization semantics without explicit approval
- it changes files outside assigned ownership without rescoping
- it diverges from the approved `Compose First` design package
- it ships without the focused tests for the slice

## Expected Documentation Delta After Merge

### `TECHNICAL.md`

Must be updated to include:

- new phase 1 composition and leg truth sources
- new route surface for compositions and asset library
- fixed test entry points for composition slices
- bond snapshot tab truth and API note

### `ARCHITECTURE.md`

Must be updated to include:

- minimal asset-leg and cash-leg persistence boundary
- composition storage and source-freeze boundary
- strategy-leg projection-only rule
- snapshot overview bond extension ownership

### `CHANGELOG.md`

Expected `Unreleased` categories:

- `Added`
  - composition dashboard, asset library, workbench, and detail surfaces
  - composition persistence and preview endpoints
  - bond fixed-income snapshot governance tab
- `Changed`
  - snapshot overview contract extended with bond governance segment
  - shell navigation updated to separate `组合` and `策略`
- `Fixed`
  - any layout or contract regressions discovered during integration

## Durable Memory Candidate

If the implementation ships and validation is complete, capture one short durable memory entry summarizing:

- phase 1 rule that strategy legs remain projection-only
- composition is the first-class persisted object
- bond governance extends the existing snapshot overview instead of creating a second snapshot API
