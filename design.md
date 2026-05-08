# GSL 设计系统

> 状态：当前运行中 UI 的视觉真源，基于 2026-04-09 本地运行页面与 2026-04-28 Compose First 源码 / trace matrix 同步
> 取样依据：`http://127.0.0.1:4173/#/workspace` 同批核心路由截图、当前 `web/src` 实现、`ARCHITECTURE.md`、`output/ui-artifact-trace/phase1-2-trust-matrix.md`
> 来源优先级：2026-04-09 live captures + 2026-04-27 Phase 1.2 approved trace > `web/src/*.css` / `web/src/*.tsx` > `docs/GSL_UI_V1_PLAN.md`
> 范围：`workspace`、`compositions`、`legs`、`composition-workbench`、`composition-detail`、`creation-template`、`creation-session`、`strategy-detail`、`backtest submit`、`runs-index`、`run-detail`、`snapshots`、`optimization`

## 1. 设计定位

- **产品角色**：GSL 是桌面优先的研究工作台，服务“创建策略、发起回测、判断结果、继续调优”的连续链路。
- **当前气质**：不是偏冷硬的终端 UI，也不是消费级 SaaS，而是“浅雾灰底 + 白卡 + 青绿色强调”的研究操作台。
- **核心感受**：理性、轻盈、低噪音、可信，允许一点柔和感，但不能软塌、甜腻或营销化。
- **主任务**：每个页面都要回答三件事，当前是什么、为什么可信、下一步做什么。
- **非目标**：不做霓虹、紫色渐变、玻璃拟态首页、不做厚投影卡片墙、不做宣传型 hero。

## 2. 视觉方向

### 2.1 现行风格关键词

- **浅雾灰底**：全局背景是冷灰白，不是暖米色，也不是纯白铺满。
- **白卡为主**：主要内容放在白色面板中，使用极轻边框和淡阴影建立层级。
- **青绿色主色**：主按钮、激活导航、正向状态、主策略线统一用青绿色，不再使用更深更硬的墨绿。
- **柔和圆角**：常规面板 16-18px，创建链路与模板卡放宽到 20-28px。
- **轻渐变允许**：只允许出现在 hero 卡、创建链路和图表底板上，作用是提气，不是做秀。
- **局部悬浮允许**：compare dock、tooltip、模态允许轻微 blur 和浮层感，但不能扩散成全站玻璃风。

### 2.2 页面共性

- 顶部优先是 **page heading / hero card**，而不是裸标题。
- CTA 不追求巨大按钮，而是 1-2 个主动作 + 1-2 个辅助动作。
- 信息卡都更像“研究卡片”而不是“销售卡片”，文字短、结构明、密度稳定。
- 数据页面把色彩让给状态和趋势，装饰面积极少。

## 3. Token 基线

### 3.1 颜色

| Token | 值 | 用途 |
| --- | --- | --- |
| `--gsl-bg-main` | `#F0F2F5` | 全局背景 |
| `--gsl-bg-surface` | `#FFFFFF` | 主卡、表格、模态背景 |
| `--gsl-bg-surface-soft` | `#FBFCFD` | hero / 特殊面板轻渐变顶色 |
| `--gsl-bg-subtle` | `#F9FAFB` | 次级容器、表头、轻提示区 |
| `--gsl-bg-accent-soft` | `#F5FBF8` | hover / 轻强调底色 |
| `--gsl-color-primary` | `#1F877B` | 主按钮、激活导航、主策略线、正向值 |
| `--gsl-color-primary-strong` | `#176B61` | hover、强强调、深色条 |
| `--gsl-color-primary-soft` | `#E6F4F1` | 激活导航底、正向 badge、轻绿色底 |
| `--gsl-color-benchmark` | `#4C78C7` | 基准线、第二比较线、OOS 辅助语义 |
| `--gsl-color-success` | `#2B8A3E` | 成功状态文字、运行正常点 |
| `--gsl-color-success-soft` | `#ECFDF3` | 成功背景 |
| `--gsl-color-warning` | `#B86813` | 警告文字、待确认状态 |
| `--gsl-color-warning-soft` | `#FFF7E8` | 警告背景 |
| `--gsl-color-danger` | `#C45C4F` | drawdown、错误、失败 |
| `--gsl-color-danger-soft` | `#FFF8F7` | 风险 / 错误背景 |
| `--gsl-color-border` | `#E5E7EB` | 默认边框 |
| `--gsl-color-border-soft` | `#EEF2F4` | 表格分隔、弱边框 |
| `--gsl-color-border-strong` | `#D7E1E5` | hover / active 边框 |
| `--gsl-text-title` | `#111827` | 标题、关键数字 |
| `--gsl-text-main` | `#1F2937` | 正文、主数据 |
| `--gsl-text-sub` | `#64748B` | 说明、次级标签 |
| `--gsl-text-muted` | `#94A3B8` | 时间、版本、弱辅助文字 |

### 3.2 颜色使用规则

- 正收益、已完成、主趋势默认走 **青绿色**，不再用旧版文档里的偏红收益色。
- 风险和 drawdown 才用 **暖红**，不要把“正值”和“风险”混成同一色相体系。
- 基准、对照、样本外辅助线统一走 **蓝色**，避免再引入第三套比较色。
- 页面主色出现频率要克制，青绿色负责“方向”和“动作”，不负责铺满页面。

### 3.3 圆角 / 边框 / 阴影

| 层级 | 值 | 用途 |
| --- | --- | --- |
| `radius-pill` | `999px` | 状态胶囊、tab、chips |
| `radius-field` | `12px - 14px` | 输入框、轻量按钮、子卡片 |
| `radius-panel` | `16px` | 默认 panel、表格 shell、模态 |
| `radius-card` | `18px` | workspace 卡、run-detail KPI 卡、dock |
| `radius-hero` | `24px - 28px` | 创建链路 hero、模板卡、创建标题卡 |
| `border-default` | `1px solid #E5E7EB` | 默认边框 |
| `shadow-card` | `0 1px 3px 0 rgba(0,0,0,0.05), 0 1px 2px 0 rgba(0,0,0,0.06)` | 默认卡片阴影 |
| `shadow-float` | `0 16px 36px rgba(15,23,42,0.12)` | compare dock、明显浮层 |
| `shadow-soft-lift` | `0 18px 40px rgba(17,24,39,0.06)` | 模板卡、创建家族大卡 |

### 3.4 Spacing

- **基准单位**：`4px`
- **常用节奏**：`8 / 12 / 14 / 16 / 18 / 20 / 24 / 28 / 32`
- **页面主 padding**：桌面 `32px`，移动 `20px`
- **常规 panel 内边距**：`18px - 24px`
- **hero / heading card 内边距**：`24px - 28px`
- **卡片栅格 gap**：`12px - 16px`

### 3.5 动效 / 层级

| Token | 值 | 用途 |
| --- | --- | --- |
| `motion-fast` | `140ms ease` | hover、按钮、chip |
| `motion-medium` | `160ms ease` | 卡片 hover、导航切换 |
| `motion-overlay` | `120ms - 140ms ease` | tooltip、dock、轻浮层 |
| `hover-lift` | `translateY(-1px)` | 卡片和按钮 hover |
| `layer-dock` | `8` | workspace compare dock |
| `layer-modal` | `100` | 模态、compare cockpit |

- 默认 hover 只允许轻抬 1px，不允许夸张位移。
- blur 只允许用于 dock / tooltip / modal，不要扩展到页面主体。

## 4. 字体排印

### 4.1 字体栈

- **UI / Body**：`Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif`
- **Monospace / IDs**：`"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`
- **原则**：全站不引入装饰字体，信息密度靠字重和间距，不靠换字体风格。

### 4.2 字号层级

| 角色 | 尺寸 / 行高 | 字重 | 用途 |
| --- | --- | --- | --- |
| `page-heading` | `28 / 34` | `700` | 顶部主标题、创建页标题 |
| `hero-title` | `28 - 38 / 1.18` | `700` | run-detail / hero 大标题 |
| `section-title` | `20 / 28` | `700` | 主面板标题 |
| `card-title` | `16 / 22` | `700` | 策略卡、快照卡、候选卡标题 |
| `body` | `14 / 22` | `400` | 正文说明 |
| `body-strong` | `14 / 22` | `600` | 按钮、重点标签 |
| `meta` | `12 / 18` | `600` | 状态、日期、版本、字段来源 |
| `micro` | `11 / 16` | `600` | eyebrow、极细辅助标签 |
| `metric-xl` | `24 / 28` | `600` | KPI 数值 |
| `run-id` | `12 / 16` | `500` | run id、version id、snapshot id |

### 4.3 文字规则

- 标题保持直接，不写营销 headline。
- 次级说明统一用 `#64748B` 左右的 slate gray，不混多套灰。
- run id、snapshot id、parameter version、时间窗口标签优先 monospace。
- 不做通篇大写英文标签，也不做海报式排版。

## 5. 布局规则

### 5.1 应用外壳

- Sidebar 桌面宽度 `240px`，`<1280px` 压缩到 `92px`，`<767px` 折成顶部区块。
- Sidebar 纯白底，激活态用 `#E6F4F1` + 左侧深青绿色内嵌线。
- Sidebar 导航组固定为 `组合 / 策略 / 因子 / 数据`。因子组当前只展示 `因子库` 与 `因子工厂`；`因子工厂` 合并原 `挖掘沙盒` 与 `检疫工作台`，旧 `#/factors/sandbox` 和 `#/factors/quarantine` 作为兼容入口进入同一页对应分区。详情、编辑器和多因子策略创建从因子库或治理动作进入。数据组固定保留 `PIT 清洗中心` 与 `数据快照`，`#/snapshots` 页面结构本期不调整。
- Topbar 高度 `80px`，背景纯白，底边线清晰，不做整条玻璃感。
- 主内容区使用 `32px` padding，并统一放进 page-shell 中。

### 5.2 路由级布局

| 路由 | 当前布局 | 说明 |
| --- | --- | --- |
| `#/workspace` | 健康度头卡 + `1.05fr / 0.95fr` 双栏 | 左侧 2x2 策略卡，右侧最近回测列表 |
| `#/compositions` | 组合 hero + 3 指标卡 + `1.06fr / 0.94fr` 双栏 | 左侧正式组合卡 / 待处理动作，右侧最近活动 / 组合观察 |
| `#/legs` | 资产库 hero + 4 指标卡 + 工具栏 + dense table + 右侧 drawer | 策略腿、资产腿、现金腿统一在一张来源清单里管理 |
| `#/compositions/workbench` | hero + `0.88fr / 1.18fr / 0.74fr` 三栏工作台 + 下方预览双栏 | 左来源库，中组合结构与权重，右成立性评分、信任摘要和保存 dock |
| `#/compositions/:id` | hero + 7 KPI + `1.78fr / 330px` 主区 + rail | 主区展示收益流 / 归因 / 相关性 / 情景，右 rail 展示来源签名、成本、审计与深入入口 |
| `#/compositions/:id/backtest-runs/new` | heading card + 配置摘要 + 规则面板 | 回答“怎么测稳定性”，包含版本、周期、再平衡、成本、缺失数据和预检摘要 |
| `#/compositions/:id/backtest-runs/:runId` | 裁决 hero + Diagnosis / Orders / Evidence tabs + 诊断 3:1 图表 / 指标 rail | 结果页拆分诊断、执行订单和证据存证，诊断首屏左侧保留大面积曲线，右侧集中年化、夏普、回撤和覆盖核心指标 |
| `#/compositions/backtest-runs` | hero + 4 指标卡 + 筛选表格 + 330px 压力场景 rail | 表格列固定为组合名、时间周期、状态标签、压力窗口、年化收益、夏普、回撤和查看；筛选与压力场景点击必须联动列表、URL 与右侧当前窗口 |
| `#/compositions/:id/allocation-lab` | heading card + 意图导航 + 风险边界 + 资产微调 | 回答“我要怎样分配风险预算”，默认用意图选择代替算法填表 |
| `#/compositions/:id/allocation-jobs/:jobId` | 结果 hero + 有效前沿 + 候选卡 | 展示 Current / Benchmark、候选高亮、ENB、扣费后夏普和迁移成本 |
| `#/strategies` | 策略库 hero + 摘要指标 + 策略表格 + 新建策略弹层 | 入口可见名称为“策略库”；表格展示策略名、版本、类型、10Y/20Y/30Y 年化收益/夏普、状态与查看/回测/优化动作；收益列与状态只按当前参数版本的回测证据计算，历史版本回测不能回填当前版本；缺失长期回测以“一键生成”文字链进入对应周期回测创建页；创建类型选择只在弹层内出现 |
| `#/creation/asset-allocation/new` | heading card + `minmax(0, 1.42fr) / 362px` 配置工作台 | 单页完成资产配置型策略参数；左侧标的、权重、推荐权重，右侧执行方式、再平衡与成本模拟；标的与基准从数据快照选择；不使用步骤条 |
| `#/creation/sessions/:id` | 标题卡 + `1.05fr / 0.95fr` 双栏 | 左对话，右 sticky 步骤/字段编辑 |
| `#/strategies/:id` | heading card + action hero + 两层双栏 | 上层摘要/版本，下层最近回测/下一步 |
| `#/strategies/:id/backtest-runs/new` | hero + 单大 panel + 3 列子卡 | 当前不是左右双栏，而是三段确认区 |
| `#/runs` | heading card + 单表格卡 | 表格密度高但边框轻 |
| `#/runs/:id` | hero + 5 KPI 卡 + `1.82fr / 340px` 主区 + tabs | 图表与判断轨是页面主体 |
| `#/pit-data` | 紧凑标题 + PIT 清洗总览 + 覆盖率下钻 + 规则预览 + 门禁行动列表 | 数据组的一期入口，服务因子诊断；价格阻塞可跳转并高亮数据快照，Limited Ready 只用于研究态诊断 |
| `#/factors` | 紧凑标题 + 4 指标 + 线上/已下线 tab + 筛选工具栏 + 因子 dense table + 语义聚类热力区 | 对外名称为“因子库”，基于当前 tab 展示因子、来源、诊断状态、最近诊断、因子级别、下线审计、治理任务、相关性聚类和双因子指纹比对 |
| `#/factors/new` | 紧凑标题 + 因子编辑表单 + 诊断预览 | 用类 Excel 公式录入人工因子，保存前可查看诊断预览 |
| `#/factors/factory` | hero + 自动化状态 + 因子漏斗 + 挖掘队列 + 自动送检/自动检疫 + 检疫队列 + Auto-Residual + 回撤闸门 + 发布审计 | 承载 D1/D2 因子工厂；启动自动化为每日 `GMT+8 14:00`，立即运行为一次性 run；候选必须自动进入 D2 检疫并执行检疫，不直接进入正式因子库 |
| `#/factors/sandbox` | 因子工厂兼容入口，默认选中挖掘队列分区 | 保留旧链接，不再作为主导航独立入口 |
| `#/factor-models/new` | hero + 因子选择篮子 + 权重/方向 + 打分预览 + 策略门禁 | 承载 F1 多因子策略创建，支持行业中性化配置；创建成功后进入既有策略详情页 |
| `#/factors/quarantine` | 因子工厂兼容入口，默认选中检疫与发布分区 | 保留旧链接；PIT 非 Full Ready 仅作为诊断证据和风险提示，不单独阻断发布 |
| `#/factors/:id` | 紧凑标题 + 诊断概览 + 报告动作 | 展示因子逻辑、PIT 门禁、IC/IR、风险提示和报告导出 |
| `#/snapshots` | heading / tabs + 股票全局工作站或债券治理工作站 | 股票保留全局健康 / 诊断结构；数据可信层放在股票页最下方，并使用独立的数据源证据卡片表达；卡片文案使用简洁中文金融口径，按价格主链、成分历史、长周期补价、身份确权、关键精修解释证据范围与门禁边界，不直接展示 raw trust tier 或英文枚举；缺失 API_KEY / 本机配置统一汇总到底部选择器，选择后只展示对应输入与复制设置加重启命令入口，并明确提示需在启动 QuickStart 的同一个 PowerShell 中执行。输入值只在当前浏览器标签页暂存，刷新保留，关闭标签页或点击清空删除；不提交后端、不落库、不改变 provider 状态。债券 tab 连接资产腿创建、质量审计与 raw registry |
| `#/optimization-jobs/:id` | heading card + job hero + 候选列表 panel | 有 compare 入口，但默认不常驻 compare 区 |

### 5.3 响应式边界

- `>= 1280px`：完整桌面布局，保留所有双栏和 rail。
- `1024px - 1279px`：侧栏压缩，workspace/run-detail 开始收紧。
- `768px - 1023px`：创建页、策略页、run-detail 改为单列堆叠。
- `< 768px`：page padding 缩到 `20px`，保留读数和主动作，不保证完整研究效率。

## 6. 组件家族

### 6.1 外壳 / 标题区

- 统一使用 **page heading card** 作为页面起点。
- heading 结构固定为 `eyebrow + h1 + 一句话说明`。
- CTA 放在 heading 同级或下一张 hero 卡，不塞进标题行末尾做挤压式布局。
- 多因子一期页面使用紧凑标题区：右侧说明模块移除，只保留返回、查看 PIT 门禁、新建、提交诊断、导出报告等必要操作按钮。

### 6.2 按钮

- 全站动作按钮统一分为 **Primary / Ghost / Text** 三类，不再为单页单独发明新按钮语法。
- **Primary button**：`44px` 高，`0 16px` padding，`6px` 圆角，`600` 字重，底色 `#1F877B`，白字，hover 压深到 `#264239`。
- **Ghost button**：`44px` 高，`0 16px` padding，`6px` 圆角，白底，`1px solid #D8DDE4` 边框，正文色文字，hover 只做浅灰底和轻阴影。
- **Text button**：透明底、无描边、青绿色文字，只用于行内次动作或链接式操作，不承担页面主 CTA。
- 按钮默认只做 `translateY(-1px)` 的轻抬，不做厚投影、不做胶囊大圆角；研究页 CTA 保持克制。
- 同一操作区优先使用 `1 个主按钮 + 1-2 个 ghost 按钮`，尺寸和高度保持一致。

### 6.3 工作台组件家族

- **工作台健康度卡**：四个指标块 + 双 CTA，指标块本身也用轻渐变白卡。
- **策略卡**：标题、版本 / 状态 badge、sparkline、2x2 指标矩阵、底部元信息和 CTA。
- **最近回测列表**：左侧状态点，中部 run 信息，右侧状态 / 时间胶囊。
- **Compare dock**：允许轻 blur、半透明白底和更强阴影，但只在选择对比时出现。

### 6.4 创建链路组件家族

- **策略库入口**：`#/strategies` 对外呈现为策略库，使用页面自有 hero、摘要指标、dense table、状态筛选和表头排序；长期收益列、摘要计数与行状态必须绑定当前参数版本的回测证据，不能用旧版本回测填充当前版本。`#/creation/new` 仅作为旧链接兼容入口。
- **创建类型弹层**：点击“新建策略”后展示策略类型卡，卡片按钮全宽；资产配置型进入独立配置页，多因子策略进入 `#/factor-models/new`，通用策略保持最后。多因子入口标题固定为“多因子策略”，描述为“从因子库选择系统或验证因子，配置权重、方向与行业中性化后创建可回测策略。”，按钮为“创建多因子策略”。
- **资产配置配置页**：页面单屏完成标的、权重、执行模式、再平衡和成本参数配置；初始标的为空，Ticker 使用数据快照模糊搜索单选，基准使用“指数与基准”下拉单选。解释文案使用简洁金融表达，明确“回测、运行详情和优化配置不创建第二套资产配置报告。”
- **创建标题卡**：`28px` 圆角，允许轻渐变顶色。
- **消息卡**：系统消息偏浅蓝白，用户消息偏浅青绿。
- **步骤 chip**：胶囊结构，带状态点；warning 用暖橙，success 用绿。
- **字段卡**：20px 左右圆角，输入框 14px 圆角，来源标签常驻右上。

### 6.5 策略详情 / 回测提交

- **策略详情** 不是 dense table，而是摘要卡 + 当前版本卡 + 最近回测卡 + 下一步动作卡。
- **提交回测** 当前视觉是三段式确认卡，不是表单左栏 + 摘要右栏。
- 参数、快照、运行来源都走键值卡片，不堆原始 JSON。

### 6.6 Runs / 密集表格

- runs index 使用单张大表卡，表头浅灰底，hover 轻高亮。
- dense table 只在列表和 compare 内使用，不向 workspace / creation 蔓延。
- badge 高度保持紧凑，颜色轻，不做整行着色。

### 6.7 Run Detail 组件家族

- **KPI 卡**：当前是 5 张并列卡，含主值、趋势、对照、洞察，不再是简单四格数值块。
- **主图表卡**：左大图右判断轨，图表背景轻渐变，tooltip 可轻 blur。
- **决策轨**：独立右栏，分数条 + 3 条行动判断，是页面核心语义层。
- **tab strip**：使用 pill tab，不再是硬分段器或下划线 tab。
- **诊断卡**：drawdown、月度矩阵、最差事件、滚动指标采用统一白卡 + 轻色底图。

### 6.8 快照组件家族

- 当前快照页以 **覆盖卡 / 修复卡** 为主，不是顶部 KPI 墙。
- 不完整状态通过浅红 / 浅橙 message panel 表示，文字说明比颜色更重要。
- 时间、覆盖率、窗口、来源全部落在小卡片里，而不是写成长段落。

### 6.9 优化组件家族

- 当前优化页更像 **作业页 + 候选列表**，不是满屏 candidate grid。
- 顶部动作区维持 3 个操作按钮，下面再进入候选差异表述。
- compare 是按需能力，不是默认常驻版式。

### 6.10 Compose First 组件家族

- **组合导航**：左侧导航新增 `组合` 分组，常驻 `组合仪表板` 与 `资产库`；工作台和详情页仍归属组合仪表板的上下文，不新增第二套路由壳。
- **组合仪表板**：顶部是轻渐变 hero、chip row 和 3 张指标卡；主体用双栏承载“我的组合 / 待处理动作”和“最近活动 / 组合观察”，不是 workspace 换皮，也不是静态市场评论页。
- **组合卡**：组合名、再平衡节奏、腿数、状态 / 版本漂移、近 30 日、年化、夏普、最大回撤与下一步建议必须同时出现；归档动作必须进入二次确认 modal。
- **组合状态标签**：组合列表、详情、回测列表和 Allocation 相关门禁统一使用“状态标签”作为标题、列名、筛选名和卡片标题；主标签固定为 `稳健/待校准/失效：问题类型`。组合详情页在主标签为稳健且没有执行类待办时只保留 hero 状态 chip，不展示右侧“状态标签判定”模块；这包括 `稳健：证据链完整`、`稳健：系统代理覆盖` 和 `稳健：人工确认代理覆盖`。待校准、失效或其它需要处理的状态才展示判定卡和处理入口。弹层只展示“前台判定说明 / 动作 / 解决判定”三段，底层字段只允许作为折叠审计事实出现。
- **资产库**：hero 下接 4 张全局统计卡、紧凑过滤工具栏和 dense table；表格列必须表达来源身份、类型、PIT Date、核心参数 / 来源锚点、引用组合数、状态和操作。
- **腿部 drawer**：策略腿、资产腿、现金腿都在右侧 drawer 中创建或编辑；债券资产腿来源只能来自 runtime eligible bond snapshot，现金腿强调缓冲和成本吸收，策略腿强调回测锚点与参数版本。
- **组合工作台**：三栏是硬结构，左侧来源库用于选腿，中栏用于组合命名、权重、锁定和结构摘要，右侧用于成立性评分、再平衡频次、收益质量、净收益拆解、来源签名和保存 dock。
- **工作台预览**：底部双栏固定为收益流预览与相关性预览；收益图使用青绿组合线、蓝色基准线、暖红回撤阴影，相关性矩阵要可点击并保留数值。
- **组合详情**：批准版详情是“决策主区 + 信任 rail”，包含 7 KPI、收益流图、风险与归因、相关性矩阵、情景分析、来源签名、再平衡与成本、审计轨迹和深入分析入口。
- **来源信任语法**：`冻结哈希`、`来源签名`、`版本漂移`、`收益质量`、`净收益拆解`、`调仓事件`、`审计轨迹` 都是前台设计词汇；漂移只做 advisory，不自动改写已保存组合。
- **债券快照联动**：`#/snapshots?tab=bond` 属于 Compose 来源治理面，必须保留资产腿创建 rail、日频应计、风险预算预检、质量审计、修复规则和 raw registry；不能退回静态批准稿行。

### 6.11 多因子一期组件家族

- **PIT 清洗中心**：属于 `数据` 组的一期入口，显示点时价格、样本池、异常清洗、未来函数门禁和可诊断范围；顶部状态卡不能只显示「阻塞」，必须在状态下方显示一行微缩原因，区分价格源缺口、身份映射挂起、历史 Universe 缺口或清洗规则过严。覆盖率数字旁必须提供「下钻分析」，展示缺失标的分桶、样例和下一步动作；每个缺口卡片必须同时显示数量占比、市值权重占比、时间轴分布和样例标的。身份映射待解析标的使用可点击 chip 打开「身份映射覆盖」弹窗，弹窗展示历史代码路径、标准代码输入和审计原因。页面顶部应展示「数据运维指令」，把当前核心成员缺口、身份映射挂起数量和建议运维动作直接暴露给 operator；点击「重启身份修复任务」后必须出现明确的「执行重启任务」主按钮，执行后展示尝试、成功、失败和剩余待解析数量，避免只停留在说明面板。PIT 清洗中心首屏不展示「Full Ready 免费源修复队列」「补源优先级与证据层」或「外部缓存与精修就绪度」模块；补源队列、证据层和外部缓存精修仍属于数据快照、脚本或 API 证据面，PIT 页面只承载当前门禁、覆盖率下钻、清洗规则、身份修复和门禁行动。清洗规则工作台使用 MAD / 3σ / 分行业阈值的「阈值预演」，展示预估剔除比例、样本数和异常点；READY 或研究就绪时展示 Universe 历史成员数量变化图和带时间轴/复权因子的复权校验轨迹；门禁清单中的阻塞码是行动链接，跳到 `#/snapshots?tab=equity&target=...` 并高亮目标行；研究态豁免要用明显 banner 告知不能晋升，并展示被忽略项的潜在 IC 扰动和市值权重估算。它不替换 `#/snapshots` 的股票/债券快照结构，左侧导航仍需保留 `数据快照`。
- **因子库**：属于 `因子` 组的常驻入口，使用紧凑标题、4 个摘要指标、线上/已下线 tab、筛选工具栏和 dense table；线上 tab 恢复上一版表头，展示因子、来源、诊断状态、最近诊断、因子级别、阻断 / 风险、最近更新和比对 / 操作，已下线 tab 展示 `DEPRECATED/PRUNED` 因子并保留下线理由与时间。表格主标题显示中文 Display Name，右侧显示中性灰色标准分类 tag，副标题显示 canonical ID，并支持来源前缀、标准类别和处理算子筛选；标准类别只按动量、规模、估值、质量、风险、情绪六类展示，`beta/vol` 映射为风险，`inv/qlty` 映射为质量，`liq` 映射为情绪，六类之外的 composite/alpha 显示为“其他”；不得使用广场类命名。指标区第四张卡为「治理任务」，点击后打开治理动作弹层；弹层只展示 `DEPRECATE`、`PRUNE` 和策略草稿任务，不展示历史复核、拥挤或退化消息；执行类任务必须展示指令、触发条件、关联因子、理由和二次确认操作，策略草稿任务只跳转多因子创建页并保持草稿。最近诊断缩略图必须带 0 位虚线，正 IC 区域使用浅绿、负 IC 区域使用浅红，用于快速识别方向反转。因子单元格内提供最多两个因子的「比对」勾选和详情入口，勾选两个因子后下方研判区切换为 IC 走势和多头超额收益的因子指纹比对。来源显示必须本地化为“系统默认 / 人工 / 自动挖掘”，不得暴露 raw enum、`s/m/a` 前缀或后端字段名。
- **因子诊断状态筛选**：因子库诊断状态固定为“稳健 / 待校准 / 失效 / 沙箱”四档；稳健要求 S/A/B、覆盖率大于 90%、IR 稳定且分组收益单调良好，待校准用于覆盖不足、相关性拥挤或近期 IC 衰减等降权研究态，失效用于 C/D 或分层收益倒挂，沙箱用于无 IC/IR 的预览态。表格筛选与诊断弹层必须复用同一管理动作文案。
- **因子工厂**：`#/factors/factory` 使用 V1.7 1960px 稿的研究工作台节奏，把挖掘沙盒与检疫工作台收敛为一个生产页面。顶部 hero 后接自动化状态条、启动自动化 / 暂停自动化 / 立即运行按钮和因子漏斗；三栏工作台展示自动化 run、挖掘队列与检疫发布队列；下方闸门区展示 Auto-Residual、最大回撤相对基准和 PIT 诊断非阻断证据。每日自动化固定为 `GMT+8 14:00`，工厂 run 完成挖掘后必须自动送检 top candidates 并执行检疫。任务队列和候选摘要先按同配置/同表达式去重，默认露出精简队列，更多内容在模块内滚动查看。卡片 IR 标签必须使用 Newey-West 重叠持有期修正后的 IR，长周期动量的 Auto-Residual 证据需展示相对短周期动量的纯净 IC 来源。风险提示必须明确候选表达式不会直接进入正式因子库，只有 D2 `PASSED + ELIGIBLE` 可发布；PIT 非 Full Ready 不再单独制造拒绝态，但必须进入诊断、因子级别、发布审计和风险提示。
- **多因子策略创建**：`#/factor-models/new` 使用三栏工作台，左侧选择系统或验证因子，中间配置权重、方向、再平衡频率和行业中性化，右侧展示打分预览、PIT 覆盖、预计换手和物化门禁。治理任务跳转只能预填因子、方向和建议权重，并以草稿/待审查语气提示；已下线因子不得进入策略选择、预览或创建。启用行业中性化但缺少 PIT 行业字段时，门禁必须显示未执行 blocker，并禁用创建。
- **检疫兼容入口**：`#/factors/quarantine` 保持可访问，但渲染 `因子工厂` 的检疫与发布分区。候选不得直接进入因子库；PIT 证据不足只进入诊断和风险提示，不单独阻断发布，也不出现自动覆盖生产策略的动作。
- **因子相关性研判**：因子库底部热力图必须按描述符类别自动排序和分区，类别内形成连续矩阵块；矩阵输入只能来自当前 tab 与当前筛选条件下的可见因子，不能混入另一 tab 或已被筛选隐藏的因子。高相关阈值默认 `0.7`，同类高相关用蓝色边框提示，跨类别高相关用更强警示边框提示。热力图提供「仅显示高相关对」筛选，并在因子数量增长时启用虚拟矩阵窗口，避免 dense table 与矩阵同时拖慢首屏。
- **Sandbox 缺口闭环**：当状态为 `Sandbox 可跑` 时，数据门禁标签旁显示微型 `!` 图标；点击后用浮层展示「缺口速报」，说明阻止 Full Ready 的缺失窗口或字段，并提供跳转到 PIT 覆盖率缺口清单的动作。浮层正文必须在受控宽度内自然换行，不能横向溢出或遮挡同一行的比对 / 详情操作。
- **因子详情/诊断**：页面回答“这个因子能不能用、为什么能用、哪里被数据挡住”。动量和低波因子展示价格 PIT 诊断、IC/IR、换手衰减、风险提示和报告导出；估值、质量和规模因子使用基础面 PIT 种子快照进入诊断流程，缺数据时必须显示具体 `基础面 PIT 缺口` 窗口或字段。三期只允许把右侧足迹模块改为「审计足迹」，展示回溯窗口、检疫/诊断、发布和治理消息时间，其他详情模块不随本轮改造。
- **因子编辑器**：用于人工公式录入与诊断预览，必须提供描述符分段控件并实时预览 `m_<category>_<metric>_<window>_<operator>` ID；标题区只保留返回因子库、预览诊断和保存/提交等动作；编辑器不承担策略创建或数据快照刷新职责。
- **默认因子文案**：七个默认因子名称固定为 `滚动市盈率倒数 (LTM)`、`最新账面市值比`、`12-1月截面动量排名`、`LTM 净资产收益率`、`自由现金流收益率 (TTM)`、`252日年化波动率排名` 与 `即时对数总市值`；副标题 canonical ID 固定为 `s_val_ep_ltm_raw`、`s_val_bp_latest_raw`、`s_mom_12m1m_rank`、`s_qlty_roe_ltm_raw`、`s_qlty_fcfy_ttm_raw`、`s_vol_252d_rank` 与 `s_size_cur_log`。页面文案全部中文，必要英文缩写只作为金融术语保留。

### 6.12 多因子第二步 Type-Aware 链路增强

- **策略详情**：沿用既有摘要卡、当前版本卡、最近回测卡和下一步动作卡；不得新增多因子详情模板。“当前参数”在 `MULTI_FACTOR` 下必须把因子篮子、权重方案、方向设置、行业中性化、PIT 快照、打分方法和再平衡频率翻译成中文键值，不展示 raw key、raw enum 或 raw JSON。
- **回测配置**：沿用三段式确认卡，只允许新增一个“多因子预检”模块，且该模块必须排在既有确认模块之后作为页面最下方模块。模块展示因子数量、覆盖率、阻塞因子、行业中性化状态、预估换手和 PIT 警示；`BLOCKED` 时提交按钮禁用，并给出可行动中文原因。非多因子策略不显示该模块。
- **回测详情**：KPI、收益曲线、订单、诊断等既有模块不变，只新增 pill tab“因子归因”。内容用轻量条形/表格展示因子贡献、行业暴露、PIT 覆盖、归因来源和中性化执行状态；因子贡献条必须按贡献绝对值归一，不允许所有进度条同宽；归因来源、行业暴露来源和中性化状态必须中文化。现有决策轨追加“因子归因”“行业暴露”两条判断，但不改 rail 结构。
- **优化配置**：不新增模块；“参数范围”对多因子参数使用中文 label 和可读值，覆盖因子权重范围、是否启用行业中性化、中性化方法、打分方法和再平衡频率，因子权重默认受“权重合计 100%”约束，仍走既有优化创建页面。
- **优化结果**：页面结构不变，不新增多因子卡片或 tab。任何多因子参数出现在候选摘要、参数差异或当前组合中时，都必须通过统一 formatter 转成中文业务文案。

## 7. 数据可视化语法

### 7.1 颜色语义

- **主策略线**：`#1F877B`
- **基准线 / 第二比较线**：`#4C78C7`
- **主策略面积填充**：`rgba(31, 135, 123, 0.12)`
- **drawdown 线 / 面积**：`rgba(196, 92, 79, 0.9)` / `rgba(196, 92, 79, 0.14)`
- **月度矩阵正负色**：正值浅绿，负值浅红，空值灰
- **判断轨分数条**：`#176B61 -> #1F877B` 水平渐变

### 7.2 图表规则

- 图表永远服务于判断，不允许炫技动画和发光描边。
- benchmark 只能是蓝色虚线，不要每页重新发明基准样式。
- tooltip 可以浮，但信息必须短，优先日期、策略值、基准值、阶段。
- OOS / benchmark / risk 的语义要在 workspace、run-detail、snapshots 中保持一致。
- Compose 的收益流、基准、回撤、再平衡点和相关性矩阵必须复用同一套颜色语义；相关性热力和风险贡献可以使用轻色底，但不能把状态变成纯装饰色块。

## 8. 可访问性与内容语气

### 8.1 可访问性

- 正文与背景对比度至少 `4.5:1`。
- 所有状态胶囊除了颜色都必须有文字。
- 主要按钮、输入框、tab、chip 点击热区不低于 `44px`。
- 表格、诊断切换、run-detail tabs 需要清晰 focus ring。
- 图表必须有文字摘要或判断轨，不靠图像单独表达结论。

### 8.2 内容语气

- 标题回答“这是什么”，按钮回答“下一步做什么”。
- 说明文字以操作和判断为主，不写口号。
- 错误 / 阻塞要贴近上下文写清楚原因，例如快照不完整、公司行为缺口、历史锚点未修复。

## 9. 2026-04-28 Compose First 现状同步

Compose First 已经进入正式运行页族，设计上服务“从策略结果抽象成可维护组合”的第二层研究链路。它延续雾灰底、白卡、青绿色主动作和轻边框体系，但比策略工作台更强调来源证据、版本冻结、组合维护和审计解释。

| 页面 | 当前设计现状 | 必须守住的口径 |
| --- | --- | --- |
| `#/compositions` | 组合运营首页，hero + 指标卡 + 双栏工作队列 | 观察卡只能来自 `GET /compositions` 运行态摘要，不写静态 ETF 评论、固定周期 chip 或硬编码市场曲线 |
| `#/legs` | 来源资产库，dense table 是主体，drawer 是创建 / 编辑主交互 | 策略腿是投影或本地保存映射，资产腿 / 现金腿是最小定义；所有引用、版本和 PIT 信息必须可见 |
| `#/compositions/workbench` | 三栏组合装配工作台，下方收益流 / 相关性预览 | 预演是零写入；保存 dock 持续可见；成立性评分、收益质量、来源签名和调仓事件必须同屏可判断 |
| `#/compositions/:id` | 已保存组合的审计详情页，主分析区 + 330px 信任 rail | 详情按冻结证据回看；来源漂移、审计轨迹和成本维护是页面核心，不是可省略的次要信息 |
| `#/compositions/:id/backtest-runs/new` | 组合回测 Split 配置页 | 页面负责配置稳定性复核，不做策略参数搜索；预检必须显示覆盖率、阻塞态和代理口径 |
| `#/compositions/:id/backtest-runs/:runId` | 组合回测 Split 结果页 | Diagnosis 看结论，Orders 看执行流水与内部对冲，Evidence 看冻结配置、代理和算法证据；诊断页二层模块要保持 Sleeve 归因与 Exposure Heatmap 等高，Top 5 穿透风险归入 Sleeve 贡献组 |
| `#/compositions/:id/allocation-lab` | 组合优化 Split 配置页 | 以意图导航、风险偏好、换手约束和资产微调为主，专家参数渐进披露 |
| `#/compositions/:id/allocation-jobs/:jobId` | 组合优化 Split 结果页 | 有效前沿必须标注 Current、Benchmark 与上方不可达到区域；候选卡必须解释风险贡献、分散度和迁移成本；回撤、波动、修复周期或防御溢价变差时使用警示色而不是正向绿色 |
| `#/snapshots?tab=bond` | 固定收益来源治理页，也是债券资产腿入口 | 只能读取 `bond_fixed_income` runtime 分段；fallback/proxy 曲线不能成为可创建资产腿来源 |

Compose 页面当前的交互原则：

- 组合组导航只包含 `组合仪表板` 与 `资产库`；工作台和详情页是组合仪表板的深层任务，不单独扩展左导航。
- 逻辑删除类动作必须二次确认，并在文案中说明“隐藏 / 归档，不物理清除历史证据”。
- 版本漂移必须显式展示，但只提示用户复制新版本或回工作台复核，不自动替换冻结来源。
- 资产库可用表格承载高密度信息；组合仪表板和详情页不要退化成 dense table。
- Phase 1.2 术语要用中文解释呈现，不能直接暴露 raw provider id、backend enum、英文实现标签或设计稿占位 ID。

## 10. 2026-04-09 偏移清理

这次同步，文档从“上一轮偏冷硬的设计判断”收敛到当前真实 UI：

| 区域 | 旧版文档 | 当前真相 |
| --- | --- | --- |
| 主色 | `#2D4E44` 深墨绿 | `#1F877B` 青绿色 |
| 主基调 | 冷灰机构终端，更硬 | 浅雾灰研究工作台，更柔和 |
| 正收益颜色 | 偏红收益语义 | 青绿 / 绿色正值 |
| workspace 主布局 | `2fr / 1fr` | 接近 `1.05fr / 0.95fr` |
| backtest submit | 左配置右摘要 | 单大 panel 内三段确认卡 |
| snapshots | hero + stats + 双栏 | 股票为全局工作站结构，债券为 Compose 来源治理结构 |
| optimization | 候选 grid 优先 | 作业头卡 + 候选列表 panel |
| 创建链路 | 应去掉软糯感 | 当前保留 20-28px 圆角与轻渐变 |
| 浮层态度 | 不做任何玻璃感 | 允许 compare dock / tooltip 局部 blur |

## 11. 实现映射

| 界面 | 主要文件 |
| --- | --- |
| app shell | `web/src/app-shell-frame.css` |
| workspace | `web/src/pages/workspace-page-lane-b.css`, `web/src/page-sections/workspace-lane-b.tsx`, `web/src/page-sections/workspace-recent-runs-lane-b.css` |
| compose shell / route meta | `web/src/shell-route-meta-cn.ts`, `web/src/lib/appRouteContext.tsx`, `web/src/app-runtime-cn.tsx` |
| composition dashboard | `web/src/pages/composition-dashboard-page.tsx`, `web/src/components/composition-dashboard/composition-dashboard-view.tsx`, `web/src/components/composition-dashboard/composition-dashboard.css` |
| leg inventory | `web/src/pages/leg-inventory-page.tsx`, `web/src/components/legs/leg-inventory-view.tsx`, `web/src/components/legs/leg-create-drawer.tsx`, `web/src/components/legs/leg-inventory.css` |
| composition workbench | `web/src/pages/composition-workbench-page.tsx`, `web/src/components/composition-workbench/composition-workbench-view.tsx`, `web/src/components/composition-workbench/composition-workbench.css` |
| composition detail | `web/src/pages/composition-detail-page.tsx`, `web/src/components/composition-detail/composition-detail-view.tsx`, `web/src/components/composition-detail/composition-detail.css` |
| composition backtest | `web/src/pages/composition-backtest-config-page.tsx`, `web/src/pages/composition-backtest-result-page.tsx`, `web/src/pages/composition-backtest-config.css`, `web/src/pages/composition-backtest-result.css` |
| composition allocation | `web/src/pages/composition-allocation-page.tsx`, `web/src/pages/composition-allocation-page.css` |
| creation | `web/src/pages/creation-backtest.css`, `web/src/pages/creation-template-page.tsx`, `web/src/pages/creation-session-page.tsx`, `web/src/pages/asset-allocation-config-page.tsx`, `web/src/pages/asset-allocation-config-page.css` |
| strategy detail | `web/src/pages/strategy-detail-page.css`, `web/src/pages/strategy-detail-page.tsx` |
| backtest submit | `web/src/pages/backtest-submit-page-cn.tsx`, `web/src/pages/creation-backtest.css` |
| runs index | `web/src/pages/runs-index-page.css`, `web/src/pages/runs-index-page.tsx` |
| run detail | `web/src/pages/run-detail-page.css`, `web/src/pages/run-detail-page.tsx` |
| snapshots | `web/src/pages/snapshots-page.css`, `web/src/pages/snapshots-page.tsx`, `web/src/page-sections/snapshots-equity.tsx`, `web/src/page-sections/snapshots-bond-fixed-income.tsx` |
| optimization | `web/src/page-sections/optimization-manual-lab-phase4.tsx`, `web/src/pages/manual-lab-page.tsx` |

## 12. 设计 QA 检查表

- 所有 UI 实现页面是否先建立了 `UI Artifact Trace Matrix`，覆盖设计来源、目标 route/query/对象 ID、页面模块、组件/CSS、文案/状态、数据映射、交互状态、响应式状态和允许偏离项。
- 是否使用真实 route 或 cache-busting live URL 完成截图、DOM geometry、DOM 文案/状态和关键交互证据；不能只用路由可达、标题存在、关键词断言、mock 数据或单元测试声称与设计稿一致。
- 复合页面是否逐项核对内容架构：区块标题、卡片数量、状态芯片、字段标签和值、KPI、主次按钮、空态、错误态、滚动/sticky 和 responsive。
- 有没有把主色重新拉回更深更硬的旧墨绿，而不是当前青绿色。
- 有没有把正收益重新画成红色，导致与风险语义冲突。
- 有没有把创建链路的 20-28px 柔和圆角粗暴压回 16px。
- 有没有把 workspace 和 run-detail 的白卡 + 雾灰底改成满屏纯白。
- 有没有把 compare dock、tooltip 的局部浮层感扩散成全站玻璃风。
- 有没有让 backtest submit、snapshots、optimization 回到旧版不符合现状的布局判断。
- 有没有把 Compose 页面做成营销卡片墙，而不是来源证据、权重、预演、审计和维护动作优先的研究工作台。
- 有没有在 `#/compositions` 使用静态市场评论、固定 period chip 或 hard-coded ETF 文案，绕过 `GET /compositions` 运行态摘要。
- 有没有让 `#/legs` 隐藏引用计数、PIT Date、冻结哈希、版本漂移或归档二次确认。
- 有没有让 `#/compositions/workbench` 的三栏结构、底部收益流 / 相关性预览或 sticky 保存 dock 消失。
- 有没有让 `#/compositions/:id` 的来源签名 rail、审计轨迹、再平衡成本或来源冻结 drawer 变成可选装饰。
- 有没有把 `#/snapshots?tab=bond` 退回静态债券 preset，或把 fallback/proxy 曲线当成可创建资产腿来源。
