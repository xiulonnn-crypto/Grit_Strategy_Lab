# UI Artifact Trace Matrix - 数据快照 / 股票指数页签

目标页面：`http://127.0.0.1:4173/#/snapshots?tab=equity`

UI 稿：`file:///C:/Users/TradeAdmin/.gstack/projects/grit-strategy-lab/designs/compose-first-2026-04-21/compose-first-approved-preview.html?page=equity-snapshots`

SPEC：`C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-first-design-spec.md`

验收截图：

- 设计基线：`C:\Fin\Grit_Strategy_Lab\.tmp\grit-coder\snapshots-equity\screenshots\design-acceptance-1440x1100.png`
- Live 验收：`C:\Fin\Grit_Strategy_Lab\.tmp\grit-coder\snapshots-equity\screenshots\live-acceptance-final-1440x1100.png`
- Live 全页：`C:\Fin\Grit_Strategy_Lab\.tmp\grit-coder\snapshots-equity\screenshots\live-acceptance-final-full.png`
- 像素度量：`C:\Fin\Grit_Strategy_Lab\.tmp\grit-coder\snapshots-equity\screenshots\acceptance-final-metric-diff.json`
- 精简反馈截图：`C:\Fin\Grit_Strategy_Lab\.tmp\grit-review\snapshots-equity-compact\after-compact-workstation-final.png`
- 精简反馈度量：`C:\Fin\Grit_Strategy_Lab\.tmp\grit-review\snapshots-equity-compact\after-compact-final-metrics.json`

| 页面 | HTML 节点 | SPEC 章节 | 组件文件 | 状态 | Copy | 允许偏离项 | 验收截图 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 数据快照 / 股票指数 | `const equitySnapshots` / `<section class="hero-card">`，HTML 4829-4845 | `数据快照` 一级入口，SPEC 21；`#/snapshots`，SPEC 103；同页 tab 不分裂壳层，SPEC 109 | `web/src/pages/snapshots-page.tsx` 921-971；`web/src/pages/snapshots-page.css` 292-346 | 已还原 | `DATA SNAPSHOTS`、`数据快照`、`把全局视角、局部待补和原始快照清单收进一个治理入口里。研究员进入页面第一眼先看数据计分板，再决定今天是继续建仓，还是先修补数据缺口。` | 保留现有 React app shell 与路由上下文；eyebrow 仍在 DOM 供语义/测试使用，但按批准稿 CSS 隐藏。最终度量：hero `0/0/0/+1px`，tabs `0/+1/0/0px`。 | `live-acceptance-final-1440x1100.png` |
| 数据快照 / 股票指数 | `${snapshotsTabs("equity")}` / `.snapshots-tab-strip`，HTML 2964-2968、4844 | 页面内 tab：`股票/指数`、`债券/固定收益`，SPEC 843-845 | `web/src/pages/snapshots-page.tsx` 961-982；`web/src/pages/snapshots-page.css` 327-346 | 已还原 | `股票/指数`、`债券/固定收益` | HTML 稿用 `<a>`，实现用 `<button role="tab">` 保持 hash-router 状态与键盘语义；视觉类名和尺寸还原。 | `live-acceptance-final-1440x1100.png` |
| 数据快照 / 股票指数 | `<section class="panel">` / `.metric-grid`，HTML 4847-4880 | 快照入口与共享治理骨架，SPEC 95、103、109 | `web/src/page-sections/snapshots-equity.tsx` 99-146；`web/src/pages/snapshots-page.css` 348-441 | 已还原 | `全局视角`、`刷新股票快照`、`股票快照 99.8% 就绪`、`指数基准 100% 就绪`、`权益篮子 80% 可用`、`异常队列 2 项例外`、`最新刷新（EST） 03:48` | 刷新按钮绑定现有 `refreshSnapshots` API，避免只做静态稿。剩余为浏览器行高舍入：metric grid `0/-1/0/+2px`。 | `live-acceptance-final-1440x1100.png` |
| 数据快照 / 股票指数 | `<section class="panel">` / `.bond-core-grid`，HTML 4883-4964 | 数据快照作为治理入口，SPEC 41-42；页面家族统一产品语法，SPEC 66 | `web/src/page-sections/snapshots-equity.tsx` 148-249；`web/src/pages/snapshots-page.css` 465-546 | 已还原并已按用户反馈精简 | `三位一体工作站`、`股票 Universe`、`8 待审计`、`指数与基准`、`12 Ready`、`权益篮子`、`1 Pending` | `8 待审计` 与 `1 Pending` 增强为可点击审计入口，会滚动并切换到“仅看待补”。用户反馈指出此模块空白偏多后，取消 `390px` 强制卡片高度并收紧卡片 padding/gap/line-height；workstation panel `487px -> 424px`，core grid `390px -> 327px`，`min-height: auto`。 | `after-compact-workstation-final.png` |
| 数据快照 / 股票指数 | `<section class="panel" id="equity-issues-list">` / `.bond-snapshot-table`，HTML 4965-5039 | 数据快照正式路由，SPEC 103；页内状态治理，SPEC 843-846 | `web/src/page-sections/snapshots-equity.tsx` 251-302；`web/src/pages/snapshots-page.css` 562-609 | 已还原 | `原始快照清单`、`全部`、`仅看待补`、`股票 Universe`、`指数基准`、`权益篮子`、`Universe-US-Equity-20260401`、`Benchmarks-Core-20260401`、`Theme-Alpha-Basket-20260401` | HTML 稿 filter chip 是静态 `<span>`；实现为 `<button aria-pressed>` 以支持真实筛选。首行度量 `0/0/0/0px`，panel 剩余 `0/-1/0/+4px` 属于三行列表累计舍入。 | `live-acceptance-final-full.png` |
| 数据快照 / 股票指数 | `<aside class="detail-rail">` / `.rail-panel`，HTML 5042-5078 | 数据来源治理与可用性说明，SPEC 41-42；入库/可用状态标准，SPEC 846 | `web/src/page-sections/snapshots-equity.tsx` 305-337；`web/src/pages/snapshots-page.css` 611-640 | 已还原 | `数据诊断报告`、`股票 Universe`、`权益篮子`、`指数与基准`、`就绪标准`、`基础就绪`、`投研就绪`、`组合就绪` | 右栏按批准稿保持说明栏角色，不接入旧 API 的阻塞摘要。最终度量：rail、第一 rail panel `0/0/0/0px`，第二 rail panel `0/+1/0/0px`。 | `live-acceptance-final-1440x1100.png` |
| 数据快照 / 股票指数 | 交互链路：`8 待审计`、`1 Pending`、filter chips、`刷新股票快照` | 主 CTA 与页面内 tab，SPEC 843-846；同页治理入口，SPEC 109 | `web/src/page-sections/snapshots-equity.tsx` 91-97、173-181、223-231、264-276；`web/src/snapshots.page.test.tsx` 243-345 | 已验证 | 点击待审计/Pending 后切到 `仅看待补`；点击 filter 切换列表；刷新 CTA 使用现有接口 | 比 HTML 静态稿多了真实交互状态，但视觉初始态与 copy 对齐。 | `acceptance-final-metric-diff.json` |

## 验收摘要

- 红线测试：先更新 `web/src/snapshots.page.test.tsx`，旧实现无法找到 `刷新股票快照`，确认旧双列表不是批准稿结构。
- 绿线测试：`npm test -- src/snapshots.page.test.tsx` 通过，`12` tests passed。
- 视觉度量：核心布局 x/w 全部一致；用户反馈后三位一体工作站改为紧凑版，workstation panel `487px -> 424px`，core grid `390px -> 327px`，首屏继续保持无 console error。
