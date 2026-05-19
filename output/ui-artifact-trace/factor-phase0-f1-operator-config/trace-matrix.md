# Phase 0 F1 原始库与算子配置 UI Trace Matrix

## 验收锚点

- 冻结设计稿：`designs/factor-phase0-f1-operator-config/factor-library-f1-raw-tab.png`
- 冻结弹层稿：`designs/factor-phase0-f1-operator-config/factor-factory-config-modal.png`
- 冻结 HTML：`designs/factor-phase0-f1-operator-config/factor-phase0-f1-operator-ui-preview.html`
- 冻结 Spec：`designs/factor-phase0-f1-operator-config/factor-phase0-f1-operator-ui-spec.md`
- F1 验收 URL：`http://127.0.0.1:4173/?v=route-reload-1779169383323#/factors`
- 工厂弹层验收 URL：`http://127.0.0.1:4173/#/factors/factory`，点击 `工厂配置`
- 共享 Shell：在范围内，侧栏沿用当前应用外壳；主内容区与弹层按冻结稿模块顺序、中文文案和密度验收。

## F1 原始库页面矩阵

| 设计要求 | 实现位置 | Selector / 模块 | 验收证据 |
| --- | --- | --- | --- |
| `#/factors` 默认进入 `F1 原始库`，不落回综合台账 | `web/src/pages/factors-page.tsx` | `initialFactorTierFilterFromHash()`、`.factor-layer-card.is-active` | live DOM：URL 命中用户验收路由；`[data-testid=f1-raw-catalog]` 存在；旧 `因子资产台账` 不出现 |
| Hero 与 F1/F2/F3 三卡保持上一版 UI 稿密度 | `web/src/pages/factors-page.tsx`、`web/src/pages/factors-page.css` | `.factor-page-hero`、`.factor-layer-card` | live 截图：F1 active 卡片位于三卡首位，主标题与中文 PIT 准入口径可见 |
| KPI 四卡：F1 原始字段、可调用字段、源阻塞字段、时点缺口 | `web/src/pages/factors-page.tsx` | `.f1-raw-kpis` | live 截图：数值为 `15 / 7 / 8 / 0`，说明为中文治理口径 |
| 主面板标题、状态分段、批次条、筛选条、dense table | `web/src/pages/factors-page.tsx`、`web/src/pages/factors-page.css` | `.f1-raw-panel`、`.f1-raw-status-tabs`、`.f1-raw-batch-strip`、`.f1-raw-filters`、`.f1-raw-table` | live DOM：面板 `1660x909`；状态 tabs `全部字段15 / 可调用7 / 阻塞8 / 待诊断0`；表格容器 `1622x650` 内滚 |
| 表头字段内容与 spec 一致，显示业务中文和可追溯 key | `web/src/pages/factors-page.tsx` | `.f1-raw-table th` | live DOM：`字段 factor_info`、`层级 pit_layer`、`覆盖 available_symbols`、`时点 publish / available_at`、`阻塞 missing_policy`、`来源 source_refs`、`准入 admission_state`、`更新 last_updated_at` |
| L1 缺失不填 0，显示 `DATA_SOURCE_BLOCKED` 与暂不可调用 | `web/src/pages/factors-page.tsx` | `.f1-blocker-cell`、`.f1-raw-table mark.is-blocked` | live 截图：L1 行显示 `DATA_SOURCE_BLOCKED`、`缺失输出 NaN；不填 0`、准入状态 `暂不可调用` |
| 中文表达，不泄露英文实现串 | `web/src/pages/factors-page.tsx` | F1 主视图文本 | live DOM：`source pending`、`factory run`、`depth 2`、`profile` 检测为 `[]`；技术 ID 保留 |
| Bottom audit 双卡与主表同宽 | `web/src/pages/factors-page.tsx` | `.f1-raw-audit` | live DOM：audit `1660x66`；截图底部显示 `F1 准入口径` 与 `快照追踪` |
| 移动端可读、无横向文本溢出 | `web/src/pages/factors-page.css` | `@media (max-width: 960px)` | mobile DOM：表格外框 `276x650`；溢出检测 `0` |

## 工厂配置弹层矩阵

| 设计要求 | 实现位置 | Selector / 模块 | 验收证据 |
| --- | --- | --- | --- |
| 点击 `工厂配置` 打开配置弹层，标题和说明为中文金融台账语言 | `web/src/pages/factor-factory-page.tsx` | `.factor-config-modal header` | live 截图：标题 `因子工厂配置`；说明 `生成快照后工厂运行只引用不可变 ID` |
| 弹层尺寸与冻结稿接近，三栏结构清晰 | `web/src/pages/factor-phase2-pages.css` | `.factor-config-modal`、`.factor-config-modal__body` | live DOM：modal `1500x1004`，body `1498x824`，rail/main/side 为 `196/972/330` |
| 左侧五段 rail：算子注册表、窗口空间、字段准入、运行预算、输出快照 | `web/src/pages/factor-factory-page.tsx` | `.factor-config-rail button` | live DOM：rail 文案完整匹配五段，首段 active |
| 顶部 KPI：启用算子、挖掘深度、窗口空间 | `web/src/pages/factor-factory-page.tsx` | `.factor-config-kpis` | live DOM：`3 / 25`、`深度 2`、`7 档 [3,5,10,21,63,126,252]` |
| 算子表按 TS 与 CS/多元/非线性/技术分组，默认只启用三个算子 | `web/src/pages/factor-factory-page.tsx` | `.factor-config-operator-section` | live DOM：section 为 `时间序列 时间序列类`、`CS / 多元 / 非线性 / 技术类`；启用按钮数量 `3` |
| 右侧配置约束显示引用快照、准入规则、运行预算 | `web/src/pages/factor-factory-page.tsx` | `.factor-config-side` | live 截图：三张约束卡完整显示；准入规则明确 `不设 IC 门槛` 与 `缺失 L1 保持 NaN` |
| 页脚保存、生成快照、关闭行为保持当前交互 | `web/src/pages/factor-factory-page.tsx` | `.factor-config-modal__footer` | 单测：dirty close confirmation、保存草稿、生成配置快照通过 |
| 中文表达，不泄露英文实现串 | `web/src/pages/factor-factory-page.tsx` | 弹层文本 | live DOM：`factory run`、`depth 2`、`profile`、`workers` 检测为 `[]`；算子 ID、数学公式、`min_periods` 按 spec 保留 |
| 移动端可读、可关闭、可保存草稿 | `web/src/pages/factor-phase2-pages.css` | `@media (max-width: 980px)` | mobile DOM：modal `326x804`；溢出检测 `0`；按钮 `关闭/保存草稿/生成配置快照` 可见 |

## 截图与命令

- F1 修复前截图：`output/ui-artifact-trace/factor-phase0-f1-operator-config/live-factors-f1-review-before-20260519.png`
- F1 修复后截图：`output/ui-artifact-trace/factor-phase0-f1-operator-config/live-factors-f1-review-after-20260519.png`
- F1 移动端截图：`output/ui-artifact-trace/factor-phase0-f1-operator-config/live-factors-f1-review-mobile-after-20260519.png`
- 工厂弹层修复前截图：`output/ui-artifact-trace/factor-phase0-f1-operator-config/live-factor-factory-modal-review-before-20260519.png`
- 工厂弹层修复后截图：`output/ui-artifact-trace/factor-phase0-f1-operator-config/live-factor-factory-modal-review-after-20260519.png`
- 工厂弹层移动端截图：`output/ui-artifact-trace/factor-phase0-f1-operator-config/live-factor-factory-modal-mobile-after-20260519.png`
- 通过：`npm.cmd test -- factors.phase0.f1.test.tsx factor.factory.test.tsx factor.model-builder.test.tsx`，55 passed
- 通过：`npm.cmd run build`

## 允许偏差

- 侧栏菜单沿用当前应用 Shell 文案与分组，不按静态 HTML 侧栏数字逐项替换。
- 技术 ID、算子 ID、字段 key、`DATA_SOURCE_BLOCKED`、`available_at`、`min_periods`、数学表达式按 spec 保留，用于追溯和算子定义。
