# Grit 策略回测平台

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
- [scripts/run-recovery-tests.ps1](./scripts/run-recovery-tests.ps1)：前端测试恢复路径
- [scripts/bootstrap-python-runtime.ps1](./scripts/bootstrap-python-runtime.ps1)：修复仓库本地 Python 运行时
- [scripts/validate-quickstart-runtime.ps1](./scripts/validate-quickstart-runtime.ps1)：检查 QuickStart 运行环境
- [scripts/codex-pit-external-preflight.ps1](./scripts/codex-pit-external-preflight.ps1)：PIT 外部补源预检，只输出凭据 present/missing 状态
- [scripts/codex-pit-kaggle-search.ps1](./scripts/codex-pit-kaggle-search.ps1)：按固定关键词搜索 Kaggle 候选数据集
- [scripts/codex-pit-kaggle-download.ps1](./scripts/codex-pit-kaggle-download.ps1)：下载并登记 Kaggle 批量行情 manifest
- [scripts/codex-pit-bulk-normalize.ps1](./scripts/codex-pit-bulk-normalize.ps1)：用 DuckDB 流式归一化 CSV/TXT 到本地 catalog/Parquet
- [scripts/codex-pit-diff-repair.ps1](./scripts/codex-pit-diff-repair.ps1)：只按 PIT repair queue 做差异导入与复权冲突检查
- [scripts/push-to-github.ps1](./scripts/push-to-github.ps1)：GitHub 推送辅助脚本
