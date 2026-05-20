import { useEffect, useMemo, useState } from 'react';
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
  coverage: string;
  gap: string;
  action: string;
  refreshTargets: SnapshotRefreshTarget[];
};

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
  l2: 'L2 财务基本面',
  l3: 'L3 情绪与微观结构',
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
      return '可用';
    case 'RUNNING':
      return '刷新中';
    case 'STALE':
      return '待刷新';
    case 'INCOMPLETE':
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
      return 'ready';
    case 'STALE':
    case 'INCOMPLETE':
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

function getDatasetCoverage(dataset?: ApiDatasetSnapshot): string {
  if (!dataset) {
    return '0/0';
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

function summarizeRefreshEntry(entry: Record<string, unknown> | null): string {
  if (!entry) {
    return '本次未入库';
  }
  const rows = firstNumber(entry, ['rows_inserted', 'landed_row_count', 'row_count', 'new_rows', 'rows']);
  const symbols = firstNumber(entry, ['landed_symbol_count', 'symbol_count', 'symbols_inserted', 'covered_symbol_count']);
  const parts: string[] = [];
  if (rows !== null) {
    parts.push(`${formatCount(rows)} 行`);
  }
  if (symbols !== null) {
    parts.push(`${formatCount(symbols)} 标的`);
  }
  return parts.length ? parts.join(' / ') : '已记录入库';
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

function buildLayerCards(overview: ApiSnapshotOverview | null): LayerCard[] {
  const price = getDataset(overview, 'ds-price');
  const corporate = getDataset(overview, 'ds-corporate-actions');
  const fundamentals = getDataset(overview, 'ds-fundamentals');
  const analyst = getDataset(overview, 'ds-analyst-consensus');
  const shortVolume = getDataset(overview, 'ds-short-volume');
  const macro = getDataset(overview, 'ds-macro-rates');
  const option = getDataset(overview, 'ds-option-skew');
  const bondStatus = overview?.bond_fixed_income?.global_pulse?.status ?? 'UNKNOWN';

  return [
    {
      id: 'l1',
      title: 'L1 基础行情',
      subtitle: '价格、公司行动、债券基础行情',
      status: [price?.status, corporate?.status, bondStatus].some((status) => status && status !== 'READY')
        ? 'INCOMPLETE'
        : 'READY',
      coverage: `股票 ${getDatasetCoverage(price)} · 公司行动 ${getDatasetCoverage(corporate)} · 债券 ${getBondCoverage(overview)}`,
      gap: corporate?.blocker || price?.blocker
        ? blockerLabel(corporate?.blocker?.code ?? price?.blocker?.code)
        : '债券基础行情 READY',
      action: corporate?.blocker || price?.blocker ? '修复 L1 缺口' : '查看债券证据',
      refreshTargets: ['price', 'corporate', 'bond'],
    },
    {
      id: 'l2',
      title: 'L2 财务基本面',
      subtitle: '财报字段、估值基础、PIT 入场',
      status: fundamentals?.status ?? 'UNKNOWN',
      coverage: getDatasetCoverage(fundamentals),
      gap: fundamentals?.blocker ? blockerLabel(fundamentals.blocker.code) : '财务平衡校验仅作为观察项',
      action: fundamentals?.blocker ? '修复基本面' : '查看质量审计',
      refreshTargets: ['fundamentals'],
    },
    {
      id: 'l3',
      title: 'L3 情绪与微观结构',
      subtitle: '一致预期、卖空量、市场情绪',
      status: [analyst?.status, shortVolume?.status].some((status) => status && status !== 'READY') ? 'INCOMPLETE' : 'READY',
      coverage: `${getDatasetCoverage(analyst)} · ${getDatasetCoverage(shortVolume)}`,
      gap: analyst?.blocker || shortVolume?.blocker
        ? blockerLabel(analyst?.blocker?.code ?? shortVolume?.blocker?.code)
        : '影响扩展因子，主流程可继续',
      action: analyst?.blocker || shortVolume?.blocker ? '修复情绪数据' : '查看来源',
      refreshTargets: ['sentiment'],
    },
    {
      id: 'l4',
      title: 'L4 宏观与衍生品',
      subtitle: '利率、波动率、期权偏斜',
      status: [macro?.status, option?.status].some((status) => status && status !== 'READY') ? 'INCOMPLETE' : 'READY',
      coverage: `${getDatasetCoverage(macro)} · ${getDatasetCoverage(option)}`,
      gap: macro?.blocker || option?.blocker
        ? blockerLabel(macro?.blocker?.code ?? option?.blocker?.code)
        : '仅影响高级风险预算',
      action: macro?.blocker || option?.blocker ? '修复 L4' : '查看宏观证据',
      refreshTargets: ['macro_derivatives'],
    },
  ];
}

function buildLedgerRows(overview: ApiSnapshotOverview | null): LedgerRow[] {
  if (!overview) {
    return [];
  }
  const visibleDatasetIds = [
    'ds-price',
    'ds-corporate-actions',
    'ds-fundamentals',
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
  const idsByLayer: Record<LayerId, string[]> = {
    l1: ['ds-price', 'ds-corporate-actions', 'bond_fixed_income'],
    l2: ['ds-fundamentals'],
    l3: ['ds-analyst-consensus', 'ds-short-volume'],
    l4: ['ds-macro-rates', 'ds-option-skew'],
  };
  return layerCards.map((card) => {
    const ids = idsByLayer[card.id];
    const entries = ids.map((id) => findRefreshEntry(overview, id)).filter(Boolean);
    const run = entries.length
      ? entries.map((entry) => summarizeRefreshEntry(entry)).join(' · ')
      : card.id === 'l1'
        ? '股票/债券本次入库按来源分项记录'
        : '本次无入库';
    const sources = ids
      .map((id) => {
        const dataset = getDataset(overview, id);
        if (id === 'bond_fixed_income') {
          return sourceKeyLabel(overview?.bond_fixed_income?.selected_source_summary?.primary_source);
        }
        return summarizeRefreshSource(findRefreshEntry(overview, id), sourceLabel(dataset?.source, dataset?.fallback_source));
      })
      .filter(Boolean);
    return {
      id: card.id,
      current: card.coverage,
      thisRun: run,
      source: sources.join(' / ') || '未记录',
      issue: card.gap,
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
    value: statusLabel(card.status),
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

function buildQueueItems(overview: ApiSnapshotOverview | null, registry: ApiSnapshotProviderRegistry | null): QueueItem[] {
  const corporate = getDataset(overview, 'ds-corporate-actions');
  const price = getDataset(overview, 'ds-price');
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
    },
    {
      id: 'fundamental-balance',
      title: '财务平衡校验部分可用',
      body: 'publish_date 与 available_at 已完整；会计恒等式作为观察项保留，不再占用主告警位。',
      pills: ['观察项', '2463 / 3332 通过'],
      action: '查看台账',
      actionKind: 'view_ledger',
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
  if (row.category === 'missing_path' || row.keyLabel.includes('PATH') || row.statusLabel.includes('缺失')) return 'warning';
  if (row.category === 'invalid' || row.category === 'limited' || row.category === 'usable') return 'ready';
  return row.item?.credential_ready ? 'ready' : 'warning';
}

function getConfigLabel(row?: CredentialRow): string {
  if (!row) return '缺失';
  return getConfigTone(row) === 'ready' ? '已配置' : '缺失';
}

function getCredentialDisplayRows(rows: CredentialRow[]): CredentialDisplayRow[] {
  const tiingo = credentialByProvider(rows, 'tiingo') ?? credentialByProvider(rows, 'tiingo_symbology');
  const alpha = credentialByProvider(rows, 'alpha_vantage');
  const polygon = credentialByProvider(rows, 'polygon');
  const crsp = credentialByProvider(rows, 'crsp_us_stock');
  const norgate = credentialByProvider(rows, 'norgate_us_equities');
  const iex = credentialByProvider(rows, 'iex_cloud_legacy');
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
      configLabel: '缺失',
      configTone: 'warning',
      statusLabel: '未启用',
      statusTone: 'neutral',
      impact: '影响长历史、退市收益、身份确权和 30Y Full Ready 归档。',
      actionLabel: '配置路径',
      actionKind: 'configure_path',
      credential: crsp,
    },
    {
      id: 'norgate',
      key: 'NORGATE_DATA_PATH',
      source: 'Norgate US Equities',
      configLabel: '缺失',
      configTone: 'warning',
      statusLabel: '未启用',
      statusTone: 'neutral',
      impact: '影响长历史补价、退市身份和精修来源。',
      actionLabel: '配置路径',
      actionKind: 'configure_path',
      credential: norgate,
    },
    {
      id: 'iex',
      key: 'IEX_TOKEN / IEX_CLOUD_TOKEN',
      source: 'IEX Legacy',
      configLabel: '缺失',
      configTone: 'warning',
      statusLabel: '旧链路',
      statusTone: 'neutral',
      impact: '旧版 IEX 沙箱未接入，不影响当前 L1/L4 主链路。',
      actionLabel: '暂不处理',
      actionKind: 'noop',
      credential: iex,
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
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [isRefreshLogOpen, setIsRefreshLogOpen] = useState(false);
  const [activeCredentialId, setActiveCredentialId] = useState<string | null>(null);

  const layerCards = useMemo(() => buildLayerCards(overview), [overview]);
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
  const activeCredentialDisplay = credentialDisplayRows.find((row) => row.id === activeCredentialId) ?? null;
  const healthSummary = getLayerHealthSummary(layerCards);
  const latestJob = overview?.latest_job ?? null;
  const price = getDataset(overview, 'ds-price');
  const corporate = getDataset(overview, 'ds-corporate-actions');
  const fundamentals = getDataset(overview, 'ds-fundamentals');
  const analyst = getDataset(overview, 'ds-analyst-consensus');
  const shortVolume = getDataset(overview, 'ds-short-volume');
  const macro = getDataset(overview, 'ds-macro-rates');
  const bond = overview?.bond_fixed_income;
  const bondCoverage = getBondCoverage(overview);

  useEffect(() => {
    if (!highlightTarget) {
      return;
    }
    const layerId = layerForTarget(highlightTarget);
    setHighlightedLayer(layerId);
    const timer = window.setTimeout(() => setHighlightedLayer(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightTarget]);

  useEffect(() => {
    if (openRefreshLogToken === undefined || openRefreshLogToken <= 0) {
      return;
    }
    setIsRefreshLogOpen(true);
  }, [openRefreshLogToken]);

  function handleDrill(layerId: LayerId): void {
    setHighlightedLayer(layerId);
    document.getElementById(`snapshot-layer-${layerId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(() => setHighlightedLayer(null), 2400);
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
          <article className="snapshots-ops-health-card snapshots-ops-health-card--warning snapshots-ops-health-card--active">
            <div className="snapshots-ops-card-title">
              <h3>L1 基础行情</h3>
              <span className="snapshots-ops-status snapshots-ops-status--warning">{healthSummary[0]?.value ?? '部分可用'}</span>
            </div>
            <div className="snapshots-ops-metric-line">
              <strong>股票 {plainMetric(getDatasetCoverage(price))} · 债券 {plainMetric(bondCoverage)}</strong>
              <span>10Y PIT 价格回放可用；固定收益运行态来源已就绪；30Y Full Ready 与公司行为补链仍在修复队列。</span>
            </div>
            <div className="snapshots-ops-mini-list">
              <div className="snapshots-ops-mini-row"><span>可用于</span><strong>动量 / 波动 / 债券资产腿</strong></div>
              <div className="snapshots-ops-mini-row"><span>待修复</span><strong>公司行为、长历史补价</strong></div>
              <button className="link-btn snapshots-ops-link-plain" type="button" onClick={() => handleDrill('l1')}>下钻缺口</button>
            </div>
          </article>
          <article className="snapshots-ops-health-card snapshots-ops-health-card--ready">
            <div className="snapshots-ops-card-title">
              <h3>L2 财务截面</h3>
              <span className="snapshots-ops-status snapshots-ops-status--ready">{healthSummary[1]?.value ?? '已就绪'}</span>
            </div>
            <div className="snapshots-ops-metric-line">
              <strong>{plainMetric(getDatasetCoverage(fundamentals))}</strong>
              <span>财务字段与发布时点门禁可进入质量、估值和稳健性因子研究。</span>
            </div>
            <div className="snapshots-ops-mini-list">
              <div className="snapshots-ops-mini-row"><span>字段数</span><strong>18</strong></div>
              <div className="snapshots-ops-mini-row"><span>观察项</span><strong>财务平衡校验</strong></div>
              <button className="link-btn snapshots-ops-link-plain" type="button" onClick={() => handleDrill('l2')}>查看观察项</button>
            </div>
          </article>
          <article className="snapshots-ops-health-card snapshots-ops-health-card--ready">
            <div className="snapshots-ops-card-title">
              <h3>L3 分析师与情绪</h3>
              <span className="snapshots-ops-status snapshots-ops-status--ready">{healthSummary[2]?.value ?? '已就绪'}</span>
            </div>
            <div className="snapshots-ops-metric-line">
              <strong>3 / 3</strong>
              <span>一致预期与卖空微观结构已形成正式快照，可进入研究监测。</span>
            </div>
            <div className="snapshots-ops-mini-list">
              <div className="snapshots-ops-mini-row"><span>一致预期</span><strong>{formatCount(analyst?.row_count)} 行</strong></div>
              <div className="snapshots-ops-mini-row"><span>卖空链路</span><strong>{formatCount(shortVolume?.row_count)} 行</strong></div>
              <button className="link-btn snapshots-ops-link-plain" type="button" onClick={() => handleDrill('l3')}>查看证据</button>
            </div>
          </article>
          <article className="snapshots-ops-health-card snapshots-ops-health-card--warning">
            <div className="snapshots-ops-card-title">
              <h3>L4 宏观与衍生品</h3>
              <span className="snapshots-ops-status snapshots-ops-status--warning">{healthSummary[3]?.value ?? '部分可用'}</span>
            </div>
            <div className="snapshots-ops-metric-line">
              <strong>{spacedCoverage(getDatasetCoverage(macro))}</strong>
              <span>利率 Beta、IV Skew 可作为特征源；正式 IC 诊断依赖 L1 样本池门禁。</span>
            </div>
            <div className="snapshots-ops-mini-list">
              <div className="snapshots-ops-mini-row"><span>可用</span><strong>利率、期权偏度</strong></div>
              <div className="snapshots-ops-mini-row"><span>上游依赖</span><strong>L1 样本池</strong></div>
              <button className="link-btn snapshots-ops-link-plain" type="button" onClick={() => handleDrill('l4')}>下钻依赖</button>
            </div>
          </article>
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
                      setActiveCredentialId('crsp_us_stock');
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
            <h2>L1 基础行情</h2>
            <p className="snapshots-ops-small-note">横向展示可用证据、固定收益基础行情、不可用部分和修复入口；切换 L2-L4 时复用同一位置，不再占用右侧长栏。</p>
          </div>
          <span className="snapshots-ops-status snapshots-ops-status--warning">{statusLabel(layerCards[0]?.status)}</span>
        </div>
        <div className="snapshots-ops-drill-grid">
          <article className={`snapshots-ops-drill-card snapshots-ops-drill-card--primary ${highlightedLayer === 'l1' ? 'snapshots-ops-drill-card--highlight' : ''}`} id="snapshot-layer-l1" data-layer-id="l1">
            <div className="snapshots-ops-card-title">
              <h3>可用边界</h3>
              <span className="snapshots-ops-status snapshots-ops-status--ready">研究可用</span>
            </div>
            <p>10Y PIT 价格和历史样本池可支撑研究回放；债券运行态来源可进入资产腿创建和风险预算预检。</p>
            <div className="snapshots-ops-mini-list">
              <div className="snapshots-ops-mini-row"><span>股票价格</span><strong>{plainMetric(getDatasetCoverage(price))}</strong></div>
              <div className="snapshots-ops-mini-row"><span>债券来源</span><strong>{plainMetric(bondCoverage)} 就绪</strong></div>
              <div className="snapshots-ops-mini-row"><span>允许动作</span><strong>研究回放 / 资产腿</strong></div>
            </div>
          </article>
          <article className="snapshots-ops-drill-card" id="snapshot-layer-l2" data-layer-id="l2">
            <h3>可用证据</h3>
            <div className="snapshots-ops-drill-list">
              <div className="snapshots-ops-check-row"><span className="snapshots-ops-status snapshots-ops-status--ready">已可用</span><div>价格行数 {plainMetric(formatCount(price?.row_count))}，覆盖 {plainMetric(getDatasetCoverage(price))}。</div></div>
              <div className="snapshots-ops-check-row"><span className="snapshots-ops-status snapshots-ops-status--ready">已可用</span><div>10Y PIT 回放可服务动量、波动和基础回测。</div></div>
              <div className="snapshots-ops-check-row"><span className="snapshots-ops-status snapshots-ops-status--ready">已可用</span><div>债券来源 {plainMetric(bondCoverage)} 就绪，可进入资产腿创建。</div></div>
            </div>
          </article>
          <article className="snapshots-ops-drill-card" id="snapshot-layer-l3" data-layer-id="l3">
            <h3>固定收益基础行情</h3>
            <div className="snapshots-ops-bond-mini-grid">
              <div><strong>国债曲线</strong><span>{(bond?.curve_preview ?? []).slice(0, 4).map((point) => `${point.tenor_label} ${point.yield_pct.toFixed(2)}%`).join(' · ') || '3M 3.69% · 2Y 3.95% · 10Y 4.45% · 30Y 5.02%'}</span></div>
              <div><strong>曲线审计</strong><span>10Y-2Y 利差 +50 bps，处于审计带内。</span></div>
              <div><strong>通胀保护债</strong><span>TIPS 5Y / 10Y 已具备真实收益率与通胀因子。</span></div>
              <div><strong>信用债代理</strong><span>LQD 可入风险预算；跟踪误差来源已记录。</span></div>
            </div>
          </article>
          <article className="snapshots-ops-drill-card" id="snapshot-layer-l4" data-layer-id="l4">
            <h3>不可用与修复</h3>
            <div className="snapshots-ops-drill-list">
              <div className="snapshots-ops-check-row"><span className="snapshots-ops-status snapshots-ops-status--warning">待补</span><div>公司行为链路未完成，影响 30Y Full Ready 和复权审计。</div></div>
              <div className="snapshots-ops-check-row"><span className="snapshots-ops-status snapshots-ops-status--warning">待配置</span><div>CRSP_DATA_PATH、NORGATE_DATA_PATH 缺失。</div></div>
            </div>
            <button
              className="primary-button"
              disabled={refreshDisabled}
              type="button"
              onClick={() => onRefresh({ mode: 'repair', targets: ['price', 'corporate', 'bond'], reason: 'snapshot-layer-l1-repair', phase2_scope: 'sp500_10y', phase2_max_symbols: 25 })}
            >
              运行 L1 修复
            </button>
            <button className="link-btn" type="button" onClick={() => setActiveCredentialId('crsp_us_stock')}>生成本机路径配置命令</button>
          </article>
        </div>
      </section>

      <section className="snapshots-ops-panel snapshots-ops-ledger">
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
                  const rowHighlighted = row.id === highlightTarget;
                  return (
                  <tr
                    className={rowHighlighted ? 'dense-row dense-row--highlight snapshots-ops-ledger-row--highlight' : undefined}
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
            {credentialDisplayRows.map((row) => (
              <div className="snapshots-ops-credential-row" key={row.id}>
                <div className="snapshots-ops-credential-key"><strong>{row.key}</strong><span>{row.source}</span></div>
                <span className={`snapshots-ops-status snapshots-ops-status--${row.configTone}`}>{row.configLabel}</span>
                <span className={`snapshots-ops-status snapshots-ops-status--${row.statusTone}`}>{row.statusLabel}</span>
                <p>{row.impact}</p>
                <button className="link-btn" type="button" onClick={() => {
                  if (row.actionKind !== 'noop') {
                    setActiveCredentialId(row.credential?.id ?? row.id);
                  }
                }}>
                  {row.actionLabel}
                </button>
              </div>
            ))}
          </div>
        </article>
        <article className="snapshots-ops-panel snapshots-ops-restart">
          <div className="snapshots-ops-panel__header">
            <div>
              <h2>重启命令</h2>
              <p className="snapshots-ops-small-note">仅在更新凭据或本机路径后执行；不提交后端、不落库。</p>
            </div>
            <button className="link-btn" type="button">复制命令</button>
          </div>
          <pre className="snapshots-ops-command-box">{activeCredential?.actionKind === 'configure_path'
            ? `$env:${activeCredential.keyLabel}="C:\\path\\to\\data"; powershell -ExecutionPolicy Bypass -File .\\QuickStart-Grit.ps1 -ForceRestart -RestartReason "snapshot provider credentials updated"`
            : activeCredentialDisplay?.actionKind === 'replace_key' || activeCredential?.actionKind === 'replace_key'
              ? `$env:${activeCredential?.keyLabel ?? activeCredentialDisplay?.key ?? '<KEY>'}="<paste-key>"; powershell -ExecutionPolicy Bypass -File .\\QuickStart-Grit.ps1 -ForceRestart -RestartReason "snapshot provider credentials updated"`
              : `powershell -ExecutionPolicy Bypass -File .\\QuickStart-Grit.ps1 -ForceRestart -RestartReason "snapshot provider credentials updated"`}</pre>
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
