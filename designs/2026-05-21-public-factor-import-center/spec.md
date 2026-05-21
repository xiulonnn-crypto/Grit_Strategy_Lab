# 公开美股因子入库中心设计稿

## 交付物

- 设计包目录: `C:\Fin\Grit_Strategy_Lab\designs\2026-05-21-public-factor-import-center`
- Canonical HTML: `C:\Fin\Grit_Strategy_Lab\designs\2026-05-21-public-factor-import-center\spec.html`
- Canonical PNG: `C:\Fin\Grit_Strategy_Lab\designs\2026-05-21-public-factor-import-center\spec.png`
- Mobile baseline PNG: `C:\Fin\Grit_Strategy_Lab\designs\2026-05-21-public-factor-import-center\.assets\spec-mobile.png`
- New precheck modal PNG: `C:\Fin\Grit_Strategy_Lab\designs\2026-05-21-public-factor-import-center\.assets\new-precheck-modal.png`
- Import local file modal PNG: `C:\Fin\Grit_Strategy_Lab\designs\2026-05-21-public-factor-import-center\.assets\import-local-file-modal.png`
- New precheck modal mobile PNG: `C:\Fin\Grit_Strategy_Lab\designs\2026-05-21-public-factor-import-center\.assets\new-precheck-modal-mobile.png`
- Import local file modal mobile PNG: `C:\Fin\Grit_Strategy_Lab\designs\2026-05-21-public-factor-import-center\.assets\import-local-file-modal-mobile.png`
- 页面 key: `public-factor-import-center`
- 建议路由: `http://127.0.0.1:4173/#/factors/imports`
- 导航归属: `因子管理 -> 公开因子入库`
- 基准视口: `1440 x 1100`
- 移动基准视口: `390 x 980`
- 设计日期: `2026-05-21`

## 页面目标

公开美股因子入库中心用于把成熟公开因子源转成 GSL 可审计、可复核、可进入 D2 治理流程的标准模板。页面不提供一键发布正式因子的能力，公开源只进入候选模板、manifest 和复核交接，不直接写入正式因子库。

目标用户:
- 量化研究员: 快速登记 French、AQR 等公开因子源，并生成可复用的 GSL 字段映射。
- 因子治理负责人: 确认来源、许可、时间戳、hash 和模板用途，防止公开拥挤因子直接变成生产 Alpha。
- 数据运营人员: 执行导入预检、查看 parser 结果、定位缺列或许可风险。

## 视觉方向

采用 GSL 现有白底治理工作台风格，强调密集但清晰的信息扫描:
- 背景使用 `#F0F2F5`，主面板使用白底和轻边框。
- 主色使用 `#1F877B`，用于当前步骤、主按钮、通过状态。
- 蓝色 `#4C78C7` 用于基准/参考源，如 Fama-French 和 MSCI。
- 琥珀色 `#B86813` 用于许可确认、人工复核和不能自动入库的源。
- 页面不使用营销式 hero，不使用大面积插画，不使用渐变装饰。

## 信息架构

首屏分为 6 个稳定区域:

1. 页面标题与动作栏
   - 标题: `公开因子入库中心`
   - 副标题: `先准备来源，再发起预检；通过语义映射后送入复核。`
   - 入口卡: `入口 A · 公开源预检`、`入口 B · 本地文件导入`
   - 主按钮: `新建预检`
   - 次按钮: `导入本地文件`
   - 不渲染顶部面包屑与时间状态条，首屏从标题卡直接开始。
   - HTML 预览中两个按钮必须可点击打开对应弹层。

2. 健康摘要条
   - `可自动导入`
   - `参考源`
   - `待复核`
   - `最近 manifest`

3. 公开源目录
   - 展示 French-Data Library、AQR Data Library、MSCI FaCS、Portfolio Visualizer。
   - 目录项必须露出来源类型、频率、访问方式、默认用途、许可状态。

4. 入库流程
   - `来源准备 -> 获取 / 上传 -> 新建预检 -> 语义映射 -> 送入复核`
   - 公开源可以从 `新建预检` 发起自动获取；本地文件必须先完成模板下载与上传。
   - 当前状态使用主色，风险状态使用琥珀色。
   - 桌面端必须横向平铺为五步步骤条，不能回退为纵向清单。

5. 候选数据集表
   - 展示可导入或可参考的数据集，如 `Fama-French 5 Factors Daily`、`AQR QMJ Daily`。
   - 列包括来源、频率、时间范围、字段数、hash、状态、动作。

6. 语义映射工作台与 manifest 审计抽屉
   - 语义映射必须横向平铺为 SMB、HML、RMW、CMA 卡片泳道。
   - 语义映射工作台必须与候选数据集模块同列同宽，上下边缘对齐，模块间距为 `14px`。
   - 每张映射卡展示外部列到 GSL 因子族、层级、治理用途的映射。
   - manifest 审计展示导入作业、文件 hash、parser 版本、artifact 路径、不可直接发布提示。

## 可见文案

状态标签:
- `可自动导入`: 有公开下载或本地上传后可解析。
- `参考源`: 只能作为参数或暴露参考，不进入自动下载。
- `需许可确认`: 需要人工确认许可、版权或再分发边界。
- `候选模板`: 已转成候选模板，但未进入检疫。
- `送入复核`: 可送入 D2 检疫或人工复核。

动作按钮:
- `新建预检`
- `导入本地文件`
- `开始预检`
- `保存草稿`
- `保存上传草稿`
- `解析并生成 manifest`
- `下载 source_template.xlsx`
- `下载 manifest_template.xlsx`
- `下载 mapping_template.xlsx`
- `生成候选模板`
- `查看 manifest`
- `送入复核`
- `重新解析`

禁止出现在主舞台的词:
- `NaN`
- `raw enum`
- `undefined`
- `mock`
- 未翻译的后端状态枚举

允许保留英文的真实标识:
- `Fama-French`
- `AQR`
- `MSCI FaCS`
- `Portfolio Visualizer`
- `SMB`
- `HML`
- `RMW`
- `CMA`
- `QMJ`
- `TSMOM`

## 组件清单

| 区域 | 组件 | 状态 | 实现备注 |
| --- | --- | --- | --- |
| 标题栏 | Page header + action group | normal, busy | 主按钮触发新建预检抽屉或向导 |
| 新建预检弹层 | Modal dialog | open, saving, submitting, validation error | 选择公开源、数据集、频率、用途、解析方式和入库边界 |
| 导入本地文件弹层 | Modal dialog | open, uploading, parsing, validation error | 提供三类标准模板下载、上传区和校验清单 |
| 摘要条 | KPI strip | normal, stale, warning | 数值来自 source registry 与 import job projection |
| 源目录 | Source list | selected, warning, disabled | 选中源驱动右侧流程与候选表过滤 |
| 流程状态 | Stepper | idle, running, warning, complete | 不显示技术枚举，使用中文状态 |
| 候选表 | Dataset table | loading, empty, error, row selected | 大表只显示 preview，完整 manifest 进入抽屉 |
| 映射台 | Mapping grid | draft, invalid, reviewed | 每行显示外部字段、GSL 族、层级、用途、直接发布限制 |
| 审计抽屉 | Manifest rail | closed, open, copied | 固定右侧 rail，不遮挡核心表格 |

## 数据契约建议

本设计稿对接先前产品方案的契约骨架:

```ts
type ApiExternalFactorSource = {
  source_id: string;
  name: string;
  source_type: 'academic' | 'institutional' | 'reference_tool';
  access_policy: 'public_free' | 'manual_reference' | 'license_required';
  market: 'US_EQUITY';
  frequency: 'daily' | 'monthly' | 'mixed';
  default_usage: 'benchmark_template' | 'style_reference' | 'parameter_reference';
  can_auto_download: boolean;
  can_enter_factor_library_directly: false;
};

type ApiExternalFactorImportManifest = {
  job_id: string;
  source_id: string;
  dataset_key: string;
  as_of_date: string;
  parser_version: string;
  raw_file_hash: string;
  row_count: number;
  column_count: number;
  artifact_paths: {
    raw: string;
    normalized: string;
    mapping_template: string;
  };
  direct_publish_allowed: false;
};
```

后续实现仍需保持 `sandbox -> quarantine -> publish` 边界。公开因子模板进入 D2 前必须先有 manifest、来源许可和字段映射证据。

## 弹层状态

### 新建预检

触发入口: 页面主按钮 `新建预检`。

可见结构:
- 弹层标题: `新建预检`
- 字段: `公开源`、`数据集`、`频率`、`默认用途`、`解析方式`、`入库边界`、`预检备注`
- 作业边界: `生成候选模板`、`送入人工复核`、`暂存观察`
- 预检输出: 导入作业编号、source manifest、标准化字段映射、hash、parser、artifact 路径、D2 检疫边界
- 底部动作: `取消`、`保存草稿`、`开始预检`

默认选择:
- 公开源: `French-Data Library`
- 数据集: `Fama-French 5 Factors Daily`
- 解析方式: `公开下载后解析`
- 入库边界: `候选模板，不直接发布`

### 导入本地文件

触发入口: 页面次按钮 `导入本地文件`。

可见结构:
- 弹层标题: `导入本地文件`
- 标准模板: `公开源登记模板`、`数据集 manifest 模板`、`语义映射模板`
- 模板下载按钮: `下载 source_template.xlsx`、`下载 manifest_template.xlsx`、`下载 mapping_template.xlsx`
- 上传区: `拖入 CSV 或 XLSX 文件`
- 上传校验: 日期列、因子值列、来源 URL、访问方式、许可确认、禁止直接发布、先生成 manifest 再进入语义映射
- 底部动作: `取消`、`保存上传草稿`、`解析并生成 manifest`

模板字段建议:
- `source_template.xlsx`: `source_id`、`name`、`source_type`、`access_policy`、`source_url`、`frequency`、`download_mode`、`default_usage`
- `manifest_template.xlsx`: `dataset_key`、`source_id`、`as_of_date`、`frequency`、`columns`、`row_count`、`file_hash`、`parser_version`
- `mapping_template.xlsx`: `external_column`、`gsl_family`、`gsl_layer`、`usage`、`direct_publish_allowed`、`review_required`

## 响应式规则

- `>= 1280px`: 使用三列工作台，左源目录 `330px`；入库流程横跨中列与右 rail 上方；候选数据集与语义映射位于同一中列 vertical stack；manifest rail 位于右列，且不影响中列两个模块的上下间距。
- `1024px - 1279px`: 右侧 manifest rail 收成抽屉按钮，中间表格保持横向滚动容器。
- `768px - 1023px`: 源目录与主工作区上下堆叠，流程步骤条与语义映射卡片保持横向平铺，必要时在面板内横向滚动。
- `< 768px`: 摘要条单列，源目录改为卡片列表；流程步骤条与语义映射卡片保持面板内横向滚动；候选表保留核心字段；manifest 使用底部 sheet。

## Trace Matrix 骨架

| 验收项 | HTML 区域 | 实现目标 | 验证方式 | 当前状态 |
| --- | --- | --- | --- | --- |
| 页面标题与动作栏完整 | `.import-page-header` | 路由标题、两枚动作按钮、中文副标题、两张入口卡 | DOM 文案 + 桌面截图 | PASS |
| 标题栏按钮打开弹层 | `[data-open-modal]` | 点击 `新建预检` 打开 `.modal-precheck`，点击 `导入本地文件` 打开 `.modal-import` | Playwright click | PASS |
| 新建预检弹层完整 | `.modal-precheck` | 表单、作业边界、预检输出、底部三按钮完整 | DOM 文案 + desktop/mobile 弹层截图 | PASS |
| 导入本地文件弹层完整 | `.modal-import` | 三个模板下载卡、上传区、上传校验、底部三按钮完整 | DOM 文案 + desktop/mobile 弹层截图 | PASS |
| 顶部状态条已移除 | 页面首屏 | 不出现 `因子管理 / 公开因子入库` 面包屑和 `北京时间 2026-05-21 16:20` | DOM 文案扫描 + 桌面截图 | PASS |
| 摘要条不换行溢出 | `.import-kpi-strip` | 4 个 KPI 在 1440 与 390 视口均可读 | DOM geometry + mobile 截图 | PASS |
| 源目录选中态明显 | `.source-list` | French 行选中，AQR 与参考源有明确许可/参考提示 | DOM 文案 + 截图 | PASS |
| 入库流程边界明确 | `.flow-steps` | 五步横向平铺，顺序为来源准备、获取/上传、新建预检、语义映射、送入复核，不出现正式发布按钮 | 文案扫描 + 几何检查 | PASS |
| 候选表仅展示 preview | `.dataset-table` | 表格展示候选摘要，完整证据进入 manifest rail | DOM 文案 + 抽屉状态 | PASS |
| 候选表与语义映射同宽对齐 | `.dataset-panel` + `.mapping-panel` | 两个模块 `x` 与 `width` 一致，垂直间距 `14px` | DOM geometry | PASS |
| 语义映射显示不可直接发布 | `.mapping-workbench` | SMB/HML/RMW/CMA 横向卡片平铺，每卡都有 GSL 族、层级、用途和限制 | 文案扫描 + 几何检查 | PASS |
| manifest 审计证据可见 | `.manifest-rail` | job id、hash、parser、artifact 路径完整 | DOM 文案 + 截图 | PASS |
| 移动端无重叠 | `@media max-width: 767px` | 无横向页面溢出，表格转为摘要 | screenshot + scrollWidth 检查 | PASS |

当前设计稿已重新生成桌面、移动端和两个弹层状态截图。`1440px` 视口下无横向页面溢出；流程标题为 `来源准备 -> 获取 / 上传 -> 新建预检 -> 语义映射 -> 送入复核`，旧流程词未出现在主舞台。候选数据集与语义映射均为 `x=602`、`width=476`，垂直间距 `14px`。`390px` 视口下无横向页面溢出；候选数据集与语义映射均为 `x=16`、`width=358`；流程步骤条与映射卡片为面板内横向滚动。两个弹层在桌面与移动端均可打开。

## 实现触点

建议实现文件:
- `web/src/pages/public-factor-import-center-page.tsx`
- `web/src/pages/public-factor-import-center-page.css`
- `web/src/types.ts`
- `src/grit_backtest_platform/models.py`
- `src/grit_backtest_platform/api.py`

建议新增 API:
- `GET /factor-sources/registry`
- `POST /factor-sources/import-jobs`
- `GET /factor-sources/import-jobs/{job_id}`

建议新增存储:
- `external_factor_import_jobs`
- `external_factor_import_manifests`

## 开放问题

- `Portfolio Visualizer` 是否只作为人工参数参考，不记录下载作业。
- `MSCI FaCS` 是否只保留行业暴露上限参考，不产生因子模板。
- AQR 数据集许可边界是否允许自动下载，还是只允许手动上传后解析。
- Fama-French 日频与月频是否拆成两个 dataset key，建议拆分，避免频率混用。

## 不更新 DESIGN.md

本次是页面级设计稿，没有引入新的系统级视觉规则。`DESIGN.md` 暂不更新，等页面方向确认后再判断是否沉淀为可复用模式。
