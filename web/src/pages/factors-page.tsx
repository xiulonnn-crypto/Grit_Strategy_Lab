import { Fragment, useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatDateTime } from '../lib/format';
import type {
  ApiFactorBatchDiagnosticSummary,
  ApiFactorDetail,
  ApiFactorDiagnosticPreview,
  ApiFactorDiagnosticPreviewPayload,
  ApiFactorDiagnosticSummary,
  ApiFactorGovernanceAction,
  ApiFactorGovernanceOverview,
  ApiFactorListItem,
  ApiFactorListResponse,
  ApiPitDataOverview,
  ApiPitIdentityScraperRestartResponse,
  ApiSnapshotOverview,
} from '../types';
import './factors-page.css';

type CoverageGapBucket = NonNullable<ApiPitDataOverview['coverage_gap']>['buckets'][number];
type CoverageGapSymbolDetail = NonNullable<CoverageGapBucket['symbol_details']>[number];
type PitOpsGuidanceAction = NonNullable<NonNullable<ApiPitDataOverview['ops_guidance']>['actions']>[number];
type PitLayerReadinessItem = {
  layer_id: string;
  title_cn: string;
  status: string;
  summary: string;
  label?: string;
  reason?: string;
  detail?: string;
  pit_alignment?: string;
  blockers: string[];
  available_at_health?: string | null;
  updated_at?: string | null;
  metrics: Array<{ label: string; value: string }>;
  submodules?: PitReadinessSubmodule[];
  upstream_capabilities: PitUpstreamCapability[];
};
type SnapshotLayerStatusMap = Record<string, string>;
type PitUpstreamCapability = {
  capability_id: string;
  factor_groups: string[];
  mode: string;
  allowed_actions: string[];
  required_checks: string[];
  satisfied_checks: string[];
  blocked_checks: string[];
  summary_cn: string;
};
type PitReadinessSubmodule = {
  id: string;
  title_cn: string;
  status: string;
  usable: boolean;
  summary_cn: string;
  blockers: string[];
  linked_targets: string[];
  metrics: Array<{ label: string; value: string }>;
  upstream_capabilities: PitUpstreamCapability[];
};
type FactorDiagnosticReadinessItem = {
  group_id: string;
  title_cn: string;
  status: string;
  factors: string[];
  rationale_cn: string;
  linked_snapshot_checks: string[];
  required_checks: string[];
  satisfied_checks: string[];
  blocked_checks: string[];
  upstream_capabilities: PitUpstreamCapability[];
};
type PitQualityAlertItem = {
  code: string;
  severity: string;
  title_cn: string;
  detail_cn: string;
  hard_blocking: boolean;
  linked_factor_groups: string[];
  target?: string | null;
};
type SnapshotLayerLinkageItem = {
  check_id: string;
  check_title_cn: string;
  source_layer: string;
  target_factor_groups: string[];
  result_status: string;
  detail_cn: string;
  hard_blocking: boolean;
  capability_mode?: string | null;
};
type PitOverviewExtended = ApiPitDataOverview & {
  pit_layer_readiness?: unknown;
  factor_diagnostic_readiness?: unknown;
  pit_quality_alerts?: unknown;
  snapshot_layer_linkage?: unknown;
};
type FactorSortKey = 'rank_ic' | 'level' | 'updated_at';
type FactorSortDirection = 'asc' | 'desc';
type FactorSortState = { key: FactorSortKey; direction: FactorSortDirection };
type FactorLevelKey = 'S' | 'A' | 'B' | 'C' | 'D';
type FactorDiagnosticPreviewRequester = (
  request: ApiFactorDiagnosticPreviewPayload,
) => Promise<ApiFactorDiagnosticPreview> | undefined;
type FactorLevelProjection = {
  key: FactorLevelKey;
  title: string;
  rankIcRange: string;
  irRange: string;
  recommendation: string;
  score: number;
};

const STATUS_LABELS: Record<string, string> = {
  READY: 'Full Ready',
  LIMITED_READY: 'Limited Ready',
  BLOCKED: '阻塞',
  INCOMPLETE: '待补',
  UNAVAILABLE: '不可预览',
  DRAFT: '实验中',
  VERIFIED: '已验证',
  PRODUCTION: '生产中',
  DECAYED: '已失效',
  DEPRECATED: '已强制下线',
  PRUNED: '冗余挂起',
  READY_TO_DIAGNOSE: '可诊断',
  SANDBOX_READY: 'Sandbox 可跑',
  BLOCKED_PIT: 'PIT 门禁阻塞',
  BLOCKED_DATA: '基础数据待补',
  COMPLETED: '已完成',
  FAILED: '失败',
};

const PIT_STATUS_LABELS: Record<string, string> = {
  READY: '正式就绪',
  PARTIAL_READY: '部分可用',
  LIMITED_READY: '研究就绪',
  BLOCKED: '阻塞',
  READY_TO_DIAGNOSE: '可诊断',
  SANDBOX_READY: '研究可跑',
  BLOCKED_PIT: 'PIT 阻塞',
  BLOCKED_DATA: '数据待补',
  INCOMPLETE: '待补',
  UNAVAILABLE: '不可用',
  COMPLETED: '完成',
  FAILED: '失败',
};

const PIT_LAYER_STATUS_LABELS: Record<string, string> = {
  READY: '可准入',
  PARTIAL_READY: '部分可用',
  WARNING: '观察',
  BLOCKED: '阻断',
  DISABLED: '停用',
  CALIBRATING: '校准中',
  LIMITED_READY: '观察',
  SANDBOX_READY: '沙箱观察',
  BLOCKED_PIT: '阻断',
  BLOCKED_DATA: '阻断',
  INCOMPLETE: '待补齐',
  UNAVAILABLE: '停用',
};

const FACTOR_PIT_ADMISSION_LABELS: Record<string, string> = {
  READY: '正式诊断可用',
  VERIFIED: '正式诊断可用',
  PRODUCTION: '正式诊断可用',
  PARTIAL_READY: '部分样本可用',
  LIMITED_READY: '观察诊断可用',
  REPAIR: '修复观察中',
  SANDBOX_READY: '沙箱诊断可用',
  BLOCKED: '阻塞',
  BLOCKED_PIT: 'PIT 阻塞',
  BLOCKED_DATA: '数据阻塞',
  INCOMPLETE: '待补齐',
  UNAVAILABLE: '暂不可用',
  FAILED: '校验失败',
};

const DIAGNOSTIC_READINESS_LABELS: Record<string, string> = {
  VERIFIED: '已验证',
  PARTIAL_READY: '部分可用',
  SANDBOX: '沙箱观察',
  BLOCKED: '阻断',
  DISABLED: '停用',
};

const SOURCE_LABELS: Record<string, string> = {
  SYSTEM_SEED: '系统默认',
  MANUAL: '人工',
  AUTO_MINED: '自动挖掘',
};
const DESCRIPTOR_CATEGORY_LABELS: Record<string, string> = {
  mom: '动量',
  val: '估值',
  qlty: '质量',
  vol: '风险',
  size: '规模',
  beta: '风险',
  inv: '质量',
  liq: '情绪',
  alpha: '其他',
};
const FACTOR_LIBRARY_CATEGORY_LABELS: Record<string, string> = {
  mom: '动量',
  size: '规模',
  val: '估值',
  qlty: '质量',
  risk: '风险',
  sentiment: '情绪',
  other: '其他',
};
const FACTOR_LIBRARY_CATEGORY_BY_DESCRIPTOR: Record<string, string> = {
  alpha: 'other',
  beta: 'risk',
  inv: 'qlty',
  liq: 'sentiment',
  mom: 'mom',
  qlty: 'qlty',
  size: 'size',
  val: 'val',
  vol: 'risk',
};
const FACTOR_LIBRARY_CATEGORY_ORDER = ['mom', 'size', 'val', 'qlty', 'risk', 'sentiment', 'other'];
const MAX_VISIBLE_CORRELATION_FACTORS = 40;
const GROUP_MONOTONICITY_WINDOW_PERIODS = 3;
const GROUP_INVERSION_REQUIRED_STREAK = 3;
const DESCRIPTOR_OPERATOR_LABELS: Record<string, string> = {
  rank: '截面排名',
  z: '标准化',
  raw: '原始值',
  log: '对数化',
};

const OPERATOR_EXPLANATIONS: Record<string, string> = {
  Rank: '横截面排序：把同一天所有股票按因子值排位。',
  Ts_Rank: '时间序列排序：观察单只股票在历史窗口里的相对位置。',
  Delta: '差分/变化率：比较当前值和 N 天前的变化。',
  Return: '收益率：计算价格在指定窗口内的涨跌幅。',
  Mean: '均值：计算窗口内的平均水平。',
  Std: '波动率：计算窗口内收益或价格的离散程度。',
  ZScore: '标准化：把值转换成离均值多少个标准差。',
  Winsorize: '缩尾：压制极端值对排序的影响。',
  Neutralize: '中性化：剥离行业、市值等共同暴露。',
  Correlation: '相关性：计算两个序列在窗口内同步变化的程度。',
  Log: '对数变换：降低数量级差异对模型的影响。',
  Close: '收盘价：使用点时一致的复权收盘价。',
  Volume: '成交量：使用点时一致的交易量序列。',
};

const FORMULA_TOKEN_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)/g;
const DIAGNOSTIC_TOOLTIP_LINES = [
  'Rank IC: 因子排序与未来收益排序的相关性，越高说明截面排序越有效。',
  'IR: Rank IC 均值除以波动，衡量诊断稳定性。',
  '覆盖率: 本次诊断中有可用 PIT 样本的证券占比。',
];
const TURNOVER_DECAY_TOOLTIP_LINES = [
  '信号半衰期：Rank IC 衰减曲线降至初始边际贡献一半附近的交易日数。',
  '预估年换手：按诊断窗口内分层持仓变化折算为年化换手率，用于成本压力判断。',
  'TRS 成本：冲击、融资和滑点以 bp 拆分，作为交易前复核口径，不等同于真实成交扣费。',
];
const GROUP_IC_TOOLTIP_LINES = [
  '分层收益：按每期因子值从高到低切成 Q1 到 Q5，展示最近 3 期滑动平均后的组均未来收益。',
  '单调性校验：只有 3 期滑动均值连续 3 次出现 Q1 < Q5，才触发硬阻断。',
  'IC 走势：排序 IC 使用同一 PIT 样本池和未来收益窗口，滚动展示最近诊断序列。',
];
const FACTOR_LEVELS: FactorLevelProjection[] = [
  {
    key: 'S',
    title: '顶级印钞机',
    rankIcRange: '> 0.03',
    irRange: '> 2.0',
    recommendation: '你的因子在此！极其罕见，具备极高的实战价值，建议作为组合的核心权重。',
    score: 5,
  },
  {
    key: 'A',
    title: '优质 Alpha',
    rankIcRange: '0.02 ~ 0.03',
    irRange: '1.0 ~ 2.0',
    recommendation: '非常优秀的因子，可以稳定贡献超额收益。',
    score: 4,
  },
  {
    key: 'B',
    title: '合格基准',
    rankIcRange: '0.01 ~ 0.02',
    irRange: '0.5 ~ 1.0',
    recommendation: '中规中矩，可以作为辅助因子增加组合的多元化。',
    score: 3,
  },
  {
    key: 'C',
    title: '微弱信号',
    rankIcRange: '0.005 ~ 0.01',
    irRange: '0.2 ~ 0.5',
    recommendation: '信号较弱，容易被交易成本吞噬，需观察长期表现。',
    score: 2,
  },
  {
    key: 'D',
    title: '噪声/随机',
    rankIcRange: '< 0.005',
    irRange: '< 0.2',
    recommendation: '基本属于统计噪声，不建议在实盘中使用。',
    score: 1,
  },
];
const FACTOR_LEVEL_BY_SCORE = new Map(FACTOR_LEVELS.map((level) => [level.score, level]));
const FACTOR_LEVEL_TOOLTIP_LINES = [
  '因子级别：Rank IC 均值和 IR (稳定性) 先取绝对值，再按较弱一项保守评级。',
  ...FACTOR_LEVELS.map((level) => `${level.key} ${level.title}: Rank IC ${level.rankIcRange}, IR ${level.irRange}; ${level.recommendation}`),
  '未完成真实或预览诊断的因子显示为未评级，不参与等级排序。',
];
type FactorUiState = 'robust' | 'needs_calibration' | 'decayed' | 'sandbox';
type FactorDiagnosticStateFilter = FactorUiState | '';
type FactorLifecycleTab = 'all' | 'sandbox' | 'online' | 'offline' | 'to_be_verified' | 'archived';

const FACTOR_LIFECYCLE_TABS: Array<{ key: FactorLifecycleTab; label: string; countKey: string }> = [
  { key: 'all', label: '全部生命周期', countKey: 'allCount' },
  { key: 'sandbox', label: '沙箱', countKey: 'lifecycleSandboxCount' },
  { key: 'online', label: '线上', countKey: 'onlineCount' },
  { key: 'to_be_verified', label: '待校准', countKey: 'toBeVerifiedCount' },
  { key: 'archived', label: '已归档', countKey: 'archivedCount' },
];

const FACTOR_LAYER_TABS: Array<{ key: 'F1' | 'F2' | 'F3'; title: string; description: string; countKey: 'f1Count' | 'f2Count' | 'f3Count' }> = [
  { key: 'F1', title: 'F1 原始库', description: 'API/DB 直连字段，只增不改', countKey: 'f1Count' },
  { key: 'F2', title: 'F2 改造库', description: '去极值、中性化、标准化与排名', countKey: 'f2Count' },
  { key: 'F3', title: 'F3 组合库', description: '风格复合、风险调节与背离惩罚', countKey: 'f3Count' },
];

const FACTOR_LAYER_LABELS: Record<'F1' | 'F2' | 'F3', string> = {
  F1: 'F1 原始库',
  F2: 'F2 改造库',
  F3: 'F3 组合库',
};

const UI_STATE_LABELS: Record<FactorUiState, string> = {
  robust: '稳健',
  needs_calibration: '待校准',
  decayed: '失效',
  sandbox: '沙箱',
};
const UI_STATE_FILTER_OPTIONS: Array<{ value: FactorDiagnosticStateFilter; label: string }> = [
  { value: '', label: '全部' },
  { value: 'robust', label: '稳健' },
  { value: 'needs_calibration', label: '待校准' },
  { value: 'sandbox', label: '沙箱' },
  { value: 'decayed', label: '失效' },
];
const UI_STATE_MANAGEMENT_ACTIONS: Record<FactorUiState, string> = {
  robust: '管理动作：准予生产，可作为多因子策略核心权重并允许晋升至正式 PIT 环境；系统每月自动复核。',
  needs_calibration: '管理动作：限值研究使用，策略创建页应自动给出降权建议。',
  decayed: '管理动作：物理封存，不计入多因子撮合索引；历史数据保留在归档库用于复盘。',
  sandbox: '管理动作：仅供预览，禁止进入回放测试；需完成数据治理后再转为稳健或待校准。',
};
const FACTOR_WARNING_GATE_CODES = new Set([
  'COVERAGE_EDGE',
  'DIAGNOSTIC_STALE',
  'GROUP_RETURNS_MONOTONICITY_WEAK',
  'HIGH_CORRELATION',
  'IC_RECENT_DECAY',
  'IC_UNSTABLE',
  'FACTOR_ADMISSION_10Y_REPAIR',
  'FULL_READY_ARCHIVAL_GAP',
  'PIT_METADATA_RECOMPUTE_MISMATCH',
  'TURNOVER_DECAY',
  'VERIFIED_PIT_WINDOW_INCOMPLETE',
]);
const FACTOR_HARD_GATE_CODES = new Set([
  'CURRENT_ONLY_DATA',
  'FACTOR_GRADE_DECAYED',
  'FUNDAMENTAL_PIT_NOT_READY',
  'FUTURE_FUNCTION',
  'GROUP_RETURNS_INVERTED',
  'INDUSTRY_PIT_NOT_READY',
  'MISSING_AVAILABLE_AT',
  'NON_REPLAYABLE_FIELD',
  'PIT_GATE_BLOCKED',
  'PRICE_SNAPSHOT_NOT_READY',
  'UNSAFE_EXPRESSION',
  'UNIVERSE_HISTORY_BLOCKED',
]);

const UI_STATE_TOOLTIP_LINES = [
  '稳健：Grade S/A/B，覆盖率大于 90%，IR 稳定，分组收益单调性良好，且没有硬阻断或风险提示。',
  '待校准：已有正式诊断但存在覆盖不足、相关性拥挤、近期 IC 衰减、10Y补源队列、Full Ready归档缺口或诊断过期等风险。',
  '沙箱：无完整 IC/IR 或仅有预览诊断。只供研究预览，补齐 PIT 与治理数据后再晋级。',
  '失效：Grade C/D 或分层收益倒挂。物理封存，不计入多因子撮合索引，历史数据进入归档库复盘。',
];

const FACTOR_UPDATED_TOOLTIP_LINES = [
  '优先显示最近诊断时间，其次使用因子更新时间或创建时间。',
  '用于判断诊断是否过期，不等同于数据快照刷新时间。',
];
const FACTOR_OFFLINE_REASON_TOOLTIP_LINES = [
  '已下线 tab 保留软下线原因，包括强制下线或冗余裁剪。',
  '下线因子不进入策略配置、因子模型预览或算力预览。',
];
const FACTOR_OFFLINE_TIME_TOOLTIP_LINES = [
  '显示软下线写入时间；缺失时保留线上口径，方便审计旧记录。',
];

function pct(value: unknown, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}%` : '待生成';
}

function num(value: unknown, digits = 3): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '待生成';
}

function backendHref(path: string): string {
  if (typeof window === 'undefined') return path;
  const { protocol, hostname, port } = window.location;
  if ((hostname === '127.0.0.1' || hostname === 'localhost') && port && port !== '8000') {
    return `${protocol}//${hostname}:8000${path}`;
  }
  return path;
}

function HelpTooltip({
  label,
  lines,
  mono = false,
}: {
  label: string;
  lines: string[];
  mono?: boolean;
}): JSX.Element {
  return (
    <span className={`factor-help-tooltip ${mono ? 'factor-help-tooltip--mono' : ''}`} tabIndex={0} aria-label={label}>
      ?
      <span className="factor-help-tooltip__content" role="tooltip">
        {lines.map((line) => <span key={line}>{line}</span>)}
      </span>
    </span>
  );
}

function subtractYears(value: string | undefined, years: number): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  const adjusted = new Date(date.getTime());
  adjusted.setFullYear(adjusted.getFullYear() - years);
  return adjusted.toISOString().slice(0, 10);
}

function FormulaWithTooltips({ expression }: { expression: string }): JSX.Element {
  const parts = expression.split(FORMULA_TOKEN_PATTERN);
  return (
    <small className="factor-formula" aria-label={`公式 ${expression}`}>
      {parts.map((part, index) => {
        const explanation = OPERATOR_EXPLANATIONS[part];
        if (!explanation) return <span key={`${part}-${index}`}>{part}</span>;
        return (
          <span
            className="factor-formula-token"
            data-tooltip={explanation}
            title={explanation}
            key={`${part}-${index}`}
          >
            {part}
          </span>
        );
      })}
    </small>
  );
}

function Sparkline({ points }: { points: Array<{ value: number }> }): JSX.Element {
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return (
      <div className="factor-sparkline-empty" role="note" aria-label="暂无 IC 数据">
        暂无 IC
      </div>
    );
  }
  const safeValues = values.length ? values : [0];
  const min = Math.min(...safeValues, 0);
  const max = Math.max(...safeValues, 0);
  const span = Math.max(max - min, 0.001);
  const yFor = (value: number) => 34 - ((value - min) / span) * 28;
  const zeroY = yFor(0);
  const coordinates = safeValues.map((value, index) => {
    const x = safeValues.length <= 1 ? 1 : 1 + (index / (safeValues.length - 1)) * 118;
    return { value, x, y: yFor(value) };
  });
  const d = coordinates
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const segments = coordinates.slice(1).map((point, index) => {
    const prev = coordinates[index];
    const positive = (prev.value + point.value) / 2 >= 0;
    const path = [
      `M ${prev.x.toFixed(2)} ${zeroY.toFixed(2)}`,
      `L ${prev.x.toFixed(2)} ${prev.y.toFixed(2)}`,
      `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      `L ${point.x.toFixed(2)} ${zeroY.toFixed(2)} Z`,
    ].join(' ');
    return { path, positive };
  });
  return (
    <svg className="factor-sparkline" viewBox="0 0 120 40" role="img" aria-label="IC 累积曲线缩略图">
      <path className="factor-sparkline__zero" d={`M 1 ${zeroY.toFixed(2)} L 119 ${zeroY.toFixed(2)}`} />
      <text className="factor-sparkline__zero-label" x="2" y={Math.max(8, zeroY - 2).toFixed(2)}>0</text>
      {segments.map((segment, index) => (
        <path
          className={`factor-sparkline__area ${
            segment.positive ? 'factor-sparkline__area--positive' : 'factor-sparkline__area--negative'
          }`}
          d={segment.path}
          key={`${index}-${segment.positive ? 'pos' : 'neg'}`}
        />
      ))}
      <path className="factor-sparkline__line" d={d || `M 1 ${zeroY.toFixed(2)} L 119 ${zeroY.toFixed(2)}`} />
    </svg>
  );
}

function PageHero({
  eyebrow,
  title,
  description,
  status,
  meta,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  status?: string;
  meta?: JSX.Element;
  actions?: JSX.Element;
}): JSX.Element {
  return (
    <section className="factor-page-hero">
      <div>
        <p className="factor-page-hero__eyebrow">{eyebrow}</p>
        <div className="factor-page-hero__title-row">
          <h1>{title}</h1>
          {status ? <span className="factor-status-chip">{status}</span> : null}
        </div>
        <p>{description}</p>
        {meta ? <div className="factor-page-hero__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="factor-page-hero__actions">{actions}</div> : null}
    </section>
  );
}

function StatusPill({ status }: { status: string }): JSX.Element {
  const normalized = status.toUpperCase();
  return (
    <span className={`factor-pill factor-pill--${normalized.toLowerCase().replaceAll('_', '-')}`}>
      {STATUS_LABELS[normalized] ?? status}
    </span>
  );
}

function PitStatusPill({ status }: { status: string }): JSX.Element {
  const normalized = status.toUpperCase();
  return (
    <span className={`factor-pill factor-pill--${normalized.toLowerCase().replaceAll('_', '-')}`}>
      {PIT_STATUS_LABELS[normalized] ?? status}
    </span>
  );
}

function pitStatusLabel(value: unknown): string {
  const normalized = String(value ?? '').toUpperCase();
  return PIT_STATUS_LABELS[normalized] ?? String(value ?? '待确认');
}

function factorPitAdmissionLabel(value: unknown): string {
  const normalized = String(value ?? '').toUpperCase();
  return FACTOR_PIT_ADMISSION_LABELS[normalized] ?? pitStatusLabel(normalized);
}

function pitCopy(value: unknown): string {
  return String(value ?? '')
    .replaceAll('Full Ready', '完整门禁')
    .replaceAll('Limited Ready', '研究就绪')
    .replaceAll('Sandbox', '研究')
    .replaceAll('Verified', '正式')
    .replaceAll('Identity Scraper', '身份修复任务')
    .replaceAll('重启 身份修复任务', '重启身份修复任务')
    .replaceAll('身份修复任务 已执行', '身份修复任务已执行')
    .replaceAll('个 symbol', '个标的')
    .replaceAll('symbol', '标的')
    .replaceAll('waiver', '研究豁免');
}

function pitPriorityLabel(value?: string | null): string {
  const normalized = String(value ?? '').toUpperCase();
  const labels: Record<string, string> = {
    HIGH: '高',
    MEDIUM: '中',
    LOW: '低',
  };
  return labels[normalized] ?? '中';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function goToHashTarget(fixHash?: string | null): void {
  if (!fixHash) return;
  navigateTo(fixHash.replace(/^#/, ''));
}

function formatSignedPct(value: number | null | undefined): string {
  if (!isNumber(value)) return '待生成';
  const pctValue = value * 100;
  return `${pctValue > 0 ? '+' : ''}${pctValue.toFixed(2)}%`;
}

function usePitOverview(initialLoadDelayMs = 0): {
  pit: ApiPitDataOverview | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const api = useApiClient();
  const [pit, setPit] = useState<ApiPitDataOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    if (initialLoadDelayMs > 0 && nonce === 0) {
      const timer = window.setTimeout(() => {
        if (alive) {
          setNonce((value) => value + 1);
        }
      }, initialLoadDelayMs);
      return () => {
        alive = false;
        window.clearTimeout(timer);
      };
    }
    api
      .getPitDataOverview()
      .then((payload) => {
        if (alive) setPit(payload);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message || 'PIT 概览加载失败。');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, initialLoadDelayMs, nonce]);
  return { pit, loading, error, reload: () => setNonce((value) => value + 1) };
}

function factorCorrelation(left: ApiFactorListItem, right: ApiFactorListItem): number {
  if (left.id === right.id) return 1;
  const leftTags = new Set(left.tags);
  const sharedTags = right.tags.filter((tag) => leftTags.has(tag)).length;
  const leftRequirements = new Set(left.data_requirements);
  const sharedRequirements = right.data_requirements.filter((item) => leftRequirements.has(item)).length;
  const bothPrice = left.data_requirements.every((item) => ['adj_close', 'price_history', 'returns'].includes(item)) &&
    right.data_requirements.every((item) => ['adj_close', 'price_history', 'returns'].includes(item));
  const bothFundamental = left.data_requirements.some((item) => !['adj_close', 'price_history', 'returns'].includes(item)) &&
    right.data_requirements.some((item) => !['adj_close', 'price_history', 'returns'].includes(item));
  const familyScore = bothPrice || bothFundamental ? 0.28 : 0.1;
  const deterministic = ((left.id.length * 13 + right.id.length * 7 + sharedTags * 11) % 18) / 100;
  return Number(Math.min(0.94, 0.36 + sharedTags * 0.1 + sharedRequirements * 0.07 + familyScore + deterministic).toFixed(2));
}

function descriptorCategory(factor: ApiFactorListItem): string {
  return factor.descriptor?.category ?? factor.tags.find((tag) => DESCRIPTOR_CATEGORY_LABELS[tag]) ?? 'other';
}

function factorLibraryCategory(factor: ApiFactorListItem): string {
  const category = descriptorCategory(factor);
  return FACTOR_LIBRARY_CATEGORY_BY_DESCRIPTOR[category] ?? 'other';
}

function factorLibraryCategoryLabel(category: string): string {
  return FACTOR_LIBRARY_CATEGORY_LABELS[category] ?? DESCRIPTOR_CATEGORY_LABELS[category] ?? '其他';
}

const MANUAL_FACTOR_DESCRIPTION_BY_ID: Record<string, string> = {
  m_mom_riskadj_126x21_raw: '逻辑：通过 21 日波动率平滑半年收益，避免选出暴涨暴跌股票。作用：提升夏普比率，减少净值回撤。',
  m_qlty_accruals_ltm_raw: '逻辑：衡量净利润与经营现金流的应计差额。作用：作为负向剔除指标，规避业绩造假或盈余质量差的标的。',
  m_liq_pvdiv_10d_raw: '逻辑：观察过去 10 日价格排名与成交量排名相关性。作用：区分放量上涨的健康趋势与缩量上涨/放量滞涨的反转风险。',
  m_val_turnover_skew_60d_raw: '逻辑：计算过去 60 日换手率偏度。作用：识别筹码在少数交易日集中成交带来的短期超额收益线索。',
  m_mom_path_eff_20d_raw: '逻辑：用净位移除以路径总长度衡量趋势纯度。作用：配合动量筛掉“电风扇”震荡行情。',
  m_vol_asym_updown_60d_raw: '逻辑：分别计算上涨日和下跌日收益波动。作用：识别下跌波动更剧烈的恐慌盘，可作为回撤惩罚项。',
  m_liq_vol_conc_21d_raw: '逻辑：计算成交量与绝对收益率相关性。作用：筛选大幅价格变动伴随真实放量、机构介入度较高的标的。',
  m_vol_ret_skew_252d_raw: '逻辑：衡量过去一年收益率分布偏度。作用：过滤高偏度、博彩型、暴涨暴跌标的。',
  m_alpha_overnight_21d_raw: '逻辑：衡量过去一个月平均隔夜收益。作用：捕捉非交易时段信息流入，但诊断中保留日内承接风险提示。',
};

function factorDescription(factor: ApiFactorListItem): string {
  const factorId = String(factor.id ?? factor.descriptor?.canonical_id ?? '').trim().toLowerCase();
  const manualDescription = MANUAL_FACTOR_DESCRIPTION_BY_ID[factorId];
  if (manualDescription) {
    return manualDescription;
  }
  const description = String(factor.description ?? factor.institutional_note ?? '').trim();
  if (description.startsWith('逻辑：') && description.includes('作用：')) {
    return description;
  }
  return describeFactorFormula(factor);
}

function describeFactorFormula(factor: ApiFactorListItem): string {
  const expression = String(factor.expression ?? '').trim();
  const normalized = expression.replace(/\s+/g, '').toLowerCase();
  const factorId = String(factor.id ?? factor.descriptor?.canonical_id ?? '').toLowerCase();
  const name = String(factor.name ?? '该因子').trim() || '该因子';
  const direction = factor.direction === 'LOW_IS_BETTER' ? '数值越低越优先' : '数值越高越优先';
  if (normalized.includes('close(t-21)/close(t-252)') || normalized.includes('return(close,126)') || factorId.includes('_mom_')) {
    return `逻辑：${name}基于历史收盘价变化衡量中期趋势延续或价格路径强度，要求价格样本满足 PIT 回放口径。作用：用于识别趋势更清晰的相对强势标的，${direction}，后续仍需结合 Rank IC、回撤和拥挤度校准。`;
  }
  if (normalized.includes('std') && normalized.includes('return(close')) {
    return `逻辑：${name}基于收益率标准差刻画价格波动强弱，反映标的在诊断窗口内的风险暴露。作用：用于低波动、防御或风险惩罚场景，${direction}，需要结合收益和换手成本判断是否可交易。`;
  }
  if (normalized.includes('ltmearnings/marketcap') || normalized.includes('bookvalueequity/marketcap')) {
    return `逻辑：${name}使用 PIT 财务字段与市值构造估值截面，避免用当前值回填历史。作用：用于寻找估值补偿更高的股票，${direction}，需要关注成长股阶段性失效和财报可得日。`;
  }
  if (normalized.includes('ltmearnings/bookvalueequity') || factorId.includes('_roe_')) {
    return `逻辑：${name}使用净利润与账面权益衡量资本回报效率，财务字段必须通过 available_at 门禁。作用：用于筛选盈利质量与资本效率更好的公司，${direction}，适合作为质量维度输入。`;
  }
  if (normalized.includes('operatingcashflow')) {
    return `逻辑：${name}使用经营现金流与市值或资产负债字段衡量现金创造质量。作用：用于过滤账面利润质量不足的标的，${direction}，需要财务 PIT 覆盖稳定后进入正式诊断。`;
  }
  if (normalized.includes('marketcap') || factorId.includes('_size_')) {
    return `逻辑：${name}使用 PIT 市值或股本字段刻画公司规模暴露。作用：用于控制规模风险或捕捉小市值溢价，${direction}，应与流动性和容量约束一起使用。`;
  }
  if (normalized.includes('turnover') || normalized.includes('volume') || normalized.includes('amihud') || factorId.includes('_liq_')) {
    return `逻辑：${name}使用成交量、换手率或价格冲击度量流动性与资金参与强度。作用：用于识别交易活跃度、拥挤度和容量风险，${direction}，后续需结合成交成本诊断。`;
  }
  if (factorId.includes('beta')) {
    return `逻辑：${name}通过市场相关或残差波动估计系统性风险暴露。作用：用于风险分解、残差化和组合约束，${direction}，不应单独替代 Alpha 信号。`;
  }
  return `逻辑：${name}根据公式 ${expression || factor.id} 构造可回放截面信号，并由 PIT 数据门禁控制可诊断范围。作用：用于因子库诊断、排序和模型候选评估，${direction}，需通过覆盖率、IC 和稳定性校准后再晋升。`;
}

function FactorDescriptionLine({
  factor,
  className = 'factor-row-description',
}: {
  factor: ApiFactorListItem;
  className?: string;
}): JSX.Element | null {
  const description = factorDescription(factor);
  if (!description) {
    return null;
  }
  return (
    <p className={className}>
      <strong>因子描述</strong>
      <span>{description}</span>
    </p>
  );
}

function categorySortIndex(category: string): number {
  const index = FACTOR_LIBRARY_CATEGORY_ORDER.indexOf(category);
  return index >= 0 ? index : FACTOR_LIBRARY_CATEGORY_ORDER.length;
}

function sortFactorsByCategory(factors: ApiFactorListItem[]): ApiFactorListItem[] {
  return [...factors].sort((left, right) => {
    const categoryDiff = categorySortIndex(factorLibraryCategory(left)) - categorySortIndex(factorLibraryCategory(right));
    if (categoryDiff !== 0) return categoryDiff;
    return (left.descriptor?.canonical_id ?? left.id).localeCompare(right.descriptor?.canonical_id ?? right.id);
  });
}

function correlationGroups(factors: ApiFactorListItem[]): Array<{ category: string; label: string; count: number }> {
  return factors.reduce<Array<{ category: string; label: string; count: number }>>((groups, factor) => {
    const category = factorLibraryCategory(factor);
    const latest = groups.at(-1);
    if (latest?.category === category) {
      latest.count += 1;
    } else {
      groups.push({ category, label: factorLibraryCategoryLabel(category), count: 1 });
    }
    return groups;
  }, []);
}

function diagnosticSeries(factor: ApiFactorListItem): number[] {
  const summary = factor.latest_diagnostic_summary;
  const summarySeries = summary?.ic_series?.map((point) => point.rank_ic).filter(isNumber);
  if (summarySeries?.length) return summarySeries;
  return factor.ic_sparkline.map((point) => point.value).filter(isNumber);
}

function factorMetricValue(factor: ApiFactorListItem, key: 'rank_ic' | 'ir'): number | null {
  const value = factor.latest_diagnostic_summary?.[key] ?? factor.batch_diagnostic_summary?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function factorRankIc(factor: ApiFactorListItem): number | null {
  return factorMetricValue(factor, 'rank_ic');
}

function metricLevelScore(value: number, metric: 'rank_ic' | 'ir'): number {
  if (metric === 'rank_ic') {
    if (value > 0.03) return 5;
    if (value >= 0.02) return 4;
    if (value >= 0.01) return 3;
    if (value >= 0.005) return 2;
    return 1;
  }
  if (value > 2.0) return 5;
  if (value >= 1.0) return 4;
  if (value >= 0.5) return 3;
  if (value >= 0.2) return 2;
  return 1;
}

function factorLevel(factor: ApiFactorListItem): FactorLevelProjection | null {
  const backendLevel = String(factor.factor_level ?? factor.factor_level_projection?.key ?? '').toUpperCase();
  if (backendLevel && FACTOR_LEVEL_BY_SCORE.size) {
    const matched = FACTOR_LEVELS.find((level) => level.key === backendLevel);
    if (matched) {
      return {
        ...matched,
        title: factor.factor_level_label ?? factor.factor_level_projection?.label ?? matched.title,
        recommendation: factor.factor_level_projection?.description ?? matched.recommendation,
      };
    }
  }
  const rankIc = factorMetricValue(factor, 'rank_ic');
  const ir = factorMetricValue(factor, 'ir');
  if (rankIc === null || ir === null) {
    return FACTOR_LEVELS.find((level) => level.key === (factor.tier_level === 'F1' ? 'B' : 'C')) ?? null;
  }
  const score = Math.min(metricLevelScore(Math.abs(rankIc), 'rank_ic'), metricLevelScore(Math.abs(ir), 'ir'));
  return FACTOR_LEVEL_BY_SCORE.get(score) ?? null;
}

function factorLevelScore(factor: ApiFactorListItem): number | null {
  return factorLevel(factor)?.score ?? null;
}

function referenceDiagnosticLabel(summary: ApiFactorDiagnosticSummary | null | undefined): string | null {
  if (!summary || String(summary.status ?? '').toUpperCase() !== 'REFERENCE_ONLY') return null;
  const lineage = summary.data_lineage as Record<string, unknown> | undefined;
  const lineageLabel = typeof lineage?.label === 'string' ? lineage.label : null;
  if (lineageLabel) return lineageLabel.replace(/^参考口径：?/, '');
  const sourceName = typeof summary.source_factor_name === 'string' ? summary.source_factor_name : null;
  const sourceId = typeof summary.source_factor_id === 'string' ? summary.source_factor_id : null;
  return sourceName ?? sourceId ?? '默认因子';
}

function needsRealDiagnosticPreview(factor: ApiFactorListItem): boolean {
  const summary = factor.latest_diagnostic_summary;
  const status = String(summary?.status ?? '').toUpperCase();
  const lineage = summary?.data_lineage as Record<string, unknown> | undefined;
  const lineageKind = String(lineage?.kind ?? '').toUpperCase();
  if (lineageKind === 'FACTOR_EXPRESSION_PREVIEW' || status === 'PREVIEW') return false;
  if (factor.last_diagnostic_run_id && status !== 'REFERENCE_ONLY') return false;
  return status === 'REFERENCE_ONLY' || !summary;
}

function isFactorOffline(factor: ApiFactorListItem): boolean {
  const lifecycle = String(factor.lifecycle_status ?? '').toUpperCase();
  return lifecycle === 'DEPRECATED' || lifecycle === 'PRUNED' || Boolean(factor.offline_at);
}

function previewFactorIdsForPayload(payload: ApiFactorListResponse): string[] {
  return payload.items.filter((factor) => !isFactorOffline(factor) && needsRealDiagnosticPreview(factor)).map((factor) => factor.id);
}

export async function previewFactorDiagnosticsForLibrary(
  previewFactorDiagnostics: FactorDiagnosticPreviewRequester | undefined,
  factorIds: string[],
): Promise<ApiFactorDiagnosticPreview | null> {
  if (!previewFactorDiagnostics || factorIds.length === 0) return null;
  const request: ApiFactorDiagnosticPreviewPayload = {
    batch: true,
    factor_ids: factorIds,
    diagnostic_mode: 'SANDBOX',
    include: ['ic', 'ir', 'groups', 'turnover', 'correlation', 'blockers'],
  };

  try {
    const preview = await previewFactorDiagnostics(request);
    if (preview?.items?.length) return preview;
  } catch {
    // Fallback below keeps healthy factors populated when one expression breaks batch preview.
  }

  const items: NonNullable<ApiFactorDiagnosticPreview['items']> = [];
  for (const factorId of factorIds) {
    try {
      const preview = await previewFactorDiagnostics({ ...request, factor_ids: [factorId] });
      items.push(...(preview?.items ?? []));
    } catch {
      // Leave the individual unsupported factor in its explicit no-diagnostic state.
    }
  }
  return items.length ? { mode: 'BATCH', status: 'PREVIEW', items } : null;
}

function previewRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mergeDiagnosticPreview(
  current: ApiFactorListResponse,
  preview: ApiFactorDiagnosticPreview,
): ApiFactorListResponse {
  const previewItems = new Map<string, Record<string, unknown>>();
  (preview.items ?? []).forEach((item) => {
    const record = previewRecord(item);
    const factorId = typeof record?.factor_id === 'string' ? record.factor_id : null;
    if (factorId && record) previewItems.set(factorId, record);
  });
  if (!previewItems.size) return current;
  return {
    ...current,
    items: current.items.map((factor) => {
      const record = previewItems.get(factor.id);
      if (!record) return factor;
      const latest = previewRecord(record.latest_diagnostic_summary) as ApiFactorDiagnosticSummary | null;
      const batch = previewRecord(record.batch_diagnostic_summary) as Partial<ApiFactorBatchDiagnosticSummary> | null;
      const icSeries = Array.isArray(latest?.ic_series)
        ? latest.ic_series
            .map((point) => ({ date: String(point.date ?? ''), value: typeof point.rank_ic === 'number' ? point.rank_ic : NaN }))
            .filter((point) => Number.isFinite(point.value))
        : factor.ic_sparkline;
      const qualityView = latest
        ? {
            ...(factor.quality_view ?? {}),
            rank_ic: typeof latest.rank_ic === 'number' ? latest.rank_ic : factor.quality_view?.rank_ic ?? null,
            ir: typeof latest.ir === 'number' ? latest.ir : factor.quality_view?.ir ?? null,
            coverage: typeof latest.coverage === 'number' ? latest.coverage : factor.quality_view?.coverage ?? null,
            sparkline: icSeries,
            sparkline_window: '真实口径最近12期',
          }
        : factor.quality_view;
      return {
        ...factor,
        ui_state: typeof record.ui_state === 'string' ? record.ui_state as ApiFactorListItem['ui_state'] : factor.ui_state,
        ui_state_label: typeof record.ui_state_label === 'string' ? record.ui_state_label : factor.ui_state_label,
        diagnostic_status: typeof record.diagnostic_status === 'string' ? record.diagnostic_status as ApiFactorListItem['diagnostic_status'] : factor.diagnostic_status,
        latest_diagnostic_summary: latest ?? factor.latest_diagnostic_summary,
        batch_diagnostic_summary: batch ? { ...factor.batch_diagnostic_summary, ...batch } : factor.batch_diagnostic_summary,
        blocker_reason_summary: previewRecord(record.blocker_reason_summary) as ApiFactorListItem['blocker_reason_summary'] ?? factor.blocker_reason_summary,
        strategy_creation_risk: previewRecord(record.strategy_creation_risk) as ApiFactorListItem['strategy_creation_risk'] ?? factor.strategy_creation_risk,
        correlation_cluster_summary: previewRecord(record.correlation_cluster_summary) as ApiFactorListItem['correlation_cluster_summary'] ?? factor.correlation_cluster_summary,
        ic_sparkline: icSeries,
        ic_sparkline_window: latest ? '真实口径最近12期' : factor.ic_sparkline_window,
        quality_view: qualityView,
      };
    }),
  };
}

function factorUpdatedAt(factor: ApiFactorListItem): string | null {
  const compliance = factor.latest_diagnostic_summary?.compliance_trail as Record<string, unknown> | undefined;
  return factor.updated_at ?? recordString(compliance, 'diagnosed_at') ?? factor.created_at ?? null;
}

function factorTimestamp(factor: ApiFactorListItem): number | null {
  const value = factorUpdatedAt(factor);
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatFactorUpdatedAt(factor: ApiFactorListItem): string {
  const value = factorUpdatedAt(factor);
  return value ? formatDateTime(value) : '尚未记录';
}

function factorPruneMvpName(factor: ApiFactorListItem): string | null {
  const detail = previewRecord(factor.offline_detail);
  const requestDetail = previewRecord(detail?.request_detail);
  const nestedOfflineDetail = previewRecord(requestDetail?.offline_detail);
  const comparison = previewRecord(detail?.comparison) ?? previewRecord(nestedOfflineDetail?.comparison);
  const mvp = previewRecord(comparison?.mvp);
  const name = typeof mvp?.factor_name === 'string'
    ? mvp.factor_name.trim()
    : typeof mvp?.name === 'string'
      ? mvp.name.trim()
      : '';
  if (name) return name;
  const id = typeof mvp?.factor_id === 'string'
    ? mvp.factor_id.trim()
    : typeof detail?.keep_factor_id === 'string'
      ? detail.keep_factor_id.trim()
      : '';
  return id || null;
}

function factorOfflineReason(factor: ApiFactorListItem): string {
  const lifecycle = String(factor.lifecycle_status ?? '').toUpperCase();
  if (lifecycle === 'PRUNED' || String(factor.offline_command ?? '').toUpperCase() === 'PRUNE') {
    const mvpName = factorPruneMvpName(factor);
    if (mvpName) return `冗余裁剪：同簇高相关且弱于${mvpName}`;
  }
  if (factor.offline_reason) return factor.offline_reason;
  if (lifecycle === 'DEPRECATED') return '强制下线';
  if (lifecycle === 'PRUNED') return '冗余裁剪';
  return '未下线';
}

function formatFactorOfflineAt(factor: ApiFactorListItem): string {
  return factor.offline_at ? formatDateTime(factor.offline_at) : '线上';
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: FactorSortDirection,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const diff = left - right;
  return direction === 'asc' ? diff : -diff;
}

function compareFactorsBySort(left: ApiFactorListItem, right: ApiFactorListItem, sort: FactorSortState): number {
  const diff = sort.key === 'rank_ic'
    ? compareNullableNumber(factorRankIc(left), factorRankIc(right), sort.direction)
    : sort.key === 'level'
      ? compareNullableNumber(factorLevelScore(left), factorLevelScore(right), sort.direction)
      : compareNullableNumber(factorTimestamp(left), factorTimestamp(right), sort.direction);
  if (diff !== 0) return diff;
  return (left.descriptor?.canonical_id ?? left.id).localeCompare(right.descriptor?.canonical_id ?? right.id);
}

function ariaSortFor(key: FactorSortKey, sort: FactorSortState): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  tooltip,
}: {
  label: string;
  sortKey: FactorSortKey;
  sort: FactorSortState;
  onSort: (key: FactorSortKey) => void;
  tooltip?: JSX.Element;
}): JSX.Element {
  const active = sort.key === sortKey;
  return (
    <div className="factor-th-content">
      <button
        type="button"
        className={`factor-sort-header ${active ? 'is-active' : ''}`}
        onClick={() => onSort(sortKey)}
        aria-label={`${label}排序`}
      >
        <span>{label}</span>
        <span className="factor-sort-indicator" aria-hidden="true">
          {active ? (sort.direction === 'desc' ? '↓' : '↑') : '↕'}
        </span>
      </button>
      {tooltip}
    </div>
  );
}

function HeaderWithTooltip({
  label,
  tooltipLabel,
  lines,
}: {
  label: string;
  tooltipLabel: string;
  lines: string[];
}): JSX.Element {
  return (
    <div className="factor-th-content">
      <span>{label}</span>
      <HelpTooltip label={tooltipLabel} lines={lines} />
    </div>
  );
}

function longShortSpread(factor: ApiFactorListItem): number | null {
  const returns = factor.latest_diagnostic_summary?.group_returns ?? [];
  if (returns.length < 2) return null;
  const first = returns[0]?.mean_return;
  const last = returns.at(-1)?.mean_return;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return Number(first) - Number(last);
}

function factorCoverage(factor: ApiFactorListItem): number | null {
  const coverage = factor.latest_diagnostic_summary?.coverage ?? factor.batch_diagnostic_summary?.coverage;
  return typeof coverage === 'number' && Number.isFinite(coverage) ? coverage : null;
}

function factorGroupReturnShape(factor: ApiFactorListItem): { available: boolean; inverted: boolean; monotonicGood: boolean } {
  const summary = factor.latest_diagnostic_summary;
  const monotonicity = summary?.monotonicity;
  if (monotonicity && typeof monotonicity === 'object' && !Array.isArray(monotonicity)) {
    const available = Boolean((monotonicity as Record<string, unknown>).available);
    if (available) {
      return {
        available,
        inverted: Boolean((monotonicity as Record<string, unknown>).inverted),
        monotonicGood: (monotonicity as Record<string, unknown>).monotonic_good === true,
      };
    }
  }
  const values = (summary?.group_returns ?? [])
    .map((item) => item.mean_return)
    .filter(isNumber);
  if (values.length < 2) return { available: false, inverted: false, monotonicGood: false };
  const tolerance = 1e-6;
  const latestInverted = values[0] + tolerance < values.at(-1)!;
  const edgeSeries = (summary?.group_return_series ?? [])
    .map((item) => {
      const groupValues = (item.groups ?? [])
        .map((group) => group.mean_return)
        .filter(isNumber);
      const q1 = groupValues.length >= 2
        ? groupValues[0]
        : item.q1_mean_return;
      const q5 = groupValues.length >= 2
        ? groupValues.at(-1)
        : item.q5_mean_return;
      return isNumber(q1) && isNumber(q5) ? { q1, q5 } : null;
    })
    .filter((item): item is { q1: number; q5: number } => Boolean(item));
  let streak = 0;
  for (let index = GROUP_MONOTONICITY_WINDOW_PERIODS - 1; index < edgeSeries.length; index += 1) {
    const rollingSlice = edgeSeries.slice(index + 1 - GROUP_MONOTONICITY_WINDOW_PERIODS, index + 1);
    const q1Average = rollingSlice.reduce((total, item) => total + item.q1, 0) / rollingSlice.length;
    const q5Average = rollingSlice.reduce((total, item) => total + item.q5, 0) / rollingSlice.length;
    streak = q1Average + tolerance < q5Average ? streak + 1 : 0;
  }
  const inverted = streak >= GROUP_INVERSION_REQUIRED_STREAK;
  let nonIncreasingPairs = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] + tolerance >= values[index]) nonIncreasingPairs += 1;
  }
  return {
    available: true,
    inverted,
    monotonicGood: !inverted && !latestInverted && nonIncreasingPairs >= Math.max(1, values.length - 2),
  };
}

function factorRecentIcDecay(factor: ApiFactorListItem): boolean {
  const series = (factor.latest_diagnostic_summary?.ic_series ?? [])
    .map((point) => point.rank_ic ?? point.ic)
    .filter(isNumber);
  if (series.length < 6) return false;
  const recent = series.slice(-3);
  const prior = series.slice(0, Math.max(3, series.length - 3));
  const priorMean = prior.reduce((total, value) => total + value, 0) / prior.length;
  const recentMean = recent.reduce((total, value) => total + value, 0) / recent.length;
  if (Math.abs(priorMean) < 0.015) return false;
  if (priorMean * recentMean < 0 && Math.abs(recentMean) >= 0.005) return true;
  return Math.abs(recentMean) < Math.max(0.015, Math.abs(priorMean) * 0.55);
}

function factorRiskCodeSet(factor: ApiFactorListItem): Set<string> {
  const codes = new Set<string>();
  const collect = (items: Array<Record<string, unknown>> | undefined) => {
    (items ?? []).forEach((item) => {
      const code = String(item.code ?? '').toUpperCase();
      if (code) codes.add(code);
    });
  };
  collect(factor.strategy_creation_risk?.warnings);
  collect(factor.strategy_creation_risk?.hard_blockers);
  collect(factor.readiness_blockers);
  collect(factor.blocker_reason_summary?.reasons);
  return codes;
}

function factorHasAnyRiskCode(factor: ApiFactorListItem, riskCodes: Set<string>): boolean {
  const codes = factorRiskCodeSet(factor);
  return Array.from(riskCodes).some((code) => codes.has(code));
}

function factorPolicyWarningCount(factor: ApiFactorListItem): number {
  const strategyWarnings = factor.strategy_creation_risk?.warnings?.length
    ?? Number(factor.strategy_creation_risk?.warning_count ?? 0);
  const summaryWarnings = factor.blocker_reason_summary?.reasons?.filter((reason) => String(reason.severity ?? '').toLowerCase() === 'warning').length
    ?? Number(factor.blocker_reason_summary?.warning_count ?? 0);
  const readinessWarnings = factor.readiness_blockers.filter((blocker) => readinessBlockerSeverity(blocker) === 'warning').length;
  return strategyWarnings + summaryWarnings + readinessWarnings;
}

function factorPolicyHardBlockerCount(factor: ApiFactorListItem): number {
  const strategyBlockers = factor.strategy_creation_risk?.hard_blockers?.length
    ?? Number(factor.strategy_creation_risk?.blocked_count ?? 0);
  const summaryBlockers = factor.blocker_reason_summary?.reasons?.filter((reason) => String(reason.severity ?? '').toLowerCase() === 'blocker').length
    ?? Number(factor.blocker_reason_summary?.blocked_count ?? 0);
  const readinessBlockers = factor.readiness_blockers.filter((blocker) => readinessBlockerSeverity(blocker) === 'blocker').length;
  return strategyBlockers + summaryBlockers + readinessBlockers;
}

function localizeFactorGateText(value: unknown, code?: unknown): string {
  const raw = String(value ?? '').trim();
  const normalizedCode = String(code ?? '').toUpperCase();
  if (!raw) return raw;
  if (normalizedCode === 'FACTOR_ADMISSION_10Y_REPAIR' && raw === '10Y repair queue') {
    return '10Y 准入补源队列';
  }
  if (normalizedCode === 'FULL_READY_ARCHIVAL_GAP' && raw === 'Full Ready archival gap') {
    return 'Full Ready 归档缺口';
  }
  if (normalizedCode === 'PIT_METADATA_RECOMPUTE_MISMATCH' && raw === 'Metadata mismatch') {
    return 'PIT 元数据重算差异';
  }
  if (normalizedCode === 'PRICE_10Y_CURRENT_CORE_MISSING' && raw === 'Current core price gap') {
    return '当前核心价格缺口';
  }
  if (normalizedCode === 'PRICE_10Y_SOURCE_EMPTY' && raw === '10Y price source empty') {
    return '10Y 价格来源为空';
  }
  if (normalizedCode === 'UNIVERSE_10Y_HISTORY_BLOCKED' && raw === '10Y universe history missing') {
    return '10Y 样本池历史缺失';
  }
  return raw
    .replace(
      /(\d+) active-in-window symbols still need price evidence or identity repair; factor admission remains allowed with repair disclosure\.?/g,
      '$1 个窗口内活跃标的仍需补齐价格证据或身份映射；因子准入仍允许，但需保留修复披露。',
    )
    .replace(
      /(\d+) pre-window or non-core symbols remain in the Full Ready repair backlog\.?/g,
      '$1 个前置窗口或非核心标的仍在 Full Ready 归档修复队列。',
    )
    .replace(
      /(\d+) active 10Y symbols are missing by recompute but absent from snapshot metadata\.?/g,
      '$1 个 10Y 活跃标的经重算缺失，但未出现在快照元数据缺口中。',
    )
    .replace(
      /(\d+) current core symbols have no PIT price coverage in the 10Y admission window\.?/g,
      '$1 个当前核心标的在 10Y 准入窗口内缺少 PIT 价格覆盖。',
    )
    .replace(
      '10Y factor admission requires auditable PIT price rows before diagnostics can run.',
      '10Y 因子准入需要可审计的 PIT 价格行，补齐前不能运行正式诊断。',
    )
    .replace(
      '10Y factor admission requires historical universe anchors, not a current-only fallback.',
      '10Y 因子准入需要历史样本池锚点，不能只用当前样本池兜底。',
    )
    .replace(
      '10Y factor admission found only current-universe anchors; sandbox diagnostics remain available while the historical universe repair queue is open.',
      '10Y 因子准入目前只有当前样本池锚点；历史样本池修复队列未闭合时，Sandbox 诊断仍可用。',
    );
}

function sandboxGapBrief(factor: ApiFactorListItem): string {
  const blocker = factor.readiness_blockers[0] as Record<string, unknown> | undefined;
  const windows = Array.isArray(blocker?.missing_windows) ? blocker.missing_windows : [];
  const firstWindow = windows[0] as Record<string, unknown> | undefined;
  const label = typeof firstWindow?.label === 'string' ? firstWindow.label : undefined;
  const start = typeof firstWindow?.start === 'string' ? firstWindow.start : undefined;
  const end = typeof firstWindow?.end === 'string' ? firstWindow.end : undefined;
  const blockerMessage = typeof blocker?.message === 'string' ? blocker.message : undefined;
  const gapText = typeof factor.diagnostic_gap_summary?.rank_ic === 'string'
    ? factor.diagnostic_gap_summary.rank_ic
    : undefined;
  if (label || start || end) {
    const windowLabel = label ?? [start, end].filter(Boolean).join('-');
    return `由于缺失 ${windowLabel} 样本，该因子无法进行 Full Ready 认证。`;
  }
  if (blockerMessage) return blockerMessage;
  return gapText ?? '完整 PIT 窗口尚未通过，当前只能在 Sandbox 环境先跑研究态诊断。';
}

function factorDisplayStatus(factor: ApiFactorListItem): string {
  const latestStatus = String(factor.latest_diagnostic_summary?.status ?? '').toUpperCase();
  if (latestStatus === 'COMPLETED' || latestStatus === 'FAILED') return latestStatus;
  return factor.diagnostic_status;
}

function factorUiState(factor: ApiFactorListItem): { state: FactorUiState; label: string } {
  const explicitState = String(factor.ui_state ?? '').toLowerCase();
  const lifecycle = String(factor.lifecycle_status ?? '').toUpperCase();
  const diagnostic = factorDisplayStatus(factor).toUpperCase();
  const levelScore = factorLevelScore(factor);
  const groupShape = factorGroupReturnShape(factor);
  const summary = factor.latest_diagnostic_summary;
  const summaryStatus = String(summary?.status ?? '').toUpperCase();
  const rankIc = factorMetricValue(factor, 'rank_ic');
  const ir = factorMetricValue(factor, 'ir');
  const coverage = factorCoverage(factor);
  const hasCompletedMetrics = Boolean(summary) && rankIc !== null && ir !== null;
  const isReferenceOnly = summaryStatus === 'REFERENCE_ONLY';
  const hasPolicyWarnings = factorPolicyWarningCount(factor) > 0;
  const hasPolicyHardBlockers = factorPolicyHardBlockerCount(factor) > 0;
  const hasCalibrationRisk = factorHasAnyRiskCode(
    factor,
    FACTOR_WARNING_GATE_CODES,
  ) || factorRecentIcDecay(factor) || isReferenceOnly;
  const missingFormalDiagnostics =
    !hasCompletedMetrics ||
    summaryStatus === 'PREVIEW' ||
    (
      (diagnostic === 'BLOCKED_PIT' || diagnostic === 'BLOCKED_DATA')
      && !hasCompletedMetrics
    );
  if (isFactorOffline(factor)) {
    return { state: 'decayed', label: lifecycle === 'PRUNED' ? '冗余挂起' : '已下线' };
  }
  if (
    lifecycle === 'DECAYED' ||
    diagnostic === 'FAILED' ||
    (levelScore !== null && levelScore <= 2) ||
    groupShape.inverted ||
    factorHasAnyRiskCode(factor, new Set(['FACTOR_GRADE_DECAYED', 'GROUP_RETURNS_INVERTED']))
  ) {
    return { state: 'decayed', label: UI_STATE_LABELS.decayed };
  }
  if (hasPolicyHardBlockers) {
    return { state: 'sandbox', label: UI_STATE_LABELS.sandbox };
  }
  if (missingFormalDiagnostics) {
    return { state: 'sandbox', label: UI_STATE_LABELS.sandbox };
  }
  if (
    explicitState === 'robust' &&
    !hasPolicyHardBlockers &&
    !hasPolicyWarnings &&
    !hasCalibrationRisk &&
    (coverage === null || coverage > 90) &&
    (!groupShape.available || groupShape.monotonicGood)
  ) {
    return { state: 'robust', label: factor.ui_state_label || UI_STATE_LABELS.robust };
  }
  if (
    (explicitState === 'robust' ||
      explicitState === 'needs_calibration' ||
      explicitState === 'decayed' ||
      explicitState === 'sandbox') &&
    explicitState !== 'robust' &&
    !(explicitState === 'sandbox' && !missingFormalDiagnostics)
  ) {
    return {
      state: explicitState,
      label: factor.ui_state_label || UI_STATE_LABELS[explicitState],
    };
  }
  const isRobust =
    levelScore !== null &&
    levelScore >= 3 &&
    coverage !== null &&
    coverage > 90 &&
    groupShape.monotonicGood &&
    !hasPolicyHardBlockers &&
    !hasPolicyWarnings &&
    !hasCalibrationRisk;
  if (diagnostic === 'COMPLETED' && isRobust) {
    return { state: 'robust', label: UI_STATE_LABELS.robust };
  }
  if (diagnostic === 'COMPLETED' || diagnostic === 'READY_TO_DIAGNOSE') {
    return { state: 'needs_calibration', label: UI_STATE_LABELS.needs_calibration };
  }
  return { state: 'sandbox', label: UI_STATE_LABELS.sandbox };
}

function creationRiskReasons(factor: ApiFactorListItem, severity: 'warning' | 'blocker'): string[] {
  const risk = factor.strategy_creation_risk;
  const items = severity === 'warning' ? risk?.warnings : risk?.hard_blockers;
  return (items ?? [])
    .map((item) => localizeFactorGateText(item.label || item.message || item.code, item.code))
    .filter((value): value is string => Boolean(value));
}

function blockerSummaryReasons(factor: ApiFactorListItem, severity: 'warning' | 'blocker'): string[] {
  const summary = factor.blocker_reason_summary;
  return (summary?.reasons ?? [])
    .filter((reason) => String(reason.severity ?? '').toLowerCase() === severity)
    .map((reason) => localizeFactorGateText(reason.label || reason.message || reason.code, reason.code))
    .filter((value): value is string => Boolean(value));
}

function readinessBlockerSeverity(blocker: Record<string, unknown>): 'warning' | 'blocker' {
  const explicitSeverity = String(blocker.severity ?? '').toLowerCase();
  if (explicitSeverity === 'warning' || explicitSeverity === 'warn') return 'warning';
  if (explicitSeverity === 'blocker' || explicitSeverity === 'hard_blocker') return 'blocker';
  const code = String(blocker.code ?? '').toUpperCase();
  if (FACTOR_WARNING_GATE_CODES.has(code)) return 'warning';
  if (FACTOR_HARD_GATE_CODES.has(code) || code.includes('PIT')) return 'blocker';
  return 'blocker';
}

function readinessBlockerReasons(factor: ApiFactorListItem, severity: 'warning' | 'blocker'): string[] {
  return factor.readiness_blockers
    .filter((blocker) => readinessBlockerSeverity(blocker) === severity)
    .map((blocker) => localizeFactorGateText(blocker.message ?? blocker.code ?? STATUS_LABELS[factor.diagnostic_status] ?? '数据门禁阻断', blocker.code))
    .filter(Boolean);
}

function uniqueReasonLines(reasons: string[]): string[] {
  const seen = new Set<string>();
  return reasons
    .map((reason) => reason.trim())
    .filter((reason) => {
      if (!reason || seen.has(reason)) return false;
      seen.add(reason);
      return true;
    });
}

function normalizeDiagnosticReason(reason: string): string {
  return reason
    .replace(/^(硬阻断|风险提示|治理阻断|观察风险|存在降权\/校准风险)[:：]\s*/, '')
    .replace(/[。；;，,\s]+$/u, '')
    .trim();
}

function diagnosticSentence(reason: string): string {
  const normalized = normalizeDiagnosticReason(reason);
  return normalized ? `${normalized}。` : '';
}

function metricSnapshotReason(metricParts: string[]): string | null {
  return metricParts.length ? `当前指标：${metricParts.join('，')}。` : null;
}

function factorStatusReasonLines(factor: ApiFactorListItem): string[] {
  const uiState = factorUiState(factor);
  const explicitState = String(factor.ui_state ?? '').toLowerCase();
  const hasExplicitState = explicitState === uiState.state;
  const level = factorLevel(factor);
  const coverage = factorCoverage(factor);
  const groupShape = factorGroupReturnShape(factor);
  const rankIc = factorMetricValue(factor, 'rank_ic');
  const ir = factorMetricValue(factor, 'ir');
  const diagnosticStatus = factorDisplayStatus(factor);
  const lifecycleStatus = String(factor.lifecycle_status ?? '').toUpperCase();
  const hardReasons = uniqueReasonLines([
    ...creationRiskReasons(factor, 'blocker'),
    ...blockerSummaryReasons(factor, 'blocker'),
    ...readinessBlockerReasons(factor, 'blocker'),
  ]);
  const warningReasons = uniqueReasonLines([
    ...creationRiskReasons(factor, 'warning'),
    ...blockerSummaryReasons(factor, 'warning'),
    ...readinessBlockerReasons(factor, 'warning'),
  ]);
  const metricParts = [
    level ? `Grade ${level.key}（${level.title}）` : null,
    coverage !== null ? `覆盖率 ${pct(coverage)}` : null,
    rankIc !== null ? `Rank IC ${num(rankIc)}` : null,
    ir !== null ? `IR ${num(ir, 2)}` : null,
  ].filter((part): part is string => Boolean(part));
  const lines: string[] = [];
  const metricLine = metricSnapshotReason(metricParts);

  if (uiState.state === 'robust') {
    if (
      level &&
      level.score >= 3 &&
      coverage !== null &&
      coverage > 90 &&
      !factorRecentIcDecay(factor) &&
      (!groupShape.available || groupShape.monotonicGood)
    ) {
      lines.push(`满足稳健硬指标：${metricParts.join('，')}。`);
    } else if (hasExplicitState) {
      lines.push(`后端治理投影返回“${uiState.label}”；当前可见指标为 ${metricParts.join('，') || '待补齐'}。`);
    }
    if (groupShape.available && groupShape.monotonicGood) lines.push('分组收益单调性良好，未出现倒挂。');
    if (!hardReasons.length && !warningReasons.length) lines.push('未返回硬阻断或降权风险。');
    return uniqueReasonLines(lines).slice(0, 2);
  }

  if (uiState.state === 'needs_calibration') {
    if (warningReasons.length) lines.push(`主要风险：${diagnosticSentence(warningReasons[0])}`);
    else if (coverage !== null && coverage < 90) lines.push(`覆盖率 ${pct(coverage)} 低于 90% 稳健门槛。`);
    else if (factorRecentIcDecay(factor)) lines.push('近期 IC 出现显著衰减，需要复核稳定性。');
    else if (groupShape.available && !groupShape.monotonicGood) lines.push('分组收益单调性未通过，需复核 Q1-Q5 排序。');
    if (!lines.length) lines.push(`Grade S/A/B 因子未完全满足稳健条件；当前指标为 ${metricParts.join('，') || '待补齐'}。`);
    if (metricLine && !lines.some((line) => line.includes('当前指标'))) lines.push(metricLine);
    return uniqueReasonLines(lines).slice(0, 2);
  }

  if (uiState.state === 'decayed') {
    if (hardReasons.length) lines.push(`核心阻断：${diagnosticSentence(hardReasons[0])}`);
    else if (isFactorOffline(factor)) lines.push(`因子已下线：${factorOfflineReason(factor)}。`);
    else if (level && level.score <= 2) lines.push(`因子级别为 Grade ${level.key}（${level.title}），低于生产准入线。`);
    else if (groupShape.available && groupShape.inverted) lines.push('分层收益出现倒挂，Q1 收益不应优于 Q5。');
    else if (diagnosticStatus === 'FAILED' || lifecycleStatus === 'DECAYED') {
      lines.push(`诊断/生命周期状态为 ${STATUS_LABELS[diagnosticStatus] ?? diagnosticStatus}。`);
    }
    if (!lines.length) lines.push(`治理投影返回“${uiState.label}”，需物理封存并移入归档复盘。`);
    if (metricLine) lines.push(metricLine);
    return uniqueReasonLines(lines).slice(0, 2);
  }

  if (uiState.state === 'sandbox') {
    if (!factor.latest_diagnostic_summary || rankIc === null || ir === null) lines.push('缺少完整 IC/IR 诊断数据。');
    else if (hardReasons.length) lines.push(`治理阻断：${diagnosticSentence(hardReasons[0])}`);
    else if (warningReasons.length) lines.push(`观察风险：${diagnosticSentence(warningReasons[0])}`);
    if (coverage !== null) lines.push(`数据治理：当前覆盖率 ${pct(coverage)}，补齐后再晋级。`);
    if (!lines.length) lines.push(`诊断状态为 ${STATUS_LABELS[diagnosticStatus] ?? diagnosticStatus}，尚未完成正式 PIT 诊断。`);
    return uniqueReasonLines(lines).slice(0, 2);
  }

  return [UI_STATE_MANAGEMENT_ACTIONS[uiState.state]];
}

type FactorAuditEntry = {
  id: string;
  title: string;
  at?: string | null;
  detail: string;
};

type GovernancePruneComparisonSide = {
  factorId: string;
  factorName: string | null;
  rankIc: number | null;
  ir: number | null;
  coverage: number | null;
};

type GovernancePruneComparison = {
  candidate: GovernancePruneComparisonSide;
  mvp: GovernancePruneComparisonSide;
  correlation: number | null;
};

const GOVERNANCE_KIND_LABELS: Record<string, string> = {
  DEPRECATE: '强制下线',
  PRUNE: '冗余裁剪',
  WATCH: '观察',
  REVIEW: '复核',
  DECAYED: '退化观察',
  CROWDED: '拥挤',
  SUSPENDED: '暂停纳入',
  FACTOR_MODEL_SUGGESTION: '策略草稿建议',
  FACTOR_OPTIMIZATION: '因子优化',
};

function governanceKindLabel(kind: string): string {
  return GOVERNANCE_KIND_LABELS[String(kind ?? '').toUpperCase()] ?? '治理任务';
}

function governanceOfflineEffectCopy(action: ApiFactorGovernanceAction): string {
  const command = String(action.command ?? action.kind ?? '').toUpperCase();
  if (command === 'PUBLISH_OPTIMIZED_FACTOR') {
    return '确认入库会写入新的反向因子版本；来源因子仍按封存复盘口径保留，新的因子需继续纳入后续策略评估。';
  }
  if (command === 'PRUNE') {
    return '冗余裁剪会写入“冗余挂起”状态；冗余因子将从策略配置、因子模型预览和算力预览中排除。';
  }
  return '强制下线会写入“已强制下线”状态；因子将从策略配置、因子模型预览和算力预览中排除。';
}

function governanceActionCommand(action: ApiFactorGovernanceAction): string {
  return String(action.command ?? action.kind ?? '').toUpperCase();
}

function governancePruneComparison(action: ApiFactorGovernanceAction): GovernancePruneComparison | null {
  if (governanceActionCommand(action) !== 'PRUNE') return null;
  const detail = previewRecord(action.offline_detail);
  const comparison = previewRecord(detail?.comparison);
  const candidate = previewRecord(comparison?.candidate);
  const mvp = previewRecord(comparison?.mvp);
  const factorIds = (action.affected_factor_ids ?? action.factor_ids ?? []).map(String);
  const candidateId = recordString(candidate ?? undefined, 'factor_id') ?? factorIds[0] ?? '';
  const mvpId = recordString(mvp ?? undefined, 'factor_id') ?? action.keep_factor_id ?? '';
  if (!candidateId || !mvpId) return null;
  return {
    candidate: {
      factorId: candidateId,
      factorName: recordString(candidate ?? undefined, 'factor_name') ?? recordString(candidate ?? undefined, 'name'),
      rankIc: recordNumber(candidate ?? undefined, 'rank_ic'),
      ir: recordNumber(candidate ?? undefined, 'ir'),
      coverage: recordNumber(candidate ?? undefined, 'coverage'),
    },
    mvp: {
      factorId: mvpId,
      factorName: recordString(mvp ?? undefined, 'factor_name') ?? recordString(mvp ?? undefined, 'name'),
      rankIc: recordNumber(mvp ?? undefined, 'rank_ic'),
      ir: recordNumber(mvp ?? undefined, 'ir'),
      coverage: recordNumber(mvp ?? undefined, 'coverage'),
    },
    correlation: recordNumber(detail ?? undefined, 'correlation') ?? recordNumber(action.criteria, 'correlation'),
  };
}

function FactorGovernanceIdentity({ name, id }: { name: string; id: string }): JSX.Element {
  return (
    <span className="factor-governance-identity">
      <strong>{name}</strong>
      <code>{id}</code>
    </span>
  );
}

function isGovernanceTaskAction(action: ApiFactorGovernanceAction): boolean {
  const kind = String(action.kind ?? '').toUpperCase();
  const command = String(action.command ?? '').toUpperCase();
  return kind === 'FACTOR_MODEL_SUGGESTION' || kind === 'FACTOR_OPTIMIZATION' || ['DEPRECATE', 'PRUNE', 'PUBLISH_OPTIMIZED_FACTOR'].includes(command || kind);
}

function governanceActionClass(action: ApiFactorGovernanceAction): string {
  const severity = String(action.severity ?? '').toLowerCase();
  if (severity === 'danger') return 'factor-governance-action--danger';
  if (severity === 'warning') return 'factor-governance-action--warn';
  return 'factor-governance-action--info';
}

function buildGovernanceSuggestionRoute(action: ApiFactorGovernanceAction): string {
  const targetRoute = String(action.target?.route ?? '#/factor-models/new');
  const params = new URLSearchParams(action.target?.query ?? {});
  if (!params.has('source')) params.set('source', 'governance_queue');
  if (!params.has('factorIds') && action.factor_ids.length) params.set('factorIds', action.factor_ids.join(','));
  if (!params.has('weights') && action.suggested_weights?.length) {
    params.set('weights', action.suggested_weights.map((item) => String(item.weight_pct)).join(','));
  }
  if (!params.has('directions') && action.suggested_weights?.length) {
    params.set('directions', action.suggested_weights.map((item) => String(item.direction)).join(','));
  }
  const query = params.toString();
  return `${targetRoute}${query ? `${targetRoute.includes('?') ? '&' : '?'}${query}` : ''}`;
}

function openGovernanceAction(action: ApiFactorGovernanceAction): void {
  const route = buildGovernanceSuggestionRoute(action);
  const withoutHash = route.startsWith('#') ? route.slice(1) : route;
  navigateTo(withoutHash.startsWith('/') ? withoutHash : `/${withoutHash}`);
}

function buildLocalGovernanceActions(
  factors: ApiFactorListItem[],
  highCorrelationIds: Set<string>,
): ApiFactorGovernanceAction[] {
  const actions: ApiFactorGovernanceAction[] = [];
  factors.forEach((factor) => {
    if (isFactorOffline(factor)) return;
    const status = String(factor.lifecycle_status ?? '').toUpperCase();
    const state = factorUiState(factor).state;
    if (highCorrelationIds.has(factor.id)) {
      actions.push({
        id: `high-correlation-${factor.id}`,
        kind: 'REVIEW',
        label: '复核',
        title: `${factor.name} 进入相关性复核`,
        detail: '与当前相关性视图中的因子高度重合，建议先完成治理复核后再进入新组合。',
        factor_ids: [factor.id],
        severity: 'warning',
      });
    }
    if (status === 'DECAYED' || state === 'decayed') {
      actions.push({
        id: `decayed-${factor.id}`,
        kind: 'DECAYED',
        label: '退化观察',
        title: `${factor.name} 出现表现退化`,
        detail: '最近诊断相对发布基线走弱，建议在因子库中降权展示并观察下一次 OOS 结果。',
        factor_ids: [factor.id],
        severity: 'warning',
      });
    }
  });
  const autoMined = factors.find((factor) => factor.source === 'AUTO_MINED' && factor.diagnostic_status === 'COMPLETED');
  if (autoMined) {
    actions.push({
      id: `model-suggestion-${autoMined.id}`,
      kind: 'FACTOR_MODEL_SUGGESTION',
      label: '策略草稿建议',
      title: '多因子策略草稿建议',
      detail: '治理任务已为自动挖掘因子准备待审查组合，只会带入创建页并保持草稿状态。',
      factor_ids: [autoMined.id],
      severity: 'info',
      suggested_weights: [{ factor_id: autoMined.id, weight_pct: 20, direction: autoMined.direction }],
      target: { route: '#/factor-models/new', query: { source: 'governance_queue', factorIds: autoMined.id, weights: '20' } },
    });
  }
  return actions.slice(0, 8);
}

function coerceAuditEntry(value: unknown, index: number): FactorAuditEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const title = String(record.title ?? record.label ?? record.action ?? '').trim();
  const detail = String(record.detail ?? record.summary ?? record.description ?? '').trim();
  const at = String(record.at ?? record.timestamp ?? record.event_at ?? '').trim();
  if (!title && !detail && !at) return null;
  return {
    id: String(record.id ?? `${title || 'audit'}-${index}`),
    title: title || '审计事件',
    at: at || null,
    detail: detail || '系统已记录该治理节点。',
  };
}

function buildFactorAuditEntries(
  factor: ApiFactorDetail,
  summary: ApiFactorDiagnosticSummary | null,
  pit: ApiPitDataOverview | null,
): FactorAuditEntry[] {
  const rawAudit = Array.isArray(summary?.audit_trail) ? summary?.audit_trail : [];
  const auditEntries = rawAudit.map(coerceAuditEntry).filter((entry): entry is FactorAuditEntry => Boolean(entry));
  if (auditEntries.length) return auditEntries;
  const compliance = summary?.compliance_trail as Record<string, unknown> | undefined;
  const diagnosedAt = recordString(compliance, 'diagnosed_at') ?? factorUpdatedAt(factor);
  const lookbackStart = recordString(compliance, 'lookback_start') ?? pit?.diagnostic_windows?.verified?.start_date;
  const lookbackEnd = recordString(compliance, 'lookback_end') ?? pit?.diagnostic_windows?.verified?.end_date ?? pit?.as_of_date;
  const entries: FactorAuditEntry[] = [
    {
      id: 'lookback-window',
      title: '回溯窗口',
      at: lookbackEnd ?? null,
      detail: [lookbackStart, lookbackEnd].filter(Boolean).join(' 至 ') || '沿用当前 PIT 诊断窗口。',
    },
  ];
  if (diagnosedAt) {
    entries.push({
      id: 'diagnosed-at',
      title: summary?.diagnostic_mode === 'SANDBOX' ? '沙盒诊断时间' : '检疫/诊断时间',
      at: diagnosedAt,
      detail: `诊断运行 ${summary?.run_id ?? factor.last_diagnostic_run_id ?? '未记录'} 已写入审计足迹。`,
    });
  }
  const publishedAt = recordString(compliance, 'published_at');
  if (publishedAt) {
    entries.push({
      id: 'published-at',
      title: '发布时间',
      at: publishedAt,
      detail: '自动发布事件已保留来源候选、版本和规则快照。',
    });
  }
  const governanceAt = recordString(compliance, 'governance_message_at');
  if (governanceAt) {
    entries.push({
      id: 'governance-at',
      title: '治理消息时间',
      at: governanceAt,
      detail: '治理任务已生成复核、观察或策略草稿建议。',
    });
  }
  return entries;
}

function DiagnosticSummaryPopover({
  factor,
  onClose,
}: {
  factor: ApiFactorListItem;
  onClose: () => void;
}): JSX.Element {
  const summary = factor.latest_diagnostic_summary;
  const batch = factor.batch_diagnostic_summary;
  const rawRunId = summary?.run_id ?? batch?.latest_run_id ?? factor.last_diagnostic_run_id ?? '待生成';
  const lineage = previewRecord(summary?.data_lineage);
  const runId = String(lineage?.kind ?? '').toUpperCase() === 'GOVERNANCE_REVERSE_FACTOR_PREVIEW' ||
    String(rawRunId).startsWith('reverse-preview:')
    ? (summary?.factor_id ?? factor.id)
    : rawRunId;
  const rankIc = summary?.rank_ic ?? batch?.rank_ic;
  const ir = summary?.ir ?? batch?.ir;
  const coverage = summary?.coverage ?? batch?.coverage;
  const diagnosedAt = recordString(summary?.compliance_trail, 'diagnosed_at') ?? batch?.latest_diagnostic_at ?? factorUpdatedAt(factor) ?? '待生成';
  const state = factorUiState(factor);
  const stateReasons = factorStatusReasonLines(factor);
  return (
    <div className="factor-diagnostic-popover" role="dialog" aria-label={`${factor.name} 最近诊断摘要`}>
      <div className="factor-diagnostic-popover__header">
        <div>
          <strong>最近诊断摘要</strong>
          <span>{state.label} · {runId}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭诊断摘要">×</button>
      </div>
      <dl className="factor-diagnostic-popover__grid">
        <div><dt>Rank IC</dt><dd>{num(rankIc)}</dd></div>
        <div><dt>IR</dt><dd>{num(ir, 2)}</dd></div>
        <div><dt>覆盖率</dt><dd>{pct(coverage)}</dd></div>
        <div><dt>诊断时间</dt><dd>{diagnosedAt === '待生成' ? diagnosedAt : formatDateTime(diagnosedAt)}</dd></div>
      </dl>
      <div className="factor-diagnostic-popover__reason">
        <strong>判定原因</strong>
        <ul>
          {stateReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
      <p className="factor-diagnostic-popover__action">{UI_STATE_MANAGEMENT_ACTIONS[state.state]}</p>
    </div>
  );
}

function DiagnosticStateCell({
  factor,
  open,
  onToggle,
  onClose,
}: {
  factor: ApiFactorListItem;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}): JSX.Element {
  const state = factorUiState(factor);
  return (
    <div className="factor-diagnostic-state">
      <button
        aria-expanded={open}
        aria-label={`查看${factor.name}诊断摘要`}
        className={`factor-pill factor-diagnostic-state__button factor-pill--ui-${state.state}`}
        onClick={onToggle}
        type="button"
      >
        {state.label}
      </button>
      {open ? <DiagnosticSummaryPopover factor={factor} onClose={onClose} /> : null}
    </div>
  );
}

function DiagnosticCell({ factor }: { factor: ApiFactorListItem }): JSX.Element {
  const summary = factor.latest_diagnostic_summary;
  const quality = factor.quality_view;
  const gap = factor.diagnostic_gap_summary ?? {};
  const rankIc = typeof quality?.rank_ic === 'number' ? quality.rank_ic : summary?.rank_ic;
  const ir = typeof quality?.ir === 'number' ? quality.ir : summary?.ir;
  const coverage = typeof quality?.coverage === 'number' ? quality.coverage : summary?.coverage;
  const rawDecayLabel = quality?.decay_label ?? (typeof quality?.decay_days === 'number' ? String(quality.decay_days) : null);
  const decayLabel = rawDecayLabel
    ? (/^\d+$/.test(String(rawDecayLabel)) ? `${rawDecayLabel}日` : String(rawDecayLabel))
    : '待生成';
  const sparklinePoints = quality?.sparkline?.length ? quality.sparkline : factor.ic_sparkline;
  const rankText = typeof rankIc === 'number'
    ? `RankIC ${num(rankIc)}`
    : String(gap.rank_ic ?? 'Rank IC: 尚未提交诊断');
  const irText = typeof ir === 'number'
    ? `IR ${num(ir, 2)}`
    : String(gap.next_action ?? 'IR: 等待诊断');
  const decayText = `衰减 ${decayLabel}`;
  const coverageText = typeof coverage === 'number'
    ? `覆盖 ${pct(coverage)}`
    : String(gap.coverage ?? '覆盖: 等待首次诊断');
  return (
    <div className="factor-diagnostic-cell">
      <div className="factor-diagnostic-cell__metrics">
        <span className="factor-diagnostic-cell__metric" title={rankText}>{rankText}</span>
        <span className="factor-diagnostic-cell__separator" aria-hidden="true">丨</span>
        <span className="factor-diagnostic-cell__metric" title={irText}>{irText}</span>
        <span className="factor-diagnostic-cell__separator" aria-hidden="true">丨</span>
        <span className="factor-diagnostic-cell__metric" title={decayText}>{decayText}</span>
        <span className="factor-diagnostic-cell__separator" aria-hidden="true">丨</span>
        <span className="factor-diagnostic-cell__metric" title={coverageText}>{coverageText}</span>
      </div>
      <Sparkline points={sparklinePoints} />
    </div>
  );
}

function FactorTierCell({ factor }: { factor: ApiFactorListItem }): JSX.Element {
  const key = String(factor.tier_level ?? factor.tier_projection?.key ?? 'F2');
  const label = factor.tier_label ?? factor.tier_projection?.label ?? `${key} 改造`;
  return <span className={`factor-tier-badge factor-tier-badge--${key.toLowerCase()}`}>{label}</span>;
}

function FactorLineageCell({
  factor,
  selected,
  onPreview,
}: {
  factor: ApiFactorListItem;
  selected: boolean;
  onPreview: () => void;
}): JSX.Element {
  const count = factor.lineage_summary?.parent_count ?? 0;
  const label = count > 0 ? `查看血缘，${count} 个父级` : '查看血缘';
  return (
    <button
      className="factor-lineage-button"
      type="button"
      onClick={onPreview}
      aria-haspopup="dialog"
      aria-label={label}
      aria-pressed={selected}
    >
      查看血缘
    </button>
  );
}

function OperatorStatusLights({ factor }: { factor: ApiFactorListItem }): JSX.Element {
  const lights = factor.op_status?.lights?.length
    ? factor.op_status.lights
    : [
        { code: 'W', label: '去极值', active: false },
        { code: 'N', label: '中性化', active: false },
        { code: 'Z', label: '标准化', active: false },
        { code: 'T', label: '时序排名', active: false },
      ];
  return (
    <div className="factor-op-lights" aria-label={`${factor.name} 算子状态灯`}>
      {lights.map((light) => (
        <span
          className={`factor-op-light ${light.active ? 'is-active' : 'is-missing'}`}
          title={`${light.code} ${light.label}${light.active ? '已完成' : '未记录'}`}
          key={light.code}
        >
          {light.code}
        </span>
      ))}
    </div>
  );
}

function FactorLifecycleCell({ factor }: { factor: ApiFactorListItem }): JSX.Element {
  const key = String(factor.lifecycle ?? factor.lifecycle_projection?.key ?? (isFactorOffline(factor) ? 'archived' : 'online'));
  const label = factor.lifecycle_label ?? factor.lifecycle_projection?.label ?? (isFactorOffline(factor) ? '已归档' : '线上');
  return <span className={`factor-lifecycle-badge factor-lifecycle-badge--${key}`}>{label}</span>;
}

function FactorLevelCell({ factor }: { factor: ApiFactorListItem }): JSX.Element {
  const level = factorLevel(factor);
  if (!level) {
    return (
      <div className="factor-level-cell factor-level-cell--empty">
        <span className="factor-level-badge factor-level-badge--empty">未评级</span>
      </div>
    );
  }
  const title = `${level.key} ${level.title}: Rank IC ${level.rankIcRange}, IR ${level.irRange}。${level.recommendation}`;
  return (
    <div className="factor-level-cell" title={title}>
      <span className={`factor-level-badge factor-level-badge--${level.key.toLowerCase()}`}>
        <strong>{level.key}</strong>
        <span>{level.title}</span>
      </span>
    </div>
  );
}

function FactorCorrelationMatrix({
  factors,
  selectedFactorId,
  onSelect,
}: {
  factors: ApiFactorListItem[];
  selectedFactorId?: string;
  onSelect: (factorId: string) => void;
}): JSX.Element {
  const clusteredFactors = useMemo(() => sortFactorsByCategory(factors), [factors]);
  if (!clusteredFactors.length) return <div className="factor-empty">暂无可计算相关性的因子。</div>;
  const selected = clusteredFactors.find((item) => item.id === selectedFactorId) ?? clusteredFactors[0];
  const highPeers = clusteredFactors.filter((item) => item.id !== selected.id && factorCorrelation(selected, item) >= 0.7);
  const baseFactors = clusteredFactors;
  const virtualized = baseFactors.length > MAX_VISIBLE_CORRELATION_FACTORS;
  const visibleFactors = baseFactors.slice(0, MAX_VISIBLE_CORRELATION_FACTORS);
  const groups = correlationGroups(visibleFactors);
  return (
    <div
      className="factor-correlation"
      aria-label="动态相关性热力图"
      data-renderer={virtualized ? 'virtual-grid' : 'semantic-grid'}
    >
      <div className="factor-correlation__toolbar">
        <div>
          <strong>{selected.name}</strong>
          <span>语义聚类 · Pearson / Rank Correlation</span>
        </div>
        <div className="factor-chip-row">
          {highPeers.length ? highPeers.map((peer) => <span key={peer.id}>{peer.name}</span>) : <span>暂无 &gt; 0.7</span>}
        </div>
      </div>
      <div className="factor-correlation__groups" aria-label="热力图类别分区">
        {groups.map((group) => (
          <span
            className="factor-correlation__group"
            data-category={group.category}
            key={`${group.category}-${group.count}`}
            style={{ ['--group-span' as string]: group.count }}
          >
            {group.label} · {group.count}
          </span>
        ))}
      </div>
      {virtualized ? (
        <p className="factor-virtual-note">
          已启用虚拟矩阵窗口：当前展示前 {MAX_VISIBLE_CORRELATION_FACTORS} 个聚类因子，筛选后可继续缩小矩阵。
        </p>
      ) : null}
      <div className="factor-correlation__grid" style={{ ['--factor-count' as string]: visibleFactors.length }}>
        <span />
        {visibleFactors.map((factor) => (
          <button
            type="button"
            className={factor.id === selected.id ? 'is-selected' : ''}
            aria-label={`选中相关性因子 ${factor.name}`}
            onClick={() => onSelect(factor.id)}
            key={`head-${factor.id}`}
            data-category={factorLibraryCategory(factor)}
          >
            {factor.name}
            <small>{factorLibraryCategoryLabel(factorLibraryCategory(factor))}</small>
          </button>
        ))}
        {visibleFactors.map((row) => (
          <Fragment key={`matrix-${row.id}`}>
            <button
              type="button"
              className={row.id === selected.id ? 'is-selected' : ''}
              aria-label={`选中相关性因子 ${row.name}`}
              onClick={() => onSelect(row.id)}
              data-category={factorLibraryCategory(row)}
            >
              {row.name}
              <small>{factorLibraryCategoryLabel(factorLibraryCategory(row))}</small>
            </button>
            {visibleFactors.map((column) => {
              const value = factorCorrelation(row, column);
              const isPeer = row.id === selected.id || column.id === selected.id;
              const isHigh = isPeer && row.id !== column.id && value >= 0.7;
              const isCrossCategoryHigh = isHigh && factorLibraryCategory(row) !== factorLibraryCategory(column);
              return (
                <button
                  type="button"
                  className={`factor-correlation__cell ${isHigh ? 'is-high' : ''} ${
                    isCrossCategoryHigh ? 'is-cross-category-high' : ''
                  } ${row.id === column.id ? 'is-self' : ''}`}
                  aria-label={`${row.name} 与 ${column.name} 相关性 ${value.toFixed(2)}`}
                  onClick={() => onSelect(row.id === selected.id ? column.id : row.id)}
                  key={`${row.id}-${column.id}`}
                  style={{ ['--correlation-strength' as string]: Math.max(0.18, Math.abs(value)) }}
                  data-category-pair={`${factorLibraryCategory(row)}-${factorLibraryCategory(column)}`}
                >
                  {value.toFixed(2)}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function FactorLineagePreview({
  factor,
  factors,
  onClose,
}: {
  factor: ApiFactorListItem;
  factors: ApiFactorListItem[];
  onClose: () => void;
}): JSX.Element {
  const parentIds = factor.lineage_summary?.parent_ids ?? [];
  const parentFactors = parentIds
    .map((parentId) => factors.find((item) => item.id === parentId || item.descriptor?.canonical_id === parentId))
    .filter((item): item is ApiFactorListItem => Boolean(item));
  const rootName = factor.lineage_summary?.root_source ?? parentFactors[0]?.name ?? parentIds[0] ?? factor.name;
  const source = parentFactors.find((item) => item.tier_level === 'F1') ?? factors.find((item) => item.tier_level === 'F1');
  const refined = factor.tier_level === 'F2'
    ? factor
    : parentFactors.find((item) => item.tier_level === 'F2') ?? factors.find((item) => item.tier_level === 'F2');
  const composite = factor.tier_level === 'F3'
    ? factor
    : factors.find((item) => item.tier_level === 'F3' && parentIds.includes(item.id));
  const nodes = [
    { tier: 'F1 原始库', name: source?.name ?? rootName },
    { tier: 'F2 改造库', name: refined?.name ?? (factor.tier_level === 'F1' ? '待改造' : factor.name) },
    { tier: 'F3 组合库', name: composite?.name ?? (factor.tier_level === 'F3' ? factor.name : '待组合') },
  ];
  return (
    <section className="factor-panel factor-lineage-preview" role="dialog" aria-modal="true" aria-label="血缘树预览">
      <div className="factor-lineage-preview__copy">
        <strong>血缘树预览</strong>
        <p>当前预览：{factor.name}。完整版本、准入记录与因子解释可在详情页审计。</p>
      </div>
      <button className="factor-lineage-preview__close" type="button" onClick={onClose}>收起</button>
      <div className="factor-lineage-tree" aria-label="因子血缘树预览">
        {nodes.map((node, index) => (
          <Fragment key={`${node.tier}-${index}`}>
            {index > 0 ? <span className="factor-lineage-tree__arrow" aria-hidden="true">→</span> : null}
            <article className="factor-lineage-tree__node">
              <span>{node.tier}</span>
              <strong>{node.name}</strong>
            </article>
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function FactorComparisonPanel({
  factors,
  onClear,
}: {
  factors: ApiFactorListItem[];
  onClear: () => void;
}): JSX.Element {
  const [left, right] = factors;
  const leftSeries = diagnosticSeries(left);
  const rightSeries = diagnosticSeries(right);
  const allValues = [...leftSeries, ...rightSeries, 0].filter((value) => Number.isFinite(value));
  const min = Math.min(...allValues, -0.001);
  const max = Math.max(...allValues, 0.001);
  const span = Math.max(max - min, 0.001);
  const width = 520;
  const height = 176;
  const yFor = (value: number) => height - 22 - ((value - min) / span) * (height - 44);
  const pathFor = (series: number[]) => {
    const safeSeries = series.length ? series : [0];
    return safeSeries
      .map((value, index) => {
        const x = safeSeries.length <= 1 ? 16 : 16 + (index / (safeSeries.length - 1)) * (width - 32);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${yFor(value).toFixed(2)}`;
      })
      .join(' ');
  };
  const zeroY = yFor(0);
  const leftSpread = longShortSpread(left);
  const rightSpread = longShortSpread(right);
  return (
    <div className="factor-compare" aria-label="因子表现对比图">
      <div className="factor-compare__header">
        <div>
          <strong>双因子指纹</strong>
          <span>IC 走势与多头超额收益</span>
        </div>
        <button className="factor-btn factor-btn--small" onClick={onClear} type="button">退出比对</button>
      </div>
      <svg className="factor-compare-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${left.name} 与 ${right.name} IC 走势对比`}>
        <path className="factor-compare-chart__zero" d={`M 16 ${zeroY.toFixed(2)} L ${width - 16} ${zeroY.toFixed(2)}`} />
        <path className="factor-compare-chart__line factor-compare-chart__line--left" d={pathFor(leftSeries)} />
        <path className="factor-compare-chart__line factor-compare-chart__line--right" d={pathFor(rightSeries)} />
      </svg>
      <div className="factor-compare__legend">
        {[left, right].map((factor, index) => {
          const spread = index === 0 ? leftSpread : rightSpread;
          return (
            <article key={factor.id}>
              <span className={`factor-compare__dot factor-compare__dot--${index === 0 ? 'left' : 'right'}`} />
              <div>
                <strong>{factor.name}</strong>
                <code>{factor.descriptor?.canonical_id ?? factor.id}</code>
              </div>
              <small>多头超额 {spread === null ? '待生成' : formatSignedPct(spread)}</small>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function SandboxGapPopover({
  factor,
  onClose,
}: {
  factor: ApiFactorListItem;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="factor-gap-popover" role="dialog" aria-label={`${factor.name} 缺口速报`}>
      <div>
        <strong>缺口速报</strong>
        <button type="button" onClick={onClose} aria-label="关闭缺口速报">×</button>
      </div>
      <p>{sandboxGapBrief(factor)}</p>
      <button
        className="factor-btn factor-btn--small"
        type="button"
        onClick={() => {
          onClose();
          goToHashTarget('#/pit-data?section=coverage-gap');
        }}
      >
        覆盖率缺口清单
      </button>
    </div>
  );
}

function recordNumber(record: Record<string, unknown> | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function recordString(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    : [];
}

function asMetricValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '待补齐';
  return String(value);
}

function recordMetricList(value: unknown): Array<{ label: string; value: string }> {
  if (Array.isArray(value)) {
    return recordArray(value).map((metric) => ({
      label: recordString(metric, 'label') ?? recordString(metric, 'name') ?? '指标',
      value: asMetricValue(metric.value ?? metric.metric_value ?? recordString(metric, 'value')),
    }));
  }
  if (isRecord(value)) {
    return Object.entries(value).map(([label, metricValue]) => ({
      label,
      value: asMetricValue(metricValue),
    }));
  }
  return [];
}

function buildPitCapability(item: Record<string, unknown>): PitUpstreamCapability {
  return {
    capability_id: recordString(item, 'capability_id') ?? 'capability',
    factor_groups: stringArray(item.factor_groups),
    mode: recordString(item, 'mode') ?? 'BLOCKED',
    allowed_actions: stringArray(item.allowed_actions),
    required_checks: stringArray(item.required_checks),
    satisfied_checks: stringArray(item.satisfied_checks),
    blocked_checks: stringArray(item.blocked_checks),
    summary_cn: pitCopy(recordString(item, 'summary_cn') ?? recordString(item, 'summary') ?? '等待能力说明。'),
  };
}

function buildPitSubmodule(item: Record<string, unknown>): PitReadinessSubmodule {
  return {
    id: recordString(item, 'id') ?? recordString(item, 'submodule_id') ?? 'submodule',
    title_cn: recordString(item, 'title_cn') ?? recordString(item, 'title') ?? '未命名子模块',
    status: recordString(item, 'status') ?? 'BLOCKED',
    usable: Boolean(item.usable),
    summary_cn: pitCopy(recordString(item, 'summary_cn') ?? recordString(item, 'summary') ?? '等待子模块说明。'),
    blockers: stringArray(item.blockers),
    linked_targets: stringArray(item.linked_targets),
    metrics: recordMetricList(item.metrics),
    upstream_capabilities: recordArray(item.upstream_capabilities).map(buildPitCapability),
  };
}

function statusVariant(value: unknown): string {
  const normalized = String(value ?? '').toUpperCase();
  if (['READY', 'VERIFIED', 'COMPLETED', 'READY_TO_DIAGNOSE'].includes(normalized)) return 'ready';
  if (['PARTIAL_READY', 'SANDBOX', 'SANDBOX_READY', 'LIMITED_READY', 'WARNING', 'CALIBRATING', 'OBSERVATION'].includes(normalized)) return 'limited-ready';
  if (['BLOCKED', 'BLOCKED_PIT', 'BLOCKED_DATA', 'FAILED'].includes(normalized)) return 'blocked';
  if (['DISABLED', 'UNAVAILABLE', 'INCOMPLETE'].includes(normalized)) return 'unavailable';
  return normalized.toLowerCase().replaceAll('_', '-');
}

function pitLayerStatusLabel(value: unknown): string {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized === 'OBSERVATION') return '?弦?航?';
  return PIT_LAYER_STATUS_LABELS[normalized] ?? pitStatusLabel(normalized);
}

function factorDiagnosticStatusLabel(value: unknown): string {
  const normalized = String(value ?? '').toUpperCase();
  return DIAGNOSTIC_READINESS_LABELS[normalized] ?? pitLayerStatusLabel(normalized);
}

function pitReadinessLabel(value: unknown): string {
  const raw = String(value ?? '').trim();
  const normalized = raw.toLowerCase();
  const labels: Record<string, string> = {
    price_replay_gate: '价格回放',
    universe_history_gate: '样本池历史',
    fundamental_publish_gate: '财报时点',
    fundamental_balance_check: '财报校验',
    consensus_sample_gate: '一致预期',
    short_volume_gate: '卖空样本',
    rate_beta_calibration: '利率 Beta',
    iv_skew_feed: '期权偏度',
    corporate_action_gate: '公司行动',
    point_rows: '样本',
    required_points: '门槛',
    covered_series: '序列',
    required_series: '要求',
    current_core_missing: '核心缺口',
    active_window_missing: '窗口缺口',
    archival_missing: '归档缺口',
  };
  if (labels[normalized]) return labels[normalized];
  if (!raw) return '';
  return raw
    .replaceAll('_', ' ')
    .replace(/\bpit\b/gi, 'PIT')
    .replace(/\biv\b/gi, 'IV')
    .replace(/\bbeta\b/gi, 'Beta');
}

function pitMatrixText(value: unknown): string {
  return pitCopy(value)
    .replace(/\bfeature preview\b/gi, '特征预览')
    .replace(/\bREADY\b/g, '就绪')
    .replace(/\bgate\b/gi, '门禁')
    .replace(/\s+就绪\s+/g, '就绪')
    .replace(/\s+特征预览/g, '特征预览');
}

function compactPitCardDetails(layer: PitLayerReadinessItem): string[] {
  const metrics = layer.metrics
    .slice(0, 2)
    .map((metric) => `${pitReadinessLabel(metric.label)} ${metric.value}`.trim());
  const readySubmoduleCount = (layer.submodules ?? [])
    .filter((submodule) => ['READY', 'PARTIAL_READY', 'OBSERVATION'].includes(String(submodule.status).toUpperCase())).length;
  const submoduleSummary = layer.submodules?.length
    ? `子模块 ${readySubmoduleCount}/${layer.submodules.length}`
    : '';
  const blockerSummary = layer.blockers.length ? `待补 ${layer.blockers.length}` : '';
  return [submoduleSummary, ...metrics, blockerSummary].filter(Boolean).slice(0, 2);
}

function compactPitSubmoduleTitle(submodule: PitReadinessSubmodule): string {
  const labels: Record<string, string> = {
    price_replay: '复权价格',
    universe_history: '样本池',
    fundamental_fields: '财务快照',
    fundamental_time_contract: '发布时点',
    analyst_consensus: '一致预期',
    short_volume: '卖空样本',
    macro_rates: '宏观利率',
    option_skew: '期权偏度',
  };
  if (labels[submodule.id]) return labels[submodule.id];
  return submodule.title_cn
    .replace(/分析师/g, '')
    .replace(/历史/g, '')
    .replace(/字段|序列|链路|回放|成交/g, '')
    .replace(/\s*available_at\s*/gi, '')
    .trim();
}

function compactPitSubmoduleStatus(status: string): string {
  const normalized = status.toUpperCase();
  const labels: Record<string, string> = {
    READY: '准入',
    PARTIAL_READY: '部分',
    LIMITED_READY: '研究',
    OBSERVATION: '观察',
    WARNING: '观察',
    BLOCKED: '阻断',
    BLOCKED_DATA: '数据',
    BLOCKED_PIT: 'PIT',
    FAILED: '失败',
    DISABLED: '停用',
  };
  return labels[normalized] ?? pitLayerStatusLabel(status);
}

function compactDiagnosticSummary(group: FactorDiagnosticReadinessItem): string {
  const satisfied = group.satisfied_checks.map(pitReadinessLabel).filter(Boolean).slice(0, 2);
  const blocked = group.blocked_checks.map(pitReadinessLabel).filter(Boolean).slice(0, 2);
  const factors = group.factors.slice(0, 3);
  const factorText = factors.length
    ? `因子：${factors.join(' / ')}${group.factors.length > factors.length ? ` 等 ${group.factors.length} 项` : ''}`
    : '';
  return [
    pitMatrixText(group.rationale_cn),
    satisfied.length ? `已满足：${satisfied.join(' / ')}` : '',
    blocked.length ? `待补：${blocked.join(' / ')}` : '',
    factorText,
  ].filter(Boolean).join('；');
}

function pitAlertTitle(code: unknown): string {
  const normalized = String(code ?? '').toUpperCase();
  const labels: Record<string, string> = {
    PRICE_SNAPSHOT_NOT_READY: '价格快照未就绪',
    CURRENT_ONLY_DATA: '存在当前值透视风险',
    MISSING_AVAILABLE_AT: '缺少 available_at',
    NON_REPLAYABLE_FIELD: '存在不可回放字段',
    FUTURE_FUNCTION: '存在未来函数风险',
    FUNDAMENTAL_PIT_NOT_READY: '财务 PIT 未就绪',
    FACTOR_ADMISSION_10Y_REPAIR: '10Y 补源队列待处理',
    FULL_READY_ARCHIVAL_GAP: '完整归档缺口待补',
    PIT_METADATA_RECOMPUTE_MISMATCH: '元数据重算不一致',
  };
  return labels[normalized] ?? normalized.replaceAll('_', ' ');
}

function factorDiagnosticStatusFromPit(
  pit: ApiPitDataOverview,
  preferredStatus?: string | null,
): string {
  const normalizedPreferred = String(preferredStatus ?? '').toUpperCase();
  if (normalizedPreferred) return normalizedPreferred;
  if (pit.verified_diagnostics_enabled) return 'VERIFIED';
  if (pit.sandbox_diagnostics_enabled || pit.limited_diagnostics_enabled) return 'SANDBOX';
  return 'BLOCKED';
}

function pitLayerKey(value?: string | null): string {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('l1') || normalized.includes('market') || normalized.includes('price')) return 'l1';
  if (normalized.includes('l2') || normalized.includes('fundamental')) return 'l2';
  if (normalized.includes('l3') || normalized.includes('sentiment') || normalized.includes('analyst')) return 'l3';
  if (normalized.includes('l4') || normalized.includes('macro') || normalized.includes('derivative')) return 'l4';
  return normalized || 'layer';
}

function snapshotLayerStatusMap(overview: ApiSnapshotOverview | null): SnapshotLayerStatusMap {
  const rawLayers = Array.isArray(overview?.data_layer_readiness)
    ? overview.data_layer_readiness
    : [];
  return Object.fromEntries(
    rawLayers
      .map((layer) => {
        if (!layer || typeof layer !== 'object') return null;
        const record = layer as Record<string, unknown>;
        const key = pitLayerKey(String(record.layer_id ?? record.id ?? ''));
        const status = String(record.status ?? '').trim();
        return key && status ? [key, status] as const : null;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry)),
  );
}

function buildPitLayerReadiness(pit: PitOverviewExtended): PitLayerReadinessItem[] {
  const provided = recordArray(pit.pit_layer_readiness).map((item) => ({
    layer_id: recordString(item, 'layer_id') ?? 'layer',
    title_cn: recordString(item, 'title_cn') ?? recordString(item, 'title') ?? '待命名层级',
    status: recordString(item, 'status') ?? 'BLOCKED',
    summary: recordString(item, 'summary') ?? '等待上游门禁回填。',
    label: recordString(item, 'title_cn') ?? recordString(item, 'title') ?? '待命名层级',
    reason: pitCopy(recordString(item, 'summary') ?? recordString(item, 'pit_alignment') ?? '等待上游门禁回填。'),
    detail: pitCopy(recordString(item, 'pit_alignment') ?? '等待上游补充门禁说明。'),
    pit_alignment: recordString(item, 'pit_alignment') ?? undefined,
    blockers: stringArray(item.blockers),
    available_at_health: isRecord(item.available_at_health)
      ? recordString(item.available_at_health, 'status')
      : recordString(item, 'available_at_health'),
    updated_at: recordString(item, 'updated_at'),
    metrics: recordMetricList(item.metrics),
    submodules: recordArray(item.submodules).map(buildPitSubmodule),
    upstream_capabilities: recordArray(item.upstream_capabilities).map(buildPitCapability),
  }));
  if (provided.length) return provided;

  const sandboxWindow = pit.diagnostic_windows?.sandbox;
  const verifiedWindow = pit.diagnostic_windows?.verified;
  const fundamentalCoverage = pit.fundamental_coverage;
  const gapCount = pit.coverage_gap?.missing_symbol_count ?? 0;
  return [
    {
      layer_id: 'L1',
      title_cn: 'L1 基础行情',
      status: pit.adjusted_price_status ?? 'BLOCKED',
      summary: pitCopy(pit.status_reasons?.adjusted_price?.description ?? '复权价格、覆盖率与诊断窗口决定价格型因子的正式准入。'),
      label: 'L1 基础行情',
      reason: pitCopy(pit.status_reasons?.adjusted_price?.description ?? '复权价格、覆盖率与诊断窗口决定价格型因子的正式准入。'),
      detail: '复权价格、核心覆盖率、研究窗口',
      pit_alignment: '复权价格、核心覆盖率、研究窗口',
      blockers: gapCount > 0 ? [`当前核心缺口 ${gapCount} 个`] : [],
      updated_at: pit.as_of_date,
      metrics: [
        { label: '覆盖率', value: pct(pit.coverage.coverage_pct) },
        { label: '样本数', value: `${pit.coverage.covered_symbol_count}/${pit.coverage.total_symbol_count}` },
        { label: '研究窗口', value: sandboxWindow ? `${sandboxWindow.start_date} 至 ${sandboxWindow.end_date}` : '待补齐' },
      ],
      submodules: [],
      upstream_capabilities: [],
    },
    {
      layer_id: 'L2',
      title_cn: 'L2 财务截面',
      status: pit.fundamental_status ?? 'DISABLED',
      summary: pitCopy(pit.status_reasons?.fundamental?.description ?? '财务字段需按发布日期与 available_at 对齐后，才允许进入质量与估值诊断。'),
      label: 'L2 财务截面',
      reason: pitCopy(pit.status_reasons?.fundamental?.description ?? '财务字段需按发布日期与 available_at 对齐后，才允许进入质量与估值诊断。'),
      detail: '发布日期、available_at、财务字段完整度',
      pit_alignment: '发布日期、available_at、财务字段完整度',
      blockers: fundamentalCoverage?.missing_fields?.slice(0, 3) ?? [],
      available_at_health: fundamentalCoverage?.source_snapshot_status ?? null,
      updated_at: fundamentalCoverage?.source_snapshot_updated_at ?? undefined,
      metrics: [
        { label: '覆盖率', value: pct(fundamentalCoverage?.coverage_pct) },
        { label: '可用字段', value: String(fundamentalCoverage?.available_fields?.length ?? 0) },
        { label: '快照时间', value: fundamentalCoverage?.source_snapshot_updated_at ?? '待补齐' },
      ],
      submodules: [],
      upstream_capabilities: [],
    },
    {
      layer_id: 'L3',
      title_cn: 'L3 分析师与情绪',
      status: 'DISABLED',
      summary: '一致预期、卖空与换手稳定性尚未接入，一期仅保留门禁占位与异常承接位。',
      label: 'L3 分析师与情绪',
      reason: '一致预期、卖空与换手稳定性尚未接入，一期仅保留门禁占位与异常承接位。',
      detail: '一致预期、卖空、换手稳定性',
      pit_alignment: '一致预期样本数、卖空时效、换手稳定性',
      blockers: pit.research_waiver ? ['研究豁免仅允许诊断观察，不可晋升'] : [],
      updated_at: pit.as_of_date,
      metrics: [
        { label: '研究豁免', value: pit.research_waiver ? `${pit.research_waiver.ignored_symbol_count} 个` : '无' },
        { label: '当前缺口', value: String(gapCount) },
        { label: '异常事件', value: String(pit.quality_events.length) },
      ],
      submodules: [],
      upstream_capabilities: [],
    },
    {
      layer_id: 'L4',
      title_cn: 'L4 宏观与衍生品',
      status: 'DISABLED',
      summary: '利率敏感度、通胀商品贝塔与期权偏度尚未接入，等待宏观与衍生品上游序列。 ',
      label: 'L4 宏观与衍生品',
      reason: '利率敏感度、通胀商品贝塔与期权偏度尚未接入，等待宏观与衍生品上游序列。',
      detail: '利率回归、宏观 beta、IV 偏度',
      pit_alignment: '利率回归、宏观 beta、IV 偏度',
      blockers: verifiedWindow?.enabled === false ? ['正式窗口未完成，宏观因子暂不开放'] : [],
      updated_at: pit.as_of_date,
      metrics: [
        { label: '正式窗口', value: verifiedWindow ? `${verifiedWindow.start_date} 至 ${verifiedWindow.end_date}` : '待补齐' },
        { label: '研究窗口', value: sandboxWindow ? `${sandboxWindow.start_date} 至 ${sandboxWindow.end_date}` : '待补齐' },
        { label: '待修复事项', value: String(pit.blocking_items.length) },
      ],
      submodules: [],
      upstream_capabilities: [],
    },
  ];
}

function buildFactorDiagnosticReadiness(pit: PitOverviewExtended): FactorDiagnosticReadinessItem[] {
  const provided = recordArray(pit.factor_diagnostic_readiness).map((item) => ({
    group_id: recordString(item, 'group_id') ?? 'group',
    title_cn: recordString(item, 'title_cn') ?? recordString(item, 'title') ?? '未命名分组',
    status: recordString(item, 'status') ?? 'BLOCKED',
    factors: stringArray(item.factors),
    rationale_cn: pitCopy(recordString(item, 'rationale_cn') ?? recordString(item, 'rationale') ?? '等待门禁说明。'),
    linked_snapshot_checks: stringArray(item.linked_snapshot_checks),
    required_checks: stringArray(item.required_checks),
    satisfied_checks: stringArray(item.satisfied_checks),
    blocked_checks: stringArray(item.blocked_checks),
    upstream_capabilities: recordArray(item.upstream_capabilities).map(buildPitCapability),
  }));
  if (provided.length) return provided;

  const fundamentalStatus = String(pit.fundamental_status ?? '').toUpperCase();
  const qualityStatus =
    !fundamentalStatus || fundamentalStatus === 'UNAVAILABLE'
      ? 'DISABLED'
      : factorDiagnosticStatusFromPit(
        pit,
        ['READY', 'LIMITED_READY'].includes(fundamentalStatus)
          ? undefined
          : pit.limited_diagnostics_enabled
            ? 'SANDBOX'
            : 'BLOCKED',
      );
  return [
    {
      group_id: 'price',
      title_cn: '价格型',
      status: factorDiagnosticStatusFromPit(pit),
      factors: ['动量', '反转', '波动率', '换手'],
      rationale_cn: pitCopy(pit.status_reasons?.adjusted_price?.description ?? '价格型因子直接依赖复权价格、样本覆盖与正式诊断窗口。'),
      linked_snapshot_checks: ['复权价格覆盖', '核心样本覆盖', '研究/正式窗口'],
      required_checks: [],
      satisfied_checks: [],
      blocked_checks: [],
      upstream_capabilities: [],
    },
    {
      group_id: 'quality_value',
      title_cn: '质量/估值型',
      status: qualityStatus,
      factors: ['F-Score', 'Accruals', '经营杠杆', '估值'],
      rationale_cn: pitCopy(pit.status_reasons?.fundamental?.description ?? '财务截面未完成 publish_date 与 available_at 对齐前，只能停留在诊断观察或阻断状态。'),
      linked_snapshot_checks: ['财报发布日期', 'available_at 对齐', '财务字段完整度'],
      required_checks: [],
      satisfied_checks: [],
      blocked_checks: [],
      upstream_capabilities: [],
    },
    {
      group_id: 'sentiment_micro',
      title_cn: '情绪/微观型',
      status: 'DISABLED',
      factors: ['分析师修正', '卖空', '非流动性溢价'],
      rationale_cn: '一期未接入一致预期、卖空与微观结构序列，当前仅保留准入占位。',
      linked_snapshot_checks: ['一致预期样本数', '卖空时效', '换手稳定性'],
      required_checks: [],
      satisfied_checks: [],
      blocked_checks: [],
      upstream_capabilities: [],
    },
    {
      group_id: 'macro_derivatives',
      title_cn: '宏观/衍生品型',
      status: 'DISABLED',
      factors: ['利率敏感度', '通胀/商品贝塔', 'IV 偏度'],
      rationale_cn: '宏观与衍生品序列尚未接入，当前不开放正式诊断。',
      linked_snapshot_checks: ['利率回归', '宏观序列', '期权隐波偏度'],
      required_checks: [],
      satisfied_checks: [],
      blocked_checks: [],
      upstream_capabilities: [],
    },
  ];
}

function buildPitQualityAlerts(pit: PitOverviewExtended): PitQualityAlertItem[] {
  const provided = recordArray(pit.pit_quality_alerts).map((item) => ({
    code: recordString(item, 'code') ?? 'alert',
    severity: recordString(item, 'severity') ?? 'warning',
    title_cn: recordString(item, 'title_cn') ?? recordString(item, 'title') ?? '门禁提示',
    detail_cn: pitCopy(recordString(item, 'detail_cn') ?? recordString(item, 'detail') ?? '等待上游补充说明。'),
    hard_blocking: Boolean(item.hard_blocking),
    linked_factor_groups: stringArray(item.linked_factor_groups),
    target: recordString(item, 'target'),
  }));
  if (provided.length) return provided;

  const alerts: PitQualityAlertItem[] = [];
  for (const item of pit.blocking_items) {
    alerts.push({
      code: item.code,
      severity: 'danger',
      title_cn: pitAlertTitle(item.code),
      detail_cn: pitCopy(item.message),
      hard_blocking: true,
      linked_factor_groups: item.code.includes('FUNDAMENTAL')
        ? ['质量/估值型']
        : ['价格型'],
      target: item.fix_hash ?? item.target ?? null,
    });
  }
  for (const item of pit.quality_events) {
    alerts.push({
      code: item.id ?? item.event_type,
      severity: item.severity,
      title_cn: pitCopy(item.title),
      detail_cn: pitCopy(item.message),
      hard_blocking: String(item.severity).toLowerCase() === 'danger',
      linked_factor_groups: [],
      target: null,
    });
  }
  if (pit.research_waiver) {
    alerts.push({
      code: 'RESEARCH_WAIVER_ACTIVE',
      severity: 'warning',
      title_cn: '研究豁免生效',
      detail_cn: `已排除 ${pit.research_waiver.ignored_symbol_count} 个非核心缺口，仅允许研究诊断，不可晋升正式准入。`,
      hard_blocking: false,
      linked_factor_groups: ['价格型', '情绪/微观型'],
      target: '#/pit-data?section=coverage-gap',
    });
  }
  if (pit.factor_admission_coverage?.repair_symbol_count) {
    alerts.push({
      code: 'FACTOR_ADMISSION_REPAIR_QUEUE',
      severity: 'warning',
      title_cn: '10Y 补源队列待处理',
      detail_cn: `仍有 ${pit.factor_admission_coverage.repair_symbol_count} 个标的等待补源后再评估正式诊断。`,
      hard_blocking: false,
      linked_factor_groups: ['价格型', '质量/估值型'],
      target: '#/pit-data?section=coverage-gap',
    });
  }
  return alerts.slice(0, 8);
}

function buildSnapshotLayerLinkage(pit: PitOverviewExtended): SnapshotLayerLinkageItem[] {
  const provided = recordArray(pit.snapshot_layer_linkage).map((item) => ({
    check_id: recordString(item, 'check_id') ?? 'check',
    check_title_cn: recordString(item, 'check_title_cn') ?? recordString(item, 'check_title') ?? '未命名检查项',
    source_layer: recordString(item, 'source_layer') ?? '未标注层级',
    target_factor_groups: stringArray(item.target_factor_groups),
    result_status: recordString(item, 'result_status') ?? 'BLOCKED',
    detail_cn: pitCopy(recordString(item, 'detail_cn') ?? recordString(item, 'detail') ?? '等待上游补充说明。'),
    hard_blocking: Boolean(item.hard_blocking),
    capability_mode: recordString(item, 'capability_mode'),
  }));
  if (provided.length) return provided;

  const waiverGapStatus = pit.research_waiver
    ? 'SANDBOX'
    : (pit.coverage_gap?.missing_symbol_count ?? 0) > 0
      ? 'BLOCKED'
      : 'READY';
  return [
    {
      check_id: 'adjusted-price',
      check_title_cn: '复权价格覆盖',
      source_layer: 'L1 基础行情',
      target_factor_groups: ['价格型'],
      result_status: pit.adjusted_price_status ?? 'BLOCKED',
      detail_cn: pitCopy(pit.status_reasons?.adjusted_price?.description ?? '复权价格不稳定时，价格型因子不能进入正式诊断。'),
      hard_blocking: String(pit.adjusted_price_status ?? '').toUpperCase() !== 'READY',
      capability_mode: pit.adjusted_price_status ?? 'BLOCKED',
    },
    {
      check_id: 'universe-history',
      check_title_cn: 'Universe 成分历史',
      source_layer: 'L1 基础行情',
      target_factor_groups: ['价格型', '质量/估值型'],
      result_status: pit.universe_status ?? 'BLOCKED',
      detail_cn: pitCopy(pit.status_reasons?.universe?.description ?? '成员 in/out 历史不足时，窗口回放与成分归因都不完整。'),
      hard_blocking: String(pit.universe_status ?? '').toUpperCase() !== 'READY',
      capability_mode: pit.universe_status ?? 'BLOCKED',
    },
    {
      check_id: 'fundamental-publish-date',
      check_title_cn: '财报发布日期与 available_at',
      source_layer: 'L2 财务截面',
      target_factor_groups: ['质量/估值型'],
      result_status: pit.fundamental_status ?? 'DISABLED',
      detail_cn: pitCopy(pit.status_reasons?.fundamental?.description ?? '财务字段先完成 PIT 对齐，再开放质量与估值诊断。'),
      hard_blocking: String(pit.fundamental_status ?? '').toUpperCase() === 'BLOCKED',
      capability_mode: pit.fundamental_status ?? 'DISABLED',
    },
    {
      check_id: 'coverage-gap-waiver',
      check_title_cn: '核心缺口与研究豁免',
      source_layer: 'L1 基础行情',
      target_factor_groups: ['价格型', '情绪/微观型'],
      result_status: waiverGapStatus,
      detail_cn: pit.research_waiver
        ? '当前存在研究豁免，允许沙箱观察，但不能晋升正式准入。'
        : pitCopy(pit.coverage_gap?.recommendation ?? '当前无研究豁免，覆盖缺口将直接影响准入状态。'),
      hard_blocking: waiverGapStatus === 'BLOCKED',
      capability_mode: waiverGapStatus,
    },
    {
      check_id: 'macro-derivatives-placeholder',
      check_title_cn: '宏观与衍生品校准',
      source_layer: 'L4 宏观与衍生品',
      target_factor_groups: ['宏观/衍生品型'],
      result_status: 'DISABLED',
      detail_cn: '一期未接入利率、通胀与期权上游序列，相关因子维度保持停用。',
      hard_blocking: false,
      capability_mode: 'DISABLED',
    },
  ];
}

type PitApprovedMetricCard = {
  id: string;
  title: string;
  headline: string;
  pill: string;
  status: string;
  body: string;
  details: string[];
  submodules?: PitReadinessSubmodule[];
};

type PitApprovedSummaryRow = {
  id: string;
  title: string;
  summary: string;
  status: string;
  statusLabel: string;
};

type PitApprovedMatrixRow = {
  id: string;
  title: string;
  summary: string;
  status: string;
  statusLabel: string;
};

type PitApprovedCoverageCard = {
  id: string;
  title: string;
  summary: string;
  status: string;
  statusLabel: string;
  metrics: string[];
  timeline: string[];
  chips: string[];
};

type PitApprovedActionRow = {
  id: string;
  code: string;
  summary: string;
  target: string;
};

const PIT_COVERAGE_PREVIEW_LIMIT = 3;

function buildApprovedPitMetricCards(): PitApprovedMetricCard[] {
  return [
    {
      id: 'pit-l1',
      title: 'L1 价格可回放',
      headline: '完全就绪',
      pill: '可正式诊断',
      status: 'READY',
      body: '前复权轨迹和 SPY / QQQ 校验闭合，价格型因子已不再受当前样本缺口阻断。',
      details: ['价格缺口 0', '复权轨迹 10 年完整'],
    },
    {
      id: 'pit-l2',
      title: 'L2 基础面 PIT',
      headline: '阻塞',
      pill: 'available_at 缺失',
      status: 'BLOCKED',
      body: '231 个标的仍缺 `available_at` 或 `Publish Date`，质量与估值族正式诊断不能放行。',
      details: ['F-Score 沙箱', 'Accruals 阻塞'],
    },
    {
      id: 'pit-l3',
      title: 'L3 情绪重放性',
      headline: '观察',
      pill: '仅现值字段风险',
      status: 'WARNING',
      body: '分析师上修与 FINRA 卖空成交可用于研究诊断，但历史修订明细与样本覆盖仍不稳定。',
      details: ['N < 3 占比 38%', '卖空延迟 1 日'],
    },
    {
      id: 'pit-l4',
      title: 'L4 宏观 / 衍生品',
      headline: '校准中',
      pill: '回归与曲面分离',
      status: 'CALIBRATING',
      body: '利率 / CPI / 商品 Beta 已可回归，隐波偏度仍缺 5 年期曲面历史，维持灰态。',
      details: ['利率 Beta 82%', '隐波偏度置灰'],
    },
  ];
}

function buildApprovedPitSummaryRows(): PitApprovedSummaryRow[] {
  return [
    {
      id: 'summary-price',
      title: '价格快照',
      summary: 'ds-price · PIT v2026.05.12',
      status: 'READY',
      statusLabel: 'L1 通过',
    },
    {
      id: 'summary-fundamentals',
      title: '基础面快照',
      summary: 'ds-fundamentals · 发布日期对齐缺口 231',
      status: 'BLOCKED',
      statusLabel: 'L2 阻塞',
    },
    {
      id: 'summary-universe',
      title: '样本池快照',
      summary: 'un-sp500 · 历史锚点 61 个',
      status: 'READY',
      statusLabel: '样本池通过',
    },
    {
      id: 'summary-mode',
      title: '诊断模式',
      summary: '价格族开放正式诊断，质量族回退沙箱，情绪族维持受限准入。',
      status: 'WARNING',
      statusLabel: '分层准入',
    },
  ];
}

function buildApprovedPitMatrixRows(): PitApprovedMatrixRow[] {
  return [
    {
      id: 'matrix-price',
      title: '动量 / 波动 / 流动性',
      summary: '价格链与样本池已通过，允许开展正式 10Y 诊断。',
      status: 'READY',
      statusLabel: '正式可用',
    },
    {
      id: 'matrix-quality',
      title: '质量 / 估值 / 规模',
      summary: '基础面字段已入 PIT 种子，但发布时间戳不完整，仅开放沙箱。',
      status: 'SANDBOX',
      statusLabel: '沙箱',
    },
    {
      id: 'matrix-sentiment',
      title: '分析师上修 / 卖空回补',
      summary: '存在仅现值字段与样本离散问题，维持有限就绪，不允许晋升。',
      status: 'WARNING',
      statusLabel: '受限',
    },
    {
      id: 'matrix-macro',
      title: '利率 / 通胀 / 商品 Beta',
      summary: '序列已可回归，但仍有 17 个标的的回归窗口漂移待复核。',
      status: 'CALIBRATING',
      statusLabel: '校准中',
    },
    {
      id: 'matrix-iv',
      title: '隐波偏度 / 借券成本',
      summary: '缺少期权曲面历史与借券成本账本，维持置灰。',
      status: 'DISABLED',
      statusLabel: '置灰',
    },
  ];
}

function buildApprovedPitCoverageCards(): PitApprovedCoverageCard[] {
  return [
    {
      id: 'coverage-fundamental-late',
      title: '基础面发布时间戳晚到',
      summary: 'L2 缺口。影响质量、估值、规模等依赖 observation-date 对齐的因子。',
      status: 'BLOCKED',
      statusLabel: '231 个',
      metrics: ['缺失占比 12.4%', '市值权重 7.8%', '阻断正式诊断'],
      timeline: ['Q1', 'Q2', 'Q3', 'Q4', 'Q1', 'Q2', 'Q3', 'Q4'],
      chips: ['ABT', 'COF', 'MSCI', 'RJF'],
    },
    {
      id: 'coverage-identity',
      title: '历史成员身份待解',
      summary: '价格链修复后，残余问题集中在退市符号生命周期与本地身份缓存。',
      status: 'WARNING',
      statusLabel: '17 个',
      metrics: ['缺失占比 0.9%', '市值权重 0.4%', '可研究豁免'],
      timeline: ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'],
      chips: ['ABK', 'ACE', 'ANR', 'APOL'],
    },
    {
      id: 'coverage-sentiment-current-only',
      title: '情绪字段仅现值化',
      summary: 'L3 缺口。一致预期与期权偏度虽有最新值，但历史明细不足，不能作为正式诊断证据。',
      status: 'SANDBOX',
      statusLabel: '研究态',
      metrics: ['影响 3 个因子族', '晋升资格关闭', '允许预览'],
      timeline: ['1W', '1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y'],
      chips: ['分析师上修', '空头回补', '隐波偏度'],
    },
  ];
}

function buildApprovedPitRuleAlerts(): PitQualityAlertItem[] {
  return [
    {
      code: 'FUNDAMENTAL_AVAILABLE_AT_MISSING',
      severity: 'danger',
      title_cn: 'FUNDAMENTAL_AVAILABLE_AT_MISSING',
      detail_cn: '发布日期缺失会直接把质量 / 估值因子挡在正式诊断之外。',
      hard_blocking: true,
      linked_factor_groups: ['质量/估值型'],
      target: 'ds-fundamentals',
    },
    {
      code: 'ANALYST_CONSENSUS_SAMPLE_LOW',
      severity: 'warning',
      title_cn: 'ANALYST_CONSENSUS_SAMPLE_LOW',
      detail_cn: '`N < 3` 时进入情绪盲区，不允许晋升，只保留研究提示。',
      hard_blocking: false,
      linked_factor_groups: ['情绪/微观型'],
      target: 'ds-analyst-consensus',
    },
    {
      code: 'RATE_BETA_DRIFT_PENDING',
      severity: 'calibrating',
      title_cn: 'RATE_BETA_DRIFT_PENDING',
      detail_cn: '窗口斜率漂移不阻断价格因子，但会让宏观敞口维持校准态。',
      hard_blocking: false,
      linked_factor_groups: ['宏观/衍生品型'],
      target: 'ds-option-skew',
    },
  ];
}

function buildApprovedPitActionRows(): PitApprovedActionRow[] {
  return [
    {
      id: 'action-fundamental',
      code: 'FUNDAMENTAL_PIT_NOT_READY',
      summary: '跳转 `#/snapshots?tab=equity&target=ds-fundamentals` 并高亮基础面发布日异常。',
      target: '#/snapshots?tab=equity&target=ds-fundamentals',
    },
    {
      id: 'action-analyst',
      code: 'ANALYST_CONSENSUS_NOT_REPLAYABLE',
      summary: '跳转 `#/snapshots?tab=equity&target=ds-analyst-consensus`，保留仅现值字段风险提示。',
      target: '#/snapshots?tab=equity&target=ds-analyst-consensus',
    },
    {
      id: 'action-iv',
      code: 'IV_SURFACE_NOT_READY',
      summary: '跳转 `#/snapshots?tab=equity&target=ds-option-skew`，明确隐波偏度维持置灰。',
      target: '#/snapshots?tab=equity&target=ds-option-skew',
    },
  ];
}

function stateClass(state: string | undefined): string {
  const normalized = String(state ?? '').toLowerCase();
  if (normalized.includes('缺口') || normalized.includes('danger') || normalized.includes('fail')) return 'danger';
  if (normalized.includes('预警') || normalized.includes('warn') || normalized.includes('漂移')) return 'warn';
  if (normalized.includes('通过') || normalized.includes('good') || normalized.includes('ready')) return 'good';
  return 'neutral';
}

function chartPath(values: number[], width = 720, height = 190): string {
  const safeValues = values.length ? values : [0];
  const allValues = [...safeValues, 0];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = Math.max(max - min, 0.001);
  return safeValues
    .map((value, index) => {
      const x = safeValues.length <= 1 ? 10 : 10 + (index / (safeValues.length - 1)) * (width - 20);
      const y = height - 34 - ((value - min) / span) * (height - 68);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function FactorDetailTrendChart({ summary }: { summary: ApiFactorDiagnosticSummary | null }): JSX.Element {
  const rankSeries = (summary?.ic_series ?? []).map((point) => point.rank_ic).filter(isNumber);
  const icSeries = (summary?.ic_series ?? []).map((point) => point.ic).filter(isNumber);
  return (
    <svg className="factor-detail-chart" viewBox="0 0 720 190" role="img" aria-label="排序 IC 滚动窗口">
      <line x1="0" y1="150" x2="720" y2="150" />
      <line x1="0" y1="100" x2="720" y2="100" />
      <line x1="0" y1="50" x2="720" y2="50" />
      <path className="factor-detail-chart__area" d={`${chartPath(rankSeries)} L 720 170 L 0 170 Z`} />
      <path className="factor-detail-chart__main" d={chartPath(rankSeries)} />
      <path className="factor-detail-chart__baseline" d={chartPath(icSeries)} />
    </svg>
  );
}

function FactorDecayChart(): JSX.Element {
  return (
    <svg className="factor-detail-chart" viewBox="0 0 720 190" role="img" aria-label="信号衰减曲线">
      <line x1="0" y1="150" x2="720" y2="150" />
      <line x1="0" y1="100" x2="720" y2="100" />
      <path className="factor-detail-chart__main" d="M10 42 C86 54 150 70 214 92 S342 120 420 129 S584 145 710 150" />
      <path className="factor-detail-chart__baseline" d="M10 74 C120 84 214 101 300 112 S520 132 710 141" />
    </svg>
  );
}

function FactorEvidenceHeatmap({ summary }: { summary: ApiFactorDiagnosticSummary | null }): JSX.Element {
  const yearLabels = ['2008', '2010', '2012', '2014', '2016', '2018', '2020', '2022', '2024', '2026'];
  const windows = ['10年', '20年', '30年'];
  const heatmap = summary?.evidence_heatmap ?? [];
  const cellsForWindow = (windowLabel: string) => {
    const matched = heatmap.filter((cell) => String(cell.window).includes(windowLabel));
    return matched.length ? matched : heatmap;
  };
  return (
    <div className="factor-detail-heat" aria-label="十格证据热力图">
      <span className="factor-detail-heat__label">窗口</span>
      {yearLabels.map((label) => <span className="factor-detail-heat__label" key={label}>{label}</span>)}
      {windows.map((windowLabel) => {
        const windowCells = cellsForWindow(windowLabel);
        return (
          <Fragment key={windowLabel}>
            <span className="factor-detail-heat__label">{windowLabel}夏普</span>
            {yearLabels.map((year, index) => {
              const cell = windowCells[index % Math.max(windowCells.length, 1)];
              const cellState = stateClass(cell?.state);
              const value = cellState === 'danger' ? '缺口' : num(cell?.value, 2);
              return (
                <span
                  className={`factor-detail-heat__cell is-${cellState}`}
                  title={[cell?.window, cell?.bucket, cell?.state].filter(Boolean).join(' · ')}
                  key={`${windowLabel}-${year}`}
                >
                  {value}
                </span>
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}

function FactorGroupReturns({ summary }: { summary: ApiFactorDiagnosticSummary | null }): JSX.Element {
  const groups = summary?.group_returns ?? [];
  const maxAbs = Math.max(...groups.map((item) => Math.abs(Number(item.mean_return ?? 0))), 0.001);
  if (!groups.length) return <div className="factor-empty">暂无分层收益数据。</div>;
  return (
    <div className="factor-detail-bars">
      {groups.map((item) => {
        const value = Number(item.mean_return ?? 0);
        return (
          <div className={value < 0 ? 'is-negative' : ''} key={item.group}>
            <span>{item.group}</span>
            <i><b style={{ width: `${Math.max(8, Math.abs(value) / maxAbs * 96).toFixed(1)}%` }} /></i>
            <em>{formatSignedPct(value)}</em>
          </div>
        );
      })}
    </div>
  );
}

function FactorStressCards({ summary }: { summary: ApiFactorDiagnosticSummary | null }): JSX.Element {
  const scenarios = [...(summary?.stress_scenarios ?? [])];
  if (scenarios.length < 3) {
    scenarios.push({
      name: '恢复期',
      data_kind: 'IC 转正',
      status: '观察',
      rank_ic: summary?.rank_ic ?? null,
    });
  }
  return (
    <div className="factor-detail-stress">
      {scenarios.slice(0, 3).map((scenario, index) => {
        const rankIc = typeof scenario.rank_ic === 'number' ? scenario.rank_ic : null;
        return (
          <div className="factor-detail-stress__card" key={`${String(scenario.name ?? 'stress')}-${index}`}>
            <span>{String(scenario.name ?? '压力场景')}</span>
            <strong>{rankIc === null ? String(scenario.status ?? '观察') : num(rankIc, 2)}</strong>
            <small>{String(scenario.data_kind ?? scenario.status ?? '样本')}</small>
          </div>
        );
      })}
    </div>
  );
}

function CoverageGapBucketCard({
  bucket,
  onOpenMapping,
}: {
  bucket: CoverageGapBucket;
  onOpenMapping: (detail: CoverageGapSymbolDetail) => void;
}): JSX.Element {
  const temporal = bucket.temporal_distribution ?? [];
  const maxMissing = Math.max(...temporal.map((item) => item.missing_count), 1);
  const labelEvery = Math.max(1, Math.ceil(temporal.length / 4));
  const detailsBySymbol = new Map((bucket.symbol_details ?? []).map((detail) => [detail.symbol, detail]));
  return (
    <article className="factor-gap-bucket">
      <div>
        <strong>{bucket.label}</strong>
        <span>{bucket.count} 个 · {pct(bucket.share_pct)}</span>
      </div>
      <div className="factor-gap-weight">
        <span>市值权重占比</span>
        <strong>{pct(bucket.mcap_weight_pct ?? 0, 2)}</strong>
      </div>
      <p>{pitCopy(bucket.evidence)}</p>
      <small>{pitCopy(bucket.recommendation)}</small>
      {temporal.length ? (
        <>
          <div className="factor-gap-timeline-head">
            <span>时间轴分布图</span>
            <small>最近窗口高亮</small>
          </div>
          <div className="factor-gap-timeline" aria-label={`${bucket.label} 时间轴分布图`}>
            {temporal.map((point, index) => {
              const showLabel = index === 0 || index === temporal.length - 1 || index % labelEvery === 0;
              return (
                <span
                  className={point.is_recent_window ? 'is-recent' : ''}
                  key={`${bucket.id}-${point.date}`}
                  style={{ height: `${Math.max(10, (point.missing_count / maxMissing) * 100).toFixed(1)}%` }}
                  title={`${point.date}: ${point.missing_count}/${point.member_count} 缺失`}
                >
                  {showLabel ? <i>{point.date.slice(0, 4)}</i> : null}
                </span>
              );
            })}
          </div>
        </>
      ) : null}
      <div className="factor-chip-row">
        {bucket.sample_symbols.slice(0, 8).map((symbol) => {
          const detail = detailsBySymbol.get(symbol);
          const canMap = detail?.mapping_action && detail.identity_status === 'UNRESOLVED';
          return canMap && detail ? (
            <button
              className="factor-symbol-chip"
              key={`${bucket.id}-${symbol}`}
              onClick={() => onOpenMapping(detail)}
              type="button"
            >
              {symbol}
            </button>
          ) : (
            <span key={`${bucket.id}-${symbol}`}>{symbol}</span>
          );
        })}
      </div>
    </article>
  );
}

export function PitCleaningCenterPage({
  highlightedSection,
  initialLoadDelayMs = 0,
}: {
  highlightedSection?: string;
  initialLoadDelayMs?: number;
}): JSX.Element {
  const api = useApiClient();
  const { pit, loading, error, reload } = usePitOverview(initialLoadDelayMs);
  const [snapshotLayerStatuses, setSnapshotLayerStatuses] = useState<SnapshotLayerStatusMap>({});
  const [gapOpen, setGapOpen] = useState(highlightedSection === 'coverage-gap');
  const [activeRuleId, setActiveRuleId] = useState('mad');
  const [waiverBusy, setWaiverBusy] = useState(false);
  const [waiverError, setWaiverError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [selectedMapping, setSelectedMapping] = useState<CoverageGapSymbolDetail | null>(null);
  const [selectedOpsAction, setSelectedOpsAction] = useState<PitOpsGuidanceAction | null>(null);
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsResult, setOpsResult] = useState<ApiPitIdentityScraperRestartResponse | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [mappingCanonical, setMappingCanonical] = useState('');
  const [mappingReason, setMappingReason] = useState('');
  const [mappingBusy, setMappingBusy] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  useEffect(() => {
    if (highlightedSection === 'coverage-gap') {
      setGapOpen(true);
    }
  }, [highlightedSection]);
  useEffect(() => {
    let alive = true;
    api
      .getSnapshotOverview()
      .then((payload) => {
        if (alive) setSnapshotLayerStatuses(snapshotLayerStatusMap(payload));
      })
      .catch(() => {
        if (alive) setSnapshotLayerStatuses({});
      });
    return () => {
      alive = false;
    };
  }, [api]);
  const rulePreviews = pit?.cleaning_rule_previews ?? [];
  const activeRule = rulePreviews.find((item) => item.id === activeRuleId) ?? rulePreviews[0];
  const openCoverageGapSection = (): void => {
    setGapOpen(true);
    window.requestAnimationFrame(() => {
      const target = document.getElementById('coverage-gap');
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      target?.setAttribute('tabindex', '-1');
      target?.focus?.({ preventScroll: true });
    });
  };
  const openMapping = (detail: CoverageGapSymbolDetail): void => {
    setSelectedMapping(detail);
    setMappingCanonical(detail.canonical_symbol || detail.symbol);
    setMappingReason(`手动覆盖 ${detail.symbol} 的历史代码生命周期映射`);
    setMappingError(null);
  };
  const runOpsAction = (action: PitOpsGuidanceAction): void => {
    if (action.target.startsWith('#')) {
      goToHashTarget(action.target);
      return;
    }
    setSelectedOpsAction(action);
    setOpsResult(null);
    setOpsError(null);
  };
  const executeOpsAction = async (): Promise<void> => {
    if (!selectedOpsAction || !pit?.ops_guidance) return;
    setOpsBusy(true);
    setOpsError(null);
    try {
      const result = await api.restartPitIdentityScraper({
        max_symbols: Math.max(1, pit.ops_guidance.identity_pending_count ?? 1),
        reason: 'PIT 身份修复任务触发',
        created_by: 'operator',
      });
      setOpsResult(result);
      reload();
    } catch (err) {
      setOpsError(err instanceof Error ? err.message : '身份修复任务执行失败。');
    } finally {
      setOpsBusy(false);
    }
  };
  const submitMapping = async (): Promise<void> => {
    if (!selectedMapping) return;
    setMappingBusy(true);
    setMappingError(null);
    try {
      await api.applyPitIdentityOverride({
        symbol: selectedMapping.symbol,
        canonical_symbol: mappingCanonical.trim().toUpperCase() || selectedMapping.symbol,
        company_name: selectedMapping.company_name || undefined,
        reason: mappingReason,
        created_by: 'operator',
      });
      setSelectedMapping(null);
      reload();
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : '身份映射覆盖失败。');
    } finally {
      setMappingBusy(false);
    }
  };
  const revokeWaiver = async (): Promise<void> => {
    if (!pit?.research_waiver?.id) return;
    setWaiverBusy(true);
    setWaiverError(null);
    try {
      await api.revokePitResearchWaiver(pit.research_waiver.id);
      setConfirmRevoke(false);
      reload();
    } catch (err) {
      setWaiverError(err instanceof Error ? err.message : '研究态豁免撤销失败。');
    } finally {
      setWaiverBusy(false);
    }
  };
  const factorAdmissionStatus = pit?.verified_diagnostics_enabled
    ? 'READY'
    : pit?.limited_diagnostics_enabled
      ? 'LIMITED_READY'
      : pit?.sandbox_diagnostics_enabled
        ? 'SANDBOX_READY'
        : 'BLOCKED';
  const pitExtended = pit as PitOverviewExtended | null;
  const pitLayerReadiness = useMemo(
    () => (pitExtended ? buildPitLayerReadiness(pitExtended) : []),
    [pitExtended],
  );
  const factorDiagnosticReadiness = useMemo(
    () => (pitExtended ? buildFactorDiagnosticReadiness(pitExtended) : []),
    [pitExtended],
  );
  const pitQualityAlerts = useMemo(
    () => (pitExtended ? buildPitQualityAlerts(pitExtended) : []),
    [pitExtended],
  );
  const snapshotLayerLinkage = useMemo(
    () => (pitExtended ? buildSnapshotLayerLinkage(pitExtended) : []),
    [pitExtended],
  );
  const approvedPitCards = useMemo(
    () => pitLayerReadiness.map((layer) => {
      const displayStatus = layer.status || snapshotLayerStatuses[pitLayerKey(layer.layer_id)] || 'BLOCKED';
      return {
        id: layer.layer_id,
        title: layer.title_cn,
        headline: pitLayerStatusLabel(displayStatus),
        pill: pitLayerStatusLabel(displayStatus),
        status: displayStatus,
        body: layer.summary,
        details: compactPitCardDetails(layer),
        submodules: layer.submodules,
      };
    }),
    [pitLayerReadiness, snapshotLayerStatuses],
  );
  const approvedPitSummaryRows = useMemo(
    () => snapshotLayerLinkage.slice(0, 4).map((item) => ({
      id: item.check_id,
      title: item.check_title_cn,
      summary: item.detail_cn,
      status: item.result_status,
      statusLabel: pitLayerStatusLabel(item.result_status),
    })),
    [snapshotLayerLinkage],
  );
  const approvedPitMatrixRows = useMemo(
    () => factorDiagnosticReadiness.map((group) => ({
      id: group.group_id,
      title: group.title_cn,
      summary: compactDiagnosticSummary(group),
      status: group.status,
      statusLabel: factorDiagnosticStatusLabel(group.status),
    })),
    [factorDiagnosticReadiness],
  );
  const approvedPitRuleAlerts = useMemo(() => pitQualityAlerts.slice(0, 6), [pitQualityAlerts]);
  const approvedPitActionRows = useMemo(() => {
    const rows = snapshotLayerLinkage
      .filter((item) => {
        const normalized = String(item.result_status ?? '').toUpperCase();
        return item.hard_blocking || ['BLOCKED', 'BLOCKED_PIT', 'BLOCKED_DATA', 'FAILED'].includes(normalized);
      })
      .map((item) => {
        const normalizedLayer = String(item.source_layer ?? '').toUpperCase();
        const normalizedCheck = String(item.check_id ?? '').toLowerCase();
        let target = '#/snapshots?tab=equity';
        if (normalizedLayer.includes('L2') || normalizedCheck.includes('fundamental')) {
          target = '#/snapshots?tab=equity&target=ds-fundamentals';
        } else if (normalizedCheck.includes('consensus')) {
          target = '#/snapshots?tab=equity&target=ds-analyst-consensus';
        } else if (normalizedCheck.includes('iv') || normalizedCheck.includes('macro')) {
          target = '#/snapshots?tab=equity&target=ds-option-skew';
        } else if (normalizedCheck.includes('price') || normalizedCheck.includes('universe')) {
          target = '#/snapshots?tab=equity&target=ds-price';
        }
        return {
          id: item.check_id,
          code: item.check_title_cn,
          summary: item.detail_cn,
          target,
        };
      });
    const capabilityRows = factorDiagnosticReadiness
      .filter((group) => String(group.status ?? '').toUpperCase() === 'PARTIAL_READY')
      .map((group) => ({
        id: `capability-${group.group_id}`,
        code: `${group.title_cn} 部分可用`,
        summary: group.upstream_capabilities[0]?.summary_cn || group.rationale_cn,
        target: '#/factors/factory',
      }));
    if (capabilityRows.length) {
      rows.push(...capabilityRows);
    }
    if (rows.length) {
      return rows;
    }
    return (pit?.ops_guidance?.actions ?? []).map((action, index) => ({
      id: `ops-action-${index + 1}`,
      code: pitPriorityLabel(action.priority),
      summary: pitCopy(action.label),
      target: action.target,
    }));
  }, [factorDiagnosticReadiness, pit?.ops_guidance?.actions, snapshotLayerLinkage]);
  const coverageGapBuckets = pit?.coverage_gap?.buckets ?? [];
  const visibleCoverageGapBuckets = coverageGapBuckets.slice(0, PIT_COVERAGE_PREVIEW_LIMIT);
  const verifiedWindow = pit?.diagnostic_windows?.verified;
  const sandboxWindow = pit?.diagnostic_windows?.sandbox;
  const waiverImpact = pit?.research_waiver?.impact_estimate;
  const showCoverageGap = gapOpen || Boolean(pit?.coverage_gap);
  return (
    <div className="factor-page" data-page-root="pit-cleaning-center">
      <PageHero
        eyebrow="数据基座"
        title="PIT 清洗中心"
        description="将源层快照转换为可回放、可诊断、可审计的点时数据门禁，隔离未来函数、幸存者偏差与仅现值字段（`current-only`）。"
        status={pit ? pitLayerStatusLabel(factorAdmissionStatus) : '读取中'}
        meta={
          pit ? (
            <>
              {verifiedWindow ? <span className="pit-chip">正式窗口 {verifiedWindow.start_date} 至 {verifiedWindow.end_date}</span> : null}
              {sandboxWindow ? <span className="pit-chip">研究窗口 {sandboxWindow.start_date} 至 {sandboxWindow.end_date}</span> : null}
            </>
          ) : undefined
        }
        actions={
          <>
            <button className="factor-btn factor-btn--primary" onClick={reload} type="button">
              重新检查 PIT 门禁
            </button>
          </>
        }
      />
      {loading ? <div className="factor-panel">正在读取点时数据门禁。</div> : null}
      {error ? <div className="factor-panel factor-panel--danger">{error}</div> : null}
      {pit ? (
        <>
          {pit.research_waiver ? (
            <section className="factor-panel factor-waiver-banner">
              <div>
                <strong>研究豁免已启用</strong>
                <p>
                  已临时忽略 {pit.research_waiver.ignored_symbol_count} 个非核心缺口，仅允许研究诊断，不允许正式晋升。预计 IC 扰动 {num(waiverImpact?.estimated_ic_delta_abs, 4)}，市值权重 {pct(waiverImpact?.mcap_weight_pct, 2)}。
                </p>
              </div>
                <button
                  className="factor-btn factor-btn--small"
                  disabled={waiverBusy}
                  onClick={() => setConfirmRevoke(true)}
                type="button"
              >
                撤销豁免
              </button>
            </section>
          ) : null}
          {confirmRevoke && pit.research_waiver ? (
            <section className="factor-panel factor-panel--danger">
              <div className="factor-section-title">
                <span>确认撤销研究态豁免</span>
                <span>{pit.research_waiver.id}</span>
              </div>
              <p>
                撤销后 PIT 会回到价格快照门禁状态；历史记录不会物理删除，只停止当前研究排除。
              </p>
              <div className="factor-action-row">
                <button className="factor-btn" disabled={waiverBusy} onClick={() => setConfirmRevoke(false)} type="button">保留</button>
                <button className="factor-btn factor-btn--primary" disabled={waiverBusy} onClick={() => void revokeWaiver()} type="button">确认撤销</button>
              </div>
            </section>
          ) : null}
          {waiverError ? <div className="factor-panel factor-panel--danger">{waiverError}</div> : null}
          <section className="factor-card-grid factor-card-grid--pit" aria-label="四层 PIT 准入卡">
            {approvedPitCards.map((card) => (
              <article className="factor-mini-card pit-layer-card" key={card.id}>
                <div className="pit-layer-card__top">
                  <div className="pit-layer-card__kicker">
                    <span>{card.title}</span>
                    <strong>{card.headline}</strong>
                  </div>
                  <span className={`factor-pill factor-pill--${statusVariant(card.status)}`}>{card.pill}</span>
                </div>
                <p>{card.body}</p>
                <div className="pit-layer-card__detail-row">
                  {card.details.map((detail) => (
                    <span className="pit-detail-pill" key={`${card.id}-${detail}`}>
                      {detail}
                    </span>
                  ))}
                </div>
                {(card.submodules ?? []).length ? (
                  <div className="pit-layer-card__submodules" aria-label={`${card.title} 子模块状态`}>
                    {(card.submodules ?? []).slice(0, 4).map((submodule) => (
                      <span
                        className={`pit-submodule-pill pit-submodule-pill--${statusVariant(submodule.status)}`}
                        key={`${card.id}-${submodule.id}`}
                        title={submodule.summary_cn}
                      >
                        <strong>{compactPitSubmoduleTitle(submodule)}</strong>
                        <em>{compactPitSubmoduleStatus(submodule.status)}</em>
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </section>
          <section className="pit-two-col">
            <article className="factor-panel">
              <div className="panel-header">
                <div className="panel-title">
                  <h2>PIT 门禁摘要</h2>
                  <p>按数据层汇总门禁结论，明确正式诊断、沙箱与受限准入。</p>
                </div>
                <span className={`pit-chip ${pit?.research_waiver ? 'pit-chip--warning' : ''}`}>{pit?.research_waiver ? '仅限研究' : pitLayerStatusLabel(factorAdmissionStatus)}</span>
              </div>
              <div className="kv-list">
                {approvedPitSummaryRows.map((row) => (
                  <div className="kv-row" key={row.id}>
                    <div>
                      <strong>{row.title}</strong>
                      <span>{row.summary}</span>
                    </div>
                    <span className={`factor-pill factor-pill--${statusVariant(row.status)}`}>{row.statusLabel}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="factor-panel">
              <div className="panel-header">
                <div className="panel-title">
                  <h2>因子诊断准入矩阵</h2>
                  <p>从 PIT 视角重述因子族准入层级，区分正式诊断、沙箱、受限与置灰。</p>
                </div>
                <span className="pit-chip">准入门槛</span>
              </div>
              <div className="matrix-rows matrix-rows--pit">
                {approvedPitMatrixRows.map((group) => (
                  <div className="matrix-row matrix-row--pit" key={group.id}>
                    <div className="matrix-row__copy">
                      <strong>{group.title}</strong>
                      <span>{group.summary}</span>
                    </div>
                    <span className={`factor-pill factor-pill--${statusVariant(group.status)}`}>{group.statusLabel}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>
          {showCoverageGap ? (
            <section className="pit-bottom-grid">
              <article className="factor-panel" id="coverage-gap">
                <div className="panel-header">
                  <div className="panel-title">
                    <h3>覆盖率下钻</h3>
                    <p>按缺口类型定位覆盖不足的时间段、样本权重与受影响因子。</p>
                  </div>
                  <span className="pit-chip">{`${coverageGapBuckets.length} 个主要缺口`}</span>
                </div>
                {visibleCoverageGapBuckets.length ? (
                  <div className="bucket-grid">
                    {visibleCoverageGapBuckets.map((bucket) => (
                      <CoverageGapBucketCard bucket={bucket} key={bucket.id} onOpenMapping={openMapping} />
                    ))}
                  </div>
                ) : (
                  <div className="factor-empty">当前没有覆盖率缺口。</div>
                )}
              </article>

              <article className={`factor-panel ${highlightedSection ? 'factor-panel--highlight' : ''}`}>
                <div className="panel-header">
                  <div className="panel-title">
                    <h3>点时异常核查与规则工作站</h3>
                    <p>统一管理去极值、发布日期对齐与宏观回归漂移规则。</p>
                  </div>
                  <span className="pit-chip">{`${approvedPitRuleAlerts.length} 条异常`}</span>
                </div>
                <div className="check-list">
                  {approvedPitRuleAlerts.map((alert) => (
                    <div className="check-row" key={alert.code}>
                      <div>
                        <strong>{alert.title_cn}</strong>
                        <span>{alert.detail_cn}</span>
                      </div>
                      <span className={`factor-pill factor-pill--${statusVariant(alert.hard_blocking ? 'BLOCKED' : alert.severity)}`}>
                        {alert.hard_blocking ? '硬阻断' : alert.severity === 'calibrating' ? '校准中' : '待复核'}
                      </span>
                    </div>
                  ))}
                </div>
                {rulePreviews.length ? (
                  <>
                    <div className="rule-tabs" aria-label="清洗规则工作台">
                      {rulePreviews.map((rule) => (
                        <button
                          aria-pressed={rule.id === activeRule?.id}
                          className={`rule-tab ${rule.id === activeRule?.id ? 'is-active' : ''}`}
                          key={rule.id}
                          onClick={() => setActiveRuleId(rule.id)}
                          type="button"
                        >
                          {rule.label}
                        </button>
                      ))}
                    </div>
                    {activeRule ? (
                      <div className="rule-preview">
                        <div className="rule-preview__stats">
                          <div>
                            <span>剔除比例</span>
                            <strong>{pct(activeRule.excluded_pct, 2)}</strong>
                          </div>
                          <div>
                            <span>命中样本</span>
                            <strong>{activeRule.excluded_count}</strong>
                          </div>
                          <div>
                            <span>当前判断</span>
                            <strong>{pitLayerStatusLabel(activeRule.status)}</strong>
                          </div>
                        </div>
                        <p className="divider-note">{`${pitCopy(activeRule.description)} ${pitCopy(activeRule.threshold_label)}`}</p>
                        <div className="sample-chip-row">
                          {activeRule.sample_points.slice(0, 3).map((point, index) => (
                            <span className="sample-chip" key={`${activeRule.id}-${point.symbol}-${point.date}-${index}`}>
                              {`${point.symbol} ${point.date} ${num(point.value, 4)}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </article>
            </section>
          ) : null}
          <section className="factor-panel">
            <div className="panel-header">
              <div className="panel-title">
                <h2>门禁行动列表</h2>
                <p>阻塞码可直接回跳到 `#/snapshots?tab=equity&target=...` 的具体对象，支持修复闭环。</p>
              </div>
              <span className="pit-chip">定位入口</span>
            </div>
            <div className="factor-governance-action-list">
              {approvedPitActionRows.map((row) => (
                <div className="factor-governance-action" key={row.id}>
                  <div>
                    <strong>{row.code}</strong>
                    <span>{row.summary}</span>
                  </div>
                  <button className="factor-btn" onClick={() => goToHashTarget(row.target)} type="button">
                    定位快照
                  </button>
                </div>
              ))}
            </div>
          </section>
          {selectedMapping ? (
            <section className="factor-panel factor-mapping-dialog" role="dialog" aria-label={`${selectedMapping.symbol} 身份映射覆盖`}>
              <div className="factor-section-title">
                <span>身份映射覆盖 · {selectedMapping.symbol}</span>
                <button className="factor-link" onClick={() => setSelectedMapping(null)} type="button">关闭</button>
              </div>
              <div className="factor-mapping-layout">
                <div>
                  <strong>历史代码路径</strong>
                  <ol className="factor-path-list">
                    {selectedMapping.ticker_path.map((step, index) => (
                      <li key={`${step.symbol}-${step.date}-${index}`}>
                        <span>{step.date || '未知日期'}</span>
                        <strong>{step.symbol}{step.canonical_symbol ? ` → ${step.canonical_symbol}` : ''}</strong>
                        <small>{step.label || step.source || '身份来源'}</small>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="factor-mapping-form">
                  <label>
                    <span>标准代码</span>
                    <input
                      aria-label="标准代码"
                      value={mappingCanonical}
                      onChange={(event) => setMappingCanonical(event.target.value)}
                      placeholder="例如 LHM"
                    />
                  </label>
                  <label>
                    审计原因
                    <textarea
                      value={mappingReason}
                      onChange={(event) => setMappingReason(event.target.value)}
                      rows={3}
                    />
                  </label>
                  {mappingError ? <p className="factor-error-text">{mappingError}</p> : null}
                  <button
                    className="factor-btn factor-btn--primary"
                    disabled={mappingBusy || !mappingCanonical.trim()}
                    onClick={() => void submitMapping()}
                    type="button"
                  >
                    建立映射覆盖
                  </button>
                </div>
              </div>
            </section>
          ) : null}
          {selectedOpsAction ? (
            <section className="factor-panel factor-ops-runbook" role="dialog" aria-label="身份修复任务">
              <div className="factor-section-title">
                <span>身份修复任务</span>
                <button className="factor-link" onClick={() => setSelectedOpsAction(null)} type="button">关闭任务面板</button>
              </div>
              <p>
                点击“执行重启任务”会重新解析当前挂起标的并写回身份映射缓存；正式门禁以重检结果为准。
              </p>
              <dl className="factor-kv-grid factor-kv-grid--compact">
                <div>
                  <dt>任务动作</dt>
                  <dd>{pitCopy(selectedOpsAction.label)}</dd>
                </div>
                <div>
                  <dt>待解析标的</dt>
                  <dd>{pit?.ops_guidance?.identity_pending_count ?? 0} 项</dd>
                </div>
                <div>
                  <dt>建议优先级</dt>
                  <dd>{pitPriorityLabel(selectedOpsAction.priority)}</dd>
                </div>
              </dl>
              {opsResult ? (
                <div className="factor-ops-result" role="status">
                  <strong>{pitCopy(opsResult.message)}</strong>
                  <span>
                    尝试 {opsResult.attempted_count} 项 · 成功 {opsResult.resolved_count} 项 · 剩余 {opsResult.pending_after} 项
                  </span>
                </div>
              ) : null}
              {opsError ? <p className="factor-error-text">{opsError}</p> : null}
              <div className="factor-action-row">
                <button
                  className="factor-btn factor-btn--primary"
                  disabled={opsBusy}
                  onClick={() => void executeOpsAction()}
                  type="button"
                >
                  {opsBusy ? '执行中...' : '执行重启任务'}
                </button>
                <button className="factor-btn factor-btn--small" onClick={reload} type="button">
                  重检 PIT 状态
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function FactorLibraryPage({
  initialSource,
  initialStatus,
  initialTag,
  initialLoadDelayMs = 0,
}: {
  initialSource?: string;
  initialStatus?: string;
  initialTag?: string;
  initialLoadDelayMs?: number;
}): JSX.Element {
  const api = useApiClient();
  const [payload, setPayload] = useState<ApiFactorListResponse | null>(null);
  const status = initialStatus ?? '';
  const [tierTab, setTierTab] = useState<'F1' | 'F2' | 'F3'>('F2');
  const [lifecycleTab, setLifecycleTab] = useState<FactorLifecycleTab>('all');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [levelFilters, setLevelFilters] = useState<FactorLevelKey[]>(['S', 'A', 'B']);
  const [selectedCorrelationFactorId, setSelectedCorrelationFactorId] = useState<string | undefined>();
  const [lineagePreviewFactorId, setLineagePreviewFactorId] = useState<string | null>(null);
  const [comparisonFactorIds, setComparisonFactorIds] = useState<string[]>([]);
  const [gapPopoverFactorId, setGapPopoverFactorId] = useState<string | null>(null);
  const [diagnosticPopoverFactorId, setDiagnosticPopoverFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<FactorSortState>({ key: 'updated_at', direction: 'desc' });
  const [governanceOpen, setGovernanceOpen] = useState(false);
  const [governanceOverview, setGovernanceOverview] = useState<ApiFactorGovernanceOverview | null>(null);
  const [governanceLoading, setGovernanceLoading] = useState(false);
  const [governanceError, setGovernanceError] = useState<string | null>(null);
  const [confirmGovernanceAction, setConfirmGovernanceAction] = useState<ApiFactorGovernanceAction | null>(null);
  const [governanceExecuteBusy, setGovernanceExecuteBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const loadFactorPayload = async (): Promise<void> => {
      try {
        setError(null);
        const factorPayload = await api.listFactors({
          source: initialSource,
          status: status || undefined,
          tag: initialTag,
          lifecycle: lifecycleTab,
        });
        if (!alive) return;
        const previewFactorDiagnostics = (api as {
          previewFactorDiagnostics?: (request: ApiFactorDiagnosticPreviewPayload) => Promise<ApiFactorDiagnosticPreview> | undefined;
        }).previewFactorDiagnostics;
        setPayload(factorPayload);
        const factorIds = previewFactorIdsForPayload(factorPayload);
        if (previewFactorDiagnostics && factorIds.length) {
          const diagnosticPreview = await previewFactorDiagnosticsForLibrary(previewFactorDiagnostics, factorIds);
          if (!alive) return;
          if (diagnosticPreview) {
            setPayload(mergeDiagnosticPreview(factorPayload, diagnosticPreview));
            return;
          }
        }
      } catch (err) {
        if (alive) setError((err as Error).message || 'Failed to load factors.');
      }
    };
    if (initialLoadDelayMs > 0 && payload === null) {
      const timer = window.setTimeout(() => {
        if (alive) void loadFactorPayload();
      }, initialLoadDelayMs);
      return () => {
        alive = false;
        window.clearTimeout(timer);
      };
    }
    void loadFactorPayload();
    return () => {
      alive = false;
    };
  }, [api, initialLoadDelayMs, initialSource, initialTag, lifecycleTab, reloadNonce, status]);
  useEffect(() => {
    if (governanceOverview || !governanceOpen) return;
    const getFactorGovernanceOverview = (api as {
      getFactorGovernanceOverview?: () => Promise<ApiFactorGovernanceOverview>;
    }).getFactorGovernanceOverview;
    if (!getFactorGovernanceOverview) return;
    let alive = true;
    const interactive = governanceOpen;
    if (interactive) {
      setGovernanceLoading(true);
      setGovernanceError(null);
    }
    const overviewRequest = getFactorGovernanceOverview();
    if (!overviewRequest || typeof (overviewRequest as PromiseLike<ApiFactorGovernanceOverview>).then !== 'function') {
      if (interactive && alive) setGovernanceLoading(false);
      return () => {
        alive = false;
      };
    }
    overviewRequest
      .then((overview) => {
        if (!alive) return;
        setGovernanceError(null);
        setGovernanceOverview(overview);
      })
      .catch((err: Error) => {
        if (alive && interactive) setGovernanceError(err.message || '治理任务加载失败。');
      })
      .finally(() => {
        if (alive && interactive) setGovernanceLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, governanceOpen, governanceOverview]);
  const factors = useMemo(() => {
    const selectedLevels = new Set(levelFilters);
    const filtered = (payload?.items ?? []).filter((factor) => {
      if (factor.tier_level !== tierTab) return false;
      if (categoryFilter && factorLibraryCategory(factor) !== categoryFilter) return false;
      if (selectedLevels.size && !selectedLevels.has(factorLevel(factor)?.key as FactorLevelKey)) return false;
      return true;
    });
    return [...filtered].sort((left, right) => compareFactorsBySort(left, right, sort));
  }, [categoryFilter, levelFilters, payload?.items, sort, tierTab]);
  const factorLookup = useMemo(() => new Map((payload?.items ?? []).map((factor) => [factor.id, factor])), [payload?.items]);
  const confirmPruneComparison = useMemo(
    () => confirmGovernanceAction ? governancePruneComparison(confirmGovernanceAction) : null,
    [confirmGovernanceAction],
  );
  const resolveGovernanceFactorIdentity = (factorId: string, fallbackName?: string | null) => {
    const factor = factorLookup.get(factorId);
    return {
      id: factor?.descriptor?.canonical_id ?? factor?.id ?? factorId,
      name: factor?.name ?? fallbackName ?? factorId,
    };
  };
  const updateSort = (key: FactorSortKey) => {
    setSort((current) => (
      current.key === key
        ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: 'desc' }
    ));
  };
  const toggleLevelFilter = (level: FactorLevelKey) => {
    setLevelFilters((current) => (
      current.includes(level)
        ? current.filter((item) => item !== level)
        : [...current, level]
    ));
  };
  useEffect(() => {
    const visibleIds = new Set(factors.map((factor) => factor.id));
    setComparisonFactorIds((current) => current.filter((factorId) => visibleIds.has(factorId)));
    if (selectedCorrelationFactorId && !visibleIds.has(selectedCorrelationFactorId)) {
      setSelectedCorrelationFactorId(undefined);
    }
    if (gapPopoverFactorId && !visibleIds.has(gapPopoverFactorId)) {
      setGapPopoverFactorId(null);
    }
    if (diagnosticPopoverFactorId && !visibleIds.has(diagnosticPopoverFactorId)) {
      setDiagnosticPopoverFactorId(null);
    }
    if (lineagePreviewFactorId && !visibleIds.has(lineagePreviewFactorId)) {
      setLineagePreviewFactorId(null);
    }
  }, [diagnosticPopoverFactorId, factors, gapPopoverFactorId, lineagePreviewFactorId, selectedCorrelationFactorId]);
  useEffect(() => {
    if (!lineagePreviewFactorId) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setLineagePreviewFactorId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lineagePreviewFactorId]);
  const selectedCorrelationFactor = useMemo(
    () => factors.find((factor) => factor.id === selectedCorrelationFactorId) ?? factors[0],
    [factors, selectedCorrelationFactorId],
  );
  const lineagePreviewFactor = useMemo(
    () => factors.find((factor) => factor.id === lineagePreviewFactorId) ?? null,
    [factors, lineagePreviewFactorId],
  );
  const highCorrelationIds = useMemo(() => new Set(
    selectedCorrelationFactor
      ? factors
          .filter((factor) => factor.id !== selectedCorrelationFactor.id && factorCorrelation(selectedCorrelationFactor, factor) >= 0.7)
          .map((factor) => factor.id)
      : [],
  ), [factors, selectedCorrelationFactor]);
  const localGovernanceActions = useMemo(
    () => buildLocalGovernanceActions(factors, highCorrelationIds),
    [factors, highCorrelationIds],
  );
  const rawGovernanceActions = governanceOverview ? governanceOverview.actions : localGovernanceActions;
  const governanceActions = rawGovernanceActions.filter(isGovernanceTaskAction);
  const localGovernanceTaskCount = localGovernanceActions.filter(isGovernanceTaskAction).length;
  const comparisonFactors = useMemo(
    () => comparisonFactorIds
      .map((factorId) => factors.find((factor) => factor.id === factorId))
      .filter((factor): factor is ApiFactorListItem => Boolean(factor)),
    [comparisonFactorIds, factors],
  );
  const toggleComparisonFactor = (factorId: string, checked: boolean) => {
    setComparisonFactorIds((current) => {
      if (!checked) return current.filter((id) => id !== factorId);
      const next = [...current.filter((id) => id !== factorId), factorId];
      return next.slice(-2);
    });
  };
  const openGovernanceConfirmation = (action: ApiFactorGovernanceAction): void => {
    setGovernanceError(null);
    setConfirmGovernanceAction(action);
  };
  const executeGovernanceAction = async (): Promise<void> => {
    if (!confirmGovernanceAction) return;
    const executeAction = api.executeFactorGovernanceAction;
    if (!executeAction) {
      setGovernanceError('当前 API 不支持治理任务执行。');
      return;
    }
    const command = String(confirmGovernanceAction.command ?? confirmGovernanceAction.kind ?? '').toUpperCase();
    const factorIds = (confirmGovernanceAction.affected_factor_ids ?? confirmGovernanceAction.factor_ids ?? []).map(String);
    setGovernanceExecuteBusy(true);
    setGovernanceError(null);
    try {
      const response = await executeAction(confirmGovernanceAction.id, {
        confirm: true,
        command,
        factor_ids: factorIds,
        reason: confirmGovernanceAction.offline_reason || confirmGovernanceAction.detail || `${governanceKindLabel(command)}确认执行`,
        keep_factor_id: confirmGovernanceAction.keep_factor_id ?? null,
        detail: {
          action_id: confirmGovernanceAction.id,
          criteria: confirmGovernanceAction.criteria ?? {},
          offline_detail: confirmGovernanceAction.offline_detail ?? {},
        },
      });
      setGovernanceOverview(response.governance_overview ?? null);
      setConfirmGovernanceAction(null);
      setReloadNonce((value) => value + 1);
    } catch (err) {
      setGovernanceError(err instanceof Error ? err.message : '治理任务执行失败。');
    } finally {
      setGovernanceExecuteBusy(false);
    }
  };
  const librarySummary = useMemo(() => {
    const allFactors = payload?.items ?? [];
    const summaryRecord = payload?.summary;
    const systemSeedCount = recordNumber(summaryRecord, 'system_seed_count') ??
      allFactors.filter((factor) => factor.source === 'SYSTEM_SEED' || factor.descriptor?.source_prefix === 's').length;
    const diagnosableCount = allFactors.filter((factor) => (
      factor.diagnostic_status === 'READY_TO_DIAGNOSE' ||
      factor.diagnostic_status === 'COMPLETED' ||
      Boolean(factor.latest_diagnostic_summary?.run_id)
    )).length;
    const sandboxReadyCount = allFactors.filter((factor) => factor.diagnostic_status === 'SANDBOX_READY').length;
    const governanceQueueCountFromOverview = governanceOverview
      && Number.isFinite(governanceOverview.queue_count)
      ? governanceOverview.queue_count
      : governanceActions.length;
    const governanceQueueCount = governanceOverview
      ? governanceQueueCountFromOverview
      : recordNumber(summaryRecord, 'governance_queue_count') ?? localGovernanceTaskCount;
    const strategyUsageCount = recordNumber(summaryRecord, 'strategy_usage_factor_count') ??
      recordNumber(summaryRecord, 'strategy_reference_factor_count') ??
      0;
    return {
      systemSeedCount,
      diagnosableCount,
      sandboxReadyCount,
      governanceQueueCount,
      strategyUsageCount,
      allCount: recordNumber(summaryRecord, 'all_count') ?? allFactors.length,
      onlineCount: recordNumber(summaryRecord, 'online_count') ?? allFactors.filter((factor) => !isFactorOffline(factor)).length,
      offlineCount: recordNumber(summaryRecord, 'offline_count') ?? allFactors.filter(isFactorOffline).length,
      archivedCount: recordNumber(summaryRecord, 'archived_count') ?? recordNumber(summaryRecord, 'offline_count') ?? allFactors.filter((factor) => factor.lifecycle === 'archived' || isFactorOffline(factor)).length,
      lifecycleSandboxCount: recordNumber(summaryRecord, 'lifecycle_sandbox_count') ?? allFactors.filter((factor) => factor.lifecycle === 'sandbox').length,
      toBeVerifiedCount: recordNumber(summaryRecord, 'to_be_verified_count') ?? allFactors.filter((factor) => factor.lifecycle === 'to_be_verified').length,
      f1Count: recordNumber(summaryRecord, 'f1_count') ?? allFactors.filter((factor) => factor.tier_level === 'F1').length,
      f2Count: recordNumber(summaryRecord, 'f2_count') ?? allFactors.filter((factor) => factor.tier_level === 'F2').length,
      f3Count: recordNumber(summaryRecord, 'f3_count') ?? allFactors.filter((factor) => factor.tier_level === 'F3').length,
    };
  }, [governanceActions.length, governanceOverview, localGovernanceTaskCount, payload?.items, payload?.summary]);
  const pitStatus = recordString(payload?.summary, 'pit_status');
  const confirmGovernanceCommand = confirmGovernanceAction
    ? String(confirmGovernanceAction.command ?? confirmGovernanceAction.kind ?? '').toUpperCase()
    : '';
  const confirmOptimizedFactor = confirmGovernanceCommand === 'PUBLISH_OPTIMIZED_FACTOR'
    ? previewRecord(confirmGovernanceAction?.optimized_factor)
    : null;
  const confirmOptimizedSummary = previewRecord(confirmOptimizedFactor?.diagnostic_summary);
  const confirmOptimizedName = recordString(confirmOptimizedFactor ?? undefined, 'name') ?? '待入库反向因子';
  const confirmOptimizedId = recordString(confirmOptimizedFactor ?? undefined, 'id') ?? '待生成';
  const confirmOptimizedGrade = recordString(confirmOptimizedFactor ?? undefined, 'grade') ?? '待生成';
  const confirmOptimizedExpression = recordString(confirmOptimizedFactor ?? undefined, 'expression') ?? '待生成';
  const confirmAffectedFactorIds = confirmGovernanceAction
    ? (confirmGovernanceAction.affected_factor_ids ?? confirmGovernanceAction.factor_ids ?? []).map(String)
    : [];
  const confirmAffectedIdentities = confirmAffectedFactorIds.map((factorId) => {
    const fallbackName = confirmPruneComparison?.candidate.factorId === factorId
      ? confirmPruneComparison.candidate.factorName
      : null;
    return resolveGovernanceFactorIdentity(factorId, fallbackName);
  });
  const confirmMvpIdentity = confirmGovernanceAction?.keep_factor_id
    ? resolveGovernanceFactorIdentity(confirmGovernanceAction.keep_factor_id, confirmPruneComparison?.mvp.factorName)
    : null;
  const confirmPruneCandidateIdentity = confirmPruneComparison
    ? resolveGovernanceFactorIdentity(confirmPruneComparison.candidate.factorId, confirmPruneComparison.candidate.factorName)
    : null;
  const confirmPruneMvpIdentity = confirmPruneComparison
    ? resolveGovernanceFactorIdentity(confirmPruneComparison.mvp.factorId, confirmPruneComparison.mvp.factorName)
    : null;
  return (
    <div className="factor-page" data-page-root="factor-library">
      <PageHero
        eyebrow="Alpha 资产"
        title="因子库"
        description="按 F1/F2/F3 管理因子、血缘、质量与生命周期。"
        meta={
          <>
            <span className="factor-hero-pill">PIT 准入：{pitStatus ? factorPitAdmissionLabel(pitStatus) : '正式诊断可用'}</span>
            <span className="factor-hero-pill factor-hero-pill--blue">10年样本窗口闭合</span>
            <span className="factor-hero-pill factor-hero-pill--warn">{librarySummary.toBeVerifiedCount} 个因子待校准</span>
          </>
        }
        actions={
          <>
            <button
              className="factor-btn factor-governance-trigger"
              onClick={() => setGovernanceOpen(true)}
              aria-haspopup="dialog"
            >
              治理任务 <span>{librarySummary.governanceQueueCount}</span>
            </button>
            <button className="factor-btn factor-btn--primary" onClick={() => navigateTo('/factors/new')}>新建人工因子</button>
          </>
        }
      />
      <section className="factor-layer-tabs" role="tablist" aria-label="因子库分层">
        {FACTOR_LAYER_TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={tierTab === tab.key}
            className={`factor-layer-tab ${tierTab === tab.key ? 'is-active' : ''}`}
            key={tab.key}
            onClick={() => {
              setTierTab(tab.key);
              setComparisonFactorIds([]);
              setSelectedCorrelationFactorId(undefined);
              setLineagePreviewFactorId(null);
            }}
          >
            <div>
              <strong>{tab.title}</strong>
              <span>{tab.description}</span>
            </div>
            <em>{String(librarySummary[tab.countKey])}</em>
          </button>
        ))}
      </section>
      <section className="factor-card-grid factor-card-grid--metrics factor-library-summary" aria-label="因子库摘要指标">
        <article className="factor-mini-card">
          <span>F1 原始指标</span>
          <strong>{librarySummary.f1Count}</strong>
          <p>收盘价、市值、净利润、成交额、换手率等唯一水源。</p>
        </article>
        <article className="factor-mini-card">
          <span>F2 已标准化</span>
          <strong>{librarySummary.f2Count}</strong>
          <p>完成去量纲和横向可比处理，可进入诊断与组合筛选。</p>
        </article>
        <article className="factor-mini-card">
          <span>F3 在线 Alpha</span>
          <strong>{librarySummary.f3Count}</strong>
          <p>具备明确投资逻辑、血缘链路和组合层审计记录。</p>
        </article>
        <article className="factor-mini-card">
          <span>待校准/归档</span>
          <strong>{librarySummary.toBeVerifiedCount + librarySummary.archivedCount}</strong>
          <p>数据断流、跳空、环境变更或相关性冗余触发复核。</p>
        </article>
      </section>
      {governanceOpen ? (
        <div className="factor-governance-modal" role="dialog" aria-modal="true" aria-label="治理任务">
          <div className="factor-governance-modal__panel">
            <div className="factor-governance-modal__header">
              <div>
                <strong>治理任务</strong>
                <span>执行类指令需要二次确认；策略建议只会带入创建页并保持草稿状态。</span>
              </div>
              <button type="button" className="factor-governance-modal__close" aria-label="关闭治理任务" onClick={() => setGovernanceOpen(false)}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="factor-governance-modal__body">
              {governanceLoading ? <p className="factor-muted">正在加载治理任务...</p> : null}
              {governanceError ? <p className="factor-error-text">{governanceError}</p> : null}
              <div className="factor-governance-action-list">
                {governanceActions.length ? governanceActions.map((action) => (
                  <article className={`factor-governance-action ${governanceActionClass(action)}`} key={action.id}>
                    <div>
                      <span className="factor-pill">{governanceKindLabel(action.kind)}</span>
                      <strong>{action.title}</strong>
                      <p>{action.detail}</p>
                      <small>关联因子：{action.factor_ids.join('、') || '待系统匹配'}</small>
                    </div>
                    {String(action.kind).toUpperCase() === 'FACTOR_MODEL_SUGGESTION' ? (
                      <button
                        className="factor-btn factor-btn--primary factor-btn--small"
                        type="button"
                        onClick={() => {
                          setGovernanceOpen(false);
                          openGovernanceAction(action);
                        }}
                      >
                        带入创建页
                      </button>
                    ) : null}
                    {String(action.command ?? action.kind).toUpperCase() === 'PUBLISH_OPTIMIZED_FACTOR' ? (
                      <button
                        className="factor-btn factor-btn--primary factor-btn--small"
                        type="button"
                        onClick={() => openGovernanceConfirmation(action)}
                      >
                        确认入库
                      </button>
                    ) : null}
                    {['DEPRECATE', 'PRUNE'].includes(String(action.command ?? action.kind).toUpperCase()) ? (
                      <button
                        className="factor-btn factor-btn--primary factor-btn--small"
                        type="button"
                        onClick={() => openGovernanceConfirmation(action)}
                      >
                        二次确认
                      </button>
                    ) : null}
                  </article>
                )) : (
                  <div className="factor-governance-empty">当前没有待治理任务。</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {confirmGovernanceAction ? (
        <div className="factor-governance-modal" role="dialog" aria-modal="true" aria-label="确认治理任务">
          <div className="factor-governance-modal__panel factor-governance-modal__panel--confirm">
            <div className="factor-governance-modal__header">
              <div>
                <strong>{confirmGovernanceCommand === 'PUBLISH_OPTIMIZED_FACTOR' ? '确认入库' : '确认执行'} {governanceKindLabel(String(confirmGovernanceAction.command ?? confirmGovernanceAction.kind))}</strong>
                <span>
                  {confirmGovernanceCommand === 'PUBLISH_OPTIMIZED_FACTOR'
                    ? '该操作会写入新的反向因子，来源因子仍保留治理审计。'
                    : '该操作会写入软下线状态，因子仍可在已下线 tab 和详情页审计。'}
                </span>
              </div>
              <button type="button" className="factor-governance-modal__close" aria-label="关闭确认治理任务" onClick={() => setConfirmGovernanceAction(null)}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="factor-governance-modal__body">
              <dl className="factor-kv-grid">
                <div><dt>任务 ID</dt><dd>{confirmGovernanceAction.id}</dd></div>
                <div>
                  <dt>关联因子</dt>
                  <dd className="factor-governance-identity-list">
                    {confirmAffectedIdentities.map((identity) => (
                      <FactorGovernanceIdentity key={identity.id} name={identity.name} id={identity.id} />
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>保留 MVP</dt>
                  <dd>
                    {confirmMvpIdentity ? (
                      <FactorGovernanceIdentity name={confirmMvpIdentity.name} id={confirmMvpIdentity.id} />
                    ) : '不适用'}
                  </dd>
                </div>
                <div><dt>下线原因</dt><dd>{confirmGovernanceAction.offline_reason ?? confirmGovernanceAction.detail}</dd></div>
              </dl>
              {confirmPruneComparison && confirmPruneCandidateIdentity && confirmPruneMvpIdentity ? (
                <section className="factor-governance-prune" aria-label="冗余裁剪参数对比">
                  <div className="factor-governance-prune__header">
                    <strong>冗余裁剪参数对比</strong>
                    <span>相关性 {num(confirmPruneComparison.correlation, 2)}</span>
                  </div>
                  <div className="factor-governance-prune__cards">
                    <article className="factor-governance-prune-card">
                      <span>待裁剪因子</span>
                      <FactorGovernanceIdentity name={confirmPruneCandidateIdentity.name} id={confirmPruneCandidateIdentity.id} />
                      <ul className="factor-governance-prune__metrics">
                        <li>Rank IC {num(confirmPruneComparison.candidate.rankIc, 3)}</li>
                        <li>IR {num(confirmPruneComparison.candidate.ir, 2)}</li>
                        <li>覆盖率 {pct(confirmPruneComparison.candidate.coverage, 2)}</li>
                      </ul>
                    </article>
                    <article className="factor-governance-prune-card factor-governance-prune-card--mvp">
                      <span>保留 MVP</span>
                      <FactorGovernanceIdentity name={confirmPruneMvpIdentity.name} id={confirmPruneMvpIdentity.id} />
                      <ul className="factor-governance-prune__metrics">
                        <li>Rank IC {num(confirmPruneComparison.mvp.rankIc, 3)}</li>
                        <li>IR {num(confirmPruneComparison.mvp.ir, 2)}</li>
                        <li>覆盖率 {pct(confirmPruneComparison.mvp.coverage, 2)}</li>
                      </ul>
                    </article>
                  </div>
                  <p className="factor-governance-prune__plan">
                    <strong>最终方案</strong>
                    保留 {confirmPruneMvpIdentity.name}（{confirmPruneMvpIdentity.id}），下线 {confirmPruneCandidateIdentity.name}（{confirmPruneCandidateIdentity.id}）；冗余因子不参与多因子合成权重分配。
                  </p>
                </section>
              ) : null}
              {confirmOptimizedFactor ? (
                <section className="factor-governance-optimized" aria-label="反向因子入库预览">
                  <div className="factor-governance-optimized__header">
                    <strong>优化后因子</strong>
                    <span>Grade {confirmOptimizedGrade}</span>
                  </div>
                  <dl className="factor-kv-grid factor-kv-grid--compact">
                    <div><dt>候选名称</dt><dd>{confirmOptimizedName}</dd></div>
                    <div><dt>候选 ID</dt><dd><code>{confirmOptimizedId}</code></dd></div>
                    <div><dt>表达式</dt><dd><code>{confirmOptimizedExpression}</code></dd></div>
                    <div><dt>Rank IC</dt><dd>{num(recordNumber(confirmOptimizedSummary ?? undefined, 'rank_ic'), 3)}</dd></div>
                    <div><dt>IR</dt><dd>{num(recordNumber(confirmOptimizedSummary ?? undefined, 'ir'), 2)}</dd></div>
                    <div><dt>覆盖率</dt><dd>{pct(recordNumber(confirmOptimizedSummary ?? undefined, 'coverage'), 2)}</dd></div>
                  </dl>
                </section>
              ) : null}
              <p className="factor-governance-confirm-note">
                {governanceOfflineEffectCopy(confirmGovernanceAction)}
              </p>
              {governanceError ? <p className="factor-error-text" role="alert">{governanceError}</p> : null}
            </div>
            <div className="factor-action-row factor-governance-modal__footer">
              <button className="factor-btn factor-btn--small" type="button" onClick={() => setConfirmGovernanceAction(null)}>
                取消
              </button>
              <button
                className="factor-btn factor-btn--primary"
                type="button"
                disabled={governanceExecuteBusy}
                onClick={() => void executeGovernanceAction()}
              >
                {governanceExecuteBusy ? '执行中...' : (confirmGovernanceCommand === 'PUBLISH_OPTIMIZED_FACTOR' ? '确认入库' : '确认执行')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <section className="factor-panel factor-ledger-panel">
        <div className="factor-ledger-header">
          <div>
            <strong>因子资产台账</strong>
            <p>当前视图：{FACTOR_LAYER_LABELS[tierTab]}，表头按机构级因子治理字段重排</p>
          </div>
          <div className="factor-lifecycle-tabs" role="tablist" aria-label="因子生命周期视图">
            {FACTOR_LIFECYCLE_TABS.map((tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={lifecycleTab === tab.key}
                className={lifecycleTab === tab.key ? 'is-active' : ''}
                key={tab.key}
                onClick={() => {
                  setLifecycleTab(tab.key);
                  setComparisonFactorIds([]);
                  setSelectedCorrelationFactorId(undefined);
                  setLineagePreviewFactorId(null);
                }}
              >
                {tab.label} <span>{String(librarySummary[tab.countKey as keyof typeof librarySummary] ?? 0)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="factor-toolbar">
          <div className="factor-toolbar__filters" aria-label="因子表格筛选项">
            <select aria-label="因子族" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">全部因子族</option>
              {Object.entries(FACTOR_LIBRARY_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <div className="factor-level-filter" aria-label="因子级别筛选">
              {FACTOR_LEVELS.map((level) => (
                <button
                  className={levelFilters.includes(level.key) ? 'is-active' : ''}
                  key={level.key}
                  onClick={() => toggleLevelFilter(level.key)}
                  type="button"
                >
                  {level.key}
                </button>
              ))}
            </div>
          </div>
          <span className="factor-muted">当前视图 {factors.length} 个因子</span>
        </div>
        {error ? <div className="factor-panel factor-panel--danger">{error}</div> : null}
        <div className="factor-table-wrap">
          <table className={`factor-table factor-table--phase1 factor-table--${lifecycleTab}`}>
            <thead>
              <tr>
                <th><div className="factor-th-content"><span>因子基本信息</span></div></th>
                <th><div className="factor-th-content"><span>所属库</span></div></th>
                <th><div className="factor-th-content"><span>血缘溯源</span></div></th>
                <th><div className="factor-th-content"><span>算子状态灯</span></div></th>
                <th aria-sort={ariaSortFor('rank_ic', sort)}>
                  <SortableHeader
                    label="质量指标"
                    sortKey="rank_ic"
                    sort={sort}
                    onSort={updateSort}
                    tooltip={<HelpTooltip label="质量指标解释" lines={DIAGNOSTIC_TOOLTIP_LINES} />}
                  />
                </th>
                <th aria-sort={ariaSortFor('level', sort)}>
                  <SortableHeader
                    label="因子级别"
                    sortKey="level"
                    sort={sort}
                    onSort={updateSort}
                    tooltip={<HelpTooltip label="因子级别名词解释" lines={FACTOR_LEVEL_TOOLTIP_LINES} />}
                  />
                </th>
                <th><div className="factor-th-content"><span>生命周期</span></div></th>
                <th><div className="factor-th-content"><span>操作</span></div></th>
              </tr>
            </thead>
            <tbody>
              {factors.length ? factors.map((factor) => (
                <tr
                  className={highCorrelationIds.has(factor.id) ? 'is-correlation-highlight' : ''}
                  data-correlation-highlight={highCorrelationIds.has(factor.id) ? 'true' : undefined}
                  key={factor.id}
                >
                  <td>
                    <div className="factor-name-row">
                      <button className="factor-link" onClick={() => navigateTo(`/factors/${factor.id}`)}>{factor.name}</button>
                      <span className="factor-category-tag" data-category={factorLibraryCategory(factor)}>
                        {factorLibraryCategoryLabel(factorLibraryCategory(factor))}
                      </span>
                      <HelpTooltip label={`${factor.name} 公式`} lines={[factor.expression]} mono />
                    </div>
                    <code className="factor-id">{factor.descriptor?.canonical_id ?? factor.id}</code>
                  </td>
                  <td><FactorTierCell factor={factor} /></td>
                  <td>
                    <FactorLineageCell
                      factor={factor}
                      selected={lineagePreviewFactorId === factor.id}
                      onPreview={() => setLineagePreviewFactorId((current) => (current === factor.id ? null : factor.id))}
                    />
                  </td>
                  <td><OperatorStatusLights factor={factor} /></td>
                  <td><DiagnosticCell factor={factor} /></td>
                  <td><FactorLevelCell factor={factor} /></td>
                  <td><FactorLifecycleCell factor={factor} /></td>
                  <td>
                    <div className="factor-row-actions">
                      <button className="factor-link" onClick={() => navigateTo(`/factors/${factor.id}`)} type="button">诊断</button>
                      <button className="factor-link" onClick={() => navigateTo(`/factors/${factor.id}`)} type="button">详情</button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8}>
                    <div className="factor-empty">当前筛选条件下暂无因子。</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {lineagePreviewFactor ? (
        <FactorLineagePreview
          factor={lineagePreviewFactor}
          factors={payload?.items ?? []}
          onClose={() => setLineagePreviewFactorId(null)}
        />
      ) : null}
      <section className="factor-panel factor-correlation-panel">
        <div className="factor-section-title">
          <span>正交性热力图</span>
          <span className="factor-muted">相关性阈值 0.70</span>
        </div>
        <FactorCorrelationMatrix
          factors={factors}
          selectedFactorId={selectedCorrelationFactor?.id}
          onSelect={setSelectedCorrelationFactorId}
        />
      </section>
    </div>
  );
}

export function FactorDetailPage({ factorId }: { factorId: string }): JSX.Element {
  const api = useApiClient();
  const [factor, setFactor] = useState<ApiFactorDetail | null>(null);
  const [pit, setPit] = useState<ApiPitDataOverview | null>(null);
  const [summary, setSummary] = useState<ApiFactorDiagnosticSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pitError, setPitError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFactor(null);
    setPit(null);
    setSummary(null);
    setError(null);
    setPitError(null);
    api
      .getFactor(factorId)
      .then((factorPayload) => {
        if (!alive) return;
        setFactor(factorPayload);
        setSummary(factorPayload.latest_diagnostic_summary ?? null);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message || '因子详情加载失败。');
      });
    api
      .getPitDataOverview()
      .then((pitPayload) => {
        if (alive) setPit(pitPayload);
      })
      .catch((err: Error) => {
        if (alive) setPitError(err.message || 'PIT 版本信息加载失败，诊断提交暂不可用。');
      });
    return () => {
      alive = false;
    };
  }, [api, factorId]);
  const hasExistingDiagnostic = Boolean(summary?.run_id ?? factor?.last_diagnostic_run_id) ||
    factor?.diagnostic_status === 'COMPLETED' ||
    summary?.status === 'COMPLETED';
  const diagnosticMode = !hasExistingDiagnostic && (factor?.diagnostic_status === 'SANDBOX_READY' || (!pit?.verified_diagnostics_enabled && pit?.sandbox_diagnostics_enabled))
    ? 'SANDBOX'
    : 'VERIFIED';
  const primaryActionLabel = hasExistingDiagnostic ? '重新诊断' : '点击诊断';
  const canRun = Boolean(pit) && (
    factor?.diagnostic_status === 'READY_TO_DIAGNOSE' ||
    factor?.diagnostic_status === 'SANDBOX_READY' ||
    factor?.diagnostic_status === 'COMPLETED'
  );
  const runDiagnostic = () => {
    if (!factor || !pit) {
      setPitError('PIT 版本信息仍在加载，暂不能提交诊断。');
      return;
    }
    const windowConfig = diagnosticMode === 'SANDBOX' ? pit.diagnostic_windows?.sandbox : pit.diagnostic_windows?.verified;
    api
      .runFactorDiagnostics(factor.id, {
        start_date: windowConfig?.start_date ?? subtractYears(pit.as_of_date, diagnosticMode === 'SANDBOX' ? 3 : 10),
        end_date: pit.as_of_date,
        dataset_snapshot_id: pit.dataset_snapshot_id,
        universe_snapshot_id: pit.universe_snapshot_id,
        return_window_days: 21,
        group_count: 5,
        diagnostic_mode: diagnosticMode,
      })
      .then((result) => setSummary(result.summary))
      .catch((err: Error) => setError(err.message || '诊断失败。'));
  };
  const turnover = summary?.turnover_decay;
  const compliance = summary?.compliance_trail;
  const diagnosticRunId = summary?.run_id ?? factor?.last_diagnostic_run_id;
  const datasetId = String(summary?.dataset_snapshot_id ?? pit?.dataset_snapshot_id ?? '待绑定');
  const universeId = String(summary?.universe_snapshot_id ?? pit?.universe_snapshot_id ?? '待绑定');
  const cleaningVersion = String(summary?.cleaning_version ?? recordString(compliance, 'cleaning_version') ?? '待生成');
  const diagnosedAt = String(recordString(compliance, 'diagnosed_at') ?? '待生成');
  const operator = String(recordString(compliance, 'operator') ?? 'research_admin');
  const annualTurnover = recordNumber(turnover, 'annual_turnover_pct');
  const impactCost = recordNumber(turnover, 'impact_cost_bps');
  const financingCost = recordNumber(turnover, 'financing_cost_bps');
  const slippageCost = recordNumber(turnover, 'slippage_bps');
  const riskFlags = summary?.risk_flags ?? [];
  const riskMessages = riskFlags.length ? [...riskFlags] : ['通过。表达式仅引用 PIT 数据列与历史窗口。'];
  if (riskMessages.length < 3 && (summary?.evidence_heatmap ?? []).some((cell) => stateClass(cell.state) === 'warn')) {
    riskMessages.push('漂移预警：部分稳定性窗口低于门槛，需要进入压力补测。');
  }
  if (riskMessages.length < 3) {
    riskMessages.push(`覆盖缺口：当前覆盖率 ${pct(summary?.coverage)}，报告保留样本边界。`);
  }
  if (riskMessages.length < 3) {
    riskMessages.push('成本敏感：换手、冲击、融资和滑点需要在正式交易前复核。');
  }
  const auditEntries = factor ? buildFactorAuditEntries(factor, summary, pit) : [];
  const currentFactorDescription = factor ? factorDescription(factor) : '';
  const reportHref = factor && summary?.run_id
    ? backendHref(`/factors/${factor.id}/diagnostics/${summary.run_id}/report`)
    : null;
  return (
    <div className="factor-page" data-page-root="factor-detail">
      <section className="factor-detail-hero">
        <div className="factor-detail-hero__copy">
          <p className="factor-page-hero__eyebrow">因子诊断</p>
          <h1>{factor?.name ? `${factor.name}诊断报告` : '因子诊断报告'}</h1>
          <p>报告绑定 PIT 数据版本与样本池版本，显示 IC、排序 IC、信息比率、覆盖率、分组收益和成本衰减。</p>
          {currentFactorDescription ? (
            <p className="factor-detail-description"><strong>因子描述</strong>{currentFactorDescription}</p>
          ) : null}
          {factor ? (
            <FactorDescriptionLine
              factor={factor}
              className="factor-detail-subtitle factor-detail-description"
            />
          ) : (
            <p className="factor-detail-subtitle factor-detail-description">
              <strong>因子描述</strong>
              <span>逻辑：正在读取因子定义。作用：加载完成后展示该因子的诊断用途与 PIT 数据约束。</span>
            </p>
          )}
          <div className="factor-detail-chips">
            {factor ? <StatusPill status={summary?.status ?? factor.diagnostic_status} /> : null}
            {diagnosticRunId ? <span className="factor-pill factor-pill--mono">诊断运行 {diagnosticRunId}</span> : null}
            <span className="factor-pill factor-pill--mono">{datasetId}</span>
            <span className="factor-pill factor-pill--mono">{universeId}</span>
          </div>
        </div>
        <div className="factor-detail-hero__actions">
          <button className="factor-detail-action-btn factor-detail-action-btn--primary" disabled={!canRun} onClick={runDiagnostic} type="button">
            {primaryActionLabel}
          </button>
          {reportHref ? (
            <a className="factor-detail-action-btn" href={reportHref} target="_blank" rel="noreferrer">生成投委会 PDF</a>
          ) : (
            <button className="factor-detail-action-btn" disabled type="button">生成投委会 PDF</button>
          )}
        </div>
      </section>
      {error ? <div className="factor-panel factor-panel--danger">{error}</div> : null}
      {pitError ? <div className="factor-panel factor-panel--danger">{pitError}</div> : null}
      {factor ? (
        <>
          {!summary ? (
            <section className="factor-panel factor-diagnostic-empty" aria-live="polite">
              <div className="factor-section-title">
                <div>
                  <span>尚未生成诊断报告</span>
                  <p>当前因子还没有 Rank IC、覆盖率、分组收益或成本衰减数据。点击诊断后会基于当前 PIT 窗口生成真实诊断结果。</p>
                </div>
              </div>
              <div className="factor-diagnostic-empty__actions">
                <span className="factor-pill factor-pill--mono">{diagnosticMode}</span>
                <span className="factor-muted">{canRun ? '可直接发起诊断' : '等待 PIT 数据门禁恢复后可诊断'}</span>
              </div>
            </section>
          ) : null}
          {summary ? (
            <>
          <section className="factor-card-grid factor-card-grid--metrics factor-detail-metrics">
            <article className="factor-mini-card factor-mini-card--accent"><span>排序 IC</span><strong>{num(summary?.rank_ic)}</strong><p>滚动窗口稳定性</p></article>
            <article className="factor-mini-card"><span>信息比率</span><strong>{num(summary?.ir, 2)}</strong><p>最近诊断运行</p></article>
            <article className="factor-mini-card factor-mini-card--warn"><span>预估年换手</span><strong>{annualTurnover === null ? '待生成' : pct(annualTurnover)}</strong><p>TRS 成本敏感</p></article>
            <article className="factor-mini-card"><span>覆盖率</span><strong>{pct(summary?.coverage)}</strong><p>可诊断样本</p></article>
          </section>
          <section className="factor-detail-layout">
            <div className="factor-detail-main">
              <article className="factor-panel factor-detail-panel">
                <div className="factor-section-title">
                  <div>
                    <span>十格证据热力图</span>
                    <p>10年 / 20年 / 30年稳定性与漂移风险同屏呈现，橙色格表示漂移预警，红色缺口进入极端场景补测。</p>
                  </div>
                  <span className="factor-pill factor-pill--warn">{(summary?.evidence_heatmap ?? []).filter((cell) => stateClass(cell.state) === 'warn').length} 格漂移</span>
                </div>
                <FactorEvidenceHeatmap summary={summary} />
              </article>

              <article className="factor-panel factor-detail-panel">
                <div className="factor-section-title">
                  <div>
                    <div className="factor-section-title__heading">
                      <span>换手率与衰减</span>
                      <HelpTooltip label="换手率与衰减计算口径" lines={TURNOVER_DECAY_TOOLTIP_LINES} />
                    </div>
                    <p>{factor.descriptor?.window ?? '当前窗口'} 因子必须说明信号有效期、换手压力和单笔交易摩擦成本，供 TRS 业务核算。</p>
                  </div>
                  <span className="factor-pill factor-pill--warn">成本敏感</span>
                </div>
                <div className="factor-detail-decay">
                  <div className="factor-detail-decay__card">
                    <span>信号半衰期</span>
                    <strong>{String(recordNumber(turnover, 'half_life_days') ?? '待生成')} 交易日</strong>
                    <small>{recordString(turnover, 'note') ?? '第 63 日后 IC 边际贡献明显下降'}</small>
                    <FactorDecayChart />
                  </div>
                  <div className="factor-detail-decay__card">
                    <span>TRS 成本拆解</span>
                    <div className="factor-detail-cost-bars">
                      {[
                        ['换手', annualTurnover, '%'],
                        ['冲击', impactCost, 'bp'],
                        ['融资', financingCost, 'bp'],
                        ['滑点', slippageCost, 'bp'],
                      ].map(([label, value, suffix]) => {
                        const numberValue = typeof value === 'number' ? value : null;
                        return (
                          <div key={String(label)}>
                            <span>{label}</span>
                            <i><b style={{ width: `${Math.max(10, Math.min(96, numberValue ?? 0)).toFixed(1)}%` }} /></i>
                            <em>{numberValue === null ? '待生成' : `${numberValue.toFixed(suffix === '%' ? 0 : 0)}${suffix}`}</em>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </article>

              <article className="factor-panel factor-detail-panel">
                <div className="factor-section-title">
                  <div>
                    <div className="factor-section-title__heading">
                      <span>分层收益与 IC 走势</span>
                      <HelpTooltip label="分层收益与 IC 走势计算口径" lines={GROUP_IC_TOOLTIP_LINES} />
                    </div>
                    <p>强因子组到弱因子组使用滑动平均口径检查单调性，极端分组的换手与覆盖率同时展示。</p>
                  </div>
                </div>
                <div className="factor-detail-split">
                  <div className="factor-detail-inner">
                    <h3>排序 IC 滚动窗口</h3>
                    <FactorDetailTrendChart summary={summary} />
                  </div>
                  <div className="factor-detail-inner">
                    <h3>分层回测</h3>
                    <FactorGroupReturns summary={summary} />
                  </div>
                </div>
              </article>
            </div>

            <aside className="factor-detail-rail">
              <article className="factor-panel factor-detail-panel">
                <div className="factor-section-title">
                  <div>
                    <span>极端场景回测</span>
                    <p>对红色缺口使用代理数据或合成数据补充压力逻辑，不把缺口直接当成通过。</p>
                  </div>
                </div>
                <FactorStressCards summary={summary} />
              </article>

              <article className="factor-panel factor-detail-panel">
                <div className="factor-section-title"><span>风险提示</span></div>
                <div className="factor-detail-risk-list">
                  {riskMessages.slice(0, 3).map((flag, index) => {
                    const title = ['未来函数风险', '覆盖缺口', '漂移预警'][index] ?? `风险提示 ${index + 1}`;
                    return (
                      <div className={index === 0 ? 'is-warning' : ''} key={`${flag}-${index}`}>
                        <strong>{title}</strong>
                        <span>{flag}</span>
                      </div>
                    );
                  })}
                </div>
              </article>

              <article className="factor-panel factor-detail-panel">
                <div className="factor-section-title"><span>审计足迹</span></div>
                <div className="factor-detail-audit-list" aria-label="审计足迹">
                  {auditEntries.map((entry) => (
                    <div key={entry.id}>
                      <strong>{entry.title}</strong>
                      <span>{entry.at ? formatDateTime(entry.at) : '待记录'}</span>
                      <p>{entry.detail}</p>
                    </div>
                  ))}
                </div>
                <p className="factor-detail-trail">
                  {factor.name} 因子使用 {factor.expression} 逻辑，绑定 {datasetId} 与 {universeId}，清洗规则 {cleaningVersion}，诊断时间 {diagnosedAt}，执行人 {operator}。
                </p>
                <div className="factor-detail-pdf">
                  <strong>投委会 PDF 附件</strong>
                  <span>自动带入诊断摘要、PIT 版本、极端场景和审计足迹。</span>
                  {reportHref ? (
                    <a className="factor-btn factor-btn--primary" href={reportHref} target="_blank" rel="noreferrer">生成标准 PDF</a>
                  ) : (
                    <button className="factor-btn factor-btn--primary" disabled type="button">生成标准 PDF</button>
                  )}
                </div>
              </article>
            </aside>
          </section>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function FactorEditorPage({ factorId: _factorId }: { factorId?: string }): JSX.Element {
  const api = useApiClient();
  const [name, setName] = useState('短周期价格动量');
  const [expression, setExpression] = useState('Rank(Delta(Close, 5))');
  const [description, setDescription] = useState('逻辑：描述该因子的经济含义。作用：描述该因子的策略用途。');
  const [category, setCategory] = useState('mom');
  const [metric, setMetric] = useState('short');
  const [windowValue, setWindowValue] = useState('5d');
  const [operator, setOperator] = useState('rank');
  const [preview, setPreview] = useState<ApiFactorDiagnosticPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const descriptorId = ['m', category, metric.trim(), windowValue.trim(), operator].filter(Boolean).join('_');
  const runPreview = () => {
    api
      .previewFactorDiagnostics({ expression, lookback_years: 5 })
      .then((payload) => {
        setPreview(payload);
        setError(null);
      })
      .catch((err: Error) => setError(err.message || '预览失败。'));
  };
  const saveFactor = () => {
    api
      .createFactor({
        name,
        market: 'US',
        universe: 'SP500',
        expression,
        description,
        frequency: 'DAILY',
        direction: operator === 'log' ? 'LOW_IS_BETTER' : 'HIGH_IS_BETTER',
        tags: ['人工'],
        descriptor: {
          source_prefix: 'm',
          category,
          metric: metric.trim(),
          window: windowValue.trim(),
          operator,
        },
      })
      .then((factor) => navigateTo(`/factors/${factor.id}`))
      .catch((err: Error) => setError(err.message || '保存失败。'));
  };
  const previewPoints = useMemo(
    () => (preview?.rank_ic_preview ?? []).map((point) => ({ value: point.rank_ic })),
    [preview],
  );
  return (
    <div className="factor-page" data-page-root="factor-editor">
      <PageHero
        eyebrow="DSL 生产力"
        title="因子编辑器"
        description="用类 Excel 公式编写人工因子，并在正式诊断前查看 5 年样本内 IC 预览。"
        actions={
          <>
            <button className="factor-btn" onClick={runPreview}>生成 IC 预览</button>
            <button className="factor-btn factor-btn--primary" onClick={saveFactor}>保存人工因子</button>
          </>
        }
      />
      <section className="factor-editor-grid">
        <article className="factor-panel">
          <div className="factor-section-title"><span>公式元信息</span><span className="factor-muted">白名单 DSL</span></div>
          <label className="factor-field">
            <span>因子名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="factor-descriptor-grid">
            <label className="factor-field">
              <span>来源</span>
              <input value="m 人工" readOnly />
            </label>
            <label className="factor-field">
              <span>类别</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {Object.entries(DESCRIPTOR_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{value} · {label}</option>
                ))}
              </select>
            </label>
            <label className="factor-field">
              <span>指标</span>
              <input value={metric} onChange={(event) => setMetric(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
            </label>
            <label className="factor-field">
              <span>窗口</span>
              <input value={windowValue} onChange={(event) => setWindowValue(event.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} />
            </label>
            <label className="factor-field">
              <span>算子</span>
              <select value={operator} onChange={(event) => setOperator(event.target.value)}>
                {Object.entries(DESCRIPTOR_OPERATOR_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{value} · {label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="factor-id-preview">
            <span>Canonical ID</span>
            <code>{descriptorId}</code>
          </div>
          <label className="factor-field">
            <span>公式</span>
            <textarea value={expression} onChange={(event) => setExpression(event.target.value)} />
          </label>
          <label className="factor-field">
            <span>因子描述</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="factor-formula-preview">
            <FormulaWithTooltips expression={expression} />
          </div>
          <div className="factor-chip-row">
            {['Rank', 'Delta', 'Ts_Rank', 'Correlation', 'Close', 'Open', 'Volume', 'ZScore', 'StdDev', 'Sum', 'Skew', 'Return'].map((item) => (
              <span data-tooltip={OPERATOR_EXPLANATIONS[item]} title={OPERATOR_EXPLANATIONS[item]} key={item}>{item}</span>
            ))}
          </div>
          {error ? <div className="factor-panel factor-panel--danger">{error}</div> : null}
        </article>
        <article className="factor-panel">
          <div className="factor-section-title"><span>5 年样本内 IC 预览</span></div>
          {preview ? (
            <>
              <Sparkline points={previewPoints} />
              <p className="factor-muted">{preview.message}</p>
            </>
          ) : (
            <div className="factor-empty">点击“生成 IC 预览”后显示最近 5 年样本内微图。</div>
          )}
          <div className="factor-section-title"><span>算子沙盒分布</span></div>
          <div className="factor-histogram" aria-label="因子值直方图">
            {[22, 36, 54, 78, 64, 42, 24].map((height, index) => <i key={index} style={{ height }} />)}
          </div>
        </article>
        <article className="factor-panel">
          <div className="factor-section-title"><span>引用库</span></div>
          <ul className="factor-event-list">
            <li><strong>12-1月截面动量排名</strong><span>s_mom_12m1m_rank · 可引用</span></li>
            <li><strong>252日年化波动率排名</strong><span>s_vol_252d_rank · 防守型</span></li>
            <li><strong>滚动市盈率倒数 (LTM)</strong><span>s_val_ep_ltm_raw · 基础面 PIT 可诊断</span></li>
          </ul>
        </article>
      </section>
    </div>
  );
}

export function FactorPlaceholderPage({ title }: { title: string }): JSX.Element {
  return (
    <div className="factor-page" data-page-root="factor-placeholder">
      <PageHero
        eyebrow="因子"
        title={title}
        description="该能力属于后续里程碑，本期仅保留导航位置与产品语义。"
        actions={<button className="factor-btn factor-btn--primary" onClick={() => navigateTo('/factors')}>返回因子库</button>}
      />
      <section className="factor-panel">
        <div className="factor-empty">本期交付重点是人工因子、PIT 门禁和诊断报告。</div>
      </section>
    </div>
  );
}
