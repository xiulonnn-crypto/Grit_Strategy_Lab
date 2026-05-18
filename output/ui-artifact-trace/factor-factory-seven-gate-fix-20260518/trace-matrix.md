# Factor Factory Seven Gate Trace

- URL: http://127.0.0.1:4173/?v=1779099173342#/factors/factory
- Viewport: 1960x1200
- Main screenshot: C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-factory-seven-gate-fix-20260518\factory-seven-gate-main.png
- Modal screenshot: C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-factory-seven-gate-fix-20260518\factory-seven-gate-modal.png

| Gate | Selector | Evidence |
| --- | --- | --- |
| B3 default shows full submitted history | `.factor-factory-result-row:not(.factor-factory-result-row--head)` | 24/24 rows |
| latest completed scoring date selected without pre-filtering | `input[type=date]` | 2026-05-15; header B3 因子检疫因子检疫显示 24/24 |
| submitted factors absent from B2 scoring | `.factor-factory-score-card` | 0 cards; send disabled true |
| L1 publishable factors appear in B4 | `.factor-factory-publish-card` | 4 cards; L1 true |
| fixed-height panels and no horizontal scroll | `[data-factory-section]` | {"panelHeightsOk":true,"horizontalOverflow":false} |
| quarantine detail action stays on one line | `.factor-factory-result-row button` | nowrap true |
| detail modal shows scoring/quarantine report context | `.factor-detail-modal` | {"hasPit":true,"hasPass":true,"rect":{"width":1120,"height":500,"x":420,"y":350}} |
