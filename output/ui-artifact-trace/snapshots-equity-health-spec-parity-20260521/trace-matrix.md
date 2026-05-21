# Snapshots Equity Health Spec Parity Trace Matrix

Status: PASS

## Scope

- Design source: `file:///C:/Fin/Grit_Strategy_Lab/designs/2026-05-20-snapshots-equity-redesign/spec.html`
- User route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- Page body scope: `L1-L4 数据层健康` module only; shared shell/sidebar out of scope.
- Runtime data source: live `GET /data-snapshots/overview` through the running app.
- Desktop viewport: `1600 x 900`
- Mobile viewport: `390 x 844`

## Evidence Files

- Runtime preflight: `output/logs/grit-coder/snapshots-equity-health-spec-parity-20260521/runtime-preflight.json`
- Design desktop screenshot: `design-health-desktop.png`
- Live desktop screenshot before fix: `live-health-before-desktop.png`
- Live desktop screenshot after fix: `live-health-after-desktop.png`
- Live mobile screenshot after fix: `live-health-after-mobile.png`
- Interaction screenshot after fix: `live-health-after-click.png`
- Metrics JSON: `health-spec-parity-metrics.json`

## Acceptance Matrix

| ID | Requirement | Selector / Owner | Gate | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| H1 | Module title/subtitle/chip match the design: `L1-L4 数据层健康`, compact helper text, `2 层部分可用`. | `SnapshotsOperationsConsole`, `.snapshots-ops-health` | Text and chip position match design region; no raw enum or mojibake visible. | PASS | `live-health-after-desktop.png`; `health-spec-parity-metrics.json` title/chip. |
| H2 | Four cards keep design order and titles: `L1 基础行情`, `L2 财务截面`, `L3 分析师与情绪`, `L4 宏观与衍生品`. | `buildLayerCards`, card headings | Exactly four cards in one desktop row; no old `财务基本面` or `情绪与微观结构` copy. | PASS | `health-spec-parity-metrics.json` `liveDesktop.cards[].title`. |
| H3 | Status chips follow design: L1/L4 `部分可用`, L2/L3 `已就绪`; ready cards do not render full green card fills, partial cards do not render full yellow fills. | `LayerCard.statusLabel`, CSS status classes | Card background remains white/subtle; status color lives in chip and border only. | PASS | Computed backgrounds: L1 `rgb(255,255,255)`, L2-L4 `rgb(251,252,253)`. |
| H4 | Primary metrics follow design density: L1 `股票 1266 / 1482 · 债券 7 / 7`, L2 `940 / 1482`, L3 `3 / 3`, L4 `10 / 10`, with live values substitutable where API values differ. | `buildLayerCards`, `.snapshots-ops-metric-line` | Metric text does not include extra company-action or L3 pair coverage in the primary line. | PASS | Live metrics: `股票 1266 / 1482 · 债券 6 / 7`, `940 / 1482`, `3 / 3`, `10 / 10`. |
| H5 | Mini rows follow design content architecture: L1 available/pending repair, L2 field/observation, L3 consensus/short-chain row counts, L4 available/upstream dependency. | `LayerCard.miniRows`, `.snapshots-ops-mini-list` | Two mini rows per card, labels and right-aligned values visible without overlap. | PASS | `live-health-after-desktop.png`; `health-spec-parity-metrics.json` mini rows. |
| H6 | Buttons match design labels and semantics: partial cards drill down to the corresponding L1-L4 module; ready cards reveal evidence or observation rows. | `handleDrill`, `handleViewEvidence`, action buttons | L1 `下钻缺口`, L2 `查看观察项`, L3 `查看证据`, L4 `下钻依赖`; clicking L4 highlights L4 drilldown, not L1. | PASS | `interaction.l4Highlighted=true`, `interaction.l1Highlighted=false`; `live-health-after-click.png`. |
| H7 | Card geometry matches measured design compactness: four cards aligned in height, desktop card height approximately `271px`, no 288px tall card regression. | `.snapshots-ops-health-card`, Playwright bounding boxes | Max card height delta <= 2px; card height within design tolerance; no text overflow. | PASS | Design heights `[271,271,271,271]`; live heights `[271,271,271,271]`. |
| H8 | Responsive state keeps the same content architecture on mobile with no horizontal overflow or button wrapping collision. | CSS media rules | `documentElement.scrollWidth <= viewportWidth + 1`, all four card actions visible. | PASS | `live-health-after-mobile.png`; mobile overflow `390 / 390`. |

## Allowed Live Substitutions

- Counts may come from the active runtime API if they differ from static design examples.
- L1/L4 may remain `部分可用` when runtime readiness reports L1 dependency gaps.
- Ready-card actions may anchor to live evidence rows rather than static design row IDs.

## Deviations

- Runtime values replace static design examples where the API has moved: bond readiness is `6 / 7` instead of design `7 / 7`; L3 row counts are `3,951` and `2,924` instead of design `3,855` and `2,824`.
- Browser console still reports `favicon.ico` 404 from the local preview root; no failed application requests and no `>=400` app/API responses were captured.

## Validation

- Runtime preflight: `quickstartOverall=ready`, `decision=reuse`, backend pid `15448`, frontend pid `27720`, served hash equals dist hash.
- API: `GET /data-snapshots/overview` returned `200`.
- Frontend focused tests: `node scripts/run-vitest-fixed.cjs snapshots.page.test.tsx app.routes.foundation.test.tsx` passed `40` tests.
- Build: `npm.cmd run build` passed.
- Matrix totals: `PASS=8`, `FAIL=0`, `BLOCKED=0`, `NOT_CHECKED=0`.
