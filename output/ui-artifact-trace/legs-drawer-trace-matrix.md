# UI Artifact Trace Matrix - `#/legs` 新建腿抽屉

验收目标: `http://127.0.0.1:4173/#/legs`

UI 稿源:

- Approved HTML: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-first-approved-preview.html`
- Design spec: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-first-design-spec.md`
- Approved screenshots:
  - `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-strategy-leg-approved.png`
  - `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-asset-leg-approved.png`
  - `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-cash-leg-approved.png`

排查与验收证据:

- Before screenshots: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-legs-drawers-20260424\live-before-strategy-leg.png`, `live-before-asset-leg.png`, `live-before-cash-leg.png`
- After screenshots: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-legs-drawers-20260424\live-after-strategy-leg.png`, `live-after-asset-leg.png`, `live-after-cash-leg.png`
- Before measurements: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-legs-drawers-20260424\gate1-drawer-measurements.json`
- After measurements: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-legs-drawers-20260424\gate6-drawer-measurements-after.json`
- Content re-check screenshots: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-legs-drawer-content-20260424\live-after-asset-leg.png`, `live-after-cash-leg.png`
- Content re-check DOM: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-legs-drawer-content-20260424\gate4-asset-content-after.json`, `gate4-cash-content-after.json`
- Final live DOM after rebuild: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-legs-drawer-content-20260424\gate7-live-final.json`

| Requirement | Approved Source | Implementation | Before Evidence | After Evidence | Decision |
| --- | --- | --- | --- | --- | --- |
| 策略腿使用宽抽屉，右侧 inset shell，宽度 `min(1120px, 70vw)`，顶部/底部留 18px，抽屉 body 独立滚动。 | `compose-strategy-leg-approved.png`; spec Page 2 create strategy-leg drawer. | `web/src/components/legs/leg-inventory.css` `.leg-inventory-drawer`, `.leg-inventory-drawer--wide`, `.leg-inventory-drawer__body`; `web/src/components/legs/leg-create-drawer.tsx` `StrategyLegDrawer`. | live-before: width 1008, y 18, bottom 18, but `position=relative`, outer `overflow=auto`, body `overflow=visible`. | live-after: width 1008, y 18, bottom 18, `position=absolute`, outer `overflow=hidden`, body `overflow=auto`, body padding 18px, footer count 0. | Fixed. Shell now matches approved inset/scroll contract. |
| 资产腿使用窄抽屉，宽度约 560px，顶部/底部 18px，头部包含图标、取消、保存、关闭。 | `compose-asset-leg-approved.png`; spec Page 2 asset-leg drawer copy and form rhythm. | `web/src/components/legs/leg-create-drawer.tsx` `AssetLegDrawer` header actions and icon; shared CSS shell. | live-before: width 620, y 0, bottom 0, `position=relative`, no header action group, old footer actions present. | live-after: width 560, y 18, bottom 18, icon `资`, header actions present, footer count 0. | Fixed. Header and shell now follow approved drawer language. |
| 现金腿使用与资产腿一致的窄抽屉 rhythm，头部包含图标、取消、保存、关闭。 | `compose-cash-leg-approved.png`; spec Page 2 cash-leg drawer copy and form rhythm. | `web/src/components/legs/leg-create-drawer.tsx` `CashLegDrawer` header actions and icon; shared CSS shell. | live-before: width 620, y 0, bottom 0, `position=relative`, old footer actions present. | live-after: width 560, y 18, bottom 18, icon `现`, header actions present, footer count 0. | Fixed. Cash drawer uses the same approved narrow drawer contract as asset. |
| 资产腿/现金腿内部为三段白卡 rhythm: 身份定义、核心参数、验证摘要。 | Approved asset/cash screenshots; spec Page 2 drawer form sections. | `web/src/components/legs/leg-create-drawer.tsx` verification sections; `web/src/components/legs/leg-inventory.css` `.leg-inventory-drawer__section`, `.leg-inventory-drawer__field`, `.leg-inventory-drawer__kpi`. | live-before: summary cards exposed raw implementation labels and the old footer disrupted the form ending. | live-after: each drawer reports 3 KPI cards, field cards use white-card rhythm, no footer section. | Fixed. |
| 资产腿身份定义必须包含 3 个批准来源卡、状态 chip 与债券来源说明，而不是通用资产输入表单。 | Approved HTML `asset-leg` drawer lines 3396-3452: `合法来源`, `Bond-UST10Y-EOD-20260421`, `Bond-TIPS10Y-EOD-20260421`, `Bond-IGCarry-AA-EOD-20260421`, source callout. | `web/src/components/legs/leg-create-drawer.tsx` `ASSET_SOURCE_CHOICES` and `AssetLegDrawer`; `web/src/components/legs/leg-inventory.css` `.leg-inventory-source-*`. | Red test failed on missing `合法来源`; previous live drawer showed labels such as `资产腿名称`, `标识 / 代码`, `资产类别`, `来源提供方`. | `gate4-asset-content-after.json`: source choices count 3, badges include `合法来源`/`债券语义`/`就绪`, `formInputCount=0`; screenshot `live-after-asset-leg.png`. | Fixed and guarded. |
| 资产腿字段与验证摘要必须使用批准稿 business copy。 | Approved HTML `asset-leg` drawer lines 3453-3526: 腿名称、来源快照、组合角色、来源页、估值口径、冻结方式、维护节奏、再平衡亲和、YTM、Duration、应计利息. | `web/src/components/legs/leg-create-drawer.tsx` `AssetLegDrawer` display fields and KPI rows. | Previous implementation derived values from runtime enums/default form state and only verified KPI count. | `gate4-asset-content-after.json`: fields exactly include `10Y 国债稳定腿`, `Bond-UST10Y-EOD-20260421`, `久期稳定器 / 流动性锚点`, `数据快照 > 债券/固定收益`; KPIs include `YTM 4.2%`, `Duration 4.8`, `应计利息 已计入`. | Fixed and guarded. |
| 现金腿必须按批准稿展示身份定义、规则定义与验证摘要，不再展示通用现金输入表单。 | Approved HTML `cash-leg` drawer lines 3539-3612: `现金腿`, `规则定义`, `就绪`, 腿名称、来源规则、目标占比、触发阈值、再平衡频次、冻结方式、缓冲能力、现金占比、维护判断. | `web/src/components/legs/leg-create-drawer.tsx` `CashLegDrawer` display fields and KPI rows. | Previous implementation showed `现金腿名称`, `规则类型`, `缓冲阈值（bps）`, `收益来源`, `维护说明` input controls. | `gate4-cash-content-after.json`: badges include `现金腿`/`规则定义`/`就绪`, fields include `现金安全垫`, `目标占比 20%`, `触发阈值 换手高于 12 bps...`; KPIs include `缓冲能力 12 bps`, `现金占比 20%`, `维护判断 稳定`; `formInputCount=0`. | Fixed and guarded. |
| 不暴露 runtime enum/raw implementation copy in create drawer summary. | Design spec copy uses business language, not `snapshot_locked` / `phase1_cash_proxy` style labels. | `web/src/components/legs/leg-create-drawer.tsx` approved display copy and default submit payload. | live-before/test baseline allowed raw enum labels in verification summary and did not assert approved labels/values. | focused content regression asserts approved copy and absence of old input labels; browser evidence confirms `formInputCount=0`. | Fixed. |
| Regression gate covers drawer contract instead of only checking class existence. | AGENTS UI fix rule requires design requirement to selector/file trace plus browser or CSS contract evidence. | `web/src/leg.inventory.test.tsx` `keeps all create drawers on the approved desktop drawer contract`. | Red command failed before CSS/header fix: missing `top: 18px` in `.leg-inventory-drawer`. | Green command passes after CSS/header fix; full `src/leg.inventory.test.tsx` passes 11 tests. | Fixed and guarded. |
| Regression gate covers drawer content architecture, not just shell geometry. | Approved HTML `asset-leg`/`cash-leg` drawer structure and copy. | `web/src/leg.inventory.test.tsx` `matches the approved asset and cash create drawer content structure`. | Red command failed before content fix: Testing Library could not find `合法来源`, because the asset drawer rendered the old input form. | Green focused command passes; full `src/leg.inventory.test.tsx` passes 14 tests. | Fixed and guarded. |

## Gate 6 Measurement Summary

After cache-busted browser verification at `http://127.0.0.1:4173/?v=after-viewport-1777012492743#/legs`:

| Drawer | x | y | width | height | bottom | position | overflow | body overflow | body padding | KPI cards | old footer |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | ---: | ---: |
| Strategy leg | 432 | 18 | 1008 | 1064 | 18 | absolute | hidden | auto | 18px | 3 | 0 |
| Asset leg | 880 | 18 | 560 | 1064 | 18 | absolute | hidden | auto | 18px | 3 | 0 |
| Cash leg | 880 | 18 | 560 | 1064 | 18 | absolute | hidden | auto | 18px | 3 | 0 |

## Content Re-check Summary

After cache-busted browser verification at `http://127.0.0.1:4173/?v=after-content-asset-1777014076656#/legs` and `http://127.0.0.1:4173/?v=after-content-cash-1777014057636#/legs`, then final live re-check after rebuild at `http://127.0.0.1:4173/?v=final-live-1777014969204#/legs`:

| Drawer | Source choices | Section/status badges | Approved fields | Approved KPIs | Form inputs | Old footer |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Asset leg | 3 | 合法来源 / 债券语义 / 就绪 | 8 | 3 | 0 | 0 |
| Cash leg | 0 | 现金腿 / 规则定义 / 就绪 | 6 | 3 | 0 | 0 |

## Validation Commands

- Red before fix: `npm run test -- src/leg.inventory.test.tsx -t "keeps all create drawers"`
- Green focused: `npm run test -- src/leg.inventory.test.tsx -t "keeps all create drawers"`
- Green full file: `npm run test -- src/leg.inventory.test.tsx`
- Red content before fix: `npm.cmd run test -- src/leg.inventory.test.tsx -t "matches the approved asset and cash create drawer content structure"` failed on missing `合法来源`
- Green content focused: `npm.cmd run test -- src/leg.inventory.test.tsx -t "matches the approved asset and cash create drawer content structure"`
- Green content full file: `npm.cmd run test -- src/leg.inventory.test.tsx`
- Build: `npm run build`
- Real browser: Playwright Chromium at `1440x1100` against cache-busted `http://127.0.0.1:4173/?v=after-viewport-1777012492743#/legs`
- Real browser content re-check: Playwright Chromium at `1440x1100` against cache-busted `http://127.0.0.1:4173/?v=after-content-asset-1777014076656#/legs` and `http://127.0.0.1:4173/?v=after-content-cash-1777014057636#/legs`
