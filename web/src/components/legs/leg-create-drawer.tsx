import { useEffect, useMemo, useState } from 'react';
import { formatPercent, formatRatio } from '../../lib/format';
import type {
  ApiAssetLegCreatePayload,
  ApiBondSnapshotEligibleInstrument,
  ApiCashLegCreatePayload,
  ApiLegInventoryRow,
} from '../../types';
import './leg-inventory.css';

type AssetLegDrawerProps = {
  open: boolean;
  bondSourceInstruments?: ApiBondSnapshotEligibleInstrument[];
  initialRow?: ApiLegInventoryRow | null;
  mode?: 'create' | 'copy';
  onClose: () => void;
  onSubmit: (payload: ApiAssetLegCreatePayload) => Promise<void>;
};

type CashLegDrawerProps = {
  open: boolean;
  initialRow?: ApiLegInventoryRow | null;
  mode?: 'create' | 'copy';
  onClose: () => void;
  onSubmit: (payload: ApiCashLegCreatePayload) => Promise<void>;
};

type StrategyLegDrawerProps = {
  open: boolean;
  onClose: () => void;
  rows: ApiLegInventoryRow[];
  onSaveAndAdd: (row: ApiLegInventoryRow) => void;
};

const DEFAULT_CASH_FORM: ApiCashLegCreatePayload = {
  name: '现金安全垫',
  cash_rule_kind: 'PURE_CASH',
  buffer_bps: 12,
  yield_source: 'pure_cash',
  freeze_mode: 'manual',
  summary: {
    target_weight_pct: 20,
    rebalance_frequency: 'quarterly',
  },
  notes: '现金腿不是空白占位，而是对维护成本和组合成立性产生真实影响的来源对象。',
};

type AssetPresetMode = 'bond' | 'equity';

type AssetPresetRole = {
  active: boolean;
  label: string;
  value: string;
};

type AssetPresetSource = {
  assetKind: string;
  cadenceLabel: string;
  id: string;
  kpis: Array<{ label: string; value: string }>;
  maintenanceCadence: string;
  name: string;
  note: string;
  provider: string;
  rebalanceAffinity: string;
  rebalanceLabel: string;
  short: string;
  slots: Array<{ label: string; value: string }>;
  suggestedName: string;
  suggestedSymbol: string;
  tags: string[];
  valuationBasis: string;
  valuationLabel: string;
};

type AssetPresetConfig = {
  icon: string;
  roleTone: string;
  roles: AssetPresetRole[];
  slotBadge: string;
  slotTitle: string;
  sourcePage: string;
  sources: AssetPresetSource[];
};

const ASSET_PRESET_MODES: Record<AssetPresetMode, AssetPresetConfig> = {
  bond: {
    icon: '债',
    roleTone: '久期/防守',
    slotBadge: '债券',
    slotTitle: '债券参数',
    sourcePage: '数据快照 / 债券 / 固定收益',
    roles: [
      { value: 'duration_stabilizer', label: '久期稳定器', active: true },
      { value: 'cash_enhancer', label: '现金增强', active: true },
      { value: 'spread_carry', label: '利差套利', active: false },
    ],
    sources: [],
  },
  equity: {
    icon: '股',
    roleTone: '因子/超额',
    slotBadge: '股票',
    slotTitle: '股票参数',
    sourcePage: '数据快照 / 股票 / 指数',
    roles: [
      { value: 'core_excess', label: '核心超额', active: true },
      { value: 'risk_hedge', label: '风险对冲', active: true },
      { value: 'sector_tilt', label: '行业偏离', active: false },
    ],
    sources: [],
  },
};

const EMPTY_BOND_SOURCE: AssetPresetSource = {
  id: '',
  name: '没有可创建的债券快照',
  short: '请先完成 bond_fixed_income runtime 快照刷新',
  tags: ['bond_fixed_income', 'empty'],
  suggestedName: '',
  suggestedSymbol: '',
  assetKind: 'BOND',
  provider: 'bond_fixed_income',
  valuationBasis: 'clean_plus_accrued',
  valuationLabel: '净价 + 应计',
  rebalanceAffinity: 'stable',
  rebalanceLabel: '优先保留',
  maintenanceCadence: 'eod_auto',
  cadenceLabel: '随来源刷新',
  note: 'No eligible runtime bond fixed-income snapshot is available.',
  slots: [
    { label: '来源', value: '无可用快照' },
    { label: '状态', value: '待刷新' },
    { label: '验证', value: '未就绪' },
    { label: '保存', value: '不可用' },
  ],
  kpis: [
    { label: '候选', value: '0' },
    { label: '状态', value: '待刷新' },
    { label: '来源', value: 'runtime' },
  ],
};

const EMPTY_EQUITY_SOURCE: AssetPresetSource = {
  id: '',
  name: '权益资产腿尚未接入正式运行时快照源',
  short: '等待权益快照来源契约',
  tags: ['equity', 'runtime-required'],
  suggestedName: '',
  suggestedSymbol: '',
  assetKind: 'EQUITY',
  provider: '',
  valuationBasis: 'runtime_source_required',
  valuationLabel: '待接入',
  rebalanceAffinity: 'pending',
  rebalanceLabel: '不可保存',
  maintenanceCadence: 'pending',
  cadenceLabel: '待接入',
  note: 'Phase 1.1 资产腿创建只接受运行时来源；权益快照源接入前不会生成静态来源。',
  slots: [
    { label: '来源', value: '无运行时契约' },
    { label: '状态', value: '待接入' },
    { label: '验证', value: '不可保存' },
    { label: '保存', value: '禁用' },
  ],
  kpis: [
    { label: '候选', value: '0' },
    { label: '状态', value: '待接入' },
    { label: '来源', value: 'runtime' },
  ],
};

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

type StrategyDrawerMetrics = {
  annualizedReturn: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
  totalReturn: number | null;
};

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getConfigRecord(row: ApiLegInventoryRow | null | undefined): Record<string, unknown> {
  return row?.config && typeof row.config === 'object' ? row.config : {};
}

function getSummaryRecord(row: ApiLegInventoryRow | null | undefined): Record<string, unknown> {
  const summary = getConfigRecord(row).summary;
  return summary && typeof summary === 'object' && !Array.isArray(summary) ? (summary as Record<string, unknown>) : {};
}

function getSourceIntegrityRecord(row: ApiLegInventoryRow | null | undefined): Record<string, unknown> {
  const topLevel = row?.source_integrity;
  if (topLevel && typeof topLevel === 'object' && !Array.isArray(topLevel)) {
    return topLevel as Record<string, unknown>;
  }
  const configIntegrity = getConfigRecord(row).source_integrity;
  return configIntegrity && typeof configIntegrity === 'object' && !Array.isArray(configIntegrity)
    ? (configIntegrity as Record<string, unknown>)
    : {};
}

function readStringFromRecords(records: Record<string, unknown>[], keys: string[], fallback = ''): string {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
  }
  return fallback;
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
      return '来源失效';
    case 'missing':
      return '证据缺失';
    default:
      return '待确认';
  }
}

function readNumberFromRecords(records: Record<string, unknown>[], keys: string[], fallback: number): number {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }
  return fallback;
}

function getStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const next = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return next.length > 0 ? next : fallback;
}

function formatRuntimeNumber(value: number | null | undefined, suffix = ''): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : null;
}

function formatRuntimeTenorCn(value: string | null | undefined): string {
  const text = value?.trim();
  if (!text) {
    return '';
  }
  const match = text.match(/^(\d+(?:\.\d+)?)([YMWD])$/i);
  if (!match) {
    return text;
  }
  const [, amount, unit] = match;
  const unitLabel = unit.toUpperCase() === 'Y' ? '年' : unit.toUpperCase() === 'M' ? '个月' : unit.toUpperCase() === 'W' ? '周' : '天';
  return `${amount}${unitLabel}`;
}

function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = value?.trim();
    if (text) {
      return text;
    }
  }
  return null;
}

function getRuntimeBondEnglishName(instrument: ApiBondSnapshotEligibleInstrument): string {
  return firstText(instrument.label, instrument.symbol, instrument.isin, instrument.cusip, instrument.id) ?? 'Runtime Bond';
}

function getRuntimeBondChineseName(instrument: ApiBondSnapshotEligibleInstrument): string {
  const englishName = getRuntimeBondEnglishName(instrument).toUpperCase();
  const descriptor = [
    instrument.instrument_type,
    instrument.asset_type,
    instrument.audit_profile,
    instrument.group,
    englishName,
  ].join(' ').toUpperCase();
  const tenorCn = formatRuntimeTenorCn(instrument.tenor_label);

  if (descriptor.includes('T_BILL') || descriptor.includes('TBILL') || descriptor.includes('BILL')) {
    return tenorCn ? `美国${tenorCn}短期国债` : '美国短期国债';
  }
  if (descriptor.includes('TIPS')) {
    return tenorCn ? `美国${tenorCn}通胀保值债` : '美国通胀保值债';
  }
  if (descriptor.includes('LQD')) {
    return '投资级公司债 ETF';
  }
  if (descriptor.includes('ETF')) {
    return '债券 ETF';
  }
  if (descriptor.includes('IG') || descriptor.includes('CREDIT') || instrument.credit_quality) {
    return '投资级信用债';
  }
  if (descriptor.includes('UST') || descriptor.includes('TREASURY')) {
    return tenorCn ? `美国${tenorCn}国债` : '美国国债';
  }
  return '债券资产';
}

function getAssetSourceCardName(source: AssetPresetSource): string {
  const name = source.name.trim();
  const short = source.short.trim();
  if (!short || name.toLowerCase().includes(short.toLowerCase())) {
    return name;
  }
  return `${name} ${short}`;
}

function buildRuntimeBondSource(instrument: ApiBondSnapshotEligibleInstrument): AssetPresetSource | null {
  const snapshotRef = firstText(instrument.snapshot_ref, instrument.id);
  if (!snapshotRef) {
    return null;
  }
  if (String(instrument.status ?? '').toUpperCase() !== 'READY') {
    return null;
  }
  if (instrument.creation_disabled_reason || instrument.asset_leg_disabled_reason) {
    return null;
  }

  const instrumentType = firstText(instrument.instrument_type, instrument.asset_type, 'bond') ?? 'bond';
  const englishName = getRuntimeBondEnglishName(instrument);
  const chineseName = getRuntimeBondChineseName(instrument);
  const assetType = String(instrument.asset_type ?? '').toUpperCase();
  const isBondEtf = assetType === 'BOND_ETF' || instrumentType.toLowerCase().includes('etf');
  const durationValue = formatRuntimeNumber(instrument.duration ?? instrument.effective_duration, '');
  const yieldValue = formatRuntimeNumber(
    instrument.ytm_pct ?? instrument.discount_rate_pct ?? instrument.real_yield_pct ?? instrument.sec_yield_30d_pct,
    '%',
  );
  const accruedStatus = instrument.field_status?.accrued_interest ?? (
    typeof instrument.accrued_interest === 'number' ? 'READY' : 'UNKNOWN'
  );
  const suggestedSymbol = firstText(instrument.symbol, instrument.isin, instrument.cusip, instrument.id) ?? snapshotRef;
  const tags = [
    instrument.group,
    instrument.tenor_label,
    instrumentType,
    instrument.source,
    instrument.field_status?.accrued_interest === 'WAIVED' ? 'accrued waived' : null,
  ].filter((item): item is string => Boolean(item));

  return {
    id: snapshotRef,
    name: chineseName,
    short: englishName,
    tags: tags.length > 0 ? tags : ['bond_fixed_income'],
    suggestedName: chineseName,
    suggestedSymbol,
    assetKind: isBondEtf ? 'BOND_ETF' : 'BOND',
    provider: instrument.source || 'bond_fixed_income',
    valuationBasis: instrument.real_yield_pct != null ? 'real_yield' : 'clean_plus_accrued',
    valuationLabel: instrument.real_yield_pct != null ? '真实收益率' : '净价 + 应计',
    rebalanceAffinity: 'stable',
    rebalanceLabel: '优先保留',
    maintenanceCadence: 'eod_auto',
    cadenceLabel: '随 runtime 快照刷新',
    note: `Created from bond fixed-income snapshot ${snapshotRef}`,
    slots: [
      { label: '收益率', value: yieldValue ?? 'n/a' },
      { label: '久期', value: durationValue ?? 'n/a' },
      { label: '应计', value: accruedStatus },
      { label: '日期', value: instrument.snapshot_date ?? 'runtime' },
    ],
    kpis: [
      { label: '收益率', value: yieldValue ?? 'n/a' },
      { label: '久期', value: durationValue ?? 'n/a' },
      { label: '状态', value: instrument.status },
    ],
  };
}

function buildRuntimeBondSources(
  instruments: ApiBondSnapshotEligibleInstrument[] | undefined,
): AssetPresetSource[] {
  return (instruments ?? []).flatMap((instrument) => {
    const source = buildRuntimeBondSource(instrument);
    return source ? [source] : [];
  });
}

function cloneAssetForm(form: ApiAssetLegCreatePayload): ApiAssetLegCreatePayload {
  return { ...form, summary: { ...(form.summary ?? {}) } };
}

function cloneCashForm(form: ApiCashLegCreatePayload): ApiCashLegCreatePayload {
  return { ...form, summary: { ...(form.summary ?? {}) } };
}

function buildAssetSemanticSummary(summary: Record<string, unknown> | undefined): Record<string, unknown> {
  const source = summary ?? {};
  return {
    ...source,
    valuation_basis: readStringFromRecords([source], ['valuation_basis'], 'clean_plus_accrued'),
    portfolio_roles: getStringArray(source.portfolio_roles, ['duration_stabilizer']),
    rebalance_affinity: readStringFromRecords([source], ['rebalance_affinity'], 'stable'),
    maintenance_cadence: readStringFromRecords([source], ['maintenance_cadence'], 'eod_auto'),
  };
}

function readAssetModeFromHash(): AssetPresetMode {
  if (typeof window === 'undefined') {
    return 'bond';
  }
  return window.location.hash.toLowerCase().includes('equity') ? 'equity' : 'bond';
}

function getAssetSources(mode: AssetPresetMode, runtimeBondSources: AssetPresetSource[]): AssetPresetSource[] {
  if (mode === 'bond') {
    return runtimeBondSources;
  }
  return [];
}

function getDefaultAssetSource(mode: AssetPresetMode, runtimeBondSources: AssetPresetSource[] = []): AssetPresetSource {
  return getAssetSources(mode, runtimeBondSources)[0] ?? (mode === 'bond' ? EMPTY_BOND_SOURCE : EMPTY_EQUITY_SOURCE);
}

function getDefaultRoleValues(mode: AssetPresetMode): string[] {
  return ASSET_PRESET_MODES[mode].roles.filter((role) => role.active).map((role) => role.value);
}

function findPresetSource(mode: AssetPresetMode, sourceId: string, runtimeBondSources: AssetPresetSource[] = []): AssetPresetSource | null {
  return getAssetSources(mode, runtimeBondSources).find((source) => source.id === sourceId) ?? null;
}

function inferAssetModeFromForm(form: ApiAssetLegCreatePayload): AssetPresetMode {
  const marker = `${form.asset_kind} ${form.source_snapshot_id}`.toLowerCase();
  return marker.includes('equity') || marker.includes('stock') ? 'equity' : 'bond';
}

function buildAssetFormFromPreset(mode: AssetPresetMode, source: AssetPresetSource): ApiAssetLegCreatePayload {
  return {
    name: source.suggestedName,
    symbol: source.suggestedSymbol,
    asset_kind: source.assetKind,
    source_snapshot_id: source.id,
    source_provider: source.provider,
    freeze_mode: 'snapshot_locked',
    notes: source.note,
    summary: {
      valuation_basis: source.valuationBasis,
      portfolio_roles: getDefaultRoleValues(mode),
      rebalance_affinity: source.rebalanceAffinity,
      maintenance_cadence: source.maintenanceCadence,
    },
  };
}

function syncAssetModeToHash(mode: AssetPresetMode): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (window.location.hash && !window.location.hash.startsWith('#/legs')) {
    return;
  }
  const nextHash = mode === 'equity' ? '#/legs?asset_type=equity' : '#/legs';
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, '', nextHash);
  }
}

function buildCashSemanticSummary(summary: Record<string, unknown> | undefined): Record<string, unknown> {
  const source = summary ?? {};
  return {
    ...source,
    target_weight_pct: readNumberFromRecords([source], ['target_weight_pct'], 20),
    rebalance_frequency: readStringFromRecords([source], ['rebalance_frequency'], 'quarterly'),
  };
}

function buildAssetFormFromRow(row: ApiLegInventoryRow): ApiAssetLegCreatePayload {
  const config = getConfigRecord(row);
  const summary = buildAssetSemanticSummary(getSummaryRecord(row));
  return {
    name: `${row.name} Copy`,
    symbol: readStringFromRecords([config], ['symbol', 'ticker'], row.version_label ?? ''),
    asset_kind: readStringFromRecords([config], ['asset_kind'], 'BOND'),
    source_snapshot_id: readStringFromRecords([config], ['source_snapshot_id', 'snapshot_ref'], row.proof_label ?? ''),
    source_provider: readStringFromRecords([config, summary], ['source_provider', 'source'], ''),
    freeze_mode: readStringFromRecords([config], ['freeze_mode'], 'snapshot_locked'),
    notes: readStringFromRecords([summary, config], ['notes', 'comment', 'memo'], ''),
    summary,
  };
}

function buildCashFormFromRow(row: ApiLegInventoryRow): ApiCashLegCreatePayload {
  const config = getConfigRecord(row);
  const summary = buildCashSemanticSummary(getSummaryRecord(row));
  const cashRuleKind = readStringFromRecords([config], ['cash_rule_kind'], row.version_label ?? 'PURE_CASH')
    .toUpperCase()
    .replace('-', '_');
  return {
    name: `${row.name} Copy`,
    cash_rule_kind: cashRuleKind,
    buffer_bps: readNumberFromRecords([config], ['buffer_bps'], 12),
    yield_source: readStringFromRecords([config], ['yield_source'], cashRuleKind.toLowerCase()),
    freeze_mode: readStringFromRecords([config], ['freeze_mode'], 'manual'),
    notes: readStringFromRecords([summary, config], ['notes', 'comment', 'memo'], ''),
    summary,
  };
}

function getMetricsRecord(row: ApiLegInventoryRow | null | undefined): Record<string, unknown> {
  const metrics = getConfigRecord(row).metrics;
  return metrics && typeof metrics === 'object' ? (metrics as Record<string, unknown>) : {};
}

function readMetricValue(records: Record<string, unknown>[], keys: string[]): number | null {
  for (const record of records) {
    for (const key of keys) {
      const value = readNumber(record[key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function normalizeStrategyPercent(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return Math.abs(value) > 2 ? value / 100 : value;
}

function normalizeStrategyDrawdown(value: number | null): number | null {
  const percent = normalizeStrategyPercent(value);
  return percent === null ? null : -Math.abs(percent);
}

function getStrategyDrawerMetrics(row: ApiLegInventoryRow | null | undefined): StrategyDrawerMetrics {
  const config = getConfigRecord(row);
  const metrics = getMetricsRecord(row);
  const records = [metrics, config];
  return {
    annualizedReturn: normalizeStrategyPercent(
      readMetricValue(records, ['annualized_return', 'cagr', 'oos_annualized_return', 'annualized_return_pct']),
    ),
    maxDrawdown: normalizeStrategyDrawdown(
      readMetricValue(records, ['max_drawdown', 'oos_max_drawdown', 'max_drawdown_pct']),
    ),
    sharpe: readMetricValue(records, ['sharpe', 'oos_sharpe', 'out_of_sample_sharpe']),
    totalReturn: normalizeStrategyPercent(
      readMetricValue(records, ['total_return', 'oos_total_return', 'total_return_pct']),
    ),
  };
}

function getStrategyTypeTitleTag(row: ApiLegInventoryRow): string {
  const config = getConfigRecord(row);
  const explicitType = readStringFromRecords([config], ['strategy_type', 'type']);
  const tagType = row.attribute_tags.find((tag) => tag !== 'strategy' && !tag.includes(':'));
  const rawType = explicitType || tagType || 'strategy';
  return rawType.replaceAll('_', ' ').toUpperCase();
}

function formatStrategyMetricTag(label: string, value: string): string {
  return `${label} ${value}`;
}

function getStrategyRunTitleTags(row: ApiLegInventoryRow, metrics: StrategyDrawerMetrics): string[] {
  const annualized = metrics.annualizedReturn ?? metrics.totalReturn;
  return [
    getStrategyTypeTitleTag(row),
    formatStrategyMetricTag('年化', annualized === null ? 'n/a' : formatPercent(annualized)),
    formatStrategyMetricTag('最大回撤', metrics.maxDrawdown === null ? 'n/a' : formatPercent(metrics.maxDrawdown)),
    formatStrategyMetricTag('夏普', metrics.sharpe === null ? 'n/a' : formatRatio(metrics.sharpe)),
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeReturn(value: number | null): number {
  const normalized = value ?? 0.08;
  if (Math.abs(normalized) > 2) {
    return clamp(normalized / 50, -0.35, 1.2);
  }
  return clamp(normalized, -0.35, 1.2);
}

function buildCurveValues(metrics: StrategyDrawerMetrics, kind: 'strategy' | 'benchmark'): number[] {
  const totalReturn = normalizeReturn(metrics.totalReturn);
  const drawdown = clamp(Math.abs(metrics.maxDrawdown ?? 0.06), 0, 0.3);
  const sharpeBend = clamp(((metrics.sharpe ?? 0.8) - 0.8) / 8, -0.08, 0.1);
  const benchmarkScale = kind === 'benchmark' ? 0.58 : 1;
  const bendScale = kind === 'benchmark' ? 0.45 : 1;

  return [
    0,
    totalReturn * 0.08 * benchmarkScale,
    totalReturn * 0.18 * benchmarkScale - drawdown * 0.16 * bendScale,
    totalReturn * 0.34 * benchmarkScale - drawdown * 0.08 * bendScale,
    totalReturn * 0.52 * benchmarkScale + sharpeBend * bendScale,
    totalReturn * 0.7 * benchmarkScale + sharpeBend * 1.2 * bendScale,
    totalReturn * 0.86 * benchmarkScale - drawdown * 0.04 * bendScale,
    totalReturn * benchmarkScale,
  ];
}

function buildPolylinePoints(values: number[]): string {
  const minValue = Math.min(-0.05, ...values);
  const maxValue = Math.max(0.08, ...values);
  const spread = maxValue - minValue || 1;
  return values
    .map((value, index) => {
      const x = Math.round((420 / (values.length - 1)) * index);
      const y = Math.round(184 - ((value - minValue) / spread) * 140);
      return `${x},${clamp(y, 36, 190)}`;
    })
    .join(' ');
}

function buildFillPath(points: string): string {
  return `M${points.replaceAll(' ', ' L')} L420 220 L0 220 Z`;
}

function DrawerShell({
  children,
  headerActions,
  icon,
  onClose,
  wide = false,
  title,
  subtitle,
}: {
  children: JSX.Element;
  headerActions?: JSX.Element;
  icon?: string;
  onClose: () => void;
  wide?: boolean;
  title: string;
  subtitle: string;
}): JSX.Element {
  const drawerClassName = wide ? 'leg-inventory-drawer leg-inventory-drawer--wide' : 'leg-inventory-drawer';

  return (
    <div className="leg-inventory-drawer-layer">
      <button
        aria-label="关闭抽屉"
        className="leg-inventory-drawer__overlay"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={title}
        className={drawerClassName}
        role="dialog"
      >
        <div className="leg-inventory-drawer__header">
          <div className="leg-inventory-drawer__title">
            {icon ? <div className="leg-inventory-drawer__icon">{icon}</div> : null}
            <div className="leg-inventory-drawer__copy">
              {icon ? null : <p className="page-heading__eyebrow">资产库</p>}
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>
          {headerActions ?? (
            <button className="ghost-button" onClick={onClose} type="button">
              关闭
            </button>
          )}
        </div>
        {children}
      </aside>
    </div>
  );
}

export function StrategyLegDrawer({
  open,
  onClose,
  onSaveAndAdd,
  rows,
}: StrategyLegDrawerProps): JSX.Element | null {
  const strategyRows = rows.filter((row) => row.leg_type === 'strategy');
  const firstStrategyId = strategyRows[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    if (open) {
      setSelectedId(firstStrategyId);
    }
  }, [firstStrategyId, open]);

  if (!open) {
    return null;
  }

  const selectedRow = strategyRows.find((row) => row.id === selectedId) ?? strategyRows[0] ?? null;
  const tags = selectedRow?.attribute_tags.map((tag) => tag.replaceAll('_', ' ')).slice(0, 3) ?? [];
  const metrics = getStrategyDrawerMetrics(selectedRow);
  const sourceIntegrity = getSourceIntegrityRecord(selectedRow);
  const strategyCurvePoints = buildPolylinePoints(buildCurveValues(metrics, 'strategy'));
  const benchmarkCurvePoints = buildPolylinePoints(buildCurveValues(metrics, 'benchmark'));
  const strategyCurveFillPath = buildFillPath(strategyCurvePoints);

  return (
    <DrawerShell
      headerActions={(
        <div className="leg-inventory-drawer__actions">
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={!selectedRow}
            onClick={() => {
              if (selectedRow) {
                onSaveAndAdd(selectedRow);
              }
            }}
            type="button"
          >
            保存并加入库
          </button>
          <button aria-label="关闭抽屉" className="leg-inventory-drawer__x" onClick={onClose} type="button">
            ×
          </button>
        </div>
      )}
      icon="策"
      onClose={onClose}
      subtitle="从已验证的策略版本中选择入库来源，并固定参数口径、组合角色与回测证明。"
      title="创建策略腿"
      wide
    >
      <div className="leg-inventory-drawer__body leg-inventory-drawer__body--wide" data-drawer-kind="strategy">
        <div className="leg-inventory-drawer__form">
          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__section-header">
              <div className="leg-inventory-drawer__copy">
                <strong>身份定义</strong>
                <p>策略腿必须绑定可追溯的回测版本、参数版本与组合角色，确保来源证据完整。</p>
              </div>
              <span className="leg-inventory-status leg-inventory-status--success">版本选择</span>
            </div>
            {strategyRows.length > 0 ? (
              <div className="leg-inventory-run-list">
                {strategyRows.map((row, index) => {
                  const rowMetrics = getStrategyDrawerMetrics(row);
                  const titleTags = getStrategyRunTitleTags(row, rowMetrics);
                  return (
                    <button
                      className={`leg-inventory-run-item${row.id === selectedRow?.id ? ' leg-inventory-run-item--active' : ''}`}
                      key={row.id}
                      onClick={() => setSelectedId(row.id)}
                      type="button"
                    >
                      <strong className="leg-inventory-run-item__title">
                        <span>{row.name}</span>
                        <span>{row.version_label || `#${index + 1}`}</span>
                        {titleTags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </strong>
                      <span>{row.status_label || row.status} · {row.proof_label || row.source_ref_id}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="leg-inventory-drawer__callout">当前没有可用于创建策略腿的合格策略版本。</div>
            )}
            <div className="leg-inventory-drawer__field-grid">
              <div className="leg-inventory-drawer__field">
                <strong>腿名称</strong>
                <span>{selectedRow?.name ?? '待选择策略版本'}</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>来源回测</strong>
                <span>{selectedRow?.proof_label || selectedRow?.source_ref_id || '待选择'}</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>组合角色</strong>
                <span>{tags.length > 0 ? tags.join(' / ') : '收益增强主腿，承担主要方向敞口。'}</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>引用标签</strong>
                <span>{tags.length > 0 ? tags.join(' / ') : '趋势 / 宏观 / Core'}</span>
              </div>
            </div>
          </section>

          <section className="leg-inventory-drawer__section leg-inventory-drawer__trust" data-ui="leg-source-evidence-drawer">
            <div className="leg-inventory-drawer__section-header">
              <div className="leg-inventory-drawer__copy">
                <strong>来源签名</strong>
                <p>冻结哈希和漂移提示会随腿部进入组合预演，已保存组合仍读取冻结证据。</p>
              </div>
              <span className="leg-inventory-status">
                {getSourceTrustStatusLabel(readStringFromRecords([sourceIntegrity], ['signature_status'], 'verified'))}
              </span>
            </div>
            <div className="leg-inventory-drawer__field-grid">
              <div className="leg-inventory-drawer__field">
                <strong>冻结哈希</strong>
                <span data-ui="leg-freeze-hash">{readStringFromRecords([sourceIntegrity], ['freeze_hash'], 'pending')}</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>版本漂移</strong>
                <span data-ui="leg-drift-status">{getSourceTrustStatusLabel(readStringFromRecords([sourceIntegrity], ['drift_status'], 'current'))}</span>
              </div>
            </div>
          </section>
        </div>

        <div className="leg-inventory-drawer__snapshot">
          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__section-header">
              <div className="leg-inventory-drawer__copy">
                <strong>验证摘要</strong>
                <p>右侧即时渲染当前选中版本的收益曲线和关键指标，让选择版本变成一个有证据的动作。</p>
              </div>
              <span className="leg-inventory-status leg-inventory-status--success">运行快照</span>
            </div>
            <div className="leg-inventory-drawer__chart" aria-hidden="true">
              <svg viewBox="0 0 420 220" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="strategyDrawerFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(31, 135, 123, 0.18)" />
                    <stop offset="100%" stopColor="rgba(31, 135, 123, 0)" />
                  </linearGradient>
                </defs>
                <path d={strategyCurveFillPath} fill="url(#strategyDrawerFill)" />
                <polyline data-series="benchmark" fill="none" points={benchmarkCurvePoints} stroke="#4c78c7" strokeDasharray="8 7" strokeWidth="3" />
                <polyline data-series="strategy" fill="none" points={strategyCurvePoints} stroke="#1f877b" strokeWidth="4" />
              </svg>
            </div>
            <div className="leg-inventory-drawer__kpi-grid">
              <div className="leg-inventory-drawer__kpi">
                <span>年化</span>
                <strong>{formatPercent(metrics.annualizedReturn ?? metrics.totalReturn)}</strong>
                <small>{selectedRow?.proof_label || '已完成回测'}</small>
              </div>
              <div className="leg-inventory-drawer__kpi">
                <span>夏普</span>
                <strong>{formatRatio(metrics.sharpe)}</strong>
                <small>{selectedRow?.version_label || '待选版本'}</small>
              </div>
              <div className="leg-inventory-drawer__kpi">
                <span>最大回撤</span>
                <strong>{formatPercent(metrics.maxDrawdown)}</strong>
                <small>{selectedRow?.has_new_version ? '有新版本' : '最新版本'}</small>
              </div>
            </div>
          </section>

          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__section-header">
              <div className="leg-inventory-drawer__copy">
                <strong>核心参数</strong>
                <p>固定策略腿在组合中的权重建议、冻结方式与升级规则，保证正式来源口径稳定。</p>
              </div>
              <span className="leg-inventory-status">冻结语义</span>
            </div>
            <div className="leg-inventory-drawer__field-grid">
              <div className="leg-inventory-drawer__field">
                <strong>权重建议</strong>
                <span>32% 起步，适合作为主腿与资产腿搭配。</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>冻结方式</strong>
                <span>保存时锁定回测、参数版本与代码提交摘要。</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>再平衡亲和</strong>
                <span>季度。与组合工作台默认维护节奏一致。</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>升级策略</strong>
                <span>出现更优回测时只做提示，不自动替换当前引用。</span>
              </div>
            </div>
            <div className="leg-inventory-drawer__callout">
              保存后，该策略腿将以版本冻结方式进入资产库，可直接被组合工作台与正式组合引用。
            </div>
          </section>
        </div>

      </div>
    </DrawerShell>
  );
}

export function AssetLegDrawer({
  bondSourceInstruments = [],
  initialRow = null,
  mode = 'create',
  open,
  onClose,
  onSubmit,
}: AssetLegDrawerProps): JSX.Element | null {
  const runtimeBondSources = useMemo(() => buildRuntimeBondSources(bondSourceInstruments), [bondSourceInstruments]);
  const [form, setForm] = useState<ApiAssetLegCreatePayload>(() =>
    buildAssetFormFromPreset(readAssetModeFromHash(), getDefaultAssetSource(readAssetModeFromHash(), runtimeBondSources)),
  );
  const [assetMode, setAssetMode] = useState<AssetPresetMode>(() => readAssetModeFromHash());
  const [selectedSourceId, setSelectedSourceId] = useState<string>(
    () => getDefaultAssetSource(readAssetModeFromHash(), runtimeBondSources).id,
  );
  const [sourceQuery, setSourceQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const initialModeFromHash = readAssetModeFromHash();
      const initialForm = initialRow
        ? buildAssetFormFromRow(initialRow)
        : buildAssetFormFromPreset(initialModeFromHash, getDefaultAssetSource(initialModeFromHash, runtimeBondSources));
      const initialMode = initialRow ? inferAssetModeFromForm(initialForm) : readAssetModeFromHash();
      setAssetMode(initialMode);
      setSelectedSourceId(initialForm.source_snapshot_id);
      setSourceQuery('');
      setForm(initialForm);
      setSubmitting(false);
      setError(null);
    }
  }, [initialRow, open, runtimeBondSources]);

  if (!open) {
    return null;
  }

  const modeConfig = ASSET_PRESET_MODES[assetMode];
  const modeSources = getAssetSources(assetMode, runtimeBondSources);
  const assetSummary = buildAssetSemanticSummary(form.summary);
  const selectedRoles = getStringArray(assetSummary.portfolio_roles, getDefaultRoleValues(assetMode));
  const selectedPresetSource = findPresetSource(assetMode, selectedSourceId, runtimeBondSources) ?? getDefaultAssetSource(assetMode, runtimeBondSources);
  const selectedRuleSource = findPresetSource(assetMode, form.source_snapshot_id, runtimeBondSources) ?? selectedPresetSource;
  const normalizedSourceQuery = sourceQuery.trim().toLowerCase();
  const visibleSources = modeSources.filter((source) => {
    if (!normalizedSourceQuery) {
      return true;
    }
    return [source.id, getAssetSourceCardName(source), source.name, source.short, ...source.tags]
      .join(' ')
      .toLowerCase()
      .includes(normalizedSourceQuery);
  });
  const sourceStackClassName = visibleSources.length > 3
    ? 'leg-inventory-source-stack leg-inventory-source-stack--scroll'
    : 'leg-inventory-source-stack';
  const drawerSubtitle = mode === 'copy' ? '绑定来源，设定口径，另存入库。' : '绑定来源，设定口径，保存入库。';
  const canSubmitAsset = Boolean(form.name.trim() && form.symbol.trim() && form.source_snapshot_id.trim());

  function setAssetSummary(updates: Record<string, unknown>): void {
    setForm((current) => ({
      ...current,
      summary: buildAssetSemanticSummary({ ...(current.summary ?? {}), ...updates }),
    }));
  }

  function applyAssetMode(nextMode: AssetPresetMode): void {
    const nextSource = getDefaultAssetSource(nextMode, runtimeBondSources);
    setAssetMode(nextMode);
    setSelectedSourceId(nextSource.id);
    setSourceQuery('');
    setForm(buildAssetFormFromPreset(nextMode, nextSource));
    syncAssetModeToHash(nextMode);
  }

  function selectAssetSource(source: AssetPresetSource): void {
    setSelectedSourceId(source.id);
    setSourceQuery('');
    setForm(buildAssetFormFromPreset(assetMode, source));
  }

  function togglePortfolioRole(role: string): void {
    const nextRoles = selectedRoles.includes(role)
      ? selectedRoles.filter((item) => item !== role)
      : [...selectedRoles, role];
    setAssetSummary({ portfolio_roles: nextRoles.length > 0 ? nextRoles : getDefaultRoleValues(assetMode) });
  }

  async function handleSubmit(): Promise<void> {
    if (!form.name.trim() || !form.symbol.trim() || !form.source_snapshot_id.trim()) {
      setError('请先补齐资产腿名称、标识与来源快照。');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        ...form,
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        source_snapshot_id: form.source_snapshot_id.trim(),
        source_provider: form.source_provider?.trim() || null,
        notes: form.notes?.trim() || null,
        summary: buildAssetSemanticSummary(form.summary),
      });
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DrawerShell
      headerActions={(
        <div className="leg-inventory-drawer__actions">
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={submitting || !canSubmitAsset}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {submitting ? '提交中...' : '保存并加入库'}
          </button>
          <button aria-label="关闭抽屉" className="leg-inventory-drawer__x" onClick={onClose} type="button">
            ×
          </button>
        </div>
      )}
      icon={modeConfig.icon}
      onClose={onClose}
      subtitle={drawerSubtitle}
      title="创建资产腿"
    >
      <div className="leg-inventory-drawer__body" data-drawer-kind="asset">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__section-header">
            <strong>资产类型</strong>
          </div>
          <div className="leg-inventory-asset-segmented" role="tablist" aria-label="资产类型">
            {([
              { value: 'bond', label: '债券' },
              { value: 'equity', label: '股票' },
            ] as Array<{ value: AssetPresetMode; label: string }>).map((item) => (
              <button
                aria-selected={assetMode === item.value}
                className={assetMode === item.value ? 'leg-inventory-asset-segmented__button leg-inventory-asset-segmented__button--active' : 'leg-inventory-asset-segmented__button'}
                key={item.value}
                onClick={() => applyAssetMode(item.value)}
                role="tab"
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__section-header">
            <strong>来源选择</strong>
            <span className={assetMode === 'equity' ? 'leg-inventory-status' : 'leg-inventory-status leg-inventory-status--success'}>
              {assetMode === 'equity' ? '等待接入' : '就绪'}
            </span>
          </div>
          <div className="leg-inventory-source-search">
            <label htmlFor="asset-leg-source-search">快照 ID</label>
            <div className="leg-inventory-source-search__shell">
              <span aria-hidden="true">⌕</span>
              <input
                id="asset-leg-source-search"
                onChange={(event) => setSourceQuery(event.target.value)}
                placeholder="输入快照 ID、中文名或标签"
                value={sourceQuery}
              />
              <span aria-hidden="true">▾</span>
            </div>
          </div>
          <div className={sourceStackClassName}>
            {visibleSources.length > 0 ? (
              visibleSources.map((source) => (
                <button
                  aria-pressed={source.id === form.source_snapshot_id}
                  className={`leg-inventory-source-choice${
                    source.id === form.source_snapshot_id ? ' leg-inventory-source-choice--active' : ''
                  }`}
                  key={source.id}
                  onClick={() => selectAssetSource(source)}
                  type="button"
                >
                  <div className="leg-inventory-source-choice__top">
                    <div className="leg-inventory-source-choice__copy">
                      <strong>{getAssetSourceCardName(source)}</strong>
                      <span>{source.short}</span>
                    </div>
                    <span className="leg-inventory-status leg-inventory-status--success">就绪</span>
                  </div>
                  <div className="leg-inventory-source-chip-row">
                    {source.tags.map((chip, index) => (
                      <span
                        className={`leg-inventory-chip${index === 0 ? ' leg-inventory-chip--accent' : ''}${assetMode === 'equity' && index > 0 ? ' leg-inventory-chip--warning' : ''}`}
                        key={chip}
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </button>
              ))
            ) : (
              <div className="leg-inventory-source-empty">
                <strong>
                  {assetMode === 'equity' ? '权益资产腿尚未接入正式运行时快照源' : '未找到匹配快照'}
                </strong>
                <span>
                  {assetMode === 'equity'
                    ? 'Phase 1.1 仅允许从 bond_fixed_income eligible_instruments 创建资产腿。'
                    : '请按快照 ID、中文名或标签重新检索。'}
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__section-header">
            <strong>身份与角色</strong>
            <span className="leg-inventory-status leg-inventory-status--success">{modeConfig.roleTone}</span>
          </div>
          <div className="leg-inventory-drawer__field-grid">
            <div className="leg-inventory-drawer__field">
              <label htmlFor="asset-leg-name">腿名称</label>
              <input
                id="asset-leg-name"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                value={form.name}
              />
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="asset-leg-symbol">资产标识</label>
              <input
                id="asset-leg-symbol"
                onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))}
                value={form.symbol}
              />
            </div>
            <div className="leg-inventory-drawer__field">
              <strong>来源快照</strong>
              <span className="leg-inventory-drawer__mono">{form.source_snapshot_id}</span>
            </div>
            <div className="leg-inventory-drawer__field">
              <strong>来源页</strong>
              <span>{modeConfig.sourcePage}</span>
            </div>
            <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
              <strong>组合角色</strong>
              <div className="leg-inventory-role-row">
                {modeConfig.roles.map((role) => (
                  <button
                    aria-pressed={selectedRoles.includes(role.value)}
                    className={selectedRoles.includes(role.value) ? 'leg-inventory-role-pill leg-inventory-role-pill--active' : 'leg-inventory-role-pill'}
                    key={role.value}
                    onClick={() => togglePortfolioRole(role.value)}
                    type="button"
                  >
                    {role.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__section-header">
            <strong>核心规则</strong>
            <span className="leg-inventory-status leg-inventory-status--success">{modeConfig.slotBadge}</span>
          </div>
          <div className="leg-inventory-drawer__field-grid">
            <div className="leg-inventory-drawer__field">
              <strong>估值口径</strong>
              <span>{selectedRuleSource.valuationLabel}</span>
            </div>
            <div className="leg-inventory-drawer__field">
              <strong>再平衡倾向</strong>
              <span>{selectedRuleSource.rebalanceLabel}</span>
            </div>
            <div className="leg-inventory-drawer__field">
              <strong>维护节奏</strong>
              <span>{selectedRuleSource.cadenceLabel}</span>
            </div>
            <div className="leg-inventory-drawer__field">
              <strong>冻结设置</strong>
              <span>按来源继承</span>
            </div>
          </div>
          <div className="leg-inventory-rule-slot">
            <div className="leg-inventory-rule-slot__header">
              <strong>{modeConfig.slotTitle}</strong>
              <span className="leg-inventory-status leg-inventory-status--success">{modeConfig.slotBadge}</span>
            </div>
            <div className="leg-inventory-rule-slot__grid">
              {selectedRuleSource.slots.map((slot) => (
                <div className="leg-inventory-rule-slot__item" key={slot.label}>
                  <span>{slot.label}</span>
                  <strong>{slot.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__section-header">
            <strong>验证摘要</strong>
            <span className="leg-inventory-status leg-inventory-status--success">已校验</span>
          </div>
          <div className="leg-inventory-drawer__kpi-grid">
            {selectedRuleSource.kpis.map((kpi) => (
              <div className="leg-inventory-drawer__kpi" key={kpi.label}>
                <span>{kpi.label}</span>
                <strong>{kpi.value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DrawerShell>
  );
}

export function CashLegDrawer({
  initialRow = null,
  mode = 'create',
  open,
  onClose,
  onSubmit,
}: CashLegDrawerProps): JSX.Element | null {
  const [form, setForm] = useState<ApiCashLegCreatePayload>(() => cloneCashForm(DEFAULT_CASH_FORM));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialRow ? buildCashFormFromRow(initialRow) : cloneCashForm(DEFAULT_CASH_FORM));
      setSubmitting(false);
      setError(null);
    }
  }, [initialRow, open]);

  if (!open) {
    return null;
  }

  const cashSummary = buildCashSemanticSummary(form.summary);
  const cashDrawerSubtitle =
    mode === 'copy'
      ? '复制会创建新的现金腿定义；请至少修改一个核心参数，单独改名不会绕过重复校验。'
      : '定义现金、BOXX 或 T-BILL 来源，并固定目标占比、损耗阈值和再平衡频次。';

  function setCashSummary(updates: Record<string, unknown>): void {
    setForm((current) => ({
      ...current,
      summary: buildCashSemanticSummary({ ...(current.summary ?? {}), ...updates }),
    }));
  }

  async function handleSubmit(): Promise<void> {
    if (!form.name.trim() || !form.cash_rule_kind.trim() || !form.freeze_mode.trim()) {
      setError('请先补齐现金腿名称、规则类型与冻结方式。');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        ...form,
        name: form.name.trim(),
        cash_rule_kind: form.cash_rule_kind.trim().toUpperCase().replace('-', '_'),
        yield_source: form.yield_source?.trim() || null,
        notes: form.notes?.trim() || null,
        summary: buildCashSemanticSummary(form.summary),
      });
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DrawerShell
      headerActions={(
        <div className="leg-inventory-drawer__actions">
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={submitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {submitting ? '提交中...' : '保存现金腿'}
          </button>
          <button aria-label="关闭抽屉" className="leg-inventory-drawer__x" onClick={onClose} type="button">
            ×
          </button>
        </div>
      )}
      icon="现"
      onClose={onClose}
      subtitle={cashDrawerSubtitle}
      title="创建现金腿"
    >
      <div className="leg-inventory-drawer__body" data-drawer-kind="cash">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__section-header">
            <div className="leg-inventory-drawer__copy">
              <strong>身份定义</strong>
              <p>明确现金腿的职责、缓冲边界与组合定位，确保维护语义可追溯。</p>
            </div>
            <span className="leg-inventory-status">现金腿</span>
          </div>
          <div className="leg-inventory-drawer__field-grid">
            <div className="leg-inventory-drawer__field">
              <strong>腿名称</strong>
              <span>{form.name}</span>
            </div>
            <div className="leg-inventory-drawer__field">
              <strong>来源规则</strong>
              <span>维护性现金缓冲，不直接承担收益职责。</span>
            </div>
          </div>
          <div className="leg-inventory-drawer__field-grid">
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-name">腿名称</label>
              <input
                id="cash-leg-name"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                value={form.name}
              />
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-rule">来源规则</label>
              <select
                id="cash-leg-rule"
                onChange={(event) => {
                  const cashRuleKind = event.target.value;
                  setForm((current) => ({
                    ...current,
                    cash_rule_kind: cashRuleKind,
                    yield_source: cashRuleKind.toLowerCase(),
                  }));
                }}
                value={form.cash_rule_kind}
              >
                {CASH_RULE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-target-weight">目标占比</label>
              <input
                id="cash-leg-target-weight"
                min="0"
                onChange={(event) => setCashSummary({ target_weight_pct: Number(event.target.value) })}
                step="1"
                type="number"
                value={String(cashSummary.target_weight_pct ?? 20)}
              />
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-buffer-bps">调仓损耗触发阈值</label>
              <input
                id="cash-leg-buffer-bps"
                min="0"
                onChange={(event) => setForm((current) => ({ ...current, buffer_bps: Number(event.target.value) }))}
                step="1"
                type="number"
                value={String(form.buffer_bps ?? 12)}
              />
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-rebalance-frequency">再平衡频次</label>
              <select
                id="cash-leg-rebalance-frequency"
                onChange={(event) => setCashSummary({ rebalance_frequency: event.target.value })}
                value={String(cashSummary.rebalance_frequency)}
              >
                {CASH_REBALANCE_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-freeze">冻结方式</label>
              <input
                id="cash-leg-freeze"
                onChange={(event) => setForm((current) => ({ ...current, freeze_mode: event.target.value }))}
                value={form.freeze_mode}
              />
            </div>
            <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
              <label htmlFor="cash-leg-notes">备注</label>
              <textarea
                id="cash-leg-notes"
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                value={form.notes ?? ''}
              />
            </div>
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__section-header">
            <div className="leg-inventory-drawer__copy">
              <strong>核心参数</strong>
              <p>把目标占比、触发阈值和冻结方式明确定义成一组可审计规则。</p>
            </div>
            <span className="leg-inventory-status leg-inventory-status--accent">规则定义</span>
          </div>
          <div className="leg-inventory-drawer__field-grid">
            <div className="leg-inventory-drawer__field">
              <strong>目标占比</strong>
              <span>20%</span>
            </div>
            <div className="leg-inventory-drawer__field">
              <strong>触发阈值</strong>
              <span>换手高于 12 bps 时优先吸收调仓磨损。</span>
            </div>
            <div className="leg-inventory-drawer__field">
              <strong>再平衡频次</strong>
              <span>季度。与工作台维护节奏完全同语义。</span>
            </div>
            <div className="leg-inventory-drawer__field">
              <strong>冻结方式</strong>
              <span>随组合版本一起冻结，回看时可解释为什么保留现金。</span>
            </div>
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__section-header">
            <div className="leg-inventory-drawer__copy">
              <strong>验证摘要</strong>
              <p>现金腿不是空白占位，而是对维护成本和组合成立性产生真实影响的来源对象。</p>
            </div>
            <span className="leg-inventory-status leg-inventory-status--success">就绪</span>
          </div>
          <div className="leg-inventory-drawer__kpi-grid">
            <div className="leg-inventory-drawer__kpi">
              <span>缓冲能力</span>
              <strong>{Math.round(form.buffer_bps ?? 0)} bps</strong>
              <small>可覆盖当前季度换手</small>
            </div>
            <div className="leg-inventory-drawer__kpi">
              <span>现金占比</span>
              <strong>{Math.round(Number(cashSummary.target_weight_pct ?? 20))}%</strong>
              <small>控制组合集中度</small>
            </div>
            <div className="leg-inventory-drawer__kpi">
              <span>维护判断</span>
              <strong>稳定</strong>
              <small>适合正式入库</small>
            </div>
          </div>
        </section>
      </div>
    </DrawerShell>
  );
}
