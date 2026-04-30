# Sleeve OS 组合中心 v2 全局页面设计规格

## 1. Screen Summary

- **Screen or flow name**: Sleeve OS 组合中心 v2 全局索引页族。
- **User persona**: 本地策略研究员、组合维护人、投研复核人。
- **Job to be done**: 从多个组合、组合回测运行和配置实验作业中快速判断哪些对象可以继续研究、哪些候选可以晋升、哪些证据需要复核。
- **Entry point**:
  - `#/compositions/list`
  - `#/compositions/backtest-runs`
  - `#/compositions/lab`
- **Success state**: 用户能在全局层面找到目标组合、定位 run、识别证据等级、进入晋升审查，并从页面动作进入既有详情、回测和 allocation 深链。

## 2. Approved Direction

- **Approved variant**: 审计索引工作台方向。
- **视觉方向摘要**: 保留 GSL 现有“浅雾灰底 + 白卡 + 青绿色主动作”的研究工作台气质，三页都使用 1920 屏 page hero、右侧标题模块、四张指标卡、主列表加右侧 rail 的结构。新页面不是营销 dashboard，也不是重复现有 `#/compositions` 仪表板，而是面向审计、筛选和决策队列的高密度列表工作面。
- **保留自 `DESIGN.md` 的规则**: 青绿色主动作、蓝色基准/对照、暖红风险、白卡轻边框、hero heading、dense table 只用于索引页、Split-only 组合路线。
- **有意变化**: 组合域新增全局索引型页面，允许比现有组合仪表板更高密度；右侧 rail 从“观察”升级为“待决策 / 压力场景 / 晋升审查”；组合实验室明确为配置实验作业列表页，而不是有效前沿大图页。

## 3. Layout Anatomy

### Desktop

- 全部页面按 live `http://127.0.0.1:4173/#/runs` 的 1920 屏输出尺寸对齐：设计 PNG 桌面画布为 `1920x1039`；live 测得 `main x≈236 / width≈1684`，主内容起点约 `x=268`，内容宽度约 `1620px`。
- 全部页面使用统一 shell：左侧 `236px` sidebar、主内容 32px padding；三个全局列表页均不显示顶部状态条，主内容从 `y=0` 进入页面。
- 主内容最大宽度继承线上 `#/runs` 节奏，按约 `1620px` 内容宽度组织，桌面预览不再限制在 1600px 页面盒子内。
- HTML 预览是路由级真实页面预览，不再使用外层灰色设计板、圆角 mockup 容器或固定 1600px 盒子；浏览器打开时页面按当前窗口宽度铺满，截图脚本用 `1920x1039` 视口输出批准 PNG。
- 验收方式固定为“批准 PNG 对浏览器同尺寸截图”：`composition-list`、`composition-backtests`、`composition-lab` 在 `1920x1039` 视口下输出 PNG 与浏览器截图进行抽样像素差异检查。
- 若浏览器仍显示旧版内容，使用新生成的 `sleeve-os-v2-global-pages-live-preview.html` 或单页 `*-1920-preview.html` 作为无缓存预览入口。
- 顶部 hero 按页面任务区分：组合列表为左标题 + 右侧单一主动作；组合回测和组合实验室为单栏 hero，不展示右侧标题模块。三页 hero 固定 `172px` 高，顶部位置均为 `x=268 / y=32 / width=1620`。
- `#/compositions/list` 不显示 topbar 左侧“组合列表 / 按版本、证据和待决策事项集中复核”标题模块，也不显示右侧“127.0.0.1:8000 已同步”状态模块。
- `#/compositions/list` 的 hero 右侧不显示“组合运营入口 / 版本、证据和晋升事项集中处理”信息面板；右侧只保留“新建组合”一个动作按钮。
- `#/compositions/backtest-runs` 不显示 topbar 左侧“组合回测列表 / 跨组合追踪稳定性裁决、压力窗口和订单证据”标题模块，不显示右侧“订单导出服务可用”状态模块，也不显示“压力复核窗口 / 场景筛选、订单定位和证据分级共用同一窗口”右侧模块。
- `#/compositions/lab` 不显示 topbar 左侧“组合实验室 / 配置作业、候选方案和版本晋升审查”标题模块，不显示右侧“候选门禁已启用”状态模块，也不显示“晋升审查入口 / 配置作业先进入审查，再生成草稿版本”右侧模块。
- hero 下方固定四张 metric card，形成页面级状态概览；三页指标模块固定 `104px` 高，指标起点固定 `y=226`，列表模块起点固定 `y=352`，`.page` 使用 `align-content: start` 禁止 grid 自动拉伸，hash 切换不产生标题、指标、列表跳动。
- 主体布局：
  - `#/compositions/list`: `minmax(0, 1fr) 330px`，左侧 dense table，右侧待决策 rail。
  - `#/compositions/backtest-runs`: `minmax(0, 1fr) 330px`，左侧运行表，右侧压力场景队列；hero 使用单栏。
  - `#/compositions/lab`: `minmax(0, 1fr) 330px`，左侧配置实验作业表，右侧晋升审查 rail。

### Tablet

- 保留 sidebar 压缩后的 shell 语义。
- 主体两栏在 1024px 以下可折叠为单列。
- 表格仍优先保留，但 rail 下沉到主内容后方。

### Mobile

- sidebar 折成顶部水平 pill nav。
- table 改成 stacked summary cards。
- hero actions 左对齐换行，按钮保持 40px 以上点击高度。
- metric cards 一列堆叠，rail 按正文顺序下沉。

### Empty / Loading / Error

- Loading: hero 和 metric 保持 skeleton，不展示静态样例数据。
- Empty: 保留页面结构，主区显示与页面任务对应的行动入口。
- Error: 使用暖红 message panel，说明是组合列表、运行历史还是配置实验作业加载失败。
- Long content: 组合名、run id、version id 使用 `overflow-wrap: anywhere`，表格行不改变列宽。

## 4. Design Tokens

### Color

```css
:root {
  --gsl-bg-main: #f0f2f5;
  --gsl-bg-surface: #ffffff;
  --gsl-bg-surface-soft: #fbfcfd;
  --gsl-bg-subtle: #f9fafb;
  --gsl-bg-accent-soft: #f5fbf8;
  --gsl-color-primary: #1f877b;
  --gsl-color-primary-strong: #176b61;
  --gsl-color-primary-soft: #e6f4f1;
  --gsl-color-benchmark: #4c78c7;
  --gsl-color-success: #2b8a3e;
  --gsl-color-warning: #b86813;
  --gsl-color-danger: #c45c4f;
  --gsl-color-border: #e5e7eb;
  --gsl-color-border-soft: #eef2f4;
  --gsl-text-title: #111827;
  --gsl-text-main: #1f2937;
  --gsl-text-sub: #64748b;
  --gsl-text-muted: #94a3b8;
}
```

- `primary`: 主动作、正向状态、组合主线。
- `benchmark`: 基准、候选对照、样本外辅助语义。
- `warning`: 待晋升、待复核、迁移成本偏高。
- `danger`: 证据阻断、压力窗口未通过、政策违反。

### Typography

```css
:root {
  --gsl-font-ui: Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif;
  --gsl-font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  --gsl-text-page-heading: 28px;
  --gsl-text-section-title: 18px;
  --gsl-text-card-title: 14px;
  --gsl-text-body: 14px;
  --gsl-text-meta: 12px;
}
```

- `h1`: 28px / 1.18 / 700。
- `h2`: 18px / 1.3 / 700。
- body: 14px / 1.58。
- id、run、version 使用 monospace 12px。
- letter-spacing 固定为 0。

### Spacing, Radius, Border, Shadow

- Page padding: desktop 32px，mobile 20px。
- Page gap: 22px。
- Panel padding: 18px 20px，mobile 16px。
- Hero padding: desktop 18px 28px，mobile 20px；全局列表页标题卡采用紧凑高度，不使用营销型大 hero。
- Radius: hero 24px，panel 18px，mobile panel 16px，button 8px，chip 999px。
- Border: `1px solid #e5e7eb`，弱分隔用 `#eef2f4`。
- Shadow: `0 1px 3px rgba(17, 24, 39, 0.06), 0 1px 2px rgba(17, 24, 39, 0.04)`。

## 5. Component Spec

### Page Hero

- Purpose: 建立当前全局页面的操作上下文。
- Anatomy: `eyebrow`, `h1`, one-line summary, status chips, primary action group。
- States: loading 时可保留标题和 skeleton chips；error 时不隐藏 hero。
- Accessibility: h1 每页唯一。

### Metric Card

- Purpose: 呈现页面级监控数字。
- Variants: accent、default、warning、danger。
- Content: label、primary value、one-line supporting detail。
- Implementation hint: 复用现有 composition dashboard metric 视觉语法，避免新增大 KPI 墙。

### Dense Table

- Purpose: 全局索引页的主操作面。
- Pages:
  - Composition list table: 组合、证据质量、10Y年化/夏普/回撤、周期完整度、待决策、操作；配置版本只作为组合名单元内的 `配置 vN` chip，不再单独展示“正式版本”或“来源复核”标签。
  - Backtest run table: 运行、组合版本、裁决、压力窗口、订单证据、风险预算、操作。
- States: loading skeleton、empty action row、error panel。
- Mobile: 转为 summary cards，不压缩成不可读横向表格。
- Accessibility: 使用真实 `table`, `thead`, `tbody`；单元格内复杂排版放入 wrapper，不改变 `td` table-cell 布局。

### Decision Rail

- Purpose: 把页面主列表中的行动项聚合成可执行队列。
- Variants:
  - 待决策事项 rail。
  - 压力场景队列 rail。
  - 晋升审查 rail。
- States: 可晋升、需复核、门禁阻断、无待处理。
- Interaction: rail item 进入已有详情、orders、Evidence 或 promotion review 深链。

### 配置实验作业表

- Purpose: 组合实验室的主操作面，按作业而不是按图形候选组织。
- Required columns: 作业、组合版本、方法、候选、晋升门禁、迁移成本、操作。
- States: 可通过、需复核、门禁阻断、运行中、失败。
- Interaction: 行动作进入作业详情、晋升审查或阻断说明；有效前沿仍留在单个配置实验结果页，不出现在全局实验室列表页。

### Promotion Review Card

- Purpose: 明确候选不能直接保存为正式版本。
- Required fields: 候选名、证据等级、Sharpe delta、迁移成本、政策违反数、生成草稿版本、创建决策包。
- Blocked state: 证据 C、政策违反、迁移成本超过阈值时主按钮 disabled，并显示阻断原因。

## 6. Interaction Notes

- Filters use pill controls with visible current value.
- Primary actions remain one per action area.
- Hover only uses 1px lift or border change; no heavy shadow.
- Focus ring: `2px solid rgba(31, 135, 123, 0.28)`。
- Tab/query state:
  - `#/compositions/backtest-runs?scenario=2022&grade=A,B`
- `#/compositions/lab?status=promotion_ready`
  - `#/compositions/list?status=ACTIVE&decision=pending`
- Archive/delete still requires second confirmation if any future action hides records.

## 7. Accessibility Rules

- 所有状态不能只靠颜色表达，必须有中文状态文案。
- Buttons and filters target height >= 40px, production implementation should use 44px where space allows.
- Dense tables need semantic headers and keyboard focusable row actions.
- Sparkline or compact chart must have text summary or `aria-label`。
- Mobile card mode must preserve primary action and status,不能只展示名称。

## 8. Implementation Notes

### Suggested Routes

```ts
type AppRoute =
  | { kind: 'composition-list'; status?: string; evidenceGrade?: string }
  | { kind: 'composition-backtest-runs'; scenario?: string; evidenceGrade?: string }
  | { kind: 'composition-lab'; status?: string; compositionId?: string };
```

### Suggested Pages

- `web/src/pages/composition-list-page.tsx`
- `web/src/pages/composition-backtest-runs-page.tsx`
- `web/src/pages/composition-lab-page.tsx`
- Shared CSS can start as `web/src/pages/composition-global-index.css` if implementation wants one common page family.

### API Shape Expectations

- `GET /compositions` remains lightweight and should power the new list page first version.
- v2 backend should add:
  - `GET /compositions/backtest-runs`
  - `GET /compositions/allocation-jobs`
  - `GET /compositions/{id}/versions`
  - `POST /compositions/{id}/allocation-jobs/{jobId}/candidates/{candidateId}/promote-draft`
- Frontend must not fabricate evidence grade or promotion readiness when API omits it. Show “待补证据” instead.

### Copy Rules

- Use readable evidence labels such as `证据完整`, `需复核`, `证据缺口`, plus `待晋升`, `晋升审查`, `生成草稿版本`, `压力窗口`, `模拟订单已标记`。
- Do not show `mock`, `placeholder`, `design`, `Stepper`, raw backend enum without Chinese label, or unexplained provider id。
- `Risk Parity`, `MVO`, `Black-Litterman`, `ENB`, `Sharpe` may remain English because they are financial method terms.

### Approved Artifact Paths

- HTML preview: `output/ui-artifact-trace/sleeve-os-v2-global-pages/sleeve-os-v2-global-pages-preview.html`
- Desktop PNGs:
  - `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-list-desktop.png`
  - `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-backtests-desktop.png`
  - `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-lab-desktop.png`
- Mobile PNGs:
  - `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-list-mobile.png`
  - `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-backtests-mobile.png`
  - `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-lab-mobile.png`

## 9. DESIGN.md Follow-up

- **待用户确认后可加入 `DESIGN.md` 的系统级规则**:
  - Compose v2 全局索引页使用 `hero + 4 metrics + main table + 330px decision rail`。
  - 组合列表和回测列表允许 dense table，组合仪表板和详情页仍不退化成 dense table。
  - 全局实验室是配置实验作业列表页；有效前沿保留在单个作业结果页，候选晋升必须进入右侧审查 rail 或单作业审查页。
- **只保留在本规格里的页面级细节**:
  - 三页的示例字段顺序、演示数字、示例组合名称和候选列表。
