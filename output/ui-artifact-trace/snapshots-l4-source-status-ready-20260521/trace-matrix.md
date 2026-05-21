# Snapshots L4 Source Status Trace Matrix

Route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`

Design / requirement source:
- User requirement: only partially available or blocked L data sources have standalone drilldown modules.
- User question: when L4 data is complete, it must not remain partially available because of an upstream diagnostic dependency.

| Gate | Requirement | Selector / owner | Acceptance |
| --- | --- | --- | --- |
| L4 card semantics | L4 health follows only L4 data-source completeness. Complete macro rates and option skew mean L4 is ready. | `.snapshots-ops-health-card[data-layer-id="l4"]`, `buildLayerCards` | PASS only if L4 card has ready class/status when `ds-macro-rates` and `ds-option-skew` are ready. |
| Dependency separation | L1 sample-pool dependency may be shown as diagnostic impact, but it must not drive L4 source health. | L4 mini row / impact summary copy | PASS only if L1 dependency text is explanatory and does not create a warning status/action for L4. |
| Drilldown modules | Standalone source modules render only for non-ready or blocked data sources. | `.snapshots-ops-drill-card[data-source-id]`, `buildDataSourceDrillModules` | PASS only if current fixture renders `ds-price` and `ds-corporate-actions`; no `ds-macro-rates` or `ds-option-skew` modules. |
| L4 click behavior | Clicking a ready L4 card anchors evidence rows instead of source-drill modules. | L4 card button, `handleViewEvidence` | PASS only if L4 evidence row is highlighted and source module count remains unchanged. |
| Mobile geometry | Corrected card/module set must not overflow mobile viewport. | `390x844` screenshot / scroll metrics | PASS only if document and main scroll widths stay within viewport tolerance. |

Verification result:
- PASS: API reported `ds-macro-rates=READY` and `ds-option-skew=READY`.
- PASS: L4 rendered as `snapshots-ops-health-card--ready` with `已就绪`.
- PASS: source drill modules were exactly `ds-price` and `ds-corporate-actions`; no L4 source module rendered.
- PASS: clicking L4 highlighted the L4 evidence rows for `ds-macro-rates` and `ds-option-skew`.
- PASS: mobile viewport `390x844` reported `scrollWidth=390`.

Evidence targets:
- `output/ui-artifact-trace/snapshots-l4-source-status-ready-20260521/live-desktop.png`
- `output/ui-artifact-trace/snapshots-l4-source-status-ready-20260521/live-l4-ready-evidence.png`
- `output/ui-artifact-trace/snapshots-l4-source-status-ready-20260521/live-mobile.png`
- `output/ui-artifact-trace/snapshots-l4-source-status-ready-20260521/metrics.json`
