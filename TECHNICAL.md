# TECHNICAL（技术手册）

## Factor display naming and dedupe gate

- Before changing factor Chinese display names, `display_name_cn`, `short_name_cn`, `base_display_name_cn`, `name_collision_*`, aliases, search keywords, backfill, quarantine publish, governance publish, factor factory publishable lists, factor detail, model builder, or run-detail factor projection, build a read-only duplicate-name fact table for online-visible F2/F3 factors. The table must include `factor_id`, `stored_name`, `projected_name`, `base_display_name_cn`, `tier_level`, `lifecycle_status`, `expression`, `parent_factor_ids`, `op_status`, `benchmark` or `residual_control`, and collision group.
- For route-specific naming incidents, run `python scripts/factor_naming_probe.py --factor-id <id> --expected-name <name> --reject-name <bad-name> --strict` before browser work. The probe compares DB publish metadata, `GET /factor-factory/overview`, `GET /factors?lifecycle=all`, and `GET /factors/{factor_id}` so the failing surface is visible before patching.
- Treat naming as a deterministic projection contract. Pure parser tests must cover `Return`, `Std(Return)`, `DownsideStd(Return)`, `Residual`, `FFBlend`, cashflow/volatility ratios, window or parameter extraction, missing benchmark metadata, and the rule that the system must not fabricate `SP500` or any benchmark when the metadata is absent.
- All read and write paths must call the same naming resolver: `GET /factors`, `GET /factors/{factor_id}`, `display-name-v4-backfill` dry-run/apply, quarantine publish, and governance optimized-factor publish. The protocol version is `factor_display_name_v4_structured`; the dedupe strategy is `parameter_first_then_sha8`.
- Backfill is display-only. It may update the stored Chinese display name, alias/search keywords, and `factor_display_name_renames` audit rows, but it must not change `id`, `canonical_id`, `factor_versions.expression`, `factor_lineage_edges`, diagnostic summaries, or historical publish events.
- Collision audit must record `previous_display_name`, `new_display_name`, `base_display_name_cn`, `name_collision_key`, `name_collision_group`, `name_dedupe_suffix`, `name_schema_version`, `renamed_at`, `rename_reason`, chosen differentiating parameters, and a non-secret fallback hash input summary when `[SHA-8]` is used.
- UI evidence is part of the naming gate. `#/factors/factory` publishable factors and B3 quarantine rows must highlight same-base-name candidates and show difference chips for window/parameter, governance chain, benchmark, RankIC, IR, and score. The detail modal must show base name, final name, dedupe reason, expression, parent factors, governance chain, and benchmark.
- Windows ad hoc debugging must be reproducible in PowerShell. Use `@' ... '@ | python -` or a short `.tmp/` script for Python snippets; do not paste Bash heredocs into PowerShell transcripts.
- Required validation for code changes in this area: backend owner slice `.\.venv\Scripts\python.exe -m pytest tests/test_factor_research_api.py tests/test_backend_api.py tests/test_factor_mining_api.py tests/test_factor_factory_api.py tests/test_factor_quarantine_api.py -q`; frontend owner slice from `web/`: `node scripts/run-vitest-fixed.cjs factors.phase0.f1.test.tsx factor.model-builder.test.tsx factor.factory.test.tsx app.routes.foundation.test.tsx`; run-detail supplement from `web/`: `node scripts/run-vitest-fixed.cjs run-detail.page.test.tsx run-detail-kv-format.test.ts optimization-config-fields.test.ts`.

## Factor Factory batch lineage repair gate

- Before editing code for `#/factors/factory`, `/factor-factory/overview`, Raw_F2, Refined_F2, WNZT, quarantine, publishable factors, or batch-count anomalies, run the read-only preflight: `python scripts/factor_factory_lineage_preflight.py`. Use `--db <path>` when `GRIT_BACKTEST_DB` points at a non-root runtime DB, and `--strict` when mismatches should fail the review gate.
- The preflight output is the first evidence item in the `$grit-review` chain. It must report `current_batch_id`, `source_job_id`, Raw_F2 count, Refined_F2 count, ledger artifact count, quarantine source-job count, status counts, and the UI summary source. If it reports `ledger_count_mismatch_*`, `quarantine_count_mismatch_*`, `ledger_source_job_mismatch`, or `preview_may_be_used_as_batch_total`, classify the issue as batch lineage before touching UI code.
- Preview is never canonical. `top_candidates`, `top_preview_count`, default `page_size=50`, first-page quarantine rows, and UI preview lists are bounded projections only. Factor factory tests must guard that no preview or paged result is used as batch total, source-job truth, or publishable-factor truth.
- Full Raw_F2 and Refined_F2 artifacts must carry a manifest contract: `job_id`, `source_job_id`, `formula_count`, `refined_count`, `hash`, and `created_at`. API responses and detail modals should echo this manifest or an explicit artifact reference. Missing manifest fields are a preflight warning and must block final acceptance for new artifact-producing work.
- Debug with a small-budget red repro first: use a 20-50 formula operator snapshot to prove `Raw_F2 -> Refined_F2 -> Quarantine -> UI` count alignment and failure behavior, then run the 1470+ full budget once for acceptance.
- Factor factory read models should converge on one current-batch resolver contract: `current_batch_id`, `source_job_id`, `artifact_id`, `is_preview`, `total_candidates`, and `page_count`. Task cards, quarantine pagination, publishable factors, and detail evidence must read from that contract or fields explicitly derived from it.
- Live route evidence should be scripted where possible: open the cache-busted `#/factors/factory` route, capture task-card counts, pagination such as `1-50/1470`, publishable-factor duplicate groups, and the detail modal's Raw/Refined/WNZT evidence, then compare those values with API and manifest output. Screenshots remain required but should not be the only proof.

## Factor Factory multi-agent kickoff package

Cross-stack factor-factory work that touches backend contracts, execution, UI, tests, docs, or live acceptance must start from a small, auditable kickoff package before workers edit files.

- Create `output/logs/grit-coder/<task-slug>/agent-task-matrix.md` before delegation. It must list `task_id`, `owner`, `branch`, `worktree_path`, `base_commit`, expected `HEAD`, write set, forbidden hotspot files, runtime boundary, focused tests, merge order, and final integration gate.
- If independent worktrees are skipped, the matrix must record the skip reason, risk, and compensating validation. "Current checkout only" is acceptable only when the task is small, read-only, non-parallel, explicitly requested, or blocked by a repo/worktree limitation.
- For approved HTML/SPEC/PNG work, create `output/ui-artifact-trace/<task-slug>/trace-matrix.md` as a skeleton before UI edits. Rows may start as `NOT_CHECKED`, but the file must already name design sources, route, desktop/mobile viewports, measurable geometry/overflow gates, interaction gates, screenshot filenames, and approved deviations.
- Before any live route verification or restart decision, save the read-only runtime preflight output to `output/logs/grit-coder/<task-slug>/runtime-preflight.json`. Terminal summaries are not enough for final live evidence.
- Use this default gate cadence for factor-factory composition or similar pipeline work: lineage preflight -> contract skeleton tests -> execution-core focused tests -> UI focused Vitest -> frontend owner slice -> runtime preflight -> live Trace Matrix screenshots/geometry -> final integration evidence.
- Known unrelated dirty-worktree blockers must be recorded in `output/logs/grit-coder/<task-slug>/known-blockers.md` with failing command, failing file/test, owner area, and why it is outside the current task. Do not let unrelated failures silently dilute the current acceptance result.

## Phase 1 因子工厂自动矿机

- 自动矿机继续复用现有 `#/factors/factory` 与 `/factor-factory/*`，不新建平行运行系统。
- `OperatorEngine` 是工厂 run 的公式生成边界，MVP 后端为 `pandas_bottleneck`；默认每日预算为 `10,000` 公式，预算和 backend 固化到 `operator_config_snapshot`。
- 工厂 run 必须物化完整 Raw_F2 批次清单、矩阵、series/stats artifact 与 `raw_f2_batch_delivered_count`；`top_candidates`/前端 50 条只允许作为预览或分页，不得作为任务入口总量。
- 当前工厂 run 必须引用不可变 `f1_catalog_snapshot_id` 与 `operator_config_snapshot_id`；保存配置草稿不会影响已运行或运行中的 run。
- Raw_F2 必须进入 WNZT 治理与检疫，不能绕过检疫直发；发布边界要求真实 Refined_F2、WNZT 完整、检疫 `PASS`、`publish_status=ELIGIBLE`，并保留配置快照和检疫证据。候选创建时不得仅靠布尔字段把 Raw_F2 标成已治理。
- 相关验证优先跑：`tests/test_operator_engine.py`、`tests/test_operator_registry.py`、`tests/test_factor_factory_api.py`、`tests/test_factor_quarantine_api.py`，再按影响面跑固定 backend/frontend scripts。每次改变工厂 pipeline，必须分别验证完整批次口径、preview 截断口径和发布准入口径不会混用，并至少包含一条缺证据应失败的负向路径。

本文件是 Grit Backtest Platform 的工程规则手册，用来整理当前仓库已经存在的技术真相、任务路由规则、验证路径与完成定义。

## Git Fast / Impact / Full 当前真相

- `latest-fast-gate.md` 与 `latest-impact-gate.md` 的 `## Steps` 必须保留每一步 `duration=...`，用于直接定位 git checks、backend targeted tests、frontend TypeScript 与 frontend Vitest 的耗时来源，不能再依赖文件时间反推。
- 改 backend/API/shared contract 后，impact planner 会强制纳入 owner slice；日常实现阶段也应先手工跑同一组：
  `.\.venv\Scripts\python.exe -m pytest tests/test_factor_research_api.py tests/test_backend_api.py tests/test_factor_mining_api.py tests/test_factor_factory_api.py tests/test_factor_quarantine_api.py -q`
- 改异步任务、后台 job、进度或 completed 状态发布顺序后，impact 会选择该时序测试并按 `async_repeat_count` 重复执行；日常实现阶段也应至少单独跑一次：
  `.\.venv\Scripts\python.exe -m pytest tests/test_factor_mining_api.py::test_factor_mining_api_runs_one_thousand_candidates_without_factor_library_write -q`
- 改 F1/F2 因子库、因子工厂或前端 view-model 后，impact planner 会强制纳入这组 Vitest；日常实现阶段先在 `web/` 下跑：
  `node scripts/run-vitest-fixed.cjs factors.phase0.f1.test.tsx factor.model-builder.test.tsx factor.factory.test.tsx app.routes.foundation.test.tsx`
- 改 `scripts/codex-validate-*`、`scripts/git_gate_plan.py`、pre-push hook 或门禁报告格式后，impact gate 会执行 PlanOnly 自测；日常实现阶段必须先跑：
  `powershell -ExecutionPolicy Bypass -File .\scripts\codex-validate-impact.ps1 -PlanOnly`
  与 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-validate-fast.ps1`，用于提前暴露 tsc cwd、Vitest cwd、report path 和 eligibility 逻辑问题。
- 提交前建议先跑 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-validate-impact.ps1 -Scope WorkingTree`，把影响面问题留在实现阶段暴露，而不是等最后 git push。
- impact 已通过时，`pre_push_hook.py` 会优先读取 `latest-impact-gate.md`，校验 `status/scope/plan_only/skip_tests/head_sha/base_sha/duration` 与当前 push 匹配后直接放行，无需先跑 fast gate。若当前 HEAD 只是已验证提交的单个受控元数据子提交，且只改 `CHANGELOG.md` 和/或 `src/grit_backtest_platform/_version.py`，必须先通过本次 changelog preparation 与 metadata diff whitespace check，才可复用父提交 impact 证据；其他 head/base 不匹配仍必须重新运行 impact/full，或由操作者显式选择 `git push --no-verify`。
- `codex-validate-fast.ps1` / `codex-validate-impact.ps1` 支持 `-SinceLastValidated <sha>`：`Scope Committed` 可只规划 `<sha>..HEAD` 的新增受控 diff，并在 summary 固化 `since_last_validated` 与 `validation_fingerprint`。报告中的 `base_sha` 和 `head_sha` 都在计划开始时解析，不能在 summary 阶段重新读取可漂移 ref。
- impact owner slice 已拆分：只有后端核心契约 `src/grit_backtest_platform/api.py` / `models.py` 触发完整 backend contract owner；`web/src/types.ts`、`workspace-adapters.ts`、`demoStoreContext.tsx` 等前端契约镜像只触发前端 contract/route owner，再叠加文件名命中的 factor/snapshot/release 等局部 owner。
- gate wrapper 对 pytest、tsc、Vitest 等长子进程使用受控 child-process 执行；取消时应杀掉已跟踪的子进程树，并避免继续写新的 `latest-fast-gate.md` / `latest-impact-gate.md`。

- `git-fast` 对应 `scripts/codex-validate-fast.ps1`，也是 pre-push 默认门禁；它只做日常精准增量验证，目标 5 分钟内完成，不会自动升级到长跑影响面测试。
- `git-impact` 对应 `scripts/codex-validate-impact.ps1`，用于 fast 返回 `not-fast` 后手动运行；它过滤证据资产后按 owner map 加影响面 fanout 运行 backend/frontend targeted checks，并运行前端 `tsc --noEmit`。
- `git-full` 对应 `scripts/codex-validate-full.ps1`，用于大版本、发版、合并主线或 fixture/live acceptance 前的完整验证。
- 证据资产不参与 fast 的文件数、domain 判定或测试选择，包括 `output/ui-artifact-trace/**`、`output/logs/grit-coder/**`、`harness/reports/**`、项目内 `designs/**`，以及证据型 `artifacts/**` 文件。
- pre-push 只调用 fast；当 fast 返回 `not-fast` 时阻止 push 并提示运行 impact/full，紧急推送必须由操作者显式选择 `git push --no-verify`。

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

#### 1.3.1 Design-locked UI 防漏验收规则

当任务引用已批准 HTML/SPEC/PNG、用户明确要求“按 UI 稿 100% 一致”，或前一轮 review 已指出与 UI 稿存在差距时，`UI Artifact Trace Matrix` 不能只证明运行态功能正确，必须同时证明“批准稿场景已被复现”。缺少以下任一项时，不得关闭 UI 验收：

- **批准基线定位**：矩阵必须列出批准 HTML、SPEC、PNG 的绝对或仓库相对路径、截图时间、目标 viewport，以及本次是否包含 shared shell。
- **条件模块覆盖**：批准稿里出现但依赖数据条件的模块必须被造出可见状态再验收，例如 `publishable_count > 0` 的发布区、空态/非空态列表、WARN/FAIL/PASS 混合态、弹层展开态。若 live API 暂无该状态，应使用可审计 fixture 或临时种子数据；不能用 `0 条所以不展示` 判定为通过。
- **设计 vs live 双向对照**：矩阵必须包含设计截图与 live 截图，逐项比较模块数量、模块顺序、标题、卡片数、状态 chip、关键列、按钮文案、弹层内容、密度、留白、固定高度、内部滚动、右侧空白和按钮是否折行。只写 `scrollWidth`、`panel height` 或路由可达不够。
- **内容架构断言**：对卡片、列表、弹层、rail、drawer、table 这类组合 UI，必须记录每个模块应该出现的字段与控件；若设计稿定义“只保留详情按钮”，则矩阵要断言没有额外操作。
- **允许偏离登记**：任何与批准稿不同的 live 字段替换、状态合并、模块缺省、顺序调整、密度变化，都必须在矩阵里写成 `approved_deviation` 并说明批准来源；没有来源即为设计漂移。
- **截图目检结论**：最终报告必须说明已经打开最终截图并肉眼检查。保存截图、DOM 断言或测试绿色都不能单独支撑“UI 稿一致”。
- **Reviewer 否决权**：reviewer 发现矩阵未覆盖批准稿条件模块、仅验证当前 live 数据、或截图显示明显结构/密度偏差时，必须拒收并要求补齐矩阵或重新实现。

#### 1.3.2 UI 交付前冻结与语义一致性门禁

本次 Phase 0 因子库和因子工厂 UI 复盘确认，返工拖长的主因不是单个 CSS 问题，而是设计稿验收矩阵在实现后才补齐，且缺少状态语义、业务文案、控件真实性和移动端溢出的前置拒收项。后续 design-locked UI 必须在编辑代码前完成以下冻结：

- **前置验收矩阵**：在 `output/ui-artifact-trace/<scope>/trace-matrix.md` 或同等证据文件中先写明设计源、live route、desktop/mobile viewport、shared shell 范围、截图目标、模块顺序、字段/控件清单、状态/颜色/文案映射、交互清单和允许偏离。
- **状态语义一致性**：同一行、卡片或弹层内的准入、阻塞、风险、来源列必须使用同一套业务语义。因子/PIT 页面推荐口径为 `可调用 / 审慎可调用 / 暂不可调用` 与 `无阻塞 / 需复核 / 源阻塞 / 时点缺口`；不得出现“无阻塞”却同时解释为“覆盖或时点待确认”的前后矛盾。
- **业务文案闸门**：主表、KPI、弹层和配置页不得向用户暴露 `NaN`、填 0、raw enum、英文 key、内部处理策略或工程说明语气，除非批准稿明确要求。底层实现语义可以保留在 metadata、tooltip 或审计明细，但前台主舞台必须用简洁中文金融风险语言表达。
- **真实控件闸门**：设计稿中可见的 tab、rail、筛选、搜索、开关、保存、生成快照等控件必须真实可交互；若暂不实现，必须在 Trace Matrix 里登记为批准偏离，不能用静态按钮样式冒充已实现交互。
- **移动端与溢出闸门**：桌面和移动最终截图都必须打开目检。移动端如表格列宽导致文字重叠、横向滚动或信息不可读，应切换为卡片行/摘要行，而不是简单隐藏 overflow。
- **条件状态强制可见**：批准稿定义的弹层默认 tab、READY/WARN/BLOCKED 行、空态/错误态、dirty close、保存成功和筛选搜索结果必须至少覆盖代表状态。live 数据缺少状态时，使用可审计 fixture/种子数据；无法构造时标记验收 blocked。

#### 1.3.3 UI 开发后 Trace Matrix 签核门禁

`GRIT_Coder` 完成开发后，必须把 Trace Matrix 当作交付签核表，而不是事后说明材料。只要用户要求“100% 一致”，或任务引用批准 UI 稿，交付前必须执行以下规则：

- **逐项签核**：Trace Matrix 每一行必须有 `PASS / FAIL / BLOCKED / NOT_CHECKED` 状态、证据路径和简短结论。只有 `FAIL=0`、`BLOCKED=0`、`NOT_CHECKED=0` 时，才能声明“UI 稿 100% 一致”。
- **不得自我放行**：`GRIT_Coder` 自验只是进入正式 review 的前置条件；不能用“Would reviewer refuse this? No”代替逐项矩阵证据。若存在 reviewer/Verification owner，必须允许其基于任何未签核项拒收。
- **截图必须目检**：最终 desktop/mobile 截图必须被打开并检查模块顺序、密度、字体、字号、留白、滚动、重叠、弹层默认态和条件状态。未目检的截图按 `NOT_CHECKED` 处理。
- **偏离即失败**：任何未登记批准来源的视觉、文案、状态、控件或响应式偏离，均记为 `FAIL`。不能把“功能可用”或“数据真实”作为设计稿偏离的默认豁免。
- **交付声明格式**：UI 交付最终说明必须包含 Trace Matrix 路径、设计截图、live 截图、签核统计、未通过项或批准偏离。缺少这些信息时，默认 UI 验收未完成。
- **交付口径冻结**：矩阵未达到 `FAIL=0 / BLOCKED=0 / NOT_CHECKED=0` 前，开发输出只能称为“验收候选”或“待 review”，不得使用“完成”“已交付”“100% 一致”等关闭口径。Coder 自测不能替代 reviewer 或 Verification owner 的拒收权。
- **变更包收口**：设计锁定 UI 交付前必须对本次 ownership 路径运行 `git status --short -- <owned paths>`，确认源码、测试、Trace Matrix、截图和新增文件均已纳入变更包或作为证据资产登记。核心源码、测试或 view-model 文件处于 untracked 状态时，默认交付 blocked，不能只凭 live 页面已修好关闭。

#### 1.3.4 UI Review 提效执行流

设计稿验收不应靠反复手动截图和临场补矩阵。后续 `$grit-review` 针对 UI parity、视觉漂移或“100% 一致”任务时，默认采用以下快速路径：

1. **先建骨架**：在 `output/ui-artifact-trace/<task-slug>/trace-matrix.md` 建立 skeleton，预先写入设计源、live route、desktop/mobile viewport、shared shell scope、截图文件名、条件态、几何/overflow gate、允许 live 替代字段。
2. **先验 runtime**：live review 前运行 runtime preflight，确认 `8000/4173`、served bundle、API 200、runtime DB 和 cache-busting URL 可用；环境未 ready 时先修 runtime，不把 `Failed to fetch` 误判为 UI 缺陷。
3. **一次采集证据**：优先用 Playwright 或脚本批量输出 design desktop、live desktop、live mobile、关键 modal/drawer/条件态截图、metrics JSON、overflow report、console errors 和 failed requests，避免逐项手动重跑。
4. **三层并行验收**：矩阵按结构层、几何层、内容层同步填写。结构层核对模块顺序和 card/table/button 数量；几何层核对 top/width/height/overflow/sticky/scroll；内容层核对中文文案、状态、真实数据映射和 raw leak。
5. **先定 shell 范围**：矩阵第一屏必须声明 shared shell 是否在本次验收范围内。若只验 page body，侧栏/顶栏差异只作为批准偏离或 out-of-scope 记录，不在后续重复争论。
6. **先标 live 替代字段**：将字段标为 `frozen-design`、`live-substitutable` 或 `must-match-copy`。真实 registry/API 数值差异只有在矩阵中登记后才算批准偏离。
7. **最后收口变更包**：交付前运行 `git status --short -- <owned paths>` 和 `git diff --check -- <owned paths>`。核心 source/test/view-model untracked 时，默认 blocked。

最终报告必须包含 Trace Matrix 路径、截图目录、metrics JSON、runtime/API 证据、三层验收结论、批准偏离和 owner-path status 结果。缺少任一项时，只能交付为“验收候选”。

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
- 因子工厂旧沙盒兼容入口可以读取 mining job 的 top candidates；Phase 1 自动矿机不得把 top candidates 当作任务入口、检疫事实源或总量统计。完整 Raw_F2 batch ledger 是检疫来源，top candidates 只是 UI 预览或分页投影。L1 只允许 `Close/Open/Volume/MarketCap/Sector` 等未经算子的事实字段走 PIT-only 准入；只要表达式出现 `Return/MA/Std` 等算子，就归入 L2 Raw Signal，并在真实 WNZT/检疫证据齐备后才可进入发布准入。
- 因子中文名标准为 `gsl_cn_naming_standard_2026_05`，协议字段仍沿用 `factor_display_name_v4_structured`。后端、前端 mirror、展示名回填、检疫发布、治理优化发布和因子详情必须通过同一 resolver 生成中文名、`base_display_name_cn`、碰撞键、差异 token 与 `name_audit.structured_components`；回填只能修改 display name、alias/search keyword 与审计记录，不得改因子 ID、canonical ID、表达式、版本、血缘或历史发布事件。F1/F2/F3 名称分别采用 `[数据源] - [物理科目] (原始)`、`[核心指标] ([窗口/参数]) [治理状态]`、`[风格族] - [核心金融语义] ([核心参数]) [治理状态]`，窗口优先使用 `1d/3d/5d/21d/63d/126d/252d/LTM/FY1`。`[Beta-Free]` 只代表核心 Alpha 语义已剥离市场/行业/市值 beta；普通 WNZT 中性化不得伪装为 beta-free。
- 哈希后缀只作为最后安全网，不应成为常态业务展示。常见算子差异必须先进入中文语义，例如 `Winsorize(Return(...))` 或 `winsor*ret` ID 映射为 `平滑收益率`，普通 `Return(...)` / `ret` 保持 `收益率`，以避免 `a_mom_winsor3ret_3d_raw` 和 `a_mom_ret_3d_raw` 这类因子只靠 `[hash]` 区分。
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
| 固定 Codex 脚本 | `scripts/codex-reset-fixture.ps1`、`scripts/codex-test-backend.ps1`、`scripts/codex-test-frontend.ps1`、`scripts/codex-smoke.ps1`、`scripts/codex-validate-fast.ps1`、`scripts/codex-validate-full.ps1` 已存在 | 这是当前 repo 级固定入口 |
| 已提交种子 fixture | `harness/fixtures/seed_workspace/` 已包含 workspace DB、market-data DB 与 manifest | fixture reset 与 manifest-driven live acceptance 可用 |
| `codex-reset-fixture.ps1` | 已按 committed fixture 模式实现，并复制到 `.tmp/codex-fixture/` | 运行后输出 staged workspace DB 路径 |
| `codex-test-frontend.ps1 -IncludeLiveAcceptance` | 支持 `LIVE_FIXTURE_MANIFEST` 与 `LIVE_API_BASE`，会启动 `8010` fixture backend 并运行 live real-api smoke | 当前固定验证入口 |
| `codex-smoke.ps1` | 当前会先执行 fixture reset，再跑 backend/frontend 固定入口 | fixture 资产存在；失败时应报告具体 reset/API/UI 断言 |
| `codex-validate-fast.ps1` | 日常推云默认入口，保留 fetch/merge-base/ahead-behind、diff check 与按改动范围选择后端/前端校验 | pre-push 会在 CHANGELOG/版本快照无待提交后调用 committed scope |
| `codex-validate-full.ps1` | 大改、发版或合并前入口，复用固定 backend/frontend 脚本并默认并行执行 | 需要串行排障时传 `-Sequential` |
| `README.md` 中的 Codex smoke 描述 | 仍偏旧 | 若与脚本行为冲突，以 `scripts/codex-*.ps1` 和本文件为准 |

### 1.5.1 Phase 0 F1 与算子配置当前真相

- Phase 0 数据链路为 `PIT 数据源 -> F1 原始字段目录 -> 算子注册表/配置快照 -> Factor Factory Run 快照引用`，不新建第二套因子工厂运行系统。
- `POST /admin/pit-preprocessing-runs` 会生成 `pit_preprocessing_runs` 批次与 `f1_raw_factor_catalog_snapshots`/`f1_raw_factor_fields` 目录。`GET /factors/f1-catalog/latest` 与 `GET /factors/f1-catalog` 是前端 F1 tab 的查询入口。
- F1 原始字段不使用 RankIC/IR/OOS 作为准入硬门槛；只治理 PIT、coverage、publish_date/available_at、缺失阻塞和未来函数风险。缺失 L1 必须保持 `NaN` 语义，并标记 `DATA_SOURCE_BLOCKED`。
- `GET/PUT /factor-factory/operator-config` 保存默认 profile 草稿；`POST /factor-factory/operator-config/snapshots` 生成不可变 `operator_config_snapshot_id`。默认只启用 `TS_Return`、`TS_Rank`、`TS_Corr`，窗口为 `[3,5,10,21,63,126,252]`，默认 depth 为 `2`。
- `POST /factor-factory/run-now` 与每日自动化会把 `f1_catalog_snapshot_id`、`operator_config_snapshot_id`、启用算子、窗口空间、默认 depth、阻塞字段策略写入 `factor_factory_runs.request_json.config_snapshot` 与 summary；`config_signature` 包含两个快照 ID。
- `DATA_SOURCE_BLOCKED` 的 F1 字段会按配置策略从 `source_factor_ids` 中排除，挖掘候选仍必须走 `sandbox -> quarantine -> publish`。

### 1.5.2 Phase 0 / F1 / Operator 三段实施路径

Phase 0 这类同时触及合同、执行、UI、测试和文档的任务，默认不得一次性合并为单个交付切片。除非用户明确要求“一次端到端落完”且改动面很小，否则按以下三段推进：

| 切片 | 范围 | 最小验收 | 不做事项 |
| --- | --- | --- | --- |
| `Contract Skeleton` | schema、Pydantic/TS types、API route、storage helper、demo/mock、最小 read-model | 接口可查、旧请求兼容、快照 ID 可引用、contract tests 通过 | 不接完整 PIT resolver，不追 UI 100% |
| `Execution Core` | PIT/F1 resolver、operator engine、factory run 引用、不可变快照、负向数据语义 | 数据链路正确、`DATA_SOURCE_BLOCKED` 策略正确、历史不足/缺证据负向路径失败、focused backend tests 通过 | 不扩展前台设计，不重做弹层密度 |
| `UI Parity` | F1 tab、工厂配置弹层、中文 view-model、桌面/移动截图、Trace Matrix 签核 | Trace Matrix `FAIL=0/BLOCKED=0/NOT_CHECKED=0`、focused frontend tests 和截图目检通过 | 不新增后端能力，不改运行合同 |

多代理计划必须优先按写入边界拆分，而不是只按产品职责拆分：

- `contracts/storage`：`models.py`、`api.py`、storage helper、migration-safe schema。
- `execution/service`：resolver、operator engine、factory run snapshot 引用、负向语义。
- `UI/types/mock`：`web/src/types.ts`、demo/mock、页面、CSS、view-model。
- `tests/docs/trace`：focused tests、Trace Matrix、TECHNICAL/ARCHITECTURE/CHANGELOG。

`models.py`、`api.py`、`web/src/types.ts`、factory page、shared tests 属于集成热点，每次只能有一个 integration owner。跨 backend/frontend/contract 的工作默认先跑 owner slice 或 `git-impact`，不要先按小修 fast gate 试错。

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
| `scripts/codex-validate-fast.ps1` | 日常推云快速门禁：git fetch/merge-base/ahead-behind、cached/working/committed diff check、按改动范围运行 targeted backend 或 frontend 校验 | pre-push 默认调用 `-Scope Committed -SkipFetch`，手工日常推云可直接运行默认入口 |
| `scripts/codex-validate-full.ps1` | 大改、发版或合并前完整门禁，默认并行执行 backend 与 frontend 固定入口并写入 full gate 摘要 | 如需复现旧串行行为，传 `-Sequential` |
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

- 日常推云：默认运行 `scripts/codex-validate-fast.ps1`；它会保留廉价 git 门禁，并按改动范围决定是否跑 backend targeted slice、`tsc --noEmit` 和相关 Vitest。
- 只改文档或 CHANGELOG：fast gate 不跑 backend/frontend。
- 只改 backend：fast gate 跑受影响 pytest；改 API/types/shared contract 时同时跑 backend 与 frontend。
- 只改 frontend：fast gate 跑 `tsc --noEmit` 与相关 Vitest。
- 大改、发版或合并主线前：运行 `scripts/codex-validate-full.ps1`；它复用固定 backend/frontend 入口，并在两边都需要时并行执行。
- `scripts/codex-smoke.ps1` 可作为 fixture-backed orchestrator 使用；失败时报告具体 reset/API/UI 断言。
- `scripts/codex-test-frontend.ps1` 通过 `web/scripts/run-vitest-fixed.cjs` 启动 Vitest，固定入口会避开 Vite config/esbuild 子进程加载路径，并对 Windows `net use` realpath probe 做启动保护；若命令超过 540 秒，脚本会写入 timeout 报告并停止子进程树。

## 4. 系统与运行时总览

### 4.1 技术栈真相

- backend：Python + FastAPI + Pydantic + SQLite
- frontend：React 19 + TypeScript + Vite + Vitest
- Python packaging 约束来自 `pyproject.toml`，当前真实要求是 `>=3.12`
- frontend 依赖版本真相来自 `web/package.json`

### 4.2 QuickStart 真相

Codex 对话默认不要直接反复重启本地脚本。先使用 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-grit-runtime-preflight.ps1 -Json` 做只读 preflight，读取 `quickstartOverall`、`decision`、`backendRepoOwned`、`frontendRepoOwned`、`frontendDistHash/frontendServedHash`、`portProbeStatus` 和 `browserProbeStatus` 后再决定复用、重建或重启。需要提交 supervisor 意图时再使用 `powershell -ExecutionPolicy Bypass -File .\scripts\runtime-supervisor.ps1 status quickstart`、`start-if-not-running quickstart` 或 `restart <service> --force --reason ...`；让 supervisor 记录锁、冷却窗口、pending intent 和 `.tmp/runtime-supervisor/state/*.json` 状态镜像。人工仍可运行 `QuickStart-Grit.ps1`，但 QuickStart 启动前会调用 supervisor guard；如果 `8000` backend 与 `4173` preview 已健康运行，启动器会复用现有监听而不是默认 Stop-Process 重启。

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
| `EODHD_API_TOKEN` / `EODHD_API_KEY` | EODHD 退市标的价格、分红拆分与基础面授权源；只读取环境变量，不落库 |
| `GRIT_ENABLE_YAHOO_HTML_HISTORY` | 允许 Yahoo 历史页作为最后观测探针；只有解析到带日期的 OHLCV 行时才能落正式价格点 |
| `FRED_API_KEY` | OpenBB FRED 固定收益曲线凭证，运行时映射到 `fred_api_key`，不写入本地 OpenBB 设置文件 |
| `GRIT_PYTHON_RUNTIME_SOURCE` | 为 QuickStart 指定可复制的 Python runtime 来源 |
| `GRIT_OPTIMIZATION_STEP_DELAY_SECONDS` | 覆盖优化 trial 之间的人工延迟；默认运行态为 `0`，测试态保持极小延迟以稳定观察进度刷新 |
| `GRIT_SNAPSHOT_MEMORY_LIMIT_RATIO` | 控制 Windows 下 snapshot refresh 的内存护栏比例 |
| `VITE_API_BASE_URL` | 覆盖前端请求 API base |
| `LIVE_API_BASE` | live acceptance 时覆盖测试 API base |
| `LIVE_FIXTURE_MANIFEST` | live acceptance 时显式指定 fixture manifest |

第三方补源凭证只在 backend 进程启动时从环境变量读取。`#/snapshots` 底部输入框只在当前浏览器标签页用 `sessionStorage` 暂存密钥草稿，刷新页面会保留，关闭标签页或点击清空会删除；它不会提交后端、不会落库，也不会改变运行中的 provider 状态。复制出的命令会为每个已输入 key 同时写入 Windows 用户环境和当前 PowerShell 进程，然后启动 QuickStart：`User` 作用域保证后续新 PowerShell/QuickStart 自动继承，`Process` 作用域保证当前这次重启立即可用。若已经启动了 QuickStart/backend，刷新浏览器页面不会让运行中的后端读取新值；必须重启 QuickStart/backend，随后用快照页重新检查 provider 状态。临时 `$env:ALPHAVANTAGE_API_KEY=...`、`$env:TIINGO_API_TOKEN=...`、`$env:MASSIVE_API_KEY=...`、`$env:KAGGLE_API_TOKEN=...`、`$env:NASDAQ_DATA_LINK_API_KEY=...`、`$env:FINNHUB_API_KEY=...` 只适合当前 PowerShell 进程；新开窗口不会继承，除非同时写入 Windows 用户环境，或把值放入 gitignored 的 `QuickStart-Grit.local.ps1`。

当快照页或人工命令写入 `KAGGLE_API_TOKEN`、`MASSIVE_API_KEY`、`NASDAQ_DATA_LINK_API_KEY` 等 provider key 后，必须让 backend 进程重新启动才会读取新环境。普通 `QuickStart-Grit.ps1` 会复用健康监听；配置变更应使用 `powershell -ExecutionPolicy Bypass -File .\QuickStart-Grit.ps1 -ForceRestart -RestartReason "snapshot provider credentials updated"`。该路径会先通过 runtime supervisor 记录 `restart --force`、reason 与 cooldown，再替换 repo-owned 的 `8000` backend 和 `4173` preview，不允许用 detached `cmd start` 或隐藏 PowerShell 作为常规生效路径。

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
- 左侧导航的 `因子` 组当前包含 `因子库` 与 `因子工厂`；`#/factors/factory` 合并原 `挖掘沙盒` 与 `检疫工作台`，旧 `#/factors/sandbox`、`#/factors/quarantine` 仍保持兼容并进入同一生产台。因子工厂首屏按 `B1 因子任务 -> B2 因子打分 -> B3 因子检疫 -> B4 发布准入` 展示，任务队列、打分候选、检疫历史和可发布名单必须读取 `GET /factor-factory/overview` 的运行时结果，不得用本地默认任务、静态候选或设计稿样例补位；每日自动化固定为 `GMT+8 14:00`，立即执行仍走 `POST /factor-factory/run-now` 且不改变自动化状态，工厂 run 完成挖掘后必须自动送检并执行检疫。未经算子的 L1 原始字段只看 PIT 准入审计即可进入发布准入；`Return(Close, n)`、`MA(...)`、`Std(...)` 等含算子候选必须归入 L2 Raw Signal，记录 WNZT 缺失和同族逻辑冗余观察，并继续执行预测、OOS、正交、压力、容量和数据完整性门禁。L2 改造候选必须记录 `Raw -> Winsorize -> Neutralize -> Z-Score -> Rank` 标准链，L3 组合候选必须记录父因子、组合手段、投资逻辑和相关性/正交性审计。长周期动量的 IR 必须按持有期重叠收益做 Newey-West/Bartlett 修正，63 日动量需记录相对 `Return(Close, 3)` 的残差 IC 作为纯净 IC 证据。`数据` 组必须同时保留 `PIT 清洗中心` 与 `数据快照`；本期数据页已升级为“快照分层治理 + PIT 门禁联动”，其中 `#/snapshots?tab=equity` 保留线上工作台骨架并引入 L1-L4 数据层级，`#/pit-data` 保留既有清洗链路并新增 L1-L4 PIT 准入与因子维度就绪矩阵。
- `GET /pit-data` 负责点时价格、样本池、异常清洗与未来函数门禁摘要，供因子诊断判断数据可用性；本期 additive 暴露 `pit_layer_readiness[]`、`factor_diagnostic_readiness[]`、`pit_quality_alerts[]` 与 `snapshot_layer_linkage[]`，用于 L1-L4 PIT 准入、因子维度就绪矩阵和 `snapshot -> PIT` 逻辑映射。
- `POST /pit-data/research-waiver`、`DELETE /pit-data/research-waiver/{waiver_id}`、`POST /pit-data/identity-overrides` 与 `POST /pit-data/identity-scraper/restart` 是 PIT 清洗中心当前写入面：分别负责研究态豁免、撤销豁免、人工身份映射和身份修复任务重启。它们只改变 PIT 诊断治理状态，不绕过 Full Ready、正式晋升或组合入库门禁。
- `GET /pit-data` 属于全路由首屏性能敏感 API：服务可以对读取结果使用短时缓存，但 PIT 写入接口必须主动失效缓存，避免豁免、身份覆盖或身份修复任务重启后的页面继续显示旧治理状态。
- `GET /factors`、`POST /factors`、`GET /factors/{factor_id}`、`POST /factors/{factor_id}/diagnostics`、`POST /factors/diagnostics/preview` 与 `GET /factors/{factor_id}/diagnostics/{run_id}/report` 是因子库固定 API 切片；`POST/GET /factor-mining/jobs`、`GET /factor-mining/jobs/{job_id}`、`POST /factor-mining/jobs/{job_id}/cancel` 是挖掘任务 API 切片，创建任务必须读取 `ds-price` 运行时价格快照并在摘要中暴露 `market_data_source=dataset_price_bars`、`synthetic_market_data=false` 与价格标的覆盖数量，缺少可用价格快照时返回中文阻断；`GET /factor-factory/overview`、`POST /factor-factory/automation/start`、`POST /factor-factory/automation/pause`、`POST /factor-factory/run-now` 与 `POST /factor-factory/runs/{id}/cancel` 是因子工厂固定 API 切片；`POST /factor-models/preview` 与 `POST /factor-models` 是多因子策略创建固定 API 切片。若请求或响应字段变化，`src/grit_backtest_platform/models.py`、`web/src/types.ts`、demo store 与 test API mock 必须同任务同步。本期因子治理合同保持 additive：`GET /factors` 追加前台诊断状态、批量诊断摘要、相关性簇摘要、阻断原因摘要、策略创建风险和 `lifecycle=online|offline|all` 查询；下线投影只读返回 `offline_reason`、`offline_at`、`offline_command` 与 `offline_detail`。`POST /factors/diagnostics/preview` 在单因子 preview 外支持 `{batch: true, factor_ids, diagnostic_mode, include}` 只读批量投影，不落库、不新增批量 UI。
- 因子详情页交付不得只用路由可达、标题/文案存在或 mock 单测作为通过标准。涉及批准稿的 `#/factors/:factorId` 必须用实际 canonical route（例如 `#/factors/s_mom_12m1m_rank`）建立 UI trace matrix，逐项核对紧凑标题区、十格证据热力图、换手率与衰减、分层收益、极端场景、风险提示、审计足迹和 PDF 报告入口，并保留截图或 DOM 结构证据；未完成这些证据时不能宣布页面与设计稿一致。
- 三期检疫与治理固定 API 覆盖 `POST /factor-quarantine/intake`、`GET /factor-quarantine/candidates`、候选详情、候选重跑、候选发布、因子工厂 API、`GET /factor-governance/overview`、`POST /factor-governance/actions/{action_id}/execute`、`GET /factor-governance/prune-recovery/preview`、`POST /factor-governance/prune-recovery/apply` 与 `POST /factor-models/suggestions`。`GET /factor-quarantine/candidates` 支持 `date`、`factor_name`、`result=ALL|PASS|WARN|FAIL` 查询历史检疫记录和拒绝原因。L1 原始字段以 PIT 准入审计作为发布门禁，收益阈值不参与阻断；含算子的 L2/L3 候选继续执行预测、OOS、正交、压力、容量和数据完整性门禁，其中 OOS/IS 最低比例为 `0.6`，极端压力回撤不得超过 SPY 的 `1.2x`，泄露/反穿越、`Rank IC > 0.8`、逻辑重复、Auto-Residual 失败、容量不可行仍是硬拒绝。治理概览只返回 `DEPRECATE`、`PRUNE` 与 `FACTOR_MODEL_SUGGESTION`，不把历史 `REVIEW/CROWDED/DECAYED` 诊断消息混入任务弹层；对没有正式诊断但批量只读预览已投影为 Grade D 噪声的线上因子，治理概览必须用同一 `FACTOR_EXPRESSION_PREVIEW` 证据生成 `DEPRECATE` 任务并在 `offline_detail.preview_only` 留痕；`PRUNE` 的同簇 MVP 比较必须使用同一批预览增强后的线上因子集合，但裁剪触发只能来自真实可复核证据，例如日期对齐后的诊断 `ic_series` Pearson 相关性，且样本重叠不少于 6 个观测、绝对相关性大于 `0.90`。因子库热力图、descriptor 启发式、表达式同族判断和 cluster top-N 只能作为 warning/审计线索，不能单独生成 `PRUNED` 写入；执行类治理任务必须带 `confirm=true`、指令、因子 id 和理由，服务端执行前重新计算实测证据；`DEPRECATE` 写入 `DEPRECATED`，`PRUNE` 只写入冗余因子的 `PRUNED` 并保留 MVP、证据来源、样本数和阈值。历史冗余裁剪恢复必须先预览审计证据，只有缺少高于阈值的实测/检疫冗余证据时才恢复为 `VERIFIED`，并写入 `factor_governance_events`。接口契约变更必须同步 `src/grit_backtest_platform/models.py`、`web/src/types.ts` 和对应 demo/mock 客户端。
- 因子库 UI 改造边界固定在 `#/factors` 内 additive 升级：表格上方新增 `线上因子 / 已下线因子` tab；表头固定为 `因子、来源、诊断状态、最近诊断、因子级别、下线原因、下线时间`；指标区第四张卡改为 `治理任务`，点击后懒加载完整治理动作弹层，`DEPRECATE/PRUNE` 打开二次确认后才写入下线状态。底部相关性热力图只能接收当前 tab 与当前筛选条件下的可见因子集合，tab 或筛选切换后必须清理不再可见的选中/比对状态。
- 因子详情 UI 改造边界固定为右侧足迹模块：`合规足迹` 改为 `审计足迹`，展示回溯窗口、检疫/诊断、发布和治理消息时间；其他指标、布局和操作不随本轮调整。
- 多因子创建页只接受治理任务传入的因子、方向和建议权重作为草稿预填，仍必须走预览、PIT 门禁和人工确认；不得直接覆盖生产策略版本，下线因子必须被 preview/create 拒绝或排除。
- 本轮后端切片覆盖 `tests/test_factor_factory_api.py`、`tests/test_factor_mining_api.py`、`tests/test_factor_quarantine_api.py` 与 `tests/test_factor_research_api.py` 的工厂自动化、B1-B4 read-model、F1 PIT-only 发布门禁、L2 标准算子链、L3 组合手段、fitness、Auto-Residual、检疫历史查询、治理执行、软下线和策略模型阻断；前端切片为 `web/src/factor.factory.test.tsx`、`web/src/factor.model-builder.test.tsx` 与 `web/src/app.routes.foundation.test.tsx` 的工厂路由兼容、自动化按钮、固定高度生产台、默认收起打分卡、一键送检、一键发布、日期/因子名/结果筛选、详情弹层、治理任务、二次确认、路由预填、热力图筛选和检疫工作台断言。固定验证仍使用 `scripts/codex-test-backend.ps1`、`scripts/codex-test-frontend.ps1`，契约变更后补 `-StrictGlobalTypes`。
- 默认五类常用因子固定使用 7 个 baseline 分层描述符 canonical ID：`s_val_ep_ltm_raw`、`s_val_bp_latest_raw`、`s_mom_12m1m_rank`、`s_qlty_roe_ltm_raw`、`s_qlty_fcfy_ttm_raw`、`s_vol_252d_rank` 与 `s_size_cur_log`。Factor Zoo 种子层可继续 additive 扩展 beta、投资、流动性、alpha blend 等自研描述符，但必须仍走本项目白名单表达式引擎，不能引入外部 factor 包或第三方 factor 代码。旧默认 ID 只作为 alias 兼容读取，不能出现在 `GET /factors` 列表展示中。`POST /factors` 必须携带 `source_category_metric_window_operator` 描述符，人工因子 ID 由 `m_<category>_<metric>_<window>_<operator>` 生成，重复 descriptor 返回 409。
- 基础面 PIT 数据平面由 `ds-fundamentals`、`dataset_fundamental_points` 与 `dataset_fundamental_coverage` 承载；基本面点位必须有 `available_at`，诊断只能读取 `available_at <= observation_date/as_of_date` 的观测，不能用财报期末日替代可得日。市值默认由复权收盘价乘 `shares_outstanding` 推导，供应商市值只保留差异；企业价值优先使用供应商 EV，缺失时回退为 `MarketCap + TotalDebt - CashAndEquivalents`。若 `ds-fundamentals` 缺失或字段不全，应显示明确的 `基础面 PIT 缺口` 并阻止诊断；若 rawF2 缺口已通过 `fundamental_gap_policy` 分类为 ETF/基金 `financial_logic=N/A` 或旧退市 `Thin_Data_Stock`，不得补造财务行，只能开放量价类因子并在 readiness 中展示 raw 覆盖率与逻辑覆盖率。
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
| 仅文档或 CHANGELOG 改动 | `scripts/codex-validate-fast.ps1`，只保留 git 与 diff check，不跑 backend/frontend |
| 仅后端改动 | `scripts/codex-validate-fast.ps1`，由脚本选择受影响 pytest；必要时再手工跑 `scripts/codex-test-backend.ps1` |
| 仅前端改动 | `scripts/codex-validate-fast.ps1`，阻塞执行 `tsc --noEmit` 与相关 Vitest；必要时再手工跑 `scripts/codex-test-frontend.ps1` |
| API/types/shared contract 改动 | `scripts/codex-validate-fast.ps1` 同时跑 backend 与 frontend 快速校验 |
| 跨栈且不依赖 fixture | 日常推云用 fast gate；大改、发版或合并前用 `scripts/codex-validate-full.ps1` |
| 依赖 fixture 的验收 | `scripts/codex-test-frontend.ps1 -IncludeLiveAcceptance`，会 reset fixture、启动 `8010` backend 并运行 live real-api smoke |
| 全量 Codex smoke | `scripts/codex-smoke.ps1`，作为 reset fixture + backend/frontend 固定入口的 orchestrator |

### 8.2 frontend 验证政策

- focused frontend tests 是默认阻塞门禁。
- 对已批准 HTML/SPEC 的 UI 任务，focused frontend tests 只是必要条件；最终验收还必须包含 `UI Artifact Trace Matrix`、桌面截图、DOM 文案/状态扫描和关键交互证明。
- 设计锁定页面的 `UI Artifact Trace Matrix` 必须在实现或最终 review 前定义可量化验收项，而不是交付后补报告。至少覆盖：模块高度、容器/表格宽度、右侧空白、文本或图表重叠、按钮折行、滚动条、sticky/浮层位置、弹层初始/打开/关闭状态、桌面与必要移动视口、截图文件名和允许偏离项。
- 表格、台账、热力图、抽屉、弹层等高密度 UI 必须补 DOM geometry 或等价 CSS contract：例如 `rightBlankAtDefault=0`、文本区域不压图表、操作按钮同一行、关键列完全可见。只验证表头、class 名、关键词、路由可达或单测绿色不得作为 UI 100% 对齐依据。
- 交付报告必须说明最终截图已经被实际打开检查；如果只保存截图但未查看，不得声明视觉验收通过。多代理实施中，Verification/Trace owner 对缺失截图、缺失几何断言或明显视觉偏差拥有否决权。
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
- `EODHD` is a paid optional delisted-aware provider. When `EODHD_API_TOKEN` or `EODHD_API_KEY` is configured, the runtime can try `SYMBOL.US` and `SYMBOL_old.US`, parse EOD OHLCV, and attach dividend/split evidence. It stays behind explicit credentials and must not hide quota or entitlement failures.
- Yahoo historical HTML is observation-only unless a parser extracts dated OHLCV rows. It is controlled by `GRIT_ENABLE_YAHOO_HTML_HISTORY` and should not turn a 404 chart endpoint into a synthetic READY row.
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
- PIT 修复队列统一按 `Tiingo -> FMP -> Nasdaq WIKI/Tables EOD/Stooq/Kaggle -> Finnhub/SEC/CIK -> EODHD -> Polygon` 展示下一步动作。`queue_sample[]` 可选返回 `next_provider`、`provider_priority`、`required_evidence` 与 `trust_blocker`；Nasdaq WIKI/Tables EOD/Stooq/Kaggle 是 price-only，Finnhub/SEC/CIK 是 identity-only 或辅助身份源，EODHD/Polygon 属于显式授权补数 lane，这些来源都不能在缺少证据时单独伪装 Full Ready。
- `zero_event_certificates[]` 是真实投影而不是空数组占位：候选应包含 symbol、CIK、成员退出日期、last filing evidence、price/action negative result、结论和不可恢复原因。它只说明“可进入证书确认流程”，不能把抓取失败或 SEC 停止申报直接写成破产/无事件结论。
- Credential handling is status-only. `KAGGLE_API_TOKEN`, `KAGGLE_USERNAME`/`KAGGLE_KEY`, `~/.kaggle/access_token`, `~/.kaggle/kaggle.json`, `MASSIVE_API_KEY`, `NASDAQ_DATA_LINK_API_KEY`, and `FINNHUB_API_KEY` may be detected as present/missing/invalid, but secret values must never be written to tracked repo files, logs, SQLite payloads, manifests, screenshots, or docs. Prefer Windows User environment variables for persistence; `QuickStart-Grit.local.ps1` is allowed only as a gitignored, operator-owned local override. Any token pasted in chat or logs must be revoked before use.
- The fixed PIT bulk cache directory is `.tmp/pit-bulk-cache` unless `GRIT_PIT_BULK_CACHE_DIR` is explicitly set. If a recovered or copied cache package sits under `.tmp/pit-bulk-cache/grit-pit-bulk-cache`, PIT readiness resolves that child as the active cache when the outer root has no direct artifacts, and the PIT overview cache signature watches the same resolved directory. Large Kaggle ZIP/CSV files, DuckDB catalogs, manifests, and partitioned Parquet output stay inside the project temp area rather than `C:\tmp`.
- Local operator entry points are `scripts/codex-pit-external-preflight.ps1`, `scripts/codex-pit-kaggle-search.ps1`, `scripts/codex-pit-kaggle-download.ps1`, `scripts/codex-pit-bulk-normalize.ps1`, and `scripts/codex-pit-diff-repair.ps1`.
- Kaggle search terms are fixed to `survivorship bias free`, `delisted`, `US stock market historical data delisted`, and `EOD historical data stocks`. The first preferred bulk source is `borismarjanovic/price-volume-data-for-all-us-stocks-etfs`; delisted archives must record license, schema, coverage years, hash, row count, and source URL before import.
- S&P 500 historical component Matrix data is normalized to `effective_date / symbol / raw_symbol / membership_status / source_revision_id`. Matrix decides historical membership only; Kaggle price data and Polygon action evidence must be attached separately.
- Bulk normalization must use DuckDB streaming over CSV/TXT files and partition output by `symbol_prefix + year`. Pandas all-file reads are not allowed for 20GB-class datasets.
- Diff repair reads the live `/pit-data.full_ready_repair_plan` price queue at execution time, falling back to `coverage_gap` price buckets when an older running API has not exposed `queue_price_symbols` yet. Do not hard-code prior observed counts. Only price-gap symbols may be imported into the main PIT price snapshot, share-class / historical ticker aliases such as hyphen, dot, underscore, and compact class suffixes must be resolved against the local catalog, and price conflicts over the configured threshold must be marked `price_conflict` instead of overwriting existing `ds-price` rows.
- When an existing `ds-price` snapshot already contains external price repair evidence such as `kaggle_huge_stock_market_dataset`, later repair runs must preserve that target universe and provider summary. Corporate-action-only or precision repair batches may add rows and remove newly covered symbols from the price missing list, but they must not widen the price denominator or erase the external-source provider record.
- Kaggle adjusted OHLCV may clear price blockers only. Without split/dividend evidence or an explicit zero-event certificate, it cannot clear corporate-action blockers. Polygon/Massive precision repair may use aggregates, inactive ticker/reference, splits, and dividends when `MASSIVE_API_KEY` is present.
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

- `POST /admin/snapshot-refresh-jobs` 继续是唯一的快照刷新入口，并新增 `fundamentals`、`sentiment`、`macro_derivatives` 三个公开 target。`fundamentals` 负责 SEC EDGAR 优先的基础面回补、FMP 缺口补丁，以及 SEC/FMP 均无结构化点位时的 FDIC BankFind 银行 Call Report 兜底；`sentiment` 负责 Alpha Vantage estimates / FINRA short-volume 证据流，并在限流、历史缺档或样本为空时落价格动量/成交量代理证据，`macro_derivatives` 负责 FRED 官方宏观利率与 Massive/Polygon IV 证据流。
- 二期 target 现在必须执行真实 provider 落库路径，而不是只回显已有 coverage：`fundamentals` 写入 SEC companyfacts、FMP statement points 或 FDIC BankFind bank financial points / coverage；SEC 路径支持历史 ticker CIK alias、SEC browse/company search 修复、10Y 窗口前 PIT 锚点和 IFRS `ifrs-full` taxonomy 映射。`sentiment` 写入 Alpha Vantage `EARNINGS_ESTIMATES`、FINRA short-volume signal points、`price_momentum_proxy` 与 `price_volume_proxy` 代理点 / coverage，`macro_derivatives` 写入 FRED 10 条 macro rate series、Massive/Polygon option-skew 或 CBOE delayed quote / benchmark proxy signal points / coverage。provider 没有凭据、限流、权限不足或返回缺少时间凭证时，只能进入 `latest_job.summary.refresh_stats.datasets[*].provider_summary`、provider-attempt/readiness evidence 与质量告警，不得创建缺少 `publish_date` / `available_at` 的正式 row。
- phase2 refresh payload 支持 `symbols`、`phase2_scope`、`phase2_max_symbols` 与 `phase2_cursor`。`phase2_scope=sp500_10y` 只从近十年 S&P 500 成分行选择补齐标的，`phase2_scope=l1_all` 从现有价格覆盖行选择，`phase2_scope=custom` 必须显式传入 symbols；coverage summary 必须按目标全集统计 `covered_symbol_count`、`target_symbol_count`、`coverage_pct`、`next_cursor` 与 `remaining_symbols`，后续批次合并落库，不得覆盖前序批次。
- `dataset_fundamental_points` 的 phase2 最小 superset 现在包含 `publish_date`、`statement_date`、`fiscal_year`、`fiscal_period`、`time_provenance`、`revenue`、`gross_profit`、`net_income`、`total_assets`、`current_assets`、`current_liabilities`、`long_term_debt`。L2 的正式 PIT 门槛从“有 `available_at`”升级为“同时有 `publish_date` 与 `available_at`”；不得再用 `period_end_date` 冒充 `publish_date`。FDIC BankFind 银行补源按 Call Report `REPDTE + 45d` 作为保守 `publish_date/available_at`，金额从 thousands USD 转为 USD 后落库。
- 缺少 `publish_date` 或 `available_at` 的 symbol 级基础面记录只能进入 readiness、coverage、provider-attempt 与质量告警，不能进入正式 PIT 点位读取，也不能把相关 gate 提升为 `READY`。本地 legacy seed 迁移只允许给 `source=local_seed_fundamentals` 的历史行打 `legacy_local_seed_available_at` provenance，其它历史缺口必须保留 `legacy_publish_date_missing`。
- companion market-data 新增 `dataset_signal_points` / `dataset_signal_coverage`，承载 `ds-analyst-consensus`、`ds-short-volume`、`ds-macro-rates`、`ds-option-skew` 四组 phase2 持久化数据面。首屏 API 只消费 bounded coverage、snapshot metadata 与 provider attempts；完整 raw evidence 保留在 `metadata_json` / `raw_json`，不得把整条 ledger 直接塞进 `GET /data-snapshots/overview` 或 `GET /pit-data` 首屏 payload。
- `GET /data-snapshots/overview` 顶层 shape 保持 additive 不变，但 `dataset_snapshots[]` 只在真实 snapshot row 已持久化且存在 coverage / landed-row evidence 时才纳入 `ds-fundamentals`、`ds-analyst-consensus`、`ds-short-volume`、`ds-macro-rates`、`ds-option-skew`。`data_layer_readiness[]`、`factor_dimension_readiness[]` 与 snapshot/PIT linkage 中引用的 `dataset_id` 必须指向真实 dataset row，或明确标记为 readiness-only provider evidence。
- `GET /pit-data` 顶层 shape 也保持不变，但 phase2 允许快照状态与 PIT 状态不同步：快照页表示源侧刷新健康，PIT 表示 replayable / diagnosable readiness。因此允许 L3 在快照为 `WARNING`、在 PIT 为 `DISABLED/OBSERVATION`，允许 L4 在快照为 `BLOCKED`、在 PIT 为 `CALIBRATING`；这些差异必须由 read-model 明确给出原因，不能留给前端 page-local 文案解释。
- L4 phase2 默认 provider 基线仍是 Massive/Polygon 精修链路，而不是 ThetaData。`MASSIVE_API_KEY` / `POLYGON_API_KEY` 不可用或权限失败时，option-skew 会降级读取 CBOE delayed quotes；无标的期权链时只允许写入带 `proxy_symbol=SPY` 的 benchmark proxy 点，不得伪装成原始 Polygon IV。
- 因子准入仍保留“最近 10 年 `factor_admission_coverage` 可推进、30 年 Full Ready 继续补证”的分层政策。phase2 不得因为新增 L3/L4 数据面而把 `Factor Factory -> D2 Quarantine -> Publish` 旁路成直接写正式因子库。
- phase2 最小回归应覆盖：`tests/test_backend_api.py` 的 snapshot overview/additional dataset evidence、真实二期 refresh 落 `ds-fundamentals` / `ds-analyst-consensus` / `ds-short-volume` / `ds-macro-rates` / `ds-option-skew` row、缺 `publish_date` 或 `available_at` 的 signal row 不进入 `dataset_snapshots[]`、`tests/test_factor_research_api.py` 的 fundamental publish gate 与 persisted consensus observation、`web/src/snapshots.page.test.tsx` 的刷新 target / live mapper，以及 `web/src/app.routes.foundation.test.tsx` 的 `#/snapshots` / `#/pit-data` 路由加载。固定验证仍使用 `scripts/codex-test-backend.ps1`、`scripts/codex-test-frontend.ps1` 与 `scripts/codex-test-frontend.ps1 -StrictGlobalTypes`。

## 2026-04-23 QuickStart preview listener note

- QuickStart 清理 `4173` 旧监听时，绝对 `web/preview-server.mjs` 命令和 `node ./preview-server.mjs --watch --rebuild-on-start` 相对命令都属于 repo-local preview，可作为 stale listener 重启目标，不应被判为 `non-repo frontend process`。
- `web/src/quickstart.preview.test.ts` 已纳入 `scripts/codex-test-frontend.ps1` 固定前端切片，用来守住 preview listener 识别、QuickStart 显式 build 后不重复 startup rebuild、backend readiness 复核、以及 preview watch 切换必须保留 active bundle 且缺失 asset 必须返回 404 的首载安全逻辑。

### Localhost delivery gate

当用户给出 `http://127.0.0.1:4173/...` 或其它本地 live URL 作为验收入口时，交付前必须验证当前正在监听的本地进程，而不能只引用 mocked tests 或 fixed slice。最低要求：

- 先运行 `powershell -ExecutionPolicy Bypass -File .\scripts\codex-grit-runtime-preflight.ps1 -Json`。只有 `quickstartOverall=ready` 且 `decision=reuse` 时才直接进入浏览器/API live check；若返回 `rebuild-frontend-and-restart-preview`、`restart-*-via-supervisor`、`blocked-*` 或 `probe-degraded`，按 `nextAction` 处理后重新 preflight。
- 确认 `8000` 的 `uvicorn` 和 `4173` 的 preview 进程是在最终代码之后启动的；如果不是，先停止 repo-local 旧监听并重启。
- 重新执行 `npm run build`，避免 `preview-server.mjs` 因 dist promotion 失败继续服务旧 bundle。
- 若前端构建或预览曾临时指定 `VITE_API_BASE_URL`，最终交付前必须恢复并验证 `http://127.0.0.1:8000`。`#/factors` 等页面出现 `Failed to fetch`、列表计数归零或空表时，先检查 `8000` 后端监听和构建包 API 指向，再判断页面代码问题。
- 核对 `GRIT_BACKTEST_DB` 指向的主库以及同名 `_market_data.sqlite3` companion 不是新建空库；`/workspace/overview` 应先用 API 证明策略/回测历史仍在，再打开页面。
- 重新验证 hash SPA 页面时必须强制 document reload，例如 `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`；只从 `#/workspace` 跳到 `#/snapshots` 可能继续运行旧 bundle。
- 对用户提到的页面跑一次真实浏览器或等价 live check，并记录 `GET /compositions`、`GET /leg-inventory`、`GET /data-snapshots/overview` 的 HTTP 结果。
- 如果验收包含债券 eligible source，确认 `bond_fixed_income_snapshots` 至少有一条 `READY` runtime row；fallback/proxy curve 只能作为只读展示，不能算作真实入库来源。
