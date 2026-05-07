import { useDeferredValue, useMemo, useState, type CSSProperties } from 'react';
import { navigateTo } from '../../lib/appRouteContext';
import { canUpgradeStrategyLegVersions } from '../../lib/saved-strategy-leg-inventory';
import { formatRatio } from '../../lib/format';
import {
  cleanDisplayText,
  formatBenchmarkLabel,
  formatCompositionFactorDetail,
  formatCompositionFactorLabel,
  formatCompositionName,
  formatCompositionStatusLabel,
  formatCompositionVerdict,
  formatLegDisplayName,
  formatLegProofLabel,
  formatLegReferenceSummary,
  formatTagLabel,
} from '../../lib/compose-display';
import type {
  ApiCompositionCorrelationCell,
  ApiCompositionLegInput,
  ApiCompositionPreview,
  ApiCompositionPreviewLeg,
  ApiCompositionReturnQualityLeg,
  ApiLegInventory,
  ApiLegInventoryRow,
  ApiLegType,
} from '../../types';
import './composition-workbench.css';

type PersistIntent = 'DRAFT' | 'ACTIVE';

type CompositionWorkbenchViewProps = {
  inventory: ApiLegInventory | null;
  preview: ApiCompositionPreview | null;
  compositionName: string;
  description: string;
  benchmarkLabel: string;
  rebalanceFrequency: string;
  selectedLegs: ApiCompositionLegInput[];
  loading?: boolean;
  previewLoading?: boolean;
  saving?: boolean;
  error?: string | null;
  statusLabel?: string | null;
  onCompositionNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onBenchmarkLabelChange: (value: string) => void;
  onRebalanceFrequencyChange: (value: string) => void;
  onAddLeg: (row: ApiLegInventoryRow) => void;
  onRemoveLeg: (sourceRefId: string) => void;
  onWeightChange: (sourceRefId: string, nextWeight: number) => void;
  onToggleLock: (sourceRefId: string) => void;
  onPersist: (intent: PersistIntent) => Promise<void>;
};

type SourceFilter = 'all' | ApiLegType;
type ReturnWindow = '3m' | '12m' | '24m';
type CorrelationInsight = {
  key: string;
  leftLabel: string;
  rightLabel: string;
  correlation: number;
  tone: 'warning' | 'accent';
};

const REBALANCE_OPTIONS = [
  { value: 'monthly', label: '月度再平衡' },
  { value: 'quarterly', label: '季度再平衡' },
  { value: 'semiannual', label: '半年再平衡' },
  { value: 'annual', label: '年度再平衡' },
] as const;
const RETURN_WINDOW_OPTIONS: Array<{ value: ReturnWindow; label: string; points: number }> = [
  { value: '3m', label: '3 个月', points: 3 },
  { value: '12m', label: '12 个月', points: 12 },
  { value: '24m', label: '24 个月', points: 24 },
];
const RADAR_AXIS_LABELS = ['分散度', '来源可信度', '成本控制', '收益增强', '维护节奏'] as const;

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

function getLegTypeLabel(value: string): string {
  switch (value) {
    case 'strategy':
      return '策略腿';
    case 'asset':
      return '资产腿';
    case 'cash':
      return '现金腿';
    default:
      return '来源腿';
  }
}

function getLegTypeClassName(value: string): string {
  return `composition-workbench-pill composition-workbench-pill--${value}`;
}

function getRowStatusLabel(value: string): string {
  return formatCompositionStatusLabel(value);
}

function getSourceStatusPriority(row: ApiLegInventoryRow): number {
  if (row.status === 'READY' || row.status === 'ACTIVE') {
    return 3;
  }
  if (row.status === 'STALE') {
    return 2;
  }
  if (row.attribute_tags.includes('needs_run')) {
    return 0;
  }
  return 1;
}

function getCadenceLabel(value?: string | null): string {
  const matched = REBALANCE_OPTIONS.find((item) => item.value === String(value || '').toLowerCase());
  return matched?.label ?? '维护节奏待确认';
}

function getCadenceRuleLabel(value?: string | null): string {
  switch (String(value || '').toLowerCase()) {
    case 'monthly':
      return '月度规则';
    case 'quarterly':
      return '季度规则';
    case 'semiannual':
      return '半年度规则';
    case 'annual':
      return '年度规则';
    default:
      return '维护规则';
  }
}

function getCadenceConstraintLabel(value?: string | null): string {
  switch (String(value || '').toLowerCase()) {
    case 'monthly':
      return '月度组合约束';
    case 'quarterly':
      return '季度组合约束';
    case 'semiannual':
      return '半年度组合约束';
    case 'annual':
      return '年度组合约束';
    default:
      return '组合约束';
  }
}

function formatCompactPercent(value: number): string {
  const normalized = clampWeight(value);
  return Number.isInteger(normalized) ? `${normalized.toFixed(0)}%` : `${normalized.toFixed(1)}%`;
}

function getReturnQualityStatusLabel(value?: string | null): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'verified':
    case 'current':
    case 'ready':
    case 'aligned':
      return '已对齐';
    case 'limited':
      return '样本有限';
    case 'fallback':
    case 'fallback_used':
      return '代理估算';
    case 'missing':
    case 'pending':
      return '待补齐';
    default:
      return '待确认';
  }
}

function getReturnQualityIssueTypes(quality?: ApiCompositionReturnQualityLeg | null): string[] {
  return Array.isArray(quality?.issue_types)
    ? quality.issue_types.filter((issue): issue is string => typeof issue === 'string' && issue.trim().length > 0)
    : [];
}

function getReturnQualityBadge(
  quality?: ApiCompositionReturnQualityLeg | null,
): { label: string; detail: string; className: string } | null {
  const issueTypes = getReturnQualityIssueTypes(quality);
  if (!quality || !issueTypes.length) {
    return null;
  }
  const samplePoints = Number.isFinite(quality.sample_points) ? quality.sample_points : 0;
  const missingPoints = Number.isFinite(quality.missing_points) ? quality.missing_points : 0;
  const className = issueTypes.includes('收益样本缺失')
    ? 'composition-workbench-chip composition-workbench-chip--danger'
    : 'composition-workbench-chip composition-workbench-chip--warning';
  return {
    label: issueTypes.join('、'),
    detail: `样本 ${samplePoints} 月 / 缺口 ${missingPoints}`,
    className,
  };
}

function buildReturnQualityLookup(
  legQuality?: ApiCompositionReturnQualityLeg[] | null,
): Map<string, ApiCompositionReturnQualityLeg> {
  const lookup = new Map<string, ApiCompositionReturnQualityLeg>();
  (legQuality ?? []).forEach((quality) => {
    [quality.leg_id, quality.source_ref_id ?? '', quality.display_name]
      .map((key) => String(key ?? '').trim())
      .filter(Boolean)
      .forEach((key) => lookup.set(key, quality));
  });
  return lookup;
}

function getRowReturnQuality(
  row: ApiLegInventoryRow,
  lookup: Map<string, ApiCompositionReturnQualityLeg>,
): ApiCompositionReturnQualityLeg | null {
  return (
    lookup.get(row.source_ref_id ?? '') ??
    lookup.get(row.id) ??
    lookup.get(row.name) ??
    row.return_quality ??
    null
  );
}

function getDraftReturnQuality(
  draft: ApiCompositionLegInput,
  previewLeg: ApiCompositionPreviewLeg | null,
  lookup: Map<string, ApiCompositionReturnQualityLeg>,
): ApiCompositionReturnQualityLeg | null {
  return (
    lookup.get(draft.source_ref_id) ??
    lookup.get(previewLeg?.source_ref_id ?? '') ??
    lookup.get(previewLeg?.id ?? '') ??
    lookup.get(previewLeg?.display_name ?? '') ??
    null
  );
}

const WORKBENCH_TERM_HELP = {
  returnStream: '收益流指同一时间轴上的组合、基准和各腿收益序列，用来计算相关性、风险贡献和回撤。',
  covarianceMatrix: '协方差矩阵用于衡量各腿收益同时波动的关系，是相关性和风险贡献计算的基础。',
  rebalanceEvent: '调仓事件是按再平衡频次模拟出来的权重调整点，会产生换手、交易成本和现金缓冲影响。',
  returnQuality: '收益质量表示收益流是否已按同一时间窗口对齐，以及样本覆盖率是否足够支撑计算。',
  netReturn: '净收益预估是在毛收益基础上扣除维护成本、滑点、调仓损耗和现金缓冲拖累后的结果。',
  sourceSignature: '来源签名记录冻结哈希、来源版本和漂移状态，用于证明组合保存时使用的是哪一版证据。',
  netBreakdown: '净收益拆解把毛收益和各类拖累分开展示，便于判断收益改善来自市场表现还是成本变化。',
} as const;

function WorkbenchTermLabel({ label, help }: { label: string; help: string }) {
  return (
    <span className="composition-workbench-term-label">
      <span>{label}</span>
      <span
        aria-label={`${label}说明`}
        className="composition-workbench-term-tooltip"
        data-tooltip={help}
        role="tooltip"
        tabIndex={0}
        title={help}
      >
        ?
      </span>
    </span>
  );
}

function formatSourceMetaLabel(value?: string | null): string | null {
  const text = cleanDisplayText(value);
  if (!text || /^[?嚗]+$/.test(text)) {
    return null;
  }
  switch (text.toLowerCase()) {
    case 'target_buffer':
      return '目标缓冲';
    case 'bond':
      return '债券';
    case 'manual':
      return '人工冻结';
    case 'snapshot_locked':
      return '快照冻结';
    case 'phase1_live_smoke_cash':
    case 'phase1 live smoke cash':
      return 'Phase 1 线上烟测现金';
    case 'phase1_live_smoke':
    case 'phase1 live smoke':
      return 'Phase 1 线上烟测';
    case 'ds-price':
      return '价格数据源';
    default:
      return text.replace(/_/g, ' ');
  }
}

function getInventoryRowDisplayName(row: ApiLegInventoryRow): string {
  return formatLegDisplayName({
    leg_kind: row.leg_type,
    name: row.name,
    source_ref_id: row.source_ref_id,
    config: row.config,
  });
}

function getInventoryRowReferenceLabel(row: ApiLegInventoryRow): string {
  return formatLegReferenceSummary(row.reference_summary, row.reference_count);
}

function getInventoryRowProofLabel(row: ApiLegInventoryRow): string {
  return formatLegProofLabel(row.proof_label, {
    leg_kind: row.leg_type,
    name: row.name,
    source_ref_id: row.source_ref_id,
    config: row.config,
  });
}

function getInventoryRowCardTitle(row: ApiLegInventoryRow): string {
  const config = (row.config ?? {}) as Record<string, unknown>;
  const cashRuleKind = String(config.cash_rule_kind ?? row.version_label ?? '').toUpperCase();
  if (row.leg_type === 'cash' && cashRuleKind === 'TARGET_BUFFER') {
    return '现金缓冲规则';
  }
  return getInventoryRowDisplayName(row);
}

function getInventoryRowFeatureChips(
  row: ApiLegInventoryRow,
  added: boolean,
  rebalanceFrequency: string,
): string[] {
  if (row.leg_type === 'cash') {
    const isActiveBuffer = added || row.reference_count > 0;
    return [
      getLegTypeLabel(row.leg_type),
      getCadenceRuleLabel(rebalanceFrequency),
      isActiveBuffer ? '维护缓冲中' : '维护缓冲候选',
    ];
  }
  return [getLegTypeLabel(row.leg_type), row.has_new_version ? '有新版本' : getRowStatusLabel(row.status)];
}

function getInventoryRowDescription(
  row: ApiLegInventoryRow,
  added: boolean,
  rebalanceFrequency: string,
  selectedLegs: ApiCompositionLegInput[],
): string {
  const config = (row.config ?? {}) as Record<string, unknown>;
  const summary =
    typeof config.summary === 'object' && config.summary !== null
      ? (config.summary as Record<string, unknown>)
      : null;
  const sourceRefId = row.source_ref_id ?? row.id;
  const selectedLeg = selectedLegs.find((leg) => leg.source_ref_id === sourceRefId) ?? null;

  if (row.leg_type === 'cash') {
    const summaryTargetWeight =
      summary && typeof summary.target_weight_pct === 'number' ? summary.target_weight_pct : null;
    const targetWeight = summaryTargetWeight ?? selectedLeg?.weight_pct ?? 20;
    const isActiveBuffer = added || row.reference_count > 0;
    return `现金缓冲中 ${formatCompactPercent(targetWeight)} · 用于再平衡成本吸收和换手控制。${
      isActiveBuffer ? '当前在组合中作为维护安全垫。' : '加入后将作为维护安全垫。'
    }`;
  }

  if (row.leg_type === 'asset') {
    const assetKind = String(config.asset_kind ?? '').toUpperCase();
    if (assetKind === 'BOND' || row.attribute_tags.some((tag) => String(tag).toLowerCase() === 'bond')) {
      return `${getInventoryRowCardTitle(row)} 用于提供防御和利率缓冲。${
        added ? '当前已在组合中承担稳定器角色。' : '可加入组合承担稳定器角色。'
      }`;
    }
    return `${getInventoryRowCardTitle(row)} 提供基础资产暴露，并支持组合分散配置。`;
  }

  return `${getInventoryRowCardTitle(row)} 基于已验证策略版本，可作为组合的主动收益来源。`;
}

function getMetricRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getInventoryMetricRecords(row: ApiLegInventoryRow): Record<string, unknown>[] {
  const config = getMetricRecord(row.config);
  const summary = getMetricRecord(config.summary);
  return [getMetricRecord(config.metrics), config, getMetricRecord(summary.bond_snapshot), summary];
}

function readMetricNumber(records: Record<string, unknown>[], keys: string[]): number | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }
  return null;
}

function readMetricString(records: Record<string, unknown>[], keys: string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function normalizePercentPoint(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function formatMetricPercent(value: number | null, options: { absolute?: boolean; digits?: number } = {}): string {
  const normalized = normalizePercentPoint(value);
  if (normalized === null) {
    return 'n/a';
  }
  const signed = options.absolute ? Math.abs(normalized) : normalized;
  return `${signed.toFixed(options.digits ?? 1)}%`;
}

function formatMetricNumber(value: number | null, digits = 2): string {
  return value === null ? 'n/a' : value.toFixed(digits);
}

function formatStrategyTypeMetricLabel(value?: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'momentum':
      return '动量';
    case 'quality_momentum':
      return '质量动量';
    case 'low_volatility':
      return '低波动';
    case 'mean_reversion':
      return '均值回归';
    case 'buy_and_hold':
      return '买入持有';
    case 'value':
      return '价值';
    case 'growth':
      return '成长';
    case 'general':
    case '':
      return '策略';
    default:
      return normalized.replace(/_/g, ' ');
  }
}

function getStrategyTypeMetricLabel(row: ApiLegInventoryRow): string {
  const records = getInventoryMetricRecords(row);
  const explicitType = readMetricString(records, ['strategy_type', 'type']);
  const tagType = row.attribute_tags.find((tag) => {
    const normalized = String(tag).trim().toLowerCase();
    return (
      normalized &&
      normalized !== 'strategy' &&
      !normalized.startsWith('universe:') &&
      !normalized.startsWith('benchmark:') &&
      !normalized.startsWith('version:') &&
      !normalized.startsWith('rebalance:') &&
      !['needs_run', 'newer_version_available', 'pending_update', 'low_correlation'].includes(normalized)
    );
  });
  return formatStrategyTypeMetricLabel(explicitType ?? tagType);
}

function isBondInventoryRow(row: ApiLegInventoryRow): boolean {
  const records = getInventoryMetricRecords(row);
  const assetKind = readMetricString(records, ['asset_kind', 'instrument_type', 'asset_type']);
  const marker = [assetKind, row.proof_label, row.source_ref_type, ...row.attribute_tags]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return marker.includes('bond') || marker.includes('tips') || marker.includes('treasury') || marker.includes('t_bill');
}

function formatCashRuleMetricLabel(value?: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'target_buffer':
    case 'buffer':
      return '目标缓冲';
    case 'pure_cash':
      return '纯现金';
    case 'cash_enhancer':
      return '现金增强';
    case '':
      return '现金规则';
    default:
      return normalized.replace(/_/g, ' ');
  }
}

function getInventoryRowMetricTagLabels(row: ApiLegInventoryRow): string[] {
  const records = getInventoryMetricRecords(row);

  if (row.leg_type === 'strategy') {
    return [
      `类型：${getStrategyTypeMetricLabel(row)}`,
      `年化收益 ${formatMetricPercent(readMetricNumber(records, ['annualized_return_pct', 'annualized_return', 'cagr', 'oos_annualized_return']))}`,
      `最大回撤 ${formatMetricPercent(readMetricNumber(records, ['max_drawdown_pct', 'max_drawdown', 'oos_max_drawdown']), { absolute: true })}`,
      `夏普 ${formatMetricNumber(readMetricNumber(records, ['oos_sharpe', 'out_of_sample_sharpe', 'sharpe']))}`,
    ];
  }

  if (row.leg_type === 'asset') {
    if (isBondInventoryRow(row)) {
      return [
        '类型：债券',
        `YTM ${formatMetricPercent(readMetricNumber(records, ['ytm_pct', 'yield_to_maturity_pct', 'sec_yield_30d_pct', 'real_yield_pct']), { digits: 2 })}`,
        `久期 ${formatMetricNumber(readMetricNumber(records, ['duration_years', 'duration', 'effective_duration']), 1)}年`,
        `波动 ${formatMetricPercent(readMetricNumber(records, ['volatility_pct', 'annualized_volatility_pct', 'annualized_volatility']))}`,
      ];
    }
    return [
      '类型：股票',
      `年化收益 ${formatMetricPercent(readMetricNumber(records, ['annualized_return_pct', 'annualized_return', 'cagr', 'latest_total_return_pct', 'total_return_pct', 'total_return']))}`,
      `最大回撤 ${formatMetricPercent(readMetricNumber(records, ['max_drawdown_pct', 'max_drawdown']), { absolute: true })}`,
      `夏普 ${formatMetricNumber(readMetricNumber(records, ['oos_sharpe', 'out_of_sample_sharpe', 'sharpe']))}`,
    ];
  }

  const rule = formatCashRuleMetricLabel(readMetricString(records, ['cash_rule_kind', 'rule_kind']) ?? row.version_label);
  const yieldSource = readMetricString(records, ['yield_source', 'source_rule']);
  return [`来源规则：${yieldSource ? `${rule} / ${yieldSource}` : rule}`];
}

function getInventoryRowTagLabels(row: ApiLegInventoryRow, rebalanceFrequency: string): string[] {
  if (row.leg_type === 'cash') {
    return ['成本吸收', getCadenceConstraintLabel(rebalanceFrequency)];
  }

  const seen = new Set<string>();
  const labels = row.attribute_tags
    .map((tag) => {
      const normalized = (cleanDisplayText(tag) ?? String(tag)).trim().toLowerCase().replace(/\s+/g, '_');
      if (!normalized || normalized === row.leg_type || normalized === 'notes') {
        return null;
      }
      const label = formatTagLabel(tag);
      const dedupeKey = label.trim().toLowerCase();
      if (!dedupeKey || seen.has(dedupeKey)) {
        return null;
      }
      seen.add(dedupeKey);
      return label;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);

  return labels.length > 0 ? labels : [formatSourceMetaLabel(row.version_label) ?? getRowStatusLabel(row.status)];
}

function getPreviewLegDisplayName(
  previewLeg: ApiCompositionPreviewLeg | null,
  draftLeg: ApiCompositionLegInput,
): string {
  return formatLegDisplayName({
    leg_kind: previewLeg?.leg_kind ?? draftLeg.leg_kind,
    display_name: previewLeg?.display_name ?? draftLeg.display_name,
    source_ref_id: draftLeg.source_ref_id,
    config: previewLeg?.config ?? draftLeg.config,
  });
}

function getPreviewLegProofText(
  previewLeg: ApiCompositionPreviewLeg | null,
  draftLeg: ApiCompositionLegInput,
): string {
  return formatLegProofLabel(previewLeg?.proof_label, {
    leg_kind: previewLeg?.leg_kind ?? draftLeg.leg_kind,
    display_name: previewLeg?.display_name ?? draftLeg.display_name,
    source_ref_id: draftLeg.source_ref_id,
    config: previewLeg?.config ?? draftLeg.config,
  });
}

function getChartPath(
  points: number[],
  width: number,
  height: number,
  domainMin?: number,
  domainMax?: number,
): string {
  return getChartCoordinates(points, width, height, domainMin, domainMax)
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
}

function getChartCoordinates(
  points: number[],
  width: number,
  height: number,
  domainMin?: number,
  domainMax?: number,
): Array<{ x: number; y: number }> {
  if (!points.length) {
    return [];
  }
  const min = domainMin ?? Math.min(...points);
  const max = domainMax ?? Math.max(...points);
  const range = max - min || 1;
  return points.map((point, index) => {
    const x = 18 + (index / Math.max(points.length - 1, 1)) * (width - 36);
    const y = height - 18 - ((point - min) / range) * (height - 36);
    return { x, y };
  });
}

function getChartAreaPath(
  points: number[],
  width: number,
  height: number,
  domainMin?: number,
  domainMax?: number,
): string {
  const coordinates = getChartCoordinates(points, width, height, domainMin, domainMax);
  if (!coordinates.length) {
    return '';
  }
  const baseline = height - 18;
  const head = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return `${head} L ${last.x.toFixed(2)} ${baseline.toFixed(2)} L ${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

function getDrawdownAreaPath(
  points: number[],
  width: number,
  height: number,
  domainMin?: number,
  domainMax?: number,
): string {
  const coordinates = getChartCoordinates(points, width, height, domainMin, domainMax);
  if (coordinates.length < 3) {
    return '';
  }
  let runningPeak = points[0] ?? 0;
  const drawdownFlags = points.map((point) => {
    runningPeak = Math.max(runningPeak, point);
    return runningPeak - point > 0.002;
  });
  let start = drawdownFlags.findIndex(Boolean);
  let end = drawdownFlags.length - 1 - [...drawdownFlags].reverse().findIndex(Boolean);
  if (start < 0 || end < start) {
    return '';
  }
  const segment = coordinates.slice(start, end + 1);
  const baseline = height - 18;
  const head = segment
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${(y + 18).toFixed(2)}`)
    .join(' ');
  const first = segment[0];
  const last = segment[segment.length - 1];
  return `${head} L ${last.x.toFixed(2)} ${baseline.toFixed(2)} L ${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

function getRadarPoints(scores: number[], radius = 42): string {
  return scores
    .map((score, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(scores.length, 1);
      const scaledRadius = radius * (Math.max(0, Math.min(score, 100)) / 100);
      const x = 50 + Math.cos(angle) * scaledRadius;
      const y = 50 + Math.sin(angle) * scaledRadius;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function getRadarAxisPoints(radius = 42): string {
  return RADAR_AXIS_LABELS.map((_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / RADAR_AXIS_LABELS.length;
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function getRadarFactorScore(
  label: string,
  factors: Array<{ label: string; key: string; score: number }>,
  fallbackScore: number,
  maintenanceBps: number,
): number {
  const normalizedLabel = label.toLowerCase();
  const matched = factors.find((factor) => {
    const key = factor.key.toLowerCase();
    const factorLabel = factor.label.toLowerCase();
    return factorLabel.includes(normalizedLabel) || normalizedLabel.includes(factorLabel) || key.includes(normalizedLabel);
  });
  if (matched) {
    return matched.score;
  }
  if (label === '成本控制') {
    return Math.max(64, Math.min(94, 100 - maintenanceBps));
  }
  return fallbackScore;
}

function getRebalanceTurnoverBudgetBps(value?: string | null): number {
  switch (String(value ?? '').toLowerCase()) {
    case 'monthly':
      return 80;
    case 'quarterly':
      return 45;
    case 'semiannual':
    case 'annual':
      return 20;
    default:
      return 45;
  }
}

function getDisplayMaintenanceCostBps(
  summary: ApiCompositionPreview['maintenance_cost_summary'] | null,
  rebalanceFrequency: string,
): number {
  if (!summary) {
    return 0;
  }
  const turnoverBudgetBps = getRebalanceTurnoverBudgetBps(rebalanceFrequency);
  const estimated = summary.expense_ratio_bps + summary.trade_cost_bps + turnoverBudgetBps * 0.25;
  return Number((Number.isFinite(estimated) ? estimated : summary.total_estimated_bps).toFixed(2));
}

function buildMatrixKey(left: string, right: string): string {
  return [left, right].sort().join('::');
}

function buildCorrelationLookup(cells: ApiCompositionCorrelationCell[]): Map<string, number> {
  return new Map(cells.map((cell) => [buildMatrixKey(cell.x_key, cell.y_key), cell.correlation]));
}

function getCorrelationToneClass(value: number): string {
  if (value >= 0.995) {
    return 'composition-workbench-correlation-cell--self';
  }
  if (value >= 0.7) {
    return 'composition-workbench-correlation-cell--hot';
  }
  if (value >= 0.2) {
    return 'composition-workbench-correlation-cell--mid';
  }
  if (value < 0) {
    return 'composition-workbench-correlation-cell--negative';
  }
  return 'composition-workbench-correlation-cell--low';
}

function getCorrelationPairLabel(value: number): string {
  if (value >= 0.7) {
    return '高相关';
  }
  if (value <= -0.2) {
    return '负相关';
  }
  if (Math.abs(value) <= 0.25) {
    return '低相关';
  }
  return '中性相关';
}

function getPreviewLeg(
  draftLeg: ApiCompositionLegInput,
  preview?: ApiCompositionPreview | null,
): ApiCompositionPreviewLeg | null {
  if (!preview) {
    return null;
  }
  return (
    preview.normalized_legs.find(
      (item) =>
        item.source_ref_id === draftLeg.source_ref_id &&
        item.leg_kind === draftLeg.leg_kind,
    ) ?? null
  );
}

function getCorrelationInsights(preview: ApiCompositionPreview | null): CorrelationInsight[] {
  if (!preview || preview.normalized_legs.length < 2) {
    return [];
  }
  const labelByKey = new Map(
    preview.normalized_legs.map((leg) => [
      leg.id,
      formatLegDisplayName({
        leg_kind: leg.leg_kind,
        display_name: leg.display_name,
        source_ref_id: leg.source_ref_id,
        config: leg.config,
      }),
    ]),
  );
  return preview.correlation_matrix
    .filter((cell) => cell.x_key !== cell.y_key)
    .filter((cell) => Math.abs(cell.correlation) >= 0.55)
    .map((cell): CorrelationInsight => ({
      key: buildMatrixKey(cell.x_key, cell.y_key),
      leftLabel: labelByKey.get(cell.x_key) ?? cell.x_key,
      rightLabel: labelByKey.get(cell.y_key) ?? cell.y_key,
      correlation: cell.correlation,
      tone: cell.correlation >= 0.7 ? 'warning' : 'accent',
    }))
    .filter((item, index, source) => source.findIndex((candidate) => candidate.key === item.key) === index)
    .sort((left, right) => Math.abs(right.correlation) - Math.abs(left.correlation))
    .slice(0, 4);
}

function getRiskContributionLabel(weightPct: number, contributionPct: number): string {
  if (contributionPct >= weightPct * 1.35) {
    return '风险占用偏高';
  }
  if (contributionPct <= Math.max(weightPct * 0.7, 1)) {
    return '风险贡献克制';
  }
  return '风险分布均衡';
}

function getTypeWeightSummary(legs: ApiCompositionLegInput[]): Array<{ label: string; total: number; kind: ApiLegType }> {
  const totals = new Map<ApiLegType, number>([
    ['strategy', 0],
    ['asset', 0],
    ['cash', 0],
  ]);
  legs.forEach((leg) => {
    totals.set(leg.leg_kind, (totals.get(leg.leg_kind) ?? 0) + clampWeight(leg.weight_pct));
  });
  return [
    { kind: 'strategy', label: '策略腿', total: totals.get('strategy') ?? 0 },
    { kind: 'asset', label: '资产腿', total: totals.get('asset') ?? 0 },
    { kind: 'cash', label: '现金腿', total: totals.get('cash') ?? 0 },
  ];
}

export function CompositionWorkbenchView({
  inventory,
  preview,
  compositionName,
  description,
  benchmarkLabel,
  rebalanceFrequency,
  selectedLegs,
  loading,
  previewLoading,
  saving,
  error,
  statusLabel,
  onCompositionNameChange,
  onDescriptionChange,
  onBenchmarkLabelChange,
  onRebalanceFrequencyChange,
  onAddLeg,
  onRemoveLeg,
  onWeightChange,
  onToggleLock,
  onPersist,
}: CompositionWorkbenchViewProps): JSX.Element {
  const [activeType, setActiveType] = useState<SourceFilter>('all');
  const [searchValue, setSearchValue] = useState('');
  const [scoreOpen, setScoreOpen] = useState(true);
  const [returnWindow, setReturnWindow] = useState<ReturnWindow>('12m');
  const [highlightedPair, setHighlightedPair] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(searchValue.trim().toLowerCase());

  const rows = inventory?.rows ?? [];
  const canUpgradeVersions = canUpgradeStrategyLegVersions(selectedLegs, rows);
  const addedSourceIds = new Set(selectedLegs.map((leg) => leg.source_ref_id));
  const filteredRows = rows.filter((row) => {
    if (activeType !== 'all' && row.leg_type !== activeType) {
      return false;
    }
    if (!deferredSearch) {
      return true;
    }
    const haystack = [
      row.name,
      row.version_label,
      getInventoryRowProofLabel(row),
      getInventoryRowReferenceLabel(row),
      ...row.attribute_tags.map((tag) => cleanDisplayText(tag) ?? formatTagLabel(tag)),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(deferredSearch);
  }).sort((left, right) => {
    const leftId = left.source_ref_id ?? left.id;
    const rightId = right.source_ref_id ?? right.id;
    const addedDelta = Number(addedSourceIds.has(rightId)) - Number(addedSourceIds.has(leftId));
    if (addedDelta !== 0) {
      return addedDelta;
    }
    return getSourceStatusPriority(right) - getSourceStatusPriority(left);
  });

  const selectedPreviewLegs = selectedLegs.map((leg) => ({
    draft: leg,
    preview: getPreviewLeg(leg, preview),
  }));
  const riskContributionMap = useMemo(() => {
    const map = new Map<string, number>();
    if (preview) {
      preview.risk_contribution_preview.forEach((item) => {
        map.set(item.leg_id, item.contribution_pct);
        map.set(item.label, item.contribution_pct);
        map.set(
          formatLegDisplayName({
            display_name: item.label,
          }),
          item.contribution_pct,
        );
      });
    }
    return map;
  }, [preview]);
  const correlationLookup = useMemo(
    () => buildCorrelationLookup(preview?.correlation_matrix ?? []),
    [preview?.correlation_matrix],
  );
  const correlationInsights = useMemo(() => getCorrelationInsights(preview), [preview]);
  const typeWeightSummary = useMemo(() => getTypeWeightSummary(selectedLegs), [selectedLegs]);
  const chartWindowSize = RETURN_WINDOW_OPTIONS.find((item) => item.value === returnWindow)?.points ?? 12;
  const chartSeries = preview ? preview.returns_preview.map((item) => item.cumulative_return_pct).slice(-chartWindowSize) : [];
  const benchmarkSeries = preview
    ? preview.benchmark_series.map((item) => item.cumulative_return_pct)
        .slice(-chartWindowSize)
    : [];
  const chartDomainMin = Math.min(...[0, ...chartSeries, ...benchmarkSeries]);
  const chartDomainMax = Math.max(...[0, ...chartSeries, ...benchmarkSeries, 0.01]);
  const returnsPath = getChartPath(chartSeries, 640, 280, chartDomainMin, chartDomainMax);
  const returnsAreaPath = getChartAreaPath(chartSeries, 640, 280, chartDomainMin, chartDomainMax);
  const drawdownAreaPath = getDrawdownAreaPath(chartSeries, 640, 280, chartDomainMin, chartDomainMax);
  const benchmarkPath = getChartPath(benchmarkSeries, 640, 280, chartDomainMin, chartDomainMax);
  const previewScore = preview ? preview.composition_score : null;
  const previewFactors = previewScore ? previewScore.factors : [];
  const previewWeightSummary = preview ? preview.weight_summary : null;
  const previewMaintenanceSummary = preview ? preview.maintenance_cost_summary : null;
  const previewWarnings = preview ? preview.warnings : [];
  const previewAdvisories = preview ? preview.advisories : [];
  const previewNormalizedLegs = preview ? preview.normalized_legs : [];
  const returnQualitySummary = preview?.return_quality_summary ?? null;
  const returnQualityLookup = useMemo(
    () => buildReturnQualityLookup(returnQualitySummary?.leg_quality),
    [returnQualitySummary?.leg_quality],
  );
  const rebalanceEvents = preview?.rebalance_events ?? [];
  const sourceIntegrity = preview?.source_integrity ?? [];
  const latestReturnPoint = preview?.returns_preview[preview.returns_preview.length - 1] ?? null;
  const grossReturnPct = latestReturnPoint?.cumulative_return_pct ?? 0;
  const maintenanceDragPct = (previewMaintenanceSummary?.expense_ratio_bps ?? 0) / 100;
  const slippageDragPct = (previewMaintenanceSummary?.trade_cost_bps ?? 0) / 100;
  const rebalanceDragPct = rebalanceEvents.reduce((sum, item) => sum + (item.cost_drag_pct ?? 0), 0);
  const preliminaryNetReturnPct = grossReturnPct - maintenanceDragPct - slippageDragPct - rebalanceDragPct;
  const joinedCount = selectedLegs.length;
  const hasSelectedLegs = joinedCount > 0;
  const totalWeight = previewWeightSummary?.total_weight_pct ?? 0;
  const residualWeight = previewWeightSummary?.residual_weight_pct ?? 0;
  const residualIsUnbalanced = Math.abs(residualWeight) > 0.05;
  const lockedWeight =
    previewWeightSummary?.locked_weight_pct ??
    selectedLegs.reduce((sum, leg) => sum + (leg.weight_locked ? clampWeight(leg.weight_pct) : 0), 0);
  const cashWeight = typeWeightSummary.find((item) => item.kind === 'cash')?.total ?? 0;
  const cashDragPct = cashWeight > 0 ? cashWeight * 0.015 : 0;
  const netReturnPct = preliminaryNetReturnPct - cashDragPct;
  const returnQualityCoveragePct = returnQualitySummary?.coverage_pct ?? 0;
  const returnQualityStatusText = `${getReturnQualityStatusLabel(returnQualitySummary?.status)} · ${returnQualityCoveragePct}%`;
  const rebalanceTurnoverPct = rebalanceEvents.reduce((sum, item) => sum + (item.turnover_pct ?? 0), 0);
  const rebalanceCostBps = rebalanceEvents.reduce((sum, item) => sum + (item.estimated_cost_bps ?? 0), 0);
  const rebalanceEventSummaryText = rebalanceEvents.length
    ? `${rebalanceEvents.length} 次事件 · 换手 ${rebalanceTurnoverPct.toFixed(1)}% · 成本 ${rebalanceCostBps.toFixed(2)} bps`
    : '等待预演生成调仓事件';
  const sourceDriftCount = sourceIntegrity.filter((source) => {
    const status = String(source.drift_status ?? '').toLowerCase();
    return status === 'drifted' || status === 'version_drift' || status === 'stale';
  }).length;
  const sourceIntegrityStatusText = sourceIntegrity.length
    ? `${sourceIntegrity.length - sourceDriftCount}/${sourceIntegrity.length} 来源一致`
    : '等待来源签名';
  const rawMaintenanceCostBps = previewMaintenanceSummary?.total_estimated_bps ?? 0;
  const displayMaintenanceCostBps = getDisplayMaintenanceCostBps(previewMaintenanceSummary, rebalanceFrequency);
  const maintenanceCostElevated =
    rebalanceFrequency === 'monthly' ||
    displayMaintenanceCostBps > rawMaintenanceCostBps + 0.01 ||
    displayMaintenanceCostBps >= 30;
  const radarFactors = hasSelectedLegs && previewScore
    ? RADAR_AXIS_LABELS.map((label) => ({
        label,
        score: getRadarFactorScore(
          label,
          previewFactors,
          previewScore.score,
          displayMaintenanceCostBps,
        ),
      }))
    : RADAR_AXIS_LABELS.map((label) => ({ label, score: 0 }));
  const scoreValue = hasSelectedLegs ? previewScore?.score ?? 0 : 0;
  const scoreRingStyle = {
    '--score-deg': `${Math.max(0, Math.min(scoreValue, 100)) * 3.6}deg`,
  } as CSSProperties;
  const availableCount = rows.length;
  const compositionHeading = compositionName.trim()
    ? formatCompositionName({ name: compositionName, benchmarkLabel })
    : '组合工作台';
  const resolvedBenchmarkLabel = formatBenchmarkLabel(benchmarkLabel);
  const previewVerdict = hasSelectedLegs ? formatCompositionVerdict(previewScore?.verdict) : '待选择腿';
  const warningItems = previewWarnings.map((item) => cleanDisplayText(item) ?? item);
  const advisoryItems = previewAdvisories.map((item) => cleanDisplayText(item) ?? item);
  const heroSourceTarget = Math.max(joinedCount, availableCount);
  const activeRebalanceLabel = getCadenceLabel(rebalanceFrequency);
  const activeRebalanceShortLabel = activeRebalanceLabel.replace('再平衡', '');
  const primaryCorrelationInsight = correlationInsights[0] ?? null;
  const correlationReminderText = primaryCorrelationInsight
    ? `${primaryCorrelationInsight.leftLabel} 与 ${primaryCorrelationInsight.rightLabel} ${getCorrelationPairLabel(primaryCorrelationInsight.correlation)}，是当前最主要的相关性风险来源。`
    : '当前结构暂无显著相关性警报。';
  const maintenanceJudgementText = cashWeight > 0
    ? `现金腿 ${cashWeight.toFixed(1)}% 可覆盖${activeRebalanceShortLabel}维护成本，预计 ${displayMaintenanceCostBps} bps。`
    : `${activeRebalanceLabel}需要补齐现金缓冲后再保存正式组合。`;

  return (
    <div
      className="composition-workbench-page stack"
      data-page-root="composition-workbench"
      data-route-root="compositions"
    >
      <section className="composition-workbench-hero">
        <div className="composition-workbench-hero__copy">
          <p className="page-heading__eyebrow">组合工作台</p>
          <h1>{compositionHeading}</h1>
          <p>通过来源库读取已验证的策略腿、资产腿与现金腿，在同一工作台完成权重、再平衡与结构诊断。</p>
        </div>
        <div className="composition-workbench-hero__actions">
          <button className="ghost-button" onClick={() => navigateTo('/compositions')} type="button">
            返回
          </button>
          <button
            aria-label="顶部保存草稿"
            className="ghost-button"
            disabled={saving || selectedLegs.length === 0}
            onClick={() => {
              void onPersist('DRAFT');
            }}
            type="button"
          >
            保存草稿
          </button>
          <button
            aria-label="顶部保存组合"
            className="primary-button"
            disabled={saving || selectedLegs.length === 0}
            onClick={() => {
              void onPersist('ACTIVE');
            }}
            type="button"
          >
            {saving ? '保存中…' : canUpgradeVersions ? '一键升级版本' : '保存组合'}
          </button>
        </div>
        <div className="composition-workbench-hero__chips">
          <span className="composition-workbench-chip composition-workbench-chip--accent">
            来源 {joinedCount} / {Math.max(joinedCount, heroSourceTarget)} 可用
          </span>
          <span className="composition-workbench-chip">{getCadenceLabel(rebalanceFrequency)}</span>
          <span className="composition-workbench-chip">
            基准 {resolvedBenchmarkLabel}
          </span>
          {statusLabel ? (
            <span className="composition-workbench-chip composition-workbench-chip--draft">{statusLabel}</span>
          ) : null}
          {previewLoading ? (
            <span className="composition-workbench-chip">收益流预演更新中</span>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      <div className="composition-workbench-main-grid">
        <section className="panel composition-workbench-panel composition-workbench-source-panel">
          <div className="panel-header composition-workbench-panel__header">
            <div>
              <h2>来源库</h2>
              <p className="composition-workbench-panel__copy">
                按相关性、收益特征与来源状态筛选候选腿，控制重复暴露并优化组合分散度。
              </p>
            </div>
            <span className="status-chip status-chip--soft">
              {rows.length} 条来源
            </span>
          </div>

          <div className="composition-workbench-toolbar">
            <div className="composition-workbench-filter-row" role="tablist" aria-label="来源类型">
              {(
                [
                  { key: 'all', label: '全部' },
                  { key: 'strategy', label: '策略腿' },
                  { key: 'asset', label: '资产腿' },
                  { key: 'cash', label: '现金腿' },
                ] as Array<{ key: SourceFilter; label: string }>
              ).map((item) => (
                <button
                  aria-selected={activeType === item.key}
                  className={activeType === item.key ? 'composition-workbench-filter composition-workbench-filter--active' : 'composition-workbench-filter'}
                  key={item.key}
                  onClick={() => setActiveType(item.key)}
                  role="tab"
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <input
              aria-label="搜索来源库"
              className="composition-workbench-search"
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="搜索名称、来源状态、回测 ID、属性标签或快照字段..."
              value={searchValue}
            />
          </div>

          <div className="composition-workbench-source-scroll composition-workbench-source-scroll--four-cards" aria-label="来源库候选策略滚动区" role="region">
            <div className="composition-workbench-source-list">
              {loading ? (
                <div className="composition-workbench-empty">正在加载来源库…</div>
              ) : filteredRows.length === 0 ? (
                <div className="composition-workbench-empty">当前筛选下没有可加入的来源。</div>
              ) : (
                filteredRows.map((row) => {
                  const added = addedSourceIds.has(row.source_ref_id ?? row.id);
                  const rowDisplayName = getInventoryRowCardTitle(row);
                  const rowFeatureChips = getInventoryRowFeatureChips(row, added, rebalanceFrequency);
                  const rowDescription = getInventoryRowDescription(row, added, rebalanceFrequency, selectedLegs);
                  const rowTagLabels = getInventoryRowMetricTagLabels(row);
                  const returnQualityBadge = getReturnQualityBadge(getRowReturnQuality(row, returnQualityLookup));
                  return (
                    <article className={added ? 'composition-workbench-source-card is-added' : 'composition-workbench-source-card'} key={row.id}>
                      <div className="composition-workbench-source-card__top">
                        <strong>{rowDisplayName}</strong>
                        <button
                          className={added ? 'ghost-button composition-workbench-add-button is-added' : 'ghost-button composition-workbench-add-button'}
                          disabled={added}
                          onClick={() => onAddLeg(row)}
                          type="button"
                        >
                          {added ? '已加入' : '加入结构'}
                        </button>
                      </div>
                      <div className="composition-workbench-source-card__chips">
                        {rowFeatureChips.map((chip) => (
                          <span className={chip === getLegTypeLabel(row.leg_type) ? getLegTypeClassName(row.leg_type) : 'composition-workbench-chip'} key={chip}>
                            {chip}
                          </span>
                        ))}
                        {returnQualityBadge ? (
                          <span className={returnQualityBadge.className}>{returnQualityBadge.label}</span>
                        ) : null}
                      </div>
                      <p className="composition-workbench-source-card__intro">{rowDescription}</p>
                      {returnQualityBadge ? (
                        <div className="composition-workbench-source-quality" data-ui="workbench-source-return-quality">
                          <strong>问题腿预检</strong>
                          <span>{returnQualityBadge.detail}</span>
                        </div>
                      ) : null}
                      <div className="composition-workbench-source-card__tags">
                        {rowTagLabels.map((tag) => (
                          <span className="composition-workbench-chip" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="panel composition-workbench-panel">
          <div className="panel-header composition-workbench-panel__header">
            <div>
              <h2>组合结构</h2>
              <p className="composition-workbench-panel__copy">
                观察权重分布、风险贡献与相关性预警，判断组合是否存在隐性集中暴露。
              </p>
            </div>
            <span className="status-chip status-chip--soft">
              共 {selectedLegs.length} 条腿
            </span>
          </div>

          <article className="composition-workbench-config-panel" aria-label="组合基础信息">
            <div className="composition-workbench-config-panel__copy">
              <strong>组合基础信息</strong>
              <span>保存前确认名称、描述与基准口径，诊断 rail 保持专注于结构复核。</span>
            </div>
            <div className="composition-workbench-config-grid">
              <label className="composition-workbench-field composition-workbench-config-field">
                <span>组合名称</span>
                <input
                  onChange={(event) => onCompositionNameChange(event.target.value)}
                  placeholder="例如：平衡收益组合"
                  value={compositionName}
                />
              </label>

              <label className="composition-workbench-field composition-workbench-config-field">
                <span>组合描述</span>
                <input
                  onChange={(event) => onDescriptionChange(event.target.value)}
                  placeholder="概括来源构成、再平衡节奏与账户目标。"
                  value={description}
                />
              </label>

              <label className="composition-workbench-field composition-workbench-benchmark-field composition-workbench-config-field">
                <span>基准说明</span>
                <input
                  onChange={(event) => onBenchmarkLabelChange(event.target.value)}
                  placeholder="例如：60/40 参考组合"
                  value={benchmarkLabel}
                />
              </label>
            </div>
          </article>

          <div className="composition-workbench-allocation-box">
            <div className="composition-workbench-allocation-box__header">
              <div>
                <h3>当前结构总览</h3>
                <p className="composition-workbench-panel__copy">
                  汇总总权重、锁定权重与现金占比，为再分配和再平衡设置提供基准。
                </p>
              </div>
              <span className={previewWeightSummary?.within_tolerance ? 'status-chip status-chip--success' : 'status-chip status-chip--danger'}>
                {previewWeightSummary?.within_tolerance ? '权重闭合' : '待调权重'}
              </span>
            </div>
            <div className="composition-workbench-allocation-track" aria-hidden="true">
              {typeWeightSummary.map((item) => (
                <span
                  className={`composition-workbench-allocation-track__fill composition-workbench-allocation-track__fill--${item.kind}`}
                  key={item.kind}
                  style={{ width: `${Math.min(Math.max(item.total, 0), 100)}%` }}
                />
              ))}
            </div>
            <div className="composition-workbench-allocation-legend" aria-label="当前结构比例图标注">
              {typeWeightSummary.map((item) => (
                <span
                  className={`composition-workbench-legend-tag composition-workbench-legend-tag--${item.kind}`}
                  key={item.kind}
                >
                  {item.label} {item.total.toFixed(1)}%
                </span>
              ))}
            </div>
            <div className="composition-workbench-hero__chips composition-workbench-hero__chips--tight">
              <span className="composition-workbench-chip">总权重 {totalWeight.toFixed(1)}%</span>
              <span className="composition-workbench-chip">锁定 {lockedWeight.toFixed(1)}%</span>
              <span className="composition-workbench-chip">现金 {cashWeight.toFixed(1)}%</span>
              <span className={residualIsUnbalanced ? 'composition-workbench-chip composition-workbench-chip--danger composition-workbench-chip--priority' : 'composition-workbench-chip'}>
                残余 {residualWeight.toFixed(1)}%
              </span>
              <span className={maintenanceCostElevated ? 'composition-workbench-chip composition-workbench-chip--danger' : 'composition-workbench-chip'}>
                维护成本 {displayMaintenanceCostBps} bps
              </span>
            </div>
          </div>

          <div className="composition-workbench-structure-list">
            {selectedPreviewLegs.length === 0 ? (
              <div className="composition-workbench-empty">
                先从左侧来源库加入至少一条腿，再开始配置权重与维护节奏。
              </div>
            ) : (
              selectedPreviewLegs.map(({ draft, preview: previewLeg }) => {
                const previewLegName = getPreviewLegDisplayName(previewLeg, draft);
                const previewLegProof = getPreviewLegProofText(previewLeg, draft);
                const returnQualityBadge = getReturnQualityBadge(
                  getDraftReturnQuality(draft, previewLeg, returnQualityLookup),
                );
                const riskContribution =
                  riskContributionMap.get(previewLeg?.id ?? '') ??
                  riskContributionMap.get(previewLegName) ??
                  0;
                const correlationAlert = correlationInsights.find((item) =>
                  item.key.includes(previewLeg?.id ?? draft.source_ref_id),
                );
                const highlighted =
                  highlightedPair &&
                  highlightedPair.includes(previewLeg?.id ?? draft.source_ref_id);
                const riskIsElevated = riskContribution >= clampWeight(draft.weight_pct) * 1.2;
                const legCardClassName = [
                  'composition-workbench-leg-card',
                  highlighted ? 'is-highlighted' : '',
                  draft.weight_locked ? 'composition-workbench-leg-card--focus' : '',
                  riskIsElevated ? 'composition-workbench-leg-card--pulse' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <article
                    className={legCardClassName}
                    key={draft.source_ref_id}
                  >
                    <div className="composition-workbench-leg-card__top">
                      <div>
                        <div className="composition-workbench-source-card__chips">
                          <span className={getLegTypeClassName(draft.leg_kind)}>
                            {getLegTypeLabel(draft.leg_kind)}
                          </span>
                          {previewLeg ? (
                            <span className="composition-workbench-chip">
                              {formatCompositionStatusLabel(previewLeg.status, previewLeg.status_label)}
                            </span>
                          ) : null}
                          {returnQualityBadge ? (
                            <span className={returnQualityBadge.className}>{returnQualityBadge.label}</span>
                          ) : null}
                        </div>
                        <strong>{previewLegName}</strong>
                        <p>
                          {previewLegProof || '等待收益流预演'}
                          {correlationAlert ? ` · ${getCorrelationPairLabel(correlationAlert.correlation)}` : ''}
                        </p>
                        {returnQualityBadge ? (
                          <small className="composition-workbench-leg-quality" data-ui="workbench-selected-return-quality">
                            {returnQualityBadge.detail}
                          </small>
                        ) : null}
                      </div>
                      <div className="composition-workbench-leg-card__actions">
                        <button
                          className={draft.weight_locked ? 'ghost-button composition-workbench-lock composition-workbench-lock--active' : 'ghost-button composition-workbench-lock'}
                          onClick={() => onToggleLock(draft.source_ref_id)}
                          type="button"
                        >
                          {draft.weight_locked ? '解锁权重' : '锁定权重'}
                        </button>
                        <button
                          className="ghost-button composition-workbench-remove"
                          onClick={() => onRemoveLeg(draft.source_ref_id)}
                          type="button"
                        >
                          移除
                        </button>
                      </div>
                    </div>

                    <div className="composition-workbench-weight-box">
                      <div className="composition-workbench-weight-box__head">
                        <span>当前权重</span>
                        <strong>{clampWeight(draft.weight_pct).toFixed(1)}%</strong>
                      </div>
                      <div className="composition-workbench-weight-box__subrow">
                        <span>{draft.weight_locked ? '锁定后其余腿自动再分配' : '动态分配中'}</span>
                        <span>{draft.weight_locked ? '锁定权重' : '可调整'}</span>
                      </div>
                      <label className="composition-workbench-weight-track">
                        <span className="composition-workbench-sr-only">当前权重</span>
                        <input
                          max={100}
                          min={0}
                          onChange={(event) => onWeightChange(draft.source_ref_id, Number(event.target.value))}
                          step={0.5}
                          type="range"
                          value={clampWeight(draft.weight_pct)}
                        />
                        <span
                          className={`composition-workbench-weight-track__fill composition-workbench-weight-track__fill--${draft.leg_kind}`}
                          style={{ width: `${Math.min(clampWeight(draft.weight_pct), 100)}%` }}
                        />
                      </label>
                      <div className="composition-workbench-weight-box__risk-row">
                        <span>风险贡献 {riskContribution.toFixed(1)}%</span>
                        <span>{getRiskContributionLabel(clampWeight(draft.weight_pct), riskContribution)}</span>
                      </div>
                      <div className={riskIsElevated ? 'composition-workbench-risk-bar' : 'composition-workbench-risk-bar composition-workbench-risk-bar--low'}>
                        <span
                          className={riskContribution >= clampWeight(draft.weight_pct) * 1.35 ? 'composition-workbench-risk-bar__fill composition-workbench-risk-bar__fill--warning' : 'composition-workbench-risk-bar__fill'}
                          style={{ width: `${Math.min(Math.max(riskContribution, 4), 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="composition-workbench-weight-row">
                      <label className="composition-workbench-field composition-workbench-field--weight">
                        <span>权重</span>
                        <input
                          max={100}
                          min={0}
                          onChange={(event) => onWeightChange(draft.source_ref_id, Number(event.target.value))}
                          step={0.5}
                          type="range"
                          value={clampWeight(draft.weight_pct)}
                        />
                      </label>
                      <label className="composition-workbench-field composition-workbench-field--compact">
                        <span>输入</span>
                        <input
                          max={100}
                          min={0}
                          onChange={(event) => onWeightChange(draft.source_ref_id, Number(event.target.value))}
                          step={0.5}
                          type="number"
                          value={clampWeight(draft.weight_pct)}
                        />
                      </label>
                    </div>

                    <div className="composition-workbench-risk-row">
                      <div className="composition-workbench-risk-row__copy">
                        <span>风险贡献</span>
                        <strong>{riskContribution.toFixed(1)}%</strong>
                        <small>{getRiskContributionLabel(clampWeight(draft.weight_pct), riskContribution)}</small>
                      </div>
                      <div className="composition-workbench-risk-bar">
                        <span
                          className={riskContribution >= clampWeight(draft.weight_pct) * 1.35 ? 'composition-workbench-risk-bar__fill composition-workbench-risk-bar__fill--warning' : 'composition-workbench-risk-bar__fill'}
                          style={{ width: `${Math.min(Math.max(riskContribution, 4), 100)}%` }}
                        />
                      </div>
                    </div>

                    {previewLeg && previewLeg.attribute_tags.length ? (
                      <div className="composition-workbench-source-card__tags">
                        {previewLeg.attribute_tags.slice(0, 4).map((tag) => (
                          <span className="composition-workbench-chip" key={tag}>
                            {formatTagLabel(tag)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </section>

        <aside className="panel composition-workbench-summary-rail">
          <div className="panel-header composition-workbench-panel__header">
            <div>
              <h2>摘要与诊断</h2>
              <p className="composition-workbench-panel__copy">
                集中呈现成立性、相关性与维护成本判断，作为正式保存前的最终复核区。
              </p>
            </div>
          </div>

          <article className="composition-workbench-score composition-workbench-score-card">
            <div className="panel-header composition-workbench-score-card__header">
              <div>
                <h3>成立性评分</h3>
                <p className="composition-workbench-panel__copy">
                  评分覆盖分散度、来源可信度、成本控制与收益增强，用于衡量当前结构的可落地性。
                </p>
              </div>
            </div>
            <div className="composition-workbench-score-card__hero">
              <button
                className="composition-workbench-score-ring score-ring score-ring--interactive"
                onClick={() => setScoreOpen((current) => !current)}
                style={scoreRingStyle}
                type="button"
              >
                <strong>{formatRatio(scoreValue)}</strong>
              </button>
              <div className="composition-workbench-score-card__chips">
                <span className="composition-workbench-chip composition-workbench-chip--accent">{previewVerdict}</span>
                {preview ? (
                  <span className="composition-workbench-chip">
                    <WorkbenchTermLabel label="收益流" help={WORKBENCH_TERM_HELP.returnStream} /> {returnQualityStatusText}
                  </span>
                ) : null}
                <span className={maintenanceCostElevated ? 'composition-workbench-chip composition-workbench-chip--danger' : 'composition-workbench-chip'}>
                  维护成本 {displayMaintenanceCostBps} bps
                </span>
              </div>
            </div>
            <span className="composition-workbench-score-footnote">
              基于最近 24 个月收益流代理与当前
              <WorkbenchTermLabel label="协方差矩阵" help={WORKBENCH_TERM_HELP.covarianceMatrix} />
              计算。
            </span>
          </article>

          {scoreOpen && hasSelectedLegs ? (
            <article className="composition-workbench-radar-card">
              <div className="composition-workbench-radar-card__head">
                <strong>评分拆解</strong>
                <span>评分拆解显示分散度与收益增强是当前主要扣分项。</span>
              </div>
              <div className="composition-workbench-radar-layout">
                <svg className="composition-workbench-radar-svg" viewBox="0 0 100 100" aria-label="成立性评分五边形图">
                  <polygon
                    className="composition-workbench-radar-axis"
                    points={getRadarAxisPoints()}
                  />
                  {RADAR_AXIS_LABELS.map((_, index) => {
                    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / RADAR_AXIS_LABELS.length;
                    return (
                      <line
                        className="composition-workbench-radar-line"
                        key={`axis-${index}`}
                        x1="50"
                        x2={(50 + Math.cos(angle) * 42).toFixed(2)}
                        y1="50"
                        y2={(50 + Math.sin(angle) * 42).toFixed(2)}
                      />
                    );
                  })}
                  <polygon
                    className="composition-workbench-radar-fill"
                    points={getRadarPoints(radarFactors.map((factor) => factor.score))}
                  />
                </svg>
                <div className="composition-workbench-radar-list">
                  {radarFactors.map((factor) => (
                    <div className="composition-workbench-radar-item" key={factor.label}>
                      <span>{factor.label}</span>
                      <strong>{formatRatio(factor.score)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ) : scoreOpen ? (
            <div className="composition-workbench-empty composition-workbench-empty--compact">
              加入至少一条腿后生成评分拆解。
            </div>
          ) : null}

          <article className="composition-workbench-summary-card composition-workbench-rebalance-card">
            <div className="panel-header composition-workbench-panel__header">
              <div>
                <h3>再平衡频次</h3>
                <p className="composition-workbench-panel__copy">
                  不同频次对应不同换手成本与现金缓冲需求，用于评估维护节奏是否匹配当前组合。
                </p>
              </div>
            </div>
            <div className="composition-workbench-filter-row composition-workbench-rebalance-options" role="group" aria-label="再平衡频次">
              {REBALANCE_OPTIONS.map((item) => (
                <button
                  aria-pressed={rebalanceFrequency === item.value}
                  className={rebalanceFrequency === item.value ? 'composition-workbench-filter composition-workbench-filter--active' : 'composition-workbench-filter'}
                  key={item.value}
                  onClick={() => onRebalanceFrequencyChange(item.value)}
                  type="button"
                >
                  {item.label.replace('再平衡', '')}
                </button>
              ))}
            </div>
            <span className={maintenanceCostElevated ? 'composition-workbench-score-footnote composition-workbench-score-footnote--danger' : 'composition-workbench-score-footnote'}>
              当前采用{activeRebalanceLabel}，预计维护成本 {displayMaintenanceCostBps} bps，现金腿可承接当前换手。
            </span>
            <div
              className="composition-workbench-inline-trust-strip"
              aria-label="真实调仓事件预览"
              data-ui="rebalance-events-preview"
            >
              <span>
                <WorkbenchTermLabel label="调仓事件" help={WORKBENCH_TERM_HELP.rebalanceEvent} />
              </span>
              <strong>{rebalanceEventSummaryText}</strong>
              <span>
                {rebalanceEvents[0]
                  ? `首个事件 ${rebalanceEvents[0].date ?? rebalanceEvents[0].label} · 现金缓冲 ${rebalanceEvents[0].cash_buffer_pct.toFixed(1)}%`
                  : '预演生成后显示换手、成本与现金缓冲影响。'}
              </span>
            </div>
          </article>

          <article className="composition-workbench-summary-card composition-workbench-summary-lines" aria-label="摘要区字段">
            <div className="composition-workbench-summary-line">
              <span>当前权重合计</span>
              <strong>{totalWeight.toFixed(1)}%</strong>
            </div>
            <div className="composition-workbench-summary-line">
              <span>锁定权重</span>
              <strong>{lockedWeight.toFixed(1)}%</strong>
            </div>
            <div className={residualIsUnbalanced ? 'composition-workbench-summary-line composition-workbench-summary-line--danger' : 'composition-workbench-summary-line'}>
              <span>残余权重</span>
              <strong>{residualWeight.toFixed(1)}%</strong>
            </div>
            <div className={maintenanceCostElevated ? 'composition-workbench-summary-line composition-workbench-summary-line--danger' : 'composition-workbench-summary-line'}>
              <span>预计维护成本</span>
              <strong>{displayMaintenanceCostBps} bps</strong>
            </div>
            <div className="composition-workbench-summary-line">
              <span>现金占比</span>
              <strong>{cashWeight.toFixed(1)}%</strong>
            </div>
            {preview ? (
              <>
                <div className="composition-workbench-summary-line" data-ui="return-quality-summary">
                  <span><WorkbenchTermLabel label="收益质量" help={WORKBENCH_TERM_HELP.returnQuality} /></span>
                  <strong>{returnQualityStatusText}</strong>
                </div>
                <div className="composition-workbench-summary-line">
                  <span><WorkbenchTermLabel label="净收益预估" help={WORKBENCH_TERM_HELP.netReturn} /></span>
                  <strong>{netReturnPct.toFixed(2)}%</strong>
                </div>
                <div className={sourceDriftCount ? 'composition-workbench-summary-line composition-workbench-summary-line--warning' : 'composition-workbench-summary-line'} data-ui="source-integrity">
                  <span><WorkbenchTermLabel label="来源签名" help={WORKBENCH_TERM_HELP.sourceSignature} /></span>
                  <strong>{sourceIntegrityStatusText}</strong>
                </div>
                <div className="composition-workbench-trust-breakdown-label">
                  <WorkbenchTermLabel label="净收益拆解" help={WORKBENCH_TERM_HELP.netBreakdown} />
                </div>
                <div
                  className="composition-workbench-trust-breakdown composition-workbench-trust-breakdown--compact"
                  aria-label="净收益拆解"
                  data-ui="net-return-breakdown"
                >
                  <span>毛收益 <strong>{grossReturnPct.toFixed(2)}%</strong></span>
                  <span>维护成本 <strong>-{maintenanceDragPct.toFixed(2)}%</strong></span>
                  <span>滑点 <strong>-{slippageDragPct.toFixed(2)}%</strong></span>
                  <span>调仓损耗 <strong>-{rebalanceDragPct.toFixed(2)}%</strong></span>
                  <span>现金缓冲 <strong>-{cashDragPct.toFixed(2)}%</strong></span>
                </div>
              </>
            ) : null}
          </article>

          <div className="composition-workbench-warning-list">
            {primaryCorrelationInsight ? (
              <button
                className="composition-workbench-warning-item composition-workbench-warning-item--interactive"
                onClick={() => setHighlightedPair((current) => (current === primaryCorrelationInsight.key ? null : primaryCorrelationInsight.key))}
                type="button"
              >
                <strong>相关性提醒</strong>
                <span>{correlationReminderText}</span>
              </button>
            ) : (
              <div className="composition-workbench-warning-item">
                <strong>相关性提醒</strong>
                <span>{correlationReminderText}</span>
              </div>
            )}
            <div className="composition-workbench-warning-item">
              <strong>维护判断</strong>
              <span>{maintenanceJudgementText}</span>
            </div>
          </div>

          {(warningItems.length || advisoryItems.length) ? (
            <div className="composition-workbench-advisories">
              {warningItems.length ? (
                <article className="composition-workbench-callout composition-workbench-callout--warning">
                  <strong>风险提示</strong>
                  <ul>
                    {warningItems.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </article>
              ) : null}
              {advisoryItems.length ? (
                <article className="composition-workbench-callout">
                  <strong>组合建议</strong>
                  <ul>
                    {advisoryItems.map((advisory) => (
                      <li key={advisory}>{advisory}</li>
                    ))}
                  </ul>
                </article>
              ) : null}
            </div>
          ) : null}

          <div className="composition-workbench-save-dock composition-workbench-save-dock--module-bottom">
            <span className="composition-workbench-save-dock__note">
              保存区持续可见，便于在结构复核完成后立即提交当前组合版本。
            </span>
            <div className="composition-workbench-save-dock__actions">
              <button
                className="ghost-button"
                disabled={saving || selectedLegs.length === 0}
                onClick={() => {
                  void onPersist('DRAFT');
                }}
                type="button"
              >
                保存草稿
              </button>
              <button
                className="primary-button"
                disabled={saving || selectedLegs.length === 0}
                onClick={() => {
                  void onPersist('ACTIVE');
                }}
                type="button"
              >
                {saving ? '保存中…' : canUpgradeVersions ? '一键升级版本' : '保存组合'}
              </button>
            </div>
          </div>
        </aside>
      </div>

      <div className="composition-workbench-preview-grid">
        <section className="panel composition-workbench-panel">
          <div className="panel-header composition-workbench-panel__header">
            <div>
              <h2>
                <WorkbenchTermLabel label="收益流预览" help={WORKBENCH_TERM_HELP.returnStream} />
              </h2>
              <p className="composition-workbench-panel__copy">
                用于保存前核对组合收益路径、基准偏离与回撤段落，不替代完整绩效分析。
              </p>
            </div>
          </div>

          <div className="composition-workbench-filter-row composition-workbench-return-window-row" aria-label="收益流时间段">
            {RETURN_WINDOW_OPTIONS.map((item) => (
              <button
                aria-pressed={returnWindow === item.value}
                className={returnWindow === item.value ? 'composition-workbench-filter composition-workbench-filter--active' : 'composition-workbench-filter'}
                key={item.value}
                onClick={() => setReturnWindow(item.value)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="composition-workbench-chart-legend">
            <span>基准：{resolvedBenchmarkLabel}</span>
            <span>{drawdownAreaPath ? '回撤阴影用于识别当前结构在近期路径中的脆弱区间' : '当前收益路径暂无显著回撤阴影'}</span>
          </div>

          <div className="composition-workbench-chart-frame">
            <svg
              aria-label="组合收益流预览"
              className="composition-workbench-line-chart"
              viewBox="0 0 640 280"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="compositionWorkbenchReturnFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(31, 135, 123, 0.18)" />
                  <stop offset="100%" stopColor="rgba(31, 135, 123, 0)" />
                </linearGradient>
                <linearGradient id="compositionWorkbenchDrawdownFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(196, 92, 79, 0.18)" />
                  <stop offset="100%" stopColor="rgba(196, 92, 79, 0)" />
                </linearGradient>
              </defs>
              <line className="composition-workbench-grid-line" x1="18" x2="622" y1="248" y2="248" />
              <line className="composition-workbench-grid-line" x1="18" x2="18" y1="18" y2="248" />
              {returnsAreaPath ? (
                <path
                  className="composition-workbench-return-area"
                  d={returnsAreaPath}
                />
              ) : null}
              {drawdownAreaPath ? (
                <path
                  className="composition-workbench-drawdown-area"
                  d={drawdownAreaPath}
                />
              ) : null}
              {benchmarkPath ? (
                <path
                  className="composition-workbench-benchmark-path"
                  d={benchmarkPath}
                />
              ) : null}
              {returnsPath ? (
                <path
                  className="composition-workbench-returns-path"
                  d={returnsPath}
                />
              ) : null}
            </svg>
          </div>

          <div className="composition-workbench-legend">
            <span className="composition-workbench-legend__item composition-workbench-legend__item--strategy">
              组合累计收益
            </span>
            <span className="composition-workbench-legend__item composition-workbench-legend__item--benchmark">
              基准虚线
            </span>
            <span className="composition-workbench-legend__item composition-workbench-legend__item--drawdown">
              {drawdownAreaPath ? '回撤阴影' : '无显著回撤'}
            </span>
          </div>
        </section>

        <section className="panel composition-workbench-panel">
          <div className="panel-header composition-workbench-panel__header">
            <div>
              <h2>相关性预览</h2>
              <p className="composition-workbench-panel__copy">
                用矩阵做结构体检。腿数在 6 条以内保留数值，方便快速识别高相关或对冲关系。
              </p>
            </div>
          </div>

          {previewNormalizedLegs.length ? (
            <div className="composition-workbench-correlation-matrix">
              <div className="composition-workbench-correlation-header">
                <span />
                {previewNormalizedLegs.map((leg) => (
                  <span key={`head-${leg.id}`}>
                    {formatLegDisplayName({
                      leg_kind: leg.leg_kind,
                      display_name: leg.display_name,
                      source_ref_id: leg.source_ref_id,
                      config: leg.config,
                    })}
                  </span>
                ))}
              </div>
              {previewNormalizedLegs.map((row) => (
                <div className="composition-workbench-correlation-row" key={row.id}>
                  <span>
                    {formatLegDisplayName({
                      leg_kind: row.leg_kind,
                      display_name: row.display_name,
                      source_ref_id: row.source_ref_id,
                      config: row.config,
                    })}
                  </span>
                  {previewNormalizedLegs.map((column) => {
                    const value = correlationLookup.get(buildMatrixKey(row.id, column.id)) ?? 0;
                    const cellKey = buildMatrixKey(row.id, column.id);
                    const active = highlightedPair === cellKey;
                    return (
                      <button
                        className={`${getCorrelationToneClass(value)}${active ? ' is-active' : ''}`}
                        key={cellKey}
                        onClick={() => setHighlightedPair((current) => (current === cellKey ? null : cellKey))}
                        type="button"
                      >
                        {previewNormalizedLegs.length <= 6 ? value.toFixed(2) : ''}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="composition-workbench-empty">待预演结果返回后展示相关性矩阵。</div>
          )}
        </section>
      </div>
    </div>
  );
}
