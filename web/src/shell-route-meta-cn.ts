import type { AppRoute } from './lib/appRouteContext';

export type ShellNavKey =
  | 'composition-dashboard'
  | 'composition-list'
  | 'composition-backtest-runs'
  | 'composition-lab'
  | 'leg-inventory'
  | 'workspace'
  | 'creation'
  | 'runs'
  | 'optimization'
  | 'factor-library'
  | 'factor-sandbox'
  | 'factor-quarantine'
  | 'pit-data'
  | 'snapshots';

export type ShellNavGroupKey = 'compose' | 'strategy' | 'factor' | 'data';

export type ShellNavItem = {
  key: ShellNavKey;
  href: string;
  label: string;
  groupKey: ShellNavGroupKey;
};

export type ShellNavGroup = {
  key: ShellNavGroupKey;
  label: string;
  items: ShellNavItem[];
};

export type AppRouteMeta = {
  navKey: ShellNavKey;
  eyebrow: string;
  title: string;
  description: string;
  showPageHeading?: boolean;
};

const TEXT = {
  compose: '组合',
  composeDashboard: '组合仪表板',
  composeDashboardTitle: '组合仪表板',
  composeDashboardDesc:
    '以正式组合、最近维护与待处理动作作为首页叙事，用于组合层的当日决策。',
  compositionList: '组合列表',
  compositionListTitle: '组合列表',
  compositionListDesc:
    '集中复核组合状态、证据质量与待处理事项。',
  compositionBacktestRuns: '组合回测',
  compositionBacktestRunsTitle: '组合回测列表',
  compositionBacktestRunsDesc:
    '跨组合追踪稳定性裁决、压力窗口和订单证据。',
  compositionLab: '组合实验室',
  compositionLabTitle: '组合实验室',
  compositionLabDesc:
    '集中查看配置实验作业、候选方案和晋升审查。',
  legInventory: '资产库',
  legInventoryTitle: '策略资产库',
  legInventoryDesc:
    '统一管理策略腿、资产腿与现金腿的定义、版本与引用关系，作为正式组合的来源底座。',
  strategy: '策略',
  workspace: '策略工作台',
  workspaceTitle: '策略工作台',
  workspaceDesc:
    '总览策略规模、活跃回测与优化进度，直达最新任务。',
  compositionWorkbenchTitle: '组合工作台',
  compositionWorkbenchDesc:
    '在三栏结构中完成来源装配、权重复核与组合成立性判断。',
  compositionDetailTitle: '组合详情',
  compositionDetailDesc:
    '聚合收益流、风险归因、相关性矩阵与来源冻结证据。',
  compositionBacktestTitle: '组合回测',
  compositionBacktestDesc:
    '验证组合在不同周期、再平衡规则和数据质量门禁下的稳定性。',
  compositionAllocationTitle: '组合实验室',
  compositionAllocationDesc:
    '围绕资产配置意图生成候选权重，并用有效前沿和迁移成本复核晋升价值。',
  creation: '策略库',
  creationEyebrow: '策略管理',
  creationTemplateTitle: '策略库',
  creationTemplateDesc:
    '集中管理已创建策略、参数版本、长期回测表现与后续研究动作。',
  assetAllocationTitle: '资产配置策略配置',
  assetAllocationDesc: '标的、权重、再平衡与成本参数配置。',
  creationSessionTitle: '创建会话',
  creationSessionDesc:
    '由对话驱动确认稿，再进入策略落地与回测提交。',
  strategyDetailEyebrow: '策略详情',
  strategyDetailTitle: '策略详情',
  strategyDetailDesc:
    '查看策略概况、当前参数版本与下一步可执行操作。',
  backtestEyebrow: '真实执行',
  backtestTitle: '真实回测提交',
  backtestDesc:
    '确认回测区间、参数版本和快照状态，再生成正式回测。',
  runs: '回测列表',
  runsEyebrow: '回测数据',
  runsTitle: '回测历史',
  runsDesc: '用于在结果和详情之间切换的列表视图。',
  runEyebrow: '运行详情',
  runTitle: '诊断视图',
  runDesc:
    '风险摘要、主曲线、交易明细与证据轨迹都会在这里展开。',
  snapshots: '数据快照',
  snapshotsTitle: '数据快照',
  snapshotsDesc:
    '集中查看数据集与股票池快照状态，并提供刷新与修复入口。',
  factor: '因子',
  factorLibrary: '因子库',
  factorLibraryTitle: '因子库',
  factorLibraryDesc:
    '集中检索机构 Alpha 资产、默认常用因子、最近诊断和 PIT 门禁状态。',
  factorDetailTitle: '因子诊断',
  factorDetailDesc:
    '查看因子逻辑、IC/IR 诊断、换手衰减、极端场景与合规足迹。',
  factorEditorTitle: '因子编辑器',
  factorEditorDesc:
    '用白名单 DSL 编写公式，并在正式诊断前完成 5 年样本内 IC 预览。',
  factorSandbox: '挖掘沙盒',
  factorQuarantine: '隔离检疫区',
  data: '数据',
  pitData: 'PIT 清洗中心',
  pitDataTitle: 'PIT 清洗中心',
  pitDataDesc:
    '检查复权价格、点时样本池和异常清洗门禁，确保因子诊断不引入未来函数。',
  optimizationEyebrow: '优化实验',
  optimizationTitle: '优化实验室',
  optimizationDesc:
    '保留现有候选版本管理行为，并接入统一的中文应用壳。',
} as const;

export const SHELL_NAV_GROUPS: ShellNavGroup[] = [
  {
    key: 'compose',
    label: TEXT.compose,
    items: [
      {
        key: 'composition-dashboard',
        href: '#/compositions',
        label: TEXT.composeDashboard,
        groupKey: 'compose',
      },
      {
        key: 'composition-list',
        href: '#/compositions/list',
        label: TEXT.compositionList,
        groupKey: 'compose',
      },
      {
        key: 'composition-backtest-runs',
        href: '#/compositions/backtest-runs',
        label: TEXT.compositionBacktestRuns,
        groupKey: 'compose',
      },
      {
        key: 'composition-lab',
        href: '#/compositions/lab',
        label: TEXT.compositionLab,
        groupKey: 'compose',
      },
      {
        key: 'leg-inventory',
        href: '#/legs',
        label: TEXT.legInventory,
        groupKey: 'compose',
      },
    ],
  },
  {
    key: 'strategy',
    label: TEXT.strategy,
    items: [
      { key: 'workspace', href: '#/workspace', label: TEXT.workspace, groupKey: 'strategy' },
      { key: 'creation', href: '#/strategies', label: TEXT.creation, groupKey: 'strategy' },
      { key: 'runs', href: '#/runs', label: TEXT.runs, groupKey: 'strategy' },
      {
        key: 'optimization',
        href: '#/optimization-jobs',
        label: TEXT.optimizationTitle,
        groupKey: 'strategy',
      },
    ],
  },
  {
    key: 'factor',
    label: TEXT.factor,
    items: [
      { key: 'factor-library', href: '#/factors', label: TEXT.factorLibrary, groupKey: 'factor' },
      { key: 'factor-sandbox', href: '#/factors/sandbox', label: TEXT.factorSandbox, groupKey: 'factor' },
      { key: 'factor-quarantine', href: '#/factors/quarantine', label: TEXT.factorQuarantine, groupKey: 'factor' },
    ],
  },
  {
    key: 'data',
    label: TEXT.data,
    items: [
      { key: 'pit-data', href: '#/pit-data', label: TEXT.pitData, groupKey: 'data' },
      { key: 'snapshots', href: '#/snapshots', label: TEXT.snapshots, groupKey: 'data' },
    ],
  },
];

export const SHELL_NAV_ITEMS: ShellNavItem[] = SHELL_NAV_GROUPS.flatMap((group) => group.items);

export function getRouteMeta(route: AppRoute): AppRouteMeta {
  switch (route.kind) {
    case 'workspace':
      return {
        navKey: 'workspace',
        eyebrow: TEXT.strategy,
        title: TEXT.workspaceTitle,
        description: TEXT.workspaceDesc,
        showPageHeading: false,
      };
    case 'composition-dashboard':
      return {
        navKey: 'composition-dashboard',
        eyebrow: TEXT.compose,
        title: TEXT.composeDashboardTitle,
        description: TEXT.composeDashboardDesc,
        showPageHeading: false,
      };
    case 'composition-list':
      return {
        navKey: 'composition-list',
        eyebrow: TEXT.compose,
        title: TEXT.compositionListTitle,
        description: TEXT.compositionListDesc,
        showPageHeading: false,
      };
    case 'composition-backtest-runs':
      return {
        navKey: 'composition-backtest-runs',
        eyebrow: TEXT.compose,
        title: TEXT.compositionBacktestRunsTitle,
        description: TEXT.compositionBacktestRunsDesc,
        showPageHeading: false,
      };
    case 'composition-lab':
      return {
        navKey: 'composition-lab',
        eyebrow: TEXT.compose,
        title: TEXT.compositionLabTitle,
        description: TEXT.compositionLabDesc,
        showPageHeading: false,
      };
    case 'leg-inventory':
      return {
        navKey: 'leg-inventory',
        eyebrow: TEXT.compose,
        title: TEXT.legInventoryTitle,
        description: TEXT.legInventoryDesc,
        showPageHeading: false,
      };
    case 'composition-workbench':
      return {
        navKey: 'composition-list',
        eyebrow: TEXT.compose,
        title: TEXT.compositionWorkbenchTitle,
        description: TEXT.compositionWorkbenchDesc,
        showPageHeading: false,
      };
    case 'composition-detail':
      return {
        navKey: 'composition-dashboard',
        eyebrow: TEXT.compose,
        title: TEXT.compositionDetailTitle,
        description: TEXT.compositionDetailDesc,
        showPageHeading: false,
      };
    case 'composition-backtest-new':
    case 'composition-backtest-result':
      return {
        navKey: 'composition-dashboard',
        eyebrow: TEXT.compose,
        title: TEXT.compositionBacktestTitle,
        description: TEXT.compositionBacktestDesc,
        showPageHeading: false,
      };
    case 'composition-allocation-config':
    case 'composition-allocation-result':
      return {
        navKey: 'composition-dashboard',
        eyebrow: TEXT.compose,
        title: TEXT.compositionAllocationTitle,
        description: TEXT.compositionAllocationDesc,
        showPageHeading: false,
      };
    case 'creation-template':
      return {
        navKey: 'creation',
        eyebrow: TEXT.creationEyebrow,
        title: TEXT.creationTemplateTitle,
        description: TEXT.creationTemplateDesc,
        showPageHeading: false,
      };
    case 'creation-session':
      return {
        navKey: 'creation',
        eyebrow: TEXT.creationEyebrow,
        title: TEXT.creationSessionTitle,
        description: TEXT.creationSessionDesc,
        showPageHeading: false,
      };
    case 'asset-allocation-config':
      return {
        navKey: 'creation',
        eyebrow: TEXT.creationEyebrow,
        title: TEXT.assetAllocationTitle,
        description: TEXT.assetAllocationDesc,
        showPageHeading: false,
      };
    case 'strategy-detail':
      return {
        navKey: 'workspace',
        eyebrow: TEXT.strategyDetailEyebrow,
        title: TEXT.strategyDetailTitle,
        description: TEXT.strategyDetailDesc,
        showPageHeading: false,
      };
    case 'backtest':
      return {
        navKey: 'workspace',
        eyebrow: TEXT.backtestEyebrow,
        title: TEXT.backtestTitle,
        description: TEXT.backtestDesc,
        showPageHeading: false,
      };
    case 'runs-index':
      return {
        navKey: 'runs',
        eyebrow: TEXT.runsEyebrow,
        title: TEXT.runsTitle,
        description: TEXT.runsDesc,
        showPageHeading: false,
      };
    case 'run':
      return {
        navKey: 'runs',
        eyebrow: TEXT.runEyebrow,
        title: TEXT.runTitle,
        description: TEXT.runDesc,
        showPageHeading: false,
      };
    case 'factor-library':
      return {
        navKey: 'factor-library',
        eyebrow: TEXT.factor,
        title: TEXT.factorLibraryTitle,
        description: TEXT.factorLibraryDesc,
        showPageHeading: false,
      };
    case 'factor-detail':
      return {
        navKey: 'factor-library',
        eyebrow: TEXT.factor,
        title: TEXT.factorDetailTitle,
        description: TEXT.factorDetailDesc,
        showPageHeading: false,
      };
    case 'factor-editor':
      return {
        navKey: 'factor-library',
        eyebrow: TEXT.factor,
        title: TEXT.factorEditorTitle,
        description: TEXT.factorEditorDesc,
        showPageHeading: false,
      };
    case 'factor-sandbox':
      return {
        navKey: 'factor-sandbox',
        eyebrow: TEXT.factor,
        title: TEXT.factorSandbox,
        description: '自动挖掘能力将在第二期接入，本期先保留导航入口。',
        showPageHeading: false,
      };
    case 'factor-quarantine':
      return {
        navKey: 'factor-quarantine',
        eyebrow: TEXT.factor,
        title: TEXT.factorQuarantine,
        description: '自动挖掘因子的去重、样本外和相关性门禁将在第三期接入。',
        showPageHeading: false,
      };
    case 'pit-data':
      return {
        navKey: 'pit-data',
        eyebrow: TEXT.data,
        title: TEXT.pitDataTitle,
        description: TEXT.pitDataDesc,
        showPageHeading: false,
      };
    case 'snapshots':
      return {
        navKey: 'snapshots',
        eyebrow: TEXT.snapshots,
        title: TEXT.snapshotsTitle,
        description: TEXT.snapshotsDesc,
        showPageHeading: false,
      };
    case 'optimization-index':
    case 'optimization-select':
    case 'optimization-config':
    case 'optimization':
      return {
        navKey: 'optimization',
        eyebrow: TEXT.optimizationEyebrow,
        title: TEXT.optimizationTitle,
        description: TEXT.optimizationDesc,
        showPageHeading: false,
      };
  }
}
