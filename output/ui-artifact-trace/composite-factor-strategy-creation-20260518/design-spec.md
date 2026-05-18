# 组合因子策略创建页 UI 稿 v1

生成时间：2026-05-18
目标路由：`#/factor-models/new?strategyType=COMPOSITE_FACTOR`
设计源：`DESIGN.md`、现有 `#/factor-models/new` 页面结构、上游合成因子策略方案
冻结稿：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\composite-factor-strategy-creation-20260518\composite-factor-strategy-creation.html`

## 1. 页面目标与用户

目标用户是因子研究员、策略配置员和投资组合工程师。页面用于把一个已完成 WNZT、S/A 级、L3 因子转换为可回测、可优化、可进入实盘约束评估的 `COMPOSITE_FACTOR` 策略版本。

核心任务：
- 从因子库带入单个合格 L3 因子，权重默认固定为 `100%`。
- 在股票池过滤阶段展示该因子的 Diagnostic Summary，尤其是最弱行业表现。
- 在权重映射阶段执行 Top-K、个股上限和行业硬上限。
- 保存可被后续回测、优化复用的策略参数快照。

## 2. 视觉方向

采用 GSL 现有后台工作台语言：浅灰页面底、白色业务面板、绿色主动作、紧凑的金融参数卡、右侧预检 rail。页面不是营销页，首屏直接进入配置工作台。

本稿选择“配置台 + 右侧预检栏”方向：
- 主列承载四步配置流程。
- 右侧 sticky rail 持续展示创建状态、阻塞项和参数快照。
- Diagnostic Summary 放在因子来源卡内，行业最弱表现放在第一步股票池过滤中。
- Sector Cap 放在第二步权重映射的核心区域，暴露截断前后差异。

## 3. 布局与响应式

桌面视口：
- 画布基准：`1440px` 宽。
- Shell：左侧导航 `236px`，内容区 `minmax(0, 1fr)`。
- 内容区：主列和右侧 rail，grid 为 `minmax(0, 1fr) / 348px`。
- Hero 采用 `minmax(0, 1fr) / 420px`，左侧标题，右侧关键参数。
- 主列每个步骤独立 panel，间距 `16px - 18px`。

平板：
- 左侧导航压缩到 `92px`。
- 主列与右侧 rail 改为上下堆叠。

移动：
- 隐藏左侧 shell。
- 页面 padding `16px - 18px`。
- 所有 grid 降为单列。
- 表格横向滚动，最小宽度 `640px`。

## 4. 色彩、字体、间距

沿用 GSL 现有设计 token：
- 主背景：`--gsl-bg-main: #F0F2F5`
- 面板背景：`--gsl-bg-surface: #FFFFFF`
- 主色：`--gsl-color-primary: #1F877B`
- 主色深色：`--gsl-color-primary-strong: #176B61`
- 成功：`--gsl-color-success: #2B8A3E`
- 警示：`--gsl-color-warning: #B86813`
- 风险：`--gsl-color-danger: #C45C4F`
- 边框：`--gsl-color-border: #E5E7EB`
- 主标题：`--gsl-text-title: #111827`
- 正文：`--gsl-text-main: #1F2937`
- 辅助文字：`--gsl-text-sub: #64748B`

字体：
- UI 字体：`Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif`
- ID/参数键：`"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`

圆角与阴影：
- 页面 panel：`16px`
- 控件卡片：`12px - 14px`
- pill/chip：`999px`
- 阴影：`0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)`

## 5. 组件清单与状态

| 区域 | 选择器 | 组件 | 必需状态 |
| --- | --- | --- | --- |
| 页面标题 | `[data-ui="page-hero"]` | Hero + 关键参数 KPI | 路由、策略类型、因子权重、默认持仓、行业上限、执行本金 |
| 因子来源 | `[data-ui="factor-source-panel"]` | 选中因子卡 | 合格、无合格因子、预填 factorId 不合格 |
| 诊断简报 | `[data-ui="diagnostic-summary-card"]` | 指标卡 | Rank IC、IR、覆盖率、单调性；缺失时显示诊断不可用 |
| 股票池过滤 | `[data-ui="universe-filtering-panel"]` | 参数卡 + 最弱行业 | 默认值、用户调整、API blocker |
| 最弱行业 | `[data-ui="worst-sector-summary"]` | 3 个行业风险卡 | `worst_sectors` 有值、缺少行业映射、诊断缺失 |
| 权重映射 | `[data-ui="weight-mapping-panel"]` | 方法选择 + 预览表 | `equal_top_k`、`score_proportional`、`risk_optimized_heuristic` |
| 行业硬上限 | `[data-ui="sector-cap-panel"]` | Toggle + 暴露条 | 开启、关闭、缺行业映射、容量不足 |
| Top 持仓 | `[data-ui="top-holdings-preview"]` | 持仓表 | 正常、空、行业截断、分摊增配 |
| 再平衡 | `[data-ui="rebalance-panel"]` | 两张约束卡 | 定时、阈值、两者同时启用 |
| 实盘约束 | `[data-ui="execution-panel"]` | 成本 KPI + 成本表 | 佣金、印花税、滑点、流动性冲击 |
| 创建状态 | `[data-ui="creation-readiness-rail"]` | Sticky rail | 全通过、warning、hard blocker、创建中 |
| 参数快照 | `[data-ui="payload-rail"]` | 参数摘要 | 与后端 payload 字段一致 |

## 6. 文案与数据映射

固定页面文案：
- 标题：`组合因子策略创建`
- Hero 描述：`基于已完成 WNZT 的 S/A 级 L3 因子生成可回测、可优化、可进入实盘约束评估的策略版本。`
- 步骤：`股票池过滤`、`权重映射`、`再平衡逻辑`、`实盘约束`
- 主按钮：`创建策略`，rail 主按钮：`创建并进入回测`

允许 live-data 替换的值：
- 因子名称、factor id、方向、等级、WNZT 状态。
- Diagnostic Summary 中的 `rank_ic`、`ir`、`coverage`、`monotonicity`、`worst_sectors`。
- 股票池过滤后的剩余股票数量。
- 权重映射方法、Top-K、行业上限、个股上限、残余现金。
- 行业暴露、Top holdings、执行成本预览。

不得直接泄漏的值：
- 原始 backend enum 未格式化标签。
- API blocker 原文英文错误。
- 原始 JSON 大对象。
- 诊断样本内部 ledger。

## 7. 交互规范

因子来源：
- 从 `#/factors` 点击“配置策略”进入时，自动选中该因子。
- 若 factorId 不合格，保留页面但显示 hard blocker，不自动降级到 demo 因子。

股票池过滤：
- `min_adv_usd` 可编辑。
- `exclude_suspended` 和 `delisting_window_days` 是显式控件。
- Diagnostic Summary 是只读上下文，不自动替用户排除行业。

权重映射：
- 三个 method 使用 segmented/option card。
- 行业硬上限默认开启，默认 `20%`。
- 开启后 preview 必须展示截断前最大行业、截断后最大行业、已重分摊权重和残余现金。
- 容量不足时 rail 显示 warning，但允许继续创建，除非后端返回 hard blocker。

创建提交：
- 提交前必须等待 preview 成功或显示明确 blocker。
- 提交 payload 必须包含 `strategy_type=COMPOSITE_FACTOR`。
- 创建成功后进入策略详情或回测提交页，按产品实现选择其一；本稿 rail 按“创建并进入回测”呈现。

## 8. 无障碍要求

- 每个配置步骤使用语义 section 和唯一 heading。
- 状态 rail 不能只靠颜色表达，通过、提示、阻塞必须有文字。
- 表格保留 `thead`，数字列可右对齐但必须可读。
- 移动端表格允许横向滚动，不能压缩到文字重叠。
- 创建按钮禁用时需要可见原因，不能只变灰。

## 9. UI Trace Matrix

| 需求 | 设计落点 | 文件/选择器 | 验收方式 |
| --- | --- | --- | --- |
| 仅支持合格 L3 因子 | 因子来源卡 + 准入 chip | HTML `[data-ui="selected-factor-card"]`，实现页 `FactorModelBuilderPage` | 前端筛选 + 后端 create/preview 拒绝不合格因子 |
| 默认因子权重 100% | Hero KPI 和因子卡 | `[data-ui="page-hero"]` | DOM 文本与 payload `weights=100` 一致 |
| 股票池过滤 | Step 01 参数卡 | `[data-ui="universe-filtering-panel"]` | 修改参数触发 preview，后端返回过滤结果 |
| Diagnostic Summary | 因子卡右侧诊断摘要 | `[data-ui="diagnostic-summary-card"]` | 选中因子后渲染 `latest_diagnostic_summary` |
| 最弱行业表现 | Step 01 行业风险卡 | `[data-ui="worst-sector-summary"]` | 渲染 `worst_sectors`，无行业映射显示明确状态 |
| 权重映射三种方法 | Step 02 左侧 option card | `[data-ui="weight-mapping-panel"]` | 切换 method 后 payload 和 preview 改变 |
| 行业硬上限 20% | Step 02 Sector Cap panel | `[data-ui="sector-cap-panel"]` | 行业暴露最大值不超过 20%，容量不足显示现金 warning |
| 再平衡逻辑 | Step 03 两张约束卡 | `[data-ui="rebalance-panel"]` | payload 包含 `monthly_start` 与 `exit_rank_percentile=20` |
| 实盘约束 | Step 04 成本表 | `[data-ui="execution-panel"]` | 回测成本扣减与 preview 一致 |
| 创建后流程 | 右侧创建 rail | `[data-ui="creation-readiness-rail"]` | 创建成功后可进入回测、优化路径 |

## 10. 实现备注

建议前端拆分：
- `CompositeFactorBuilderPage` 作为 `FactorModelBuilderPage` 的 mode 分支或轻量 wrapper。
- `DiagnosticSummaryCard` 读取 `ApiFactorDiagnosticSummary`。
- `SectorCapPreview` 读取 `weight_mapping_preview.sector_exposures`。
- `CompositeFactorReadinessRail` 聚合 preview 状态、warnings、hard blockers。

建议 payload 最小形态：

```ts
{
  strategy_type: "COMPOSITE_FACTOR",
  components: [{ factor_id, weight: 100, direction }],
  universe_filtering: {
    min_adv_usd: 5000000,
    exclude_suspended: true,
    delisting_window_days: 30
  },
  weight_mapping: {
    method: "equal_top_k",
    top_k: 50,
    max_position_pct: 2,
    sector_cap_enabled: true,
    sector_cap_pct: 20,
    sector_field: "gics_sector"
  },
  rebalance_logic: {
    schedule: "monthly_start",
    threshold_enabled: true,
    exit_rank_percentile: 20
  },
  execution_constraints: {
    notional_usd: 10000000,
    commission_bps: 1.5,
    stamp_tax_bps: 0,
    slippage_base_bps: 2.5,
    impact_coefficient_bps: 8,
    max_impact_bps: 75
  }
}
```

## 11. 截图基线

必需截图：
- 桌面：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\composite-factor-strategy-creation-20260518\composite-factor-strategy-creation-desktop.png`
- 移动：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\composite-factor-strategy-creation-20260518\composite-factor-strategy-creation-mobile.png`

截图检查点：
- 首屏能看到标题、四步流程、因子摘要和创建按钮。
- Sector Cap 区域可见 20% 上限、截断前后指标、行业暴露条。
- 移动端无文字重叠，表格以横向滚动承载。

## 12. 待确认事项

- 本稿不更新 `DESIGN.md`，因为这是单屏 UI 方案，需等用户确认后再提炼可复用规则。
- 行业硬上限默认开启 20%，若产品希望默认关闭，需要同步修改 hero KPI、rail 和 payload 默认值。
- 创建成功后的默认跳转在本稿中设为“进入回测”，实现时可按现有策略创建流统一到策略详情页。
