# 因子工厂 B1-B4 二期工作台 UI Spec

生成日期：2026-05-18

## 1. 目标

本次只改造 `#/factors/factory`，`#/factors` 因子库页面保持不变。页面从原来的流水线说明型界面，收敛为三块可操作工作台：

1. **因子任务**：统一呈现因子挖掘类、因子改造类、因子组合类任务。
2. **因子打分**：承载送检前的量化评分与 Pass/Fail 阈值判断。
3. **因子检疫**：承载历史检疫查询、五大类检测、准入报告与发布准入。

页面顶部优先展示 **可发布因子名单**，让通过检疫的 L2/L3 因子可以一键发布。

## 2. 交付物

- HTML UI 稿：`output/ui-artifact-trace/factor-factory-b1-b4-phase2-20260518/factor-factory-b1-b4-phase2-ui.html`
- 实现规格：`output/ui-artifact-trace/factor-factory-b1-b4-phase2-20260518/factor-factory-b1-b4-phase2-spec.md`

本轮未更新 `DESIGN.md`，原因是变更仍属于 `#/factors/factory` 单页设计合同，未引入新的全局设计系统规则。

## 3. 页面范围

Canonical route：

- `#/factors/factory`

不在本次改造范围：

- `#/factors`
- `#/factor-models/new`
- `#/factors/sandbox`
- `#/factors/quarantine`

`#/factors/sandbox` 与 `#/factors/quarantine` 如后续需要独立路由，可从本页的任务、打分、检疫模块拆出；本期先保持因子工厂页内闭环。

## 4. 响应式与横向滚动规则

页面规格仍以 1960 作为最大设计画布，但不允许使用固定 `min-width: 1960px` 造成横向滚动。

```css
html,
body {
  max-width: 100%;
  overflow-x: hidden;
}

.design-canvas {
  width: min(1960px, 100%);
  max-width: 1960px;
  grid-template-columns: 240px minmax(0, 1fr);
}
```

响应式断点：

| 视口 | 行为 |
| --- | --- |
| `>= 1500px` | 1960 最大画布，三列工作台同屏展示 |
| `< 1500px` | 可发布列表和工作台改为单列堆叠，避免任何横向滚动 |
| `< 1180px` | Sidebar 收缩为图标宽度，摘要卡改为双列 |
| `< 820px` | Sidebar 变为顶部紧凑导航，所有表格行堆叠 |

验收要求：`document.documentElement.scrollWidth <= document.documentElement.clientWidth`。

主工作台高度规则：

```css
:root {
  --workbench-panel-height: 760px;
}

.panel {
  height: var(--workbench-panel-height);
  grid-template-rows: auto minmax(0, 1fr);
}

.panel-body {
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
```

`因子任务`、`因子打分`、`因子检疫` 三个模块必须同高。模块内内容超过高度时只在模块内部出现纵向滚动条，不推高整页，也不产生横向滚动。

## 5. 信息架构

```text
max 1960 canvas
├─ sidebar
└─ main
   ├─ hero：因子任务生产台
   ├─ automation status strip：每日 GMT+8 14:00 + 立即运行
   ├─ 可发布因子名单：publishable_count > 0 时展示，右上角一键发布
   ├─ summary metrics：任务池、候选交付、已送检、发布准入、历史拒绝、硬阻断
   ├─ 三层固定高度工作台
   │  ├─ 因子任务：固定高度，内部纵向滚动
   │  ├─ 因子打分：默认收起卡片，详情进入弹层
   │  └─ 因子检疫：结果收起卡片，详情进入弹层
   └─ 发布准入规则：L2 / L3 / 历史检疫
```

## 6. 可发布因子名单

位置：自动化状态条之后、摘要卡之前。

作用：

- 优先暴露最终可操作对象，而不是让用户先读完整流程。
- 仅当 `publishable_count > 0` 时展示；为 0 时隐藏整个区块，不展示空卡片。
- 改造因子检疫通过后可发布入 L2 库。
- 组合因子检疫通过后可发布入 L3 库。
- 每个发布动作必须保留血缘、算子链、投资逻辑、检疫报告和发布审计。

UI 元素：

- 标题：`可发布因子名单`
- 右上角统一动作：`一键发布`
- 因子卡片动作：只保留 `详情`
- 行字段：因子 ID、目标层、父因子、算子链或组合逻辑、检疫状态、打分。

建议类型：

```ts
type PublishableFactorRow = {
  factor_id: string;
  target_layer: "L2" | "L3";
  score: number;
  quarantine_status: "PASS" | "WARN";
  parent_factor_ids: string[];
  operator_chain?: Array<"MAD" | "N" | "Z" | "T">;
  investment_logic?: string;
  detail_modal_enabled: boolean;
};
```

## 7. 因子任务模块

### 7.1 任务分类

| 任务类 | 来源 | 目标 |
| --- | --- | --- |
| 因子挖掘类 | 价格型、质量/估值型、情绪/微观型、宏观/衍生品型 PIT lane | 生成 L1 基础候选 |
| 因子改造类 | 已准入 L1 或旧兼容因子 | 生成 L2 改造候选 |
| 因子组合类 | 已准入 L2 或显式豁免来源 | 生成 L3 组合候选 |

### 7.2 任务命名

任务名称必须包含日期，格式建议：

```text
YYYY-MM-DD + 任务主题
```

示例：

- `2026-05-18 价格型基础因子挖掘`
- `2026-05-18 质量/估值基础因子挖掘`
- `2026-05-19 残差动量改造`
- `2026-05-19 质量驱动动量组合`

### 7.3 状态口径

任务状态只允许三种可见值：

| 可见状态 | 语义 |
| --- | --- |
| `待开始` | 任务尚未启动，展示预计候选数 |
| `进行中` | 正在执行，展示当前候选数和进度 |
| `已完成` | 本批任务完成，展示最终交付候选因子数 |

禁止在任务模块继续使用 `可推进`、`部分可用`、`可送检`、`待打分` 等混合状态。

### 7.4 任务字段

```ts
type FactorTaskStatus = "待开始" | "进行中" | "已完成";

type FactorTaskRow = {
  id: string;
  task_date: string;
  kind: "mining" | "refinement" | "composition";
  title: string;
  summary: string;
  status: FactorTaskStatus;
  delivered_candidate_count?: number;
  current_candidate_count?: number;
  expected_candidate_count?: number;
  target_layer: "L1" | "L2" | "L3";
  operator_chain?: Array<"MAD" | "N" | "Z" | "T">;
  parent_factor_ids?: string[];
};
```

## 8. 因子打分模块

因子打分是送检前决策层。通过打分的候选进入检疫候选池，打分失败的候选写入历史，不进入发布准入。

默认状态必须为 **收起态因子卡片**，主列表只展示：

- 日期
- 因子名
- 目标层
- 总分
- 2-3 个关键摘要标签，例如 `PASS`、`RankIC`、`Coverage`
- `详情` 按钮

卡片内不出现单因子 `送检` 或 `写入历史` 操作。人工操作统一收敛到底部 `一键送检` 按钮；自动化任务完成后应自动送检，不需要人工逐条点击。展开态不直接铺在主工作台里。点击 `详情` 后打开因子详情弹层，在弹层中展示完整打分明细和检疫明细。

### 8.1 指标分类

| 类别 | 指标 | 说明 |
| --- | --- | --- |
| 核心预测能力 | `RankIC`、`RankICIR`、分层收益单调性 | 判断信号强度和收益稳定性 |
| 信号稳定性与换手率 | 因子自相关、`IC Decay T+1/T+5/T+21`、换手率 | 判断实战性价比和执行难度 |
| 风险暴露与正交性 | `Style_Corr`、`Specific IC`、边际增量贡献 | 判断是否提供增量信息 |
| 数据健康度 | `Coverage`、`Missing Data Ratio`、PIT 时间戳 | 判断样本代表性和数据可用性 |

### 8.2 送检阈值

| 指标类别 | 指标名称 | 阈值建议 | 备注 |
| --- | --- | --- | --- |
| 效益 | `RankIC` | `> 0.025` | 核心收益能力 |
| 效益 | `RankICIR` | `> 1.5` | 收益稳定性 |
| 风险 | `Style_Corr` | `< 0.3` | 必须已执行 `N` 中性化 |
| 风险 | `Max_Drawdown` | `< 15%` | 单因子历史最差表现 |
| 成本 | `Turnover_Rate` | `< 20%` 单周 | 防止手续费磨损 |
| 质量 | `Coverage` | `> 95%` | 样本代表性 |

基础送检下限还应保留：

- `RankIC > 0.02`
- `ICIR > 0.5`
- `Coverage > 90%`

### 8.3 打分候选字段

```ts
type FactorScoringCandidate = {
  candidate_id: string;
  display_id: string;
  score: number;
  target_layer: "L1" | "L2" | "L3";
  submitted_at: string;
  collapsed_by_default: true;
  predictive_power: {
    rank_ic: number;
    rank_icir: number;
    monotonicity_score: number;
  };
  stability_turnover: {
    autocorrelation: number;
    ic_decay_t1: number;
    ic_decay_t5: number;
    ic_decay_t21: number;
    turnover_rate_weekly: number;
  };
  risk_orthogonality: {
    style_corr: number;
    specific_ic: number;
    incremental_ir: number;
    max_drawdown: number;
  };
  data_health: {
    coverage: number;
    missing_data_ratio: number;
    pit_timestamp_status: "PASS" | "WARN" | "FAIL";
  };
  submit_mode: "AUTO_AFTER_TASK" | "MANUAL_BULK";
  detail_modal_enabled: boolean;
};
```

## 9. 因子检疫模块

因子检疫主列表展示为 **检疫结果列表**，不在主工作台直接铺开所有检测项。历史搜索保留在结果列表上方，支持追溯历史拒绝因子记录与原因。

### 9.1 检疫结果列表

列表列定义：

| 字段 | 说明 |
| --- | --- |
| 日期 | 候选进入检疫的日期或批次时间 |
| 因子名 | 因子 ID 或候选表达式主名 |
| 结果 | `PASS`、`WARN`、`FAIL` |
| 原因 | 一句话说明准入、限仓、拒绝或归档原因 |
| 操作 | 仅保留 `详情` |

建议类型：

```ts
type FactorQuarantineResultRow = {
  candidate_id: string;
  submitted_at: string;
  factor_name: string;
  target_layer: "L1" | "L2" | "L3";
  quarantine_result: "PASS" | "WARN" | "FAIL";
  reason_summary: string;
  detail_modal_enabled: boolean;
};
```

### 9.2 详情弹层

点击 `详情` 后打开因子详情弹层，弹层包含两个主区：

1. **因子打分明细**：展示核心预测能力、稳定性与换手、风险与正交、数据健康度。
2. **因子检疫明细**：展示五大类检测和准入报告。

弹层规则：

- 弹层顶部展示送检日期、因子名、目标层、准入结论。
- `PASS / WARN / FAIL` 状态在弹层头部保持可见。
- 弹层内容可纵向滚动，主页面不应发生横向滚动。
- 点击遮罩或 `关闭` 按钮关闭弹层。

### 9.3 五大类检测

| 检测类 | 关键断言 |
| --- | --- |
| 样本外失效检测 | `IC_OOS / IC_IS > 60%`，最近 3-6 个月未见数据表现闭合 |
| 极端情景压力测试 | 2020-03、2022 回放；极端下跌日 Q5 回撤不超过 SPY 的 1.2 倍 |
| 正交性与共线性审计 | 加入 F3 后 `Incremental IR > 0.05`；若 90% 收益可被现有因子解释则拒绝上线 |
| 模拟盘数据质量检测 | PIT 完整性、收盘后计算时效、未来数据嫌疑、缺失值天数比例 `< 1%`、无逻辑跳空 |
| 交易成本与容量评估 | 换手率、滑点、流动性消耗；SP500 股票池 ADV 不低于 500 万美元 |

### 9.4 准入报告表

列定义：

| 列 | 说明 |
| --- | --- |
| 检测项 | OOS 衰减、正交性、极端压力、换手率、PIT 完整性等 |
| 结果 | 具体数值或比例 |
| 状态 | `PASS`、`WARN`、`FAIL` |
| Agent D 建议 | 发布、限制仓位、拒绝上线、重跑或归档建议 |

示例：

| 检测项 | 结果 | 状态 | Agent D 建议 |
| --- | --- | --- | --- |
| OOS 衰减 | `12%` | `PASS` | 样本内外一致性极高，可进入发布准入 |
| 正交性 | `0.22` | `PASS` | 与现有动量簇相关性低，增量信息有效 |
| 极端压力 | `-18.5%` | `WARN` | 2022 年表现一般，发布时需限制初始仓位 |
| 换手率 | `45%` | `FAIL` | 拒绝上线：调仓过频，摩擦成本过大 |
| PIT 完整性 | `99.4%` | `PASS` | 收盘后可按时完成计算，未发现未来数据依赖 |

### 9.5 历史检疫搜索

筛选项固定为三项：

| 筛选项 | 控件 | 说明 |
| --- | --- | --- |
| 日期 | 日期输入框 | 查询某一送检日期或检疫批次日期 |
| 因子名 | 文本框 | 支持因子 ID、候选名或表达式片段 |
| 结果 | 下拉框 | `全部结果`、`PASS`、`WARN`、`FAIL` |

不再在主筛选区展示任务类、目标层或规则版本筛选；这些字段保留在详情弹层或后续高级查询中。

```ts
type FactorQuarantineHistoryQuery = {
  date?: string;
  factor_name?: string;
  result?: "ALL" | "PASS" | "WARN" | "FAIL";
};
```

## 10. 发布准入规则

| 候选类型 | 检疫通过后的发布目标 | 必须保留 |
| --- | --- | --- |
| 改造因子 | L2 改造库 | `TRANSFORMED_FROM` 血缘、`operator_chain_json`、打分摘要、检疫报告 |
| 组合因子 | L3 组合库 | `COMPOSED_FROM` 血缘、父因子、投资逻辑、相关性/正交性审计 |

发布动作要求：

- `FAIL` 项不可发布。
- `WARN` 项可发布时必须展示限制条件，例如仓位限制、观察期或规则版本。
- 一键发布不可绕过检疫准入报告。
- 发布后写入治理审计，不重命名旧 canonical ID。

## 11. API 映射建议

### 11.1 `GET /factor-factory/overview`

```ts
type ApiFactorFactoryOverview = {
  profile: {
    status: "ACTIVE" | "PAUSED";
    schedule_time: "14:00";
    timezone: "Asia/Hong_Kong";
    next_run_at: string;
  };
  task_summary: {
    total_tasks: number;
    delivered_candidates: number;
    submitted_to_quarantine: number;
    publishable_count: number;
    rejected_history_count: number;
    hard_blocked_count: number;
  };
  publishable_factors: PublishableFactorRow[];
  task_rows: FactorTaskRow[];
  scoring_candidates: FactorScoringCandidate[];
  quarantine_result_rows: FactorQuarantineResultRow[];
  quarantine_report: FactorQuarantineAdmissionReport;
};
```

### 11.2 `POST /factor-factory/run-now`

沿用现有线上语义：

- 创建一次性 manual run。
- 不改变 `profile.status`。
- 默认 scope 使用当前启用配置。

### 11.3 `POST /factor-quarantine/publish`

建议入参：

```ts
type PublishQuarantinedFactorRequest = {
  candidate_id: string;
  target_layer: "L2" | "L3";
  quarantine_report_id: string;
  publish_mode: "single" | "bulk";
};
```

## 12. 组件清单

| 组件 | 责任 |
| --- | --- |
| `FactorFactoryHero` | 标题、自动化启动、暂停、立即运行 |
| `FactorFactoryStatusStrip` | 自动化状态、每日 GMT+8 14:00、下次批次、run-now 语义 |
| `PublishableFactorQueue` | `publishable_count > 0` 时展示，右上角统一一键发布，卡片只保留详情 |
| `FactorFactorySummaryGrid` | 运行摘要 KPI |
| `FactorTaskPanel` | 固定高度任务列表，因子挖掘类、改造类、组合类任务 |
| `FactorScoringPanel` | 精简收起打分卡片、阈值表、底部一键送检 |
| `FactorQuarantinePanel` | 检疫结果列表、历史查询、详情入口 |
| `FactorDetailModal` | 点击详情后展示因子打分明细和因子检疫明细 |
| `FactorPublishAdmissionCards` | L2/L3/历史检疫发布规则 |

## 13. Trace Matrix

| 需求 | HTML 落点 | 实现目标 |
| --- | --- | --- |
| 页面不要出现横向滚动条 | `html/body overflow-x:hidden`、`.design-canvas width:min(1960px,100%)`、响应式断点 | 任意视口不出现横向滚动 |
| 三个主模块固定高度 | `.panel height: var(--workbench-panel-height)` | 因子任务、因子打分、因子检疫同高 |
| 更多内容纵向滚动 | `.panel-body overflow-y:auto` | 内容多时只在模块内部滚动 |
| 仅改造因子工厂页 | HTML 只保留 factory route 页面 | 不改变 `#/factors` |
| 可发布因子名单优先 | `PublishableFactorQueue` | `publishable_count > 0` 时展示，右上角统一一键发布 |
| 发布因子卡片仅保留详情 | `PublishableFactorQueue .publish-card` | 卡片内无单独发布按钮 |
| 任务命名带日期 | `FactorTaskPanel` row title | `YYYY-MM-DD + 任务主题` |
| 任务状态统一 | `FactorTaskPanel` chip | 只出现 `待开始`、`进行中`、`已完成` |
| 展示候选交付数 | `FactorTaskPanel` 右侧数字 | 已完成显示最终交付候选数，进行中显示当前候选数 |
| 因子打分默认收起 | `score-card is-collapsed` | 主列表展示精简摘要，详情进入弹层 |
| 送检统一操作 | `panel-action-bar` | 底部只保留 `一键送检`，自动化任务自动送检 |
| 因子打分指标完整 | `FactorDetailModal` 打分明细 + 阈值表 | 覆盖预测能力、稳定性、风险正交、数据健康 |
| 因子检疫结果列表 | `quarantine-result-list` | 列为日期、因子名、结果、原因、操作 |
| 检疫操作仅详情 | `quarantine-list-row` | 操作列只保留 `详情` |
| 因子检疫五大类检测 | `FactorDetailModal` 五张 test card | OOS、压力、正交、模拟盘数据、成本容量 |
| 检疫准入报告 | 弹层内 `admission-report` | 检测项、结果、状态、Agent D 建议 |
| 详情弹层 | `.factor-detail-modal` | 点击详情展示打分明细和检疫明细 |
| 历史检疫筛选 | `search-row` | 仅包含日期、因子名文本框、结果下拉框 |
| 历史检疫可查 | `search-row` + history brief | 可搜索历史拒绝记录与原因 |
| 每日自动化 | Hero + status strip | GMT+8 14:00 |
| 立即运行 | Hero action | run-now 不改变自动化状态 |

## 14. 测试与验收

前端测试建议：

- `factor.factory.test.tsx` 断言页面只改造 `#/factors/factory`。
- 断言可发布因子名单仅在 `publishable_count > 0` 时出现，在摘要卡之前出现。
- 断言发布因子卡片只保留 `详情`，右上角存在唯一 `一键发布`。
- 断言任务名称包含日期。
- 断言任务状态集合只包含 `待开始`、`进行中`、`已完成`。
- 断言 `FactorTaskPanel`、`FactorScoringPanel`、`FactorQuarantinePanel` 使用固定高度，内容区存在纵向滚动能力。
- 断言因子打分卡片默认为精简收起态，并展示 `详情` 按钮。
- 断言因子打分模块底部存在 `一键送检`，单张卡片不出现 `送检` 按钮。
- 断言打分阈值表包含 `RankIC`、`RankICIR`、`Style_Corr`、`Max_Drawdown`、`Turnover_Rate`、`Coverage`。
- 断言因子检疫结果列表列名为 `日期`、`因子名`、`结果`、`原因`、`操作`。
- 断言因子检疫筛选项只包含 `日期`、`因子名`、`结果` 三项和 `查询` 按钮。
- 断言检疫结果列表操作列仅出现 `详情`。
- 断言点击 `详情` 打开弹层，弹层包含 `因子打分明细`、`因子检疫明细`、`Agent D 建议`。
- 断言 `一键发布` 仅对可发布候选启用。

UI Trace：

- 1960px：`http://127.0.0.1:4173/?v=<timestamp>#/factors/factory`
- 1366px：验证无横向滚动，工作台转为单列。
- 820px：验证 Sidebar 顶部化，表格行堆叠。
- DOM 几何：`scrollWidth <= clientWidth`。
- DOM 几何：三个主模块高度一致；`.panel-body.scrollHeight > .panel-body.clientHeight` 时只出现纵向滚动。
- DOM 交互：点击任一 `详情` 打开 `FactorDetailModal`，点击 `关闭` 或遮罩关闭。
- DOM 文案：`可发布因子名单`、`一键发布`、`一键送检`、`待开始`、`进行中`、`已完成`、`详情`、`日期`、`因子名`、`结果`、`因子打分明细`、`因子检疫明细`、`Agent D 建议`、`GMT+8 14:00`。

固定验证：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes
```

如后端契约同步实施，再运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1
```

## 15. 开放问题

1. 右上角一键发布是否需要二次确认弹层，并展示每个候选的目标层与审计摘要。
2. `WARN` 检疫项发布时，仓位限制是前端提醒还是后端必须写入 publish payload。
3. 历史检疫搜索是否需要导出准入报告。

## 16. CHANGELOG 候选

- **新增**：因子工厂顶部新增可发布因子名单，检疫通过的 L2/L3 因子支持一键发布。
- **新增**：因子打分与因子检疫卡片默认收起，点击详情弹层展示打分明细和检疫明细。
- **优化**：因子打分卡片精简为摘要列表，送检操作统一收敛到底部 `一键送检`，自动化批次完成后自动送检。
- **优化**：因子检疫模块改为结果列表，列为日期、因子名、结果、原因、操作，操作列仅保留详情。
- **优化**：因子检疫筛选项收敛为日期、因子名文本框和结果下拉框。
- **优化**：可发布因子名单仅在可发布数大于 0 时展示，因子卡片只保留详情，发布操作统一在右上角 `一键发布`。
- **新增**：因子打分模块补充 RankIC、RankICIR、单调性、稳定性、风险暴露、正交性、Coverage 与缺失率等送检指标。
- **新增**：因子检疫模块升级为准入报告，覆盖 OOS 衰减、极端压力、正交共线、模拟盘数据质量、交易成本与容量五大检测。
- **优化**：因子任务命名统一带日期，任务状态统一为待开始、进行中、已完成，并展示最终交付候选因子数。
- **优化**：因子任务、因子打分、因子检疫三块主工作台固定高度，超出内容改为模块内纵向滚动。
- **优化**：因子工厂设计画布改为最大 1960 宽度并响应式收缩，避免页面出现横向滚动条。
