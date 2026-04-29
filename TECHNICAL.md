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

当任务存在已批准的 HTML 与代码级设计规格 Markdown 时，不能只把它们当作参考图。它们是 UI 实施硬基线。

实施前必须先形成 `UI Artifact Trace Matrix`，记录：

- 批准 HTML/SPEC 的页面 key、URL/query、模块区块与最终截图基准。
- 每个模块对应的 React 文件、组件、CSS 或 view-model/formatter。
- 必须还原的中文前台文案、状态标签、数值格式、颜色语义和允许的 live-data 替代。
- 必须验证的交互状态，包括 tab、filter、drawer、sticky、disabled/joined、save/refresh、loading、empty、error 与 responsive。
- 验收证据路径，包括 focused test 命令、桌面截图、DOM 文案/状态扫描和交互证明。
- 与批准稿不同的剩余偏离项；没有明确批准的偏离视为设计漂移。

交付验收规则：

- focused frontend tests 是必要门禁，但不足以证明 UI 还原。
- 已批准 UI 交付物实施必须同时提供截图、DOM 文案/状态扫描与关键交互证明。
- 像素对齐不能只看外框坐标和高度；还必须检查模块内部的视觉密度、内容到容器边界的空白、强制 `min-height` / `height` 是否造成空洞。若用户反馈“空白多、模块太高、密度松”，优先移除非必要强制高度并用内容自适应、padding/gap/line-height 精调，而不是继续追求静态稿外框高度。
- CSS 契约测试不能把过大的固定高度当作 UI 一致性本身；除非批准稿明确要求固定高度，否则应断言大 `min-height` / `height` 不存在，并用截图或 DOM geometry 证明模块间距和卡片内边距已经收敛。
- 对有指定上下顺序的 grid / flex 复合模块，不能只断言 DOM heading 顺序；必须同时用 CSS 契约中的 `grid-template-areas`、`grid-area` / `order` 或真实浏览器 geometry 证明视觉顺序，避免源码顺序正确但页面视觉顺序漂移。
- 表格单元格需要保持浏览器原生 `table-cell` 布局，不要把 `td` / `th` 本身改成 `display: grid`、`display: flex` 等。若单元格内部需要栅格或弹性排版，必须新增内部 wrapper；多行内容验收要比较该单元格高度与整行高度，确认分隔线不会提前断开。
- live API 或 demo data 与静态设计稿不一致时，页面必须通过 view-model / formatter 统一前台展示，不能直接暴露 raw backend label、未翻译英文、乱码、占位符或实现说明语气。
- 用户报告已批准 UI 在某个具体 live route 或对象 ID 上漂移时，验收必须抓取用户给出的精确 URL/ID；只抽样列表第一条、默认 demo 对象或旧截图不能作为该问题的完成证据。
- worker 交付给 reviewer 前必须先跑交付前自测门，按 reviewer 拒收清单自查测试、Trace Matrix、截图、DOM 文案、交互证明、文档 delta 和剩余偏离，并明确回答 `Would reviewer refuse this?`；答案不是确定的 `No` 时不得交付。
- 交付前自测不能替代正式 reviewer，它只是阻止明显不合格切片进入评审。
- 临时截图、DOM dump、trace matrix 草稿和浏览器记录应放在 `.tmp/`、`artifacts/`、`tmp/grit-coder/` 或 `output/logs/grit-coder/`，不要散落在 repo 根目录。

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
| 已提交种子 fixture | `harness/fixtures/seed_workspace/` 当前尚未提交到仓库 | 因此 fixture reset 与 live acceptance 相关能力还未完全可用 |
| `codex-reset-fixture.ps1` | 代码已按 committed fixture 模式实现 | 但由于 source fixture 缺失，当前运行会失败 |
| `codex-test-frontend.ps1 -IncludeLiveAcceptance` | 代码已支持 `LIVE_FIXTURE_MANIFEST` 与 `LIVE_API_BASE` | 但仍依赖缺失的 fixture 资产 |
| `codex-smoke.ps1` | 当前会先执行 fixture reset，再跑 backend/frontend 固定入口 | 因 fixture 缺失，当前不能把它当作默认可用的全量门禁 |
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
- 原始日志、截图、临时输出进入 `.tmp/` 或 `artifacts/`，摘要与 smoke 结果进入 `harness/reports/smoke/`。

## 3. 固定 Codex 入口与当前可用性

### 3.1 固定入口脚本

| 脚本 | 责任 | 当前状态 |
| --- | --- | --- |
| `scripts/codex-reset-fixture.ps1` | 把 committed fixture 复制到 `.tmp/codex-fixture/`，并生成 reset 报告 | 代码已就位，但当前缺少 source fixture 资产 |
| `scripts/codex-test-backend.ps1` | 跑固定 backend pytest 切片，并写入 `latest-backend.txt` | 当前可直接使用 |
| `scripts/codex-test-frontend.ps1` | 跑固定 frontend focused tests，始终输出全局 TypeScript 报告，可选 strict/live acceptance | 当前 focused 与 global types 可用，live acceptance 依赖缺失 fixture |
| `scripts/codex-smoke.ps1` | 纯 orchestrator，先 reset fixture，再跑 backend/frontend 固定入口 | 当前受 fixture 缺失阻塞 |

### 3.2 backend 固定验证切片

`scripts/codex-test-backend.ps1` 当前固定跑以下测试：

- `tests/test_backend_api.py`
- `tests/test_composition_api.py`
- `tests/test_creation_session_refresh.py`
- `tests/test_real_backtest_api.py`
- `tests/test_optimization_execution_resume.py`
- `tests/test_optimization_resume_api.py`
- `tests/test_strategies_smoke.py`

### 3.3 frontend 固定验证切片

`scripts/codex-test-frontend.ps1` 当前固定跑以下 focused Vitest 切片：

- `app.routes.foundation.test.tsx`
- `composition.dashboard.test.tsx`
- `leg.inventory.test.tsx`
- `composition.workbench.test.tsx`
- `composition.detail.test.tsx`
- `composition.backtest.result.test.tsx`
- `composition.allocation.test.tsx`
- `creation.flow.test.tsx`
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

在已提交种子 fixture 资产缺失前，当前建议如下：

- backend 改动：直接运行 `scripts/codex-test-backend.ps1`
- frontend 改动：直接运行 `scripts/codex-test-frontend.ps1`
- 不要把 `scripts/codex-smoke.ps1` 当成当前默认可用的全量门禁
- 若前端在 Windows 环境下触发 `esbuild spawn EPERM`，可手工回退到 `scripts/run-recovery-tests.ps1 -Target frontend`，但这不是当前 fixed entry 脚本内建的自动 fallback

## 4. 系统与运行时总览

### 4.1 技术栈真相

- backend：Python + FastAPI + Pydantic + SQLite
- frontend：React 19 + TypeScript + Vite + Vitest
- Python packaging 约束来自 `pyproject.toml`，当前真实要求是 `>=3.12`
- frontend 依赖版本真相来自 `web/package.json`

### 4.2 QuickStart 真相

`QuickStart-Grit.ps1` 是人工启动主入口，当前职责包括：

- 启动 backend 到 `http://127.0.0.1:8000`
- 启动 frontend 到 `http://127.0.0.1:4173/#/workspace`
- frontend 预览通过 `web/preview-server.mjs --watch --rebuild-on-start` 启动，默认 `4173` 入口需要在启动时自触发一次静态构建，避免冷启动只返回 `Frontend build not ready yet.`
- 优先使用 repo 内 `.python-runtime/`
- 优先 Python 3.14，回退到 3.13
- 维护 `.venv/` 为派生环境
- 在需要时修复 `web/node_modules`

### 4.3 关键环境变量

| 环境变量 | 作用 |
| --- | --- |
| `GRIT_BACKTEST_DB` | 覆盖默认 SQLite 主库路径 |
| `GRIT_ENABLE_OPENBB_PROVIDER` | 设为 `1` / `true` / `yes` / `on` 时启用可选 OpenBB 快照增强层；默认关闭，缺 OpenBB 或缺 key 不应影响启动 |
| `TIINGO_API_TOKEN` | OpenBB Tiingo 行情凭证，运行时映射到 `obb.user.credentials.tiingo_token`，不写入本地 OpenBB 设置文件 |
| `ALPHAVANTAGE_API_KEY` | OpenBB Alpha Vantage targeted repair 凭证，运行时映射到 `alpha_vantage_api_key`，不写入本地 OpenBB 设置文件 |
| `FMP_API_KEY` | OpenBB FMP 行情与当前成分辅助校验凭证，运行时映射到 `fmp_api_key`，不替代既有 FMP historical universe lane |
| `FRED_API_KEY` | OpenBB FRED 固定收益曲线凭证，运行时映射到 `fred_api_key`，不写入本地 OpenBB 设置文件 |
| `GRIT_PYTHON_RUNTIME_SOURCE` | 为 QuickStart 指定可复制的 Python runtime 来源 |
| `GRIT_OPTIMIZATION_STEP_DELAY_SECONDS` | 覆盖优化 trial 之间的人工延迟；默认运行态为 `0`，测试态保持极小延迟以稳定观察进度刷新 |
| `GRIT_SNAPSHOT_MEMORY_LIMIT_RATIO` | 控制 Windows 下 snapshot refresh 的内存护栏比例 |
| `VITE_API_BASE_URL` | 覆盖前端请求 API base |
| `LIVE_API_BASE` | live acceptance 时覆盖测试 API base |
| `LIVE_FIXTURE_MANIFEST` | live acceptance 时显式指定 fixture manifest |

OpenBB 是可选 extra，不属于默认安装面。需要真实 OpenBB 验收时，先安装并构建扩展：

- `.\.venv\Scripts\python.exe -m pip install -e ".[openbb-provider]"`
- `.\.venv\Scripts\openbb-build.exe`（若命令未在当前 shell 可见，重新打开 shell 或直接调用 venv Scripts 下的可执行文件）

启用后再设置 `GRIT_ENABLE_OPENBB_PROVIDER=1` 与所需 key。凭证只从环境变量读入并在 lazy 初始化时写到内存中的 `obb.user.credentials.*`，不得写入或依赖 `~/.openbb_platform/user_settings.json`。

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
- `refresh-snapshots` 支持 `incremental`、`repair`、`full`
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
- `GET /compositions/{composition_id}`
- `POST /compositions/preview`
- `POST /compositions`
- `PATCH /compositions/{composition_id}`
- `POST /compositions/{composition_id}/backtest-runs`
- `GET /compositions/{composition_id}/backtest-runs/{run_id}`
- `GET /compositions/{composition_id}/backtest-runs/{run_id}/orders`
- `GET /compositions/{composition_id}/backtest-runs/{run_id}/orders/{order_id}/netting`
- `GET /compositions/{composition_id}/backtest-runs/{run_id}/orders/export`
- `POST /compositions/{composition_id}/allocation-jobs`
- `GET /compositions/{composition_id}/allocation-jobs/{job_id}`
- `GET /optimization-jobs`
- `GET /optimization-jobs/{job_id}/detail`
- `POST /strategies/{strategy_id}/optimization-jobs`
- `POST /optimization-jobs/{job_id}/resume`
- `POST /optimization-jobs/{job_id}/candidates`
- `POST /optimization-jobs/{job_id}/candidates/{trial_id}/promote`
- `DELETE /optimization-jobs/{job_id}/candidates/{trial_id}`
- `GET /data-snapshots/overview`
- `POST /admin/snapshot-refresh-jobs`
- `GET /data-snapshots/overview` 的 `dataset_snapshots[]` 现在包含 `ds-index-valuations`；其 metadata 暴露 `proxy_keys`、`observation_frequency`、`latest_pe_ttm`、`latest_percentile_10y`

当前一期 Compose First 的补充真相：

- `GET /leg-inventory` 是统一读模型入口：策略腿来自 `strategy + parameter version + latest eligible run` 的投影，不落独立真相表；资产腿与现金腿来自最小持久化定义表。
- `POST /asset-legs` 与 `POST /cash-legs` 只负责最小定义落库，不建立版本树，也不改写策略主链路。
- `GET /compositions`、`GET /compositions/{id}`、`POST /compositions/preview`、`POST /compositions`、`PATCH /compositions/{id}` 共同组成一期组合工作台与详情页的正式契约面。
- `POST /compositions/preview` 返回权重摘要、收益流预演、相关性矩阵、风险贡献预览、维护成本与再平衡摘要，供工作台边调边判断；Phase 1.2 同时返回 `return_quality_summary`、`rebalance_events`、`source_integrity`，并在风险贡献里补充边际贡献、预算占用、债券久期/凸性占用。
- `GET /compositions/{id}` 继续读取冻结来源；Phase 1.2 详情额外返回 `audit_trail`，并扩展 `source_evidence` 的 `signature_status`、`drift_status`、`current_ref_id`、`alerts`。来源漂移只提示，不自动改写已保存组合。
- Sleeve OS v1 新增组合层回测与资产配置契约。组合回测运行用于稳定性复核、订单穿透和证据留痕，订单导出支持 CSV 与最小 XLSX 工作簿；组合资产配置任务用于意图导航、约束预检、有效前沿候选和迁移成本评估。若真实长周期、真实成交或底层持仓数据不足，接口与页面必须显式展示代理、质量或不可用状态。
- `composition_audit_events` 是 Phase 1.2 后端 append-only 审计表；创建、结构 PATCH、状态切换、来源冻结、再平衡检查和债券快照刷新影响检查都应写入该表，详情 `audit_trail` 从持久化事件流读取，旧数据才允许回退到临时投影。
- `GET /data-snapshots/overview` 继续作为唯一快照总览入口；债券/固定收益治理页通过新增 `bond_fixed_income` 分段扩展现有契约，不另开第二套快照 API。Phase 1.2 的债券质量字段包括 `quality_audit`、`repair_rules`、`daily_accrual_status`、`risk_budget_inputs`，修复/补齐仍走 `POST /admin/snapshot-refresh-jobs` 的 `bond` target。

当前优化任务 detail 的补充真相：

- `GET /optimization-jobs/{job_id}/detail` 在 `QUEUED`、`RUNNING`、`INTERRUPTED` 三种运行态必须保持零扫描优先：先直接信任 `optimization_jobs.summary_json/result_json` 里的 progress、ETA、heartbeat、resume 元数据，不在热路径扫描 `optimization_job_trials`；只有旧记录缺字段时才回退读取 trial checkpoint。
- 运行态 ETA 依赖 persisted trial 的 `started_at/completed_at` 时间戳推导，不能假设秒级精度足够。
- 终态结果中心同样优先走零 trial 快路径：当 `optimization_jobs.candidates_json/result_json` 已经持久化完成候选区时，detail 不再重新扫描 `optimization_job_trials`；只有旧记录缺失候选投影时才回退读取 trial checkpoint。
- `optimization_job_trials.chart_series_json` 仍维持分层存储：大多数 trial 只持久化轻量 `[]`，仅终态 top-K 候选回补完整曲线。
- 优化执行期默认只持久化 trial 级 `parameter_snapshot`、`metrics`、`score` 与时间戳；完整曲线只在终态 top-K 回补并持久化。
- `optimization_job_trials` 额外下沉了热路径排序列：`return_sharpe`、`oos_sharpe`、`total_return_pct`、`stability`，用于运行态和终态减少 `metrics_json` 解码。
- 优化运行时仍然保留一套 Windows 安全的父线程加 `multiprocessing.get_context("spawn")` worker 控制器，但当前 synthetic `_service_rebuilt.py` evaluator 默认关闭这条路径，因为本地基准显示顺序执行更快。未来如果为了更重的 evaluator 显式重新启用子 worker，子 worker 也绝不能直接写 SQLite；父线程仍然必须是唯一写入者。
- 优化 worker 并发度由系统内部自动管理。当系统内存已经偏高时，启动阶段会先从 CPU 上限下调 worker 数；运行期间在系统内存到达 `80%` 时自动减掉一个 worker，到达 `90%` 时强制退回单 worker，只有连续三次采样恢复安全后才允许再次扩容。
- 当前激活的优化 evaluator 路径不再预加载 `_prepare_backtest_run_context()`。对于现行 `_service_rebuilt.py` evaluator 而言，这个预加载只是无效开销，因此任务运行器现在会完全跳过它。
- 运行中优化任务的摘要写入由唯一写入者节流：最多每秒一次，或者每完成五个 trial 写一次；每次心跳都会持久化 `completed_combinations`、`next_trial_index`、`best_metrics_summary`、`estimated_remaining_minutes`、`estimated_completed_at` 与 `heartbeat_at`，而终态状态切换仍然立即持久化。
- 执行期会增量维护 top-K 与 heatmap winner cells；终态优先复用增量摘要并只为终态 top-K 回补完整 metrics，避免全量 successful trials 再次排序和候选分析重算。
- 优化任务首组启动现在必须遵守两个热路径约束：`_ensure_optimization_snapshots_ready()` 在无 `start_date/end_date` 的优化预检里只允许读取 `dataset_symbol_coverage` 来判断 snapshot readiness，不能再次全量扫描 `dataset_price_bars`；`python -m grit_backtest_platform.main run-optimization` 也必须保持 lazy bootstrap，禁止在 worker 冷启动阶段无条件创建 FastAPI app 或 runtime market-data provider。

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
- `#/compositions/:id`
- `#/compositions/:compositionId/backtest-runs/new`
- `#/compositions/:compositionId/backtest-runs/:runId`
- `#/compositions/:compositionId/allocation-lab`
- `#/compositions/:compositionId/allocation-jobs/:jobId`
- `#/strategies`
- `#/creation/sessions/:id`
- `#/strategies/:id`
- `#/strategies/:id/backtest-runs/new`
- `#/runs`
- `#/runs/:id`
- `#/snapshots`
- `#/optimization-jobs`
- `#/optimization-jobs/new`
- `#/optimization-jobs/new/config?strategy_id=...`
- `#/optimization-jobs/:id`

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
- 在 committed seed fixture 真正落库前，不要伪装存在一个“默认可用”的 fixture 链路。

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

因此，live acceptance 不是只要有脚本就能运行，必须先有真实可用的 seed fixture 与 manifest。

### 7.3 产物收口规则

- `.tmp/`：临时运行态、临时数据库、临时日志
- `artifacts/`：较重的原始证据、截图、诊断输出
- `harness/reports/smoke/`：轻量 smoke 摘要与报告
- repo 根目录：不应新增临时图片、临时日志、临时数据库

## 8. 验证规则

### 8.1 按改动类型分流

| 改动类型 | 当前应跑的最小验证路径 |
| --- | --- |
| 仅后端改动 | `scripts/codex-test-backend.ps1` |
| 仅前端改动 | `scripts/codex-test-frontend.ps1` |
| 跨栈且不依赖 fixture | backend 与 frontend 固定入口分别执行 |
| 依赖 fixture 的验收 | `scripts/codex-test-frontend.ps1 -IncludeLiveAcceptance`，但仅在 fixture 资产真实存在后执行 |
| 全量 Codex smoke | `scripts/codex-smoke.ps1`，但当前仅在 fixture 资产补齐后才应恢复为默认门禁 |

### 8.2 frontend 验证政策

- focused frontend tests 是默认阻塞门禁。
- 对已批准 HTML/SPEC 的 UI 任务，focused frontend tests 只是必要条件；最终验收还必须包含 `UI Artifact Trace Matrix`、桌面截图、DOM 文案/状态扫描和关键交互证明。
- 对已批准 HTML/SPEC 的 UI 任务，worker 必须在正式 reviewer 前提交交付前自测结果；缺少自测结果时视为测试流程未完成。
- 全局 `tsc --noEmit` 必须始终跑，并始终产出报告。
- 只有显式传入 `-StrictGlobalTypes` 时，全局 TypeScript debt 才是阻塞门禁。
- live acceptance 默认不跑，只在明确需要时通过 `-IncludeLiveAcceptance` 开启。
- 若改动涉及优化结果页运行态、ETA 或轮询节流，除固定入口外，应额外手工运行 `npx vitest run src/optimization.module.test.tsx src/optimization.results-progress.test.tsx src/optimization.polling.test.tsx`。
- 若改动涉及 Compose First 一期页面或债券快照页签，固定前端入口已经覆盖 `composition.dashboard / leg.inventory / composition.workbench / composition.detail / snapshots.page / shell-frame.page-heading / App.phase3`；不需要再手工补跑这些页面级测试，除非正在做更细的 focused 调试。

### 8.3 当前文档统一口径

从现在开始，关于 Codex 验证入口统一使用以下口径：

- 固定入口以 `scripts/codex-*.ps1` 为准
- committed fixture 未落地前，不把 `codex-smoke.ps1` 描述为默认可用
- `run-recovery-tests.ps1` 是手工 fallback，不是当前 fixed entry 的内建主路径

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
- `Stooq` must not be counted as a company-action source. It emits daily price bars only, stores `adj_close` as a close proxy, and is excluded from `incremental` current-window refreshes.
- Company-action snapshot completeness is now defined by formal `dividend/split/reverse_split` probe coverage, not by “every symbol must have at least one event row”.
- When an action-capable provider successfully probes a symbol and finds no formal events, the pipeline writes a `dataset_symbol_coverage` row with `coverage_kind=corporate_probe` and `probe_status=complete_no_events`.
- `earnings_report` and `report_filed` remain stored as supplementary action rows, but they do not satisfy formal company-action completeness on their own.
- OpenBB provider 支持作为 `openbb-provider` extra 启用，价格层 provider id 为 `openbb_yfinance`、`openbb_tiingo`、`openbb_fmp` 与 targeted-only `openbb_alpha_vantage`；固定收益层通过 `openbb_federal_reserve` 与 `openbb_fred` 填补或交叉校验 UST/TIPS 曲线。Universe 只允许写入 `metadata.openbb_current_constituent_check` 辅助校验，不能改变 PIT readiness。
- OpenBB 相关回归至少覆盖 `tests/test_market_data_provider_chain.py`、`tests/test_backend_api.py` 与 `web/src/snapshots.page.test.tsx`；真实 live 验收只有在安装 extra、执行 `openbb-build`、设置 key、重启 `8000/4173` 并使用 `?v=<timestamp>#/snapshots` 强制 reload 后才可声明。

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

Phase 1.2 验证时至少覆盖：

- Backend: `tests/test_composition_api.py` 中的 aligned returns、rebalance events、cost drag、source drift、audit trail、bond quality/repair/risk-budget cases。
- Backend-only 实施不得改 React 页面、CSS、路由或设计 HTML；验收以后端固定切片、focused API tests 与文档/CHANGELOG 同步为准。
- Frontend: `composition.workbench.test.tsx`、`composition.detail.test.tsx`、`leg.inventory.test.tsx`、`snapshots.page.test.tsx`，并在合同变更后执行 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes` 或等价 `tsc --noEmit`。
- Live acceptance 仍受 `harness/fixtures/seed_workspace/` 缺失限制；不能把 fixture-backed reset 路径声称为通过。

债券快照专项回归必须覆盖七条运行时行：UST 2Y、UST 10Y、UST 30Y、13W T-Bill、TIPS 5Y、TIPS 10Y、LQD。测试和 fixture 字段统一使用 `asset_type`、`tenor_label`、`audit_profile`、`discount_rate_pct`、`real_yield_pct`、`inflation_factor`、`breakeven_inflation_bps`、`effective_duration`、`sec_yield_30d_pct`、`credit_quality`、`tracking_error_bps`、`audit_alerts`、`audit_notes`、`tracking_status`。LQD `WATCH` 行不得创建资产腿；T-Bill 在 `discount_rate_pct` 存在时可豁免 `accrued_interest`；TIPS 需要 breakeven 证据；UST 利差异常应保留 `audit_alerts`。

验证入口：

- 后端固定切片：`powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1`
- 前端固定切片：`powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1`
- 契约/类型变更后：`powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes`

当前 `harness/fixtures/seed_workspace/` 缺失；不要声明 fixture-backed live smoke 通过，除非该目录被恢复并重新跑过对应 live acceptance。

## 2026-04-23 QuickStart preview listener note

- QuickStart 清理 `4173` 旧监听时，绝对 `web/preview-server.mjs` 命令和 `node ./preview-server.mjs --watch --rebuild-on-start` 相对命令都属于 repo-local preview，可作为 stale listener 重启目标，不应被判为 `non-repo frontend process`。
- `web/src/quickstart.preview.test.ts` 已纳入 `scripts/codex-test-frontend.ps1` 固定前端切片，用来守住 preview listener 识别和 `--rebuild-on-start` 启动参数。

### Localhost delivery gate

当用户给出 `http://127.0.0.1:4173/...` 或其它本地 live URL 作为验收入口时，交付前必须验证当前正在监听的本地进程，而不能只引用 mocked tests 或 fixed slice。最低要求：

- 确认 `8000` 的 `uvicorn` 和 `4173` 的 preview 进程是在最终代码之后启动的；如果不是，先停止 repo-local 旧监听并重启。
- 重新执行 `npm run build`，避免 `preview-server.mjs` 因 dist promotion 失败继续服务旧 bundle。
- 核对 `GRIT_BACKTEST_DB` 指向的主库以及同名 `_market_data.sqlite3` companion 不是新建空库；`/workspace/overview` 应先用 API 证明策略/回测历史仍在，再打开页面。
- 重新验证 hash SPA 页面时必须强制 document reload，例如 `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`；只从 `#/workspace` 跳到 `#/snapshots` 可能继续运行旧 bundle。
- 对用户提到的页面跑一次真实浏览器或等价 live check，并记录 `GET /compositions`、`GET /leg-inventory`、`GET /data-snapshots/overview` 的 HTTP 结果。
- 如果验收包含债券 eligible source，确认 `bond_fixed_income_snapshots` 至少有一条 `READY` runtime row；fallback/proxy curve 只能作为只读展示，不能算作真实入库来源。
