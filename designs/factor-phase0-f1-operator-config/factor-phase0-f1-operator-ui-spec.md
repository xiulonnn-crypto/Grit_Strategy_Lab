# Phase 0 F1 原始库与因子工厂配置 UI Spec

状态：文案优化稿
设计包：`factor-phase0-f1-operator-config`
参考稿：`C:\Fin\Grit_Strategy_Lab\artifacts\grit-design\factors-phase1-f1-f2-f3-ui.html`

## 1. 页面目标

本次设计覆盖两个页面面向：

- `#/factors`：沿用 F1/F2/F3 分层结构，当前冻结 `F1 原始库` tab。
- `#/factors/factory`：新增因子工厂配置弹层，覆盖算子、窗口、字段准入、运行预算和快照输出。

核心目标：让 PIT 数据、F1 原始字段、算子可调用字段形成稳定台账。页面不评价 Alpha 表现，只呈现数据准入、阻塞、时点和快照引用。

## 2. 文案口径

可见文案统一使用简洁的中文金融治理语言：

- 用“字段、准入、覆盖率、时点、来源、阻塞、快照、预算”等台账词汇。
- 避免说明书式长句，优先使用短句和状态标签。
- 保留真实工程标识：`factor_id`、`available_at`、`DATA_SOURCE_BLOCKED`、`TS_Return`、快照 ID。
- F1 页面不出现 IC/IR 作为准入门槛，只在准入口径里声明“不设 IC 门槛”。

## 3. Canonical 页面键

- HTML 预览：`factor-phase0-f1-operator-ui-preview.html`
- F1 截图参数：`?screen=f1`
- 工厂弹层截图参数：`?screen=factory`
- 桌面基线视口：`1960 × 1420`
- 实现路由：`#/factors`、`#/factors/factory`

## 4. F1 原始库布局

### 4.1 页面结构

1. Shared sidebar：沿用现有侧栏，当前项为 `因子库`。
2. Hero：标题 `因子库`，副文案为“按 F1/F2/F3 管理因子资产。F1 只校验 PIT、覆盖率、可得时点与数据阻塞。”
3. Layer tabs：`F1 原始库` active；`F2 改造库`、`F3 组合库` inactive。
4. KPI cards：`F1 原始字段`、`可调用字段`、`源阻塞字段`、`时点缺口`。
5. Main panel：`F1 原始字段目录`，包含批次条、筛选条、dense table。
6. Bottom audit：`F1 准入口径` 与 `快照追踪`。

### 4.2 表格列

| 列名 | 字段建议 | UI 要求 |
| --- | --- | --- |
| 字段 | `factor_id`, `name`, `category` | 中文名 + 稳定 ID + 简短类别 |
| 层级 | `pit_layer` | L1/L2/L3/L4 chip |
| coverage | `coverage_ratio`, `missing_symbol_count` | 百分比 + 进度条 + 缺口摘要 |
| 可得时点 | `publish_date_rule`, `available_at_rule` | 短句表达时点规则 |
| 缺失/阻塞 | `missing_policy`, `blocker_code` | 明确 NaN、阻塞和观察状态 |
| 来源 | `source_refs` | 展示供应商表或依赖字段 |
| 准入 | `admission_state` | 可调用、审慎可调用、观察池、暂不可调用 |
| 更新 | `last_updated_at`, `run_id` | 时间 + 批次引用 |

### 4.3 准入状态

- `READY`：可调用。
- `READY_WITH_WARNING`：可调用，但保留 warning。
- `OBSERVE`：观察池，不默认展开算子。
- `DATA_SOURCE_BLOCKED`：暂不可调用，不参与表达式展开。
- `MISSING_TIMING`：缺少 `publish_date` 或 `available_at`，不进入默认算子池。

## 5. 因子工厂配置弹层

### 5.1 入口

`#/factors/factory` 页面点击 `工厂配置` 打开 modal。弹层在当前页内打开，关闭后保留页面上下文。

### 5.2 弹层结构

- Header：`因子工厂配置`，说明保存后生成可复现快照。
- Left rail：`算子注册表`、`窗口空间`、`字段准入`、`运行预算`、`输出快照`。
- Main：核心算子库与启用状态。
- Right rail：引用快照、准入规则、运行预算。
- Footer：`取消`、`保存草稿`、`生成配置快照`。

### 5.3 默认配置

默认启用：

- `TS_Return`
- `TS_Rank`
- `TS_Corr`

默认禁用但登记展示：

- TS：`TS_Mean`、`TS_Std`、`TS_Max`、`TS_Min`、`TS_Delta`、`TS_Skew`、`TS_Kurt`
- CS：`CS_Rank`、`CS_ZScore`、`CS_Scale`、`CS_Neutral`
- 多元：`TS_Cov`、`Reg_Slope`、`Reg_Resid`
- 非线性：`Sign`、`Abs`、`Log`、`If_Then_Else`、`Signed_Power`
- 技术：`Decay_Linear`、`High_Day`、`Sum_Out_Of`

默认窗口空间：`[3, 5, 10, 21, 63, 126, 252]`
默认挖掘深度：`2`

### 5.4 快照合同

生成配置快照时必须写入：

```json
{
  "operator_config_snapshot_id": "op_cfg_YYYYMMDD_HHMM",
  "f1_catalog_snapshot_id": "f1_catalog_snapshot_YYYYMMDD_HHMM",
  "enabled_operators": ["TS_Return", "TS_Rank", "TS_Corr"],
  "window_space": [3, 5, 10, 21, 63, 126, 252],
  "default_depth": 2,
  "min_periods_policy": "operator_default",
  "blocked_field_policy": "exclude_data_source_blocked"
}
```

后续 factory run 只引用快照 ID，不读取运行态草稿。

## 6. 视觉与组件规则

### 6.1 色彩

```css
:root {
  --bg-main: #f0f2f5;
  --bg-surface: #ffffff;
  --primary: #1f877b;
  --primary-soft: #e6f4f1;
  --blue: #4c78c7;
  --blue-soft: #eef4ff;
  --success: #2b8a3e;
  --success-soft: #ecfdf3;
  --warning: #b86813;
  --warning-soft: #fff7e8;
  --danger: #c45c4f;
  --danger-soft: #fff8f7;
  --border: #e5e7eb;
  --text-title: #111827;
  --text-main: #1f2937;
  --text-sub: #64748b;
}
```

### 6.2 字体

- Body：`Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif`
- Hero title：`26px / 30px / 700`
- Panel title：`17px / 22px / 700`
- Table body：`13px / 18px`
- Meta / chip：`12px / 18px / 700-800`
- ID / snapshot：monospace，`11-12px`

### 6.3 间距与形态

- Page padding：desktop `30px`，mobile `20px`
- Section gap：`14-16px`
- Button radius：`8px`
- Table wrapper radius：`12px`
- Tab radius：`14px`
- Panel / card radius：`16px`
- Hero / modal radius：`18px`

## 7. 交互

- F1/F2/F3 tabs：切换层级时保留筛选上下文，表格列按层级替换。
- F1 筛选：支持层级、覆盖率、未来函数、阻塞状态和字段搜索。
- `查看预处理记录`：打开对应 PIT batch 详情。
- `导出目录`：导出当前筛选结果与目录快照 ID。
- Operator toggle：写入草稿态，不影响已排队运行。
- `保存草稿`：仅保存 UI 草稿。
- `生成配置快照`：触发校验并返回 `operator_config_snapshot_id`。
- Modal close：草稿有变更时需要确认放弃。

## 8. 响应式

- `>=1280px`：保留 sidebar、四 KPI、三列配置弹层。
- `1024-1279px`：sidebar 收窄，底部审计模块单列，弹层右 rail 可折叠。
- `768-1023px`：KPI 两列或单列，表格横向滚动。
- `<768px`：隐藏 sidebar，modal 全屏化，footer 按钮换行。

## 9. 验收矩阵

| 要求 | 组件建议 | 验收方式 |
| --- | --- | --- |
| F1 tab 单独表格 | `FactorLayerTabs` + `F1RawCatalogTable` | `#/factors?layer=F1` 截图与 DOM 文案检查 |
| coverage/available_at/blocker 可见 | `F1RawCatalogRow` | 每行显示覆盖率、时点、阻塞 |
| L1 缺失不填 0 | `missing_policy`, `blocker_code` | DATA_SOURCE_BLOCKED 行保持 NaN 语义 |
| F1 不设 IC 门槛 | `F1AdmissionRulesPanel` | 准入口径显示“不设 IC 门槛” |
| 算子配置可快照引用 | `FactorFactoryConfigModal` | 保存返回 `operator_config_snapshot_id` |
| 默认只启用 3 算子 | `OperatorRegistryTable` | TS_Return/TS_Rank/TS_Corr toggle on，其余 off |

## 10. 待确认

- F1 计数需以后端 `f1_catalog_snapshot` 合同为准。
- 工厂配置是否支持多 profile 并存，留到 Phase 1 决策。
- 移动端 Phase 0 只保证可读、可关闭、可保存草稿。
