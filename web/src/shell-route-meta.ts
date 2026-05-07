import type { AppRoute } from './lib/appRouteContext';

export type ShellNavKey =
  | 'workspace'
  | 'creation'
  | 'runs'
  | 'optimization'
  | 'snapshots'
  | 'composition'
  | 'factor'
  | 'data';

export type ShellNavItem = {
  key: ShellNavKey;
  href: string;
  label: string;
};

export type AppRouteMeta = {
  navKey: ShellNavKey;
  eyebrow: string;
  title: string;
  description: string;
  showPageHeading?: boolean;
};

export const SHELL_NAV_ITEMS: ShellNavItem[] = [
  { key: 'composition', href: '#/compositions', label: '组合' },
  { key: 'workspace', href: '#/workspace', label: '工作台' },
  { key: 'creation', href: '#/strategies', label: '策略库' },
  { key: 'runs', href: '#/runs', label: '回测列表' },
  { key: 'optimization', href: '#/optimization-jobs', label: '优化实验室' },
  { key: 'snapshots', href: '#/snapshots', label: '数据快照' },
  { key: 'factor', href: '#/factors', label: '因子库' },
  { key: 'data', href: '#/pit-data', label: 'PIT 清洗中心' },
];

export function getRouteMeta(route: AppRoute): AppRouteMeta {
  switch (route.kind) {
    case 'composition-dashboard':
    case 'composition-list':
    case 'composition-backtest-runs':
    case 'composition-lab':
    case 'leg-inventory':
    case 'composition-workbench':
    case 'composition-detail':
    case 'composition-backtest-new':
    case 'composition-backtest-result':
    case 'composition-allocation-config':
    case 'composition-allocation-result':
      return {
        navKey: 'composition',
        eyebrow: '组合',
        title: '组合中心',
        description: '查看组合结构、回测稳定性和资产配置候选。',
        showPageHeading: false,
      };
    case 'workspace':
      return {
        navKey: 'workspace',
        eyebrow: '工作台',
        title: '工作台健康度',
        description: '总览策略规模、活跃回测与优化进度，直达最新任务。',
        showPageHeading: false,
      };
    case 'creation-template':
      return {
        navKey: 'creation',
        eyebrow: '策略管理',
        title: '策略库',
        description: '集中管理已创建策略、参数版本、长期回测表现与后续研究动作。',
        showPageHeading: false,
      };
    case 'creation-session':
      return {
        navKey: 'creation',
        eyebrow: '策略创建',
        title: '创建会话',
        description: '由对话驱动确认稿，再进入策略落地与回测提交。',
        showPageHeading: false,
      };
    case 'asset-allocation-config':
      return {
        navKey: 'creation',
        eyebrow: '策略管理',
        title: '资产配置策略配置',
        description: '标的、权重、再平衡与成本参数配置。',
        showPageHeading: false,
      };
    case 'strategy-detail':
      return {
        navKey: 'workspace',
        eyebrow: '策略详情',
        title: '策略详情',
        description: '查看策略概况、当前参数版本与下一步可执行动作。',
        showPageHeading: false,
      };
    case 'backtest':
      return {
        navKey: 'workspace',
        eyebrow: '真实执行',
        title: '真实回测提交',
        description: '确认回测区间、参数版本和快照状态，再生成正式回测。',
        showPageHeading: false,
      };
    case 'runs-index':
      return {
        navKey: 'runs',
        eyebrow: '回测数据',
        title: '回测历史',
        description: '用于在结果和详情之间切换的列表视图。',
      };
    case 'run':
      return {
        navKey: 'runs',
        eyebrow: '运行详情',
        title: '诊断视图',
        description: '风险摘要、主曲线、交易明细与证据轨迹都会在这里展开。',
        showPageHeading: false,
      };
    case 'snapshots':
      return {
        navKey: 'snapshots',
        eyebrow: '数据快照',
        title: '快照总览',
        description: '集中查看数据集与股票池快照状态，并提供刷新与修复入口。',
        showPageHeading: false,
      };
    case 'pit-data':
      return {
        navKey: 'data',
        eyebrow: '数据基座',
        title: 'PIT 清洗中心',
        description: '复核复权价格、历史样本池和异常清洗状态，确保因子诊断不引入未来函数。',
        showPageHeading: false,
      };
    case 'factor-library':
      return {
        navKey: 'factor',
        eyebrow: '因子',
        title: '因子库',
        description: '集中管理默认因子、人工因子、最近诊断和 PIT 数据门禁。',
        showPageHeading: false,
      };
    case 'factor-detail':
      return {
        navKey: 'factor',
        eyebrow: '因子',
        title: '因子诊断',
        description: '查看因子逻辑、PIT 诊断和投研治理证据。',
        showPageHeading: false,
      };
    case 'factor-editor':
      return {
        navKey: 'factor',
        eyebrow: '因子',
        title: '因子编辑器',
        description: '用白名单公式编写人工因子，并在正式诊断前预览 IC。',
        showPageHeading: false,
      };
    case 'factor-sandbox':
      return {
        navKey: 'factor',
        eyebrow: '因子',
        title: '挖掘沙盒',
        description: '自动挖掘能力将在后续里程碑接入，本期保留导航入口。',
        showPageHeading: false,
      };
    case 'factor-quarantine':
      return {
        navKey: 'factor',
        eyebrow: '因子',
        title: '检疫工作台',
        description: '自动挖掘因子的去重、样本外和相关性门禁将在后续里程碑接入。',
        showPageHeading: false,
      };
    case 'optimization-index':
    case 'optimization-select':
    case 'optimization-config':
    case 'optimization':
      return {
        navKey: 'optimization',
        eyebrow: '优化实验',
        title: '优化实验室',
        description: '围绕策略参数搜索、候选回看和版本晋升的统一工作区。',
        showPageHeading: false,
      };
  }
  return {
    navKey: 'workspace',
    eyebrow: '工作台',
    title: '工作台健康度',
    description: '总览策略规模、活跃回测与优化进度，直达最新任务。',
    showPageHeading: false,
  };
}
