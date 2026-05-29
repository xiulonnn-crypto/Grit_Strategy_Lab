import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApiBondSnapshotEligibleInstrument,
  ApiDatasetSnapshot,
  ApiSnapshotJob,
  ApiSnapshotOverview,
  ApiSnapshotProviderAttempts,
  ApiSnapshotProviderRegistry,
  ApiSnapshotProviderRegistryItem,
  ApiSnapshotRefreshRequest,
  ApiUniverseSnapshot,
  SnapshotRefreshTarget,
} from '../types';

type LayerId = 'l1' | 'l2' | 'l3' | 'l4';
type LedgerKind = 'dataset' | 'universe' | 'bond';

type SnapshotOperationsConsoleProps = {
  overview: ApiSnapshotOverview | null;
  providerRegistry: ApiSnapshotProviderRegistry | null;
  providerAttempts: ApiSnapshotProviderAttempts | null;
  providerRegistryError?: string | null;
  highlightTarget?: string;
  openRefreshLogToken?: number;
  onRefresh: (payload?: ApiSnapshotRefreshRequest) => void;
  refreshDisabled: boolean;
  refreshLabel: string;
  onCreateBondAssetLeg?: (instrument: ApiBondSnapshotEligibleInstrument) => void;
  creatingBondAssetLegId?: string | null;
  createAssetLegError?: string | null;
  createAssetLegMessage?: string | null;
};

type LayerCard = {
  id: LayerId;
  title: string;
  subtitle: string;
  status: string;
  statusLabel: string;
  metric: string;
  metricLines?: string[];
  miniRows: Array<{ label: string; value: string }>;
  action: string;
  refreshTargets: SnapshotRefreshTarget[];
};

type DataLayerReadiness = NonNullable<ApiSnapshotOverview['data_layer_readiness']>[number];

type LedgerRow = {
  id: string;
  kind: LedgerKind;
  name: string;
  layerId: LayerId;
  status: string;
  coverage: string;
  source: string;
  currentRows: string;
  thisRun: string;
  nextAction: string;
  repairTarget?: SnapshotRefreshTarget;
  dataset?: ApiDatasetSnapshot;
  universe?: ApiUniverseSnapshot;
};

type SourceDrillModule = {
  id: string;
  sourceId: string;
  layerId: LayerId;
  layerTitle: string;
  title: string;
  status: string;
  statusLabel: string;
  existingData: string;
  completeness: string;
  missingData: string;
  blocker: string;
  nextAction: string;
  refreshTargets: SnapshotRefreshTarget[];
};

type CredentialRow = {
  id: string;
  providerId: string;
  sourceName: string;
  category: 'usable' | 'limited' | 'invalid' | 'missing_path' | 'disabled' | 'unavailable';
  statusLabel: string;
  keyLabel: string;
  targetLabel: string;
  detail: string;
  actionLabel: string;
  actionKind: 'replace_key' | 'configure_path' | 'view_window' | 'view_source' | 'noop';
  item?: ApiSnapshotProviderRegistryItem;
};

type QueueItem = {
  id: string;
  title: string;
  body: string;
  pills: string[];
  action: string;
  actionKind: 'repair_l1' | 'configure_path' | 'view_ledger';
  credentialProviderId?: string;
};

type CredentialDisplayRow = {
  id: string;
  key: string;
  source: string;
  configLabel: string;
  configTone: string;
  statusLabel: string;
  statusTone: string;
  impact: string;
  actionLabel: string;
  actionKind: CredentialRow['actionKind'];
  credential?: CredentialRow;
};

const LAYER_LABELS: Record<LayerId, string> = {
  l1: 'L1 基础行情',
  l2: 'L2 财务截面',
  l3: 'L3 分析师与情绪',
  l4: 'L4 宏观与衍生品',
};

const DATASET_NAME: Record<string, string> = {
  'ds-price': '价格历史',
  'ds-corporate-actions': '公司行动',
  'ds-index-valuations': '指数估值',
  'ds-fundamentals': '财务基本面',
  'ds-analyst-consensus': '分析师一致预期',
  'ds-short-volume': '卖空成交',
  'ds-macro-rates': '宏观利率',
  'ds-option-skew': '期权偏斜',
};

const DRILL_SOURCE_NAME: Record<string, string> = {
  'ds-price': '价格历史',
  'ds-corporate-actions': '公司行为',
  'ds-fundamentals': '财务截面',
  'ds-analyst-consensus': '分析师一致预期',
  'ds-short-volume': '卖空量',
  'ds-macro-rates': '宏观利率',
  'ds-option-skew': '期权偏度',
};

const TARGET_BY_SNAPSHOT: Record<string, SnapshotRefreshTarget> = {
  'ds-price': 'price',
  'ds-corporate-actions': 'corporate',
  'ds-index-valuations': 'valuations',
  'ds-fundamentals': 'fundamentals',
  'ds-analyst-consensus': 'sentiment',
  'ds-short-volume': 'sentiment',
  'ds-macro-rates': 'macro_derivatives',
  'ds-option-skew': 'macro_derivatives',
};

const DRILL_SOURCE_SPECS: Array<{
  id: string;
  layerId: LayerId;
  nextAction: string;
  refreshTargets: SnapshotRefreshTarget[];
}> = [
  {
    id: 'ds-price',
    layerId: 'l1',
    nextAction: '刷新价格主链，补齐缺失标的的 10Y 价格历史，再复核长周期补价队列。',
    refreshTargets: ['price'],
  },
  {
    id: 'ds-corporate-actions',
    layerId: 'l1',
    nextAction: '补齐公司行为和复权链；若来源限流，查看底部凭据与重试窗口后再刷新。',
    refreshTargets: ['corporate'],
  },
  {
    id: 'ds-fundamentals',
    layerId: 'l2',
    nextAction: '刷新财务截面并复核发布时点门禁，保留财务平衡校验观察项。',
    refreshTargets: ['fundamentals'],
  },
  {
    id: 'ds-analyst-consensus',
    layerId: 'l3',
    nextAction: '刷新分析师一致预期，确认覆盖窗口和可研究标的范围。',
    refreshTargets: ['sentiment'],
  },
  {
    id: 'ds-short-volume',
    layerId: 'l3',
    nextAction: '刷新卖空量链路，确认 FINRA 文件窗口与缺失交易日。',
    refreshTargets: ['sentiment'],
  },
  {
    id: 'ds-macro-rates',
    layerId: 'l4',
    nextAction: '先完成 L1 样本池门禁；若宏观源异常，再刷新宏观利率来源。',
    refreshTargets: ['macro_derivatives'],
  },
  {
    id: 'ds-option-skew',
    layerId: 'l4',
    nextAction: '先完成 L1 样本池门禁；若期权源异常，再刷新期权偏度来源。',
    refreshTargets: ['macro_derivatives'],
  },
];

const BLOCKER_LABELS: Record<string, string> = {
  PRICE_SNAPSHOT_INCOMPLETE: '价格快照覆盖不足',
  CORPORATE_ACTIONS_INCOMPLETE: '公司行动覆盖不足',
  FUNDAMENTALS_INCOMPLETE: '财务基本面覆盖不足',
  ANALYST_CONSENSUS_INCOMPLETE: '一致预期覆盖不足',
  SHORT_VOLUME_INCOMPLETE: '卖空成交覆盖不足',
  MACRO_RATES_INCOMPLETE: '宏观利率覆盖不足',
  OPTION_SKEW_INCOMPLETE: '期权偏斜覆盖不足',
};

const SOURCE_LABELS: Record<string, string> = {
  akshare_us: 'AkShare US',
  alpha_vantage: 'Alpha Vantage',
  bond_fixed_income: '债券基础行情',
  blackrock_ishares_official: 'BlackRock iShares Official',
  crsp_us_stock: 'CRSP 本地股票',
  eodhd: 'EODHD',
  edgartools: 'Edgartools',
  fallback_unavailable: '无可用补源',
  finnhub: 'Finnhub',
  finra_short_volume: 'FINRA Short Volume',
  fmp: 'Financial Modeling Prep',
  fmp_historical_constituent: 'FMP Historical Constituents',
  fred_macro_series: 'FRED Macro Series',
  mixed_fallbacks: '混合补源',
  mixed_sources: '混合来源',
  norgate_us_equities: 'Norgate US Equities',
  openbb_bond_fixed_income: 'OpenBB 债券基础行情',
  polygon: 'Polygon.io',
  sec_edgar: 'SEC EDGAR',
  sp_global_official_constituent_change: 'S&P 官方成分变更',
  stooq: 'Stooq',
  tiingo: 'Tiingo',
  us_treasury_xml: 'US Treasury XML',
  wikipedia_revision_history: 'Wikipedia 修订历史',
  worldperatio: 'World PE Ratio',
  yahoo: 'Yahoo Finance',
  yfinance: 'yfinance',
};

const TARGET_TYPE_LABELS: Record<string, string> = {
  bond_fixed_income: '债券基础行情',
  corporate_actions: '公司行动',
  delisted_price_history: '退市价格',
  delisted_returns: '退市收益',
  earnings_expectations: '盈利预期',
  filings: '财报备案',
  fillings: '财报备案',
  fundamentals: '财务基本面',
  historical_constituents: '历史成分',
  identity: '标的身份',
  macro_series: '宏观序列',
  option_skew: '期权偏斜',
  price: '价格',
  price_history: '价格历史',
  short_volume: '卖空成交',
  targeted_price_repair: '定向价格修复',
  universe_history: '股票池历史',
};

const REFRESH_TARGET_LABELS: Record<string, string> = {
  bond: '债券基础行情',
  corporate: '公司行动',
  fundamentals: '财务基本面',
  macro_derivatives: '宏观与衍生品',
  price: '价格历史',
  sentiment: '情绪与微观结构',
  universes: '股票池',
  valuations: '指数估值',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = getNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function formatCount(value: unknown): string {
  const numberValue = getNumber(value);
  if (numberValue === null) {
    return '0';
  }
  return new Intl.NumberFormat('zh-CN').format(numberValue);
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '未记录';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function statusLabel(status?: string | null): string {
  switch (String(status ?? '').toUpperCase()) {
    case 'READY':
    case 'COMPLETED':
    case 'USABLE':
    case 'AVAILABLE':
      return '可用';
    case 'RUNNING':
      return '刷新中';
    case 'STALE':
      return '待刷新';
    case 'INCOMPLETE':
    case 'PARTIAL':
    case 'PARTIAL_READY':
      return '部分可用';
    case 'FAILED':
    case 'BLOCKED':
      return '异常';
    case 'DISABLED':
      return '停用';
    default:
      return status ? String(status) : '未知';
  }
}

function statusTone(status?: string | null): string {
  switch (String(status ?? '').toUpperCase()) {
    case 'READY':
    case 'COMPLETED':
    case 'PASS':
    case 'USABLE':
    case 'AVAILABLE':
      return 'ready';
    case 'STALE':
    case 'INCOMPLETE':
    case 'PARTIAL':
    case 'PARTIAL_READY':
    case 'WARN':
    case 'WARNING':
      return 'warning';
    case 'FAILED':
    case 'BLOCKED':
    case 'FAIL':
      return 'danger';
    case 'RUNNING':
      return 'running';
    default:
      return 'neutral';
  }
}

function healthCardStatusLabel(status?: string | null): string {
  return statusTone(status) === 'ready' ? '已就绪' : statusLabel(status);
}

function hasKnownNonReadyStatus(status?: string | null): boolean {
  const normalized = String(status ?? '').toUpperCase();
  return Boolean(normalized) && normalized !== 'READY';
}

function getDatasetCoverage(dataset?: ApiDatasetSnapshot): string {
  if (!dataset) {
    return '0/0';
  }
  const fundamentalEffectiveCoverage = getFundamentalEffectiveCoverage(dataset);
  if (fundamentalEffectiveCoverage) {
    return fundamentalEffectiveCoverage;
  }
  const metadata = asRecord(dataset.metadata);
  const benchmark = asRecord(metadata.benchmark_etf_coverage);
  const covered =
    firstNumber(metadata, ['covered_symbol_count', 'raw_covered_symbol_count', 'effective_covered_symbol_count']) ??
    firstNumber(benchmark, ['ready_count']);
  const total = firstNumber(metadata, ['total_symbol_count']) ?? firstNumber(benchmark, ['total_count']);
  if (covered !== null && total !== null) {
    return `${formatCount(covered)}/${formatCount(total)}`;
  }
  return dataset.row_count ? `${formatCount(dataset.row_count)} 行` : '未计量';
}

function getFundamentalEffectiveCoverage(dataset?: ApiDatasetSnapshot): string | null {
  if (!dataset || dataset.id !== 'ds-fundamentals') {
    return null;
  }
  const metadata = asRecord(dataset.metadata);
  const policy = asRecord(metadata.fundamental_gap_policy);
  const pct = firstNumber(metadata, ['effective_coverage_pct']) ?? firstNumber(policy, ['logical_coverage_pct']);
  if (pct !== null) {
    return `${pct.toFixed(1)}%`;
  }
  const covered =
    firstNumber(metadata, ['effective_covered_symbol_count']) ??
    firstNumber(policy, ['logical_covered_symbol_count']);
  const total =
    firstNumber(metadata, ['effective_total_symbol_count']) ??
    firstNumber(policy, ['logical_total_symbol_count']) ??
    firstNumber(metadata, ['total_symbol_count']);
  if (covered !== null && total !== null) {
    return `${formatCount(covered)}/${formatCount(total)}`;
  }
  return null;
}

function getBondCoverage(overview: ApiSnapshotOverview | null): string {
  const instruments = overview?.bond_fixed_income?.eligible_instruments ?? [];
  const ready = instruments.filter((item) => String(item.status).toUpperCase() === 'READY').length;
  return `${ready}/${instruments.length}`;
}

function blockerLabel(code?: string | null): string {
  if (!code) {
    return '无阻塞';
  }
  return BLOCKER_LABELS[code] ?? code.replaceAll('_', ' ').toLowerCase();
}

function sourceKeyLabel(key?: string | null): string {
  if (!key) {
    return '未记录';
  }
  const normalized = String(key).trim();
  return SOURCE_LABELS[normalized] ?? normalized;
}

function sourceLabel(primary?: string | null, fallback?: string | null): string {
  const first = sourceKeyLabel(primary);
  return fallback ? `${first} / ${sourceKeyLabel(fallback)}` : first;
}

function formatTargetTypes(targets: string[]): string {
  return targets.map((target) => TARGET_TYPE_LABELS[target] ?? target).join(' / ') || '未绑定';
}

function refreshModeLabel(mode?: unknown): string {
  switch (String(mode ?? '').toLowerCase()) {
    case 'repair':
      return '修复模式';
    case 'refresh':
      return '刷新模式';
    case 'full':
      return '全量模式';
    default:
      return '未记录模式';
  }
}

function formatRefreshTargets(targets: unknown[]): string {
  return targets.map((target) => REFRESH_TARGET_LABELS[String(target)] ?? String(target)).join(' / ') || '未记录目标';
}

function attemptMessageLabel(message?: unknown): string | null {
  if (!message) {
    return null;
  }
  const text = String(message);
  const normalized = text.toLowerCase();
  if (normalized.includes('invalid_credentials')) {
    return 'key 无效';
  }
  if (normalized.includes('rate limit') || normalized.includes('rate_limited') || normalized.includes('quota')) {
    return '配额或频率受限';
  }
  if (normalized.includes('cooldown')) {
    return '等待冷却窗口';
  }
  if (normalized.includes('credential missing')) {
    return '凭据缺失';
  }
  if (normalized.includes('class_not_found')) {
    return '本机来源未加载';
  }
  if (normalized.includes('not installed')) {
    return '本机来源未安装';
  }
  if (normalized.includes('entitlement_required')) {
    return '账号权限不足';
  }
  if (normalized.includes('no_history')) {
    return '未返回历史数据';
  }
  if (normalized.includes('symbol_invalid')) {
    return '标的不可用';
  }
  if (normalized.includes('http error 429') || normalized.includes('too many requests')) {
    return '配额或频率受限';
  }
  if (normalized.includes('unavailable')) {
    return '来源不可用';
  }
  return '来源返回诊断';
}

function layerForTarget(target?: string | null): LayerId {
  const normalized = String(target ?? '').toLowerCase();
  if (
    normalized.includes('ds-price') ||
    normalized.includes('ds-corporate-actions') ||
    normalized.includes('bond_fixed_income') ||
    normalized === 'bond' ||
    normalized === 'l1'
  ) {
    return 'l1';
  }
  if (normalized.includes('ds-fundamentals') || normalized === 'l2') {
    return 'l2';
  }
  if (
    normalized.includes('ds-analyst-consensus') ||
    normalized.includes('ds-short-volume') ||
    normalized === 'l3'
  ) {
    return 'l3';
  }
  if (normalized.includes('ds-macro-rates') || normalized.includes('ds-option-skew') || normalized === 'l4') {
    return 'l4';
  }
  return 'l1';
}

function refreshStats(overview: ApiSnapshotOverview | null): Record<string, unknown> {
  return asRecord(overview?.latest_job?.summary).refresh_stats
    ? asRecord(asRecord(overview?.latest_job?.summary).refresh_stats)
    : {};
}

function findRefreshEntry(overview: ApiSnapshotOverview | null, id: string): Record<string, unknown> | null {
  const stats = refreshStats(overview);
  const buckets = [
    asRecord(stats.datasets),
    asRecord(stats.dataset_snapshots),
    asRecord(stats.universes),
    asRecord(stats.universe_snapshots),
    asRecord(stats.bond_fixed_income),
  ];
  for (const bucket of buckets) {
    if (bucket[id]) {
      return asRecord(bucket[id]);
    }
    for (const value of Object.values(bucket)) {
      const record = asRecord(value);
      if (record.id === id || record.snapshot_id === id || record.dataset_id === id) {
        return record;
      }
    }
  }
  return null;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function summarizeRefreshEntry(entry: Record<string, unknown> | null, label?: string): string {
  if (!entry) {
    return '本次未入库';
  }
  const rows = firstNumber(entry, [
    'rows_inserted',
    'new_rows',
    'rows_added',
    'updated_row_count',
    'landed_row_count',
    'records_inserted',
    'inserted_count',
    'added_count',
    'created_count',
  ]);
  const symbols = firstNumber(entry, [
    'symbols_inserted',
    'new_symbols',
    'updated_symbol_count',
    'landed_symbol_count',
    'member_count_delta',
    'members_inserted',
    'new_members',
  ]);
  const prefix = label ? `${label}新增` : '新增';
  if (rows !== null) {
    return `${prefix} ${formatCount(rows)} 行数据`;
  }
  if (symbols !== null) {
    return `${prefix} ${formatCount(symbols)} 标的数据`;
  }
  return label ? `${label}已记录入库` : '已记录入库';
}

function summarizeRefreshSource(entry: Record<string, unknown> | null, fallback: string): string {
  if (!entry) {
    return fallback;
  }
  const source =
    entry.source ??
    entry.provider ??
    entry.selected_provider ??
    entry.ingest_source ??
    entry.provider_id ??
    entry.source_name;
  return source ? sourceKeyLabel(String(source)) : fallback;
}

function getDataset(overview: ApiSnapshotOverview | null, id: string): ApiDatasetSnapshot | undefined {
  return overview?.dataset_snapshots.find((item) => item.id === id);
}

function getLayerReadiness(overview: ApiSnapshotOverview | null, layerId: string): DataLayerReadiness | undefined {
  return overview?.data_layer_readiness?.find((item) => item.layer_id === layerId);
}

function getMetricValue(metrics: unknown, labels: string[]): string | null {
  for (const item of asArray(metrics)) {
    const metric = asRecord(item);
    const identifiers = [metric.metric_id, metric.id, metric.key, metric.label].map((value) => String(value ?? ''));
    if (!identifiers.some((identifier) => labels.includes(identifier))) {
      continue;
    }
    const value = metric.value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return formatCount(value);
    }
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function getLayerMetricValue(layer: DataLayerReadiness | undefined, labels: string[]): string | null {
  if (!layer) {
    return null;
  }
  const directValue = getMetricValue(layer.metrics, labels);
  return directValue ?? getMetricValue(asRecord(layer).pit_metrics, labels);
}

function getLayerPitMetricValue(layer: DataLayerReadiness | undefined, labels: string[]): string | null {
  if (!layer) {
    return null;
  }
  return getMetricValue(asRecord(layer).pit_metrics, labels);
}

function getL1CoverageMetric(
  overview: ApiSnapshotOverview | null,
  price: ApiDatasetSnapshot | undefined,
  bondCoverage: string,
): { metric: string; lines?: string[] } {
  const l1Layer = getLayerReadiness(overview, 'l1_market_data');
  const pitTarget = getLayerPitMetricValue(l1Layer, ['pit_admission_target', 'PIT目标', '覆盖标的']);
  const benchmarkOverlay = getLayerPitMetricValue(l1Layer, ['benchmark_etf', '基准ETF']);
  if (pitTarget && benchmarkOverlay) {
    return {
      metric: `股票 PIT ${pitTarget} + ETF ${benchmarkOverlay} · 债券 ${bondCoverage}`,
      lines: [`股票 PIT ${pitTarget}`, `ETF ${benchmarkOverlay} · 债券 ${bondCoverage}`],
    };
  }
  if (pitTarget) {
    return {
      metric: `股票 PIT ${pitTarget} · 债券 ${bondCoverage}`,
      lines: [`股票 PIT ${pitTarget}`, `债券 ${bondCoverage}`],
    };
  }
  return { metric: `股票 快照 ${getDatasetCoverage(price)} · 债券 ${bondCoverage}` };
}

function buildLayerCards(overview: ApiSnapshotOverview | null): LayerCard[] {
  const price = getDataset(overview, 'ds-price');
  const corporate = getDataset(overview, 'ds-corporate-actions');
  const fundamentals = getDataset(overview, 'ds-fundamentals');
  const l2Layer = getLayerReadiness(overview, 'l2_fundamental_data');
  const analyst = getDataset(overview, 'ds-analyst-consensus');
  const shortVolume = getDataset(overview, 'ds-short-volume');
  const macro = getDataset(overview, 'ds-macro-rates');
  const option = getDataset(overview, 'ds-option-skew');
  const bondStatus = overview?.bond_fixed_income?.global_pulse?.status ?? 'UNKNOWN';
  const hasL1DependencyGap = [price?.status, corporate?.status, bondStatus].some(hasKnownNonReadyStatus);
  const hasL4SourceGap = [macro?.status, option?.status].some(hasKnownNonReadyStatus);
  const hasL3SourceGap = [analyst?.status, shortVolume?.status].some((status) => status && status !== 'READY');
  const l1Status = hasL1DependencyGap ? 'INCOMPLETE' : 'READY';
  const l2Status = l2Layer?.status ?? fundamentals?.status ?? 'UNKNOWN';
  const l3Status = hasL3SourceGap ? 'INCOMPLETE' : 'READY';
  const l4Status = hasL4SourceGap ? 'INCOMPLETE' : 'READY';
  const fundamentalCoverageMetric =
    getLayerMetricValue(l2Layer, ['覆盖率']) ?? getLayerMetricValue(l2Layer, ['覆盖']) ?? getDatasetCoverage(fundamentals);
  const fundamentalFieldCount =
    getLayerMetricValue(l2Layer, ['可用字段', '字段数']) ??
    formatCount(firstNumber(asRecord(fundamentals?.metadata), ['field_count', 'field_count_total', 'ready_field_count']) ?? 18);
  const l1CoverageMetric = getL1CoverageMetric(overview, price, getBondCoverage(overview));

  return [
    {
      id: 'l1',
      title: 'L1 基础行情',
      subtitle: '10Y PIT 价格回放可用；固定收益运行态来源已就绪；30Y Full Ready 与公司行为补链仍在修复队列。',
      status: l1Status,
      statusLabel: healthCardStatusLabel(l1Status),
      metric: l1CoverageMetric.metric,
      metricLines: l1CoverageMetric.lines,
      miniRows: [
        { label: '可用于', value: '动量 / 波动 / 债券资产腿' },
        { label: '待修复', value: '公司行为、长历史补价' },
      ],
      action: hasL1DependencyGap ? '下钻缺口' : '查看债券证据',
      refreshTargets: ['price', 'corporate', 'bond'],
    },
    {
      id: 'l2',
      title: 'L2 财务截面',
      subtitle: l2Layer?.summary ?? '财务字段与发布时点门禁可进入质量、估值和稳健性因子研究。',
      status: l2Status,
      statusLabel: healthCardStatusLabel(l2Status),
      metric: fundamentalCoverageMetric,
      miniRows: [
        { label: '字段数', value: fundamentalFieldCount },
        { label: '观察项', value: fundamentals?.blocker ? blockerLabel(fundamentals.blocker.code) : '财务平衡校验' },
      ],
      action: fundamentals?.blocker ? '下钻观察项' : '查看观察项',
      refreshTargets: ['fundamentals'],
    },
    {
      id: 'l3',
      title: 'L3 分析师与情绪',
      subtitle: '一致预期与卖空微观结构已形成正式快照，可进入研究监测。',
      status: l3Status,
      statusLabel: healthCardStatusLabel(l3Status),
      metric: hasL3SourceGap ? `${getDatasetCoverage(analyst)} · ${getDatasetCoverage(shortVolume)}` : '3/3',
      miniRows: [
        { label: '一致预期', value: `${formatCount(analyst?.row_count)} 行` },
        { label: '卖空链路', value: `${formatCount(shortVolume?.row_count)} 行` },
      ],
      action: hasL3SourceGap ? '下钻缺口' : '查看证据',
      refreshTargets: ['sentiment'],
    },
    {
      id: 'l4',
      title: 'L4 宏观与衍生品',
      subtitle: '利率 Beta、IV Skew 可作为特征源；正式 IC 诊断依赖 L1 样本池门禁。',
      status: l4Status,
      statusLabel: healthCardStatusLabel(l4Status),
      metric: getDatasetCoverage(macro),
      miniRows: [
        { label: '可用', value: '利率、期权偏度' },
        {
          label: '上游依赖',
          value: macro?.blocker || option?.blocker
            ? blockerLabel(macro?.blocker?.code ?? option?.blocker?.code)
            : 'L1 样本池',
        },
      ],
      action: hasL4SourceGap ? '下钻缺口' : '查看证据',
      refreshTargets: ['macro_derivatives'],
    },
  ];
}

function getCoverageNumbers(dataset?: ApiDatasetSnapshot): { covered: number; total: number } | null {
  if (!dataset) {
    return null;
  }
  const metadata = asRecord(dataset.metadata);
  const policy = asRecord(metadata.fundamental_gap_policy);
  const benchmark = asRecord(metadata.benchmark_etf_coverage);
  const covered = dataset.id === 'ds-fundamentals'
    ? firstNumber(metadata, ['effective_covered_symbol_count']) ??
      firstNumber(policy, ['logical_covered_symbol_count']) ??
      firstNumber(metadata, ['covered_symbol_count', 'raw_covered_symbol_count'])
    : firstNumber(metadata, ['covered_symbol_count', 'raw_covered_symbol_count', 'effective_covered_symbol_count']) ??
      firstNumber(benchmark, ['ready_count']);
  const total = dataset.id === 'ds-fundamentals'
    ? firstNumber(metadata, ['effective_total_symbol_count']) ??
      firstNumber(policy, ['logical_total_symbol_count']) ??
      firstNumber(metadata, ['total_symbol_count'])
    : firstNumber(metadata, ['total_symbol_count']) ?? firstNumber(benchmark, ['total_count']);
  return covered !== null && total !== null ? { covered, total } : null;
}

function getCompletenessText(dataset?: ApiDatasetSnapshot): string {
  if (!dataset) {
    return '0/0，未返回快照记录';
  }
  const coverage = getCoverageNumbers(dataset);
  if (!coverage || coverage.total <= 0) {
    return getDatasetCoverage(dataset);
  }
  const ratio = Math.max(0, Math.min(100, (coverage.covered / coverage.total) * 100));
  return `${getDatasetCoverage(dataset)}，${ratio.toFixed(1)}%`;
}

function getMissingDataText(dataset?: ApiDatasetSnapshot, upstreamReason?: string | null): string {
  if (!dataset) {
    return '数据源未出现在快照 overview，缺完整入库记录。';
  }
  const coverage = getCoverageNumbers(dataset);
  if (coverage) {
    const missing = Math.max(0, coverage.total - coverage.covered);
    if (missing > 0) {
      return `缺 ${formatCount(missing)} 个标的或序列。`;
    }
  }
  if (dataset.blocker) {
    return blockerLabel(dataset.blocker.code);
  }
  if (upstreamReason) {
    return '本数据源覆盖完整；缺的是可用于正式诊断的 L1 样本池门禁。';
  }
  return '无显式覆盖缺口。';
}

function getBlockerText(dataset?: ApiDatasetSnapshot, upstreamReason?: string | null): string {
  if (!dataset) {
    return '快照 read model 未返回该数据源。';
  }
  if (dataset.blocker) {
    return blockerLabel(dataset.blocker.code);
  }
  if (hasKnownNonReadyStatus(dataset.status)) {
    return `${statusLabel(dataset.status)}，需查看 provider 尝试和刷新日志。`;
  }
  return upstreamReason ?? '无阻塞。';
}

function getExistingDataText(dataset?: ApiDatasetSnapshot): string {
  if (!dataset) {
    return '未返回行数、窗口或来源。';
  }
  const start = dataset.start_date ? `，窗口 ${dataset.start_date} 至 ${dataset.end_date ?? dataset.as_of ?? '未记录'}` : '';
  return `${formatCount(dataset.row_count)} 行${start}，来源 ${sourceLabel(dataset.source, dataset.fallback_source)}。`;
}

function buildDataSourceDrillModules(overview: ApiSnapshotOverview | null): SourceDrillModule[] {
  if (!overview) {
    return [];
  }

  return DRILL_SOURCE_SPECS.flatMap((spec) => {
    const dataset = getDataset(overview, spec.id);
    const sourceGap = !dataset || hasKnownNonReadyStatus(dataset.status) || Boolean(dataset.blocker);
    if (!sourceGap) {
      return [];
    }
    const sourceName = DRILL_SOURCE_NAME[spec.id] ?? DATASET_NAME[spec.id] ?? dataset?.name ?? spec.id;
    const status = dataset?.status ?? 'UNKNOWN';
    return [
      {
        id: `source-${spec.id}`,
        sourceId: spec.id,
        layerId: spec.layerId,
        layerTitle: LAYER_LABELS[spec.layerId],
        title: sourceName,
        status,
        statusLabel: statusLabel(status),
        existingData: getExistingDataText(dataset),
        completeness: getCompletenessText(dataset),
        missingData: getMissingDataText(dataset),
        blocker: getBlockerText(dataset),
        nextAction: spec.nextAction,
        refreshTargets: spec.refreshTargets,
      },
    ];
  });
}

function buildLedgerRows(overview: ApiSnapshotOverview | null): LedgerRow[] {
  if (!overview) {
    return [];
  }
  const visibleDatasetIds = [
    'ds-price',
    'ds-corporate-actions',
    'ds-fundamentals',
    'ds-analyst-consensus',
    'ds-short-volume',
    'ds-macro-rates',
    'ds-option-skew',
  ];
  const visibleDatasets = visibleDatasetIds
    .map((id) => getDataset(overview, id))
    .filter((dataset): dataset is ApiDatasetSnapshot => Boolean(dataset));
  const rows: LedgerRow[] = visibleDatasets.map((dataset) => {
    const entry = findRefreshEntry(overview, dataset.id);
    return {
      id: dataset.id,
      kind: 'dataset',
      name: DATASET_NAME[dataset.id] ?? dataset.name,
      layerId: layerForTarget(dataset.id),
      status: dataset.status,
      coverage: getDatasetCoverage(dataset),
      source: sourceLabel(dataset.source, dataset.fallback_source),
      currentRows: `${formatCount(dataset.row_count)} 行`,
      thisRun: summarizeRefreshEntry(entry),
      nextAction: dataset.blocker ? '下钻并修复' : '查看证据',
      repairTarget: dataset.blocker ? TARGET_BY_SNAPSHOT[dataset.id] : undefined,
      dataset,
    };
  });
  const bond = overview.bond_fixed_income;
  const bondEntry = findRefreshEntry(overview, 'bond_fixed_income');
  const bondStatus = bond?.global_pulse?.status ?? 'UNKNOWN';
  const bondSource = sourceKeyLabel(bond?.selected_source_summary?.primary_source ?? 'bond_fixed_income');
  const bondRepairTarget = bondStatus === 'READY' ? undefined : 'bond';
  rows.push(
    {
      id: 'bond_fixed_income::UST_CURVE',
      kind: 'bond',
      name: '美国国债曲线',
      layerId: 'l1',
      status: bondStatus,
      coverage: `${getBondCoverage(overview)} 可建腿`,
      source: bondSource,
      currentRows: `${formatCount(bond?.curve_preview?.length)} 曲线点`,
      thisRun: summarizeRefreshEntry(bondEntry),
      nextAction: '查看债券证据',
      repairTarget: bondRepairTarget,
    },
    {
      id: 'bond_fixed_income::TIPS_LQD',
      kind: 'bond',
      name: 'TIPS 与信用债代理',
      layerId: 'l1',
      status: bondStatus,
      coverage: `${getBondCoverage(overview)} 可建腿`,
      source: bondSource,
      currentRows: `${formatCount(bond?.eligible_instruments?.length)} 个工具`,
      thisRun: summarizeRefreshEntry(bondEntry),
      nextAction: '查看债券证据',
      repairTarget: bondRepairTarget,
    },
  );
  return rows;
}

function hasQuotaOrCooldown(item: ApiSnapshotProviderRegistryItem): boolean {
  const readiness = String(item.readiness_status ?? '').toLowerCase();
  const quota = asRecord(item.quota_cooldown);
  const latest = asRecord(item.latest_attempt);
  return (
    readiness.includes('cooldown') ||
    readiness.includes('quota') ||
    Boolean(quota.cooldown_active) ||
    Boolean(quota.quota_limited) ||
    Boolean(latest.cooldown_active) ||
    Boolean(latest.quota_limited)
  );
}

function buildCredentialRows(
  registry: ApiSnapshotProviderRegistry | null,
  attempts: ApiSnapshotProviderAttempts | null,
  error?: string | null,
): CredentialRow[] {
  if (error) {
    return [
      {
        id: 'registry-unavailable',
        providerId: 'provider-registry',
        sourceName: '配置源不可用',
        category: 'unavailable',
        statusLabel: '不可用',
        keyLabel: 'registry',
        targetLabel: 'provider-registry',
        detail: error,
        actionLabel: '稍后重试',
        actionKind: 'noop',
      },
    ];
  }
  if (!registry) {
    return [
      {
        id: 'registry-loading',
        providerId: 'provider-registry',
        sourceName: '凭据状态',
        category: 'unavailable',
        statusLabel: '未加载',
        keyLabel: 'registry',
        targetLabel: 'provider-registry',
        detail: '等待 provider-registry 返回真实状态。',
        actionLabel: '暂不处理',
        actionKind: 'noop',
      },
    ];
  }
  const latestByProvider = new Map<string, Record<string, unknown>>();
  for (const item of attempts?.items ?? []) {
    if (!latestByProvider.has(item.provider_id)) {
      latestByProvider.set(item.provider_id, item as unknown as Record<string, unknown>);
    }
  }
  const rows = registry.items.map((item) => {
    const required = item.credential_requirements.required_env_vars ?? [];
    const missing = item.credential_requirements.missing_env_vars ?? [];
    const keyLabel = missing[0] ?? required[0] ?? '无需 key';
    const latest = latestByProvider.get(item.provider_id);
    const hasMissingPath = missing.some((key) => key.toUpperCase().includes('PATH'));
    const hasPathCredential = required.some((key) => key.toUpperCase().includes('PATH'));
    const invalid = String(item.readiness_status ?? '').toLowerCase().includes('invalid');
    const limited = hasQuotaOrCooldown(item);
    const detailParts = [
      item.enabled ? '已启用' : '停用',
      item.usable ? '当前可用' : item.credential_ready ? '凭据已读取' : '凭据缺失',
      attemptMessageLabel(latest?.reason),
      attemptMessageLabel(latest?.error),
    ].filter(Boolean);

    let category: CredentialRow['category'] = 'disabled';
    let actionLabel = '暂不处理';
    let actionKind: CredentialRow['actionKind'] = 'noop';
    let status = '停用/观察';
    if (item.enabled && item.usable) {
      category = 'usable';
      status = '可用';
      actionLabel = '查看来源';
      actionKind = 'view_source';
    } else if (hasMissingPath) {
      category = 'missing_path';
      status = '缺失本机路径';
      actionLabel = '配置路径';
      actionKind = 'configure_path';
    } else if (item.credential_ready && !item.enabled && hasPathCredential) {
      status = '已配置，导入未接入';
      actionLabel = '调整路径';
      actionKind = 'configure_path';
    } else if (invalid) {
      category = 'invalid';
      status = '无效';
      actionLabel = '更换 key';
      actionKind = 'replace_key';
    } else if (limited) {
      category = 'limited';
      status = '受限';
      actionLabel = '查看窗口';
      actionKind = 'view_window';
    }

    return {
      id: item.provider_id,
      providerId: item.provider_id,
      sourceName: item.source_name,
      category,
      statusLabel: status,
      keyLabel,
      targetLabel: formatTargetTypes(item.target_types),
      detail: detailParts.join(' · ') || String(item.readiness_status ?? 'registry'),
      actionLabel,
      actionKind,
      item,
    };
  });
  const priority: Record<CredentialRow['category'], number> = {
    invalid: 0,
    missing_path: 1,
    limited: 2,
    usable: 3,
    disabled: 4,
    unavailable: 5,
  };
  return rows.sort((left, right) => priority[left.category] - priority[right.category] || left.providerId.localeCompare(right.providerId));
}

function buildRefreshLogRows(overview: ApiSnapshotOverview | null, layerCards: LayerCard[]): Array<{
  id: LayerId;
  current: string;
  thisRun: string;
  source: string;
  issue: string;
  nextAction: string;
}> {
  const refreshItemsByLayer: Record<LayerId, Array<{ id: string; label: string }>> = {
    l1: [
      { id: 'ds-price', label: '价格' },
      { id: 'ds-corporate-actions', label: '公司行为' },
      { id: 'bond_fixed_income', label: '债券' },
    ],
    l2: [{ id: 'ds-fundamentals', label: '财务截面' }],
    l3: [
      { id: 'ds-analyst-consensus', label: '分析师一致预期' },
      { id: 'ds-short-volume', label: '卖空量' },
    ],
    l4: [
      { id: 'ds-macro-rates', label: '宏观利率' },
      { id: 'ds-option-skew', label: '期权偏度' },
    ],
  };
  return layerCards.map((card) => {
    const items = refreshItemsByLayer[card.id];
    const entries = items
      .map((item) => ({ ...item, entry: findRefreshEntry(overview, item.id) }))
      .filter((item): item is { id: string; label: string; entry: Record<string, unknown> } => Boolean(item.entry));
    const run = entries.length
      ? uniqueStrings(entries.map((item) => summarizeRefreshEntry(item.entry, item.label))).join(' · ')
      : card.id === 'l1'
        ? '股票/债券本次入库按来源分项记录'
        : '本次无入库';
    const sources = items
      .map(({ id }) => {
        const dataset = getDataset(overview, id);
        if (id === 'bond_fixed_income') {
          return sourceKeyLabel(overview?.bond_fixed_income?.selected_source_summary?.primary_source);
        }
        return summarizeRefreshSource(findRefreshEntry(overview, id), sourceLabel(dataset?.source, dataset?.fallback_source));
      })
      .filter(Boolean);
    return {
      id: card.id,
      current: card.metric,
      thisRun: run,
      source: uniqueStrings(sources).join(' / ') || '未记录',
      issue: card.miniRows[1]?.value ?? card.subtitle,
      nextAction: card.action,
    };
  });
}

function compactObject(value: Record<string, unknown>): string {
  return Object.entries(value)
    .filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
    .slice(0, 4)
    .map(([key, entry]) => `${key}: ${String(entry)}`)
    .join(' · ');
}

function getLayerHealthSummary(layerCards: LayerCard[]): Array<{ label: string; value: string; tone: string }> {
  return layerCards.map((card) => ({
    label: card.title,
    value: card.statusLabel,
    tone: statusTone(card.status),
  }));
}

function getLayerStatusSummary(layerCards: LayerCard[]): string {
  const count = layerCards.filter((card) => statusTone(card.status) !== 'ready').length;
  return count ? `${count} 层部分可用` : '全部就绪';
}

function spacedCoverage(value: string): string {
  return value.replaceAll('/', ' / ');
}

function plainMetric(value: string): string {
  return spacedCoverage(value).replaceAll(',', '');
}

function scrollIntoViewIfAvailable(element: Element | null, options: ScrollIntoViewOptions): void {
  if (element && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView(options);
  }
}

function buildQueueItems(overview: ApiSnapshotOverview | null, registry: ApiSnapshotProviderRegistry | null): QueueItem[] {
  const corporate = getDataset(overview, 'ds-corporate-actions');
  const price = getDataset(overview, 'ds-price');
  const missingLocalPathProvider = registry?.items.find((item) =>
    (item.credential_requirements.missing_env_vars ?? []).some((key) =>
      ['CRSP_DATA_PATH', 'NORGATE_DATA_PATH'].includes(key),
    ),
  );
  const rows: QueueItem[] = [
    {
      id: 'l1-corporate-actions',
      title: 'L1 公司行为补链未完成',
      body: `公司行为快照沿用上一批 ${formatCount(corporate?.row_count)} 行，缺口主要影响 30Y Full Ready，不影响 10Y 因子准入。`,
      pills: ['目标 ds-corporate-actions', '影响 452 个符号', '非硬阻断'],
      action: '修复 L1',
      actionKind: 'repair_l1',
    },
    {
      id: 'local-paths',
      title: 'CRSP 与 Norgate 本机数据路径缺失',
      body: '影响长历史补价、退市身份确权和精修来源；当前可用公开来源已能支撑研究态回放。',
      pills: ['CRSP_DATA_PATH', 'NORGATE_DATA_PATH'],
      action: '配置路径',
      actionKind: 'configure_path',
      credentialProviderId: missingLocalPathProvider?.provider_id ?? 'crsp_us_stock',
    },
  ];
  const hasCorporateIssue = Boolean(corporate?.blocker) || String(corporate?.status ?? '').toUpperCase() !== 'READY';
  const hasPriceIssue = Boolean(price?.blocker) || String(price?.status ?? '').toUpperCase() !== 'READY';
  const hasPathIssue = registry?.items.some((item) =>
    (item.credential_requirements.missing_env_vars ?? []).some((key) => ['CRSP_DATA_PATH', 'NORGATE_DATA_PATH'].includes(key)),
  );
  return rows.filter((row) => {
    if (row.id === 'l1-corporate-actions') return hasCorporateIssue || hasPriceIssue;
    if (row.id === 'local-paths') return hasPathIssue ?? true;
    return true;
  });
}

function getCredentialSummary(registry: ApiSnapshotProviderRegistry | null): Array<{ value: string; label: string }> {
  if (!registry) {
    return [
      { value: '-', label: '注册来源' },
      { value: '-', label: '当前启用' },
      { value: '-', label: '可用来源' },
      { value: '-', label: '已配置 key/path' },
      { value: 'OpenBB 未知', label: '可选增强' },
    ];
  }
  const configured = registry.items.filter((item) => item.credential_ready).length;
  return [
    { value: formatCount(registry.items.length), label: '注册来源' },
    { value: formatCount(registry.items.filter((item) => item.enabled).length), label: '当前启用' },
    { value: formatCount(registry.items.filter((item) => item.usable).length), label: '可用来源' },
    { value: formatCount(configured), label: '已配置 key/path' },
    { value: registry.openbb_enabled ? 'OpenBB 开启' : 'OpenBB 关闭', label: registry.openbb_enabled ? '可选增强已启用' : '可选增强未启用' },
  ];
}

function credentialByProvider(rows: CredentialRow[], providerId: string): CredentialRow | undefined {
  return rows.find((row) => row.providerId === providerId);
}

function getConfigTone(row?: CredentialRow): string {
  if (!row) return 'warning';
  if (row.category === 'missing_path' || row.statusLabel.includes('缺失')) return 'warning';
  if (row.category === 'invalid' || row.category === 'limited' || row.category === 'usable') return 'ready';
  return row.item?.credential_ready ? 'ready' : 'warning';
}

function getConfigLabel(row?: CredentialRow): string {
  if (!row) return '缺失';
  return getConfigTone(row) === 'ready' ? '已配置' : '缺失';
}

function getCredentialStatusTone(row?: CredentialRow): string {
  if (!row) return 'neutral';
  if (row.category === 'usable') return 'ready';
  if (row.category === 'invalid') return 'danger';
  if (row.category === 'missing_path' || row.category === 'limited') return 'warning';
  if (row.item?.credential_ready && !row.item.enabled) return 'warning';
  return 'neutral';
}

function getCredentialDisplayRows(rows: CredentialRow[]): CredentialDisplayRow[] {
  const tiingo = credentialByProvider(rows, 'tiingo') ?? credentialByProvider(rows, 'tiingo_symbology');
  const alpha = credentialByProvider(rows, 'alpha_vantage');
  const polygon = credentialByProvider(rows, 'polygon');
  const crsp = credentialByProvider(rows, 'crsp_us_stock');
  const norgate = credentialByProvider(rows, 'norgate_us_equities');
  const sourceGroup =
    credentialByProvider(rows, 'fmp') ??
    credentialByProvider(rows, 'fmp_historical_constituent') ??
    credentialByProvider(rows, 'finnhub') ??
    credentialByProvider(rows, 'eodhd') ??
    credentialByProvider(rows, 'sec_edgar');

  const displayRows: CredentialDisplayRow[] = [
    {
      id: 'tiingo',
      key: 'TIINGO_API_TOKEN',
      source: 'Tiingo / Tiingo Symbology',
      configLabel: getConfigLabel(tiingo),
      configTone: getConfigTone(tiingo),
      statusLabel: tiingo?.category === 'limited' ? '价格冷却' : tiingo?.statusLabel ?? '冷却中',
      statusTone: tiingo?.category === 'usable' ? 'ready' : 'warning',
      impact: '价格与公司行为最近限流；符号映射链路仍可用。',
      actionLabel: tiingo?.actionLabel === '更换 key' ? '更换 key' : '查看窗口',
      actionKind: tiingo?.actionKind === 'replace_key' ? 'replace_key' : 'view_window',
      credential: tiingo,
    },
    {
      id: 'alpha_vantage',
      key: 'ALPHAVANTAGE_API_KEY',
      source: 'Alpha Vantage',
      configLabel: getConfigLabel(alpha),
      configTone: getConfigTone(alpha),
      statusLabel: alpha?.category === 'limited' ? '冷却中' : alpha?.statusLabel ?? '冷却中',
      statusTone: alpha?.category === 'usable' ? 'ready' : 'warning',
      impact: '免费层触发限流，下一轮刷新等待冷却窗口。',
      actionLabel: alpha?.actionLabel === '更换 key' ? '更换 key' : '查看窗口',
      actionKind: alpha?.actionKind === 'replace_key' ? 'replace_key' : 'view_window',
      credential: alpha,
    },
    {
      id: 'polygon',
      key: 'MASSIVE_API_KEY',
      source: 'Polygon.io / 期权偏度',
      configLabel: getConfigLabel(polygon),
      configTone: getConfigTone(polygon),
      statusLabel: polygon?.category === 'invalid' ? '凭据无效' : polygon?.statusLabel ?? '凭据无效',
      statusTone: 'danger',
      impact: '精修行情链路返回 invalid credentials；期权快照已有历史行但后续修复需换 key。',
      actionLabel: '更换 key',
      actionKind: 'replace_key',
      credential: polygon,
    },
    {
      id: 'crsp',
      key: 'CRSP_DATA_PATH',
      source: 'CRSP US Stock',
      configLabel: getConfigLabel(crsp),
      configTone: getConfigTone(crsp),
      statusLabel: crsp?.statusLabel ?? '未启用',
      statusTone: getCredentialStatusTone(crsp),
      impact: crsp?.item?.credential_ready && !crsp.item.enabled
        ? '路径已读取；当前刷新链路尚未接入 CRSP 导入器，需要 manifest 校验后的本机导入流程。'
        : '影响长历史、退市收益、身份确权和 30Y Full Ready 归档。',
      actionLabel: crsp?.actionLabel ?? '配置路径',
      actionKind: crsp?.actionKind ?? 'configure_path',
      credential: crsp,
    },
    {
      id: 'norgate',
      key: 'NORGATE_DATA_PATH',
      source: 'Norgate US Equities',
      configLabel: getConfigLabel(norgate),
      configTone: getConfigTone(norgate),
      statusLabel: norgate?.statusLabel ?? '未启用',
      statusTone: getCredentialStatusTone(norgate),
      impact: norgate?.item?.credential_ready && !norgate.item.enabled
        ? '路径已读取；当前刷新链路尚未接入 Norgate 导入器，需要 manifest 校验后的本机导入流程。'
        : '影响长历史补价、退市身份和精修来源。',
      actionLabel: norgate?.actionLabel ?? '配置路径',
      actionKind: norgate?.actionKind ?? 'configure_path',
      credential: norgate,
    },
    {
      id: 'source_group',
      key: 'FMP / FINNHUB / EODHD / SEC',
      source: '已配置来源组',
      configLabel: sourceGroup?.item?.credential_ready ? '已配置' : '缺失',
      configTone: sourceGroup?.item?.credential_ready ? 'ready' : 'warning',
      statusLabel: sourceGroup?.category === 'usable' ? '可用' : '观察',
      statusTone: sourceGroup?.category === 'usable' ? 'ready' : 'neutral',
      impact: '用于历史成分、身份、定向修复与 SEC 证据链。',
      actionLabel: '查看来源',
      actionKind: 'view_source',
      credential: sourceGroup,
    },
  ];
  return displayRows;
}

function buildCredentialRestartCommand(
  credential: CredentialRow | null,
  display: CredentialDisplayRow | null,
): string {
  const actionKind = credential?.actionKind ?? display?.actionKind;
  if (actionKind === 'configure_path') {
    const keyLabel = credential?.keyLabel ?? display?.key ?? '<PATH>';
    return `$env:${keyLabel}="C:\\path\\to\\data"
$localConfig = ".\\QuickStart-Grit.local.ps1"
if (-not (Test-Path -LiteralPath $localConfig)) { New-Item -ItemType File -Path $localConfig | Out-Null }
$localLine = "\`$env:${keyLabel} = '$($env:${keyLabel})'"
$localText = Get-Content -LiteralPath $localConfig -Raw
if ($localText -match '(?m)^\\s*\\$env:${keyLabel}\\s*=') {
  $localText = $localText -replace '(?m)^\\s*\\$env:${keyLabel}\\s*=.*$', $localLine
  Set-Content -LiteralPath $localConfig -Value $localText -Encoding utf8
} else {
  Add-Content -LiteralPath $localConfig -Value $localLine -Encoding utf8
}
powershell -ExecutionPolicy Bypass -File .\\QuickStart-Grit.ps1 -ForceRestart -RestartReason "snapshot provider credentials updated"`;
  }
  if (actionKind === 'replace_key') {
    const keyLabel = credential?.keyLabel ?? display?.key ?? '<KEY>';
    return `$env:${keyLabel}="<paste-key>"; powershell -ExecutionPolicy Bypass -File .\\QuickStart-Grit.ps1 -ForceRestart -RestartReason "snapshot provider credentials updated"`;
  }
  return `powershell -ExecutionPolicy Bypass -File .\\QuickStart-Grit.ps1 -ForceRestart -RestartReason "snapshot provider credentials updated"`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback.
  }

  const textarea = document.createElement('textarea');
  try {
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    return copied;
  } catch {
    return false;
  } finally {
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
  }
}

export function SnapshotOperationsConsole({
  overview,
  providerRegistry,
  providerAttempts,
  providerRegistryError,
  highlightTarget,
  openRefreshLogToken,
  onRefresh,
  refreshDisabled,
  onCreateBondAssetLeg,
  creatingBondAssetLegId,
  createAssetLegError,
  createAssetLegMessage,
}: SnapshotOperationsConsoleProps): JSX.Element {
  const [highlightedLayer, setHighlightedLayer] = useState<LayerId | null>(null);
  const [activeDrillSourceId, setActiveDrillSourceId] = useState<string | null>(null);
  const [highlightedLedgerLayer, setHighlightedLedgerLayer] = useState<LayerId | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [isRefreshLogOpen, setIsRefreshLogOpen] = useState(false);
  const [activeCredentialId, setActiveCredentialId] = useState<string | null>(null);
  const [credentialCopyStatus, setCredentialCopyStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const highlightedLayerTimerRef = useRef<number | null>(null);
  const highlightedLedgerLayerTimerRef = useRef<number | null>(null);

  const layerCards = useMemo(() => buildLayerCards(overview), [overview]);
  const sourceDrillModules = useMemo(() => buildDataSourceDrillModules(overview), [overview]);
  const ledgerRows = useMemo(() => buildLedgerRows(overview), [overview]);
  const queueRows = useMemo(() => buildQueueItems(overview, providerRegistry), [overview, providerRegistry]);
  const credentialRows = useMemo(
    () => buildCredentialRows(providerRegistry, providerAttempts, providerRegistryError),
    [providerAttempts, providerRegistry, providerRegistryError],
  );
  const credentialDisplayRows = useMemo(() => getCredentialDisplayRows(credentialRows), [credentialRows]);
  const credentialSummary = useMemo(() => getCredentialSummary(providerRegistry), [providerRegistry]);
  const refreshLogRows = useMemo(() => buildRefreshLogRows(overview, layerCards), [layerCards, overview]);
  const selectedEvidence = ledgerRows.find((row) => row.id === selectedEvidenceId) ?? null;
  const activeCredential = credentialRows.find((row) => row.id === activeCredentialId) ?? null;
  const activeCredentialDisplay =
    credentialDisplayRows.find((row) =>
      row.id === activeCredentialId ||
      row.credential?.id === activeCredentialId ||
      (activeCredential ? row.credential?.providerId === activeCredential.providerId : false),
    ) ?? null;
  const activeCredentialCommand = buildCredentialRestartCommand(activeCredential, activeCredentialDisplay);
  const activeCredentialInstruction = activeCredentialDisplay
    ? `${activeCredentialDisplay.actionLabel} · ${activeCredentialDisplay.key} · ${activeCredentialDisplay.source}`
    : '请选择左侧凭证行，命令会按该来源更新。';
  const healthSummary = getLayerHealthSummary(layerCards);
  const activeDrillModule =
    sourceDrillModules.find((module) => module.sourceId === activeDrillSourceId) ?? sourceDrillModules[0] ?? null;
  const activeLayerCard = activeDrillModule
    ? layerCards.find((card) => card.id === activeDrillModule.layerId) ?? layerCards[0]
    : layerCards[0];
  const activeDrillTone = statusTone(activeDrillModule?.status ?? activeLayerCard?.status);
  const latestJob = overview?.latest_job ?? null;

  function clearHighlightTimer(timerRef: { current: number | null }): void {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function scheduleHighlightedLayerReset(): void {
    clearHighlightTimer(highlightedLayerTimerRef);
    highlightedLayerTimerRef.current = window.setTimeout(() => {
      highlightedLayerTimerRef.current = null;
      setHighlightedLayer(null);
    }, 2400);
  }

  function scheduleHighlightedLedgerLayerReset(): void {
    clearHighlightTimer(highlightedLedgerLayerTimerRef);
    highlightedLedgerLayerTimerRef.current = window.setTimeout(() => {
      highlightedLedgerLayerTimerRef.current = null;
      setHighlightedLedgerLayer(null);
    }, 2400);
  }

  useEffect(() => {
    return () => {
      clearHighlightTimer(highlightedLayerTimerRef);
      clearHighlightTimer(highlightedLedgerLayerTimerRef);
    };
  }, []);

  useEffect(() => {
    if (!highlightTarget) {
      return;
    }
    const layerId = layerForTarget(highlightTarget);
    const sourceModule = sourceDrillModules.find((module) => module.layerId === layerId);
    if (sourceModule) {
      setActiveDrillSourceId(sourceModule.sourceId);
    }
    setHighlightedLayer(layerId);
    scheduleHighlightedLayerReset();
  }, [highlightTarget, sourceDrillModules]);

  useEffect(() => {
    if (openRefreshLogToken === undefined || openRefreshLogToken <= 0) {
      return;
    }
    setIsRefreshLogOpen(true);
  }, [openRefreshLogToken]);

  function handleDrill(layerId: LayerId): void {
    const sourceModule = sourceDrillModules.find((module) => module.layerId === layerId) ?? sourceDrillModules[0];
    if (sourceModule) {
      setActiveDrillSourceId(sourceModule.sourceId);
      scrollIntoViewIfAvailable(document.getElementById(`snapshot-source-${sourceModule.sourceId}`), { block: 'center', behavior: 'smooth' });
    } else {
      scrollIntoViewIfAvailable(document.querySelector('[data-testid="snapshots-drilldown-row"]'), { block: 'center', behavior: 'smooth' });
    }
    setHighlightedLayer(layerId);
    scheduleHighlightedLayerReset();
  }

  function handleViewEvidence(layerId: LayerId): void {
    setHighlightedLedgerLayer(layerId);
    scrollIntoViewIfAvailable(document.getElementById('snapshot-ledger'), { block: 'start', behavior: 'smooth' });
    scheduleHighlightedLedgerLayerReset();
  }

  function selectCredential(id: string | null): void {
    setActiveCredentialId(id);
    setCredentialCopyStatus('idle');
  }

  async function handleCopyCredentialCommand(): Promise<void> {
    const copied = await copyTextToClipboard(activeCredentialCommand);
    setCredentialCopyStatus(copied ? 'copied' : 'manual');
  }

  return (
    <div className="snapshots-ops-console" data-testid="snapshots-ops-console">
      <section className="snapshots-ops-panel snapshots-ops-health" aria-labelledby="snapshot-health-title">
        <div className="snapshots-ops-panel__header">
          <div>
            <h2 id="snapshot-health-title">L1-L4 数据层健康</h2>
            <p className="snapshots-ops-small-note">卡片只保留决策必要信息；点击任一层进入证据、缺口和修复动作。</p>
          </div>
          <span className="snapshots-ops-status snapshots-ops-status--warning">{getLayerStatusSummary(layerCards)}</span>
        </div>
        <div className="snapshots-ops-health-grid">
          {layerCards.map((card, index) => {
            const tone = statusTone(card.status);
            const isReady = tone === 'ready';
            const isActive = highlightedLayer === card.id || highlightedLedgerLayer === card.id;
            const isPrimary = card.id === 'l1';
            return (
              <article
                className={`snapshots-ops-health-card snapshots-ops-health-card--${tone}${isPrimary ? ' snapshots-ops-health-card--primary' : ''}${isActive ? ' snapshots-ops-health-card--active' : ''}`}
                data-layer-id={card.id}
                data-layer-status={String(card.status).toLowerCase()}
                key={card.id}
              >
                <div className="snapshots-ops-card-title">
                  <h3>{card.title}</h3>
                  <span className={`snapshots-ops-status snapshots-ops-status--${tone}`}>
                    {healthSummary[index]?.value ?? statusLabel(card.status)}
                  </span>
                </div>
                <div className="snapshots-ops-metric-line">
                  <strong className="snapshots-ops-metric-value">
                    {(card.metricLines?.length ? card.metricLines : [card.metric]).map((line) => (
                      <span className="snapshots-ops-metric-value-line" key={line}>
                        {plainMetric(line)}
                      </span>
                    ))}
                  </strong>
                  <span className="snapshots-ops-metric-subtitle">{card.subtitle}</span>
                </div>
                <div className="snapshots-ops-mini-list">
                  {card.miniRows.map((row) => (
                    <div className="snapshots-ops-mini-row" key={row.label}>
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                  <button
                    className="link-btn snapshots-ops-link-plain snapshots-ops-health-action"
                    type="button"
                    onClick={() => {
                      if (isReady) {
                        handleViewEvidence(card.id);
                      } else {
                        handleDrill(card.id);
                      }
                    }}
                  >
                    {card.action}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="snapshots-ops-queue-row" aria-label="待处理队列与因子影响摘要">
        <article className="snapshots-ops-panel snapshots-ops-queue" data-testid="snapshots-pending-queue">
          <div className="snapshots-ops-panel__header">
            <div>
              <h2>待处理队列</h2>
              <p className="snapshots-ops-small-note">只展示有明确执行入口的阻断、缺凭据、权限、限流和刷新失败。</p>
            </div>
            <span className="snapshots-ops-status snapshots-ops-status--warning">{queueRows.length} 项需处理</span>
          </div>
          <div className="snapshots-ops-action-list">
            {queueRows.map((item) => (
              <div className="snapshots-ops-queue-item" key={item.id}>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <div className="snapshots-ops-pill-row">
                    {item.pills.map((pill) => <span className="snapshots-ops-pill" key={pill}>{pill}</span>)}
                  </div>
                </div>
                <button
                  className={item.actionKind === 'repair_l1' ? 'primary-button' : 'link-btn'}
                  disabled={item.actionKind === 'repair_l1' ? refreshDisabled : false}
                  type="button"
                  onClick={() => {
                    if (item.actionKind === 'repair_l1') {
                      onRefresh({
                        mode: 'repair',
                        targets: ['price', 'corporate', 'bond'],
                        reason: 'snapshot-queue-l1-repair',
                        phase2_scope: 'sp500_10y',
                        phase2_max_symbols: 25,
                      });
                    } else if (item.actionKind === 'configure_path') {
                      selectCredential(item.credentialProviderId ?? 'crsp_us_stock');
                    } else {
                      document.querySelector('.snapshots-ops-ledger')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }
                  }}
                >
                  {item.action}
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className="snapshots-ops-panel snapshots-ops-factor-impact">
          <div className="snapshots-ops-panel__header">
            <div>
              <h2>因子影响摘要</h2>
              <p className="snapshots-ops-small-note">把矩阵收敛为“允许动作”，完整因子映射在下钻中查看。</p>
            </div>
          </div>
          <div className="snapshots-ops-impact-grid">
            <div className="snapshots-ops-impact-row"><strong>价格与流动性</strong><span className="snapshots-ops-status snapshots-ops-status--warning">研究可用</span><p>动量、波动、流动性过滤可运行；30Y Full Ready 前不作为长期档案完成证明。</p></div>
            <div className="snapshots-ops-impact-row"><strong>固定收益与资产腿</strong><span className="snapshots-ops-status snapshots-ops-status--ready">可创建</span><p>国债曲线、TIPS 与 LQD 来源进入 L1 基础行情；仅已就绪运行态行可创建债券资产腿。</p></div>
            <div className="snapshots-ops-impact-row"><strong>质量与估值</strong><span className="snapshots-ops-status snapshots-ops-status--ready">可入库</span><p>财务字段和发布时点可用；平衡校验观察项不阻断基础因子诊断。</p></div>
            <div className="snapshots-ops-impact-row"><strong>宏观与衍生品</strong><span className="snapshots-ops-status snapshots-ops-status--warning">研究可用</span><p>利率 Beta 与 IV Skew 可作为特征源；正式 IC 诊断等待 L1 样本池门禁。</p></div>
          </div>
        </article>
      </section>

      <section className="snapshots-ops-panel snapshots-ops-drilldown" data-testid="snapshots-drilldown-row">
        <div className="snapshots-ops-panel__header">
          <div>
            <p className="snapshots-ops-eyebrow">当前下钻</p>
            <h2>
              {activeDrillModule
                ? `${activeDrillModule.layerTitle} · ${activeDrillModule.title}`
                : activeLayerCard?.title ?? 'L1 基础行情'}
            </h2>
            <p className="snapshots-ops-small-note">仅为部分可用或阻塞的数据源生成独立下钻模块；READY 来源保留在原始台账和证据弹层。</p>
          </div>
          <span className={`snapshots-ops-status snapshots-ops-status--${activeDrillTone}`}>
            {activeDrillModule?.statusLabel ?? activeLayerCard?.statusLabel ?? statusLabel(layerCards[0]?.status)}
          </span>
        </div>
        <div className="snapshots-ops-drill-grid">
          {sourceDrillModules.length ? (
            sourceDrillModules.map((module) => {
              const isActive = activeDrillModule?.sourceId === module.sourceId;
              return (
                <article
                  className={`snapshots-ops-drill-card ${isActive ? 'snapshots-ops-drill-card--highlight' : ''}`}
                  data-layer-id={module.layerId}
                  data-source-id={module.sourceId}
                  id={`snapshot-source-${module.sourceId}`}
                  key={module.sourceId}
                >
                  <div className="snapshots-ops-card-title">
                    <h3>{module.title}数据源下钻</h3>
                    <span className={`snapshots-ops-status snapshots-ops-status--${statusTone(module.status)}`}>
                      {module.statusLabel}
                    </span>
                  </div>
                  <p>{module.layerTitle} 的 {module.title} 目前需要单独复核；下方只列本数据源的证据、缺口和动作。</p>
                  <div className="snapshots-ops-source-fact-grid">
                    <div><span>已有数据</span><strong>{module.existingData}</strong></div>
                    <div><span>完整度</span><strong>{module.completeness}</strong></div>
                    <div><span>缺少数据</span><strong>{module.missingData}</strong></div>
                    <div><span>卡点</span><strong>{module.blocker}</strong></div>
                  </div>
                  <div className="snapshots-ops-drill-list">
                    <div className="snapshots-ops-check-row">
                      <span className="snapshots-ops-status snapshots-ops-status--ready">下一步</span>
                      <div>{module.nextAction}</div>
                    </div>
                  </div>
                  <button
                    className="primary-button"
                    disabled={refreshDisabled}
                    type="button"
                    onClick={() => onRefresh({ mode: 'repair', targets: module.refreshTargets, reason: `snapshot-source-${module.sourceId}-repair` })}
                  >
                    刷新{module.title}
                  </button>
                  {module.layerId === 'l4' ? (
                    <button className="link-btn" type="button" onClick={() => handleDrill('l1')}>查看 L1 样本池依赖</button>
                  ) : null}
                </article>
              );
            })
          ) : (
            <article className="snapshots-ops-drill-card snapshots-ops-drill-card--empty">
              <h3>暂无单独下钻模块</h3>
              <p>当前 L1-L4 数据源没有部分可用或阻塞状态；请在原始快照清单中查看 READY 来源证据。</p>
            </article>
          )}
        </div>
      </section>

      <section className="snapshots-ops-panel snapshots-ops-ledger" id="snapshot-ledger">
          <div className="snapshots-ops-panel__header">
            <div>
              <h2>原始快照清单</h2>
              <p className="snapshots-ops-small-note">用表格承载台账，支持按层级、状态、来源和关键字过滤。</p>
            </div>
            <div className="snapshots-ops-filters">
              {['全部', '待处理', 'L1', '债券', 'L2', 'L4'].map((filter, index) => (
                <button className={`snapshots-ops-filter ${index === 0 ? 'is-active' : ''}`} key={filter} type="button">{filter}</button>
              ))}
              <input className="snapshots-ops-search" placeholder="搜索快照或来源" aria-label="搜索快照" />
            </div>
          </div>
          <div className="snapshots-ops-table-scroll">
            <table className="snapshots-ops-ledger-table">
              <thead>
                <tr>
                  <th>快照</th>
                  <th>层级</th>
                  <th>状态</th>
                  <th>覆盖 / 行数</th>
                  <th>来源</th>
                  <th>影响</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((row) => {
                  const rowHighlighted = row.id === highlightTarget || row.layerId === highlightedLedgerLayer;
                  return (
                  <tr
                    className={rowHighlighted ? 'dense-row dense-row--highlight snapshots-ops-ledger-row--highlight' : undefined}
                    data-layer-id={row.layerId}
                    data-snapshot-id={row.id}
                    key={row.id}
                  >
                    <td>
                      <div className="snapshots-ops-ledger-name">
                        <strong>{row.name}</strong>
                        <span>{row.id}</span>
                      </div>
                    </td>
                    <td>{LAYER_LABELS[row.layerId]}</td>
                    <td>
                      <span className={`snapshots-ops-status snapshots-ops-status--${statusTone(row.status)}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td>{row.coverage} · {row.currentRows}</td>
                    <td>{row.source}</td>
                    <td>{row.layerId === 'l1' ? '动量、波动、样本池' : row.layerId === 'l2' ? '质量、估值、稳健性' : row.layerId === 'l3' ? '一致预期、卖空成交' : '利率 Beta / IV Skew'}</td>
                    <td>
                      <div className="snapshots-ops-action-cluster">
                        {row.repairTarget ? (
                          <button className="link-btn" type="button" onClick={() => handleDrill(row.layerId)}>
                            下钻
                          </button>
                        ) : null}
                        <button className="link-btn" type="button" onClick={() => setSelectedEvidenceId(row.id)}>
                          证据
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      </section>

      <section className="snapshots-ops-foot-grid">
        <article className="snapshots-ops-panel snapshots-ops-credentials">
          <div className="snapshots-ops-panel__header">
            <div>
              <h2>凭据与本机配置</h2>
              <p className="snapshots-ops-small-note">读取线上来源注册表；只展示可执行的 key、路径、冷却和无效凭据状态。</p>
            </div>
            <span className="snapshots-ops-status snapshots-ops-status--warning">3 缺失 · 2 冷却 · 1 无效</span>
          </div>
          <div className="snapshots-ops-provider-summary" aria-label="来源注册表汇总">
            {credentialSummary.map((item) => (
              <div className="snapshots-ops-provider-stat" key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="snapshots-ops-credential-table" aria-label="凭据与本机路径状态">
            <div className="snapshots-ops-credential-row snapshots-ops-credential-row--head">
              <span>凭据 / 路径</span>
              <span>配置</span>
              <span>运行状态</span>
              <span>影响</span>
              <span>操作</span>
            </div>
            {credentialDisplayRows.map((row) => {
              const rowActive =
                activeCredentialId === row.id ||
                activeCredentialId === row.credential?.id ||
                (activeCredential ? row.credential?.providerId === activeCredential.providerId : false);
              return (
                <div
                  aria-current={rowActive ? 'true' : undefined}
                  className={`snapshots-ops-credential-row${rowActive ? ' snapshots-ops-credential-row--active' : ''}`}
                  data-credential-id={row.id}
                  data-testid={`credential-row-${row.id}`}
                  key={row.id}
                >
                  <div className="snapshots-ops-credential-key"><strong>{row.key}</strong><span>{row.source}</span></div>
                  <span className={`snapshots-ops-status snapshots-ops-status--${row.configTone}`}>{row.configLabel}</span>
                  <span className={`snapshots-ops-status snapshots-ops-status--${row.statusTone}`}>{row.statusLabel}</span>
                  <p>{row.impact}</p>
                  <button
                    aria-pressed={rowActive}
                    className="link-btn"
                    data-credential-action={row.actionKind}
                    type="button"
                    onClick={() => selectCredential(row.credential?.id ?? row.id)}
                  >
                    {row.actionLabel}
                  </button>
                </div>
              );
            })}
          </div>
        </article>
        <article className="snapshots-ops-panel snapshots-ops-restart">
          <div className="snapshots-ops-panel__header">
            <div>
              <h2>重启命令</h2>
              <p className="snapshots-ops-small-note">仅在更新凭据或本机路径后执行；不提交后端、不落库。</p>
            </div>
            <button className="link-btn" type="button" onClick={() => void handleCopyCredentialCommand()}>
              {credentialCopyStatus === 'copied' ? '已复制' : credentialCopyStatus === 'manual' ? '请手动复制' : '复制命令'}
            </button>
          </div>
          <div className="snapshots-ops-command-selected" data-testid="credential-selected-detail">
            <span>{activeCredentialDisplay ? '当前选择' : '默认命令'}</span>
            <strong>{activeCredentialInstruction}</strong>
            <p>{activeCredentialDisplay?.impact ?? '未选中具体来源时，只显示默认强制重启命令。'}</p>
          </div>
          <pre className="snapshots-ops-command-box">{activeCredentialCommand}</pre>
        </article>
      </section>

      {createAssetLegError ? <div className="error-banner">{createAssetLegError}</div> : null}
      {createAssetLegMessage ? <div className="success-banner">{createAssetLegMessage}</div> : null}

      {selectedEvidence ? (
        <SnapshotEvidenceModal
          row={selectedEvidence}
          overview={overview}
          onClose={() => setSelectedEvidenceId(null)}
          onCreateBondAssetLeg={onCreateBondAssetLeg}
          creatingBondAssetLegId={creatingBondAssetLegId}
        />
      ) : null}

      {isRefreshLogOpen ? (
        <RefreshLogModal
          latestJob={latestJob}
          rows={refreshLogRows}
          onClose={() => setIsRefreshLogOpen(false)}
        />
      ) : null}
    </div>
  );
}

function SnapshotEvidenceModal({
  row,
  overview,
  onClose,
  onCreateBondAssetLeg,
  creatingBondAssetLegId,
}: {
  row: LedgerRow;
  overview: ApiSnapshotOverview | null;
  onClose: () => void;
  onCreateBondAssetLeg?: (instrument: ApiBondSnapshotEligibleInstrument) => void;
  creatingBondAssetLegId?: string | null;
}): JSX.Element {
  const refreshEntry = findRefreshEntry(overview, row.id)
    ?? (row.kind === 'bond' ? findRefreshEntry(overview, 'bond_fixed_income') : null);
  const datasetMetadata = row.dataset ? asRecord(row.dataset.metadata) : {};
  const universeMetadata = row.universe ? asRecord(row.universe.metadata) : {};
  const providerSummary = asRecord(datasetMetadata.provider_summary ?? universeMetadata.provider_summary);
  const providerKeys = Object.keys(asRecord(providerSummary.providers)).slice(0, 6);
  const bond = overview?.bond_fixed_income;

  return (
    <div className="snapshots-ops-modal-backdrop" role="presentation">
      <section className="snapshots-ops-modal" role="dialog" aria-modal="true" aria-label="快照证据详情">
        <header className="snapshots-ops-modal__header">
          <div>
            <p className="snapshots-ops-eyebrow">证据详情</p>
            <h2>快照证据详情 · {row.name}</h2>
            <span>{row.id}</span>
          </div>
          <button className="link-btn" type="button" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="snapshots-ops-evidence-grid">
          <div className="snapshots-ops-evidence-block">
            <span>状态</span>
            <strong>{statusLabel(row.status)}</strong>
          </div>
          <div className="snapshots-ops-evidence-block">
            <span>覆盖</span>
            <strong>{row.coverage}</strong>
          </div>
          <div className="snapshots-ops-evidence-block">
            <span>当前来源</span>
            <strong>{row.source}</strong>
          </div>
          <div className="snapshots-ops-evidence-block">
            <span>本次入库</span>
            <strong>{summarizeRefreshEntry(refreshEntry)}</strong>
          </div>
        </div>

        {row.kind !== 'bond' ? (
          <div className="snapshots-ops-modal-section">
            <h3>质量审计</h3>
            <div className="snapshots-ops-evidence-list">
              <span>阻塞项: {blockerLabel(row.dataset?.blocker?.code ?? row.universe?.blocker?.code)}</span>
              <span>provider: {providerKeys.length ? providerKeys.join(' / ') : '未记录 provider_summary'}</span>
              <span>下一步动作: {row.nextAction}</span>
            </div>
          </div>
        ) : null}

        {row.kind === 'bond' && bond ? (
          <>
            <div className="snapshots-ops-modal-section">
              <h3>收益率曲线</h3>
              <div className="snapshots-ops-mini-table">
                {bond.curve_preview.map((point) => (
                  <div key={point.tenor_label}>
                    <span>{point.tenor_label}</span>
                    <strong>{point.yield_pct.toFixed(2)}%</strong>
                    <em>{point.spread_bps} bps</em>
                  </div>
                ))}
              </div>
            </div>
            <div className="snapshots-ops-modal-section">
              <h3>可建资产腿</h3>
              <div className="snapshots-ops-bond-instruments">
                {bond.eligible_instruments.slice(0, 7).map((instrument) => (
                  <div key={instrument.id}>
                    <strong>{instrument.label}</strong>
                    <span>
                      {instrument.status} · YTM {instrument.ytm_pct ?? instrument.sec_yield_30d_pct ?? '-'} · Duration{' '}
                      {instrument.duration ?? instrument.effective_duration ?? '-'}
                    </span>
                    {onCreateBondAssetLeg ? (
                      <button
                        className="link-btn"
                        disabled={Boolean(instrument.creation_disabled_reason) || creatingBondAssetLegId === instrument.id}
                        type="button"
                        onClick={() => onCreateBondAssetLeg(instrument)}
                      >
                        {creatingBondAssetLegId === instrument.id ? '创建中' : '创建资产腿'}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="snapshots-ops-modal-section">
              <h3>质量审计与日计提</h3>
              <div className="snapshots-ops-evidence-list">
                {bond.audit_matrix.slice(0, 5).map((item) => (
                  <span key={item.id}>
                    {item.label}: {statusLabel(item.status)} · {item.evidence}
                  </span>
                ))}
                {asArray(bond.quality_audit).slice(0, 4).map((item, index) => (
                  <span key={`quality-${index}`}>{compactObject(asRecord(item))}</span>
                ))}
                {asArray(bond.risk_budget_inputs).slice(0, 3).map((item, index) => (
                  <span key={`risk-${index}`}>{compactObject(asRecord(item))}</span>
                ))}
                {asArray(bond.daily_accrual_status).slice(0, 3).map((item, index) => (
                  <span key={`accrual-${index}`}>{compactObject(asRecord(item))}</span>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function RefreshLogModal({
  latestJob,
  rows,
  onClose,
}: {
  latestJob: ApiSnapshotJob | null;
  rows: ReturnType<typeof buildRefreshLogRows>;
  onClose: () => void;
}): JSX.Element {
  const request = asRecord(latestJob?.request);
  const targets = formatRefreshTargets(asArray(request.targets));
  const blockingCode = typeof latestJob?.blocking_code === 'string' ? latestJob.blocking_code : null;
  return (
    <div className="snapshots-ops-modal-backdrop" role="presentation">
      <section className="snapshots-ops-modal snapshots-ops-modal--wide" role="dialog" aria-modal="true" aria-label="刷新日志">
        <header className="snapshots-ops-modal__header">
          <div>
            <p className="snapshots-ops-eyebrow">刷新日志</p>
            <h2>刷新日志</h2>
            <span>
              {latestJob?.id ?? '无 job'} · {statusLabel(latestJob?.status)} · {refreshModeLabel(request.mode)} · {targets}
            </span>
          </div>
          <button className="link-btn" type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="snapshots-ops-job-summary">
          <span>阻塞项: {blockerLabel(blockingCode)}</span>
          <span>更新时间: {formatDateTime(latestJob?.updated_at)}</span>
        </div>
        <div className="snapshots-ops-table-scroll">
          <table className="snapshots-ops-ledger-table">
            <thead>
              <tr>
                <th>层级</th>
                <th>当前覆盖</th>
                <th>本次入库</th>
                <th>入库来源</th>
                <th>失败/跳过原因</th>
                <th>下一步动作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{LAYER_LABELS[row.id]}</td>
                  <td>{row.current}</td>
                  <td>{row.thisRun}</td>
                  <td>{row.source}</td>
                  <td>{row.issue}</td>
                  <td>{row.nextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
