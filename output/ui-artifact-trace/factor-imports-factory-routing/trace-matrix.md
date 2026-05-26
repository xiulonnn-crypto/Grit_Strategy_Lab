# Factor Imports to Factory Review Queue Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<timestamp>#/factors/factory`
- User report: public factor import review submission says it entered review, but Factor Factory showed no data.
- Design/source contracts: `DESIGN.md`, `AGENTS.md` factor pipeline rules, and the public factor import review boundary `REVIEW_BEFORE_QUARANTINE`.
- Runtime evidence folder: `output/logs/grit-coder/factor-imports-factory-routing/`

## Acceptance Matrix

| Requirement | Selector / Surface | Evidence | Status |
| --- | --- | --- | --- |
| Submitted external factor imports are visible on Factor Factory before B3 quarantine. | `[data-factory-section="external-imports"]` | Live DOM contained `extimp_6ca290fc30be` and four submitted imports. | PASS |
| The UI must not imply direct publication or B3 completion. | External import cards | Cards show `已送入复核` and `尚未进入 B3 检疫`; API reports `direct_publish_allowed=false`. | PASS |
| The D2 handoff remains explicit. | External import card action row | Cards show `等待 D2 复核 / 复核通过后送入检疫`. | PASS |
| Manifest/risk evidence remains visible. | External import card manifest/risk rows | Cards show `manifest 0 行 / 9 列 · SOURCE_MANIFEST_READY` and `原始文件尚未物化`. | PASS |
| Desktop layout preserves Factory module order. | Full page screenshot | `factory-external-import-queue.png` shows the queue above B4 publish and B1/B2/B3 workbench. | PASS |
| Mobile layout avoids horizontal overflow. | 390px viewport screenshot | `factory-external-import-queue-mobile.png`; measured `scrollWidth=308`, `clientWidth=308`. | PASS |
| External imports are not silently written into B3 quarantine. | DB/API check | `factor_quarantine_candidates.source_mining_job_id LIKE 'extimp_%'` returned `0`. | PASS |

## Screenshots

- Desktop: `output/logs/grit-coder/factor-imports-factory-routing/factory-external-import-queue.png`
- Mobile: `output/logs/grit-coder/factor-imports-factory-routing/factory-external-import-queue-mobile.png`

## Approved Deviations

- External imports are shown as a distinct pre-D2 review queue instead of being inserted into `factor_quarantine_candidates`. This is intentional because the submitted job still has review risks such as `SOURCE_FILE_NOT_MATERIALIZED`, and D2 quarantine/manual confirmation must remain a later step.
