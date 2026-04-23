import type { AppRoute } from './lib/appRouteContext';

export type ShellNavKey = 'workspace' | 'creation' | 'runs' | 'snapshots';

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
  { key: 'workspace', href: '#/workspace', label: '工作台' },
  { key: 'creation', href: '#/creation/new', label: '新建策略' },
  { key: 'runs', href: '#/runs', label: '回测列表' },
  { key: 'snapshots', href: '#/snapshots', label: '数据快照' },
];

export function getRouteMeta(route: AppRoute): AppRouteMeta {
  switch (route.kind) {
    case 'workspace':
      return {
        navKey: 'workspace',
        eyebrow: '工作台',
        title: '工作台健康度',
        description: '查看策略看板、最近回测和可直接进入主链路的恢复入口。',
      };
    case 'creation-template':
      return {
        navKey: 'creation',
        eyebrow: '策略创建',
        title: '选择模板',
        description: '先选择策略类型，再进入对话和动态表单协同编辑。',
      };
    case 'creation-session':
      return {
        navKey: 'creation',
        eyebrow: '策略创建',
        title: '创建会话',
        description: '由对话驱动确认稿，再进入策略落地与回测提交。',
      };
    case 'strategy-detail':
      return {
        navKey: 'workspace',
        eyebrow: '策略详情',
        title: '策略详情',
        description: '查看策略概况、当前参数版本与下一步可执行操作。',
      };
    case 'backtest':
      return {
        navKey: 'workspace',
        eyebrow: '真实执行',
        title: '真实回测提交',
        description: '确认回测区间、参数版本和快照状态，再生成正式回测。',
      };
    case 'runs-index':
      return {
        navKey: 'runs',
        eyebrow: '回测列表',
        title: '回测历史',
        description: '用于在结果和详情之间切换的列表视图。',
      };
    case 'run':
      return {
        navKey: 'runs',
        eyebrow: '运行详情',
        title: '诊断视图',
        description: '风险摘要、主曲线、交易明细与证据轨迹都会在这里展开。',
      };
    case 'snapshots':
      return {
        navKey: 'snapshots',
        eyebrow: '数据快照',
        title: '快照总览',
        description: '集中查看数据集与股票池快照状态，并提供刷新与修复入口。',
      };
    case 'optimization':
      return {
        navKey: 'workspace',
        eyebrow: '优化实验',
        title: '优化实验室',
        description: '保留现有候选版本管理行为，并接入统一的中文应用壳。',
      };
  }
}
