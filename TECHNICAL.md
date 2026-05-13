# TECHNICAL（技术手册）

本文件是 Grit Backtest Platform 的工程规则手册，用来整理当前仓库已经存在的技术真相、任务路由规则、验证路径与完成定义。

- 本文件统一以 UTF-8 保存。
- 本文件不替代代码，也不替代 `ARCHITECTURE.md`。
- 当 `README.md`、`harness/README.md`、历史恢复说明与当前代码存在冲突时，以当前代码、固定脚本和本文件记录的“当前真相”优先。
- 若发现冲突，本文件应显式写出冲突，而不是把“计划中能力”误写成“已经可用能力”。

## 1. 文档定位与真相来源

### 1.1 默认阅读顺序

Codex 在本仓库的默认阅读顺序固定如下：

1. 先读 `TECHNICAL.md`，锁定当前工程真相、任务分流规则、验证路径和完成定义。
2. 再读 `README.md`，确认当前启动方式、主入口、operator 命令和路径地图。
3. 然后按任务类型进入对应工作区。
4. 只读与当前任务直接相关的代码、测试和脚本。
5. 只有当任务依赖长期架构事实、存储边界、运行时 ownership 或恢复口径时，才读 `ARCHITECTURE.md`。
6. 只有当任务涉及 UI 行为、页面结构或视觉系统时，才读 `DESIGN.md` 与已批准的 HTML/设计规格。

### 1.2 任务分流规则

- 产品任务：直接进入 `src/grit_backtest_platform/`、`web/src/`、`tests/` 和对应脚本。
- UI 任务：先读 `DESIGN.md`，若已有批准的 HTML 与代码级设计规格，再读交付物，然后进入相关 React 页面与测试。
- harness 任务：进入 `harness/README.md`、`harness/tasks/*.md`、验收文档和固定 Codex 脚本。

### 1.3 已批准 UI 交付物实施门禁

所有 UI 实现页面（新增、改造、修复、重构）只要存在 `DESIGN.md`、批准 HTML/SPEC、截图、设计稿或用户给出的目标页面，就必须把这些材料作为 UI 实施硬基线，不能只把它们当作参考图。

实施前必须先形成 `UI Artifact Trace Matrix`，记录：

- 批准 HTML/SPEC 的页面 key、URL/query、模块区块与最终截图基准。
- 每个模块对应的 React 文件、组件、CSS 或 view-model/formatter。
- 必须还原的中文前台文案、状态标签、数值格式、颜色语义和允许的 live-data 替代。
- 操作区按钮必须作为独立验收项记录按钮数量、文案、顺序、主次层级、尺寸、圆角、位置和禁用态；不能只验证按钮可点击或后端动作可触发。
- 必须验证的交互状态，包括 tab、filter、drawer、sticky、disabled/joined、save/refresh、loading、empty、error 与 responsive。
- 验收证据路径，包括 focused test 命令、桌面截图、DOM 文案/状态扫描和交互证明。
- 与批准稿不同的剩余偏离项；没有明确批准的偏离视为设计漂移。

交付验收规则：

- focused frontend tests 是必要门禁，但不足以证明 UI 还原。
- 已批准 UI 交付物实施必须同时提供截图、DOM 文案/状态扫描与关键交互证明。
- UI 页面完成定义必须绑定精确 route、query、对象 ID 或用户报告 URL。Hash SPA 验收要使用 cache-busting document reload，例如 `http://127.0.0.1:4173/?v=<timestamp>#/...`；只验证默认对象、列表第一条、标题文案、关键词存在或 mock fixture，不能证明目标页面已经按设计稿还原。
- 像素对齐不能只看外框坐标和高度；还必须检查模块内部的视觉密度、内容到容器边界的空白、强制 `min-height` / `height` 是否造成空洞。若用户反馈“空白多、模块太高、密度松”，优先移除非必要强制高度并用内容自适应、padding/gap/line-height 精调，而不是继续追求静态稿外框高度。
- CSS 契约测试不能把过大的固定高度当作 UI 一致性本身；除非批准稿明确要求固定高度，否则应断言大 `min-height` / `height` 不存在，并用截图或 DOM geometry 证明模块间距和卡片内边距已经收敛。
- 对有指定上下顺序的 grid / flex 复合模块，不能只断言 DOM heading 顺序；必须同时用 CSS 契约中的 `grid-template-areas`、`grid-area` / `order` 或真实浏览器 geometry 证明视觉顺序，避免源码顺序正确但页面视觉顺序漂移。
- 表格单元格需要保持浏览器原生 `table-cell` 布局，不要把 `td` / `th` 本身改成 `display: grid`、`display: flex` 等。若单元格内部需要栅格或弹性排版，必须新增内部 wrapper；多行内容验收要比较该单元格高度与整行高度，确认分隔线不会提前断开。
- live API 或 demo data 与静态设计稿不一致时，页面必须通过 view-model / formatter 统一前台展示，不能直接暴露 raw backend label、未翻译英文、乱码、占位符或实现说明语气。
- Runtime 工作台页面不得在 API 空结果或失败时用本地样例补位；必须展示真实 empty/error 状态，并把页面按钮的 API 调用作为交互证明的一部分。mock fixture 只能用于单测，不能作为 live route 验收证据。
- 因子工厂的检疫候选来源必须与挖掘队列保持同一投影：只接收 mining job 的 top candidates，不读取内部全量候选 ledger；列表按归一化表达式去重。PIT 非 Full Ready 仅写入诊断证据、风险提示和发布审计，不再单独阻断发布；候选仍必须通过泄露/OOS 衰减/逻辑重复/Auto-Residual/回撤等硬闸门后才可自动发布。
- 用户报告已批准 UI 在某个具体 live route 或对象 ID 上漂移时，验收必须抓取用户给出的精确 URL/ID；只抽样列表第一条、默认 demo 对象或旧截图不能作为该问题的完成证据。
- 技术方案只决定数据契约、状态语义和交互责任；批准 HTML/SPEC/PNG 才决定前台模块数量、顺序、卡片数量、标题和密度。实现时不得把技术方案里“可以展示”的信息全部直接铺上页面，除非批准稿已给出位置，或 Trace Matrix 明确登记为批准偏离。
- 对已批准稿明确定义了文案、状态值、统计数字或时间戳的设计锁定页，前台必须先通过 view-model / formatter / approved constants 冻结这些展示口径；未经 Trace Matrix 明确标注为“允许 live 替换”的字段，不能把实时 refresh delta、waiver 计数、诊断窗口、provider 缺口直接渗透到前台主舞台。
- live-vs-design 同宽对拍必须等待首个真实内容模块渲染完成，例如 `健康仪表盘`、`数据运维指令`、卡片列表或目标表格；只等路由 H1、页面标题或 shell 可见就截图，属于无效验收证据。
- 在声称“100% 一致”之前，验收记录必须显式声明共享 shell 是否在本次批准范围内。若只验 page content area，必须写清楚“不含共享侧栏/顶栏”；若 shell 在范围内，则必须同时核对导航项数量、分组、选中态和标题位置，不能默认忽略。
- worker 交付给 reviewer 前必须先跑交付前自测门，按 reviewer 拒收清单自查测试、Trace Matrix、截图、DOM 文案、交互证明、文档 delta 和剩余偏离，并明确回答 `Would reviewer refuse this?`；答案不是确定的 `No` 时不得交付。
- 交付前自测不能替代正式 reviewer，它只是阻止明显不合格切片进入评审。
- 临时截图、DOM dump、trace matrix 草稿和浏览器记录应放在 `.tmp/`、`artifacts/` 或 `output/logs/grit-coder/`，不要散落在 repo 根目录。
- 恢复证据 Markdown 进入 `docs/recovery/`，恢复辅助脚本进入 `scripts/recovery/`，历史 Git 备份和旧数据库备份进入 `artifacts/recovery/`；`.codex-logs/` 只视为历史兼容位置，新日志和浏览器证据应写入 `output/logs/grit-coder/` 或 `artifacts/`。
- pytest `--basetemp`、pytest `cache_dir`、`tempfile`/`TMPDIR`、临时调试库和一次性 debug 输出必须指向 `.tmp/` 下的任务目录。固定 backend 脚本使用 `.tmp/pytest-runtime/`；直接运行 `python -m pytest` 且未显式传入 `--basetemp` 时，repo 级 `conftest.py` 会提前把 Python `TEMP`、`TMP`、`TMPDIR`、`PYTEST_DEBUG_TEMPROOT` 归一到 `.tmp/pytest-runtime/`，并把本仓库 `tmp_path` fixture 目录建到 `.tmp/pytest-runtime/tmp-paths/`，避免触碰本机默认 `%TEMP%` ACL 以及 pytest Windows `0o700` numbered-dir ACL 问题；repo 级 pytest 门禁会拒绝位于项目外，或位于仓库内但不在 `.tmp/` 下的显式 `--basetemp` 与 `cache_dir`，并拒绝仓库内错误位置的 `TEMP`、`TMP`、`TMPDIR` 和 `PYTEST_DEBUG_TEMPROOT`；固定脚本不得把 `pytesttmp-*`、`pytest-cache-files-*`、`tmp_dbg_*`、`tmp-promote-*` 或 `tmp/` 直接写到 repo 根目录，也不得把项目 pytest 临时根切到 `C:\tmp`。

### 1.4 文档优先级

| 层级 | 主要来源 | 用途 |
| --- | --- | --- |
| 运行时真相 | `ARCHITECTURE.md`、`src/grit_backtest_platform/*.py` | 运行时边界、恢复口径、模块归属 |
| 接口真相 | `src/grit_backtest_platform/api.py`、`models.py`、`web/src/types.ts` | API、请求体、状态词汇、前后端契约 |
| 工作流真相 | `scripts/codex-*.ps1`、`QuickStart-Grit.ps1` | 启动、smoke、固定验证入口 |
| Harness 真相 | `harness/README.md`、`harness/tasks/*.md` | 任务模板、验收路径、报告收口 |
| 项目指南 | `README.md` | 项目介绍、运行方式、目录地图 |

### 1.5 当前真相与待补齐项

| 主题 | 当前真相 | 说明 |
| --- | --- | --- |
| 固定 Codex 脚本 | `scripts/codex-reset-fixture.ps1`、`scripts/codex-test-backend.ps1`、`scripts/codex-test-frontend.ps1`、`scripts/codex-smoke.ps1` 已存在 | 这是当前 repo 级固定入口 |
| 已提交种子 fixture | `harness/fixtures/seed_workspace/` 已包含 workspace DB、market-data DB 与 manifest | fixture reset 与 manifest-driven live acceptance 可用 |
| `codex-reset-fixture.ps1` | 已按 committed fixture 模式实现，并复制到 `.tmp/codex-fixture/` | 运行后输出 staged workspace DB 路径 |
| `codex-test-frontend.ps1 -IncludeLiveAcceptance` | 支持 `LIVE_FIXTURE_MANIFEST` 与 `LIVE_API_BASE`，会启动 `8010` fixture backend 并运行 live real-api smoke | 当前固定验证入口 |
| `codex-smoke.ps1` | 当前会先执行 fixture reset，再跑 backend/frontend 固定入口 | fixture 资产存在；失败时应报告具体 reset/API/UI 断言 |
| `README.md` 中的 Codex smoke 描述 | 仍偏旧 | 若与脚本行为冲突，以 `scripts/codex-*.ps1` 和本文件为准 |

### 1.6 CHANGELOG 维护规则

- 项目根 `CHANGELOG.md` 必须保持 Keep a Changelog 结构，且顶部固定保留 `## [Unreleased]`。
- `## [Unreleased]` 不追加版本总结；已发布版本允许使用 `## [version] - YYYY-MM-DD - 版本更新总结`，其中标题摘要必须是一句中文总结，只点出 1 到 2 个最重要结果，不展开实现过程，不写成并列清单。
- 新写或改写的分类小标题必须与项目模板一致：`### 新增 (Added)`、`### 优化 (Changed)`、`### 修复 (Fixed)`、`### 已弃用 (Deprecated)`、`### 移除 (Removed)`、`### 安全 (Security)`。
- 不允许在 `## [Unreleased]` 或任何已发布版本段下引入主题型小标题，例如 `快照刷新`、`优化实验室`、`数据源修复`。
- 同一版本下不得混用重复分类标题，例如同时出现 `### 修复` 与 `### Fixed`。
- 条目默认写成 `- **领域**: 结果说明。`；若有 Issue、PR 或内部 Task 编号，统一放在句尾，如 `[#123]`、`[PR #45]`、`[Task OPT-12]`。
- 每条 changelog 必须一条一义，先写结果和影响，再补必要上下文；不要转储接口路径、字段清单或实现过程，除非不写会失真。
- 仅在有验证证据时写量化收益；没有可靠数据时，使用定性描述。
- 若一次回填涉及多个主题，也必须把每条内容按语义分别归入标准分类，而不是先按主题聚组再落盘。
- 当 Codex 或其他代理批量回填历史变更时，若发现某一组条目都来自同一主题，这只能作为内部整理线索，不能直接写成 changelog 分类标题。
- 非正式推送快照 `x.y.z-00n` 的日期必须使用本次推送所在日期，而不是继承上一个稳定版 `x.y.z` 的发布日期。
- 若 `pre-push` 在分支已经与 upstream 同步之后才补跑 changelog，revision 编号至少要按“上次发版后的第二次推送”起算，避免把补推送的快照错误写成 `-001`。

## 2. 何时进入 harness

### 2.1 必须先进入 `harness/` 的场景

以下任一条件成立，任务应先进入 `harness/` 再实施：

- 用户明确要求 smoke、fixed entry、fixture reset、manifest 接线、task brief、acceptance doc 或 agent workflow 变更。
- 主改动文件位于 `harness/`、`scripts/codex-*.ps1`、fixture/manifest 路径或 smoke report 路径。
- 任务主要目标是让 Codex 更稳定地读项目、跑项目、复现项目、验证项目或跨轮次交接项目。
- 任务需要明确的 `Acceptance checks` 与 `Rollback notes`。
- 任务会触及 runtime 数据路径、fixture 数据路径、临时产物收口路径或跨前后端验证链路。

### 2.2 不要先进入 `harness/` 的场景

以下场景通常不需要先进入 `harness/`：

- 单文件或小范围的 backend bug 修复。
- 单页面、单组件或单路由的 frontend 逻辑修复。
- 策略逻辑、回测逻辑、优化逻辑的局部实现调整。
- 单一 API 契约变更，且可通过 focused tests 或单个固定脚本验证。

普通产品任务的默认路径是：

1. `TECHNICAL.md`
2. `README.md`
3. 相关代码与测试
4. 只有进入验证、fixture、smoke 或任务交接阶段时，才进入 `harness/`

### 2.3 进入 `harness/` 后的固定动作

- 优先使用 `harness/tasks/_template.md` 新建或更新任务书。
- 任务书必须只保留 6 个字段：`Goal`、`In Scope`、`Out Of Scope`、`Files Likely Touched`、`Acceptance Checks`、`Rollback Notes`。
- 若任务依赖 fixture，先检查 `harness/fixtures/seed_workspace/` 是否真实存在，再决定是否走 `codex-reset-fixture.ps1`。
- 原始日志、截图、临时输出进入 `.tmp/`、`artifacts/` 或 `output/logs/grit-coder/`，摘要与 smoke 结果进入 `harness/reports/smoke/`。
- 固定测试脚本拥有自己的 pytest 临时目录配置；repo 级 pytest 门禁会拦截 root-level `--basetemp`。不要在调用 `scripts/codex-test-backend.ps1`、`scripts/codex-smoke.ps1` 或任务手工命令时额外传入 root-level `--basetemp`。

## 3. 固定 Codex 入口与当前可用性

### 3.1 固定入口脚本

| 脚本 | 责任 | 当前状态 |
| --- | --- | --- |
| `scripts/codex-reset-fixture.ps1` | 把 committed fixture 复制到 `.tmp/codex-fixture/`，并生成 reset 报告 | 已可用，输出 staged workspace DB 路径 |
| `scripts/codex-test-backend.ps1` | 跑固定 backend pytest 切片，并写入 `latest-backend.txt` | 当前可直接使用 |
| `scripts/codex-test-frontend.ps1` | 跑固定 frontend focused tests，始终输出全局 TypeScript 报告，可选 strict/live acceptance | `-IncludeLiveAcceptance` 会使用 committed seed fixture 启动真实 API smoke |
| `scripts/codex-smoke.ps1` | 纯 orchestrator，先 reset fixture，再跑 backend/frontend 固定入口 | fixture 资产存在；不再按缺失 fixture 预判阻塞 |

### 3.2 backend 固定验证切片

`scripts/codex-test-backend.ps1` 当前固定跑以下测试：

- `tests/test_backend_api.py`
- `tests/test_composition_api.py`
- `tests/test_creation_session_refresh.py`
- `tests/test_real_backtest_api.py`
- `tests/test_factor_research_api.py`
- `tests/test_factor_expression_engine.py`
- `tests/test_factor_factory_api.py`
- `tests/test_factor_mining_api.py`
- `tests/test_factor_quarantine_api.py`
- `tests/test_multi_factor_strategy_api.py`
- `tests/test_optimization_execution_resume.py`
- `tests/test_optimization_resume_api.py`
- `tests/test_runtime_supervisor.py`
- `tests/test_strategies_smoke.py`

### 3.3 frontend 固定验证切片

`scripts/codex-test-frontend.ps1` 当前固定跑以下 focused Vitest 切片：

- `app.routes.foundation.test.tsx`
- `creation-template.route.test.tsx`
- `composition.dashboard.test.tsx`
- `leg.inventory.test.tsx`
- `composition.workbench.test.tsx`
- `composition.detail.test.tsx`
- `composition.global-index.test.tsx`
- `composition.backtest.result.test.tsx`
- `composition.allocation.test.tsx`
- `creation.flow.test.tsx`
- `factor.factory.test.tsx`
- `factor.sandbox.test.tsx`
- `factor.quarantine.test.tsx`
- `factor.model-builder.test.tsx`
- `backtest.submit.test.tsx`
- `run-detail.page.test.tsx`
- `workspace.dashboard.test.tsx`
- `snapshots.page.test.tsx`
- `optimization.module.test.tsx`
- `App.phase3.test.tsx`
- `shell-frame.page-heading.test.tsx`
- `quickstart.preview.test.ts`

额外规则：

- 无论是否传 `-StrictGlobalTypes`，脚本都会跑一次 `npx tsc --noEmit` 并写报告。
- 只有显式传入 `-StrictGlobalTypes` 时，全局 TypeScript 报错才会变成阻塞门禁。
- 只有显式传入 `-IncludeLiveAcceptance` 时，才会尝试启动本地 backend 并运行 `web/scripts/run-live-acceptance.cjs`。

### 3.4 当前实践建议

在已提交种子 fixture 资产存在后，当前建议如下：

- backend 改动：直接运行 `scripts/codex-test-backend.ps1`
- frontend 改动：直接运行 `scripts/codex-test-frontend.ps1`
- `scripts/codex-smoke.ps1` 可作为 fixture-backed orchestrator 使用；失败时报告具体 reset/API/UI 断言
- `scripts/codex-test-frontend.ps1` 通过 `web/scripts/run-vitest-fixed.cjs` 启动 Vitest，固定入口会避开 Vite config/esbuild 子进程加载路径，并对 Windows `net use` realpath probe 做启动保护；若命令超过 540 秒，脚本会写入 timeout 报告并停止子进程树。

## 4. 系统与运行时总览

### 4.1 技术栈真相

- backend：Python + FastAPI + Pydantic + SQLite
- frontend：React 19 + TypeScript + Vite + Vitest
- Python packaging 约束来自 `pyproject.toml`，当前真实要求是 `>=3.12`
- frontend 依赖版本真相来自 `web/package.json`

### 4.2 QuickStart 真相

Codex 对话默认不要直接反复重启本地脚本。先使用 `powershell -ExecutionPolicy Bypass -File .\scripts\runtime-supervisor.ps1 status quickstart` 或 `start-if-not-running quickstart` 查看/提交意图；确需重启时使用 `restart <service> --force --reason ...`，让 supervisor 记录锁、冷却窗口、pending intent 和 `.tmp/runtime-supervisor/state/*.json` 状态镜像。人工仍可运行 `QuickStart-Grit.ps1`，但 QuickStart 启动前会调用 supervisor guard；如果 `8000` backend 与 `4173` preview 已健康运行，启动器会复用现有监听而不是默认 Stop-Process 重启。

`QuickStart-Grit.ps1` 是人工启动主入口，当前职责包括：

- 启动 backend 到 `http://127.0.0.1:8000`
- 启动 frontend 到 `http://127.0.0.1:4173/#/workspace`
- backend 健康等待默认最多 `75` 秒；若首次等待窗口刚好错过慢启动完成，会先执行离线 import/storage probe，再复查一次真实 `/healthz`，避免把 `BACKEND_PROBE_OK` 误读成 HTTP 服务已经失败。
- backend 的 snapshot / PIT read-model cache 预热不阻塞 `/healthz`；默认在 FastAPI startup 后用后台线程执行，可用 `GRIT_STARTUP_READ_MODEL_PREWARM=skip` 关闭。
- QuickStart 会在启动 preview 前显式执行一次前端 production build，然后通过 `web/preview-server.mjs --watch` 服务 `4173`；不要再给该 QuickStart preview 追加 `--rebuild-on-start`，否则会在启动时重复构建。独立运行 `npm run preview:auto` 时仍使用 preview-server 自带的 startup rebuild。
- 优先使用 repo 内 `.python-runtime/`
- 优先 Python 3.14，回退到 3.13
- 维护 `.venv/` 为派生环境
- 在需要时修复 `web/node_modules`

### 4.3 关键环境变量

| 环境变量 | 作用 |
| --- | --- |
| `GRIT_BACKTEST_DB` | 覆盖默认 SQLite 主库路径 |
| `GRIT_ENABLE_OPENBB_PROVIDER` | 设为 `1` / `true` / `yes` / `on` 时启用可选 OpenBB 快照增强层；默认关闭，缺 OpenBB 或缺 key 不应影响启动 |
| `TIINGO_API_TOKEN` | Tiingo EOD / 公司行动修复凭证；OpenBB 启用时也会运行时映射到 `obb.user.credentials.tiingo_token`，不写入本地 OpenBB 设置文件 |
| `ALPHAVANTAGE_API_KEY` | OpenBB Alpha Vantage targeted repair 凭证，运行时映射到 `alpha_vantage_api_key`，不写入本地 OpenBB 设置文件 |
| `FMP_API_KEY` | FMP free-account 凭证，用于 historical constituent、退市身份与可选价格补丁；OpenBB 启用时运行时映射到 `fmp_api_key` |
| `NASDAQ_DATA_LINK_API_KEY` | Nasdaq Data Link WIKI 与 Tables API 凭证，用于 2018 年前美国股票历史价格补丁；Tables EOD 默认尝试 `QUOTEMEDIA/PRICES`，可用 `GRIT_NASDAQ_DATA_LINK_PRICE_TABLES` 覆盖为逗号分隔表代码；不等同于 Nasdaq real-time/delayed API 的 client credentials；只读环境变量，不写入缓存、SQLite 或日志 |
| `FINNHUB_API_KEY` | Finnhub 凭证，用于 company profile、listing status 身份交叉校验与小批 targeted candle fallback；行业字段仅作辅助 metadata |
| `SEC_USER_AGENT` | SEC EDGAR 身份/生命周期确权 user agent，必须包含可联系邮箱；只读环境变量，不落库 |
| `GRIT_ENABLE_STOOQ_ONLINE` | 设为 `1` / `true` / `yes` / `on` 后，Stooq offline ZIP 不可用时允许按单标的在线 CSV 补丁 |
| `GRIT_STOOQ_ONLINE_CACHE_DIR` | 覆盖 Stooq 在线 CSV manifest/cache 目录；默认 `.tmp/pit-bulk-cache/stooq` |
| `FRED_API_KEY` | OpenBB FRED 固定收益曲线凭证，运行时映射到 `fred_api_key`，不写入本地 OpenBB 设置文件 |
| `GRIT_PYTHON_RUNTIME_SOURCE` | 为 QuickStart 指定可复制的 Python runtime 来源 |
| `GRIT_OPTIMIZATION_STEP_DELAY_SECONDS` | 覆盖优化 trial 之间的人工延迟；默认运行态为 `0`，测试态保持极小延迟以稳定观察进度刷新 |
| `GRIT_SNAPSHOT_MEMORY_LIMIT_RATIO` | 控制 Windows 下 snapshot refresh 的内存护栏比例 |
| `VITE_API_BASE_URL` | 覆盖前端请求 API base |
| `LIVE_API_BASE` | live acceptance 时覆盖测试 API base |
| `LIVE_FIXTURE_MANIFEST` | live acceptance 时显式指定 fixture manifest |

第三方补源凭证只在 backend 进程启动时从环境变量读取。`#/snapshots` 底部输入框只在当前浏览器标签页用 `sessionStorage` 暂存密钥草稿，刷新页面会保留，关闭标签页或点击清空会删除；它不会提交后端、不会落库，也不会改变运行中的 provider 状态。复制出的命令会为每个已输入 key 同时写入 Windows 用户环境和当前 PowerShell 进程，然后启动 QuickStart：`User` 作用域保证后续新 PowerShell/QuickStart 自动继承，`Process` 作用域保证当前这次重启立即可用。若已经启动了 QuickStart/backend，刷新浏览器页面不会让运行中的后端读取新值；必须重启 QuickStart/backend，随后用快照页重新检查 provider 状态。临时 `$env:ALPHAVANTAGE_API_KEY=...`、`$env:TIINGO_API_TOKEN=...`、`$env:MASSIVE_API_KEY=...` 或 `$env:POLYGON_API_KEY=...`、`$env:KAGGLE_API_TOKEN=...`、`$env:NASDAQ_DATA_LINK_API_KEY=...`、`$env:FINNHUB_API_KEY=...` 只适合当前 PowerShell 进程；新开窗口不会继承，除非同时写入 Windows 用户环境，或把值放入 gitignored 的 `QuickStart-Grit.local.ps1`。

当快照页或人工命令写入 `KAGGLE_API_TOKEN`、`MASSIVE_API_KEY` / `POLYGON_API_KEY`、`NASDAQ_DATA_LINK_API_KEY` 等 provider key 后，必须让 backend 进程重新启动才会读取新环境。普通 `QuickStart-Grit.ps1` 会复用健康监听；配置变更应使用 `powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -ForceRestart -RestartReason "snapshot provider credentials updated"`。该路径会先通过 runtime supervisor 记录 `restart --force`、reason 与 cooldown，再替换 repo-owned 的 `8000` backend 和 `4173` preview，不允许用 detached `cmd start` 或隐藏 PowerShell 作为常规生效路径。

OpenBB 是可选 extra，不属于默认安装面。需要真实 OpenBB 验收时，先安装并构建扩展：

- `.\.venv\Scripts\python.exe -m pip install -e ".[openbb-provider]"`
- `.\.venv\Scripts\openbb-build.exe`（若命令未在当前 shell 可见，重新打开 shell 或直接调用 venv Scripts 下的可执行文件）

启用后再设置 `GRIT_ENABLE_OPENBB_PROVIDER=1` 与所需 key。凭证只从环境变量读入并在 lazy 初始化时写到内存中的 `obb.user.credentials.*`，不得写入或依赖 `~/.openbb_platform/user_settings.json`。只读 provider registry / attempts 响应也只能展示环境变量名称与 configured/missing 状态，不能包含密钥值。

### 4.4 默认路径真相

- 默认主库：`.grit_backtest_platform.sqlite3`
- 默认 market-data companion：`.grit_backtest_platform_market_data.sqlite3`
- 默认 fixture staging 目录：`.tmp/codex-fixture/`
- smoke 摘要目录：`harness/reports/smoke/`
- 临时日志与运行产物：`.tmp/` 或 `artifacts/`

### 4.5 main.py 的命令面

`src/grit_backtest_platform/main.py` 当前暴露三个主命令：

- `serve`
- `refresh-snapshots`
- `backfill-backtest-costs`

补充规则：

- `serve` 默认通过 `uvicorn` 启动 FastAPI app
- `refresh-snapshots` 支持 `incremental`、`repair`、`full`；repair 可用 `--repair-symbol-limit N` 或 API `repair_symbol_limit` 在单个 job 中扩大本次 missing-symbol 批量，默认仍按小批轮转保护免费源配额
- `refresh-snapshots --targets ...` 现在支持 `valuations`，用于刷新 `ds-index-valuations` 月频估值快照；默认股票/指数刷新链路应包含 `price,corporate,valuations,universes`
- `refresh-snapshots` 在 Windows 下会使用基于 `GRIT_SNAPSHOT_MEMORY_LIMIT_RATIO` 的内存 job object 护栏
- `backfill-backtest-costs` 会按默认 `fee_bps=1.5`、`slippage_bps=2.5` 重跑所有永久保存的历史回测，并覆盖原持久化结果；可通过 `--fee-bps` / `--slippage-bps` 改写本次回刷参数

### 4.6 Codex Auto Memory 接线真相

- 当前仓库已接入 project-scoped Codex Auto Memory retrieval MCP，配置文件为 `.codex/config.toml`，指向 `cam mcp serve`。
- 仓库级代理说明中的 Codex Auto Memory guidance 由 `AGENTS.md` 内的 `cam:codex-agents-guidance` managed block 承载。
- 项目级默认配置文件为 `codex-auto-memory.json`；本地覆盖文件为 `.codex-auto-memory.local.json`，应保持本地忽略。
- 当前推荐的 durable memory 检索顺序是：优先走 retrieval MCP，其次走本地 bridge bundle 的 `memory-recall.sh`，最后才直接调用 `cam recall`。
- 检索时使用渐进披露：先 `search`，再 `timeline`，最后 `details`；推荐 preset 为 `state=auto` 与 `limit=8`。
- 当任务会影响 durable memory 时，优先使用 `cam sync --cwd <repo-root>` 收口，并通过 `cam memory --recent --cwd <repo-root>` 复核最近写回。
- 当前若仓库尚未形成可用的 durable memory 内容，`cam memory reindex --scope all --state all` 可能会报告没有 sidecar 可重建；这不影响 project-scoped MCP 接线本身生效。

## 5. 模块地图与代码真相

### 5.1 backend 模块映射规则

当前仓库没有直接提交 `service.py`、`real_service.py`、`storage.py` 这些直名文件。实际运行时通过 `src/grit_backtest_platform/__init__.py` 把公开模块名映射到恢复后的实现文件：

| 公开模块名 | 实际文件 |
| --- | --- |
| `storage` | `._storage_restored` |
| `creation_templates` | `._creation_templates_rebuilt` |
| `market_data_repository` | `._market_data_repository_restored` |
| `backtest_engine` | `._backtest_engine_restored` |
| `backtest_metrics` | `._backtest_metrics_restored` |
| `service` | `._service_rebuilt` |
| `real_service` | `._real_service_rebuilt` |

这条规则必须明确，因为很多 import 表面上看是 `from .service import ...`，实际承载逻辑的是 `*_restored.py` / `*_rebuilt.py`。

### 5.2 backend 关键文件

- `src/grit_backtest_platform/api.py`
  - FastAPI 入口与路由定义
  - app 生命周期与 service 装配
- `src/grit_backtest_platform/main.py`
  - CLI 启动、`refresh-snapshots` 与 `backfill-backtest-costs`
- `src/grit_backtest_platform/models.py`
  - 请求体与关键状态词汇
- `src/grit_backtest_platform/_service_rebuilt.py`
  - 主业务 service
- `src/grit_backtest_platform/_real_service_rebuilt.py`
  - 基于真实 SQLite/runtime 数据的 service 扩展
- `src/grit_backtest_platform/_storage_restored.py`
  - SQLite 存储实现
- `src/grit_backtest_platform/_market_data_repository_restored.py`
  - snapshot、公司行为、指数估值与市场数据落库

### 5.3 API 路由真相

当前 `api.py` 暴露的高价值路由包括：

- `GET /healthz`
- `GET /workspace/overview`
- `GET /leg-inventory`
- `POST /asset-legs`
- `POST /cash-legs`
- `GET /strategies`
- `GET /strategies/{strategy_id}/detail`
- `PATCH /strategies/{strategy_id}`
- `POST /strategy-creation-sessions`
- `GET /strategy-creation-sessions/{session_id}`
- `POST /strategy-creation-sessions/{session_id}/messages`
- `POST /strategy-creation-sessions/{session_id}/prepare-confirmation`
- `PATCH /strategy-creation-sessions/{session_id}/confirmation`
- `POST /strategy-creation-sessions/{session_id}/materialize`
- `GET /backtest-runs`
- `GET /backtest-runs/{run_id}/detail`
- `GET /backtest-runs/{run_id}/trades`
- `DELETE /backtest-runs/{run_id}`
- `GET /backtest-runs/{run_id}/trades/{trade_id}/audit`
- `POST /strategies/{strategy_id}/backtest-runs`
- `POST /strategies/{strategy_id}/backtest-runs/preview`
- `POST /backtest-runs/{run_id}/clone`
- `GET /compositions`
- `GET /compositions/backtest-runs`
- `GET /compositions/allocation-jobs`
- `GET /compositions/{composition_id}`
- `POST /compositions/preview`
- `POST /compositions`
- `PATCH /compositions/{composition_id}`
- `POST /compositions/{composition_id}/diagnostics/refresh`
- `POST /compositions/{composition_id}/source-freezes/refresh`
- `POST /compositions/{composition_id}/proxy-confirmations`
- `POST /compositions/{composition_id}/backtest-runs`
- `GET /compositions/{composition_id}/backtest-runs/{run_id}`
- `GET /compositions/{composition_id}/backtest-runs/{run_id}/orders`
- `GET /compositions/{composition_id}/backtest-runs/{run_id}/orders/{order_id}/netting`
- `GET /compositions/{composition_id}/backtest-runs/{run_id}/orders/export`
- `POST /compositions/{composition_id}/allocation-jobs`
- `GET /compositions/{composition_id}/allocation-jobs/{job_id}`
- `GET /compositions/{composition_id}/versions`
- `GET /compositions/{composition_id}/versions/{version_id}`
- `POST /compositions/{composition_id}/allocation-jobs/{job_id}/candidates/{candidate_id}/promote-draft`
- `POST /compositions/{composition_id}/decision-packets`
- `GET /compositions/{composition_id}/decision-packets/{packet_id}`
- `GET /compositions/{composition_id}/decision-packets/{packet_id}/export`
- `GET /pit-data`
- `POST /pit-data/research-waiver`
- `DELETE /pit-data/research-waiver/{waiver_id}`
- `POST /pit-data/identity-overrides`
- `POST /pit-data/identity-scraper/restart`
- `GET /factors`
- `POST /factors`
- `POST /factors/diagnostics/preview`
- `GET /factors/{factor_id}`
- `POST /factors/{factor_id}/diagnostics`
- `GET /factors/{factor_id}/diagnostics/{run_id}/report`
- `GET /optimization-jobs`
- `GET /optimization-jobs/{job_id}/detail`
- `PATCH /optimization-jobs/{job_id}`
- `POST /optimization-jobs/{job_id}/filtered-results`
- `DELETE /optimization-jobs/{job_id}`
- `POST /strategies/{strategy_id}/optimization-jobs`
- `POST /optimization-jobs/{job_id}/resume`
- `POST /optimization-jobs/{job_id}/candidates`
- `POST /optimization-jobs/{job_id}/candidates/{trial_id}/promote`
- `DELETE /optimization-jobs/{job_id}/candidates/{trial_id}`
- `GET /data-snapshots/overview`
- `POST /admin/snapshot-refresh-jobs`
- `GET /data-snapshots/overview` 的 `dataset_snapshots[]` 现在包含 `ds-index-valuations`；其 metadata 暴露 `proxy_keys`、`observation_frequency`、`latest_pe_ttm`、`latest_percentile_10y`
- `GET /data-snapshots/overview` 本期 additive 暴露 `data_layer_readiness[]`、`snapshot_quality_alerts[]` 与 `factor_dimension_readiness[]`，供 `#/snapshots?tab=equity` 渲染 L1-L4 分层治理、异常告警和因子维度就绪矩阵；不得改变既有 `overall_status`、`blocking_code`、`provider_readiness_summary` 与 `bond_fixed_income` 的语义

当前一期 Compose First 的补充真相：

- `GET /leg-inventory` 是统一读模型入口：策略腿来自 `strategy + parameter version + latest eligible run` 的投影，不落独立真相表；资产腿与现金腿来自最小持久化定义表；`strategy_reference_counts` 是资产库首屏引用数的正式投影，前端不得为了引用计数逐个拉取组合详情。
- `GET /strategies` 与 `GET /backtest-runs` 属于工作台和资产库共享热路径；服务端可以用更新时间签名和短突发窗口复用列表投影，但窗口外必须重新校验策略、回测和优化任务更新时间，避免长期展示旧列表。
- `POST /asset-legs` 与 `POST /cash-legs` 只负责最小定义落库，不建立版本树，也不改写策略主链路。
- `GET /compositions`、`GET /compositions/{id}`、`POST /compositions/preview`、`POST /compositions`、`PATCH /compositions/{id}` 共同组成一期组合工作台与详情页的正式契约面。
- `POST /compositions/preview` 返回权重摘要、收益流预演、相关性矩阵、风险贡献预览、维护成本与再平衡摘要，供工作台边调边判断；Phase 1.2 同时返回 `return_quality_summary`、`rebalance_events`、`source_integrity`，并在风险贡献里补充边际贡献、预算占用、债券久期/凸性占用。
- `GET /compositions/{id}` 继续读取冻结来源；Phase 1.2 详情额外返回 `audit_trail`，并扩展 `source_evidence` 的 `signature_status`、`drift_status`、`current_ref_id`、`alerts`。来源漂移只提示，不自动改写已保存组合。
- Sleeve OS v1 新增组合层回测与资产配置契约。组合回测运行用于稳定性复核、订单穿透和证据留痕，订单导出支持 CSV 与最小 XLSX 工作簿；组合资产配置任务用于意图导航、约束预检、有效前沿候选和迁移成本评估。若真实长周期、真实成交或底层持仓数据不足，接口与页面必须显式展示代理、质量或不可用状态。
- Sleeve OS v2 已接入“全局索引 + 持久记录 + 晋升版本 + 决策包”闭环。新增 `#/compositions/list`、`#/compositions/backtest-runs`、`#/compositions/lab` 三个全局路由；`GET /compositions/backtest-runs`、`GET /compositions/allocation-jobs`、组合版本查询、allocation 候选晋升 draft version、decision packet 创建 / 读取 / Markdown/HTML 导出是正式 additive 契约。源码切片必须保持 `models.py`、`api.py` 与 `web/src/types.ts` 同步。
- 组合订单 Gate 6 防逃逸（project-local）：凡是用户报告组合订单、订单明细、订单穿透、缺单或订单归因异常，排查必须同时检查组合层 `rebalance_events` 和每个策略腿冻结/来源回测的 `trades_json`。不能只看组合层再平衡订单，也不能只以 `/orders` 的当前列表数量下结论；需要核对 `generated_from`、`execution_kind`、`trigger_reason`、策略腿 `latest_run_id/source_run_id` 与源策略首个/后续交易日期，确认 `composition_rebalance_events` 与源策略内逻辑订单都进入证据链。
- `composition_audit_events` 是 Phase 1.2 后端 append-only 审计表；创建、结构 PATCH、状态切换、来源冻结、再平衡检查和债券快照刷新影响检查都应写入该表，详情 `audit_trail` 从持久化事件流读取，旧数据才允许回退到临时投影。
- `GET /data-snapshots/overview` 继续作为唯一快照总览入口；债券/固定收益治理页通过新增 `bond_fixed_income` 分段扩展现有契约，不另开第二套快照 API。Phase 1.2 的债券质量字段包括 `quality_audit`、`repair_rules`、`daily_accrual_status`、`risk_budget_inputs`，修复/补齐仍走 `POST /admin/snapshot-refresh-jobs` 的 `bond` target。

当前多因子第二期第一步的补充真相：

- 正式可操作交付面包括 `PIT 清洗中心`、`因子库`、`因子详情/诊断`、`因子编辑器`、`因子工厂` 与 `多因子策略创建`。三期本轮不改策略详情、回测详情、回测配置、优化配置或优化结果页模块。
- 左侧导航的 `因子` 组当前包含 `因子库` 与 `因子工厂`；`#/factors/factory` 合并原 `挖掘沙盒` 与 `检疫工作台`，旧 `#/factors/sandbox`、`#/factors/quarantine` 仍保持兼容并进入同一页对应分区。因子工厂首屏任务队列、候选摘要、检疫队列和漏斗必须读取 `GET /factor-factory/overview` 的运行时结果，不得用本地默认任务、静态候选或设计稿样例补位；每日自动化固定为 `GMT+8 14:00`，工厂 run 完成挖掘后必须自动送入 D2 并执行检疫；候选只保存表达式、fitness、非重叠 Rank IC、Newey-West 修正 IR、回撤和残差摘要，不能直接进入正式因子库。长周期动量的 IR 必须按持有期重叠收益做 Newey-West/Bartlett 修正，63 日动量需记录相对 `Return(Close, 3)` 的残差 IC 作为纯净 IC 证据。`数据` 组必须同时保留 `PIT 清洗中心` 与 `数据快照`；本期数据页已升级为“快照分层治理 + PIT 门禁联动”，其中 `#/snapshots?tab=equity` 保留线上工作台骨架并引入 L1-L4 数据层级，`#/pit-data` 保留既有清洗链路并新增 L1-L4 PIT 准入与因子维度就绪矩阵。
- `GET /pit-data` 负责点时价格、样本池、异常清洗与未来函数门禁摘要，供因子诊断判断数据可用性；本期 additive 暴露 `pit_layer_readiness[]`、`factor_diagnostic_readiness[]`、`pit_quality_alerts[]` 与 `snapshot_layer_linkage[]`，用于 L1-L4 PIT 准入、因子维度就绪矩阵和 `snapshot -> PIT` 逻辑映射。
- `POST /pit-data/research-waiver`、`DELETE /pit-data/research-waiver/{waiver_id}`、`POST /pit-data/identity-overrides` 与 `POST /pit-data/identity-scraper/restart` 是 PIT 清洗中心当前写入面：分别负责研究态豁免、撤销豁免、人工身份映射和身份修复任务重启。它们只改变 PIT 诊断治理状态，不绕过 Full Ready、正式晋升或组合入库门禁。
- `GET /pit-data` 属于全路由首屏性能敏感 API：服务可以对读取结果使用短时缓存，但 PIT 写入接口必须主动失效缓存，避免豁免、身份覆盖或身份修复任务重启后的页面继续显示旧治理状态。
- `GET /factors`、`POST /factors`、`GET /factors/{factor_id}`、`POST /factors/{factor_id}/diagnostics`、`POST /factors/diagnostics/preview` 与 `GET /factors/{factor_id}/diagnostics/{run_id}/report` 是因子库固定 API 切片；`POST/GET /factor-mining/jobs`、`GET /factor-mining/jobs/{job_id}`、`POST /factor-mining/jobs/{job_id}/cancel` 是挖掘任务 API 切片，创建任务必须读取 `ds-price` 运行时价格快照并在摘要中暴露 `market_data_source=dataset_price_bars`、`synthetic_market_data=false` 与价格标的覆盖数量，缺少可用价格快照时返回中文阻断；`GET /factor-factory/overview`、`POST /factor-factory/automation/start`、`POST /factor-factory/automation/pause`、`POST /factor-factory/run-now` 与 `POST /factor-factory/runs/{id}/cancel` 是因子工厂固定 API 切片；`POST /factor-models/preview` 与 `POST /factor-models` 是多因子策略创建固定 API 切片。若请求或响应字段变化，`src/grit_backtest_platform/models.py`、`web/src/types.ts`、demo store 与 test API mock 必须同任务同步。本期因子治理合同保持 additive：`GET /factors` 追加前台诊断状态、批量诊断摘要、相关性簇摘要、阻断原因摘要、策略创建风险和 `lifecycle=online|offline|all` 查询；下线投影只读返回 `offline_reason`、`offline_at`、`offline_command` 与 `offline_detail`。`POST /factors/diagnostics/preview` 在单因子 preview 外支持 `{batch: true, factor_ids, diagnostic_mode, include}` 只读批量投影，不落库、不新增批量 UI。
- 因子详情页交付不得只用路由可达、标题/文案存在或 mock 单测作为通过标准。涉及批准稿的 `#/factors/:factorId` 必须用实际 canonical route（例如 `#/factors/s_mom_12m1m_rank`）建立 UI trace matrix，逐项核对紧凑标题区、十格证据热力图、换手率与衰减、分层收益、极端场景、风险提示、审计足迹和 PDF 报告入口，并保留截图或 DOM 结构证据；未完成这些证据时不能宣布页面与设计稿一致。
- 三期检疫与治理固定 API 覆盖 `POST /factor-quarantine/intake`、`GET /factor-quarantine/candidates`、候选详情、候选重跑、候选发布、因子工厂 API、`GET /factor-governance/overview`、`POST /factor-governance/actions/{action_id}/execute` 与 `POST /factor-models/suggestions`。PIT 非 Full Ready 在因子工厂检疫中只作为诊断证据，不得单独制造 `REJECTED` 或 `MANUAL_REVIEW_REQUIRED`；泄露/反穿越、`Rank IC > 0.8`、`Turnover = 0`、OOS/IS 衰减 `< 0.5`、逻辑重复、Auto-Residual 失败和最大回撤相对基准 `>= 1.5x` 仍是硬拒绝。治理概览只返回 `DEPRECATE`、`PRUNE` 与 `FACTOR_MODEL_SUGGESTION`，不把历史 `REVIEW/CROWDED/DECAYED` 诊断消息混入任务弹层；对没有正式诊断但批量只读预览已投影为 Grade D 噪声的线上因子，治理概览必须用同一 `FACTOR_EXPRESSION_PREVIEW` 证据生成 `DEPRECATE` 任务并在 `offline_detail.preview_only` 留痕；`PRUNE` 的同簇 MVP 比较必须使用同一批预览增强后的线上因子集合，并复用因子库热力图的 pairwise 相关性口径，但只在同 descriptor category / 同风格簇内触发，不能重新读取缺少预览摘要的原始因子行或只看 cluster top-N 而漏掉冗余任务；执行类治理任务必须带 `confirm=true`、指令、因子 id 和理由，服务端执行前重新计算证据；`DEPRECATE` 写入 `DEPRECATED`，`PRUNE` 只写入冗余因子的 `PRUNED` 并保留 MVP 证据，策略草稿建议只跳转创建页且保持草稿。接口契约变更必须同步 `src/grit_backtest_platform/models.py`、`web/src/types.ts` 和对应 demo/mock 客户端。
- 因子库 UI 改造边界固定在 `#/factors` 内 additive 升级：表格上方新增 `线上因子 / 已下线因子` tab；表头固定为 `因子、来源、诊断状态、最近诊断、因子级别、下线原因、下线时间`；指标区第四张卡改为 `治理任务`，点击后懒加载完整治理动作弹层，`DEPRECATE/PRUNE` 打开二次确认后才写入下线状态。底部相关性热力图只能接收当前 tab 与当前筛选条件下的可见因子集合，tab 或筛选切换后必须清理不再可见的选中/比对状态。
- 因子详情 UI 改造边界固定为右侧足迹模块：`合规足迹` 改为 `审计足迹`，展示回溯窗口、检疫/诊断、发布和治理消息时间；其他指标、布局和操作不随本轮调整。
- 多因子创建页只接受治理任务传入的因子、方向和建议权重作为草稿预填，仍必须走预览、PIT 门禁和人工确认；不得直接覆盖生产策略版本，下线因子必须被 preview/create 拒绝或排除。
- 本轮后端切片覆盖 `tests/test_factor_factory_api.py`、`tests/test_factor_mining_api.py`、`tests/test_factor_quarantine_api.py` 与 `tests/test_factor_research_api.py` 的工厂自动化、fitness、Auto-Residual、回撤闸门、PIT 诊断非阻断、治理执行、软下线和策略模型阻断；前端切片为 `web/src/factor.factory.test.tsx`、`web/src/factor.model-builder.test.tsx` 与 `web/src/app.routes.foundation.test.tsx` 的工厂路由兼容、自动化按钮、漏斗、残差报告、回撤闸门、PIT 诊断、治理任务、二次确认、路由预填、双 tab、七列表头、热力图筛选和检疫工作台断言。固定验证仍使用 `scripts/codex-test-backend.ps1`、`scripts/codex-test-frontend.ps1`，契约变更后补 `-StrictGlobalTypes`。
- 默认五类常用因子固定使用 7 个 baseline 分层描述符 canonical ID：`s_val_ep_ltm_raw`、`s_val_bp_latest_raw`、`s_mom_12m1m_rank`、`s_qlty_roe_ltm_raw`、`s_qlty_fcfy_ttm_raw`、`s_vol_252d_rank` 与 `s_size_cur_log`。Factor Zoo 种子层可继续 additive 扩展 beta、投资、流动性、alpha blend 等自研描述符，但必须仍走本项目白名单表达式引擎，不能引入外部 factor 包或第三方 factor 代码。旧默认 ID 只作为 alias 兼容读取，不能出现在 `GET /factors` 列表展示中。`POST /factors` 必须携带 `source_category_metric_window_operator` 描述符，人工因子 ID 由 `m_<category>_<metric>_<window>_<operator>` 生成，重复 descriptor 返回 409。
- 基础面 PIT 数据平面由 `ds-fundamentals`、`dataset_fundamental_points` 与 `dataset_fundamental_coverage` 承载；基本面点位必须有 `available_at`，诊断只能读取 `available_at <= observation_date/as_of_date` 的观测，不能用财报期末日替代可得日。市值默认由复权收盘价乘 `shares_outstanding` 推导，供应商市值只保留差异；企业价值优先使用供应商 EV，缺失时回退为 `MarketCap + TotalDebt - CashAndEquivalents`。若 `ds-fundamentals` 缺失或字段不全，应显示明确的 `基础面 PIT 缺口` 并阻止诊断。
- 表达式引擎统一供诊断、挖掘和多因子打分使用，白名单只允许价格字段、基础四则、`Lag`、`Return`、`Std`、`Log`、`Rank`、`Winsorize`、`ZScore` 等安全算子；必须拒绝 `import`、`eval`、`__`、分号、未知字段、未知算子、过深 AST 与 `t+N` 未来引用。行业中性化在缺少 PIT 行业字段时只能返回未执行 blocker，不能展示已执行。
- 前台因子状态统一使用四类：`robust/稳健`、`needs_calibration/待校准`、`decayed/失效`、`sandbox/沙箱`；软下线的 `DEPRECATED/PRUNED` 只在已下线 tab 以“已下线/冗余挂起”展示，并保留下线原因与时间。高相关、同族重叠、IC/IR 不稳定、换手衰减、coverage 边缘和诊断过期是 warning；在因子工厂发布链路中 PIT 缺口是 diagnostic warning 而非单独 hard blocker，但未来函数、不可回放/current-only 字段、unsafe expression、缺失 `available_at`、启用中性化但缺行业 PIT、下线因子参与策略创建，以及检疫硬拒绝项仍是 hard blocker。
- `POST /factor-models` 必须复用现有 `strategies` 与 `strategy_parameter_versions`，写入 `strategy_type=MULTI_FACTOR` 和参数快照；创建前必须重新跑 preview，并消费 `strategy_creation_risk`。只有 hard blocker 或启用行业中性化但缺 PIT 行业字段时拒绝物化；高相关、同族重叠和 `VERIFIED_PIT_WINDOW_INCOMPLETE` 只提示风险，不能阻断创建。当 PIT 价格缺口仅落在非核心成员、核心/历史核心缺口为 0 且非核心缺口市值权重为 0 时，`strategy_creation_risk` 必须把 `PRICE_SNAPSHOT_NOT_READY` / `PIT_GATE_BLOCKED` 转为 warning，发布 `summary_label=低风险准入` 并允许创建；行业中性化缺字段、基础面 PIT、unsafe/current-only 仍保持硬阻断。`#/factor-models/new` 本期只新增/替换右侧策略创建风险模块，选择因子、权重预览、中性化控制和创建按钮结构不得跟随设计稿扩展重做。`#/strategies` 新建策略弹层中的“创建多因子策略”只跳转 `#/factor-models/new`，不得调用旧 creation session。
- 批准 UI 稿里的多因子权重、覆盖率、得分样本、中性化状态和策略门禁只能作为视觉结构示例，运行时必须读取 `GET /factors`、`POST /factor-models/preview` 与 `POST /factor-models` 的真实结果；接口未返回建议权重时只可从当前已选因子等权初始化，不能把设计稿示例权重、指标或成功态复制为运行时真相。
- `SP500` 行业中性化的当前真实数据源挂在 `universe_membership_snapshots.metadata_json` 的 per-symbol GICS metadata，优先字段为 `gics_sector` / `GICS Sector` / `sector`，读取必须满足 `effective_date <= as_of_date` 且成员状态可用。`POST /factor-models/preview` 必须在 SQL 层按当前候选 symbol、as-of 日期和 active membership 切片读取，不能为一个预览全量拉取 universe membership 历史。策略详情 profile、回测 precheck 和回测归因都应 additive 暴露 `taxonomy=GICS`、`industry_field`、`covered_symbol_count`、`missing_symbol_count` 与 `source_names`；缺字段时保留 blocker，不写静态行业兜底。
- 前台文案全部中文；因子入口命名为 `因子库`，不得使用广场类命名。
- `#/factors` 的研判区属于前端性能敏感面：相关性热力图按 descriptor category 聚类排序，提供 `仅显示高相关对` 筛选，超过可视阈值时使用虚拟矩阵窗口；同类高相关和跨类别高相关必须有不同强度提示。表格 IC sparkline 使用带 0 位虚线的双色区域图；操作列最多勾选两个因子并切换到因子指纹比对。`SANDBOX_READY` 因子的数据门禁旁必须提供 `缺口速报` 浮层和跳转 PIT 覆盖率缺口清单的闭环动作。
- `#/factors` 列表首屏不得等待完整 `GET /pit-data` 或扫描完整 universe/price 明细；后端应通过轻量 PIT 门禁投影直接随 `GET /factors.summary` 返回列表可用状态，前端只消费该摘要渲染 hero 和表格，完整 PIT 概览留给 `#/pit-data` 或显式诊断入口。

当前多因子第二期第二步的补充真相：

- 第二步只把 `strategy_type=MULTI_FACTOR` 接入既有“策略详情 -> 回测配置 -> 回测详情 -> 优化配置 -> 优化结果”链路，采用 type-aware 增强；不得新建多因子专属策略、回测或优化页面，不得新增独立存储系统。
- 合同保持 additive：策略详情、回测预览、回测详情和优化配置 payload 可选返回 `multi_factor_profile`、`multi_factor_precheck`、`multi_factor_attribution` 与 `multi_factor_parameter_ranges`。非 `MULTI_FACTOR` 策略必须继续返回旧形状或 `null`，不能破坏旧策略。
- 策略详情仅优化“当前参数”的多因子键值展示；回测配置页仅新增“多因子预检”模块；回测详情页仅新增“因子归因”tab，并在现有决策侧栏追加“因子归因”和“行业暴露”评估；优化配置页仅让“参数范围”支持因子权重、打分方法、再平衡频率和中性化字段；优化结果页不得新增多因子模块，只能复用参数 formatter 防止 raw JSON 外泄。
- 多因子预检必须同时在 preview 和 submit 前执行。存在 blocked factor，或启用行业中性化但缺 PIT 行业字段时，submit 必须拒绝并返回中文 blocker。行业中性化缺证据时只能展示“未执行/阻塞”，不能显示为已执行。
- 回测详情的 `multi_factor_attribution.attribution_source` 必须区分估算与完整归因；若数据不足只能展示 estimated/source gap，不能伪装成完整归因。
- `MULTI_FACTOR` 回测 preview 属于轻量预检路径，只返回预检、快照覆盖和可行动 blocker；不得为了展示预检而执行完整回测模拟或展开全量 universe 成员。非多因子策略继续保留既有 preview 指标与图表行为。
- 多因子优化配置中的 `factor_weight__*_pct` 必须自动进入“权重合计 100%”默认约束组。优化结果读取旧任务时，应按该约束过滤无效组合，并用来源回测上下文投影不同权重组合的指标，不能把同一组指标复制给多个不同参数候选。
- 第二步固定 UI Trace Matrix 路由：`#/strategies/strat_4c86521704e2`、`#/strategies/strat_4c86521704e2/backtest-runs/new`、`#/runs/run_83b71f8f2458`、`#/optimization-jobs/new/config?strategy_id=strat_4c86521704e2&entry_point=lab_menu`、`#/optimization-jobs/opt_69682940f4ad`。验收要记录模块增减、中文参数格式化、阻塞态禁用、决策侧栏补项和优化结果页无新增模块。
- 第二步固定验证仍使用 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1`、`powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1`、`powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes`。`harness/fixtures/seed_workspace/` 已恢复后，`codex-smoke.ps1` 是否通过以实际运行报告为准。
- 多因子行业 PIT 专项的最小聚焦验证包括：`pytest tests/test_multi_factor_strategy_api.py::test_factor_model_industry_neutralization_uses_seeded_sp500_gics_pit tests/test_universe_history_official_sources.py::test_sp500_wikipedia_table_extracts_per_symbol_gics_metadata`，以及 `npm.cmd --prefix web test -- factor.model-builder.test.tsx`。通过条件是启用行业中性化后 preview/create/precheck/submit/attribution 都显示真实 `EXECUTED` 证据，且无 `MISSING_INDUSTRY_PIT` blocker。

当前优化任务 detail 的补充真相：

- `GET /optimization-jobs/{job_id}/detail` 在 `QUEUED`、`RUNNING`、`INTERRUPTED` 三种运行态必须保持零扫描优先：先直接信任 `optimization_jobs.summary_json/result_json` 里的 progress、ETA、heartbeat、resume 元数据，不在热路径扫描 `optimization_job_trials`；只有旧记录缺字段时才回退读取 trial checkpoint。
- 运行态 ETA 依赖 persisted trial 的 `started_at/completed_at` 时间戳推导，不能假设秒级精度足够。
- 终态结果中心同样优先走零 trial 快路径：当 `optimization_jobs.candidates_json/result_json` 已经持久化完成候选区时，detail 不再重新扫描 `optimization_job_trials`；只有旧记录缺失候选投影时才回退读取 trial checkpoint。
- 终态首屏读取应使用 `matching_limit` 请求参数获取候选预览。响应必须保留完整 `matching_combination_count` 与来源标记；完整 `matching_combinations` 只在“查看全部组合”等用户动作后读取。
- 大型优化任务不得把完整 `all_trials` 候选集合继续内联进 `optimization_jobs.request_json` 或 `summary_json`。当 trial checkpoint 已存在时，任务行只保存轻量候选投影，完整候选由 `optimization_job_trials` 按需重建。注意区分存储压缩与接口响应：`PATCH /optimization-jobs/{job_id}` 的重过滤预览和不带 `matching_limit` 的完整详情都必须返回完整 `matching_combinations`，不能沿用持久化压缩后的空数组。
- `optimization_job_trials.chart_series_json` 仍维持分层存储：大多数 trial 只持久化轻量 `[]`，仅终态 top-K 候选回补完整曲线。
- 优化执行期默认只持久化 trial 级 `parameter_snapshot`、`metrics`、`score` 与时间戳；完整曲线只在终态 top-K 回补并持久化。
- `optimization_job_trials` 额外下沉了热路径排序列：`return_sharpe`、`oos_sharpe`、`total_return_pct`、`stability`，用于运行态和终态减少 `metrics_json` 解码。
- 优化运行时仍然保留一套 Windows 安全的父线程加 `multiprocessing.get_context("spawn")` worker 控制器，但当前 synthetic `_service_rebuilt.py` evaluator 默认关闭这条路径，因为本地基准显示顺序执行更快。未来如果为了更重的 evaluator 显式重新启用子 worker，子 worker 也绝不能直接写 SQLite；父线程仍然必须是唯一写入者。
- 优化 worker 并发度由系统内部自动管理。当系统内存已经偏高时，启动阶段会先从 CPU 上限下调 worker 数；运行期间在系统内存到达 `80%` 时自动减掉一个 worker，到达 `90%` 时强制退回单 worker，只有连续三次采样恢复安全后才允许再次扩容。
- 当前激活的优化 evaluator 路径不再预加载 `_prepare_backtest_run_context()`。对于现行 `_service_rebuilt.py` evaluator 而言，这个预加载只是无效开销，因此任务运行器现在会完全跳过它。
- 运行中优化任务的摘要写入由唯一写入者节流：最多每秒一次，或者每完成五个 trial 写一次；每次心跳都会持久化 `completed_combinations`、`next_trial_index`、`best_metrics_summary`、`estimated_remaining_minutes`、`estimated_completed_at` 与 `heartbeat_at`，而终态状态切换仍然立即持久化。
- 执行期会增量维护 top-K 与 heatmap winner cells；终态优先复用增量摘要并只为终态 top-K 回补完整 metrics，避免全量 successful trials 再次排序和候选分析重算。
- 优化任务首组启动现在必须遵守两个热路径约束：`_ensure_optimization_snapshots_ready()` 在无 `start_date/end_date` 的优化预检里只允许读取 `dataset_symbol_coverage` 来判断 snapshot readiness，不能再次全量扫描 `dataset_price_bars`；`python -m grit_backtest_platform.main run-optimization` 也必须保持 lazy bootstrap，禁止在 worker 冷启动阶段无条件创建 FastAPI app 或 runtime market-data provider。

当前全路由首屏性能契约：

- 新页面开发和旧页面改造默认以真实 `4173` cache-busting document reload 首屏 1 秒内为目标；最终验收要记录 pass/slow/error 数量和最慢路由，不能只凭测试通过判断性能达标。
- 路由首屏 API 必须是轻量读模型：列表、摘要、overview、inventory 和结果页初载只能返回预览、聚合计数、最新摘要或显式分页窗口，不得携带完整候选盘、完整 trial ledger、完整订单流水、完整诊断轨迹或逐对象详情。
- 大集合的正式存储边界是 checkpoint/detail 表、导出接口、查看全部弹层或 drilldown 页面。若 UI 需要完整集合，先渲染首屏预览，再由用户动作触发完整读取，并为预览态与完整读取态分别补回归覆盖。优化结果这类集合必须同时覆盖三件事：持久化是否压缩、显式弹层/重过滤响应是否保留全量、前端分页和排序是否基于全量数组。
- `web/src/app-runtime-cn.tsx` 必须保持路由级 `React.lazy` 拆包；新增页面不得在入口静态 import 业务页、重图表页或大 CSS，避免所有路由共同下载无关模块。
- `web/src/app-runtime-cn.tsx` 的路由错误边界必须保留 lazy chunk 失败的一次性 cache-busting document reload；本地 preview 重建或切换 active bundle 后，旧浏览器页签不能因为缺失拆包资源停在白屏。
- 首屏只允许启动当前可见模块必须的数据请求；PIT、因子、快照、策略/回测列表、组合预览、腿库存候选补全、优化完整候选等重读取必须放到首屏后补、后台 hydrate、显式刷新或用户动作之后。
- `/pit-data` 冷路径不得调用 `load_universe_memberships()` 水合完整 `universe_membership_snapshots` 历史；首屏只能用 SQL 聚合读取成员计数、最新锚点 symbol 和缺口样本，`coverage_gap.buckets[].temporal_distribution` 必须保持有界预览，完整逐锚点明细只能放在显式下钻或导出路径。
- 热路径读模型允许服务级短缓存、更新时间签名和突发窗口复用；对应写入接口必须主动失效或刷新缓存，尤其是 PIT 豁免、身份覆盖、快照刷新、组合状态、腿部定义、优化结果候选和策略/回测状态变更。
- 跨对象引用计数和首屏 KPI 必须由列表契约直接返回，例如 `GET /leg-inventory.strategy_reference_counts`、策略最新运行摘要、组合列表摘要和快照 readiness 摘要；前端不得为了 badge、引用数或首屏指标逐个拉取详情端点。
- 如果新增或修改这些性能契约字段，同一任务必须同步 `src/grit_backtest_platform/models.py`、`web/src/types.ts`、demo store / API mock 和对应后端或前端回归测试。

### 5.4 frontend 关键入口

- `web/src/app-runtime.tsx`
  - 当前浏览器入口 shim
- `web/src/app-runtime-cn.tsx`
  - 当前实际运行时实现
- `web/src/main.tsx`
  - 浏览器 bootstrap
- `web/src/lib/appRouteContext.tsx`
  - hash router 真相
- `web/src/lib/demoStoreContext.tsx`
  - HTTP runtime client

### 5.5 frontend 路由真相

`web/src/lib/appRouteContext.tsx` 当前支持的主路由包括：

- `#/workspace`
- `#/compositions`
- `#/legs`
- `#/compositions/workbench`
- `#/compositions/list`
- `#/compositions/backtest-runs`
- `#/compositions/lab`
- `#/compositions/:id`
- `#/compositions/:compositionId/backtest-runs/new`
- `#/compositions/:compositionId/backtest-runs/:runId`
- `#/compositions/:compositionId/allocation-lab`
- `#/compositions/:compositionId/allocation-jobs/:jobId`
- `#/strategies`
- `#/creation/asset-allocation/new`
- `#/creation/sessions/:id`
- `#/strategies/:id`
- `#/strategies/:id/backtest-runs/new`
- `#/runs`
- `#/runs/:id`
- `#/snapshots`
- `#/pit-data`
- `#/factors`
- `#/factors/new`
- `#/factors/factory`
- `#/factors/sandbox`
- `#/factors/quarantine`
- `#/factors/:factorId`
- `#/factor-models/new`
- `#/optimization-jobs`
- `#/optimization-jobs/new`
- `#/optimization-jobs/new/config?strategy_id=...`
- `#/optimization-jobs/:id`

Factor routes: `#/factors/factory` is the canonical production workbench. `#/factors/sandbox` and `#/factors/quarantine` remain compatibility hashes and render the same page with the sandbox or quarantine section selected.

## 6. 契约、状态词汇与同步规则

### 6.1 高价值状态词汇

`src/grit_backtest_platform/models.py` 中当前高价值状态词汇包括：

| 类型 | 当前枚举值 |
| --- | --- |
| `CreationSessionStatus` | `DRAFTING`、`READY_FOR_CONFIRMATION`、`NEEDS_INPUT`、`LOCKED` |
| `StrategyStatus` | `DRAFT`、`ACTIVE`、`PAUSED`、`ARCHIVED` |
| `BacktestRunStatus` | `QUEUED`、`RUNNING`、`COMPLETED`、`COMPLETED_WITH_WARNINGS`、`FAILED` |
| `BacktestExecutionStage` | `DATA_FETCHING`、`SIMULATING`、`METRIC_CALCULATING` |
| `OptimizationJobStatus` | `QUEUED`、`RUNNING`、`INTERRUPTED`、`COMPLETED`、`PARTIALLY_FAILED`、`FAILED` |
| `SnapshotStatus` | `READY`、`STALE`、`INCOMPLETE`、`FAILED` |
| `FactorLifecycleStatus` | `DRAFT`、`VERIFIED`、`PRODUCTION`、`DECAYED`、`DEPRECATED`、`PRUNED` |
| `FactorDiagnosticStatus` | `READY_TO_DIAGNOSE`、`SANDBOX_READY`、`BLOCKED_PIT`、`BLOCKED_DATA`、`RUNNING`、`COMPLETED`、`FAILED` |
| `TrialStatus` | `SUCCEEDED`、`FAILED`、`PENDING` |
| `DataSegmentType` | `FULL`、`TRAIN`、`TEST`、`VALIDATION` |

### 6.2 `AllowedAction` 词汇表

当前 `AllowedAction` 真相是：

- `start_backtest`
- `open_creation`
- `generate_confirmation`
- `materialize_strategy`
- `run_backtest`
- `clone_run`
- `open_optimization`
- `promote_candidate`
- `create_copy`
- `refresh_snapshots`
- `resolve_snapshot_block`
- `edit_parameters`
- `open_strategy_detail`
- `open_leg_inventory`
- `open_composition_workbench`
- `edit_leg_definition`
- `save_composition`
- `activate_composition`
- `archive_composition`
- `inspect_source_evidence`

前后端只要有一侧新增、删除或重命名 `AllowedAction`，另一侧与相关页面测试必须同步更新。

### 6.3 契约同步规则

只要 API、模型或状态词汇发生变化，以下表面必须同任务同步：

- `src/grit_backtest_platform/models.py`
- `src/grit_backtest_platform/api.py`
- `web/src/types.ts`
- 使用这些字段的 adapter、页面与页面级测试

禁止只改 backend 或只改 frontend 一侧就宣称契约已完成。

## 7. 数据、fixture 与工件规范

### 7.1 runtime 数据与 fixture 数据必须分离

- repo 根目录 `.grit_backtest_platform.sqlite3` 与 companion 库属于 runtime 数据，不属于 smoke fixture。
- fixture 只应来自 committed seed workspace，并被 staged 到 `.tmp/` 下运行。
- committed seed fixture 已落地；live 验证仍必须先 reset 到 `.tmp/codex-fixture/`，不能直接使用 root runtime DB。

### 7.2 live acceptance 依赖

`web/scripts/run-live-acceptance.cjs` 当前要求 manifest 至少提供：

- `creation_session_id`
- `strategy_id`
- `optimization_strategy_id`
- `run_id`
- `optimization_job_id`

`web/src/workspace.real-api.smoke.test.tsx` 当前依赖这些环境变量：

- `LIVE_CREATION_SESSION_ID`
- `LIVE_STRATEGY_ID`
- `LIVE_OPTIMIZATION_STRATEGY_ID`
- `LIVE_RUN_ID`

因此，live acceptance 不是只要有脚本就能运行，必须先通过 reset staging 使用真实可用的 seed fixture 与 manifest。

### 7.3 产物收口规则

- `.tmp/`：临时运行态、临时数据库、临时日志、pytest basetemp、Python `TEMP`/`TMPDIR`
- `artifacts/`：较重的原始证据、截图、诊断输出
- `harness/reports/smoke/`：轻量 smoke 摘要与报告
- repo 根目录：不应新增临时图片、临时日志、临时数据库、pytest basetemp、`tmp_dbg_*`、`tmp-promote-*` 或 `tmp/` 目录
- 若历史根目录临时目录因 Windows ACL 只能复制、不能移动或重命名，不要用 `takeown`/`icacls` 硬改权限作为常规清理手段；先保留证据，修正产生路径，并在交付说明中列出被系统权限阻挡的空目录。

## 8. 验证规则

### 8.1 按改动类型分流

| 改动类型 | 当前应跑的最小验证路径 |
| --- | --- |
| 仅后端改动 | `scripts/codex-test-backend.ps1` |
| 仅前端改动 | `scripts/codex-test-frontend.ps1` |
| 跨栈且不依赖 fixture | backend 与 frontend 固定入口分别执行 |
| 依赖 fixture 的验收 | `scripts/codex-test-frontend.ps1 -IncludeLiveAcceptance`，会 reset fixture、启动 `8010` backend 并运行 live real-api smoke |
| 全量 Codex smoke | `scripts/codex-smoke.ps1`，作为 reset fixture + backend/frontend 固定入口的 orchestrator |

### 8.2 frontend 验证政策

- focused frontend tests 是默认阻塞门禁。
- 对已批准 HTML/SPEC 的 UI 任务，focused frontend tests 只是必要条件；最终验收还必须包含 `UI Artifact Trace Matrix`、桌面截图、DOM 文案/状态扫描和关键交互证明。
- 本次 `#/snapshots?tab=equity` 与 `#/pit-data` 联动升级的正式 Trace Matrix 位于 `output/ui-artifact-trace/snapshot-pit-layered-readiness-20260512/ui-trace-matrix.md`；其批准设计包位于 `output/ui-artifact-trace/snapshot-pit-layered-readiness-20260512/`，实现与验收都必须以该目录中的 HTML/SPEC/PNG 为基线。
- 对 `#/snapshots`、`#/pit-data` 这类 additive 治理页，一旦后端已暴露正式 read-model contract，前台必须保留批准稿的信息架构，但把卡片、矩阵、台账和行动列表切换到显式 live view-model mapper；不得继续由 `buildApproved*` 一类硬编码数组控制主舞台内容。对应测试也必须验证“批准结构 + runtime contract projection”，不能再把 synthetic row id、静态数量或 demo-only 文案当成真实交付。
- 对已批准 HTML/SPEC 的 UI 任务，worker 必须在正式 reviewer 前提交交付前自测结果；缺少自测结果时视为测试流程未完成。
- 全局 `tsc --noEmit` 必须始终跑，并始终产出报告。
- 只有显式传入 `-StrictGlobalTypes` 时，全局 TypeScript debt 才是阻塞门禁。
- live acceptance 默认不跑，只在明确需要时通过 `-IncludeLiveAcceptance` 开启。
- 若改动涉及优化结果页运行态、ETA 或轮询节流，除固定入口外，应额外手工运行 `npx vitest run src/optimization.module.test.tsx src/optimization.results-progress.test.tsx src/optimization.polling.test.tsx`。
- 若改动涉及 Compose First 一期页面或债券快照页签，固定前端入口已经覆盖 `composition.dashboard / leg.inventory / composition.workbench / composition.detail / snapshots.page / shell-frame.page-heading / App.phase3`；不需要再手工补跑这些页面级测试，除非正在做更细的 focused 调试。
- 若改动涉及 Sleeve OS v2 全局索引、持久 run/job、候选晋升或决策包，必须补充 `tests/test_composition_api.py` 的 run/job 重载、版本列表、draft promotion、decision packet immutable、scenario/evidence fields 覆盖；前端至少覆盖 `app.routes.foundation.test.tsx` 的静态路由优先级、composition 全局索引页面测试、`composition.backtest.result.test.tsx` 的场景复盘 / 订单场景过滤 / Evidence grade、`composition.allocation.test.tsx` 的晋升审查 / 门禁阻断 / 迁移成本。

### 8.3 当前文档统一口径

从现在开始，关于 Codex 验证入口统一使用以下口径：

- 固定入口以 `scripts/codex-*.ps1` 为准
- committed fixture 已落地；`codex-smoke.ps1` 若失败，应报告实际 reset/API/test 失败而不是预设 fixture 缺失
- `run-recovery-tests.ps1` 仍是手工 fallback；固定前端主路径是 `scripts/codex-test-frontend.ps1` -> `web/scripts/run-vitest-fixed.cjs`。

## 9. 完成定义

在本项目里，“代码改完”不等于“任务完成”。以下条件全部满足，任务才算真正完成：

- 改动行为已经落地，且与当前代码真相一致。
- 受影响的契约、状态词汇、页面消费面和测试已经同步。
- 跑过当前最小且正确的验证路径，或者明确说明被什么 blocker 卡住。
- 若任务属于 harness 范畴，任务书、验收说明、报告路径和回滚说明已经补齐。
- 没有把新的临时数据库、日志、截图或其他噪音直接写进 repo 根目录。
- 交付说明足够让下一个 agent 或工程师接手，而不需要重新猜测入口、范围和验收口径。

## 10. 参考文件

- `README.md`
- `ARCHITECTURE.md`
- `DESIGN.md`
- `harness/README.md`
- `harness/tasks/_template.md`
- `QuickStart-Grit.ps1`
- `scripts/codex-reset-fixture.ps1`
- `scripts/codex-test-backend.ps1`
- `scripts/codex-test-frontend.ps1`
- `scripts/codex-smoke.ps1`
- `scripts/run-recovery-tests.ps1`
- `scripts/_generate_seed_fixture.py`
- `pyproject.toml`
- `web/package.json`
- `src/grit_backtest_platform/__init__.py`
- `src/grit_backtest_platform/main.py`
- `src/grit_backtest_platform/api.py`
- `src/grit_backtest_platform/models.py`
- `web/src/lib/appRouteContext.tsx`
- `web/scripts/run-live-acceptance.cjs`
- `web/src/workspace.real-api.smoke.test.tsx`
- `docs/SLEEVE_OS_PHASED_TECHNICAL_PLAN.md`

## 11. 优化配置与约束条件事实

- `#/optimization-jobs/new/config` 当前固定为“参数范围 + 约束条件”双栏布局；顶部步骤条与主标题卡片沿用线上既有样式，不单独重设计。
- 参数范围表固定字段为 `参数 / 当前值 / 模式 / 起点 / 终点 / 步长`，不再展示角色或标签概念。
- 资产配置策略中的 `allocation_weight__*_pct` 权重参数会自动携带默认参数约束：同一组权重合计必须为 `100%`。配置页的组合数显示为过滤后的有效组合数，后端 trial 规划也必须跳过权重合计不等于 `100%` 的参数快照。
- 多因子策略的优化参数范围只能暴露因子权重、打分方法、再平衡频率和 `neutralization_method`。`neutralization.enabled` 是策略创建和回测门禁状态，不是优化搜索参数；配置页不得再展示“是否启用行业中性化”。
- `weighting_method=equal_weight` 在所有配置页、结果页和参数摘要展示层统一翻译为 `等权`，不应直接向用户暴露英文枚举值。
- 约束条件 contract 已进入 optimization job 的 request、summary、result 三层 JSON，字段固定为 `constraint_preset_key`、`constraint_label`、`constraints[]`。
- `constraint_preset_key` 当前只允许 `balanced / defensive / offensive`，前端展示文案固定映射为 `平衡型 / 稳健型 / 进攻型`。
- `constraint_label` 由前端提交前生成并持久化；若当前 5 项护栏阈值与所选预设完全一致，则显示预设名，否则显示 `预设名（自定义）`。
- 结果中心 hero 在 `约束条件：{constraint_label}` 这一标签位优先读取 `job.summary.constraint_label`，缺失时回退 `job.request.constraint_label`；旧任务若无该字段则不显示该标签。
- “继续调参 / 重跑优化”必须复用原任务的 `constraint_preset_key`、`constraint_label` 与 `constraints[]`，不能只带回 `search_space`。

## 12. GRIT 协作补充边界

### 12.1 契约与 runtime 边界补充

- backend contract truth 固定以 `src/grit_backtest_platform/models.py` 为起点；frontend contract mirror 固定为 `web/src/types.ts`。
- 动态定投策略的机器可执行字段 `dynamic_investment_proxy_key`、`dynamic_investment_metric_key` 与 `dynamic_investment_rules` 属于后端执行契约，前端详情/表单应隐藏这些字段，仅展示 `dynamic_investment_logic` 的用户口径。
- frontend runtime truth 固定在：
  - `web/src/app-runtime-cn.tsx`
  - `web/src/lib/appRouteContext.tsx`
  - `web/src/lib/demoStoreContext.tsx`
- shell truth 固定在：
  - `web/src/shell-frame-cn.tsx`
  - `web/src/shell-route-meta-cn.ts`
- 页面级工作可以扩展 view-model、page-local 组件和 route-local UI，但不得在无明确 ownership 时重定义 route parsing、shared runtime client 或 app shell。

### 12.2 结果页与 snapshot 页面补充

- optimization detail 生命周期真相必须保持三类状态分离：progress、interrupted、terminal。
- 任何结果页、轮询逻辑或 hero summary 改动都不得把这三类状态拍平成单一“完成/未完成”口径。
- snapshot pages 必须消费正式 overview contract，不得为截图展示或临时页面发明额外数据 shape 再反向要求 backend 兼容。

### 12.3 项目文档落点规则

- 本仓库的 orchestration、worker/reviewer prompt 基线、handoff 规则、UI 交付物读取顺序写在 `CLAUDE.md`。
- 本仓库的技术真相、固定测试命令、模块边界、验证路径和 acceptance facts 写在 `TECHNICAL.md`。
- 如果一次复盘发现的问题只影响本仓库，不要修改 shared skill；应把流程类改进写回 `CLAUDE.md`，把技术与验收类改进写回本文件。
## 2026-04-16 Snapshot Data Source Notes

- `Stooq` is now supported as an offline price-only cold-start source. Runtime lookup order for price repair is effectively `Yahoo -> yfinance -> Tiingo -> Longbridge -> AkShare -> Stooq -> FMP`, while `Alpha Vantage` remains outside the default price chain.
- `Stooq` reads `GRIT_STOOQ_US_DAILY_ZIP` first, then prefers the repo-local archive at `data/vendor/stooq/d_us_txt.zip`, and only falls back to `~/Downloads/d_us_txt.zip`. The provider reads the ZIP archive in place and does not require manual extraction.
- `Stooq` online CSV fallback is opt-in only. It is enabled by `GRIT_ENABLE_STOOQ_ONLINE=1` when the offline ZIP is unavailable, fetches one symbol at a time using the `.US` suffix, writes a manifest/cache under `.tmp/pit-bulk-cache/stooq` by default, and remains price-only.
- `Stooq` must not be counted as a company-action source. It emits daily price bars only, stores `adj_close` as a close proxy, and is excluded from `incremental` current-window refreshes.
- Company-action snapshot completeness is now defined by formal `dividend/split/reverse_split` probe coverage, not by “every symbol must have at least one event row”.
- When an action-capable provider successfully probes a symbol and finds no formal events, the pipeline writes a `dataset_symbol_coverage` row with `coverage_kind=corporate_probe` and `probe_status=complete_no_events`.
- `earnings_report` and `report_filed` remain stored as supplementary action rows, but they do not satisfy formal company-action completeness on their own.
- OpenBB provider 支持作为 `openbb-provider` extra 启用，价格层 provider id 为 `openbb_yfinance`、`openbb_tiingo`、`openbb_fmp` 与 targeted-only `openbb_alpha_vantage`；固定收益层通过 `openbb_federal_reserve` 与 `openbb_fred` 填补或交叉校验 UST/TIPS 曲线。若当前 OpenBB 生成路由与 provider interface 版本不匹配，固定收益 adapter 会降级到 provider fetcher 读取曲线数据，并统一把 OpenBB decimal rate 转为本项目的 `ytm_pct` 百分点口径。Universe 只允许写入 `metadata.openbb_current_constituent_check` 辅助校验，不能改变 PIT readiness。
- 数据源治理新增只读 `GET /data-snapshots/provider-registry` 与 `GET /data-snapshots/provider-attempts`。它们只归一化运行时 provider 链、快照 `metadata.provider_summary`、最近 `snapshot_refresh_jobs.summary_json.refresh_stats` 与债券 refresh stats，不新增表、不触发外部请求；`/data-snapshots/overview` 只 additive 增加 `provider_readiness_summary`。这两个治理端点必须复用 snapshot overview 的短缓存和更新时间签名，避免数据快照页或底部可信层查看 provider 状态时重复重建完整快照读模型。
- 数据可信层继续复用 provider registry、provider attempts、snapshot metadata 与 PIT overview，不新增主表。`provider-registry.items[]` additive 增加 `trust_profile`，`/data-snapshots/overview` 与 `/pit-data` additive 增加 `data_trust_summary`，前端先展示可信层摘要，再保留 raw registry，避免把 provider 表误解成“所有 key 都必须配置”。
- `provider_readiness_summary` 的收益口径必须区分 `registered_provider_count`、`enabled_provider_count`、`credential_ready_provider_count` 与 `usable_provider_count`：registered 只表示已登记或运行时可见，enabled 表示当前链路启用，credential-ready 表示所需只读环境变量齐备，usable 还要求当前没有 quota/cooldown。`openbb` 子摘要也必须暴露 credential-ready、usable 与 latest-job attempt 计数；运营复盘不能把 registered 或 enabled 直接写成“新增数据源已产生补数收益”。
- `provider-attempts` 默认 `limit=100`，最大 `500`，可按 `provider_id`、`target_type`、`status` 过滤；结果必须按最近 job / snapshot 更新时间倒序，并保留 quota/cooldown、missing credentials、错误摘要和 PIT effect。原始 `items[]` 保留事件明细，`rollup.policy=unique_provider_latest_job_priority` 作为收益口径：每个 provider 先取最新 refresh job 内的代表尝试，若最新 job 没有该 provider 才回退到快照 metadata，避免 job 与 metadata 双重投影放大尝试数。
- `GRIT_ENABLE_OPENBB_PROVIDER` 未开启时不得 import 或实例化 `openbb_provider`。Registry 可以列出 OpenBB 静态定义但必须显示 `enabled=false`；OpenBB current constituents 固定为 `universe_current_constituents_auxiliary`，只能作为 metadata/attempt 辅助记录，`can_upgrade_pit_readiness=false`。
- OpenBB 相关回归至少覆盖 `tests/test_market_data_provider_chain.py`、`tests/test_backend_api.py` 与 `web/src/snapshots.page.test.tsx`；真实 live 验收只有在安装 extra、执行 `openbb-build`、设置 key、重启 `8000/4173` 并使用 `?v=<timestamp>#/snapshots` 强制 reload 后才可声明。数据覆盖收益评估必须等待 refresh job 终态，再对比 `READY/INCOMPLETE`、`landed_row_count`、`landed_symbol_count`、symbol coverage 缺口和 `provider-attempts.rollup`，不能用 OpenBB registered/enabled 数量代替补数收益。
- Provider registry 后端切片的固定验证入口是 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1`；若只同步 `web/src/types.ts` 契约镜像而不改页面，应补跑 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes`。

## 2026-05-05 PIT External Source Repair

- `/pit-data` additive exposes `external_source_readiness` for the PIT external-source path. It summarizes Kaggle credential presence, Kaggle cache manifests, S&P 500 historical component Matrix coverage, DuckDB/Parquet catalog readiness, Polygon credential presence, source-specific blockers, and the top critical Polygon repair candidates.
- PIT 修复队列统一按 `Tiingo -> FMP -> Nasdaq WIKI/Tables EOD/Stooq/Kaggle -> Finnhub/SEC/CIK -> Polygon` 展示下一步动作。`queue_sample[]` 可选返回 `next_provider`、`provider_priority`、`required_evidence` 与 `trust_blocker`；Nasdaq WIKI/Tables EOD/Stooq/Kaggle 是 price-only，Finnhub/SEC/CIK 是 identity-only 或辅助身份源，这些来源都不能单独升级 Full Ready。
- `zero_event_certificates[]` 是真实投影而不是空数组占位：候选应包含 symbol、CIK、成员退出日期、last filing evidence、price/action negative result、结论和不可恢复原因。它只说明“可进入证书确认流程”，不能把抓取失败或 SEC 停止申报直接写成破产/无事件结论。
- Credential handling is status-only. `KAGGLE_API_TOKEN`, `KAGGLE_USERNAME`/`KAGGLE_KEY`, `~/.kaggle/access_token`, `~/.kaggle/kaggle.json`, `MASSIVE_API_KEY`, legacy `POLYGON_API_KEY`, `NASDAQ_DATA_LINK_API_KEY`, and `FINNHUB_API_KEY` may be detected as present/missing/invalid, but secret values must never be written to tracked repo files, logs, SQLite payloads, manifests, screenshots, or docs. Prefer Windows User environment variables for persistence; `QuickStart-Grit.local.ps1` is allowed only as a gitignored, operator-owned local override. Any token pasted in chat or logs must be revoked before use.
- The fixed PIT bulk cache directory is `.tmp/pit-bulk-cache` unless `GRIT_PIT_BULK_CACHE_DIR` is explicitly set. If a recovered or copied cache package sits under `.tmp/pit-bulk-cache/grit-pit-bulk-cache`, PIT readiness resolves that child as the active cache when the outer root has no direct artifacts, and the PIT overview cache signature watches the same resolved directory. Large Kaggle ZIP/CSV files, DuckDB catalogs, manifests, and partitioned Parquet output stay inside the project temp area rather than `C:\tmp`.
- Local operator entry points are `scripts/codex-pit-external-preflight.ps1`, `scripts/codex-pit-kaggle-search.ps1`, `scripts/codex-pit-kaggle-download.ps1`, `scripts/codex-pit-bulk-normalize.ps1`, and `scripts/codex-pit-diff-repair.ps1`.
- Kaggle search terms are fixed to `survivorship bias free`, `delisted`, `US stock market historical data delisted`, and `EOD historical data stocks`. The first preferred bulk source is `borismarjanovic/price-volume-data-for-all-us-stocks-etfs`; delisted archives must record license, schema, coverage years, hash, row count, and source URL before import.
- S&P 500 historical component Matrix data is normalized to `effective_date / symbol / raw_symbol / membership_status / source_revision_id`. Matrix decides historical membership only; Kaggle price data and Polygon action evidence must be attached separately.
- Bulk normalization must use DuckDB streaming over CSV/TXT files and partition output by `symbol_prefix + year`. Pandas all-file reads are not allowed for 20GB-class datasets.
- Diff repair reads the live `/pit-data.full_ready_repair_plan` price queue at execution time, falling back to `coverage_gap` price buckets when an older running API has not exposed `queue_price_symbols` yet. Do not hard-code prior observed counts. Only price-gap symbols may be imported into the main PIT price snapshot, share-class / historical ticker aliases such as hyphen, dot, underscore, and compact class suffixes must be resolved against the local catalog, and price conflicts over the configured threshold must be marked `price_conflict` instead of overwriting existing `ds-price` rows.
- When an existing `ds-price` snapshot already contains external price repair evidence such as `kaggle_huge_stock_market_dataset`, later repair runs must preserve that target universe and provider summary. Corporate-action-only or precision repair batches may add rows and remove newly covered symbols from the price missing list, but they must not widen the price denominator or erase the external-source provider record.
- Kaggle adjusted OHLCV may clear price blockers only. Without split/dividend evidence or an explicit zero-event certificate, it cannot clear corporate-action blockers. Polygon/Massive precision repair may use aggregates, inactive ticker/reference, splits, and dividends when `MASSIVE_API_KEY` or legacy `POLYGON_API_KEY` is present.
- Validation must include Matrix parser coverage, Kaggle manifest/schema/catalog behavior, diff repair queue scoping, adjusted-price conflict blocking, Polygon rate-limit/404 mocks, and live `/pit-data` evidence. Full Ready may only be declared when missing price rows are zero, corporate-action evidence is complete, and PIT cleaning rules are confirmed.

## 2026-04-17 Optimization Objective / Constraint Alignment

- Optimization job create / patch contracts accept canonical objective values:
  - `return_sharpe`
  - `annualized_return`
  - `composite_score`
- Result-page re-filter persists `objective` together with `constraints`, and a completed job must refresh:
  - `request.objective`
  - `summary.objective`
  - candidate `rank`
  - `result.best_candidate_id`
  - `result.best_candidate_label`
  - `summary.best_metrics_summary`
- Objective ranking is strict on the selected primary metric:
  - `return_sharpe`: rank by `metrics.return_sharpe`
  - `annualized_return`: rank by `metrics.annualized_return`
  - `composite_score`: rank by `score`
  - secondary tie-breakers are only allowed when the primary metric is exactly tied
- Constraint editing and preset defaults now expose 5 hard constraints only:
  - `max_drawdown_pct`
  - `out_of_sample_sharpe`
  - `annualized_return`
  - `stability`
  - `return_sharpe`
- `turnover` remains available in historical metrics storage, but it is removed from:
  - optimization config / result constraint editing
  - preset default constraints
  - composite score weighting
- Legacy optimization jobs must sanitize removed constraint keys such as `turnover` on read, patch, and result-page hydration, so old persisted payloads cannot make the UI fall back to the removed sixth constraint.
- Validation windows expose `period_label` in `YYYY-MM-DD 至 YYYY-MM-DD`, and `annualized_return` must always be populated from the window metrics instead of falling back to `-`.

## Phase 1.1 Compose First runtime baseline

Phase 1.1 的默认回归范围包含五个真实 runtime 页面：`#/compositions`、`#/legs`、`#/compositions/workbench`、`#/compositions/:id`、`#/snapshots?tab=bond`。生产路径必须通过 `ApiClientProvider` 的 HTTP client 访问 FastAPI/SQLite runtime；`demoStorePhase4` 与 `testApiMock` 只作为测试 fixture 使用。

当前真实接口入口：

- `GET /compositions`、`PATCH /compositions/{id}`：组合仪表板读取与状态切换。
- `GET /leg-inventory`、`POST /asset-legs`、`POST /cash-legs`：资产库读取与资产/现金腿创建；策略腿仍只来自策略版本 + eligible run 投影。
- `GET /leg-inventory`、`GET /compositions/{id}`、`POST /compositions/preview`、`POST /compositions`、`PATCH /compositions/{id}`：组合工作台读取、零写入预演、创建与覆盖当前 revision。
- `GET /compositions/{id}`、`PATCH /compositions/{id}`：组合详情读取冻结来源并支持状态写入；结构性修改跳转 workbench。
- `GET /data-snapshots/overview`、`POST /admin/snapshot-refresh-jobs`、`POST /asset-legs`：债券 tab 读取 `bond_fixed_income`、触发刷新、从 eligible runtime bond snapshot 创建资产腿。

Phase 1.2 的默认回归范围仍锁定这五个真实 runtime 页面，其中重点页面是 `#/compositions/workbench`、`#/compositions/:id`、`#/snapshots?tab=bond`、`#/legs`。实现必须先产出 UI Artifact Trace Matrix，再把设计稿模块映射到选择器、文案、状态与测试；当前 Phase 1.2 trace matrix 位于 `output/ui-artifact-trace/phase1-2-trust-matrix.md`，批准设计包位于 `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\phase1-2-trust-2026-04-27\`。

Sleeve OS 组合中心 v1 采用 Split-only 实施：组合详情页、组合回测配置 / 结果页、组合优化配置 / 结果页进入正式路由；Stepper 设计稿只作为历史对照，不进入运行时。当前 trace matrix 位于 `output/ui-artifact-trace/sleeve-os-v1-trace-matrix.md`，批准设计包位于 `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\sleeve-os-v1-2026-04-28\`。

Sleeve OS 组合中心 v2 已新增全局组合列表、组合回测列表、组合实验室三个页面入口，用于跨组合查看版本、证据质量、回测运行、allocation 作业、候选晋升和待决策事项。当前 trace matrix 位于 `output/ui-artifact-trace/sleeve-os-v2-trace-matrix.md`；批准 UI artifact 位于 `output/ui-artifact-trace/sleeve-os-v2-global-pages/`，核心基线包括 `sleeve-os-v2-global-pages-design-spec.md`、`composition-list-desktop.png`、`composition-backtests-desktop.png`、`composition-lab-desktop.png` 以及对应 mobile 截图。三页必须保持 1920 桌面下相同的 hero / metric / list 模块节奏，且不得恢复 topbar 状态条或 Stepper。

Sleeve OS v2 的存储和契约真相：

- `composition_backtest_runs` 与 `composition_allocation_jobs` 从 v1 预留 / artifact mirror 升级为可重载持久记录，保存请求配置、组合版本、结果摘要、证据快照、运行状态和审计指纹；legacy artifact state 只允许作为旧数据 fallback。
- 新增 `composition_versions`，保存 `DRAFT / ACTIVE / ARCHIVED` 组合版本快照、来源 job/candidate、版本 diff 和 evidence snapshot；allocation 候选只能通过晋升审查生成 draft version，不直接改写 active version。
- 新增 `composition_decision_packets`，保存 readonly packet 快照与 Markdown / HTML 导出内容；packet 创建后不能随当前组合、run 或 job 改动漂移。
- backtest/allocation 结果对象需要 additive 增加 `evidence_grade`、`scenario_anchors`、`risk_budget_timeline`、`promotion_readiness`；orders 查询在保留 `source_leg`、`symbol`、export、netting v1 行为的同时增加 `scenario` 过滤。
- allocation candidate 的 `allowed_actions` 必须由 `promotion_readiness` 决定；`evidence_grade_c`、约束违反或其它 blocked readiness 不能继续暴露 `promote_candidate`，结果页必须提前禁用“生成草稿版本”并展示中文门禁原因。

Phase 1.2 验证时至少覆盖：

- Backend: `tests/test_composition_api.py` 中的 aligned returns、rebalance events、cost drag、source drift、audit trail、bond quality/repair/risk-budget cases。
- Backend-only 实施不得改 React 页面、CSS、路由或设计 HTML；验收以后端固定切片、focused API tests 与文档/CHANGELOG 同步为准。
- Frontend: `composition.workbench.test.tsx`、`composition.detail.test.tsx`、`leg.inventory.test.tsx`、`snapshots.page.test.tsx`，并在合同变更后执行 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes` 或等价 `tsc --noEmit`。
- Live acceptance 已不受 `harness/fixtures/seed_workspace/` 缺失限制；仍必须以 `codex-reset-fixture.ps1` 和 `-IncludeLiveAcceptance` 的实际结果为准。

债券快照专项回归必须覆盖七条运行时行：UST 2Y、UST 10Y、UST 30Y、13W T-Bill、TIPS 5Y、TIPS 10Y、LQD。债券页发布当前最新七行契约，历史旧行和手工 smoke 行可以保留在库里，但不能拉低当前覆盖率；债券页顶部就绪度和资产腿入库门禁以这七行契约为准，已就绪时共享快照阻塞仅保留为诊断提醒。健康仪表盘状态条、关键字段可用率和审计矩阵必须都从同一批 `eligible_instruments` 推导；有数值或被正式 `WAIVED` 的 `INFERRED` 字段计入“可用”，只有 `MISSING`、无值的推算待写入、`WATCH` 或阻塞状态才影响资产腿和后续组合可用性。测试和 fixture 字段统一使用 `asset_type`、`tenor_label`、`audit_profile`、`discount_rate_pct`、`real_yield_pct`、`inflation_factor`、`breakeven_inflation_bps`、`effective_duration`、`sec_yield_30d_pct`、`credit_quality`、`tracking_error_bps`、`tracking_error_source`、`audit_alerts`、`audit_notes`、`tracking_status`。LQD `WATCH` 行不得创建资产腿；当 LQD 有已发布且可审计的 tracking error 来源时可进入 `READY`；T-Bill 在 `discount_rate_pct` 存在时可豁免 `accrued_interest`；TIPS 需要 breakeven 证据；UST 利差异常应保留 `audit_alerts`。

验证入口：

- 后端固定切片：`powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1`
- 前端固定切片：`powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1`
- 契约/类型变更后：`powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes`

当前 `harness/fixtures/seed_workspace/` 已恢复；声明 fixture-backed live smoke 通过前，仍必须重新跑过对应 live acceptance 并记录结果。

## 2026-05-13 Snapshot / PIT phase2 baseline

- `POST /admin/snapshot-refresh-jobs` 继续是唯一的快照刷新入口，并新增 `fundamentals`、`sentiment`、`macro_derivatives` 三个公开 target。`fundamentals` 负责 FMP 基础面回补与重刷，`sentiment` 负责 earnings expectations / short-volume 证据流，`macro_derivatives` 负责宏观利率与 IV 证据流。
- `dataset_fundamental_points` 的 phase2 最小 superset 现在包含 `publish_date`、`statement_date`、`fiscal_year`、`fiscal_period`、`time_provenance`、`revenue`、`gross_profit`、`net_income`、`total_assets`、`current_assets`、`current_liabilities`、`long_term_debt`。L2 的正式 PIT 门槛从“有 `available_at`”升级为“同时有 `publish_date` 与 `available_at`”；不得再用 `period_end_date` 冒充 `publish_date`。
- 缺少 `publish_date` 或 `available_at` 的 symbol 级基础面记录只能进入 readiness、coverage、provider-attempt 与质量告警，不能进入正式 PIT 点位读取，也不能把相关 gate 提升为 `READY`。本地 legacy seed 迁移只允许给 `source=local_seed_fundamentals` 的历史行打 `legacy_local_seed_available_at` provenance，其它历史缺口必须保留 `legacy_publish_date_missing`。
- companion market-data 新增 `dataset_signal_points` / `dataset_signal_coverage`，承载 `ds-analyst-consensus`、`ds-short-volume`、`ds-macro-rates`、`ds-option-skew` 四组 phase2 持久化数据面。首屏 API 只消费 bounded coverage、snapshot metadata 与 provider attempts；完整 raw evidence 保留在 `metadata_json` / `raw_json`，不得把整条 ledger 直接塞进 `GET /data-snapshots/overview` 或 `GET /pit-data` 首屏 payload。
- `GET /data-snapshots/overview` 顶层 shape 保持 additive 不变，但 `dataset_snapshots[]` 只在真实 snapshot row 已持久化且存在 coverage / landed-row evidence 时才纳入 `ds-fundamentals`、`ds-analyst-consensus`、`ds-short-volume`、`ds-macro-rates`、`ds-option-skew`。`data_layer_readiness[]`、`factor_dimension_readiness[]` 与 snapshot/PIT linkage 中引用的 `dataset_id` 必须指向真实 dataset row，或明确标记为 readiness-only provider evidence。
- `GET /pit-data` 顶层 shape 也保持不变，但 phase2 允许快照状态与 PIT 状态不同步：快照页表示源侧刷新健康，PIT 表示 replayable / diagnosable readiness。因此允许 L3 在快照为 `WARNING`、在 PIT 为 `DISABLED/OBSERVATION`，允许 L4 在快照为 `BLOCKED`、在 PIT 为 `CALIBRATING`；这些差异必须由 read-model 明确给出原因，不能留给前端 page-local 文案解释。
- L4 phase2 默认 provider 基线是 Massive / legacy Polygon 兼容链路，而不是 ThetaData。`MASSIVE_API_KEY` 与旧 `POLYGON_API_KEY` 都可以作为 option-skew / precision evidence 的凭据来源；ThetaData 后续如接入，只能作为可选第二适配器，不得反向改写本次 phase2 的主链路。
- 因子准入仍保留“最近 10 年 `factor_admission_coverage` 可推进、30 年 Full Ready 继续补证”的分层政策。phase2 不得因为新增 L3/L4 数据面而把 `Factor Factory -> D2 Quarantine -> Publish` 旁路成直接写正式因子库。
- phase2 最小回归应覆盖：`tests/test_backend_api.py` 的 snapshot overview/additional dataset evidence、`tests/test_factor_research_api.py` 的 fundamental publish gate 与 persisted consensus observation、`web/src/snapshots.page.test.tsx` 的刷新 target / live mapper，以及 `web/src/app.routes.foundation.test.tsx` 的 `#/snapshots` / `#/pit-data` 路由加载。固定验证仍使用 `scripts/codex-test-backend.ps1`、`scripts/codex-test-frontend.ps1` 与 `scripts/codex-test-frontend.ps1 -StrictGlobalTypes`。

## 2026-04-23 QuickStart preview listener note

- QuickStart 清理 `4173` 旧监听时，绝对 `web/preview-server.mjs` 命令和 `node ./preview-server.mjs --watch --rebuild-on-start` 相对命令都属于 repo-local preview，可作为 stale listener 重启目标，不应被判为 `non-repo frontend process`。
- `web/src/quickstart.preview.test.ts` 已纳入 `scripts/codex-test-frontend.ps1` 固定前端切片，用来守住 preview listener 识别、QuickStart 显式 build 后不重复 startup rebuild、backend readiness 复核、以及 preview watch 切换必须保留 active bundle 且缺失 asset 必须返回 404 的首载安全逻辑。

### Localhost delivery gate

当用户给出 `http://127.0.0.1:4173/...` 或其它本地 live URL 作为验收入口时，交付前必须验证当前正在监听的本地进程，而不能只引用 mocked tests 或 fixed slice。最低要求：

- 确认 `8000` 的 `uvicorn` 和 `4173` 的 preview 进程是在最终代码之后启动的；如果不是，先停止 repo-local 旧监听并重启。
- 重新执行 `npm run build`，避免 `preview-server.mjs` 因 dist promotion 失败继续服务旧 bundle。
- 若前端构建或预览曾临时指定 `VITE_API_BASE_URL`，最终交付前必须恢复并验证 `http://127.0.0.1:8000`。`#/factors` 等页面出现 `Failed to fetch`、列表计数归零或空表时，先检查 `8000` 后端监听和构建包 API 指向，再判断页面代码问题。
- 核对 `GRIT_BACKTEST_DB` 指向的主库以及同名 `_market_data.sqlite3` companion 不是新建空库；`/workspace/overview` 应先用 API 证明策略/回测历史仍在，再打开页面。
- 重新验证 hash SPA 页面时必须强制 document reload，例如 `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`；只从 `#/workspace` 跳到 `#/snapshots` 可能继续运行旧 bundle。
- 对用户提到的页面跑一次真实浏览器或等价 live check，并记录 `GET /compositions`、`GET /leg-inventory`、`GET /data-snapshots/overview` 的 HTTP 结果。
- 如果验收包含债券 eligible source，确认 `bond_fixed_income_snapshots` 至少有一条 `READY` runtime row；fallback/proxy curve 只能作为只读展示，不能算作真实入库来源。
