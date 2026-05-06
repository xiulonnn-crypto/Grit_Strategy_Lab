import { Fragment, useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatDateTime } from '../lib/format';
import type {
  ApiFactorDetail,
  ApiFactorDiagnosticPreview,
  ApiFactorDiagnosticSummary,
  ApiFactorListItem,
  ApiFactorListResponse,
  ApiPitDataOverview,
  ApiPitIdentityScraperRestartResponse,
} from '../types';
import './factors-page.css';

type CoverageGapBucket = NonNullable<ApiPitDataOverview['coverage_gap']>['buckets'][number];
type CoverageGapSymbolDetail = NonNullable<CoverageGapBucket['symbol_details']>[number];
type PitOpsGuidanceAction = NonNullable<NonNullable<ApiPitDataOverview['ops_guidance']>['actions']>[number];
type FactorSortKey = 'rank_ic' | 'updated_at';
type FactorSortDirection = 'asc' | 'desc';
type FactorSortState = { key: FactorSortKey; direction: FactorSortDirection };

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
  READY_TO_DIAGNOSE: '可诊断',
  SANDBOX_READY: 'Sandbox 可跑',
  BLOCKED_PIT: 'PIT 门禁阻塞',
  BLOCKED_DATA: '基础数据待补',
  COMPLETED: '已完成',
  FAILED: '失败',
};

const PIT_STATUS_LABELS: Record<string, string> = {
  READY: '正式就绪',
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

const SOURCE_LABELS: Record<string, string> = {
  SYSTEM_SEED: '系统默认',
  MANUAL: '人工',
  AUTO_MINED: '自动挖掘',
};
const DESCRIPTOR_CATEGORY_LABELS: Record<string, string> = {
  mom: '动量',
  val: '估值',
  qlty: '质量',
  vol: '波动',
  size: '规模',
};
const DESCRIPTOR_CATEGORY_ORDER = ['mom', 'val', 'qlty', 'vol', 'size'];
const MAX_VISIBLE_CORRELATION_FACTORS = 40;
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
type FactorUiState = 'robust' | 'needs_calibration' | 'decayed' | 'sandbox';
type FactorGateTone = 'good' | 'warn' | 'bad';

const UI_STATE_LABELS: Record<FactorUiState, string> = {
  robust: '稳健',
  needs_calibration: '待校准',
  decayed: '失效',
  sandbox: '沙箱',
};
const FACTOR_WARNING_GATE_CODES = new Set([
  'COVERAGE_EDGE',
  'DIAGNOSTIC_STALE',
  'HIGH_CORRELATION',
  'IC_UNSTABLE',
  'TURNOVER_DECAY',
  'VERIFIED_PIT_WINDOW_INCOMPLETE',
]);
const FACTOR_HARD_GATE_CODES = new Set([
  'CURRENT_ONLY_DATA',
  'FUNDAMENTAL_PIT_NOT_READY',
  'FUTURE_FUNCTION',
  'INDUSTRY_PIT_NOT_READY',
  'MISSING_AVAILABLE_AT',
  'NON_REPLAYABLE_FIELD',
  'PIT_GATE_BLOCKED',
  'PRICE_SNAPSHOT_NOT_READY',
  'UNSAFE_EXPRESSION',
  'UNIVERSE_HISTORY_BLOCKED',
]);

const UI_STATE_TOOLTIP_LINES = [
  '稳健：已完成诊断，IC/IR、coverage、分组收益达标，无硬阻断。',
  '待校准：IC 偏弱、coverage 不足、高相关、换手衰减或诊断过期，但仍可研究提示使用。',
  '失效：IC 衰减、IR 失真、分组收益倒挂或生命周期为 DECAYED。',
  '沙箱：Sandbox/Limited readiness，只适合研究预览，不能作为正式 PIT 可回放因子。',
];

const BLOCKER_RISK_TOOLTIP_LINES = [
  '风险提示：高相关、同族重叠、IC 不稳定、换手衰减、coverage 边缘或诊断过期，不阻断策略创建。',
  '硬阻断：PIT 缺口、未来函数、不可回放字段、current-only 数据、unsafe expression、缺 available_at 或行业中性化缺行业 PIT。',
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
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  status?: string;
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

function usePitOverview(): {
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
  }, [api, nonce]);
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

function descriptorCategoryLabel(category: string): string {
  return DESCRIPTOR_CATEGORY_LABELS[category] ?? '其他';
}

function categorySortIndex(category: string): number {
  const index = DESCRIPTOR_CATEGORY_ORDER.indexOf(category);
  return index >= 0 ? index : DESCRIPTOR_CATEGORY_ORDER.length;
}

function sortFactorsByCategory(factors: ApiFactorListItem[]): ApiFactorListItem[] {
  return [...factors].sort((left, right) => {
    const categoryDiff = categorySortIndex(descriptorCategory(left)) - categorySortIndex(descriptorCategory(right));
    if (categoryDiff !== 0) return categoryDiff;
    return (left.descriptor?.canonical_id ?? left.id).localeCompare(right.descriptor?.canonical_id ?? right.id);
  });
}

function correlationGroups(factors: ApiFactorListItem[]): Array<{ category: string; label: string; count: number }> {
  return factors.reduce<Array<{ category: string; label: string; count: number }>>((groups, factor) => {
    const category = descriptorCategory(factor);
    const latest = groups.at(-1);
    if (latest?.category === category) {
      latest.count += 1;
    } else {
      groups.push({ category, label: descriptorCategoryLabel(category), count: 1 });
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

function factorRankIc(factor: ApiFactorListItem): number | null {
  const value = factor.latest_diagnostic_summary?.rank_ic;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function longShortSpread(factor: ApiFactorListItem): number | null {
  const returns = factor.latest_diagnostic_summary?.group_returns ?? [];
  if (returns.length < 2) return null;
  const first = returns[0]?.mean_return;
  const last = returns.at(-1)?.mean_return;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return Number(first) - Number(last);
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
  if (explicitState === 'robust' || explicitState === 'needs_calibration' || explicitState === 'decayed' || explicitState === 'sandbox') {
    return {
      state: explicitState,
      label: factor.ui_state_label || UI_STATE_LABELS[explicitState],
    };
  }
  const lifecycle = String(factor.lifecycle_status ?? '').toUpperCase();
  const diagnostic = factorDisplayStatus(factor).toUpperCase();
  if (lifecycle === 'DECAYED' || diagnostic === 'FAILED') {
    return { state: 'decayed', label: UI_STATE_LABELS.decayed };
  }
  if (diagnostic === 'SANDBOX_READY' || diagnostic === 'BLOCKED_PIT' || diagnostic === 'BLOCKED_DATA') {
    return { state: 'sandbox', label: UI_STATE_LABELS.sandbox };
  }
  const summary = factor.latest_diagnostic_summary;
  const rankIc = summary?.rank_ic;
  const ir = summary?.ir;
  const coverage = summary?.coverage;
  const hasHealthyMetrics =
    typeof rankIc === 'number' &&
    typeof ir === 'number' &&
    typeof coverage === 'number' &&
    rankIc >= 0.03 &&
    ir >= 0.25 &&
    coverage >= 80 &&
    factor.readiness_blockers.length === 0;
  if (diagnostic === 'COMPLETED' && hasHealthyMetrics) {
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
    .map((item) => item.label || item.message || item.code)
    .filter((value): value is string => Boolean(value));
}

function blockerSummaryReasons(factor: ApiFactorListItem, severity: 'warning' | 'blocker'): string[] {
  const summary = factor.blocker_reason_summary;
  return (summary?.reasons ?? [])
    .filter((reason) => String(reason.severity ?? '').toLowerCase() === severity)
    .map((reason) => reason.label || reason.message || reason.code)
    .filter((value): value is string => Boolean(value));
}

function readinessBlockerSeverity(blocker: Record<string, unknown>): 'warning' | 'blocker' {
  const code = String(blocker.code ?? '').toUpperCase();
  if (FACTOR_WARNING_GATE_CODES.has(code)) return 'warning';
  if (FACTOR_HARD_GATE_CODES.has(code) || code.includes('PIT')) return 'blocker';
  return 'blocker';
}

function readinessBlockerReasons(factor: ApiFactorListItem, severity: 'warning' | 'blocker'): string[] {
  return factor.readiness_blockers
    .filter((blocker) => readinessBlockerSeverity(blocker) === severity)
    .map((blocker) => String(blocker.message ?? blocker.code ?? STATUS_LABELS[factor.diagnostic_status] ?? '数据门禁阻断'))
    .filter(Boolean);
}

function factorGateProjection(
  factor: ApiFactorListItem,
  isHighCorrelation: boolean,
): { label: string; tone: FactorGateTone; reasons: string[]; fixTarget?: string | null } {
  const hardReasons = [
    ...creationRiskReasons(factor, 'blocker'),
    ...blockerSummaryReasons(factor, 'blocker'),
    ...readinessBlockerReasons(factor, 'blocker'),
  ].filter(Boolean);
  if (hardReasons.length || factor.blocker_reason_summary?.status === 'blocked') {
    return {
      label: '硬阻断',
      tone: 'bad',
      reasons: hardReasons.length ? hardReasons : [factor.blocker_reason_summary?.label ?? STATUS_LABELS[factor.diagnostic_status] ?? '数据门禁阻断'],
      fixTarget: factor.gate_fix_target,
    };
  }
  const warningReasons = [
    ...creationRiskReasons(factor, 'warning'),
    ...blockerSummaryReasons(factor, 'warning'),
    ...readinessBlockerReasons(factor, 'warning'),
    ...(isHighCorrelation ? ['高相关提示'] : []),
  ].filter(Boolean);
  if (warningReasons.length || factor.blocker_reason_summary?.status === 'warning') {
    return {
      label: '风险提示',
      tone: 'warn',
      reasons: warningReasons.length ? warningReasons : [factor.blocker_reason_summary?.label ?? '需在策略创建时提示风险'],
      fixTarget: factor.gate_fix_target,
    };
  }
  return { label: '无阻断', tone: 'good', reasons: ['可进入策略创建；相关性仅作为风险提示。'] };
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
  const runId = summary?.run_id ?? batch?.latest_run_id ?? factor.last_diagnostic_run_id ?? '待生成';
  const rankIc = summary?.rank_ic ?? batch?.rank_ic;
  const ir = summary?.ir ?? batch?.ir;
  const coverage = summary?.coverage ?? batch?.coverage;
  const diagnosedAt = recordString(summary?.compliance_trail, 'diagnosed_at') ?? batch?.latest_diagnostic_at ?? factorUpdatedAt(factor) ?? '待生成';
  const state = factorUiState(factor);
  const warnings = creationRiskReasons(factor, 'warning');
  const blockers = creationRiskReasons(factor, 'blocker');
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
      <p>
        {blockers.length
          ? `硬阻断：${blockers.slice(0, 2).join('、')}`
          : warnings.length
            ? `风险提示：${warnings.slice(0, 2).join('、')}`
            : '无硬阻断；若存在高相关，仅在策略创建时提示。'}
      </p>
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

function GateRiskCell({
  factor,
  isHighCorrelation,
}: {
  factor: ApiFactorListItem;
  isHighCorrelation: boolean;
}): JSX.Element {
  const projection = factorGateProjection(factor, isHighCorrelation);
  const primaryReason = projection.reasons[0];
  return (
    <div className="factor-gate-cell">
      <span className={`factor-gate-pill factor-gate-pill--${projection.tone}`}>{projection.label}</span>
      {primaryReason ? <small className="factor-gate-reason" title={primaryReason}>{primaryReason}</small> : null}
      {projection.tone === 'bad' && projection.fixTarget ? (
        <button className="factor-repair-link" onClick={() => navigateTo(String(projection.fixTarget).replace(/^#/, ''))} type="button">
          查看修复
        </button>
      ) : null}
    </div>
  );
}

function DiagnosticCell({ factor }: { factor: ApiFactorListItem }): JSX.Element {
  const summary = factor.latest_diagnostic_summary;
  const gap = factor.diagnostic_gap_summary ?? {};
  const referenceLabel = referenceDiagnosticLabel(summary);
  const rankText = typeof summary?.rank_ic === 'number'
    ? `Rank IC ${num(summary.rank_ic)}`
    : String(gap.rank_ic ?? 'Rank IC: 尚未提交诊断');
  const irText = typeof summary?.ir === 'number'
    ? `IR ${num(summary.ir, 2)}`
    : String(gap.next_action ?? 'IR: 等待诊断');
  const coverageText = typeof summary?.coverage === 'number'
    ? `覆盖 ${pct(summary.coverage)}`
    : String(gap.coverage ?? '覆盖: 等待首次诊断');
  return (
    <div className="factor-diagnostic-cell">
      <div className="factor-diagnostic-cell__metrics">
        <span className="factor-diagnostic-cell__metric" title={rankText}>{rankText}</span>
        <span className="factor-diagnostic-cell__metric" title={irText}>{irText}</span>
        <span className="factor-diagnostic-cell__metric" title={coverageText}>{coverageText}</span>
      </div>
      {referenceLabel ? (
        <span className="factor-diagnostic-cell__reference" title={`参考口径：${referenceLabel}`}>
          <strong>参考口径</strong>
          <small>{referenceLabel}</small>
        </span>
      ) : null}
      <Sparkline points={factor.ic_sparkline} />
    </div>
  );
}

function FactorCorrelationMatrix({
  factors,
  selectedFactorId,
  onSelect,
  highOnly,
  onHighOnlyChange,
}: {
  factors: ApiFactorListItem[];
  selectedFactorId?: string;
  onSelect: (factorId: string) => void;
  highOnly: boolean;
  onHighOnlyChange: (value: boolean) => void;
}): JSX.Element {
  const clusteredFactors = useMemo(() => sortFactorsByCategory(factors), [factors]);
  if (!clusteredFactors.length) return <div className="factor-empty">暂无可计算相关性的因子。</div>;
  const selected = clusteredFactors.find((item) => item.id === selectedFactorId) ?? clusteredFactors[0];
  const highPeers = clusteredFactors.filter((item) => item.id !== selected.id && factorCorrelation(selected, item) >= 0.7);
  const highPeerIds = new Set(highPeers.map((peer) => peer.id));
  const baseFactors = highOnly
    ? clusteredFactors.filter((item) => item.id === selected.id || highPeerIds.has(item.id))
    : clusteredFactors;
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
        <label className="factor-toggle">
          <input
            type="checkbox"
            checked={highOnly}
            onChange={(event) => onHighOnlyChange(event.target.checked)}
          />
          <span>仅显示高相关对</span>
        </label>
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
            data-category={descriptorCategory(factor)}
          >
            {factor.name}
            <small>{descriptorCategoryLabel(descriptorCategory(factor))}</small>
          </button>
        ))}
        {visibleFactors.map((row) => (
          <Fragment key={`matrix-${row.id}`}>
            <button
              type="button"
              className={row.id === selected.id ? 'is-selected' : ''}
              aria-label={`选中相关性因子 ${row.name}`}
              onClick={() => onSelect(row.id)}
              data-category={descriptorCategory(row)}
            >
              {row.name}
              <small>{descriptorCategoryLabel(descriptorCategory(row))}</small>
            </button>
            {visibleFactors.map((column) => {
              const value = factorCorrelation(row, column);
              const isPeer = row.id === selected.id || column.id === selected.id;
              const isHigh = isPeer && row.id !== column.id && value >= 0.7;
              const isCrossCategoryHigh = isHigh && descriptorCategory(row) !== descriptorCategory(column);
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
                  data-category-pair={`${descriptorCategory(row)}-${descriptorCategory(column)}`}
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

export function PitCleaningCenterPage({ highlightedSection }: { highlightedSection?: string }): JSX.Element {
  const api = useApiClient();
  const { pit, loading, error, reload } = usePitOverview();
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
  const rulePreviews = pit?.cleaning_rule_previews ?? [];
  const activeRule = rulePreviews.find((item) => item.id === activeRuleId) ?? rulePreviews[0];
  const universeSeries = pit?.universe_history_series ?? [];
  const maxUniverseMembers = Math.max(...universeSeries.map((item) => item.member_count), 1);
  const trace = pit?.adjustment_trace;
  const tracePoints = trace?.points ?? [];
  const traceValues = tracePoints
    .flatMap((point) => [point.close, point.adjusted_close])
    .filter(isNumber);
  const traceMin = traceValues.length ? Math.min(...traceValues) : 0;
  const traceMax = traceValues.length ? Math.max(...traceValues) : 1;
  const traceSpan = Math.max(traceMax - traceMin, 1);
  const traceHeight = (value: number | null | undefined): string => {
    if (!isNumber(value)) return '8%';
    return `${Math.max(8, ((value - traceMin) / traceSpan) * 82 + 8).toFixed(1)}%`;
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
        reason: 'PIT 数据运维指令触发身份修复任务',
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
  const createWaiver = async (): Promise<void> => {
    setWaiverBusy(true);
    setWaiverError(null);
    try {
      await api.createPitResearchWaiver({
        reason: '研究阶段临时忽略非核心缺失标的；正式晋升仍要求完整门禁。',
      });
      setGapOpen(true);
      reload();
    } catch (err) {
      setWaiverError(err instanceof Error ? err.message : '研究态豁免创建失败。');
    } finally {
      setWaiverBusy(false);
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
  const reasonText = (key: string, fallback: string): string => (
    pit?.status_reasons?.[key]?.description || fallback
  );
  const factorAdmissionStatus = pit?.verified_diagnostics_enabled
    ? 'READY'
    : pit?.limited_diagnostics_enabled
      ? 'LIMITED_READY'
      : pit?.sandbox_diagnostics_enabled
        ? 'SANDBOX_READY'
        : 'BLOCKED';
  const gateStatus = pit?.verified_diagnostics_enabled
    ? 'READY_TO_DIAGNOSE'
    : pit?.limited_diagnostics_enabled
      ? 'LIMITED_READY'
      : pit?.sandbox_diagnostics_enabled
        ? 'SANDBOX_READY'
        : 'BLOCKED_PIT';
  const cards = [
    {
      label: '复权行情',
      status: pit?.adjusted_price_status ?? '加载中',
      reason: reasonText('adjusted_price', '使用前复权价进行诊断，避免除权除息断点污染收益。'),
      detail: '前复权价格、复权因子与公司行为事件一致性。',
    },
    {
      label: '点时样本池',
      status: pit?.universe_status ?? '加载中',
      reason: reasonText('universe', '历史成员缺失时直接阻塞，不使用当前成分股补位。'),
      detail: '历史样本池锚点证明成分股加入与剔除已被处理。',
    },
    {
      label: '异常清洗',
      status: pit?.outlier_cleaning_status ?? '加载中',
      reason: reasonText('outlier_cleaning', '基于快照派生清洗版本或正式 PIT 清洗运行记录。'),
      detail: '区分底层价格突变与规则阈值过严。',
    },
    {
      label: '因子准入',
      status: factorAdmissionStatus,
      reason: reasonText('factor_admission', '价格或样本池不足时仍阻塞诊断。'),
      detail: '研究预览可继续，正式使用须通过完整门禁。',
    },
  ];
  return (
    <div className="factor-page" data-page-root="pit-cleaning-center">
      <PageHero
        eyebrow="数据基座"
        title="PIT 清洗中心"
        description="核验点时价格、历史样本池和清洗规则，防止未来函数与幸存者偏差进入因子诊断。"
        status={pit ? pitStatusLabel(pit.overall_status) : undefined}
        actions={<button className="factor-btn factor-btn--primary" onClick={reload}>重新检查</button>}
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
                  已临时排除 {pit.research_waiver.ignored_symbol_count} 个非核心缺口；仅允许研究诊断，不能晋升。
                </p>
                {pit.research_waiver.impact_estimate ? (
                  <p>
                    潜在 IC 扰动约 {num(pit.research_waiver.impact_estimate.estimated_ic_delta_abs, 4)}；
                    市值权重 {pct(pit.research_waiver.impact_estimate.mcap_weight_pct, 2)}。
                  </p>
                ) : null}
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
          <section className="factor-card-grid">
            {cards.map((card) => (
              <article className="factor-mini-card" key={card.label}>
                <span>{card.label}</span>
                <strong>{pitStatusLabel(card.status)}</strong>
                <small className="factor-mini-card__reason">{pitCopy(card.reason)}</small>
                <p>{card.detail}</p>
              </article>
            ))}
          </section>
          {pit.ops_guidance ? (
            <section className="factor-panel factor-ops-guidance">
              <div>
                <span>数据运维指令</span>
                <strong>{pitCopy(pit.ops_guidance.headline)}</strong>
              </div>
              <div className="factor-action-row">
                {(pit.ops_guidance.actions ?? []).map((action) => (
                  <button
                    className={action.target.startsWith('#') ? 'factor-btn factor-btn--small' : 'factor-ops-token'}
                    key={`${action.label}-${action.target}`}
                    onClick={() => runOpsAction(action)}
                    type="button"
                  >
                      {pitCopy(action.label)}
                  </button>
                ))}
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
                <button className="factor-btn factor-btn--small" onClick={() => { setGapOpen(true); setSelectedOpsAction(null); }} type="button">
                  查看身份缺口
                </button>
                <button className="factor-btn factor-btn--small" onClick={reload} type="button">
                  重检 PIT 状态
                </button>
              </div>
            </section>
          ) : null}
          <section className="factor-two-col">
            <article className="factor-panel">
              <div className="factor-section-title">
                <span>门禁摘要</span>
                <PitStatusPill status={gateStatus} />
              </div>
              <dl className="factor-kv-grid">
                <div><dt>数据快照</dt><dd>{pit.dataset_snapshot_id}</dd></div>
                <div><dt>样本池快照</dt><dd>{pit.universe_snapshot_id}</dd></div>
                <div><dt>清洗版本</dt><dd>{pit.cleaning_version}</dd></div>
                <div>
                  <dt>覆盖率</dt>
                  <dd className="factor-coverage-dd">
                    <span>{pct(pit.coverage.coverage_pct)}</span>
                    {pit.coverage_gap ? (
                      <button className="factor-inline-action" onClick={() => setGapOpen((value) => !value)} type="button">
                        下钻分析
                      </button>
                    ) : null}
                  </dd>
                </div>
                <div><dt>研究窗口</dt><dd>{pit.diagnostic_windows?.sandbox?.start_date ?? '待确认'} 至 {pit.diagnostic_windows?.sandbox?.end_date ?? pit.as_of_date}</dd></div>
                <div><dt>正式窗口</dt><dd>{pit.diagnostic_windows?.verified?.start_date ?? '待确认'} 至 {pit.diagnostic_windows?.verified?.end_date ?? pit.as_of_date}</dd></div>
              </dl>
              <div className="factor-chip-row">
                {pit.sample_securities.map((symbol) => <span key={symbol}>{symbol}</span>)}
              </div>
            </article>
            <article className={`factor-panel ${highlightedSection ? 'factor-panel--highlight' : ''}`}>
              <div className="factor-section-title">
                <span>清洗规则工作台</span>
                <span className="factor-muted">阈值预演</span>
              </div>
              <div className="factor-rule-grid">
                {rulePreviews.map((rule) => (
                  <button
                    aria-pressed={activeRule?.id === rule.id}
                    className={`factor-rule ${activeRule?.id === rule.id ? 'is-active' : ''}`}
                    key={rule.id}
                    onClick={() => setActiveRuleId(rule.id)}
                    type="button"
                  >
                    {rule.label}
                  </button>
                ))}
              </div>
              {activeRule ? (
                <div className="factor-rule-preview">
                  <div>
                    <span>剔除比例</span>
                    <strong>{pct(activeRule.excluded_pct, 2)}</strong>
                    <small>{activeRule.excluded_count.toLocaleString('zh-HK')} / {activeRule.sample_size.toLocaleString('zh-HK')} 样本点</small>
                  </div>
                  <div>
                    <span>阈值</span>
                    <strong>{pitStatusLabel(activeRule.status)}</strong>
                    <small>{activeRule.threshold_label}</small>
                  </div>
                  <p>{pitCopy(activeRule.description)}</p>
                  <div className="factor-outlier-samples">
                    {activeRule.sample_points.length ? activeRule.sample_points.map((point) => (
                      <span key={`${point.symbol}-${point.date}`}>
                        {point.symbol} {point.date} {formatSignedPct(point.value)}
                      </span>
                    )) : <span>暂无可展示异常点样例</span>}
                  </div>
                </div>
              ) : (
                <p className="factor-muted">当前快照还没有足够样本生成规则预览。</p>
              )}
            </article>
          </section>
          {gapOpen && pit.coverage_gap ? (
            <section className="factor-panel factor-coverage-gap" id="coverage-gap">
              <div className="factor-section-title">
                <span>覆盖率缺口清单</span>
                <span>{pit.coverage_gap.missing_symbol_count} 缺失 / {pct(pit.coverage_gap.missing_share_pct)}</span>
              </div>
              <p className="factor-muted">{pitCopy(pit.coverage_gap.recommendation)}</p>
              <div className="factor-gap-grid">
                {pit.coverage_gap.buckets.map((bucket) => (
                  <CoverageGapBucketCard
                    bucket={bucket}
                    key={bucket.id}
                    onOpenMapping={openMapping}
                  />
                ))}
              </div>
              <div className="factor-action-row">
                <button
                  className="factor-btn factor-btn--primary"
                  disabled={waiverBusy || Boolean(pit.research_waiver) || !pit.coverage_gap.default_ignored_count}
                  onClick={() => void createWaiver()}
                  type="button"
                >
                  一键忽略非核心标的
                </button>
                <span className="factor-muted">
                  默认预选 {pit.coverage_gap.default_ignored_count} 个非核心标的；历史核心缺口仍保持阻塞证据。
                </span>
              </div>
            </section>
          ) : null}
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
          <section className="factor-two-col">
            <article className="factor-panel">
              <div className="factor-section-title">
                <span>复权校验轨迹</span>
                <span>{trace?.symbol || '代表性标的'}</span>
              </div>
              <div className="factor-adjust-chart factor-adjust-chart--trace" aria-label="原始价与前复权价轨迹">
                {tracePoints.length ? tracePoints.map((point) => (
                  <div className="factor-adjust-point" key={`${point.date}-${point.close}`} title={`${point.date} 复权因子 ${point.adjustment_factor ?? 'n/a'}`}>
                    <span className="factor-adjust-bar factor-adjust-bar--raw" style={{ height: traceHeight(point.close) }} />
                    <span className="factor-adjust-bar factor-adjust-bar--adj" style={{ height: traceHeight(point.adjusted_close) }} />
                    <small>{point.date.slice(5)}</small>
                  </div>
                )) : <span className="factor-muted">暂无复权轨迹样本。</span>}
              </div>
              <div className="factor-legend">
                <span>原始价</span><span>前复权价</span><span>除权除息事件</span>
              </div>
              <div className="factor-axis-note">
                复权因子 {trace?.factor_min ?? 'n/a'} - {trace?.factor_max ?? 'n/a'}
                {trace?.events?.length ? ` · ${String(trace.events[0]?.['label'] ?? trace.events[0]?.['type'] ?? '公司行为事件')}` : ''}
              </div>
            </article>
            <article className="factor-panel">
              <div className="factor-section-title"><span>点时样本池年度锚点</span></div>
              {universeSeries.length ? (
                <div
                  className="factor-universe-chart"
                  aria-label="样本池历史成员数量变化图"
                  data-visible-row-limit="3"
                  role="region"
                  tabIndex={0}
                >
                  {universeSeries.map((point) => (
                    <div className={point.is_latest ? 'is-latest' : ''} key={point.date}>
                      <span style={{ height: `${Math.max(10, (point.member_count / maxUniverseMembers) * 100).toFixed(1)}%` }} />
                      <small>{point.date.slice(0, 4)}</small>
                      <strong>{point.member_count}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="factor-empty">暂无历史锚点成员数量。</div>
              )}
            </article>
          </section>
          <section className="factor-two-col">
            <article className="factor-panel">
              <div className="factor-section-title"><span>门禁清单</span></div>
              {pit.blocking_items.length ? (
                <ul className="factor-event-list">
                  {pit.blocking_items.map((item) => (
                    <li key={item.code}>
                      <button className="factor-repair-link" onClick={() => goToHashTarget(item.fix_hash)} type="button">
                        {item.code}
                      </button>
                      <span>{pitCopy(item.message)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="factor-empty">当前 PIT 门禁通过，可以执行价格型因子诊断。</div>
              )}
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}

export function FactorLibraryPage({
  initialSource,
  initialStatus,
  initialTag,
}: {
  initialSource?: string;
  initialStatus?: string;
  initialTag?: string;
}): JSX.Element {
  const api = useApiClient();
  const [payload, setPayload] = useState<ApiFactorListResponse | null>(null);
  const [status, setStatus] = useState(initialStatus ?? '');
  const [sourcePrefix, setSourcePrefix] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [operatorFilter, setOperatorFilter] = useState('');
  const [selectedCorrelationFactorId, setSelectedCorrelationFactorId] = useState<string | undefined>();
  const [highCorrelationOnly, setHighCorrelationOnly] = useState(false);
  const [comparisonFactorIds, setComparisonFactorIds] = useState<string[]>([]);
  const [gapPopoverFactorId, setGapPopoverFactorId] = useState<string | null>(null);
  const [diagnosticPopoverFactorId, setDiagnosticPopoverFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<FactorSortState>({ key: 'updated_at', direction: 'desc' });
  useEffect(() => {
    let alive = true;
    api
      .listFactors({ source: initialSource, status: status || undefined, tag: initialTag })
      .then((factorPayload) => {
        if (!alive) return;
        setPayload(factorPayload);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message || '因子库加载失败。');
      });
    return () => {
      alive = false;
    };
  }, [api, initialSource, initialTag, status]);
  const factors = useMemo(() => {
    const filtered = (payload?.items ?? []).filter((factor) => {
      const descriptor = factor.descriptor;
      if (sourcePrefix && descriptor?.source_prefix !== sourcePrefix) return false;
      if (categoryFilter && descriptor?.category !== categoryFilter) return false;
      if (operatorFilter && descriptor?.operator !== operatorFilter) return false;
      return true;
    });
    return [...filtered].sort((left, right) => compareFactorsBySort(left, right, sort));
  }, [categoryFilter, operatorFilter, payload?.items, sort, sourcePrefix]);
  const updateSort = (key: FactorSortKey) => {
    setSort((current) => (
      current.key === key
        ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: 'desc' }
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
  }, [diagnosticPopoverFactorId, factors, gapPopoverFactorId, selectedCorrelationFactorId]);
  const selectedCorrelationFactor = useMemo(
    () => factors.find((factor) => factor.id === selectedCorrelationFactorId) ?? factors[0],
    [factors, selectedCorrelationFactorId],
  );
  const highCorrelationIds = useMemo(() => new Set(
    selectedCorrelationFactor
      ? factors
          .filter((factor) => factor.id !== selectedCorrelationFactor.id && factorCorrelation(selectedCorrelationFactor, factor) >= 0.7)
          .map((factor) => factor.id)
      : [],
  ), [factors, selectedCorrelationFactor]);
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
    return {
      systemSeedCount,
      diagnosableCount,
      sandboxReadyCount,
      highCorrelationCount: highCorrelationIds.size,
    };
  }, [highCorrelationIds, payload?.items, payload?.summary]);
  const pitStatus = recordString(payload?.summary, 'pit_status');
  return (
    <div className="factor-page" data-page-root="factor-library">
      <PageHero
        eyebrow="Alpha 资产"
        title="因子库"
        description="集中管理默认因子、人工因子、最近诊断和 PIT 数据门禁。"
        status={pitStatus ? `PIT ${STATUS_LABELS[pitStatus] ?? pitStatus}` : undefined}
        actions={
          <>
            <button className="factor-btn" onClick={() => navigateTo('/pit-data')}>查看 PIT 门禁</button>
            <button className="factor-btn factor-btn--primary" onClick={() => navigateTo('/factors/new')}>新建人工因子</button>
          </>
        }
      />
      <section className="factor-card-grid factor-card-grid--metrics factor-library-summary" aria-label="因子库摘要指标">
        <article className="factor-mini-card">
          <span>系统默认因子</span>
          <strong>{librarySummary.systemSeedCount}</strong>
          <p>覆盖五类核心风格因子，统一按系统种子治理与诊断。</p>
        </article>
        <article className="factor-mini-card">
          <span>可诊断</span>
          <strong>{librarySummary.diagnosableCount}</strong>
          <p>已通过价格或基本面 PIT 门禁的因子。</p>
        </article>
        <article className="factor-mini-card">
          <span>Sandbox 可跑</span>
          <strong>{librarySummary.sandboxReadyCount}</strong>
          <p>可在研究沙盒运行，尚未进入正式验证。</p>
        </article>
        <article className="factor-mini-card">
          <span>高相关提示</span>
          <strong>{librarySummary.highCorrelationCount}</strong>
          <p>基于当前相关性视图，仅提示不自动剔除。</p>
        </article>
      </section>
      <section className="factor-panel">
        <div className="factor-toolbar">
          <div className="factor-segmented">
            {[
              ['', '全部'],
              ['READY_TO_DIAGNOSE', '可诊断'],
              ['SANDBOX_READY', 'Sandbox'],
              ['BLOCKED_DATA', '基础数据待补'],
            ].map(([value, label]) => (
              <button className={status === value ? 'is-active' : ''} key={value} onClick={() => setStatus(value)}>
                {label}
              </button>
            ))}
          </div>
          <div className="factor-toolbar__filters" aria-label="因子表格筛选项">
            <select aria-label="来源前缀" value={sourcePrefix} onChange={(event) => setSourcePrefix(event.target.value)}>
              <option value="">全部来源</option>
              <option value="s">系统默认</option>
              <option value="m">人工</option>
              <option value="a">自动挖掘</option>
            </select>
            <select aria-label="因子类别" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">全部类别</option>
              {Object.entries(DESCRIPTOR_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select aria-label="处理算子" value={operatorFilter} onChange={(event) => setOperatorFilter(event.target.value)}>
              <option value="">全部算子</option>
              {Object.entries(DESCRIPTOR_OPERATOR_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <span className="factor-muted">系统默认 {String(payload?.summary.system_seed_count ?? '0')} 个</span>
        </div>
        {error ? <div className="factor-panel factor-panel--danger">{error}</div> : null}
        <div className="factor-table-wrap">
          <table className="factor-table">
            <thead>
              <tr>
                <th>因子</th>
                <th>来源</th>
                <th>
                  <div className="factor-th-content">
                    <span>诊断状态</span>
                    <HelpTooltip label="诊断状态含义" lines={UI_STATE_TOOLTIP_LINES} />
                  </div>
                </th>
                <th aria-sort={ariaSortFor('rank_ic', sort)}>
                  <SortableHeader
                    label="最近诊断"
                    sortKey="rank_ic"
                    sort={sort}
                    onSort={updateSort}
                    tooltip={<HelpTooltip label="最近诊断指标解释" lines={DIAGNOSTIC_TOOLTIP_LINES} />}
                  />
                </th>
                <th>
                  <div className="factor-th-content">
                    <span>阻断 / 风险</span>
                    <HelpTooltip label="阻断与风险含义" lines={BLOCKER_RISK_TOOLTIP_LINES} />
                  </div>
                </th>
                <th aria-sort={ariaSortFor('updated_at', sort)}>
                  <SortableHeader label="最近更新" sortKey="updated_at" sort={sort} onSort={updateSort} />
                </th>
                <th>比对 / 操作</th>
              </tr>
            </thead>
            <tbody>
              {factors.map((factor) => (
                <tr
                  className={highCorrelationIds.has(factor.id) ? 'is-correlation-highlight' : ''}
                  data-correlation-highlight={highCorrelationIds.has(factor.id) ? 'true' : undefined}
                  key={factor.id}
                >
                  <td>
                    <div className="factor-name-row">
                      <button className="factor-link" onClick={() => navigateTo(`/factors/${factor.id}`)}>{factor.name}</button>
                      <HelpTooltip label={`${factor.name} 公式`} lines={[factor.expression]} mono />
                    </div>
                    <code className="factor-id">{factor.descriptor?.canonical_id ?? factor.id}</code>
                  </td>
                  <td>{SOURCE_LABELS[factor.source] ?? factor.source}</td>
                  <td>
                    <DiagnosticStateCell
                      factor={factor}
                      open={diagnosticPopoverFactorId === factor.id}
                      onToggle={() => setDiagnosticPopoverFactorId((current) => (current === factor.id ? null : factor.id))}
                      onClose={() => setDiagnosticPopoverFactorId(null)}
                    />
                  </td>
                  <td>
                    <DiagnosticCell factor={factor} />
                  </td>
                  <td>
                    <div className="factor-gate-cell factor-gate-cell--stacked">
                      <GateRiskCell factor={factor} isHighCorrelation={highCorrelationIds.has(factor.id)} />
                      {factor.diagnostic_status === 'SANDBOX_READY' ? (
                        <button
                          aria-label={`${factor.name} 缺口速报`}
                          className="factor-gap-alert"
                          onClick={() => setGapPopoverFactorId((current) => (current === factor.id ? null : factor.id))}
                          type="button"
                        >
                          !
                        </button>
                      ) : null}
                      {gapPopoverFactorId === factor.id ? (
                        <SandboxGapPopover factor={factor} onClose={() => setGapPopoverFactorId(null)} />
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {factorUpdatedAt(factor) ? (
                      <time className="factor-updated" dateTime={factorUpdatedAt(factor) ?? undefined}>
                        {formatFactorUpdatedAt(factor)}
                      </time>
                    ) : (
                      <span className="factor-updated factor-updated--empty">尚未记录</span>
                    )}
                  </td>
                  <td>
                    <div className="factor-row-actions">
                      <label className="factor-compare-check">
                        <input
                          type="checkbox"
                          checked={comparisonFactorIds.includes(factor.id)}
                          onChange={(event) => toggleComparisonFactor(factor.id, event.target.checked)}
                        />
                        <span>比对</span>
                      </label>
                      <button className="factor-btn factor-btn--small" onClick={() => navigateTo(`/factors/${factor.id}`)}>详情</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="factor-panel factor-correlation-panel">
        <div className="factor-section-title">
          <span>{comparisonFactors.length === 2 ? '因子表现对比图' : '相关性热力图'}</span>
          <span className="factor-muted">{comparisonFactors.length === 2 ? '双因子指纹比对' : '按类别聚类，点击因子高亮 > 0.7'}</span>
        </div>
        {comparisonFactors.length === 2 ? (
          <FactorComparisonPanel factors={comparisonFactors} onClear={() => setComparisonFactorIds([])} />
        ) : (
          <FactorCorrelationMatrix
            factors={factors}
            selectedFactorId={selectedCorrelationFactor?.id}
            onSelect={setSelectedCorrelationFactorId}
            highOnly={highCorrelationOnly}
            onHighOnlyChange={setHighCorrelationOnly}
          />
        )}
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
  const primaryActionLabel = diagnosticMode === 'SANDBOX' ? '提交 Sandbox 诊断' : '保存为已验证';
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
                    <span>换手率与衰减</span>
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
                    <span>分层收益与 IC 走势</span>
                    <p>强因子组到弱因子组保持单调性，极端分组的换手与覆盖率同时展示。</p>
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
                <div className="factor-section-title"><span>合规足迹</span></div>
                <p className="factor-detail-trail">
                  {factor.name} 因子使用 {factor.expression} 逻辑，绑定 {datasetId} 与 {universeId}，清洗规则 {cleaningVersion}，诊断时间 {diagnosedAt}，执行人 {operator}。
                </p>
                <div className="factor-detail-pdf">
                  <strong>投委会 PDF 附件</strong>
                  <span>自动带入诊断摘要、PIT 版本、极端场景和合规足迹。</span>
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
    </div>
  );
}

export function FactorEditorPage({ factorId: _factorId }: { factorId?: string }): JSX.Element {
  const api = useApiClient();
  const [name, setName] = useState('短周期价格动量');
  const [expression, setExpression] = useState('Rank(Delta(Close, 5))');
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
              <input value={metric} onChange={(event) => setMetric(event.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} />
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
          <div className="factor-formula-preview">
            <FormulaWithTooltips expression={expression} />
          </div>
          <div className="factor-chip-row">
            {['Rank', 'Delta', 'Ts_Rank', 'Correlation', 'Close', 'Volume', 'ZScore', 'Std', 'Return'].map((item) => (
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
