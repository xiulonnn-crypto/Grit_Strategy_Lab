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
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -NoBrowser
powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -RepairPython -NoBrowser
powershell -ExecutionPolicy Bypass -File .\scripts\codex-smoke.ps1
```

更多启动、测试、恢复和推送细节请直接查看下面的文档与脚本索引，不再在首页重复展开。

## 仓库入口

- `src/grit_backtest_platform/`：后端应用
- `web/`：前端应用
- `tests/`：后端测试
- `harness/`：任务模板、验收说明与 smoke 报告入口

## 文档导航

- [ARCHITECTURE.md](./ARCHITECTURE.md)：当前架构、运行时自修复、存储设计
- [DESIGN.md](./DESIGN.md)：当前 UI 视觉真源与设计规则
- [TECHNICAL.md](./TECHNICAL.md)：实现约束、恢复规则与工程执行细节
- [harness/README.md](./harness/README.md)：Codex 任务脚手架、fixture 与 smoke 约定
- [docs/GSL_TEC_V1_PLAN.md](./docs/GSL_TEC_V1_PLAN.md)：技术方案计划
- [docs/GSL_UI_V1_PLAN.md](./docs/GSL_UI_V1_PLAN.md)：UI 方案计划
- [docs/run-detail-layout-options.md](./docs/run-detail-layout-options.md)：Run Detail 页面布局备选稿

## 脚本索引

- [scripts/codex-smoke.ps1](./scripts/codex-smoke.ps1)：一键执行固定 smoke 链路
- [scripts/codex-test-backend.ps1](./scripts/codex-test-backend.ps1)：固定后端测试入口
- [scripts/codex-test-frontend.ps1](./scripts/codex-test-frontend.ps1)：固定前端测试入口
- [scripts/run-recovery-tests.ps1](./scripts/run-recovery-tests.ps1)：前端测试恢复路径
- [scripts/bootstrap-python-runtime.ps1](./scripts/bootstrap-python-runtime.ps1)：修复仓库本地 Python 运行时
- [scripts/validate-quickstart-runtime.ps1](./scripts/validate-quickstart-runtime.ps1)：检查 QuickStart 运行环境
- [scripts/push-to-github.ps1](./scripts/push-to-github.ps1)：GitHub 推送辅助脚本
