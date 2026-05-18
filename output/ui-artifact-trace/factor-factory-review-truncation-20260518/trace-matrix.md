# 因子工厂 UI 截断验收 Trace Matrix

验收对象：`http://127.0.0.1:4173/?v=<timestamp>#/factors/factory`

验收日期：2026-05-18

## 问题复现

| 验收点 | 复现证据 | 结论 |
| --- | --- | --- |
| 三个主模块固定高度后，内容应在模块内部纵向滚动 | `before-audit.json` 中 B1 面板 `clientHeight=758`、`scrollHeight=891`，父容器 `overflow=hidden`，body 高度超过父容器 | 失败：固定高度容器未建立 grid 行，内容被父容器裁切 |
| 因子检疫列表不应横向溢出或裁切操作列 | `before-audit.json` 中 B3 body `clientWidth=527`、`scrollWidth=587`，表头 `clientWidth=493`、`scrollWidth=570` | 失败：列最小宽度过大，操作列被挤出 |
| 页面整体不应出现横向滚动 | `before-audit.json` 显示 document 无横向滚动 | 通过：问题集中在局部面板和列表行 |

## 修复映射

| 需求 | 实现位置 | 选择器 / 合同 | 说明 |
| --- | --- | --- | --- |
| 固定模块高度，更多内容纵向滚动 | `web/src/pages/factor-phase2-pages.css` | `.factor-factory-fixed-panel` | 补 `display: grid`，使用 `grid-template-rows: auto minmax(0, 1fr)` 把 header 与 body 分层 |
| 模块内部滚动，不裁切内容 | `web/src/pages/factor-phase2-pages.css` | `.factor-factory-fixed-panel .factor-phase2-panel__body`, `.factor-factory-scroll-body` | 保留 `overflow-y: auto`、`overflow-x: hidden`，让超出内容进入 body 滚动区 |
| 检疫列表列宽不撑破容器 | `web/src/pages/factor-phase2-pages.css` | `.factor-factory-result-row`, `.factor-factory-report-row` | 缩小日期、因子名、结果、原因、操作列的最小宽度，并锁定 `width/max-width: 100%` |
| 长原因、长因子名允许换行 | `web/src/pages/factor-phase2-pages.css` | `.factor-factory-result-row span`, `.factor-factory-report-row span` | 使用 `overflow-wrap: anywhere` 与 `white-space: normal`，避免强制省略或横向溢出 |
| 防止同类回归 | `web/src/factor.factory.test.tsx` | `keeps fixed factory panels scrollable instead of clipping their body content` | 增加 CSS 合同测试，覆盖 grid 固定面板、内部滚动和结果行列宽 |

## 修复后验收

| 验收点 | 证据 | 结果 |
| --- | --- | --- |
| 1960 视口无横向滚动 | `after-audit.json`：`width=1960`、`scrollWidth=1960`、`noHorizontalScroll=true` | 通过 |
| 1366 视口无横向滚动 | `after-audit.json`：`width=1366`、`scrollWidth=1366`、`noHorizontalScroll=true` | 通过 |
| B1/B2/B3 面板固定高度且 body 不再大于父容器 | `after-audit.json`：三个 `.factor-factory-fixed-panel` 均为 `display=grid`，`bodyOversizedAgainstPanel=false` | 通过 |
| B1 超出内容可内部滚动到底部 | `scroll-audit.json`：`ok=true`，最后一张 `L3 组合因子生成` 卡片完整进入 body 视口 | 通过 |
| B3 检疫列表不裁切操作列 | `after-audit.json`：1960 下表头 `clientWidth=493`、`scrollWidth=493`，body `clientWidth=527`、`scrollWidth=527` | 通过 |

## 截图

- `factory-1960-before.png`
- `factory-1366-before.png`
- `factory-1960-after.png`
- `factory-1366-after.png`
- `factory-1960-tasks-scrolled-after.png`
