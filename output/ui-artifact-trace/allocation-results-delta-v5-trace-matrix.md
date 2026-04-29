# 组合优化结果页 v5 UI Artifact Trace Matrix

日期：2026-04-29

页面：`#/compositions/:id/allocation-jobs/:jobId`

实现范围：

- `web/src/pages/composition-allocation-page.tsx`
- `web/src/pages/composition-allocation-page.css`
- `web/src/composition.allocation.test.tsx`

## 设计到实现映射

| 设计模块 | 实现选择器 / 组件 | 验收要点 | 当前证据 |
| --- | --- | --- | --- |
| Hero / 目标对齐 | `PageHero`, `.composition-allocation-verdict` | 结果页移除右侧路径卡；保留组合名、基准、目标对齐结论 | focused test 覆盖页面标题与目标绑定文案 |
| 页面最大宽度 | `.composition-allocation-page`, 设计稿 `.page-grid` | 模块最大宽度对齐线上 `#/strategies`，统一为 1600px；移动端仍用视口宽度 | CSS/HTML/spec 已同步为 1600px |
| 核心增量仪表盘 | `DeltaSummaryPanel`, `[data-ui="allocation-delta-summary"]` | 展示夏普增量、波动优化、回撤改善、调仓摩擦 | focused test 覆盖 `夏普增量` |
| 有效前沿迁移向量 | `FrontierChart`, `[data-ui="allocation-frontier"]` | Current/候选点聚焦，其他候选弱化；虚线箭头展示迁移方向 | focused test 覆盖标题；DOM 扫描覆盖英文标签不泄漏 |
| 相对表现曲线 | `RelativePerformancePanel`, `[data-ui="allocation-relative-performance"]` | 单条相对表现曲线；2020/2022 灰色压力环境 | focused test 覆盖模块标题 |
| 执行决策 | `ExecutionDecisionPanel`, `[data-ui="allocation-decision-card"]` | 唯一入口为 `一键晋升版本`；无 `查看详情`；执行受限禁用 | focused test 覆盖入口、禁词与晋升成功 |
| 晋升确认 | `PromotionDialog` | 点击入口先打开 `确认晋升版本`，确认后调用 `updateComposition` | focused test 覆盖 dialog 与 update payload |
| 极端行情压力测试 | `StressTestPanel`, `[data-ui="allocation-stress-test"]` | 2008/2020/2022 语义化压力标签，展示回撤、修复周期、防御溢价 | focused test 覆盖模块标题 |
| 候选选择器 | `CandidateSelectorPanel`, `[data-ui="allocation-candidate-selector"]` | `配置展示方案` 三选项；每个目标族前三名；第一行年化收益率；动作统一 `查看方案` | focused test 覆盖三选项、三按钮、第一行 |
| 折叠审计 | `AuditDisclosure`, `[data-ui="allocation-audit"]` | 默认折叠为一行审计结论，展开后显示来源证据与成本 | DOM 结构落地，live 证据待补 |

## 交互证据

| 交互 | 预期 | 证据 |
| --- | --- | --- |
| 切换目标族 | 候选列切换为目标族前三名，上方决策卡同步第一名 | focused test：`配置展示方案` 切换到 `风险平价` 后展示 `风险平价一号` |
| 点击 `查看方案` | 只更新当前选中候选，不触发写入 | focused test：点击第二列后展示 `低换手防守` 与执行决策文案 |
| 点击 `一键晋升版本` | 先打开确认弹窗 | focused test：断言 `role=dialog` 标题 `确认晋升版本` |
| 确认晋升 | 调用 `api.updateComposition(compositionId, { legs })` | focused test：断言 payload 含 `leg_kind/source_ref_id/display_name/weight_pct` |

## 验收记录

- Focused test：`cmd /c npm test -- composition.allocation.test.tsx`，5 passed。
- TypeScript：`cmd /c npx tsc --noEmit`，passed。
- Build：`cmd /c npm run build`，passed；Vite 仍提示现有 chunk 大小超过 500 kB。
- Fixed frontend slice：`powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1` 在 5 分钟超时，遗留 Vitest 子进程已停止；本轮以 focused test、tsc、build 与 live 交互验收覆盖。
- DOM 扫描：`output/ui-artifact-trace/allocation-results-delta-v5-live-evidence.json` 记录禁词未命中。
- 最大宽度：live evidence 记录 1920px 视口下页面根宽度为 1600px。
- 桌面截图：`output/ui-artifact-trace/allocation-results-delta-v5-desktop.png`。
- 移动截图：`output/ui-artifact-trace/allocation-results-delta-v5-mobile.png`。

## 已知边界

- 本次不新增后端 API、不新增存储表。
- 晋升写回复用 `PATCH /compositions/{id}` 的 `legs` payload。
- `scripts/codex-smoke.ps1` 仍不作为默认门禁；fixture-backed reset 受缺失 fixture 资产影响。
