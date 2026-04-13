# TECHNICAL

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

- product task：直接进入 `src/grit_backtest_platform/`、`web/src/`、`tests/` 和对应脚本。
- UI task：先读 `DESIGN.md`，若已有批准的 HTML 与代码级设计规格，再读交付物，然后进入相关 React 页面与测试。
- harness task：进入 `harness/README.md`、`harness/tasks/*.md`、acceptance 文档和固定 Codex 脚本。

### 1.3 文档优先级

| 层级 | 主要来源 | 用途 |
| --- | --- | --- |
| Runtime truth | `ARCHITECTURE.md`、`src/grit_backtest_platform/*.py` | 运行时边界、恢复口径、模块 ownership |
| Interface truth | `src/grit_backtest_platform/api.py`、`models.py`、`web/src/types.ts` | API、请求体、状态词汇、前后端契约 |
| Workflow truth | `scripts/codex-*.ps1`、`QuickStart-Grit.ps1` | 启动、smoke、固定验证入口 |
| Harness truth | `harness/README.md`、`harness/tasks/*.md` | 任务模板、验收路径、报告收口 |
| Project guide | `README.md` | 项目介绍、运行方式、目录地图 |

### 1.4 当前真相与待补齐项

| 主题 | 当前真相 | 说明 |
| --- | --- | --- |
| 固定 Codex 脚本 | `scripts/codex-reset-fixture.ps1`、`scripts/codex-test-backend.ps1`、`scripts/codex-test-frontend.ps1`、`scripts/codex-smoke.ps1` 已存在 | 这是当前 repo 级固定入口 |
| committed seed fixture | `harness/fixtures/seed_workspace/` 当前尚未提交到仓库 | 因此 fixture reset 与 live acceptance 相关能力还未完全可用 |
| `codex-reset-fixture.ps1` | 代码已按 committed fixture 模式实现 | 但由于 source fixture 缺失，当前运行会失败 |
| `codex-test-frontend.ps1 -IncludeLiveAcceptance` | 代码已支持 `LIVE_FIXTURE_MANIFEST` 与 `LIVE_API_BASE` | 但仍依赖缺失的 fixture 资产 |
| `codex-smoke.ps1` | 当前会先执行 fixture reset，再跑 backend/frontend 固定入口 | 因 fixture 缺失，当前不能把它当作默认可用的全量门禁 |
| `README.md` 中的 Codex smoke 描述 | 仍偏旧 | 若与脚本行为冲突，以 `scripts/codex-*.ps1` 和本文件为准 |

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

普通 product task 的默认路径是：

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
- `tests/test_creation_session_refresh.py`
- `tests/test_real_backtest_api.py`
- `tests/test_optimization_execution_resume.py`
- `tests/test_optimization_resume_api.py`
- `tests/test_strategies_smoke.py`

### 3.3 frontend 固定验证切片

`scripts/codex-test-frontend.ps1` 当前固定跑以下 focused Vitest 切片：

- `app.routes.foundation.test.tsx`
- `creation.flow.test.tsx`
- `backtest.submit.test.tsx`
- `run-detail.page.test.tsx`
- `workspace.dashboard.test.tsx`
- `optimization.module.test.tsx`

额外规则：

- 无论是否传 `-StrictGlobalTypes`，脚本都会跑一次 `npx tsc --noEmit` 并写报告。
- 只有显式传入 `-StrictGlobalTypes` 时，全局 TypeScript 报错才会变成阻塞门禁。
- 只有显式传入 `-IncludeLiveAcceptance` 时，才会尝试启动本地 backend 并运行 `web/scripts/run-live-acceptance.cjs`。

### 3.4 当前实践建议

在 committed seed fixture 资产缺失前，当前建议如下：

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
- 优先使用 repo 内 `.python-runtime/`
- 优先 Python 3.14，回退到 3.13
- 维护 `.venv/` 为派生环境
- 在需要时修复 `web/node_modules`

### 4.3 关键环境变量

| 环境变量 | 作用 |
| --- | --- |
| `GRIT_BACKTEST_DB` | 覆盖默认 SQLite 主库路径 |
| `GRIT_PYTHON_RUNTIME_SOURCE` | 为 QuickStart 指定可复制的 Python runtime 来源 |
| `GRIT_OPTIMIZATION_STEP_DELAY_SECONDS` | 覆盖优化 trial 之间的人工延迟；默认运行态为 `0`，测试态保持极小延迟以稳定观察进度刷新 |
| `GRIT_SNAPSHOT_MEMORY_LIMIT_RATIO` | 控制 Windows 下 snapshot refresh 的内存护栏比例 |
| `VITE_API_BASE_URL` | 覆盖前端请求 API base |
| `LIVE_API_BASE` | live acceptance 时覆盖测试 API base |
| `LIVE_FIXTURE_MANIFEST` | live acceptance 时显式指定 fixture manifest |

### 4.4 默认路径真相

- 默认主库：`.grit_backtest_platform.sqlite3`
- 默认 market-data companion：`.grit_backtest_platform_market_data.sqlite3`
- 默认 fixture staging 目录：`.tmp/codex-fixture/`
- smoke 摘要目录：`harness/reports/smoke/`
- 临时日志与运行产物：`.tmp/` 或 `artifacts/`

### 4.5 main.py 的命令面

`src/grit_backtest_platform/main.py` 当前只暴露两个主命令：

- `serve`
- `refresh-snapshots`

补充规则：

- `serve` 默认通过 `uvicorn` 启动 FastAPI app
- `refresh-snapshots` 支持 `incremental`、`repair`、`full`
- `refresh-snapshots` 在 Windows 下会使用基于 `GRIT_SNAPSHOT_MEMORY_LIMIT_RATIO` 的内存 job object 护栏

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
  - CLI 启动与 `refresh-snapshots`
- `src/grit_backtest_platform/models.py`
  - 请求体与关键状态词汇
- `src/grit_backtest_platform/_service_rebuilt.py`
  - 主业务 service
- `src/grit_backtest_platform/_real_service_rebuilt.py`
  - 基于真实 SQLite/runtime 数据的 service 扩展
- `src/grit_backtest_platform/_storage_restored.py`
  - SQLite 存储实现
- `src/grit_backtest_platform/_market_data_repository_restored.py`
  - snapshot、公司行为与市场数据落库

### 5.3 API 路由真相

当前 `api.py` 暴露的高价值路由包括：

- `GET /healthz`
- `GET /workspace/overview`
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
- `GET /optimization-jobs`
- `GET /optimization-jobs/{job_id}/detail`
- `POST /strategies/{strategy_id}/optimization-jobs`
- `POST /optimization-jobs/{job_id}/resume`
- `POST /optimization-jobs/{job_id}/candidates`
- `POST /optimization-jobs/{job_id}/candidates/{trial_id}/promote`
- `DELETE /optimization-jobs/{job_id}/candidates/{trial_id}`
- `GET /data-snapshots/overview`
- `POST /admin/snapshot-refresh-jobs`

当前优化任务 detail 的补充真相：

- `GET /optimization-jobs/{job_id}/detail` 在 `QUEUED`、`RUNNING`、`INTERRUPTED` 三种运行态必须保持轻量：只读取 persisted trial summary、进度、ETA、resume 元数据，不在热路径解码完整 candidate chart series。
- 运行态 ETA 依赖 persisted trial 的 `started_at/completed_at` 时间戳推导，不能假设秒级精度足够。
- 终态结果中心也不再全量解码所有 trial 曲线：先轻量读取全部 trial 排名，再只为 top-K 候选回补完整 `chart_series`，其余 trial 只保留轻量 summary。
- 优化执行期默认只持久化 trial 级 `parameter_snapshot`、`metrics`、`score` 与时间戳；完整曲线只在终态 top-K 回补并持久化。
- The optimization runtime still includes a Windows-safe parent-thread plus `multiprocessing.get_context("spawn")` worker controller, but the current synthetic `_service_rebuilt.py` evaluator keeps it disabled by default because local benchmarks show sequential execution is faster. Child workers, when explicitly re-enabled for future heavier evaluators, never write SQLite rows; the parent remains the single writer.
- Optimization worker concurrency is internally auto-managed. Startup worker count is reduced from the CPU cap when memory is already elevated, runtime drops one worker at `80%` system memory, forces single-worker mode at `90%`, and only scales back up after three consecutive safe samples.
- The active optimization evaluator path no longer preloads `_prepare_backtest_run_context()`. For the current `_service_rebuilt.py` evaluator, that preload was unused overhead, so the job runner now skips it entirely.
- Running optimization job summary writes are throttled to at most once per second or every five completed trials, while terminal state transitions still persist immediately.

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
- `#/creation/new`
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
| backend-only | `scripts/codex-test-backend.ps1` |
| frontend-only | `scripts/codex-test-frontend.ps1` |
| cross-stack 且不依赖 fixture | backend 与 frontend 固定入口分别执行 |
| fixture-backed acceptance | `scripts/codex-test-frontend.ps1 -IncludeLiveAcceptance`，但仅在 fixture 资产真实存在后执行 |
| 全量 Codex smoke | `scripts/codex-smoke.ps1`，但当前仅在 fixture 资产补齐后才应恢复为默认门禁 |

### 8.2 frontend 验证政策

- focused frontend tests 是默认阻塞门禁。
- 全局 `tsc --noEmit` 必须始终跑，并始终产出报告。
- 只有显式传入 `-StrictGlobalTypes` 时，全局 TypeScript debt 才是阻塞门禁。
- live acceptance 默认不跑，只在明确需要时通过 `-IncludeLiveAcceptance` 开启。
- 若改动涉及优化结果页运行态、ETA 或轮询节流，除固定入口外，应额外手工运行 `npx vitest run src/optimization.module.test.tsx src/optimization.results-progress.test.tsx src/optimization.polling.test.tsx`。

### 8.3 当前文档统一口径

从现在开始，关于 Codex 验证入口统一使用以下口径：

- 固定入口以 `scripts/codex-*.ps1` 为准
- committed fixture 未落地前，不把 `codex-smoke.ps1` 描述为默认可用
- `run-recovery-tests.ps1` 是手工 fallback，不是当前 fixed entry 的内建主路径

## 9. 完成定义

在本项目里，“代码改完”不等于“任务完成”。以下条件全部满足，任务才算 Done：

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
