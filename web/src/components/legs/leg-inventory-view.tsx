import { useDeferredValue, useEffect, useState } from 'react';
import { formatDateTime, formatPercent } from '../../lib/format';
import { navigateTo } from '../../lib/appRouteContext';
import {
  formatLegDisplayName,
  formatLegReferenceSummary,
} from '../../lib/compose-display';
import type {
  ApiAssetLegCreatePayload,
  ApiBondSnapshotEligibleInstrument,
  ApiCashLegCreatePayload,
  ApiLegInventory,
  ApiLegInventoryRow,
} from '../../types';
import { AssetLegDrawer, CashLegDrawer, StrategyLegDrawer } from './leg-create-drawer';
import './leg-inventory.css';

type StrategyLegUpdatePayload = {
  name: string;
  freeze_mode: string;
  notes: string | null;
  summary: Record<string, unknown>;
};

type LegInventoryViewProps = {
  inventory: ApiLegInventory | null;
  loading?: boolean;
  error?: string | null;
  onCreateAsset: (payload: ApiAssetLegCreatePayload) => Promise<void>;
  onCreateCash: (payload: ApiCashLegCreatePayload) => Promise<void>;
  onSaveStrategy: (row: ApiLegInventoryRow) => Promise<void>;
  onUpdateAsset: (id: string, payload: ApiAssetLegCreatePayload) => Promise<void>;
  onUpdateCash: (id: string, payload: ApiCashLegCreatePayload) => Promise<void>;
  onUpdateStrategy: (id: string, payload: StrategyLegUpdatePayload) => Promise<void>;
  onArchiveCandidate: (row: ApiLegInventoryRow) => Promise<void>;
  bondSourceInstruments?: ApiBondSnapshotEligibleInstrument[];
  strategyRows?: ApiLegInventoryRow[];
  focusSourceRefId?: string | null;
};

type InventoryTypeFilter = 'all' | 'strategy' | 'asset' | 'cash';
type LegStatusFilter = 'all' | 'latest_version' | 'pending_update' | 'referenced' | 'unreferenced' | 'orphan';

type PendingStrategyVersionCopy = {
  source: ApiLegInventoryRow;
  target: ApiLegInventoryRow;
};

type RowMetricPreview = {
  primary: string;
  secondary: string;
  anchor: string;
};

type PitSnapshotPreview = {
  primary: string;
  secondary: string;
};

const ASSET_VALUATION_OPTIONS = [
  { value: 'full_price', label: '全价' },
  { value: 'clean_plus_accrued', label: '净价+应计利息' },
  { value: 'ytm_reverse', label: 'YTM反算' },
] as const;

const PORTFOLIO_ROLE_OPTIONS = [
  { value: 'duration_stabilizer', label: '久期稳定器' },
  { value: 'liquidity_reserve', label: '流动性储备' },
  { value: 'inflation_hedge', label: '通胀对冲' },
  { value: 'credit_enhancement', label: '信用增强' },
] as const;

const REBALANCE_AFFINITY_OPTIONS = [
  { value: 'stable', label: '优先保留（Stable）' },
  { value: 'pro_rata', label: '按比例调整（Pro-rata）' },
  { value: 'tactical', label: '战术切换（Tactical）' },
] as const;

const MAINTENANCE_CADENCE_OPTIONS = [
  { value: 'eod_auto', label: '日终自动更新' },
  { value: 'monthly_manual', label: '月度手动核查' },
] as const;

const CASH_RULE_OPTIONS = [
  { value: 'PURE_CASH', label: '纯现金' },
  { value: 'BOXX', label: 'BOXX' },
  { value: 'T_BILL', label: 'T-BILL' },
] as const;

const CASH_REBALANCE_FREQUENCY_OPTIONS = [
  { value: 'quarterly', label: '季度' },
  { value: 'monthly', label: '月度' },
  { value: 'annual', label: '年度' },
] as const;

function getLegTypeLabel(value: string): string {
  switch (value) {
    case 'strategy':
      return '策略腿';
    case 'asset':
      return '资产腿';
    case 'cash':
      return '现金腿';
    default:
      return '腿部对象';
  }
}

function getVersionStatusBadge(row: ApiLegInventoryRow): { label: string; className: string } {
  if (row.has_new_version) {
    return { label: '有新版本', className: 'leg-inventory-status leg-inventory-status--warning' };
  }
  if (row.has_new_parameters) {
    return { label: '有新参数', className: 'leg-inventory-status leg-inventory-status--warning' };
  }
  return { label: '最新版本', className: 'leg-inventory-status leg-inventory-status--success' };
}

function getReferenceStatusBadge(row: ApiLegInventoryRow): { label: string; className: string } {
  if (row.is_orphan) {
    return { label: '孤儿腿', className: 'leg-inventory-status leg-inventory-status--danger' };
  }
  if (row.reference_count > 0) {
    return { label: '已被引用', className: 'leg-inventory-status' };
  }
  return { label: '未引用', className: 'leg-inventory-status leg-inventory-status--warning' };
}

function getReferenceSummary(row: ApiLegInventoryRow): string {
  return formatLegReferenceSummary(row.reference_summary, row.reference_count);
}

function simplifyParameterVersionLabel(strategyId: string, parameterVersionId: string): string {
  const prefixPattern = new RegExp(`^${strategyId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`, 'i');
  const shortened = parameterVersionId.replace(prefixPattern, '');
  return shortened || parameterVersionId;
}

function getStrategyIdFromParameterVersionId(parameterVersionId: string): string | null {
  const match = parameterVersionId.match(/^(.+)-v\d+$/i);
  return match?.[1] ?? null;
}

function getDisplayLegId(row: ApiLegInventoryRow): string {
  const rawId = row.source_ref_id || row.id;
  const strategyMatch = rawId.match(/^strategy_leg::([^:]+)::(.+)$/);
  if (strategyMatch) {
    const inferredStrategyId = getStrategyIdFromParameterVersionId(strategyMatch[1]);
    if (inferredStrategyId) {
      return `${inferredStrategyId} · ${simplifyParameterVersionLabel(inferredStrategyId, strategyMatch[1])}`;
    }
    return `${strategyMatch[1]} · ${simplifyParameterVersionLabel(strategyMatch[1], strategyMatch[2])}`;
  }
  if (row.leg_type === 'strategy') {
    const strategyId = typeof row.config?.strategy_id === 'string' ? row.config.strategy_id : null;
    const parameterVersionId =
      typeof row.config?.parameter_version_id === 'string' ? row.config.parameter_version_id : row.version_label;
    if (strategyId && parameterVersionId) {
      return `${strategyId} · ${simplifyParameterVersionLabel(strategyId, parameterVersionId)}`;
    }
  }
  return row.id;
}

function withEditedNotes(summary: Record<string, unknown>, notes: string): Record<string, unknown> {
  const next = { ...summary };
  const normalized = notes.trim();
  if (normalized) {
    next.notes = normalized;
  } else {
    delete next.notes;
  }
  return next;
}

function getAssetSourcePath(row: ApiLegInventoryRow): string | null {
  const snapshotId =
    typeof row.config?.source_snapshot_id === 'string'
      ? row.config.source_snapshot_id
      : null;
  const tab = String(row.config?.asset_kind ?? '').toUpperCase().includes('BOND') ? 'tab=bond&' : '';
  return snapshotId ? `/snapshots?${tab}source_snapshot_id=${encodeURIComponent(snapshotId)}` : null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getConfig(row: ApiLegInventoryRow): Record<string, unknown> {
  return getRecord(row.config);
}

function getSummary(row: ApiLegInventoryRow): Record<string, unknown> {
  return getRecord(getConfig(row).summary);
}

function getBondSnapshot(row: ApiLegInventoryRow): Record<string, unknown> {
  return getRecord(getSummary(row).bond_snapshot);
}

function readString(records: Record<string, unknown>[], keys: string[]): string | null {
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

function getSourceIntegrity(row: ApiLegInventoryRow): Record<string, unknown> {
  return getRecord(row.source_integrity) ?? getRecord(getConfig(row).source_integrity);
}

function getSourceIntegrityValue(row: ApiLegInventoryRow, key: string, fallback = 'pending'): string {
  const topLevel = row[key as keyof ApiLegInventoryRow];
  if (typeof topLevel === 'string' && topLevel.trim()) {
    return topLevel.trim();
  }
  const value = getSourceIntegrity(row)[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && value.length) {
    return value.map((item) => String(item)).join(', ');
  }
  return fallback;
}

function getDisplayedSourceRef(row: ApiLegInventoryRow): string {
  return String(row.source_ref_id ?? row.id);
}

function getSourceTrustStatusLabel(value?: string | null): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'verified':
    case 'valid':
    case 'signed':
      return '签名有效';
    case 'current':
      return '版本一致';
    case 'drifted':
    case 'version_drift':
      return '版本漂移';
    case 'stale':
      return '签名待复核';
    case 'missing':
      return '证据缺失';
    default:
      return '待确认';
  }
}

function getSourceDriftStatusLabel(row: ApiLegInventoryRow): string {
  const status = String(getSourceIntegrityValue(row, 'drift_status', 'current') ?? '').toLowerCase();
  switch (status) {
    case 'verified':
    case 'valid':
    case 'signed':
    case 'current':
      return '版本一致';
    case 'drifted':
    case 'version_drift':
    case 'stale':
      if (row.has_new_version) {
        return '版本漂移';
      }
      if (row.has_new_parameters) {
        return '参数待复核';
      }
      return '指纹待复核';
    case 'missing':
      return '证据缺失';
    default:
      return '待确认';
  }
}

function readNumber(records: Record<string, unknown>[], keys: string[]): number | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
  }
  return null;
}

function getStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const next = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return next.length > 0 ? next : fallback;
}

function canEditLeg(row: ApiLegInventoryRow): boolean {
  return row.reference_count <= 0 && row.allowed_actions.includes('edit_leg_definition');
}

function canCopyLeg(row: ApiLegInventoryRow): boolean {
  return (row.leg_type === 'asset' || row.leg_type === 'cash') && !canEditLeg(row);
}

function getRowSourceKey(row: ApiLegInventoryRow): string {
  return String(row.source_ref_id || row.id);
}

function getRowCreatedAt(row: ApiLegInventoryRow): string | null {
  const config = getConfig(row);
  const summary = getSummary(row);
  const createdAt = typeof row.created_at === 'string' && row.created_at.trim() ? row.created_at.trim() : null;
  return (
    createdAt ??
    readString([config, summary, getSourceIntegrity(row)], ['created_at', 'saved_strategy_source_frozen_at']) ??
    null
  );
}

function getRowCreatedSortTime(row: ApiLegInventoryRow): number {
  const createdAt = getRowCreatedAt(row);
  const fallback = row.updated_at ?? readString([getConfig(row), getSourceIntegrity(row)], ['updated_at', 'checked_at']);
  const parsed = Date.parse(createdAt ?? fallback ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRowCreatedAtLabel(row: ApiLegInventoryRow): string {
  const createdAt = getRowCreatedAt(row);
  return createdAt ? formatDateTime(createdAt) : '-';
}

function parseStrategyProjectionId(value: string): { strategyId: string; parameterVersionId: string; runId: string | null } | null {
  const match = value.match(/^strategy_leg::([^:]+)::(.+)$/);
  if (!match) {
    return null;
  }
  const inferredStrategyId = getStrategyIdFromParameterVersionId(match[1]);
  if (inferredStrategyId) {
    return {
      strategyId: inferredStrategyId,
      parameterVersionId: match[1],
      runId: match[2],
    };
  }
  return {
    strategyId: match[1],
    parameterVersionId: match[2],
    runId: null,
  };
}

function getStrategyId(row: ApiLegInventoryRow): string | null {
  const configStrategyId = row.config?.strategy_id;
  if (typeof configStrategyId === 'string' && configStrategyId.trim()) {
    return configStrategyId.trim();
  }
  return parseStrategyProjectionId(getRowSourceKey(row))?.strategyId ?? null;
}

function isSameRowReference(left: ApiLegInventoryRow, right: ApiLegInventoryRow): boolean {
  const leftSource = getRowSourceKey(left);
  const rightSource = getRowSourceKey(right);
  return left.id === right.id || left.id === rightSource || leftSource === right.id || leftSource === rightSource;
}

function findStrategyVersionCopyTarget(
  row: ApiLegInventoryRow,
  strategyRows: ApiLegInventoryRow[] = [],
  inventoryRows: ApiLegInventoryRow[] = [],
): ApiLegInventoryRow | null {
  if (row.leg_type !== 'strategy' || (!row.has_new_version && !row.has_new_parameters)) {
    return null;
  }
  const currentRefId = getSourceIntegrityValue(row, 'current_ref_id', '');
  const strategyId = getStrategyId(row);
  const candidates = strategyRows.filter((candidate) => candidate.leg_type === 'strategy');
  const target =
    candidates.find((candidate) => currentRefId && (candidate.id === currentRefId || candidate.source_ref_id === currentRefId)) ??
    candidates.find((candidate) => {
      return Boolean(
        strategyId &&
          getStrategyId(candidate) === strategyId &&
          !candidate.has_new_version &&
          !candidate.has_new_parameters,
      );
    }) ??
    null;
  if (!target || isSameRowReference(row, target)) {
    return null;
  }
  return inventoryRows.some((candidate) => isSameRowReference(candidate, target)) ? null : target;
}

function getStrategyVersionCopyLabel(row: ApiLegInventoryRow): string {
  const explicitLabel = String(row.version_label ?? '').trim();
  if (explicitLabel) {
    return explicitLabel;
  }
  const strategyId = getStrategyId(row);
  const parameterVersionId =
    typeof row.config?.parameter_version_id === 'string'
      ? row.config.parameter_version_id
      : parseStrategyProjectionId(getRowSourceKey(row))?.parameterVersionId ?? '';
  return strategyId && parameterVersionId
    ? simplifyParameterVersionLabel(strategyId, parameterVersionId)
    : '新版本';
}

function hasStrategyPendingUpdate(row: ApiLegInventoryRow): boolean {
  return Boolean(row.has_new_version || row.has_new_parameters);
}

function getStrategyUpdateActionLabel(row: ApiLegInventoryRow): string {
  return row.has_new_parameters ? '复制新参数' : '复制新版本';
}

function getMetricRecords(row: ApiLegInventoryRow): Record<string, unknown>[] {
  const config = getConfig(row);
  const summary = getSummary(row);
  return [getRecord(config.metrics), config, getBondSnapshot(row), summary];
}

function normalizePercentPoint(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function normalizePercentFraction(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return Math.abs(value) > 2 ? value / 100 : value;
}

function formatPctPoint(value: number | null, digits = 2): string {
  const normalized = normalizePercentPoint(value);
  return normalized === null ? 'n/a' : `${normalized.toFixed(digits)}%`;
}

function formatSignedFraction(value: number | null): string {
  return formatPercent(normalizePercentFraction(value));
}

function formatStrategyCoreParameters(
  annualized: number | null,
  drawdown: number | null,
  sharpe: number | null,
): string {
  const drawdownFraction = drawdown === null ? null : -Math.abs(normalizePercentFraction(drawdown) ?? 0);
  return [
    `年化 ${formatSignedFraction(annualized)}`,
    `回撤 ${formatSignedFraction(drawdownFraction)}`,
    sharpe === null ? '夏普 n/a' : `夏普 ${sharpe.toFixed(2)}`,
  ].join(' | ');
}

function formatSourceValue(value?: string | null): string | null {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  switch (text.toLowerCase()) {
    case 'bond':
      return '债券';
    case 'cash':
      return '现金';
    case 'manual':
      return '人工维护';
    case 'snapshot_locked':
      return '快照冻结';
    case 'target_buffer':
      return '目标缓冲';
    case 'compose_review_seed':
      return '设计稿种子';
    case 'bond_fixed_income':
    case 'bond-fixed-income':
      return '债券快照';
    case 'phase1 live smoke':
    case 'phase1_live_smoke':
      return 'Phase 1 live smoke';
    case 'phase1 live smoke cash':
    case 'phase1_live_smoke_cash':
      return 'Phase 1 live smoke cash';
    case 'ds-price':
    case 'ds_price':
      return '价格数据源';
    default:
      return text.replace(/_/g, ' ');
  }
}

function formatCostAbsorptionLabel(value?: string | null): string {
  const text = String(value ?? '').trim();
  switch (text.toLowerCase()) {
    case 'high':
      return '高';
    case 'low':
      return '低';
    case 'standard':
      return '标准';
    default:
      return text || '标准';
  }
}

function getShieldHash(value: string): string {
  const hash = Array.from(value).reduce((accumulator, char) => {
    return (accumulator * 31 + char.charCodeAt(0)) % 0xffff;
  }, 17);
  return hash.toString(16).toUpperCase().padStart(4, '0');
}

function getIdentitySubtitle(row: ApiLegInventoryRow): string {
  const records = [getConfig(row), getBondSnapshot(row), getSummary(row)];
  const symbol = readString(records, ['symbol', 'ticker', 'isin', 'cusip']);
  const fallback =
    row.leg_type === 'cash'
      ? readString(records, ['cash_rule_kind', 'yield_source'])
      : row.leg_type === 'strategy'
        ? readString(records, ['strategy_id'])
        : row.version_label;
  const subtitle = symbol ?? formatSourceValue(fallback) ?? row.source_ref_id ?? row.id;
  return `${subtitle} · #${getShieldHash(row.id)}`;
}

function getPitSnapshotPreview(row: ApiLegInventoryRow): PitSnapshotPreview {
  const records = [getBondSnapshot(row), getSummary(row), getConfig(row)];
  const date = readString(records, ['snapshot_date', 'pit_date', 'as_of_date']);
  if (date) {
    return {
      primary: date.slice(0, 10),
      secondary: row.version_label ? `PIT Date · ${row.version_label}` : 'PIT Date',
    };
  }
  if (row.leg_type === 'strategy') {
    return {
      primary: row.version_label || '版本待定',
      secondary: readString(records, ['parameter_version_id']) ?? '参数版本',
    };
  }
  if (row.leg_type === 'cash') {
    return {
      primary: formatSourceValue(row.version_label) ?? row.version_label ?? '现金规则',
      secondary: formatSourceValue(readString(records, ['freeze_mode'])) ?? '规则冻结',
    };
  }
  return {
    primary: row.version_label || row.proof_label || '快照待定',
    secondary: row.proof_label ? `来源 ${formatSourceValue(row.proof_label) ?? row.proof_label}` : 'PIT Date 待补',
  };
}

function getMetricPreview(row: ApiLegInventoryRow): RowMetricPreview {
  const records = getMetricRecords(row);
  if (row.leg_type === 'strategy') {
    const annualized = readNumber(records, ['annualized_return', 'cagr', 'oos_annualized_return', 'annualized_return_pct']);
    const drawdown = readNumber(records, ['max_drawdown', 'oos_max_drawdown', 'max_drawdown_pct']);
    const sharpe = readNumber(records, ['sharpe', 'oos_sharpe', 'out_of_sample_sharpe']);
    return {
      primary: formatStrategyCoreParameters(annualized, drawdown, sharpe),
      secondary: '核心参数',
      anchor: readString(records, ['latest_run_id', 'run_id']) ?? row.proof_label ?? '回测锚点待补',
    };
  }
  if (row.leg_type === 'asset') {
    const assetKind = String(getConfig(row).asset_kind ?? '').toUpperCase();
    const ytm = readNumber(records, ['ytm_pct', 'yield_to_maturity_pct']);
    const duration = readNumber(records, ['duration', 'duration_years']);
    const volatility = readNumber(records, ['volatility_pct', 'annualized_volatility_pct', 'annualized_volatility']);
    const totalReturn = readNumber(records, ['latest_total_return_pct', 'total_return_pct', 'total_return']);
    const primary = assetKind.includes('BOND') || ytm !== null || duration !== null
      ? `YTM ${formatPctPoint(ytm)} | 久期 ${duration === null ? 'n/a' : duration.toFixed(1)} | 波动 ${formatPctPoint(volatility ?? 0.045, 1)}`
      : `收益 ${formatPctPoint(totalReturn)} | 波动 ${formatPctPoint(volatility, 1)}`;
    return {
      primary,
      secondary:
        formatSourceValue(readString(records, ['source', 'source_provider'])) ??
        formatSourceValue(String(getConfig(row).asset_kind ?? '资产来源')) ??
        '资产来源',
      anchor:
        formatSourceValue(readString(records, ['snapshot_ref', 'source_snapshot_id', 'id'])) ??
        row.proof_label ??
        '快照锚点待补',
    };
  }
  const buffer = readNumber(records, ['buffer_bps']);
  const costAbsorption = readString(records, ['cost_absorption', 'cost_absorption_label'])
    ?? (buffer !== null && buffer <= 25 ? 'High' : 'Standard');
  return {
    primary: `缓冲 ${Math.round(buffer ?? 0)} bps | 成本吸收 ${formatCostAbsorptionLabel(costAbsorption)}`,
    secondary: formatSourceValue(readString(records, ['yield_source'])) ?? '现金收益源',
    anchor:
      formatSourceValue(readString(records, ['freeze_mode', 'cash_rule_kind'])) ??
      row.proof_label ??
      '规则锚点待补',
  };
}

function getStatusBadges(row: ApiLegInventoryRow): Array<{ label: string; className: string }> {
  return [getVersionStatusBadge(row), getReferenceStatusBadge(row)];
}

function getReturnQualityIssueTypes(row: ApiLegInventoryRow): string[] {
  return Array.isArray(row.return_quality?.issue_types)
    ? row.return_quality.issue_types.filter((issue): issue is string => typeof issue === 'string' && issue.trim().length > 0)
    : [];
}

function getReturnQualityBadge(row: ApiLegInventoryRow): { label: string; detail: string; className: string } | null {
  const issueTypes = getReturnQualityIssueTypes(row);
  if (!issueTypes.length || !row.return_quality) {
    return null;
  }
  const samplePoints = Number.isFinite(row.return_quality.sample_points) ? row.return_quality.sample_points : 0;
  const missingPoints = Number.isFinite(row.return_quality.missing_points) ? row.return_quality.missing_points : 0;
  return {
    label: issueTypes.join('、'),
    detail: `样本 ${samplePoints} 月 / 缺口 ${missingPoints}`,
    className: issueTypes.includes('收益样本缺失') ? 'leg-inventory-chip leg-inventory-chip--danger' : 'leg-inventory-chip leg-inventory-chip--warning',
  };
}

function matchesLegStatusFilter(row: ApiLegInventoryRow, filter: LegStatusFilter): boolean {
  switch (filter) {
    case 'latest_version':
      return !hasStrategyPendingUpdate(row);
    case 'pending_update':
      return hasStrategyPendingUpdate(row);
    case 'referenced':
      return !row.is_orphan && row.reference_count > 0;
    case 'unreferenced':
      return !row.is_orphan && row.reference_count <= 0;
    case 'orphan':
      return row.is_orphan;
    case 'all':
    default:
      return true;
  }
}

function getDetailNote(row: ApiLegInventoryRow): string {
  const records = getMetricRecords(row);
  const note = readString(records, ['notes', 'comment', 'memo']);
  if (note) {
    return note;
  }
  if (row.leg_type === 'asset') {
    return '资产腿来自冻结的资产快照，编辑时会保留来源证据并刷新腿部定义。';
  }
  if (row.leg_type === 'cash') {
    return '现金腿定义结算缓冲、收益来源和成本吸收规则，保存后用于后续组合装配。';
  }
  return '策略腿来自已完成回测和参数快照，参数修改请回到策略详情页。';
}

function buildSparklinePoints(row: ApiLegInventoryRow): string {
  const metrics = getMetricPreview(row);
  const seed = parseInt(getShieldHash(`${row.id}:${metrics.primary}`), 16);
  const base = row.leg_type === 'cash' ? 0.035 : row.leg_type === 'asset' ? 0.08 : 0.14;
  return Array.from({ length: 12 }, (_, index) => {
    const wave = Math.sin((seed % 17) + index * 0.8) * 0.018;
    const drift = base * (index / 11);
    const value = drift + wave;
    const x = Math.round((320 / 11) * index);
    const y = Math.round(84 - Math.max(-0.08, Math.min(0.22, value)) * 260);
    return `${x},${Math.max(18, Math.min(92, y))}`;
  }).join(' ');
}

export function LegDetailDrawer({
  copyVersionTarget,
  hideMutatingActions = false,
  onArchiveCandidate,
  onClose,
  onCopyCandidate,
  onNavigateToSource,
  onRequestCopyNewVersion,
  row,
}: {
  copyVersionTarget?: ApiLegInventoryRow | null;
  hideMutatingActions?: boolean;
  onArchiveCandidate: (row: ApiLegInventoryRow) => Promise<void>;
  onClose: () => void;
  onCopyCandidate: (row: ApiLegInventoryRow) => void;
  onNavigateToSource: (row: ApiLegInventoryRow) => void;
  onRequestCopyNewVersion: (source: ApiLegInventoryRow, target: ApiLegInventoryRow) => void;
  row: ApiLegInventoryRow;
}): JSX.Element {
  const displayName = formatLegDisplayName({
    leg_kind: row.leg_type,
    name: row.name,
    config: row.config,
    source_ref_id: row.source_ref_id,
  });
  const metrics = getMetricPreview(row);
  const pit = getPitSnapshotPreview(row);
  const sourcePath = getAssetSourcePath(row);
  const updatedAt = readString(getMetricRecords(row), ['updated_at', 'refreshed_at']);
  const returnQualityBadge = getReturnQualityBadge(row);

  return (
    <div className="leg-inventory-drawer-layer">
      <button
        aria-label="关闭抽屉"
        className="leg-inventory-drawer__overlay"
        onClick={onClose}
        type="button"
      />
      <aside aria-label="腿部详情" className="leg-inventory-drawer leg-inventory-drawer--detail" role="dialog">
        <div className="leg-inventory-drawer__header">
          <div className="leg-inventory-drawer__title">
            <div className="leg-inventory-drawer__icon">{getLegTypeLabel(row.leg_type).slice(0, 1)}</div>
            <div className="leg-inventory-drawer__copy">
              <p className="page-heading__eyebrow">来源详情 / Leg Detail</p>
              <h2>{displayName}</h2>
              <p>{getIdentitySubtitle(row)} · {getDisplayLegId(row)}</p>
            </div>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <div className="leg-inventory-drawer__body leg-inventory-drawer__body--detail">
        <div className="leg-inventory-detail-grid">
          <article className="leg-inventory-detail-card leg-inventory-detail-card--wide">
            <span>12 个月表现轨迹</span>
            <svg aria-hidden="true" className="leg-inventory-detail-sparkline" viewBox="0 0 320 104">
              <path d={`M0 96 L${buildSparklinePoints(row).replaceAll(' ', ' L')} L320 96 Z`} fill="rgba(31, 135, 123, 0.1)" />
              <polyline fill="none" points={buildSparklinePoints(row)} stroke="#1f877b" strokeWidth="4" />
            </svg>
          </article>
          <article className="leg-inventory-detail-card">
            <span>PIT 快照</span>
            <strong>{pit.primary}</strong>
            <small>{pit.secondary}</small>
          </article>
          <article className="leg-inventory-detail-card">
            <span>核心指标</span>
            <strong>{metrics.primary}</strong>
            <small>{metrics.secondary}</small>
          </article>
          {returnQualityBadge ? (
            <article className="leg-inventory-detail-card leg-inventory-detail-card--quality" data-ui="leg-return-quality">
              <span>收益样本质量</span>
              <strong>{returnQualityBadge.label}</strong>
              <small>{returnQualityBadge.detail}</small>
            </article>
          ) : null}
          <article className="leg-inventory-detail-card">
            <span>来源锚点</span>
            <strong>{metrics.anchor}</strong>
            <small>{updatedAt ? `更新 ${formatDateTime(updatedAt)}` : row.source_ref_type ?? 'source audit'}</small>
          </article>
          <article className="leg-inventory-detail-card">
            <span>引用组合数</span>
            <strong>{row.reference_count}</strong>
            <small>{getReferenceSummary(row)}</small>
          </article>
        </div>

        <section
          className="leg-inventory-drawer__section leg-inventory-drawer__trust"
          data-ui="leg-source-evidence-drawer"
        >
          <div className="leg-inventory-drawer__copy">
            <strong>来源签名</strong>
            <p>冻结证据用于组合追责；漂移提示只提醒，不自动改写已保存组合。</p>
          </div>
          <div className="leg-inventory-drawer__field-grid">
            <div className="leg-inventory-drawer__field">
              <span>冻结哈希</span>
              <strong data-ui="leg-freeze-hash">{getSourceIntegrityValue(row, 'freeze_hash')}</strong>
            </div>
            <div className="leg-inventory-drawer__field">
              <span>签名状态</span>
              <strong>{getSourceTrustStatusLabel(getSourceIntegrityValue(row, 'signature_status', 'verified'))}</strong>
            </div>
            <div className="leg-inventory-drawer__field">
              <span>漂移状态</span>
              <strong data-ui="leg-drift-status">{getSourceDriftStatusLabel(row)}</strong>
            </div>
            <div className="leg-inventory-drawer__field">
              <span>当前来源</span>
              <strong>{getDisplayedSourceRef(row)}</strong>
            </div>
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__copy">
            <strong>备注</strong>
            <p>{getDetailNote(row)}</p>
          </div>
          <div className="leg-inventory-row__tags">
            {getStatusBadges(row).map((badge) => (
              <span className={badge.className} key={badge.label}>
                {badge.label}
              </span>
            ))}
          </div>
        </section>

        <div className="leg-inventory-drawer__foot">
          {sourcePath ? (
            <button className="ghost-button" onClick={() => onNavigateToSource(row)} type="button">
              查看来源
            </button>
          ) : null}
          {!hideMutatingActions && canCopyLeg(row) ? (
            <button className="ghost-button" onClick={() => onCopyCandidate(row)} type="button">
              复制
            </button>
          ) : null}
          {!hideMutatingActions && copyVersionTarget ? (
            <button className="ghost-button" onClick={() => onRequestCopyNewVersion(row, copyVersionTarget)} type="button">
              {getStrategyUpdateActionLabel(row)}
            </button>
          ) : null}
          {!hideMutatingActions && row.reference_count <= 0 ? (
            <button className="ghost-button" onClick={() => void onArchiveCandidate(row)} type="button">
              归档
            </button>
          ) : null}
        </div>
        </div>
      </aside>
    </div>
  );
}

function LegEditDrawer({
  onClose,
  onUpdateAsset,
  onUpdateCash,
  onUpdateStrategy,
  row,
}: {
  onClose: () => void;
  onUpdateAsset: (id: string, payload: ApiAssetLegCreatePayload) => Promise<void>;
  onUpdateCash: (id: string, payload: ApiCashLegCreatePayload) => Promise<void>;
  onUpdateStrategy: (id: string, payload: StrategyLegUpdatePayload) => Promise<void>;
  row: ApiLegInventoryRow;
}): JSX.Element {
  const displayName = formatLegDisplayName({
    leg_kind: row.leg_type,
    name: row.name,
    config: row.config,
    source_ref_id: row.source_ref_id,
  });
  const pit = getPitSnapshotPreview(row);
  const metrics = getMetricPreview(row);
  const summary = getSummary(row);
  const config = getConfig(row);
  const initialNotes = readString([summary, config], ['notes', 'comment', 'memo']) ?? '';
  const [name, setName] = useState(row.name || displayName);
  const [symbol, setSymbol] = useState(readString([config], ['symbol', 'ticker']) ?? row.version_label ?? '');
  const [assetKind, setAssetKind] = useState(String(config.asset_kind ?? 'BOND'));
  const [sourceSnapshotId, setSourceSnapshotId] = useState(
    readString([config], ['source_snapshot_id', 'snapshot_ref']) ?? row.proof_label ?? '',
  );
  const [sourceProvider, setSourceProvider] = useState(readString([config], ['source_provider', 'source']) ?? '');
  const [valuationBasis, setValuationBasis] = useState(readString([summary], ['valuation_basis']) ?? 'clean_plus_accrued');
  const [portfolioRoles, setPortfolioRoles] = useState(getStringArray(summary.portfolio_roles, ['duration_stabilizer']));
  const [rebalanceAffinity, setRebalanceAffinity] = useState(readString([summary], ['rebalance_affinity']) ?? 'stable');
  const [maintenanceCadence, setMaintenanceCadence] = useState(readString([summary], ['maintenance_cadence']) ?? 'eod_auto');
  const [cashRuleKind, setCashRuleKind] = useState(readString([config], ['cash_rule_kind']) ?? row.version_label ?? 'PURE_CASH');
  const [bufferBps, setBufferBps] = useState(String(readNumber([config], ['buffer_bps']) ?? 0));
  const [targetWeightPct, setTargetWeightPct] = useState(String(readNumber([summary], ['target_weight_pct']) ?? 20));
  const [rebalanceFrequency, setRebalanceFrequency] = useState(readString([summary], ['rebalance_frequency']) ?? 'quarterly');
  const [yieldSource, setYieldSource] = useState(readString([config], ['yield_source']) ?? 'phase1_cash_proxy');
  const [freezeMode, setFreezeMode] = useState(readString([config], ['freeze_mode']) ?? 'snapshot_locked');
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const displayId = getDisplayLegId(row);
  const editable = row.leg_type === 'strategy' || canEditLeg(row);

  function togglePortfolioRole(role: string): void {
    setPortfolioRoles((current) => {
      const next = current.includes(role)
        ? current.filter((item) => item !== role)
        : [...current, role];
      return next.length > 0 ? next : ['duration_stabilizer'];
    });
  }

  async function handleSave(): Promise<void> {
    if (!editable) {
      setFormError('策略腿来自策略快照，请到策略详情页修改参数。');
      return;
    }
    const trimmedName = name.trim();
    const trimmedFreezeMode = freezeMode.trim();
    if (!trimmedName || !trimmedFreezeMode) {
      setFormError('腿部名称和冻结方式不能为空。');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (row.leg_type === 'asset') {
        const payload: ApiAssetLegCreatePayload = {
          name: trimmedName,
          symbol: symbol.trim(),
          asset_kind: assetKind.trim(),
          source_snapshot_id: sourceSnapshotId.trim(),
          source_provider: sourceProvider.trim() || null,
          freeze_mode: trimmedFreezeMode,
          notes: notes.trim() || null,
          summary: {
            ...withEditedNotes(summary, notes),
            valuation_basis: valuationBasis,
            portfolio_roles: portfolioRoles,
            rebalance_affinity: rebalanceAffinity,
            maintenance_cadence: maintenanceCadence,
          },
        };
        if (!payload.symbol || !payload.asset_kind || !payload.source_snapshot_id) {
          setFormError('资产腿需要填写代码、资产类型和来源快照。');
          return;
        }
        await onUpdateAsset(row.id, payload);
      } else if (row.leg_type === 'cash') {
        const parsedBuffer = Number(bufferBps);
        const parsedTargetWeight = Number(targetWeightPct);
        const payload: ApiCashLegCreatePayload = {
          name: trimmedName,
          cash_rule_kind: cashRuleKind.trim().toUpperCase().replace('-', '_'),
          buffer_bps: Number.isFinite(parsedBuffer) ? parsedBuffer : 0,
          yield_source: yieldSource.trim() || null,
          freeze_mode: trimmedFreezeMode,
          notes: notes.trim() || null,
          summary: {
            ...withEditedNotes(summary, notes),
            target_weight_pct: Number.isFinite(parsedTargetWeight) ? parsedTargetWeight : 20,
            rebalance_frequency: rebalanceFrequency,
          },
        };
        if (!payload.cash_rule_kind) {
          setFormError('现金腿需要填写规则类型。');
          return;
        }
        await onUpdateCash(row.id, payload);
      } else {
        await onUpdateStrategy(row.id, {
          name: trimmedName,
          freeze_mode: trimmedFreezeMode,
          notes: notes.trim() || null,
          summary: withEditedNotes(summary, notes),
        });
      }
      onClose();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="leg-inventory-drawer-layer">
      <button
        aria-label="关闭编辑抽屉"
        className="leg-inventory-drawer__overlay"
        onClick={onClose}
        type="button"
      />
      <aside aria-label="编辑腿部定义" className="leg-inventory-drawer" role="dialog">
        <div className="leg-inventory-drawer__header">
          <div className="leg-inventory-drawer__title">
            <div className="leg-inventory-drawer__icon">编</div>
            <div className="leg-inventory-drawer__copy">
              <p className="page-heading__eyebrow">腿部清单 / 编辑</p>
              <h2>编辑{getLegTypeLabel(row.leg_type)}</h2>
              <p>调整腿部名称、来源参数和备注，保存后会刷新当前腿部清单。</p>
            </div>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <div className="leg-inventory-drawer__body" data-drawer-kind="edit">
          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__copy">
              <strong>基础信息</strong>
              <p>{editable ? '这些字段会写回本地腿部定义。' : '策略腿是回测快照投影，不能在资产库里直接改参数。'}</p>
            </div>
            <div className="leg-inventory-drawer__field-grid">
              <div className="leg-inventory-drawer__field">
                <label htmlFor="leg-edit-name">腿部名称</label>
                <input id="leg-edit-name" onChange={(event) => setName(event.target.value)} readOnly={!editable} value={name} />
              </div>
              <div className="leg-inventory-drawer__field">
                <label htmlFor="leg-edit-id">腿部 ID</label>
                <input id="leg-edit-id" readOnly value={displayId} />
              </div>
              <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
                <label htmlFor="leg-edit-pit">PIT 快照</label>
                <input id="leg-edit-pit" readOnly value={`${pit.primary} / ${pit.secondary}`} />
              </div>
            </div>
          </section>

          {row.leg_type === 'asset' ? (
            <section className="leg-inventory-drawer__section">
              <div className="leg-inventory-drawer__copy">
                <strong>资产腿参数</strong>
                <p>代码、资产类型和来源快照会参与后续组合来源解析。</p>
              </div>
              <div className="leg-inventory-drawer__field-grid">
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-symbol">代码</label>
                  <input id="leg-edit-symbol" onChange={(event) => setSymbol(event.target.value)} value={symbol} />
                </div>
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-asset-kind">资产类型</label>
                  <input id="leg-edit-asset-kind" onChange={(event) => setAssetKind(event.target.value)} value={assetKind} />
                </div>
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-source-snapshot">来源快照</label>
                  <input id="leg-edit-source-snapshot" onChange={(event) => setSourceSnapshotId(event.target.value)} value={sourceSnapshotId} />
                </div>
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-source-provider">来源提供方</label>
                  <input id="leg-edit-source-provider" onChange={(event) => setSourceProvider(event.target.value)} value={sourceProvider} />
                </div>
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-valuation-basis">估值口径</label>
                  <select
                    id="leg-edit-valuation-basis"
                    onChange={(event) => setValuationBasis(event.target.value)}
                    value={valuationBasis}
                  >
                    {ASSET_VALUATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-rebalance-affinity">再平衡亲和度</label>
                  <select
                    id="leg-edit-rebalance-affinity"
                    onChange={(event) => setRebalanceAffinity(event.target.value)}
                    value={rebalanceAffinity}
                  >
                    {REBALANCE_AFFINITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-maintenance-cadence">维护与回看节奏</label>
                  <select
                    id="leg-edit-maintenance-cadence"
                    onChange={(event) => setMaintenanceCadence(event.target.value)}
                    value={maintenanceCadence}
                  >
                    {MAINTENANCE_CADENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset className="leg-inventory-drawer__field leg-inventory-drawer__field--full leg-inventory-drawer__role-field">
                  <legend>组合角色</legend>
                  <div className="leg-inventory-drawer__role-grid">
                    {PORTFOLIO_ROLE_OPTIONS.map((option) => (
                      <label key={option.value}>
                        <input
                          checked={portfolioRoles.includes(option.value)}
                          onChange={() => togglePortfolioRole(option.value)}
                          type="checkbox"
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </section>
          ) : null}

          {row.leg_type === 'cash' ? (
            <section className="leg-inventory-drawer__section">
              <div className="leg-inventory-drawer__copy">
                <strong>现金腿参数</strong>
                <p>规则类型、缓冲 bps 和收益来源会写回现金腿定义。</p>
              </div>
              <div className="leg-inventory-drawer__field-grid">
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-cash-rule">规则类型</label>
                  <select
                    id="leg-edit-cash-rule"
                    onChange={(event) => {
                      const nextRule = event.target.value;
                      setCashRuleKind(nextRule);
                      setYieldSource(nextRule.toLowerCase());
                    }}
                    value={cashRuleKind}
                  >
                    {CASH_RULE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-buffer-bps">缓冲 bps</label>
                  <input id="leg-edit-buffer-bps" onChange={(event) => setBufferBps(event.target.value)} type="number" value={bufferBps} />
                </div>
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-target-weight">目标占比</label>
                  <input id="leg-edit-target-weight" onChange={(event) => setTargetWeightPct(event.target.value)} type="number" value={targetWeightPct} />
                </div>
                <div className="leg-inventory-drawer__field">
                  <label htmlFor="leg-edit-rebalance-frequency">再平衡频次</label>
                  <select
                    id="leg-edit-rebalance-frequency"
                    onChange={(event) => setRebalanceFrequency(event.target.value)}
                    value={rebalanceFrequency}
                  >
                    {CASH_REBALANCE_FREQUENCY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
                  <label htmlFor="leg-edit-yield-source">收益来源</label>
                  <input id="leg-edit-yield-source" onChange={(event) => setYieldSource(event.target.value)} value={yieldSource} />
                </div>
              </div>
            </section>
          ) : null}

          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__copy">
              <strong>冻结与备注</strong>
              <p>核心指标保持只读，备注和冻结方式可以随定义一起保存。</p>
            </div>
            <div className="leg-inventory-drawer__field-grid">
              <div className="leg-inventory-drawer__field">
                <label htmlFor="leg-edit-freeze-mode">冻结方式</label>
                <input id="leg-edit-freeze-mode" onChange={(event) => setFreezeMode(event.target.value)} readOnly={!editable} value={freezeMode} />
              </div>
              <div className="leg-inventory-drawer__field">
                <label htmlFor="leg-edit-anchor">来源锚点</label>
                <input id="leg-edit-anchor" readOnly value={metrics.anchor} />
              </div>
              <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
                <label htmlFor="leg-edit-metrics">核心参数</label>
                <textarea id="leg-edit-metrics" readOnly value={`${metrics.primary}\n${metrics.secondary}`} />
              </div>
              <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
                <label htmlFor="leg-edit-note">备注</label>
                <textarea id="leg-edit-note" onChange={(event) => setNotes(event.target.value)} readOnly={!editable} value={notes} />
              </div>
            </div>
            {formError ? <div className="error-banner" role="alert">{formError}</div> : null}
          </section>

          <div className="leg-inventory-drawer__foot">
            <button className="ghost-button" onClick={onClose} type="button">
              取消
            </button>
            <button className="primary-button" disabled={!editable || saving} onClick={() => void handleSave()} type="button">
              {saving ? '保存中...' : '保存编辑'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
export function LegInventoryView({
  inventory,
  loading,
  error,
  onArchiveCandidate,
  onCreateAsset,
  onCreateCash,
  onSaveStrategy,
  onUpdateAsset,
  onUpdateCash,
  onUpdateStrategy,
  strategyRows,
  bondSourceInstruments,
  focusSourceRefId,
}: LegInventoryViewProps): JSX.Element {
  const [activeType, setActiveType] = useState<InventoryTypeFilter>('all');
  const [activeStatus, setActiveStatus] = useState<LegStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [strategyDrawerOpen, setStrategyDrawerOpen] = useState(false);
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [cashDrawerOpen, setCashDrawerOpen] = useState(false);
  const [assetCopyRow, setAssetCopyRow] = useState<ApiLegInventoryRow | null>(null);
  const [cashCopyRow, setCashCopyRow] = useState<ApiLegInventoryRow | null>(null);
  const [detailRowId, setDetailRowId] = useState<string | null>(null);
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [pendingArchiveRow, setPendingArchiveRow] = useState<ApiLegInventoryRow | null>(null);
  const [pendingStrategyVersionCopy, setPendingStrategyVersionCopy] = useState<PendingStrategyVersionCopy | null>(null);
  const [archivingRowId, setArchivingRowId] = useState<string | null>(null);
  const [savingStrategyId, setSavingStrategyId] = useState<string | null>(null);
  const [strategySaveError, setStrategySaveError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const counts = inventory?.counts ?? { all: 0, strategy: 0, asset: 0, cash: 0 };
  const rows = inventory?.rows ?? [];
  const referencedCount = rows.filter((row) => row.reference_count > 0).length;
  const updateCount = rows.filter((row) => hasStrategyPendingUpdate(row)).length;
  const orphanCount = rows.filter((row) => row.is_orphan).length;
  const detailRow = detailRowId ? rows.find((row) => row.id === detailRowId) ?? null : null;
  const editRow = editRowId ? rows.find((row) => row.id === editRowId) ?? null : null;
  const detailCopyVersionTarget = detailRow
    ? findStrategyVersionCopyTarget(detailRow, strategyRows ?? [], rows)
    : null;
  const statusFilters: Array<{ value: LegStatusFilter; label: string }> = [
    { value: 'latest_version', label: '最新版本' },
    { value: 'pending_update', label: '有新版本 / 参数' },
    { value: 'referenced', label: '已被引用' },
    { value: 'unreferenced', label: '未引用' },
    { value: 'orphan', label: '孤儿腿' },
  ];

  useEffect(() => {
    if (!focusSourceRefId) {
      return;
    }
    const targetRow = rows.find((row) => row.id === focusSourceRefId || row.source_ref_id === focusSourceRefId);
    if (targetRow) {
      setDetailRowId(targetRow.id);
    }
  }, [focusSourceRefId, rows]);

  const filteredRows = rows
    .filter((row) => {
      if (activeType !== 'all' && row.leg_type !== activeType) {
        return false;
      }
      if (!matchesLegStatusFilter(row, activeStatus)) {
        return false;
      }
      if (!deferredSearch) {
        return true;
      }
      const haystack = [
        row.name,
        row.version_label,
        row.proof_label,
        row.reference_summary,
        getRowCreatedAt(row),
        ...row.attribute_tags,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(deferredSearch);
    })
    .sort((left, right) => getRowCreatedSortTime(right) - getRowCreatedSortTime(left));

  function openStrategyDrawer(): void {
    setStrategySaveError(null);
    setStrategyDrawerOpen(true);
    setAssetDrawerOpen(false);
    setCashDrawerOpen(false);
    setAssetCopyRow(null);
    setCashCopyRow(null);
    setMenuOpen(false);
  }

  function openAssetDrawer(): void {
    setStrategyDrawerOpen(false);
    setAssetDrawerOpen(true);
    setCashDrawerOpen(false);
    setAssetCopyRow(null);
    setCashCopyRow(null);
    setMenuOpen(false);
  }

  function openCashDrawer(): void {
    setStrategyDrawerOpen(false);
    setCashDrawerOpen(true);
    setAssetDrawerOpen(false);
    setAssetCopyRow(null);
    setCashCopyRow(null);
    setMenuOpen(false);
  }

  function openCopyDrawer(row: ApiLegInventoryRow): void {
    setDetailRowId(null);
    setEditRowId(null);
    setStrategyDrawerOpen(false);
    setMenuOpen(false);
    if (row.leg_type === 'asset') {
      setAssetCopyRow(row);
      setCashCopyRow(null);
      setAssetDrawerOpen(true);
      setCashDrawerOpen(false);
    } else if (row.leg_type === 'cash') {
      setCashCopyRow(row);
      setAssetCopyRow(null);
      setCashDrawerOpen(true);
      setAssetDrawerOpen(false);
    }
  }

  function toggleStatusFilter(value: LegStatusFilter): void {
    setActiveStatus((current) => (current === value ? 'all' : value));
  }

  async function handleSaveStrategy(row: ApiLegInventoryRow): Promise<void> {
    setStrategySaveError(null);
    setToastMessage(null);
    setSavingStrategyId(row.id);
    try {
      await onSaveStrategy(row);
      setStrategyDrawerOpen(false);
      setToastMessage('创建策略腿成功');
      navigateTo('/legs');
    } catch (caught) {
      setStrategySaveError(`创建策略腿失败：${(caught as Error).message}`);
    } finally {
      setSavingStrategyId(null);
    }
  }

  function navigateToSource(row: ApiLegInventoryRow): void {
    const sourcePath = getAssetSourcePath(row);
    if (sourcePath) {
      navigateTo(sourcePath);
    }
  }

  async function archiveCandidate(row: ApiLegInventoryRow): Promise<void> {
    setPendingArchiveRow(row);
  }

  function requestCopyNewVersion(source: ApiLegInventoryRow, target: ApiLegInventoryRow): void {
    setStrategySaveError(null);
    setPendingStrategyVersionCopy({ source, target });
  }

  async function confirmCopyNewVersion(): Promise<void> {
    const pending = pendingStrategyVersionCopy;
    if (!pending) {
      return;
    }
    setStrategySaveError(null);
    setToastMessage(null);
    setSavingStrategyId(pending.target.id);
    try {
      await onSaveStrategy(pending.target);
      setPendingStrategyVersionCopy(null);
      setDetailRowId((current) => (current === pending.source.id ? null : current));
      setToastMessage(
        pending.source.has_new_parameters
          ? `${pending.target.name} ${getStrategyVersionCopyLabel(pending.target)} 已生成新的参数来源映射。`
          : `${pending.target.name} ${getStrategyVersionCopyLabel(pending.target)} 已生成新的策略腿映射。`,
      );
    } catch (caught) {
      setStrategySaveError(`创建策略腿失败：${(caught as Error).message}`);
    } finally {
      setSavingStrategyId(null);
    }
  }

  async function confirmArchiveCandidate(): Promise<void> {
    const row = pendingArchiveRow;
    if (!row) {
      return;
    }
    setArchivingRowId(row.id);
    try {
      await onArchiveCandidate(row);
      setPendingArchiveRow(null);
      setDetailRowId((current) => (current === row.id ? null : current));
      setToastMessage(`${row.name} 已标记为归档。`);
    } finally {
      setArchivingRowId(null);
    }
  }

  async function saveAssetEdit(id: string, payload: ApiAssetLegCreatePayload): Promise<void> {
    await onUpdateAsset(id, payload);
    setToastMessage('编辑保存成功');
  }

  async function saveCashEdit(id: string, payload: ApiCashLegCreatePayload): Promise<void> {
    await onUpdateCash(id, payload);
    setToastMessage('编辑保存成功');
  }

  async function saveStrategyEdit(id: string, payload: StrategyLegUpdatePayload): Promise<void> {
    await onUpdateStrategy(id, payload);
    setToastMessage('编辑保存成功');
  }

  return (
    <div
      className="leg-inventory-page stack"
      data-page-root="leg-inventory"
      data-route-root="legs"
    >
      <section className="leg-inventory-hero">
        <div className="leg-inventory-hero__header">
          <div className="leg-inventory-hero__copy">
            <p className="page-heading__eyebrow">资产库</p>
            <h1>策略资产库</h1>
            <p>统一管理策略腿、资产腿与现金腿的定义、版本与引用关系，作为正式组合的来源底座。</p>
          </div>
          <div className="leg-inventory-hero__actions">
            <div className="leg-inventory-split">
              <button className="primary-button" onClick={openStrategyDrawer} type="button">
                + 新建腿
              </button>
              <button
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="primary-button leg-inventory-split__toggle"
                onClick={() => setMenuOpen((current) => !current)}
                type="button"
              >
                ▼
              </button>
              {menuOpen ? (
                <div className="leg-inventory-menu" role="menu">
                  <button className="leg-inventory-menu__item" onClick={openStrategyDrawer} role="menuitem" type="button">
                    <strong>策略腿</strong>
                    <span>从已验证的策略版本中选择入库来源，并固定参数口径、组合角色与回测证明。</span>
                  </button>
                  <button className="leg-inventory-menu__item" onClick={openAssetDrawer} role="menuitem" type="button">
                    <strong>资产腿</strong>
                    <span>完成资产定义、来源快照绑定与估值口径设置。</span>
                  </button>
                  <button className="leg-inventory-menu__item" onClick={openCashDrawer} role="menuitem" type="button">
                    <strong>现金腿</strong>
                    <span>定义现金缓冲、再平衡节奏与成本吸收规则。</span>
                  </button>
                </div>
              ) : null}
            </div>
            <button className="ghost-button" onClick={() => navigateTo('/compositions')} type="button">
              返回仪表板
            </button>
          </div>
        </div>

        <div className="leg-inventory-hero__chips">
          <span className="leg-inventory-chip leg-inventory-chip--accent">
            策略腿 {counts.strategy} 条
          </span>
          <span className="leg-inventory-chip">资产腿 {counts.asset} 条</span>
          <span className="leg-inventory-chip">现金腿 {counts.cash} 条</span>
          <span className="leg-inventory-chip">引用关系可追溯</span>
        </div>
      </section>

      <section className="leg-inventory-panel">
        <div className="leg-inventory-panel__header">
          <div className="leg-inventory-panel__copy">
            <h2>全局统计</h2>
            <p>概览库存规模、引用深度与版本变更情况，用于判断来源是否继续沿用或需要升级。</p>
          </div>
        </div>
        <div className="leg-inventory-stat-grid">
          <article className="leg-inventory-stat">
            <span>全部腿</span>
            <strong>{counts.all}</strong>
            <small>
              其中策略腿 {counts.strategy} 条，资产腿 {counts.asset} 条，现金腿 {counts.cash} 条。
            </small>
          </article>
          <article className="leg-inventory-stat">
            <span>已被组合引用</span>
            <strong>{referencedCount}</strong>
            <small>只统计已经进入已保存组合的来源对象。</small>
          </article>
          <article className="leg-inventory-stat">
            <span>待处理对象</span>
            <strong>{updateCount}</strong>
            <small>统计当前策略或资产存在更新版本、需要升级确认的腿。</small>
          </article>
          <article className="leg-inventory-stat">
            <span>孤儿 / 待补跑</span>
            <strong>{orphanCount}</strong>
            <small>仅策略腿可能出现孤儿状态，需补回测后再纳入正式组合。</small>
          </article>
        </div>
      </section>

      <section className="leg-inventory-panel">
        <div className="leg-inventory-panel__header">
          <div className="leg-inventory-panel__copy">
            <h2>过滤工具栏</h2>
            <p>按来源类型、版本状态与组合引用关系查看库存，支持识别核心来源、待升级对象与孤儿条目。</p>
          </div>
        </div>

        <div className="leg-inventory-toolbar leg-inventory-toolbar-shell">
          <input
            aria-label="搜索资产库"
            className="leg-inventory-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索名称、版本、快照或标签"
            value={search}
          />

          <div className="leg-inventory-toolbar__group" role="tablist" aria-label="腿类型筛选">
            {(
              [
                { value: 'all', label: '全部', count: counts.all },
                { value: 'strategy', label: '策略腿', count: counts.strategy },
                { value: 'asset', label: '资产腿', count: counts.asset },
                { value: 'cash', label: '现金腿', count: counts.cash },
              ] as Array<{ value: InventoryTypeFilter; label: string; count: number }>
            ).map((filter) => (
              <button
                aria-selected={activeType === filter.value}
                className={activeType === filter.value ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
                key={filter.value}
                onClick={() => setActiveType(filter.value)}
                role="tab"
                type="button"
              >
                {filter.label} {filter.count}
              </button>
            ))}
          </div>

          <div className="leg-inventory-toolbar__group" aria-label="标签筛选">
            <button
              className={activeStatus === 'all' ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
              onClick={() => setActiveStatus('all')}
              type="button"
            >
              全部标签
            </button>
            {statusFilters.map((filter) => (
              <button
                className={activeStatus === filter.value ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
                key={filter.value}
                onClick={() => toggleStatusFilter(filter.value)}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {toastMessage ? (
        <div className="leg-inventory-toast" role="status">
          {toastMessage}
        </div>
      ) : null}

      <section className="leg-inventory-panel">
        <div className="leg-inventory-panel__header">
          <div className="leg-inventory-panel__copy">
            <h2>腿部清单</h2>
            <p>按来源类型、版本状态与组合引用关系查看库存，支持识别核心来源、待升级对象与孤儿条目。</p>
          </div>
          <span className="leg-inventory-chip">
            当前结果 {filteredRows.length} 条
          </span>
        </div>

        {loading ? (
          <p className="leg-inventory-empty">正在加载资产库清单...</p>
        ) : filteredRows.length === 0 ? (
          <p className="leg-inventory-empty">当前筛选下没有匹配项，可以调整标签或直接新建资产腿 / 现金腿。</p>
        ) : (
          <div
            className="leg-inventory-table-shell leg-inventory-table-panel"
            data-ui="leg-source-trust-table"
          >
            <table className="leg-inventory-table">
              <thead>
                <tr>
                  <th>理由名称 / 标识名称 / ID</th>
                  <th>类型</th>
                  <th>快照版本 (PIT Date)</th>
                  <th>核心参数 / 来源锚点</th>
                  <th>引用组合数</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const assetSourcePath = getAssetSourcePath(row);
                  const displayName = formatLegDisplayName({
                    leg_kind: row.leg_type,
                    name: row.name,
                    config: row.config,
                    source_ref_id: row.source_ref_id,
                  });
                  const pit = getPitSnapshotPreview(row);
                  const metrics = getMetricPreview(row);
                  const copyVersionTarget = findStrategyVersionCopyTarget(row, strategyRows ?? [], rows);
                  const returnQualityBadge = getReturnQualityBadge(row);
                  return (
                    <tr
                      className="leg-inventory-row"
                      key={row.id}
                      onClick={() => setDetailRowId(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setDetailRowId(row.id);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>
                        <div className="leg-inventory-row__identity">
                          <div className="leg-inventory-row__name">
                            <strong>{displayName}</strong>
                            <span>{getIdentitySubtitle(row)}</span>
                            <span className="leg-inventory-row__mono">{getDisplayLegId(row)}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`leg-inventory-type-badge leg-inventory-type-badge--${row.leg_type}`}>
                          {getLegTypeLabel(row.leg_type)}
                        </span>
                      </td>
                      <td>
                        <div className="leg-inventory-row__detail">
                          <strong>{pit.primary}</strong>
                          <div>{pit.secondary}</div>
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__detail">
                          <strong>{metrics.primary}</strong>
                          <div>{metrics.secondary}</div>
                          <div className="leg-inventory-row__mono">{metrics.anchor}</div>
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__reference">
                          <strong>{row.reference_count}</strong>
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__tags">
                          {getStatusBadges(row).map((badge) => (
                            <span className={badge.className} key={badge.label}>
                              {badge.label}
                            </span>
                          ))}
                          {returnQualityBadge ? (
                            <>
                              <span className={returnQualityBadge.className}>{returnQualityBadge.label}</span>
                              <span className="leg-inventory-chip leg-inventory-chip--sample">{returnQualityBadge.detail}</span>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__detail leg-inventory-row__time">
                          <strong>{getRowCreatedAtLabel(row)}</strong>
                          <div>{row.leg_type === 'strategy' ? '保存时间' : '创建时间'}</div>
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__actions">
                          <button
                            className="ghost-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDetailRowId(row.id);
                            }}
                            type="button"
                          >
                            详情
                          </button>
                          {canEditLeg(row) || row.leg_type === 'strategy' ? (
                            <button
                              className="ghost-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditRowId(row.id);
                              }}
                              type="button"
                            >
                              编辑
                            </button>
                          ) : null}
                          {canCopyLeg(row) ? (
                            <button
                              className="ghost-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openCopyDrawer(row);
                              }}
                              type="button"
                            >
                              复制
                            </button>
                          ) : null}
                          {copyVersionTarget ? (
                            <button
                              className="ghost-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                requestCopyNewVersion(row, copyVersionTarget);
                              }}
                              type="button"
                            >
                              {getStrategyUpdateActionLabel(row)}
                            </button>
                          ) : null}
                          {row.leg_type === 'asset' && assetSourcePath ? (
                            <button
                              className="ghost-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigateTo(assetSourcePath);
                              }}
                              type="button"
                            >
                              查看来源
                            </button>
                          ) : null}
                          {row.reference_count <= 0 ? (
                            <button
                              className="ghost-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void archiveCandidate(row);
                              }}
                              type="button"
                            >
                              归档
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="leg-inventory-panel leg-inventory-principles">
        <div className="leg-inventory-panel__header">
          <div className="leg-inventory-panel__copy">
            <h2>管理原则</h2>
            <p>所有正式组合均从已冻结且可追溯的腿部来源读取定义，变更前先完成引用影响评估。</p>
          </div>
        </div>
        <div className="leg-inventory-task-list">
          <article className="leg-inventory-task-card">
            <div className="leg-inventory-task-head">
              <strong>依赖追踪</strong>
              <span className="leg-inventory-status leg-inventory-status--accent">核心</span>
            </div>
            <p>任何被正式组合引用的腿都必须显式显示引用计数，避免用户在无感知状态下修改核心来源。</p>
          </article>
          <article className="leg-inventory-task-card">
            <div className="leg-inventory-task-head">
              <strong>版本审计</strong>
              <span className="leg-inventory-status">持续</span>
            </div>
            <p>更优回测或新代码提交只会触发提示，不会自动升级当前引用，保持版本判断权在用户手里。</p>
          </article>
          <article className="leg-inventory-task-card">
            <div className="leg-inventory-task-head">
              <strong>孤儿清理</strong>
              <span className="leg-inventory-status leg-inventory-status--warning">清洁度</span>
            </div>
            <p>长时间未被任何组合引用的腿进入待清理列表，帮助系统保持研究资产洁净度。</p>
          </article>
        </div>
      </section>

      <StrategyLegDrawer
        errorMessage={strategySaveError}
        onClose={() => {
          if (!savingStrategyId) {
            setStrategyDrawerOpen(false);
            setStrategySaveError(null);
          }
        }}
        onSaveAndAdd={handleSaveStrategy}
        open={strategyDrawerOpen}
        rows={strategyRows ?? rows}
        savingRowId={savingStrategyId}
      />
      <AssetLegDrawer
        bondSourceInstruments={bondSourceInstruments}
        initialRow={assetCopyRow}
        mode={assetCopyRow ? 'copy' : 'create'}
        onClose={() => {
          setAssetDrawerOpen(false);
          setAssetCopyRow(null);
        }}
        onSubmit={onCreateAsset}
        open={assetDrawerOpen}
      />
      <CashLegDrawer
        initialRow={cashCopyRow}
        mode={cashCopyRow ? 'copy' : 'create'}
        onClose={() => {
          setCashDrawerOpen(false);
          setCashCopyRow(null);
        }}
        onSubmit={onCreateCash}
        open={cashDrawerOpen}
      />
      {detailRow ? (
        <LegDetailDrawer
          copyVersionTarget={detailCopyVersionTarget}
          onArchiveCandidate={archiveCandidate}
          onClose={() => setDetailRowId(null)}
          onCopyCandidate={openCopyDrawer}
          onNavigateToSource={navigateToSource}
          onRequestCopyNewVersion={requestCopyNewVersion}
          row={detailRow}
        />
      ) : null}
      {editRow ? (
        <LegEditDrawer
          onClose={() => setEditRowId(null)}
          onUpdateAsset={saveAssetEdit}
          onUpdateCash={saveCashEdit}
          onUpdateStrategy={saveStrategyEdit}
          row={editRow}
        />
      ) : null}
      {pendingStrategyVersionCopy ? (
        <div className="leg-inventory-confirm-shell" role="presentation">
          <div aria-label="确认复制新版本" className="leg-inventory-confirm" role="dialog">
            <div className="leg-inventory-confirm__copy">
              <p className="page-heading__eyebrow">版本映射确认</p>
              <h2>{getStrategyUpdateActionLabel(pendingStrategyVersionCopy.source)}</h2>
              <p>
                {pendingStrategyVersionCopy.source.has_new_parameters
                  ? `检测到相同策略版本与回测周期已有新的回测结果，是否将此策略腿映射到 ${getStrategyVersionCopyLabel(pendingStrategyVersionCopy.target)} 的最新来源？`
                  : `检测到底层策略已更新至 ${getStrategyVersionCopyLabel(pendingStrategyVersionCopy.target)}，是否为此策略腿生成新的版本映射？`}
              </p>
            </div>
            {strategySaveError ? (
              <div className="error-banner" role="alert">
                {strategySaveError}
              </div>
            ) : null}
            <div className="leg-inventory-confirm__summary">
              <span>{getDisplayLegId(pendingStrategyVersionCopy.source)}</span>
              <strong>{pendingStrategyVersionCopy.target.name} · {getStrategyVersionCopyLabel(pendingStrategyVersionCopy.target)}</strong>
            </div>
            <div className="leg-inventory-confirm__actions">
              <button
                className="ghost-button"
                disabled={Boolean(savingStrategyId)}
                onClick={() => {
                  setPendingStrategyVersionCopy(null);
                  setStrategySaveError(null);
                }}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={savingStrategyId === pendingStrategyVersionCopy.target.id}
                onClick={() => void confirmCopyNewVersion()}
                type="button"
              >
                {savingStrategyId === pendingStrategyVersionCopy.target.id ? '保存中...' : '确认生成'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingArchiveRow ? (
        <div className="leg-inventory-confirm-shell" role="presentation">
          <div aria-label="确认归档资产腿" className="leg-inventory-confirm" role="dialog">
            <div className="leg-inventory-confirm__copy">
              <p className="page-heading__eyebrow">归档确认</p>
              <h2>确认归档资产腿</h2>
              <p>
                归档后该腿会从默认资产库入口隐藏，已保存组合仍保留冻结证据。
              </p>
            </div>
            <div className="leg-inventory-confirm__summary">
              <span>{pendingArchiveRow.id}</span>
              <strong>{pendingArchiveRow.name}</strong>
            </div>
            <div className="leg-inventory-confirm__actions">
              <button
                className="ghost-button"
                disabled={Boolean(archivingRowId)}
                onClick={() => setPendingArchiveRow(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={archivingRowId === pendingArchiveRow.id}
                onClick={() => void confirmArchiveCandidate()}
                type="button"
              >
                {archivingRowId === pendingArchiveRow.id ? '归档中...' : '确认归档'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
