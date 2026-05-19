# 因子工厂配置 UI Trace Matrix

## 设计源

- Phase 0 参考稿：`C:\Fin\Grit_Strategy_Lab\designs\factor-phase0-f1-operator-config\factor-phase0-f1-operator-ui-preview.html`
- Phase 1 WNZT spec：`C:\Fin\Grit_Strategy_Lab\designs\2026-05-19-factor-factory-phase1-wnztod\spec.md`
- 当前验收路由：`http://127.0.0.1:4173/?v=operator-tab-after-1779183599656#/factors/factory`

## 弹层结构映射

| 设计要求 | 实现选择器 / 文件 | 验收证据 |
| --- | --- | --- |
| 弹层默认打开 `算子注册` tab | `.factor-config-tab[aria-selected="true"]`，`web/src/pages/factor-factory-page.tsx` | DOM：active tab = `算子注册`，`WNZT 证据与检疫裁决` = false |
| 三栏布局 196px / 内容区 / 330px | `.factor-config-modal__body`，`web/src/pages/factor-phase2-pages.css` | DOM：`grid-template-columns: 196px 972px 330px`，modal 宽 `1500px` |
| 中区为摘要卡片、核心算子库、TS 分组、CS/多元/非线性/技术分组 | `.factor-config-kpis`、`.operator-toolbar`、`.operator-section` | DOM：section = `TS 时间序列类`、`CS / 多元 / 非线性 / 技术类` |
| 默认 3 算子启用，其余禁用 | `.operator-row`、`.operator-status-pill` | DOM：rowCount `11`，statusCounts `{启用: 3, 禁用: 8}` |
| 算子行包含开关、名称、定义、经济含义、窗口/min_periods、状态 | `.operator-toggle`、`.op-name`、`.op-desc`、`.window-chip` | DOM：`TS_Return`、`x_t / x_{t-n} - 1`、`n: 3-252`、`min=n` 可见 |
| 桌面无横向溢出 | `document.body.scrollWidth` / modal width | DOM：bodyScrollWidth `1600` = viewportWidth `1600`，modalScrollWidth `1498` = modalClientWidth `1498` |
| 移动端可读、可关闭、可保存草稿 | 390px viewport | DOM：activeTab `算子注册`，bodyGrid `364px`，bodyScrollWidth `390` = viewportWidth `390` |

## 截图证据

- 桌面：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-review-20260519\factory-config-operator-tab-live-after-1779183599656.png`
- 移动：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-review-20260519\factory-config-operator-tab-mobile-after-1779183636188.png`

## 允许偏差

- Phase 0 参考稿早期示例为 24 个算子；当前后端注册表已落地 25 个核心算子，因此摘要显示 `3 / 25`。
- 为完整覆盖 25 个核心算子，TS 极值/Delta、TS_Cov、CS_Scale、If_Then_Else 被纳入压缩行展示；结构仍保持参考稿的两段算子清单。

## 2026-05-19 追加验收：配置弹层与 F1 阻塞列

| 设计/验收要求 | 实现选择器 / 文件 | Live 证据 |
| --- | --- | --- |
| 配置弹层左侧 tab 使用设计稿轻量 rail，active 为浅绿底和 3px 左侧标识 | `.factor-config-tabs`、`.factor-config-tab.is-active`，`web/src/pages/factor-phase2-pages.css` | DOM：active tab `算子注册`，active bg `rgb(232, 247, 244)`，inset shadow `3px`，border `0px` |
| 右侧信息与 UI 稿一致：引用快照、准入规则、运行预算 | `.factor-config-side h3`，`web/src/pages/factor-factory-page.tsx` | DOM：sideHeadings = `引用快照 / 准入规则 / 运行预算` |
| 核心算子库分组筛选真实可用 | `[aria-label="算子分组筛选"]` | Live 选择 `CS / 多元 / 非线性 / 技术类` 后：`TS_Mean=false`、`TS_Corr=true`、`CS_Rank=true` |
| 核心算子库搜索真实可用 | `[aria-label="搜索算子或定义"]` | Live 搜索 `TS_Return` 后仅保留 `TS_Return` 行 |
| F1 阻塞列不暴露工程处理规则，改用业务风险语言 | `.f1-raw-table tbody td:nth-child(5)`，`web/src/pages/factors-page.tsx` | DOM：READY 显示 `无阻塞 / 覆盖完整，可调用`；审慎态显示 `需复核 / 审慎可调用，来源/时点待确认`；`NaN / 不填 0 / 任一输入缺失输出` 均未出现在阻塞列 |
| F1 桌面端无页面级横向滚动 | `.f1-raw-table-wrap`、`.f1-raw-table`，`web/src/pages/factors-page.css` | DOM：desktop `htmlScrollWidth=1600`、`viewportWidth=1600`、`table-layout=fixed`、`overflow-x=hidden` |
| F1 移动端无横向滚动且不重叠 | `@media (max-width: 960px)` 下 `.f1-raw-table tr/td` | DOM：mobile `htmlScrollWidth=390`、`viewportWidth=390`、row/td display = `grid`；最终截图人工复核无文字重叠 |

### 追加截图证据

- 配置弹层桌面：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-review-20260519\factory-config-filter-side-after-1779184633898.png`
- F1 桌面最终文案：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-review-20260519\factors-f1-risk-copy-after-1779184727104.png`
- F1 桌面状态口径最终复核：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-review-20260519\factors-f1-final-copy-after-1779184950302.png`
- F1 移动最终文案：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-review-20260519\factors-f1-risk-copy-mobile-after-1779184727104.png`
