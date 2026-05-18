## 设计系统

在做任何 UI、布局、颜色、间距或字体决策之前，始终先阅读 `DESIGN.md`。
如果 `docs/GSL_UI_V1_PLAN.md` 与 `DESIGN.md` 在视觉规则上冲突，以 `DESIGN.md` 为准。
当前视觉基线是 2026-04-09 的运行中 UI：浅雾灰背景、白色卡片、青绿色主色、柔和圆角，以及克制使用的渐变。
在评审和 QA 中，如果界面回退到更早那种更冷、更硬的风格，应视为视觉回归，除非用户明确要求那个方向。

## Codex 协作入口

- 本仓库的共享编排规则来自 `$GRIT_Coder`，但仓库专属流程、固定命令、UI 交付规范和 reviewer 口径以本文件与 `TECHNICAL.md` 为准。
- 进入多步任务、跨栈任务或多代理任务时，先读 `TECHNICAL.md`，再按本文件补足协作与交付规则。
- 如果一次复盘发现的问题只影响本仓库，不要修改 shared skill；应把流程类规则写回本文件，把技术真相、固定测试命令和 acceptance facts 写回 `TECHNICAL.md`。

## GRIT_Coder 仓库专属执行基线

### 主控 / Planner

- 先输出一句话目标，再输出 `Baseline Summary`。
- 计划前必须阅读：
  - `TECHNICAL.md`
  - `ARCHITECTURE.md`，当任务依赖长期运行时边界或恢复口径
  - `DESIGN.md`，当任务涉及 UI
  - 已批准的 `HTML` 与代码级设计规格 Markdown，若属于“已交付 UI 稿实施车道”
- `Technical Plan` 至少写清楚：
  - goal 和 acceptance criteria
  - impacted backend files
  - impacted frontend files
  - API / contract changes
  - schema / storage changes
  - route impacts
  - UI lane choice
  - worker ownership by file/module
  - focused tests per slice，且必须使用本仓库真实命令
  - merge order
  - risk points
  - rejection criteria
  - exact `TECHNICAL.md` delta
  - whether `ARCHITECTURE.md` must change

### Backend / Shared-Contract Worker

- 实施前至少阅读：
  - `TECHNICAL.md`
  - `ARCHITECTURE.md`，当切片触及 runtime/storage/恢复边界
- 本仓库重要边界：
  - 对外 backend import surface 仍通过 `src/grit_backtest_platform/__init__.py` 映射到 `*_restored.py` / `*_rebuilt.py`
  - API contract truth 以 `src/grit_backtest_platform/models.py` 和 `web/src/types.ts` 的镜像一致性为准
  - 若计划没有显式分配，不要顺手改未归属的 frontend 契约镜像或共享 runtime 边界
- 回传必须包含：
  - changed files
  - commands run
  - focused test results
  - remaining risks
  - exact `TECHNICAL.md` delta

### Frontend Worker

- 如果已有批准的 `HTML` + 代码级设计规格 Markdown，必须按交付稿实现，不得自行重设计。
- 如果没有可直接实现的 UI 交付物，先走 design-first lane，拿到 design package 和用户批准后再编码。
- 实施前至少阅读：
  - `TECHNICAL.md`
  - `DESIGN.md`
  - 已批准的 `HTML`
  - 已批准的代码级设计规格 Markdown
- 已交付 UI 稿实施车道必须先产出 `UI Artifact Trace Matrix`，再开始改代码。矩阵至少包含：
  - 批准 HTML/SPEC 区块
  - 目标 React 文件与组件
  - 必须还原的中文文案、状态标签、数值格式与 live-data 替代规则
  - 交互状态、响应式断点、截图/DOM/交互证明路径
  - 已批准偏离项或待确认项
- live API 或 demo data 与静态稿不一致时，必须通过 view-model / formatter 统一前台展示；不得把 raw backend label、未翻译英文、乱码、占位符或实现说明泄漏到页面。
- 页面工作可以扩展 view-model 和 page-local 组件，但不得随意重定义 route parsing、shared runtime client 或 app shell。
- 交付必须覆盖：
  - empty
  - loading
  - error
  - success
  - permission / blocked（如相关）
  - responsive behavior
- 已交付 UI 稿实施车道的回传还必须包含：
  - `UI Artifact Trace Matrix` 状态
  - 1440px 桌面截图；如 SPEC 指定其他断点，也一并提供
  - DOM 文案/状态扫描结果，确认无未批准英文、乱码、占位符或设计说明语气
  - tab、filter、drawer、sticky、disabled/joined、save/refresh 等范围内交互证明
  - 与批准 HTML/SPEC 的剩余差异清单
- frontend worker 回传前必须先跑交付前自测门：
  - 对照 reviewer 拒收清单自查 ownership、契约、Trace Matrix、截图、DOM 文案、交互证明、focused tests 与文档 delta
  - 明确回答 `Would reviewer refuse this?`；答案不能是确定的 `No` 时，先修正再交付
  - 自测不能替代正式 reviewer，只是阻止明显不合格切片进入评审

### Reviewer

- reviewer 对照以下事实验收：
  - `Technical Plan`
  - `TECHNICAL.md`
  - `ARCHITECTURE.md`，当任务触及系统级 truth
  - 已交付 UI 稿或批准的 design package
  - `UI Artifact Trace Matrix`，当任务处于已交付 UI 稿实施车道
  - 截图、DOM 文案/状态扫描与交互证明，不能只看 focused tests
  - worker 交付前自测结果，尤其是 `Would reviewer refuse this?` 的回答与证据
  - focused tests / integration tests / regression results
- reviewer 必须拒收以下情况：
  - scope drift
  - contract mismatch
  - 页面工作越权改动 runtime boundaries
  - shell 或 route truth 在无授权时被重定义
  - 已交付 UI 稿存在，但前端未读取 `HTML` + 设计规格
  - 已交付 UI 稿存在，但 worker 没有提交 Trace Matrix、截图、DOM 文案扫描或交互证明
  - worker 未提交交付前自测结果，或自测已经暴露 reviewer 会拒收的问题但仍交付
  - focused tests 通过但视觉结构、正式文案、状态标签或关键交互偏离批准稿且无批准偏离记录
  - 需要回写 `TECHNICAL.md` 却未准备 delta
- 拒收模板固定为：

```text
REFUSE: <明确原因>. Continue on codex/<slice-branch> and resubmit.
```

## 可复用 Prompt 基线

### Planner Prompt

```text
Use $GRIT_Coder to plan work for this repository.

Before planning, read:
- TECHNICAL.md
- ARCHITECTURE.md when the task depends on long-lived runtime or recovery truth
- DESIGN.md when UI is in scope
- approved HTML plus code-level design-spec Markdown when the task is in the delivered UI artifact lane

Repository truths to preserve:
- Public backend imports stay stable through restored/rebuilt module indirection under src/grit_backtest_platform.
- API contract truth lives in src/grit_backtest_platform/models.py and web/src/types.ts.
- Frontend runtime truth lives in web/src/app-runtime-cn.tsx, web/src/lib/appRouteContext.tsx, and web/src/lib/demoStoreContext.tsx.
- Shell truth lives in web/src/shell-frame-cn.tsx and web/src/shell-route-meta-cn.ts.

Produce a Technical Plan that includes:
- one-sentence goal
- acceptance criteria
- impacted backend files
- impacted frontend files
- API / contract changes
- schema / storage changes
- route impacts
- UI lane choice
- explicit worker ownership by file/module
- focused tests per slice using real repo commands
- merge order
- risk points
- rejection criteria
- exact TECHNICAL.md delta
- whether ARCHITECTURE.md must change
```

### Backend / Shared-Contract Worker Prompt

```text
Use $GRIT_Coder to implement only the assigned backend or shared-contract slice in this repository.

Before editing, read:
- TECHNICAL.md
- ARCHITECTURE.md when your slice touches runtime, storage, recovery, or system boundaries

You own only these files/modules:
- [paste exact files]

Relevant repo boundaries:
- Keep public import surfaces coherent through restored/rebuilt module indirection.
- Keep src/grit_backtest_platform/models.py and web/src/types.ts aligned when the accepted plan assigns a contract change.
- Do not redefine runtime, shell, or route truth outside your ownership.

Return:
- changed files
- commands run
- focused test results
- remaining risks
- exact TECHNICAL.md delta required by your slice
```

### Frontend Worker Prompt

```text
Use $GRIT_Coder to implement only the assigned frontend slice in this repository.

Before editing, read:
- TECHNICAL.md
- DESIGN.md
- the approved HTML artifact
- the approved code-level design-spec Markdown

Before editing, prepare a UI Artifact Trace Matrix that maps approved HTML/spec modules to target files/components, required copy/status/value formatting, interactions, responsive expectations, tests, screenshot evidence, DOM copy scan, and allowed deviations.

For design-locked work, the matrix must also include a design-vs-live parity grid. Cover conditional modules from the approved artifact under states where they are visible, such as publishable queues, non-empty history lists, empty states, warning/failure rows, disabled controls, and opened modals. If the current live API does not naturally produce an approved-artifact state, use an auditable fixture/seed or mark the review blocked; do not accept "0 rows, therefore hidden" as design parity.

You own only these frontend files:
- [paste exact files]

Relevant repo boundaries:
- Frontend runtime truth lives in web/src/app-runtime-cn.tsx, web/src/lib/appRouteContext.tsx, and web/src/lib/demoStoreContext.tsx.
- Shell truth lives in web/src/shell-frame-cn.tsx and web/src/shell-route-meta-cn.ts.
- API contract mirror lives in web/src/types.ts.
- Implement from the delivered UI artifacts. Do not redesign without explicit approval.
- Normalize live/demo raw labels through view-model or formatter helpers before rendering user-visible copy.

Return:
- changed files
- commands run
- focused test results
- UI Artifact Trace Matrix status
- screenshot paths for required breakpoints
- DOM copy/status scan results
- design-vs-live parity grid covering module order, card/list counts, visible/hidden conditional modules, field labels, controls, density, and approved deviations
- interaction proof for in-scope tabs, filters, drawers, sticky regions, disabled/joined states, save/refresh actions
- unresolved deviations from approved HTML/spec
- pre-delivery self-review result, including the answer to "Would reviewer refuse this?" and evidence for "No"
- remaining risks
- exact TECHNICAL.md delta required by your slice
```

### Reviewer Prompt

```text
Use $GRIT_Coder to review worker output for this repository.

Before reviewing, read:
- TECHNICAL.md
- ARCHITECTURE.md when system-level truth is in scope
- DESIGN.md when UI is in scope
- Technical Plan for the current task

Review against these repo truths:
- Contract truth stays aligned across src/grit_backtest_platform/models.py and web/src/types.ts.
- Route parsing truth stays in web/src/lib/appRouteContext.tsx.
- Shared runtime client truth stays in web/src/lib/demoStoreContext.tsx.
- Shell layout truth stays in web/src/shell-frame-cn.tsx and web/src/shell-route-meta-cn.ts.
- Delivered UI artifact work must include a UI Artifact Trace Matrix plus screenshot, DOM copy/status, and interaction evidence.
- For design-locked UI, reject the slice if the matrix lacks approved-artifact paths, design screenshot, live screenshot, conditional-state coverage, or an explicit approved-deviation list.
- Worker output must include a pre-delivery self-review result before formal review.
- Optimization detail must preserve distinct progress, interrupted, and terminal states.
- Snapshot pages must consume formal overview contracts instead of inventing screenshot-only data shapes.

If the slice fails, reply exactly:
REFUSE: <reason>. Continue on codex/<slice-branch> and resubmit.

If the slice passes, state:
- approved for integration
- exact TECHNICAL.md updates required before closeout
- whether ARCHITECTURE.md must change
- any residual low-risk follow-up
```
