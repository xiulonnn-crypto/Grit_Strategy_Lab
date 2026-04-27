# UI Artifact Trace Matrix - `#/legs` 创建资产腿预设抽屉

验收目标: `http://127.0.0.1:4173/#/legs` -> `创建资产腿`

UI 稿源:

- Approved HTML: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\asset-leg-type-preset-2026-04-24\asset-leg-type-preset-preview.html`
- Design spec: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\asset-leg-type-preset-2026-04-24\asset-leg-type-preset-spec.md`
- Approved screenshots:
  - `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\asset-leg-type-preset-2026-04-24\asset-leg-type-preset-bond.png`
  - `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\asset-leg-type-preset-2026-04-24\asset-leg-type-preset-equity.png`

实现边界:

- 仅优化 `创建资产腿` 抽屉的样式与内容；策略腿、现金腿和资产库主表不在本轮重构范围。
- 继承现有 Compose First 抽屉壳层、白卡、浅雾灰背景与柔和阴影，不新增全局设计系统。
- 保持 `POST /asset-legs` payload 契约不变，通过 view-model/preset 层映射中文 UI 与提交字段。

| Requirement | Approved Source | Target Implementation | Required Copy / Formatting | Interaction States | Verification | Evidence Status | Allowed Deviation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 抽屉壳层继承批准稿，右侧停靠，宽度 `clamp(560px, 39vw, 640px)`，body 独立滚动。 | HTML `.drawer`; SPEC 4/6. | `web/src/components/legs/leg-inventory.css` `.leg-inventory-drawer`, `.leg-inventory-drawer__body`. | 头部标题 `创建资产腿`，副文案 `绑定来源，设定口径，保存入库。`，主按钮 `保存并加入库`。 | 取消、关闭、保存按钮保持可访问名称。 | CSS contract + browser geometry. | Passed. Browser DOM: width 562, y 18, bottom 18. | Header action can keep existing `.primary-button/.ghost-button` token。 |
| 内容顺序固定为五段：资产类型 -> 来源选择 -> 身份与角色 -> 核心规则 -> 验证摘要。 | SPEC 2/4; HTML drawer body. | `web/src/components/legs/leg-create-drawer.tsx` `AssetLegDrawer`. | Section title exactly: `资产类型`、`来源选择`、`身份与角色`、`核心规则`、`验证摘要`。 | Switching type must preserve section order. | DOM order assertion. | Passed. Unit and browser DOM both report the five-section order. | Error banner may appear before sections only when submit fails。 |
| 资产类型切换器为纯中文双按钮，禁用图标、英文副文案与大卡片化处理。 | SPEC 5; HTML `.segmented`. | `AssetLegDrawer` preset mode state + CSS `.leg-inventory-asset-segmented`. | Buttons: `债券`、`股票` only. | Default `债券`; hash/query containing `equity` enters `股票`; clicking switches selected source and form defaults. | DOM text scan + interaction test. | Passed. Bond icon `债`; equity icon `股`; URL becomes `#/legs?asset_type=equity`. | Because app router owns `#/legs`, click state writes `#/legs?asset_type=equity` instead of replacing the whole SPA hash with `#equity`。 |
| 来源选择只保留标题、状态 chip、`快照 ID` 标签、检索输入和当前可选标的卡片，不恢复重复标签行或解释句。 | SPEC 3/5; HTML source section. | `AssetLegDrawer` preset source list + CSS `.leg-inventory-source-*`, `.leg-inventory-source-search`. | Status chip `就绪`; label `快照 ID`; card title uses Chinese display name; tags only inside card. | Search filters by snapshot ID, Chinese name, short description, tags; empty state uses Chinese retry copy. | DOM copy assertion + search interaction. | Passed. Browser DOM has one card for current query and no old source callout. | Multiple filtered cards may display when query is broad/empty, matching HTML behavior. |
| 债券来源卡展示中文名、短描述、标签组和就绪状态。 | SPEC 5/7; HTML `presetModes.bond.sources`. | Bond preset view model. | `美国 10年国债`, `UST 10年利率债`, tags `UST / 10年 / 净价/应计 / 久期 4.8`。 | Selecting source updates fields, rules and KPIs. | DOM and click assertions. | Passed. Browser screenshot and DOM captured default bond state. | Snapshot IDs and symbols remain English/letters for data fidelity. |
| 股票来源卡展示中文名、短描述、标签组和就绪状态。 | SPEC 5/7; HTML `presetModes.equity.sources`. | Equity preset view model. | `SPY 宽基贝塔`, `美股宽基敞口`, tags `SPY / 美股 / 贝塔 0.98 / 股息 1.3%`。 | `股票` button updates icon, source page, role chip, rules and KPIs. | DOM and click assertions. | Passed. Browser screenshot and DOM captured SPY; QQQ search/select updates KPI. | `SPY/QQQ/XLF` remain as asset codes. |
| 身份与角色保留五个字段，右上分类 chip 为短词。 | SPEC 5; HTML identity section. | `AssetLegDrawer` identity section. | Fields: `腿名称`、`资产标识`、`来源快照`、`来源页`、`组合角色`; chip: 债券 `久期/防守`, 股票 `因子/超额`。 | First two fields editable; source fields read-only display; role pills reflect preset active roles. | DOM copy + form value assertion. | Passed. Tests assert role pills and form values for bond/equity. | Role pills are rendered as buttons for selection affordance but stay visually pill-sized. |
| 核心规则公共字段固定为四项，并有资产类型动态参数插槽。 | SPEC 5; HTML core section. | `AssetLegDrawer` core section. | Common: `估值口径`、`再平衡倾向`、`维护节奏`、`冻结设置`; bond slots: `到期收益率/久期/凸性/应计处理`; equity slots: `贝塔/风格口径/股息率/分红再投`。 | Type/source switch updates dynamic slot and core values. | DOM copy assertion. | Passed. Tests assert bond/equity slot and QQQ selection updates. | Values are displayed as compact select-value cards, not native selects, to match new formal UI. |
| 验证摘要只保留 KPI 卡片，两层信息：标签与数值；不得恢复底部解释句。 | SPEC 3/5; HTML KPI section. | `AssetLegDrawer` KPI grid. | Bond KPIs: `到期收益率 4.2%`、`久期 4.8`、`应计 已计入`; equity KPIs: `贝塔 0.98`、`股息率 1.3%`、`样本外 稳定`。 | Type/source switch updates KPI cards. | DOM copy assertion and absence checks for old callout/`small` helper rows. | Passed. Browser DOM confirms no old validation callout and expected KPI rows. | Existing cash/strategy KPI small text is out of scope; asset drawer KPI cards omit helper text. |
| 可见文案中文化，除快照 ID、资产代码、标的简称外不泄露英文状态/PRD/后端标签。 | SPEC 3. | Asset preset formatter/view model. | No visible `Bond` except inside snapshot ID, no `Equity` except inside snapshot ID, no `READY`/`Duration`/`Accrued`/`Stable` labels. | Copy scan after opening bond/equity states. | Test + browser DOM text scan. | Passed. Browser DOM `forbiddenEnglishTokens` is empty for bond/equity/QQQ states. | `FMP` is not shown in the new UI; provider remains payload-only. |
| 提交 payload 保持后端契约，随选中预设更新 `name/symbol/asset_kind/source_snapshot_id/source_provider/freeze_mode/summary`。 | API contract in `web/src/types.ts`. | `AssetLegDrawer` submit handler and preset-to-form mapper. | UI 中文值 maps to canonical summary keys. | Editing name/symbol and toggling roles should submit expected payload. | Vitest create asset contract. | Passed. `creates an asset leg from the drawer` asserts payload shape. | No backend/model change expected. |

## Validation Results

- Focused content/interaction: `npm.cmd run test -- src/leg.inventory.test.tsx -t "matches the asset leg preset drawer"` passed.
- Focused contract: `npm.cmd run test -- src/leg.inventory.test.tsx -t "creates an asset leg from the drawer"` passed.
- Full file: `npm.cmd run test -- src/leg.inventory.test.tsx` passed, 15 tests.
- Frontend fixed slice: `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1` passed, 14 files / 146 tests.
- Build: `npm.cmd run build` passed.
- Browser evidence:
  - `C:\Fin\Grit_Strategy_Lab\output\logs\grit-coder\asset-leg-type-preset-20260424\asset-leg-drawer-bond.png`
  - `C:\Fin\Grit_Strategy_Lab\output\logs\grit-coder\asset-leg-type-preset-20260424\asset-leg-drawer-equity.png`
  - `C:\Fin\Grit_Strategy_Lab\output\logs\grit-coder\asset-leg-type-preset-20260424\asset-leg-drawer-bond-dom.json`
  - `C:\Fin\Grit_Strategy_Lab\output\logs\grit-coder\asset-leg-type-preset-20260424\asset-leg-drawer-equity-dom.json`
  - `C:\Fin\Grit_Strategy_Lab\output\logs\grit-coder\asset-leg-type-preset-20260424\asset-leg-drawer-equity-search-select-dom.json`
