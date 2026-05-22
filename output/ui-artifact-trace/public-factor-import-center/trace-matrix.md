# Public Factor Import Center UI Trace Matrix

Task slug: `public-factor-import-center`
Route: `http://127.0.0.1:4173/?v=<timestamp>#/factors/imports`
Design-locked surface: page body, mobile body, and the two page-local modals.
Shared shell scope: production shell is kept as the repository-wide shell; exact sidebar branding/navigation from the standalone design file is recorded as an approved deviation to avoid changing all routes.

## Design Sources

- `designs/2026-05-21-public-factor-import-center/spec.html`
- `designs/2026-05-21-public-factor-import-center/spec.md`
- `designs/2026-05-21-public-factor-import-center/spec.png`
- `designs/2026-05-21-public-factor-import-center/.assets/spec-mobile.png`
- `designs/2026-05-21-public-factor-import-center/.assets/spec-modal-create-precheck.png`
- `designs/2026-05-21-public-factor-import-center/.assets/spec-modal-local-file.png`

## Viewports And Evidence

| viewport | final screenshot | result |
| --- | --- | --- |
| Desktop `1440x1100` | `output/ui-artifact-trace/public-factor-import-center/live-desktop.png` | PASS. Main body starts at `x=266`, hero width is `1144px`, no global horizontal overflow, flow spans the center/right columns, and candidate plus mapping modules share `x=602` and `width=476`. |
| Mobile `390x980` | `output/ui-artifact-trace/public-factor-import-center/live-mobile.png` | PASS. Hero, KPI cards, source catalog, flow, candidates, mapping, and manifest stack without document overflow; wide flow/table/mapping content is contained inside local horizontal scroll regions. |
| Create precheck modal | `output/ui-artifact-trace/public-factor-import-center/live-modal-create-precheck.png` | PASS. Modal is centered, has header/body/footer structure, source/dataset/frequency/boundary fields, boundary cards, evidence output, close, cancel, draft, and primary precheck action. |
| Local file modal | `output/ui-artifact-trace/public-factor-import-center/live-modal-local-file.png` | PASS. Modal is centered, shows three template cards, upload drop zone, upload validation checklist, close, cancel, draft, and primary parse/manifest action. |

## Acceptance Matrix

| id | requirement | selector_or_file | final evidence | status |
| --- | --- | --- | --- | --- |
| PFIC-01 | Remove the top breadcrumb/time copy from the approved design artifact. | `.pfic-page` | Final screenshot has no stale breadcrumb/time strip above the hero. | PASS |
| PFIC-02 | Show the source-ready workflow: import file first, then new precheck, then semantic mapping and review. | `.pfic-flow-panel` | Final screenshot shows the five horizontal steps: source prepare, get/upload, new precheck, semantic mapping, send to review. | PASS |
| PFIC-03 | `导入本地文件` opens a modal with CSV/XLSX template controls. | `.pfic-action-local-file` | Visual proof in `live-modal-local-file.png`; unit coverage in `public-factor-import-center.test.tsx`. | PASS |
| PFIC-04 | `新建预检` opens a modal with source/dataset/frequency and boundary configuration. | `.pfic-action-create-precheck` | Visual proof in `live-modal-create-precheck.png`; unit coverage in `public-factor-import-center.test.tsx`. | PASS |
| PFIC-05 | Candidate data set and semantic mapping modules are vertically stacked and width-aligned. | `.pfic-main-stack`, `.pfic-candidates`, `.pfic-mapping-workbench` | `live-metrics.json`: candidates `x=602 width=476`, mapping `x=602 width=476`. | PASS |
| PFIC-06 | Import flow status and semantic mapping workbench use horizontal tile layouts on desktop. | `.pfic-flow-grid`, `.pfic-mapping-grid` | Desktop screenshot shows five horizontal workflow tiles and five single-row mapping tiles through local horizontal browse; mobile screenshot keeps local horizontal browse without document overflow. | PASS |
| PFIC-07 | Manifest rail exposes hash/count/review gate evidence without publish bypass. | `.pfic-manifest-rail` | Final screenshot shows import job, file evidence, warning boundary, review CTA, manifest download, and artifact open actions; no direct publish CTA. | PASS |
| PFIC-08 | User-facing copy avoids raw enum/API registry labels and engineering placeholders. | visible DOM text | `live-metrics.json` has `rawLeaks: []` on desktop and mobile; page shows `French-Data Library`, `AQR Data Library`, and design dataset names. | PASS |
| PFIC-09 | Route is registered in the shared shell under factor governance and can reload directly. | `#/factors/imports` | Cache-busting route screenshots land on the import center body, and `app.routes.foundation.test.tsx` asserts route reachability. | PASS |
| PFIC-10 | Local file upload and precheck creation call live API contracts when backend is available. | route API adapter | Existing backend import API tests cover job/template/upload/review contracts; route adapter keeps source/dataset normalization for live calls. | PASS |
| PFIC-11 | Approved desktop layout keeps source in the left column, flow across center/right, candidate/mapping in center, and manifest in right column. | `.pfic-layout` | `live-metrics.json`: source `x=266 y=392`, flow `x=602 width=808`, main stack `x=602`, manifest `x=1092 y=654`. | PASS |
| PFIC-12 | Candidate data set module uses the approved product-facing table rows instead of raw registry rows. | `.pfic-candidate-table` | Final screenshot shows four rows: FF5 Daily, Momentum, AQR QMJ Daily, AQR TSMOM Monthly. | PASS |
| PFIC-13 | Semantic mapping workbench uses the approved quarantine wording and status. | `.pfic-mapping-workbench` | Final screenshot and metrics show SMB/HML/RMW visible horizontally with `5 / 5 已映射`; additional mappings remain in the same-row horizontal scroll area. | PASS |
| PFIC-14 | Manifest rail and both modals match approved content architecture. | `.pfic-manifest-rail`, `.pfic-modal` | Final screenshots were opened and visually checked after the final build. | PASS |
| PFIC-15 | Entry A/B, public source cards, dataset filters, draft buttons, and manifest/artifact actions expose working interactive states. | `.pfic-entry-card`, `.pfic-source-card`, `.pfic-segmented`, `.pfic-modal-footer`, `.pfic-manifest-rail` | `interaction-check.json`: entry B changes `aria-pressed`, AQR source becomes the only selected source, `待复核` filters to AQR QMJ, draft closes modal with status, manifest/artifact actions show feedback, and `events=[]`. | PASS |
| PFIC-16 | Semantic mapping cards must follow the selected source/dataset, not only update the dataset heading. | `.pfic-mapping-workbench`, `mappingsByDataset` | `interaction-check.json`: FF5 starts with `SMB`, selecting AQR switches mapping cards to `QMJ/PROF/GROWTH/SAFETY` and removes FF5 `SMB`; unit coverage asserts the same transition. | PASS |

## Approved Deviations

- The shared production shell remains active. The standalone design artifact's sidebar branding/navigation is not copied into the app shell because that shell is shared by all Grit routes; page-body geometry is still aligned against the design at `x=266`.
- Live runtime counters may replace static design numbers when they come from the import-job manifest and are formatted through the page view model.
- XLSX template generation may be server-generated while XLSX upload parsing can remain behind a clear review-gated message if the current dependency set cannot parse binary workbooks without adding a new package.

## Final Gate

- Visual screenshot inspection: PASS.
- Desktop overflow: PASS (`overflowX=0`).
- Mobile overflow: PASS (`overflowX=0`).
- Raw API/enum text leak scan: PASS (`rawLeaks=[]`).
- Capture script: `output/ui-artifact-trace/public-factor-import-center/capture-ui-review.mjs`.
- Interaction script: `output/ui-artifact-trace/public-factor-import-center/check-interactions.mjs`.
- Acceptance matrix: `PASS=16`, `FAIL=0`, `BLOCKED=0`, `NOT_CHECKED=0`.
