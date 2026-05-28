# P0 Factor Factory Lineage Trace Matrix

## Contract
- route: `http://127.0.0.1:4173/?v=<timestamp>#/factors/factory`
- design source: no new approved visual artifact; preserve existing B1-B4 Factor Factory layout.
- implementation target: `web/src/pages/factor-factory-page.tsx`
- data source: `GET /factor-factory/overview.batch_lineage`
- screenshots: not required for this contract/execution slice unless live route acceptance is requested after implementation.

## Rows
| Requirement | Selector or Surface | Source Field | Acceptance Gate | Status |
| --- | --- | --- | --- | --- |
| B1 formula total uses canonical batch count | metric card and task row | `batch_lineage.raw_f2_total` / `refined_f2_total` | value is not derived from `top_candidates.length` | PASS |
| B3 pagination total uses canonical quarantine total | quarantine list/page summary | `batch_lineage.quarantine_total` | total remains full batch when page size is 50 | PASS |
| B4 publishable count uses current source job only | publishable section and summary | `batch_lineage.publishable_total` | source mismatch or blocked lineage prevents publish action | PASS |
| Preview is labelled as non-canonical | metric tooltips and internal copy | `batch_lineage.preview_count`, `is_preview=false` | Top50 never appears as batch total | PASS |

## Evidence
- `python scripts\factor_factory_lineage_preflight.py --strict`: PASS; current batch `ffr_20260527_7d79fd8b77`, source job `mine_op_7611f16d5ccea39d`, Raw/Refined/Ledger `10000`, preview `50`, warnings `[]`.
- `.\.venv\Scripts\python.exe -m pytest tests/test_factor_factory_api.py tests/test_factor_quarantine_api.py -q`: PASS, 37 tests.
- `node scripts/run-vitest-fixed.cjs factor.factory.test.tsx`: PASS, 20 tests.
- `.\.venv\Scripts\python.exe -m pytest tests/test_factor_research_api.py tests/test_backend_api.py tests/test_factor_mining_api.py tests/test_factor_factory_api.py tests/test_factor_quarantine_api.py -q`: PASS.
- `node scripts/run-vitest-fixed.cjs factors.phase0.f1.test.tsx factor.model-builder.test.tsx factor.factory.test.tsx app.routes.foundation.test.tsx`: PASS, 105 tests.

## Deviations
- No layout, spacing, color, or navigation changes are planned.
- This trace covers data semantics only; full screenshot parity is out of scope for the approved Contract Skeleton + Execution Core slice.
