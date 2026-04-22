import type { AppRoute } from './lib/appRouteContext';

export type ShellNavKey =
  | 'composition-dashboard'
  | 'leg-inventory'
  | 'workspace'
  | 'creation'
  | 'runs'
  | 'optimization'
  | 'snapshots';

export type ShellNavGroupKey = 'compose' | 'strategy';

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
  legInventory: '资产库',
  legInventoryTitle: '策略资产库',
  legInventoryDesc:
    '统一管理策略腿、资产腿与现金腿的定义、版本与引用关系，作为正式组合的来源底座。',
  strategy: '策略',
  workspace: '策略工作台',
  workspaceTitle: '策略工作台',
  workspaceDesc:
    '查看策略看板、最近回测和可直接进入主链路的恢复入口。',
  compositionWorkbenchTitle: '组合工作台',
  compositionWorkbenchDesc:
    '在三栏结构中完成来源装配、权重复核与组合成立性判断。',
  compositionDetailTitle: '组合详情',
  compositionDetailDesc:
    '聚合收益流、风险归因、相关性矩阵与来源冻结证据。',
  creation: '新建策略',
  creationEyebrow: '策略创建',
  creationTemplateTitle: '选择模板',
  creationTemplateDesc:
    '先选择策略类型，再进入对话和动态表单协同编辑。',
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
      { key: 'creation', href: '#/creation/new', label: TEXT.creation, groupKey: 'strategy' },
      { key: 'runs', href: '#/runs', label: TEXT.runs, groupKey: 'strategy' },
      {
        key: 'optimization',
        href: '#/optimization-jobs',
        label: TEXT.optimizationTitle,
        groupKey: 'strategy',
      },
      { key: 'snapshots', href: '#/snapshots', label: TEXT.snapshots, groupKey: 'strategy' },
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
        navKey: 'composition-dashboard',
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
    case 'creation-template':
      return {
        navKey: 'creation',
        eyebrow: TEXT.creationEyebrow,
        title: TEXT.creationTemplateTitle,
        description: TEXT.creationTemplateDesc,
      };
    case 'creation-session':
      return {
        navKey: 'creation',
        eyebrow: TEXT.creationEyebrow,
        title: TEXT.creationSessionTitle,
        description: TEXT.creationSessionDesc,
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
      };
    case 'run':
      return {
        navKey: 'runs',
        eyebrow: TEXT.runEyebrow,
        title: TEXT.runTitle,
        description: TEXT.runDesc,
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
