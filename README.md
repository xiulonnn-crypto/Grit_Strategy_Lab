# Grit 策略回测平台

## Git Fast / Impact / Full

- `latest-fast-gate.md` 和 `latest-impact-gate.md` 会在 `## Steps` 中记录每个 gate step 的 `duration=...`，用于直接判断 git checks、backend、TypeScript、Vitest 各自耗时。
- 日常改 backend/API/shared contract 后，先跑 owner slice；impact planner 也会强制纳入同一组：
  `.\.venv\Scripts\python.exe -m pytest tests/test_factor_research_api.py tests/test_backend_api.py tests/test_factor_mining_api.py tests/test_factor_factory_api.py tests/test_factor_quarantine_api.py -q`
- 改异步 job、后台任务或 completed/progress/candidate_rows 发布顺序后，单独跑；impact gate 也会把该测试按 `async_repeat_count` 重复执行：
  `.\.venv\Scripts\python.exe -m pytest tests/test_factor_mining_api.py::test_factor_mining_api_runs_one_thousand_candidates_without_factor_library_write -q`
- 改 F1/F2 前端后，在 `web/` 下跑；impact planner 也会强制纳入这组 Vitest：
  `node scripts/run-vitest-fixed.cjs factors.phase0.f1.test.tsx factor.model-builder.test.tsx factor.factory.test.tsx app.routes.foundation.test.tsx`
- 改验证脚本或 gate 逻辑后，先自测：
  `powershell -ExecutionPolicy Bypass -File .\scripts\codex-validate-impact.ps1 -PlanOnly`
  与 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-validate-fast.ps1`
- 提交前可先跑 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-validate-impact.ps1 -Scope WorkingTree`，避免影响面问题拖到最终推送才暴露。

- `git-fast` 使用 `scripts/codex-validate-fast.ps1`，也是 pre-push 默认门禁；它只跑日常精准增量测试，目标 5 分钟内完成，发现 contract、验证脚本、跨栈或未映射源码改动时返回 `not-fast`，不会自动进入长跑测试。
- `git-impact` 使用 `scripts/codex-validate-impact.ps1`，用于 fast 判定不适合后手动运行；它按 owner map 加影响面 fanout 运行 backend/frontend targeted checks，并会跑前端 `tsc --noEmit`。
- pre-push 在 fast 返回 `not-fast` 时会尝试复用当前 `HEAD/base` 匹配且非 PlanOnly、未 skip tests、带 step duration 的 `latest-impact-gate.md`；匹配则直接放行，不再需要默认 `--no-verify`。
- `git-full` 使用 `scripts/codex-validate-full.ps1`，用于大版本、发版、合并主线或 fixture/live acceptance 前的完整门禁。
- `output/ui-artifact-trace/**`、`output/logs/grit-coder/**`、`harness/reports/**`、项目内 `designs/**` 和证据型 `artifacts/**` 文件会保留在报告里，但不参与 fast 文件数、domain 判定或测试选择。

Grit Strategy Lab 的本地策略研究与回测工作台。当前仓库包含可运行的 FastAPI 后端、React/Vite 前端，以及一条已经接通的主链路：`workspace -> creation -> backtest -> run detail -> optimization`。

## 当前范围

- 工作台、策略创建、回测预览与提交、运行详情、优化实验室已接通
- 正式回测基于本地 SQLite 快照执行，不依赖运行时在线行情
- 项目以桌面工作台为主，移动端仅保留只读能力

## 快速启动

推荐直接使用仓库根目录启动脚本：

- [QuickStart-Grit.ps1](./QuickStart-Grit.ps1)
- [QuickStart-Grit.cmd](./QuickStart-Grit.cmd)

启动后默认地址：

- 后端：`http://127.0.0.1:8000`
- 前端：`http://127.0.0.1:4173/#/workspace`

基础依赖：

- Python `3.13+`
- Node `18+`

## 常用命令

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\runtime-supervisor.ps1 status quickstart
powershell -ExecutionPolicy Bypass -File .\scripts\runtime-supervisor.ps1 start-if-not-running quickstart --reason "local startup"
powershell -ExecutionPolicy Bypass -File .\scripts\runtime-supervisor.ps1 restart backend-api --reason "operator requested" --force
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -NoBrowser
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -RepairPython -NoBrowser
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -ForceRestart -RestartReason "snapshot provider credentials updated"
powershell -ExecutionPolicy Bypass -File .\scripts\codex-smoke.ps1
```

Codex 对话默认先走 `scripts/runtime-supervisor.ps1` 查看状态或提交启动/重启意图；人工仍可直接运行 `QuickStart-Grit.ps1`，但 QuickStart 会先经过同一套 supervisor 锁与健康检查，健康的 `8000` backend 和 `4173` preview 不会被默认重启。
当快照页写入 provider key、数据库路径或其它必须由 backend 进程启动时读取的环境配置时，使用受保护的 `QuickStart-Grit.ps1 -ForceRestart -RestartReason ...`。该路径会先由 supervisor 记录 `restart --force`、reason 与 cooldown，再替换 repo-owned 的 `8000/4173` 监听，避免普通 QuickStart 复用旧健康进程后继续显示未配置。

更多启动、测试、恢复和推送细节请直接查看下面的文档与脚本索引，不再在首页重复展开。

## 仓库入口

- `src/grit_backtest_platform/`：后端应用
- `web/`：前端应用
- `tests/`：后端测试
- `harness/`：任务模板、验收说明与 smoke 报告入口

## 文档导航

- [CHANGELOG.md](./CHANGELOG.md)：按 Keep a Changelog 维护的版本与历史变更记录
- [ARCHITECTURE.md](./ARCHITECTURE.md)：当前架构、运行时自修复、存储设计
- [DESIGN.md](./DESIGN.md)：当前 UI 视觉真源与设计规则
- [TECHNICAL.md](./TECHNICAL.md)：实现约束、恢复规则与工程执行细节
- [harness/README.md](./harness/README.md)：Codex 任务脚手架、fixture 与 smoke 约定
- [docs/GSL_TEC_V1_PLAN.md](./docs/GSL_TEC_V1_PLAN.md)：技术方案计划
- [docs/GSL_UI_V1_PLAN.md](./docs/GSL_UI_V1_PLAN.md)：UI 方案计划
- [docs/run-detail-layout-options.md](./docs/run-detail-layout-options.md)：Run Detail 页面布局备选稿

## 脚本索引

- [scripts/codex-smoke.ps1](./scripts/codex-smoke.ps1)：一键执行固定 smoke 链路
- [scripts/codex-validate-fast.ps1](./scripts/codex-validate-fast.ps1)：日常推云快速门禁，按改动范围运行受影响校验
- [scripts/codex-validate-full.ps1](./scripts/codex-validate-full.ps1)：大改、发版或合并前完整门禁，可并行跑后端与前端固定入口
- [scripts/codex-test-backend.ps1](./scripts/codex-test-backend.ps1)：固定后端测试入口
- [scripts/codex-test-frontend.ps1](./scripts/codex-test-frontend.ps1)：固定前端测试入口
- [scripts/codex-clean-stale-local-artifacts.ps1](./scripts/codex-clean-stale-local-artifacts.ps1)：清理长期无效的本地产物，详见 [docs/local-artifact-cleanup.md](./docs/local-artifact-cleanup.md)
- [scripts/run-recovery-tests.ps1](./scripts/run-recovery-tests.ps1)：前端测试恢复路径
- [scripts/bootstrap-python-runtime.ps1](./scripts/bootstrap-python-runtime.ps1)：修复仓库本地 Python 运行时
- [scripts/validate-quickstart-runtime.ps1](./scripts/validate-quickstart-runtime.ps1)：检查 QuickStart 运行环境
- [scripts/codex-pit-external-preflight.ps1](./scripts/codex-pit-external-preflight.ps1)：PIT 外部补源预检，只输出凭据 present/missing 状态
- [scripts/codex-pit-kaggle-search.ps1](./scripts/codex-pit-kaggle-search.ps1)：按固定关键词搜索 Kaggle 候选数据集
- [scripts/codex-pit-kaggle-download.ps1](./scripts/codex-pit-kaggle-download.ps1)：下载并登记 Kaggle 批量行情 manifest
- [scripts/codex-pit-bulk-normalize.ps1](./scripts/codex-pit-bulk-normalize.ps1)：用 DuckDB 流式归一化 CSV/TXT 到本地 catalog/Parquet
- [scripts/codex-pit-diff-repair.ps1](./scripts/codex-pit-diff-repair.ps1)：只按 PIT repair queue 做差异导入与复权冲突检查
- [scripts/push-to-github.ps1](./scripts/push-to-github.ps1)：GitHub 推送辅助脚本
