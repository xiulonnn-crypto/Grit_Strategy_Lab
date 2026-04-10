import type { AppRoute } from './lib/appRouteContext';

export type ShellNavKey = 'workspace' | 'creation' | 'runs' | 'optimization' | 'snapshots';

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

const TEXT = {
  workspace: '\u5de5\u4f5c\u53f0',
  workspaceTitle: '\u5de5\u4f5c\u53f0\u5065\u5eb7\u5ea6',
  workspaceDesc:
    '\u67e5\u770b\u7b56\u7565\u770b\u677f\u3001\u6700\u8fd1\u56de\u6d4b\u548c\u53ef\u76f4\u63a5\u8fdb\u5165\u4e3b\u94fe\u8def\u7684\u6062\u590d\u5165\u53e3\u3002',
  creation: '\u65b0\u5efa\u7b56\u7565',
  creationEyebrow: '\u7b56\u7565\u521b\u5efa',
  creationTemplateTitle: '\u9009\u62e9\u6a21\u677f',
  creationTemplateDesc:
    '\u5148\u9009\u62e9\u7b56\u7565\u7c7b\u578b\uff0c\u518d\u8fdb\u5165\u5bf9\u8bdd\u548c\u52a8\u6001\u8868\u5355\u534f\u540c\u7f16\u8f91\u3002',
  creationSessionTitle: '\u521b\u5efa\u4f1a\u8bdd',
  creationSessionDesc:
    '\u7531\u5bf9\u8bdd\u9a71\u52a8\u786e\u8ba4\u7a3f\uff0c\u518d\u8fdb\u5165\u7b56\u7565\u843d\u5730\u4e0e\u56de\u6d4b\u63d0\u4ea4\u3002',
  strategyDetailEyebrow: '\u7b56\u7565\u8be6\u60c5',
  strategyDetailTitle: '\u7b56\u7565\u8be6\u60c5',
  strategyDetailDesc:
    '\u67e5\u770b\u7b56\u7565\u6982\u51b5\u3001\u5f53\u524d\u53c2\u6570\u7248\u672c\u4e0e\u4e0b\u4e00\u6b65\u53ef\u6267\u884c\u64cd\u4f5c\u3002',
  backtestEyebrow: '\u771f\u5b9e\u6267\u884c',
  backtestTitle: '\u771f\u5b9e\u56de\u6d4b\u63d0\u4ea4',
  backtestDesc:
    '\u786e\u8ba4\u56de\u6d4b\u533a\u95f4\u3001\u53c2\u6570\u7248\u672c\u548c\u5feb\u7167\u72b6\u6001\uff0c\u518d\u751f\u6210\u6b63\u5f0f\u56de\u6d4b\u3002',
  runs: '\u56de\u6d4b\u5217\u8868',
  runsEyebrow: '\u56de\u6d4b\u6570\u636e',
  runsTitle: '\u56de\u6d4b\u5386\u53f2',
  runsDesc: '\u7528\u4e8e\u5728\u7ed3\u679c\u548c\u8be6\u60c5\u4e4b\u95f4\u5207\u6362\u7684\u5217\u8868\u89c6\u56fe\u3002',
  runEyebrow: '\u8fd0\u884c\u8be6\u60c5',
  runTitle: '\u8bca\u65ad\u89c6\u56fe',
  runDesc:
    '\u98ce\u9669\u6458\u8981\u3001\u4e3b\u66f2\u7ebf\u3001\u4ea4\u6613\u660e\u7ec6\u4e0e\u8bc1\u636e\u8f68\u8ff9\u90fd\u4f1a\u5728\u8fd9\u91cc\u5c55\u5f00\u3002',
  snapshots: '\u6570\u636e\u5feb\u7167',
  snapshotsTitle: '\u5feb\u7167\u603b\u89c8',
  snapshotsDesc:
    '\u96c6\u4e2d\u67e5\u770b\u6570\u636e\u96c6\u4e0e\u80a1\u7968\u6c60\u5feb\u7167\u72b6\u6001\uff0c\u5e76\u63d0\u4f9b\u5237\u65b0\u4e0e\u4fee\u590d\u5165\u53e3\u3002',
  optimizationEyebrow: '\u4f18\u5316\u5b9e\u9a8c',
  optimizationTitle: '\u4f18\u5316\u5b9e\u9a8c\u5ba4',
  optimizationDesc:
    '\u4fdd\u7559\u73b0\u6709\u5019\u9009\u7248\u672c\u7ba1\u7406\u884c\u4e3a\uff0c\u5e76\u63a5\u5165\u7edf\u4e00\u7684\u4e2d\u6587\u5e94\u7528\u58f3\u3002',
} as const;

export const SHELL_NAV_ITEMS: ShellNavItem[] = [
  { key: 'workspace', href: '#/workspace', label: TEXT.workspace },
  { key: 'creation', href: '#/creation/new', label: TEXT.creation },
  { key: 'runs', href: '#/runs', label: TEXT.runs },
  { key: 'optimization', href: '#/optimization-jobs', label: TEXT.optimizationTitle },
  { key: 'snapshots', href: '#/snapshots', label: TEXT.snapshots },
];

export function getRouteMeta(route: AppRoute): AppRouteMeta {
  switch (route.kind) {
    case 'workspace':
      return {
        navKey: 'workspace',
        eyebrow: TEXT.workspace,
        title: TEXT.workspaceTitle,
        description: TEXT.workspaceDesc,
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
