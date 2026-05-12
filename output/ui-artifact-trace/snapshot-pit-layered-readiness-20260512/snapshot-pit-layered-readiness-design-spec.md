# 数据快照 / PIT 联动升级设计说明

## 1. Screen Summary

- 页面名称：`#/snapshots?tab=equity` 与 `#/pit-data`
- 用户画像：负责因子研究、数据治理与回测准入的研究员 / operator
- Job to be done：在进入 PIT、因子工厂和多因子策略创建前，快速判断“数据层是否就绪”“PIT 是否可回放”“哪些因子能正式诊断”
- 入口：左侧导航 `数据` 组中的 `数据快照` 与 `PIT 清洗中心`
- 成功状态：
  - 快照页能在首屏回答四层数据链的就绪度、异常点和因子点亮范围
  - PIT 页能在首屏回答四层数据进入点时回放后的准入等级、阻塞原因和可行动入口

## 2. Approved Direction

- Approved variant：`层级金字塔 + PIT 准入联动`
- 视觉方向摘要：
  - 延续 `factor-governance-20260505-v4-sidebar` 的白底侧栏、紧凑工作台和浅青色状态语法。
  - `#/snapshots` 从“股票 / 指数 / 权益篮子平行清单”升级为按 L1-L4 数据层组织的治理面。
  - `#/snapshots` 顶部标题区必须复用线上 `snapshots-header-card--standard` 的标题与 tab 语法：透明标题区、简短说明、同款胶囊 tab，不再自造状态 rail。
  - `#/pit-data` 保留当前门禁、下钻、规则工作台与研究豁免语义，但新增“因子诊断准入矩阵”，把 L1-L4 点时一致性直接映射成“正式可用 / 沙箱 / 受限 / 置灰”。
- 保留自 `DESIGN.md` 的部分：
  - 白底 sidebar 与 `#E6F4F1` 激活态
  - 紧凑标题区，不做营销式 hero
  - surface-first 的机构工作台节奏
  - `PIT 清洗中心` 只承载门禁、覆盖率下钻、身份修复、规则工作台和行动清单
- 本次有意改变的部分：
  - `数据快照` 的首屏主语从资产类型切成数据层级
  - 快照页新增“因子维度就绪矩阵”，不再只有 row count / member count
  - PIT 页新增“情绪 / 宏观 / 衍生品”三类 PIT 准入显示，不再只有价格型语义

## 3. Layout Anatomy

### Desktop structure

- `#/snapshots?tab=equity`
  - 线上同款标题区 + tab strip
  - 线上健康仪表盘模块
  - 仪表盘前四张卡替换为 L1-L4，保留“最新刷新”第五张卡
  - “查看明细”弹层改为按 L1-L4 展示覆盖、入库、待处理与影响因子
  - `1.1fr / 1fr / 1.1fr` 三栏工作站：数据层级 / 异常核查 / 因子维度就绪矩阵
  - 原始快照清单 dense rows
  - `1fr / 1fr` 双栏：数据源证据层 / 凭据与重启入口
- `#/pit-data`
  - 紧凑 hero
  - 研究豁免 banner
  - 4 张 L1-L4 PIT 准入卡
  - 运维指令 strip
  - `1fr / 1fr` 双栏：PIT 门禁摘要 / 因子诊断准入矩阵
  - `1fr / 1fr` 双栏：覆盖率下钻 / 点时异常核查与规则工作站
  - 门禁行动列表

### Tablet structure

- 侧栏压缩为 `92px`
- 快照页三栏工作站改为单列堆叠
- PIT 页双栏模块保持两列，卡片内部信息缩成单列

### Mobile structure

- 侧栏折为顶部导航块
- page padding 缩为 `20px`
- 所有指标卡、双栏、dense meta grid 改为单列
- 时间轴条形图从 `8` 栏收缩为 `4` 栏，保留趋势不追求精细刻度

### Grid, width, gutters

- page max width：`1660px`（对应 1960 桌面视口下的线上侧栏 + 主工作台宽度）
- desktop gutter：`16px`
- panel padding：`18px`
- hero padding：`24px 28px`
- cards / panels radius：`14px` 到 `20px`

### Empty, loading, error, long-content behavior

- 空态：使用业务语气，例如“当前层级暂无可正式诊断字段”，不出现教程式说明
- loading：保留当前页面的简洁 loading surface，不改成 skeleton 墙
- error：使用浅红 surface + 中文硬阻断说明 + fix target
- 长内容：dense row 元信息和矩阵文案允许换行，但按钮、status pill、chip 不允许被挤压变形

## 4. Design Tokens

### Color

```css
:root {
  --bg-page: #f0f2f5;
  --bg-surface: #ffffff;
  --bg-subtle: #f9fafb;
  --bg-accent-soft: #f4faf8;
  --bg-info-soft: #eef4ff;
  --bg-warning-soft: #fff7e8;
  --bg-danger-soft: #fff8f7;
  --bg-success-soft: #ecfdf3;
  --text-title: #111827;
  --text-main: #1f2937;
  --text-sub: #64748b;
  --text-muted: #94a3b8;
  --line: #e5e7eb;
  --line-strong: #d7e1e5;
  --primary: #1f877b;
  --primary-strong: #176b61;
  --primary-soft: #e6f4f1;
  --success: #2b8a3e;
  --warning: #b86813;
  --danger: #c45c4f;
  --info: #325aa8;
}
```

- `--primary / --primary-strong / --primary-soft`
  - 用法：导航激活态、主按钮、层级与路由强调
  - 备注：继续复用因子治理 v4 语言，不引入第二套蓝紫色主色
- `--success / --bg-success-soft`
  - 用法：Verified / Full Ready / 可正式使用
- `--warning / --bg-warning-soft`
  - 用法：待补、样本离散、研究态限制
- `--danger / --bg-danger-soft`
  - 用法：硬阻断、available_at 缺失、结构损毁
- `--info / --bg-info-soft`
  - 用法：Sandbox、Calibrating、Observe、Disabled 之外的冷静提示

### Typography

```css
:root {
  --font-body: Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif;
  --text-hero: 28px;
  --text-panel-title: 20px;
  --text-card-title: 17px;
  --text-body: 14px;
  --text-meta: 12px;
  --text-micro: 11px;
}
```

- 正文统一使用 body sans，不新增 display serif
- hero 标题：`28 / 34 / 700`
- panel 标题：`20 / 28 / 700`
- dense row 主标题：`17 / 22 / 700`
- 正文：`14 / 20-22 / 400`
- meta / chip / label：`11-12 / 16-18 / 600-700`
- monospace 仅保留给真实 id / route / field，如 `ds-fundamentals`、`Publish Date`

### Spacing, Radius, Border, Shadow

- panel gap：`16px`
- metric strip gap：`14px`
- page section gap：`18px`
- card radius：`14px`
- hero radius：`20px`
- border：`1px solid var(--line)`
- focus / highlight：`3px rgba(31, 135, 123, 0.12)` 外圈
- shadow：沿用轻量 `shadow-card`，避免 hover 弹跳式厚投影

## 5. Component Spec

### Page shell

- purpose：维持 repo 已批准的 sidebar + dense workbench 基调
- anatomy：brand / 4 导航组 / active route
- variants：
  - `数据快照` 激活
  - `PIT 清洗中心` 激活
- responsive：
  - `<1280px` sidebar 压缩为 icon-like text stack
  - `<768px` 变顶栏导航块
- accessibility：
  - active link 需要文字和背景双重提示
  - 触达高度不低于 `44px`

### Hero card

- purpose：先给 operator 当前判断，再给动作
- anatomy：
  - snapshots：`h1 + 一句话说明 + 线上同款 tab strip`
  - pit：`eyebrow / h1 / 状态胶囊 / 一句话说明 / meta chips / action row`
- states：
  - snapshots：不在标题区展示独立状态 rail
  - pit：`有限就绪`
- implementation hints：
  - snapshots hero 对应 [web/src/pages/snapshots-page.tsx](/C:/Fin/Grit_Strategy_Lab/web/src/pages/snapshots-page.tsx)
  - pit hero 对应 [web/src/pages/factors-page.tsx](/C:/Fin/Grit_Strategy_Lab/web/src/pages/factors-page.tsx)

### 股票健康仪表盘

- purpose：保留线上股票 tab 的总览模块与操作锚点，不重造新的首页首屏结构
- anatomy：
  - 左侧标题 `健康仪表盘` + 简短说明
  - 右侧保留 `刷新股票快照` 主按钮
  - 五张卡的固定顺序：`L1` / `L2` / `L3` / `L4` / `最新刷新`
- card rules：
  - 前四张卡只承担层级判断与一句原因，不再扩成独立小工作站
  - 第五张卡继续显示最新刷新时间与“查看明细”入口
- details modal：
  - 入口来自第五张卡
  - 弹层标题为“L1-L4 覆盖与刷新明细”
  - 表格列固定为：层级、对应快照、当前覆盖、本次入库、待处理、影响因子 / 说明

### L1-L4 metric card

- purpose：用统一卡片语法表达层级状态，而不是各自发明 KPI 卡
- anatomy：层级标签 / 主判断 / status pill / 一段原因 / 2 个 detail pills
- status values：
  - `Full Ready`
  - `待补强`
  - `观察`
  - `校准中`
  - `阻塞`

### 工作站 panel

- snapshots：
  - 数据层级工作站
  - 异常核查
  - 因子维度就绪矩阵
- pit：
  - PIT 门禁摘要
  - 因子诊断准入矩阵
  - 点时异常核查与规则工作站
- interaction：
  - header 右上只允许 chip，不加解释性提示文案

### Dense snapshot row

- purpose：承接原始快照清单，但每行必须回答“属于哪一层、对哪些因子有用、当前下一步是什么”
- required fields：
  - 快照 id
  - 最新刷新
  - 关键校验
  - 可点亮因子
  - 下一步
- allowed live substitutions：
  - 真实 refresh time
  - 真实 missing count
  - 真实 provider chain
- forbidden substitutions：
  - 用设计稿示例值伪装成 runtime 真相
  - 删除“可点亮因子”字段，只剩行数和状态

### 因子维度 / 诊断准入矩阵

- purpose：把快照状态或 PIT 状态直接翻译成研究员关心的“可算范围”
- anatomy：标题、短说明、`5` 行 family rows
- row fields：
  - 因子家族名
  - 依赖关系说明
  - status pill
- status values：
  - `Verified`
  - `Sandbox`
  - `Limited`
  - `Calibrating`
  - `Disabled`

### Research waiver banner

- purpose：明确研究豁免不会晋升正式状态
- anatomy：标题 / ignored symbol count / impact estimate / 撤销按钮
- states：
  - 有豁免时常显
  - 无豁免时完全不占位

### Coverage bucket card

- purpose：从 PIT 下钻里看清“缺什么、影响哪类因子、是否能豁免”
- anatomy：
  - bucket 标题
  - status pill / count
  - 3 个小指标
  - 时间轴条
  - sample chips
- required buckets：
  - 基础面发布时间戳晚到
  - 历史成员身份待解
  - 情绪字段 current-only

### Rule workstation

- purpose：把新增 L3 / L4 字段也纳入统一清洗逻辑，而不是只对收益率做 MAD
- tabs：
  - `MAD`
  - `3σ`
  - `ZScore Cap`
  - `Publish Date 对齐`
- required stats：
  - 剔除比例
  - 命中样本
  - 当前判断

### Action list

- purpose：把 blocker code 变成可行动入口
- anatomy：blocker code / fix text / action button
- route targets：
  - `#/snapshots?tab=equity&target=ds-fundamentals`
  - `#/snapshots?tab=equity&target=ds-analyst-consensus`
  - `#/snapshots?tab=equity&target=ds-option-skew`

## 6. Interaction Notes

- hover：
  - sidebar link、dense row、主按钮允许轻微边框或底色反馈，不做明显位移动画
- focus：
  - 所有按钮、tabs、links 都要有可见 focus ring
- disabled：
  - 用 opacity 降低 + cursor not-allowed，不允许只靠变灰文字
- loading：
  - 快照页和 PIT 页沿用当前 route 的 loading surface，不引入重型 skeleton
- validation：
  - snapshots 侧强调“源层未就绪”
  - pit 侧强调“可回放 / 可晋升 / current-only / available_at”

## 7. Accessibility Rules

- 正文与背景对比度不低于 `4.5:1`
- 状态不能只靠颜色，必须有文字
- button / chip / tabs 最小触达高度 `44px`
- dense rows 里的按钮需要可键盘访问，不能只在 hover 时出现
- section heading 语义保持顺序：hero `h1`，panel `h2/h3`

## 8. Implementation Notes

### Suggested component split

- `web/src/page-sections/snapshots-equity.tsx`
  - `DataLayerMetricStrip`
  - `SnapshotLayerWorkbench`
  - `SnapshotReadinessMatrix`
  - `SnapshotLedgerRow`
  - `SnapshotTrustEvidencePanel`
- `web/src/pages/factors-page.tsx`
  - `PitLayerMetricStrip`
  - `PitDiagnosticAdmissionMatrix`
  - `PitCoverageBucketCard`
  - `PitRuleWorkbench`
  - `PitActionList`

### Contract additions

- `GET /data-snapshots/overview`
  - `data_layer_readiness`
  - `snapshot_quality_alerts`
  - `factor_dimension_readiness`
- `GET /pit-data`
  - `pit_layer_readiness`
  - `factor_diagnostic_readiness`
  - `pit_quality_alerts`
  - `snapshot_layer_linkage`

### State model notes

- snapshots 判定“源层是否就绪”
- pit 判定“点时数据是否可回放、可诊断、可晋升”
- 同一类 status pill 必须在两个页面复用，不允许同义不同色

### File / prop naming

- 共享 token 建议放在现有 page CSS 变量前缀内，不新增第二套全局 token namespace
- 如果新增共享 presentational component，建议挂在 `web/src/components/data-readiness/`

## 9. Handoff Contract

- Frozen preview：
  - HTML 预览：[snapshot-pit-layered-readiness-preview.html](/C:/Fin/Grit_Strategy_Lab/output/ui-artifact-trace/snapshot-pit-layered-readiness-20260512/snapshot-pit-layered-readiness-preview.html)
- Canonical page keys：
  - `snapshots_equity_layered`
  - `pit_layered_readiness`
- Canonical routes：
  - `#/snapshots?tab=equity`
  - `#/pit-data`
- Preview access：
  - `snapshot-pit-layered-readiness-preview.html#/snapshots?tab=equity`
  - `snapshot-pit-layered-readiness-preview.html#/pit-data`
- Required viewports：
  - desktop `1960x2400`
  - mobile `430x2600`
- Required screenshot baselines：
  - `snapshots-equity-layered-readiness-desktop.png`
  - `snapshots-equity-coverage-modal-desktop.png`
  - `snapshots-equity-layered-readiness-mobile.png`
  - `pit-layered-readiness-desktop.png`
  - `pit-layered-readiness-mobile.png`
- Allowed live-data substitutions：
  - refresh timestamps
  - missing counts / covered counts
  - provider names / source chains
  - bucket examples and top symbols
- Not allowed：
  - snapshots 去掉“因子维度就绪矩阵”
  - pit 去掉“因子诊断准入矩阵”
  - 把凭据输入与 provider 证据搬进 PIT 页
  - 用通用 raw table 替代当前模块化工作台

## 10. DESIGN.md Follow-up

- 当前不改 `DESIGN.md`
- 如果用户确认采用这版方向，建议提升为系统级规则的只有两类：
  - `#/snapshots` 采用 L1-L4 数据层语言，不再只按资产类别组织治理
  - `#/pit-data` 与 `#/snapshots` 共享层级状态语法，但职责边界必须分离
- screen-specific 细节继续留在本 spec：
  - 哪些 bucket 在首屏出现
  - 哪些 blocker code 暴露为默认行动入口
  - 当前示例中的 counts / symbols / timestamps
