# UI Artifact Trace Matrix

- Route: `http://127.0.0.1:4173/#/snapshots`
- Scope: 股票/指数 tab `#/snapshots`
- Date: `2026-05-14`
- Design source:
  - `DESIGN.md` snapshots route contract
  - `AGENTS.md` snapshots route rules for live runtime rows and approved information architecture
- Runtime modules:
  - `web/src/page-sections/snapshots-equity.tsx`
  - `web/src/pages/snapshots-page.css`
- Target module:
  - `#equity-runtime-snapshot-list`

## Trace

| Requirement | Selector / module | Implementation note | Verification |
| --- | --- | --- | --- |
| 原始快照清单调整至页面最下方 | `#equity-runtime-snapshot-list` in `snapshots-equity.tsx` | 提取为 `rawSnapshotLedgerSection`，渲染到 `.evidence-grid` 之后 | Live DOM geometry: `rawTop 2363.78 > evidenceTop 1380.28` |
| 卡片副标题解释快照用途与当前数据现状 | `.dense-row__copy p` in `snapshots-equity.tsx` | 新增 `rawSnapshotSubtitle()`，按快照类型生成“用途 + 当前覆盖/状态”中文金融话术 | Live text sample: `维护复权、拆并与分红校准 · 当前 806 / 1,482 覆盖，复权链路仍待补齐。` |
| 卡片主标题保持易读，技术 ID 仍可见 | `.dense-row__copy strong` + `.dense-row__identifier` | 主标题切到中文快照名，ID 下沉为单独技术标识 | Live DOM + screenshot |
| 不破坏原有治理字段 | `.dense-meta-grid`, `.dense-row__footer` | 保留最新刷新、关键校验、可点亮因子、下一步、来源和跳转动作 | `src/snapshots.page.test.tsx` targeted green |

## Evidence

- Targeted test: `cmd /c npx vitest run src/snapshots.page.test.tsx`
- Type check: `cmd /c npx tsc --noEmit`
- Live check:
  - Cache-busting URL: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
  - Browser: local Edge via Playwright channel
