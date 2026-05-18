# Factor Factory B1-B4 UI Trace Matrix

- Verified at: 2026-05-18T09:42:14.673Z
- Route: http://127.0.0.1:4173/?v=1779097330301#/factors/factory
- Viewport: 1960 x 1200
- Screenshots: `factory-main-1960.png`, `factory-detail-modal-1960.png`

| Gate | Evidence | Result |
| --- | --- | --- |
| No horizontal scroll | documentElement 1960/1960 | PASS |
| B1/B2/B3 fixed equal height | panel heights: 760, 760, 760 | PASS |
| Internal vertical scroll only | bodies: 因子任务:684/684/auto; 因子打分:3232/632/auto; 因子检疫:861/684/auto | PASS |
| Compact B1 task cards | task card heights: 94, 94, 132 | PASS |
| B2 cards collapsed by default | first score class: factor-factory-score-card is-collapsed | PASS |
| B3 defaults to latest completed scoring date | filters: date=2026-05-15, text=, select=ALL | PASS |
| B3 detail button one line | buttons: 详情:56x38/nowrap; 详情:56x38/nowrap; 详情:56x38/nowrap; 详情:56x38/nowrap; 详情:56x38/nowrap; 详情:56x38/nowrap; 详情:56x38/nowrap; 详情:56x38/nowrap | PASS |
| B3 sorted latest rows | first rows: 2026-05-15 / Rank(Return(Close, 126)) / FAIL / 最大回撤相对基准超过 1.5x。 / 详情 ; 2026-05-15 / Rank(Return(Close, 21)) / FAIL / 最大回撤相对基准超过 1.5x。 / 详情 ; 2026-05-15 / ZScore(Return(Close, 21)) / FAIL / 最大回撤相对基准超过 1.5x。 / 详情 ; 2026-05-15 / ZScore(Return(Close, 126)) / FAIL / 残差化后风格或逻辑相关性仍高于 0.3。；最大回撤相对基准超过 1.5x。；表达式与已有因子逻辑重复。 / 详情 ; 2026-05-15 / Winsorize(Return(Close, 3), 3) / FAIL / 最大回撤相对基准超过 1.5x。 / 详情 | PASS |
| Detail modal has scoring and quarantine report | {"scoring":true,"quarantine":true,"agentD":true} | PASS |

## First 5 quarantine rows

- 2026-05-15 | Rank(Return(Close, 126)) | FAIL | 最大回撤相对基准超过 1.5x。 | 详情
- 2026-05-15 | Rank(Return(Close, 21)) | FAIL | 最大回撤相对基准超过 1.5x。 | 详情
- 2026-05-15 | ZScore(Return(Close, 21)) | FAIL | 最大回撤相对基准超过 1.5x。 | 详情
- 2026-05-15 | ZScore(Return(Close, 126)) | FAIL | 残差化后风格或逻辑相关性仍高于 0.3。；最大回撤相对基准超过 1.5x。；表达式与已有因子逻辑重复。 | 详情
- 2026-05-15 | Winsorize(Return(Close, 3), 3) | FAIL | 最大回撤相对基准超过 1.5x。 | 详情
