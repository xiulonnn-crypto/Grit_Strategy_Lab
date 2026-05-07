import { useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../lib/format';
import type {
  ApiDataTrustLayer,
  ApiDatasetSnapshot,
  ApiDatasetSnapshotMetadata,
  ApiSnapshotOverview,
  ApiUniverseSnapshot,
} from '../types';

type EquitySnapshotsTabProps = {
  overview: ApiSnapshotOverview | null;
  onRefresh: () => void;
  refreshDisabled: boolean;
  refreshLabel: string;
  highlightTarget?: string;
};

type EquityFilter = 'all' | 'pending' | 'dataset' | 'universe';

type EquityRuntimeRow = {
  id: string;
  title: string;
  summary: string;
  fields: string;
  schedule: string;
  status: string;
  statusLabel: string;
  note: string;
  filter: Exclude<EquityFilter, 'all' | 'pending'>;
  available?: boolean;
};

type BenchmarkEtfCoverageSummary = {
  ready: number;
  total: number;
  symbols: string[];
  missingSymbols: string[];
};

type CoverageChangeRow = {
  id: string;
  label: string;
  status: string;
  currentCoverage: string;
  change: string;
  remaining: string;
  source: string;
};

const EQUITY_FILTERS: Array<{ id: EquityFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '仅看待补' },
  { id: 'dataset', label: '数据集快照' },
  { id: 'universe', label: '股票池快照' },
];

const TRUST_CREDENTIAL_DRAFT_STORAGE_KEY = 'gsl.snapshots.trustCredentialDrafts.v1';

const COVERAGE_CHANGE_DATASET_LABELS: Record<string, string> = {
  'ds-price': '股票价格数据',
  'ds-corporate-actions': '公司行为数据',
  'ds-index-valuations': '指数估值数据',
};

function normalizeStatus(status?: string | null): string {
  return String(status ?? 'PENDING').toUpperCase();
}

function isReadyStatus(status?: string | null): boolean {
  return ['READY', 'COMPLETED'].includes(normalizeStatus(status));
}

function isPendingStatus(status?: string | null): boolean {
  return !isReadyStatus(status);
}

function getStatusLabel(status?: string | null): string {
  switch (normalizeStatus(status)) {
    case 'READY':
    case 'COMPLETED':
      return '就绪';
    case 'RUNNING':
      return '刷新中';
    case 'STALE':
      return '需复核';
    case 'INCOMPLETE':
      return '待补';
    case 'FAILED':
    case 'BLOCKED':
      return '阻塞';
    default:
      return '待刷新';
  }
}

function getTrustStatusLabel(status?: string | null): string {
  switch (String(status ?? '').toLowerCase()) {
    case 'usable':
      return '可用';
    case 'enabled':
      return '已启用';
    case 'missing_credentials':
      return '缺凭据';
    case 'blocked':
      return '阻塞';
    case 'registered':
      return '已登记';
    default:
      return '待配置';
  }
}

function trustStatusChipClassName(status?: string | null): string {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'usable' || normalized === 'enabled') {
    return 'status-chip status-chip--success';
  }
  if (normalized === 'missing_credentials' || normalized === 'blocked') {
    return 'status-chip status-chip--warning';
  }
  return 'status-chip status-chip--soft';
}

type TrustLayerDisplayCopy = {
  label: string;
  role: string;
  scope: string;
  boundary: string;
  actionFallback: string;
};

const TRUST_LAYER_DISPLAY_COPY: Record<string, TrustLayerDisplayCopy> = {
  price_primary_chain: {
    label: '价格主链',
    role: '复权日线与价格缺口修复',
    scope: '开高低收量、复权收盘、缺口补价',
    boundary: '不能替代成员历史、公司行动或身份确权。',
    actionFallback: '优先补齐 Tiingo；用于价格缺口第一轮修复。',
  },
  membership_history: {
    label: '成分股历史',
    role: '指数成员进出日期',
    scope: '历史成分、生效日、退出日',
    boundary: '只证明样本池，不能补价格或公司行动。',
    actionFallback: '优先补齐 FMP 历史成分；用于点时样本池门禁。',
  },
  delisted_identity: {
    label: '退市与身份',
    role: 'Ticker 生命周期与 CIK 确权',
    scope: 'CIK、退市身份、标准代码映射',
    boundary: '不提供价格，也不能把停止申报直接等同破产。',
    actionFallback: '补齐 SEC User-Agent 或身份源后生成生命周期证据。',
  },
  corporate_actions_zero_event: {
    label: '公司行动',
    role: '分红拆股与零事件证书',
    scope: '分红、拆股、无事件证明上下文',
    boundary: '公司行动缺口必须由事件源或零事件证书关闭。',
    actionFallback: '优先使用 Tiingo/Alpha Vantage；必要时用身份与价格结果交叉确证。',
  },
  long_history_patch: {
    label: '长周期补价',
    role: '老旧与退市价格补丁',
    scope: '长周期日线、退市价格候选、本地缓存',
    boundary: '仅修复价格缺口，不能单独通过正式就绪门禁。',
    actionFallback: '优先离线缓存；需要在线 Stooq 时显式开启本机开关。',
  },
  precision_repair: {
    label: '关键精修',
    role: '付费源关键缺口补证',
    scope: '高精度价格、公司行动、身份交叉验证',
    boundary: '只用于免费链无法闭合的关键标的。',
    actionFallback: '配置 Polygon 后用于关键缺口精修，不作为默认免费链。',
  },
};

function trustLayerDisplayCopy(layer: ApiDataTrustLayer): TrustLayerDisplayCopy {
  return (
    TRUST_LAYER_DISPLAY_COPY[String(layer.id ?? '')] ?? {
      label: layer.label || '证据层',
      role: layer.role || '数据源可用性与证据边界',
      scope: '覆盖范围、最近尝试、凭据状态',
      boundary: '需结合价格、成员历史、公司行动和身份映射判断。',
      actionFallback: '查看最近尝试与缺失凭据后再决定修复动作。',
    }
  );
}

function trustLayerProviderLine(layer: ApiDataTrustLayer, usableCount: number, providerCount: number): string {
  const preferredProvider = formatEquitySourceLabel(layer.preferred_provider || layer.provider_ids?.[0]);
  const providerIds =
    Array.isArray(layer.provider_ids) && layer.provider_ids.length
      ? layer.provider_ids
      : Array.isArray(layer.registered_provider_ids)
        ? layer.registered_provider_ids
        : [];
  const providerChain = providerIds
    .map((providerId) => formatEquitySourceLabel(providerId))
    .filter((label) => label.length > 0)
    .join(' → ');
  if (providerChain && providerChain !== preferredProvider) {
    return `优先级：${providerChain} · 可用 ${usableCount}/${providerCount}`;
  }
  return `主源：${preferredProvider} · 可用 ${usableCount}/${providerCount}`;
}

function trustLayerActionLine(layer: ApiDataTrustLayer, missingEnv: string[], display: TrustLayerDisplayCopy): string {
  if (missingEnv.length) {
    return `待配置：${missingEnv.join('、')}`;
  }
  return display.actionFallback;
}

function readCredentialDraftsFromSession(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.sessionStorage.getItem(TRUST_CREDENTIAL_DRAFT_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([envName, value]) => envName && typeof value === 'string')
        .map(([envName, value]) => [envName, value as string]),
    );
  } catch {
    return {};
  }
}

function writeCredentialDraftsToSession(drafts: Record<string, string>): void {
  if (typeof window === 'undefined') {
    return;
  }
  const cleaned = Object.fromEntries(
    Object.entries(drafts)
      .map(([envName, value]) => [envName, String(value ?? '').trim()] as const)
      .filter(([envName, value]) => envName && value),
  );
  try {
    if (Object.keys(cleaned).length) {
      window.sessionStorage.setItem(TRUST_CREDENTIAL_DRAFT_STORAGE_KEY, JSON.stringify(cleaned));
    } else {
      window.sessionStorage.removeItem(TRUST_CREDENTIAL_DRAFT_STORAGE_KEY);
    }
  } catch {
    // Browser storage can be disabled; keep the in-memory draft for the current render.
  }
}

function credentialInputType(envName: string): 'password' | 'text' {
  return envName === 'SEC_USER_AGENT' ? 'text' : 'password';
}

function credentialPlaceholder(envName: string): string {
  if (envName === 'SEC_USER_AGENT') {
    return '例如 GSL local ops contact@example.com';
  }
  if (envName === 'GRIT_ENABLE_STOOQ_ONLINE') {
    return '1';
  }
  return `输入 ${envName}`;
}

function quotePowerShellEnvValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildPowerShellPersistCredentialCommands(envName: string, value: string): string[] {
  const quotedEnvName = quotePowerShellEnvValue(envName);
  const quotedValue = quotePowerShellEnvValue(value);
  return [
    `[Environment]::SetEnvironmentVariable(${quotedEnvName}, ${quotedValue}, 'User')`,
    `[Environment]::SetEnvironmentVariable(${quotedEnvName}, ${quotedValue}, 'Process')`,
  ];
}

async function writeTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Restricted local browsers can reject navigator.clipboard even after a user click.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand?.('copy') === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function statusChipClassName(status?: string | null): string {
  const normalized = normalizeStatus(status);
  if (['FAILED', 'BLOCKED'].includes(normalized)) {
    return 'status-chip status-chip--danger';
  }
  if (['READY', 'COMPLETED'].includes(normalized)) {
    return 'status-chip status-chip--success';
  }
  return 'status-chip status-chip--warning';
}

function formatCount(value?: number | null): string {
  return typeof value === 'number' ? value.toLocaleString('zh-HK') : '0';
}

function formatPercent(ready: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }
  const value = (ready / total) * 100;
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function formatReadyPercent(ready: number, total: number): string {
  return `${formatPercent(ready, total)} 就绪`;
}

function formatCoveragePercent(covered: number, total: number): string {
  return `${formatPercent(covered, total)} 覆盖`;
}

function formatAvailablePercent(ready: number, total: number): string {
  return `${formatPercent(ready, total)} 可用`;
}

function formatMarketRefreshTime(value?: string | null): string {
  if (!value) {
    return '暂无';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '暂无';
  }
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  }).format(date);
}

function formatEquitySourceLabel(value?: string | null): string {
  const text = String(value ?? '').trim();
  switch (text.toLowerCase()) {
    case 'mixed_sources':
      return '多来源汇总';
    case 'official_announcement':
      return '官方公告';
    case 'wikipedia_revision_history':
      return '历史修订记录';
    case 'nasdaq_official_annual_changes':
      return '纳斯达克年度成分记录';
    case 'sec_edgar':
      return 'SEC EDGAR / CIK';
    case 'alpha_vantage':
      return 'Alpha Vantage';
    case 'tiingo':
      return 'Tiingo';
    case 'fmp':
      return 'Financial Modeling Prep';
    case 'finnhub':
      return 'Finnhub 身份校验';
    case 'fmp_historical_constituent':
      return 'FMP 历史成分';
    case 'stooq':
      return 'Stooq 长周期价格';
    case 'nasdaq_wiki':
      return 'Nasdaq WIKI 历史价格';
    case 'kaggle_huge_stock_market_dataset':
      return 'Kaggle 批量价格';
    case 'kaggle_delisted_bulk_archive':
      return 'Kaggle 退市价格';
    case 'polygon':
      return 'Polygon 精修';
    case 'tiingo_symbology':
      return 'Tiingo 身份映射';
    case 'openbb_yfinance':
      return 'OpenBB Yahoo 行情';
    case 'openbb_tiingo':
      return 'OpenBB Tiingo 行情';
    case 'openbb_alpha_vantage':
      return 'OpenBB Alpha Vantage 修复';
    case 'openbb_fmp':
      return 'OpenBB FMP 行情';
    case 'openbb_index_constituents':
      return 'OpenBB 当前成分校验';
    case 'yahoo':
    case 'yfinance':
      return 'Yahoo';
    case 'manual':
    case 'manual_override':
      return '人工补录';
    default:
      return text ? text.replace(/_/g, ' ') : '未声明';
  }
}

function getMetadata(item: ApiDatasetSnapshot | ApiUniverseSnapshot): Record<string, unknown> {
  return item.metadata && typeof item.metadata === 'object'
    ? (item.metadata as Record<string, unknown>)
    : {};
}

function getNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getStringList(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function getCoverageCounts(item: ApiDatasetSnapshot): { covered: number; total: number } | null {
  const metadata = getMetadata(item);
  const covered = getNumber(metadata, 'covered_symbol_count');
  const total = getNumber(metadata, 'total_symbol_count');
  if (covered === null || total === null || total <= 0) {
    return null;
  }
  return { covered, total };
}

function getBenchmarkEtfCoverage(datasetSnapshots: ApiDatasetSnapshot[]): BenchmarkEtfCoverageSummary {
  const priceSnapshot = datasetSnapshots.find((item) => item.id === 'ds-price');
  const metadata = (priceSnapshot?.metadata ?? {}) as ApiDatasetSnapshotMetadata;
  const coverage = metadata.benchmark_etf_coverage;
  const rawSymbols = Array.isArray(coverage?.symbols) ? coverage.symbols : [];
  const symbolRows = rawSymbols
    .map((item) => ({
      symbol: String(item?.symbol ?? '').trim().toUpperCase(),
      status: normalizeStatus(item?.status),
    }))
    .filter((item) => item.symbol.length > 0);
  const total =
    typeof coverage?.total_count === 'number' && Number.isFinite(coverage.total_count)
      ? coverage.total_count
      : symbolRows.length;
  const ready =
    typeof coverage?.ready_count === 'number' && Number.isFinite(coverage.ready_count)
      ? coverage.ready_count
      : symbolRows.filter((item) => isReadyStatus(item.status)).length;
  const missingSymbols = Array.isArray(coverage?.missing_symbols)
    ? coverage.missing_symbols.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : symbolRows.filter((item) => !isReadyStatus(item.status)).map((item) => item.symbol);

  return {
    ready,
    total,
    symbols: symbolRows.map((item) => item.symbol),
    missingSymbols,
  };
}

function getRefreshStats(overview: ApiSnapshotOverview | null): Record<string, unknown> {
  const summary = overview?.latest_job?.summary;
  if (!summary || typeof summary !== 'object') {
    return {};
  }
  const refreshStats = (summary as Record<string, unknown>).refresh_stats;
  return refreshStats && typeof refreshStats === 'object' ? (refreshStats as Record<string, unknown>) : {};
}

function getNestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function getDatasetRefreshStat(
  refreshStats: Record<string, unknown>,
  snapshotId: string,
): Record<string, unknown> | null {
  const datasets = getNestedRecord(refreshStats, 'datasets');
  const item = datasets?.[snapshotId];
  return item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
}

function getPositiveCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function formatDatasetRefreshDelta(
  stat: Record<string, unknown> | null,
  label: string,
): string | null {
  const rows = getPositiveCount(stat?.updated_row_count);
  const symbols = getPositiveCount(stat?.updated_symbol_count);
  if (!rows && !symbols) {
    return null;
  }
  if (rows && symbols) {
    return `${label} ${rows.toLocaleString('zh-HK')} 行 / ${symbols.toLocaleString('zh-HK')} 标的`;
  }
  if (rows) {
    return `${label} ${rows.toLocaleString('zh-HK')} 行`;
  }
  return `${label} ${symbols?.toLocaleString('zh-HK')} 标的`;
}

function formatRefreshChange(stat: Record<string, unknown> | null): string {
  const rows = getPositiveCount(stat?.updated_row_count);
  const symbols = getPositiveCount(stat?.updated_symbol_count);
  if (!rows && !symbols) {
    return '本次未新增';
  }
  if (rows && symbols) {
    return `${rows.toLocaleString('zh-HK')} 行 / ${symbols.toLocaleString('zh-HK')} 标的`;
  }
  if (rows) {
    return `${rows.toLocaleString('zh-HK')} 行`;
  }
  return `${symbols?.toLocaleString('zh-HK')} 标的`;
}

function summarizeTopProviders(providerSummary: unknown, fallbackSource?: string | null): string {
  const summary = providerSummary && typeof providerSummary === 'object'
    ? (providerSummary as Record<string, unknown>)
    : null;
  const providers = summary?.providers && typeof summary.providers === 'object'
    ? (summary.providers as Record<string, Record<string, unknown>>)
    : null;
  const landed = Object.entries(providers ?? {})
    .map(([providerId, item]) => ({
      providerId,
      rows: getPositiveCount(item?.landed_row_count) ?? 0,
      symbols: getPositiveCount(item?.landed_symbol_count) ?? 0,
      quotaLimited: Boolean(item?.quota_limited),
    }))
    .filter((item) => item.rows > 0 || item.symbols > 0)
    .sort((left, right) => right.rows - left.rows || right.symbols - left.symbols)
    .slice(0, 2);

  if (landed.length) {
    return landed
      .map((item) => {
        const detail = item.rows > 0
          ? `${item.rows.toLocaleString('zh-HK')} 行`
          : `${item.symbols.toLocaleString('zh-HK')} 标的`;
        return `${formatEquitySourceLabel(item.providerId)} ${detail}${item.quotaLimited ? '，配额受限' : ''}`;
      })
      .join('；');
  }
  return fallbackSource ? formatEquitySourceLabel(fallbackSource) : '暂无新增入库来源';
}

function formatDatasetCoverage(item: ApiDatasetSnapshot): string {
  const counts = getCoverageCounts(item);
  if (counts) {
    return `${formatCount(counts.covered)} / ${formatCount(counts.total)} 标的`;
  }
  const metadata = getMetadata(item);
  const proxyKeys = getStringList(metadata, 'proxy_keys');
  if (proxyKeys.length) {
    return `${formatCount(proxyKeys.length)} 个代理 / ${formatCount(item.row_count ?? 0)} 条观测`;
  }
  return `${formatCount(item.row_count ?? 0)} 行`;
}

function formatDatasetRemaining(item: ApiDatasetSnapshot): string {
  const counts = getCoverageCounts(item);
  if (!counts) {
    return item.status === 'READY' ? '无待补' : '等待刷新';
  }
  const missing = Math.max(0, counts.total - counts.covered);
  if (!missing) {
    return '无待补';
  }
  if (item.id === 'ds-corporate-actions') {
    const metadata = getMetadata(item);
    const formalEvents = getNumber(metadata, 'formal_event_symbol_count');
    const noEvents = getNumber(metadata, 'complete_no_events_symbol_count');
    const parts = [
      formalEvents !== null ? `正式事件 ${formatCount(formalEvents)}` : null,
      noEvents !== null ? `无事件确认 ${formatCount(noEvents)}` : null,
    ].filter(Boolean);
    return `${formatCount(missing)} 标的待补${parts.length ? `；${parts.join(' / ')}` : ''}`;
  }
  return `${formatCount(missing)} 标的待补`;
}

function formatUniverseCoverage(item: ApiUniverseSnapshot): string {
  const metadata = getMetadata(item);
  const historical = getNumber(metadata, 'historical_anchor_count');
  const anchors = getNumber(metadata, 'anchor_count');
  if (historical !== null && anchors !== null && anchors > 0) {
    return `${formatCount(historical)} / ${formatCount(anchors)} 历史锚点`;
  }
  return `${formatCount(item.member_count ?? 0)} 成分`;
}

function formatUniverseChange(stat: Record<string, unknown> | null): string {
  const anchorDelta = getPositiveCount(stat?.historical_anchor_delta);
  const rows = getPositiveCount(stat?.updated_row_count);
  if (anchorDelta && rows) {
    return `${anchorDelta.toLocaleString('zh-HK')} 个锚点 / ${rows.toLocaleString('zh-HK')} 行`;
  }
  if (anchorDelta) {
    return `${anchorDelta.toLocaleString('zh-HK')} 个锚点`;
  }
  if (rows) {
    return `${rows.toLocaleString('zh-HK')} 行`;
  }
  return '本次未新增';
}

function formatUniverseRemaining(item: ApiUniverseSnapshot): string {
  const metadata = getMetadata(item);
  const historical = getNumber(metadata, 'historical_anchor_count');
  const anchors = getNumber(metadata, 'anchor_count');
  if (historical !== null && anchors !== null && anchors > 0) {
    const missing = Math.max(0, anchors - historical);
    return missing ? `${formatCount(missing)} 个历史锚点待补` : '无待补';
  }
  return item.status === 'READY' ? '无待补' : '等待刷新';
}

function buildCoverageChangeRows(overview: ApiSnapshotOverview | null): CoverageChangeRow[] {
  const refreshStats = getRefreshStats(overview);
  const datasetOrder = ['ds-price', 'ds-corporate-actions', 'ds-index-valuations'];
  const universeOrder = ['un-sp500', 'un-ndx100'];
  const datasetRows = datasetOrder
    .map((snapshotId) => {
      const item = overview?.dataset_snapshots.find((candidate) => candidate.id === snapshotId);
      if (!item) return null;
      const stat = getDatasetRefreshStat(refreshStats, snapshotId);
      return {
        id: item.id,
        label: COVERAGE_CHANGE_DATASET_LABELS[item.id] ?? item.name ?? item.id,
        status: getStatusLabel(item.status),
        currentCoverage: formatDatasetCoverage(item),
        change: formatRefreshChange(stat),
        remaining: formatDatasetRemaining(item),
        source: summarizeTopProviders(
          stat?.provider_summary ?? item.metadata?.provider_summary,
          item.source || item.fallback_source,
        ),
      };
    })
    .filter((item): item is CoverageChangeRow => Boolean(item));

  const universes = getNestedRecord(refreshStats, 'universes');
  const universeRows = universeOrder
    .map((snapshotId) => {
      const item = overview?.universe_snapshots.find((candidate) => candidate.id === snapshotId);
      if (!item) return null;
      const stat = universes?.[snapshotId] && typeof universes[snapshotId] === 'object'
        ? (universes[snapshotId] as Record<string, unknown>)
        : null;
      return {
        id: item.id,
        label: `${item.name || item.id}股票池`,
        status: getStatusLabel(item.status),
        currentCoverage: formatUniverseCoverage(item),
        change: formatUniverseChange(stat),
        remaining: formatUniverseRemaining(item),
        source: summarizeTopProviders(
          stat?.provider_summary ?? item.metadata?.provider_summary,
          item.source || item.fallback_source,
        ),
      };
    })
    .filter((item): item is CoverageChangeRow => Boolean(item));

  return [...datasetRows, ...universeRows];
}

function formatLatestRefreshDelta(overview: ApiSnapshotOverview | null): string {
  const refreshStats = getRefreshStats(overview);
  const parts = [
    formatDatasetRefreshDelta(getDatasetRefreshStat(refreshStats, 'ds-price'), '股票价格数据'),
    formatDatasetRefreshDelta(getDatasetRefreshStat(refreshStats, 'ds-corporate-actions'), '公司行为数据'),
    formatDatasetRefreshDelta(getDatasetRefreshStat(refreshStats, 'ds-index-valuations'), '指数估值数据'),
  ].filter((item): item is string => Boolean(item));

  return parts.length ? `本次新增 ${parts.join(' · ')}` : '本次新增 0 行';
}

function translateSnapshotNote(raw?: string | null): string | null {
  const text = String(raw ?? '').trim();
  if (!text) {
    return null;
  }
  if (
    text.startsWith('Corporate action data is partially available') ||
    text.startsWith('Corporate action snapshot is still incomplete')
  ) {
    return '公司行为数据已部分可用，仍有少量公司事件待继续补齐。';
  }
  if (text.startsWith('Price snapshot is still incomplete')) {
    return '股票价格数据已部分可用，仍有少量股票待继续补齐。';
  }
  if (text.startsWith('Universe history is partially available')) {
    return '股票池历史成分已部分可用，仍有部分历史锚点待继续补齐。';
  }
  if (text.startsWith('Historical anchors are complete')) {
    return '历史锚点已完整，可继续作为股票池基准。';
  }
  if (text.startsWith('runtime snapshot repository')) {
    return '来自当前快照仓库';
  }
  if (text.startsWith('runtime universe snapshot repository')) {
    return '来自当前股票池快照仓库';
  }
  return text;
}

function describeDataset(item: ApiDatasetSnapshot): EquityRuntimeRow {
  const metadata = getMetadata(item);
  const covered = getNumber(metadata, 'covered_symbol_count');
  const total = getNumber(metadata, 'total_symbol_count');
  const missing = getStringList(metadata, 'missing_symbols');
  const coverage =
    covered !== null && total !== null && total > 0
      ? `${formatCount(covered)} / ${formatCount(total)} 覆盖`
      : `${formatCount(item.row_count)} 行`;
  const note = item.blocker?.message
    ? translateSnapshotNote(item.blocker.message) ?? item.blocker.message
    : missing.length
      ? `仍有 ${formatCount(missing.length)} 个 symbol 待补`
      : translateSnapshotNote(item.freshness_label) ?? item.freshness_label ?? '来自当前快照仓库';

  return {
    id: item.id,
    title: item.name || item.id,
    summary: `${item.id} · ${coverage}`,
    fields: `窗口 ${item.start_date ?? '未知'} 至 ${item.end_date ?? '未知'}`,
    schedule: `来源 ${formatEquitySourceLabel(item.source || item.fallback_source)}`,
    status: item.status,
    statusLabel: getStatusLabel(item.status),
    note,
    filter: 'dataset',
    available: isReadyStatus(item.status),
  };
}

function describeUniverse(item: ApiUniverseSnapshot): EquityRuntimeRow {
  const metadata = getMetadata(item);
  const historical = getNumber(metadata, 'historical_anchor_count');
  const anchors = getNumber(metadata, 'anchor_count');
  const missingAnchors = getStringList(metadata, 'official_seed_missing_anchors');
  const hasConstituentMembers = (item.member_count ?? 0) > 0;
  const coverage =
    historical !== null && anchors !== null && anchors > 0
      ? `${formatCount(historical)} / ${formatCount(anchors)} 锚点`
      : `${formatCount(item.member_count)} 成分`;
  const note = item.blocker?.message
    ? translateSnapshotNote(item.blocker.message) ?? item.blocker.message
    : missingAnchors.length
      ? `仍有 ${formatCount(missingAnchors.length)} 个历史锚点待补`
      : translateSnapshotNote(item.freshness_label) ?? item.freshness_label ?? '来自当前股票池快照仓库';

  return {
    id: item.id,
    title: item.name || item.id,
    summary: `${item.id} · ${coverage}`,
    fields: `窗口 ${item.window_start ?? '未知'} 至 ${item.window_end ?? '未知'}`,
    schedule: `来源 ${formatEquitySourceLabel(item.source || item.fallback_source)}`,
    status: item.status,
    statusLabel: getStatusLabel(item.status),
    note,
    filter: 'universe',
    available: hasConstituentMembers || isReadyStatus(item.status),
  };
}

function shouldShowRow(row: EquityRuntimeRow, activeFilter: EquityFilter): boolean {
  if (activeFilter === 'all') {
    return true;
  }
  if (activeFilter === 'pending') {
    return isPendingStatus(row.status);
  }
  return row.filter === activeFilter;
}

function filterButtonClassName(filter: EquityFilter, activeFilter: EquityFilter): string {
  return `filter-chip ${filter === activeFilter ? 'filter-chip--active' : ''}`.trim();
}

function isEquityBasketRow(row: EquityRuntimeRow): boolean {
  const searchable = `${row.id} ${row.title} ${row.summary}`.toLowerCase();
  return searchable.includes('basket') || searchable.includes('theme') || searchable.includes('etf') || searchable.includes('篮子');
}

function DataTrustLayerPanel({ layers }: { layers: ApiDataTrustLayer[] }): JSX.Element | null {
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>(() =>
    readCredentialDraftsFromSession(),
  );
  const [credentialNotices, setCredentialNotices] = useState<Record<string, string>>({});
  const missingCredentialOptions = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    layers.forEach((layer) => {
      (layer.missing_env_vars ?? []).forEach((envName) => {
        if (!seen.has(envName)) {
          seen.add(envName);
          ordered.push(envName);
        }
      });
    });
    return ordered;
  }, [layers]);
  const [selectedCredential, setSelectedCredential] = useState('');
  const missingCredentialKey = missingCredentialOptions.join('\u0000');
  useEffect(() => {
    setCredentialDrafts((current) => {
      const allowed = new Set(missingCredentialOptions);
      const filtered = Object.fromEntries(Object.entries(current).filter(([envName]) => allowed.has(envName)));
      const currentKeys = Object.keys(current).sort().join('\u0000');
      const filteredKeys = Object.keys(filtered).sort().join('\u0000');
      return currentKeys === filteredKeys ? current : filtered;
    });
  }, [missingCredentialKey, missingCredentialOptions]);
  useEffect(() => {
    writeCredentialDraftsToSession(credentialDrafts);
  }, [credentialDrafts]);
  useEffect(() => {
    if (!missingCredentialOptions.length) {
      if (selectedCredential) {
        setSelectedCredential('');
      }
      return;
    }
    if (!selectedCredential || !missingCredentialOptions.includes(selectedCredential)) {
      setSelectedCredential(missingCredentialOptions[0]);
    }
  }, [missingCredentialKey, missingCredentialOptions, selectedCredential]);
  if (!layers.length) {
    return null;
  }
  const visibleLayers = layers.slice(0, 6);
  const activeCredential = missingCredentialOptions.includes(selectedCredential)
    ? selectedCredential
    : missingCredentialOptions[0] ?? '';
  const updateCredentialDraft = (envName: string, value: string): void => {
    setCredentialDrafts((current) => ({ ...current, [envName]: value }));
    setCredentialNotices((current) => ({
      ...current,
      [envName]: '已暂存到当前浏览器标签页；刷新不会清空，关闭标签页或清空暂存即删除。',
    }));
  };
  const clearCredentialDrafts = (): void => {
    setCredentialDrafts({});
    setCredentialNotices(
      Object.fromEntries(missingCredentialOptions.map((envName) => [envName, '已清空本标签页暂存草稿。'])),
    );
  };
  const buildQuickStartCredentialCommand = (activeEnvName: string): string => {
    const credentialPairs = missingCredentialOptions
      .map((envName) => [envName, String(credentialDrafts[envName] ?? '').trim()] as const)
      .filter(([, value]) => value);
    if (!credentialPairs.some(([envName]) => envName === activeEnvName)) {
      const activeValue = String(credentialDrafts[activeEnvName] ?? '').trim();
      if (activeValue) {
        credentialPairs.push([activeEnvName, activeValue]);
      }
    }
    const envCommands = credentialPairs.flatMap(([envName, value]) =>
      buildPowerShellPersistCredentialCommands(envName, value),
    );
    return [...envCommands, 'powershell -ExecutionPolicy Bypass -File .\\QuickStart-Grit.ps1'].join('\n');
  };
  const copyCredentialCommand = async (envName: string): Promise<void> => {
    const value = String(credentialDrafts[envName] ?? '').trim();
    if (!value) {
      setCredentialNotices((current) => ({ ...current, [envName]: '请先输入本机配置值，再复制持久化启动命令。' }));
      return;
    }
    const command = buildQuickStartCredentialCommand(envName);
    if (await writeTextToClipboard(command)) {
      setCredentialNotices((current) => ({
        ...current,
        [envName]: '已复制用户环境持久化+重启命令；粘贴执行一次后，后续新启动 QuickStart 会自动继承。',
      }));
      return;
    }
    setCredentialNotices((current) => ({
      ...current,
      [envName]: '复制失败；请手动写入 Windows 用户环境或 QuickStart-Grit.local.ps1 后重启。',
    }));
  };
  return (
      <section className="factor-panel factor-full-ready-plan snapshots-data-trust-layer" data-section="data-trust-summary">
        <div className="factor-section-title">
          <span>补源优先级与证据层</span>
          <span className="factor-muted">价格主链 → 成分历史 → 长周期补价 → 身份确权 → 关键精修</span>
        </div>
        <p className="factor-muted">
          按证据用途分层展示补源顺序、可证明范围和门禁边界；缺 key 只影响对应补源，不代表全部数据不可用。
        </p>
        <div className="factor-trust-layer-grid">
          {visibleLayers.map((layer) => {
            const usableCount = layer.usable_provider_count ?? layer.usable_provider_ids?.length ?? 0;
            const providerCount = layer.provider_count ?? layer.registered_provider_ids?.length ?? layer.provider_ids?.length ?? 0;
            const missingEnv = layer.missing_env_vars ?? [];
            const display = trustLayerDisplayCopy(layer);
            return (
              <article className="factor-trust-layer-card" key={layer.id}>
                <div>
                  <strong>{display.label}</strong>
                  <span className={trustStatusChipClassName(layer.status)}>{getTrustStatusLabel(layer.status)}</span>
                </div>
                <p>{display.role}</p>
                <small>{trustLayerProviderLine(layer, usableCount, providerCount)}</small>
                <small>证据：{display.scope}</small>
                <small>边界：{display.boundary}</small>
                <small>{trustLayerActionLine(layer, missingEnv, display)}</small>
              </article>
            );
          })}
        </div>
      {missingCredentialOptions.length ? (
        <div className="snapshots-trust-credential-panel">
          <div className="factor-section-title snapshots-trust-credential-title">
            <span>当前缺少的 API_KEY</span>
            <span className="factor-muted">{missingCredentialOptions.length} 项待配置</span>
          </div>
          <p className="factor-muted">
            先选择需要补齐的本机配置，再输入值并复制 PowerShell 用户环境持久化+重启命令；输入值仅保存在当前浏览器标签页，不提交后端、不落库。
          </p>
          <p className="factor-muted snapshots-trust-restart-note">
            复制命令会同时写入 Windows 用户环境和当前 PowerShell 进程；当前后端仍需重启后才会读取新值。
          </p>
          <div className="snapshots-trust-credential-form">
            <label htmlFor="snapshots-missing-api-key-select">选择缺少的 API_KEY</label>
            <select
              aria-label="选择缺少的 API_KEY"
              id="snapshots-missing-api-key-select"
              onChange={(event) => setSelectedCredential(event.target.value)}
              value={activeCredential}
            >
              {missingCredentialOptions.map((envName) => (
                <option key={envName} value={envName}>
                  {envName}
                </option>
              ))}
            </select>
            {activeCredential ? (
              <div className="snapshots-trust-input">
                <label htmlFor={`snapshots-trust-selected-${activeCredential}`}>{activeCredential}</label>
                <div className="snapshots-trust-input__row">
                  <input
                    aria-label={`${activeCredential} 输入`}
                    autoComplete="off"
                    id={`snapshots-trust-selected-${activeCredential}`}
                    onChange={(event) => updateCredentialDraft(activeCredential, event.target.value)}
                    placeholder={credentialPlaceholder(activeCredential)}
                    type={credentialInputType(activeCredential)}
                    value={credentialDrafts[activeCredential] ?? ''}
                  />
                  <button
                    className="ghost-button snapshots-trust-copy-button"
                    onClick={() => void copyCredentialCommand(activeCredential)}
                    type="button"
                  >
                    复制 {activeCredential} 设置命令
                  </button>
                </div>
                <small>
                  {credentialNotices[activeCredential] || '复制命令会带上当前已输入的全部 key，写入 Windows 用户环境并立即重启 QuickStart。'}
                </small>
              </div>
            ) : null}
            <button className="ghost-button snapshots-trust-copy-button" onClick={clearCredentialDrafts} type="button">
              清空本标签页暂存
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function EquitySnapshotsTab({
  overview,
  onRefresh,
  refreshDisabled,
  refreshLabel,
  highlightTarget,
}: EquitySnapshotsTabProps): JSX.Element {
  const [activeFilter, setActiveFilter] = useState<EquityFilter>('all');
  const [isCoverageModalOpen, setIsCoverageModalOpen] = useState(false);
  const datasetSnapshots = overview?.dataset_snapshots ?? [];
  const universeSnapshots = overview?.universe_snapshots ?? [];
  const rows = useMemo(
    () => [
      ...datasetSnapshots.map(describeDataset),
      ...universeSnapshots.map(describeUniverse),
    ],
    [datasetSnapshots, universeSnapshots],
  );
  const visibleRows = rows.filter((row) => shouldShowRow(row, activeFilter));
  useEffect(() => {
    if (!highlightTarget) return;
    const matched = rows.find((row) => row.id === highlightTarget);
    if (matched) {
      setActiveFilter(matched.filter);
    }
    window.requestAnimationFrame(() => {
      const target = document.getElementById('equity-runtime-snapshot-list');
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  }, [highlightTarget, rows]);
  const readyDatasetCount = datasetSnapshots.filter((item) => isReadyStatus(item.status)).length;
  const readyUniverseCount = universeSnapshots.filter((item) => isReadyStatus(item.status)).length;
  const pendingCount = rows.filter((row) => isPendingStatus(row.status)).length;
  const basketRows = rows.filter((row) => row.filter === 'universe' || isEquityBasketRow(row));
  const availableBasketCount = basketRows.filter((row) => row.available ?? isReadyStatus(row.status)).length;
  const basketUnavailableCount = basketRows.length - availableBasketCount;
  const basketReady = basketRows.length > 0 && availableBasketCount === basketRows.length;
  const benchmarkCoverage = getBenchmarkEtfCoverage(datasetSnapshots);
  const benchmarkReady = benchmarkCoverage.total > 0 && benchmarkCoverage.ready === benchmarkCoverage.total;
  const totalUniverseMembers = universeSnapshots.reduce((total, item) => total + (item.member_count ?? 0), 0);
  const datasetCoverage = datasetSnapshots.reduce(
    (accumulator, item) => {
      const counts = getCoverageCounts(item);
      if (!counts) {
        return accumulator;
      }
      return {
        covered: accumulator.covered + counts.covered,
        total: accumulator.total + counts.total,
      };
    },
    { covered: 0, total: 0 },
  );
  const stockSnapshotHeadline =
    datasetCoverage.total > 0
      ? formatCoveragePercent(datasetCoverage.covered, datasetCoverage.total)
      : formatReadyPercent(readyDatasetCount, datasetSnapshots.length);
  const stockSnapshotSummary =
    datasetCoverage.total > 0
      ? `${formatCount(datasetCoverage.covered)}/${formatCount(datasetCoverage.total)} 个 symbol 已覆盖，按公司行为数据与股票价格数据合并计算。`
      : `${readyDatasetCount}/${datasetSnapshots.length} 个数据集就绪，覆盖价格与公司行为。`;
  const stockBaseReadyCount = datasetCoverage.total > 0 ? datasetCoverage.covered : readyDatasetCount;
  const stockBaseTotalCount = datasetCoverage.total > 0 ? datasetCoverage.total : datasetSnapshots.length;
  const refreshDeltaLabel = formatLatestRefreshDelta(overview);
  const coverageChangeRows = useMemo(() => buildCoverageChangeRows(overview), [overview]);
  const lastRefresh =
    overview?.last_refreshed_at ??
    overview?.latest_job?.completed_at ??
    overview?.latest_job?.updated_at ??
    null;
  const dataTrustLayers = overview?.data_trust_summary?.layers ?? [];

  function jumpToIssues(filter: EquityFilter = 'pending'): void {
    setActiveFilter(filter);
    window.requestAnimationFrame(() => {
      const target = document.getElementById('equity-runtime-snapshot-list');
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <div className="snapshots-equity-view">
      <section className="panel snapshots-equity-overview snapshots-global-dashboard-panel">
        <div className="panel-header">
          <div>
            <h2>健康仪表盘</h2>
            <p className="panel-note">
              用少数健康指标判断股票、指数与权益篮子是否足以支撑当日研究、回测对照和组合引用。
            </p>
          </div>
          <button
            className="primary-button"
            disabled={refreshDisabled}
            onClick={onRefresh}
            type="button"
          >
            {refreshLabel}
          </button>
        </div>
        <div className="metric-grid">
          <div className="metric-card metric-card--accent">
            <span>股票快照</span>
            <strong>{stockSnapshotHeadline}</strong>
            <small>{stockSnapshotSummary}</small>
          </div>
          <div className={benchmarkReady ? 'metric-card metric-card--accent' : 'metric-card metric-card--warning'}>
            <span>指数与基准</span>
            <strong>{formatReadyPercent(benchmarkCoverage.ready, benchmarkCoverage.total)}</strong>
            <small>
              {benchmarkCoverage.ready}/{benchmarkCoverage.total} 个基准ETF历史数据完备
              {benchmarkCoverage.symbols.length ? `，覆盖 ${benchmarkCoverage.symbols.join('、')}。` : '。'}
            </small>
          </div>
          <div className={basketReady ? 'metric-card metric-card--accent' : 'metric-card metric-card--warning'}>
            <span>权益篮子</span>
            <strong>{formatAvailablePercent(availableBasketCount, basketRows.length)}</strong>
            <small>
              {basketRows.length
                ? `${availableBasketCount}/${basketRows.length} 个权益篮子可用，标普和纳指成分股名单已纳入口径。`
                : '当前未返回权益篮子快照，按 0 处理。'}
            </small>
          </div>
          <div className="metric-card metric-card--warning">
            <span>异常队列</span>
            <strong>{pendingCount} 项例外</strong>
            <small>
              <a
                className="audit-link"
                href="#equity-runtime-snapshot-list"
                onClick={(event) => {
                  event.preventDefault();
                  jumpToIssues('pending');
                }}
              >
                只看待补快照
              </a>
            </small>
          </div>
          <div className="metric-card">
            <span>最新刷新（EST）</span>
            <strong>{formatMarketRefreshTime(lastRefresh)}</strong>
            <small>
              {refreshDeltaLabel}
              <button
                className="audit-link snapshots-coverage-detail-link"
                onClick={() => {
                  setIsCoverageModalOpen(true);
                }}
                type="button"
              >
                查看明细
              </button>
            </small>
          </div>
        </div>
      </section>

      {isCoverageModalOpen ? (
        <div
          className="snapshots-coverage-modal-backdrop"
          onClick={() => {
            setIsCoverageModalOpen(false);
          }}
        >
          <section
            aria-labelledby="snapshots-coverage-modal-title"
            aria-modal="true"
            className="snapshots-coverage-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
            role="dialog"
          >
            <div className="snapshots-coverage-modal__header">
              <div>
                <p className="eyebrow">覆盖变化</p>
                <h2 id="snapshots-coverage-modal-title">覆盖变化明细</h2>
                <p>
                  按最新刷新任务的入库统计和当前快照覆盖率展示；覆盖口径不把重复尝试视作额外收益。
                </p>
              </div>
              <button
                className="ghost-button snapshots-coverage-modal__close"
                onClick={() => {
                  setIsCoverageModalOpen(false);
                }}
                type="button"
              >
                关闭
              </button>
            </div>
            {coverageChangeRows.length ? (
              <div className="snapshots-coverage-table-wrap">
                <table className="snapshots-coverage-table">
                  <thead>
                    <tr>
                      <th scope="col">项目</th>
                      <th scope="col">状态</th>
                      <th scope="col">当前覆盖</th>
                      <th scope="col">本次变化</th>
                      <th scope="col">仍待补</th>
                      <th scope="col">主要来源 / 说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverageChangeRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.label}</td>
                        <td>{row.status}</td>
                        <td>{row.currentCoverage}</td>
                        <td>{row.change}</td>
                        <td>{row.remaining}</td>
                        <td>{row.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="drawer-callout">暂无可展示的覆盖变化。请先刷新快照后再查看明细。</div>
            )}
          </section>
        </div>
      ) : null}

      <div className="detail-grid snapshots-equity-main-layout">
        <div className="detail-main snapshots-equity-left-stack">
      <section className="panel snapshots-equity-workstation">
        <div className="panel-header snapshots-workstation-header">
          <div className="snapshots-workstation-heading">
            <div className="snapshots-workstation-title-row">
              <h2>三位一体工作站</h2>
            </div>
            <p className="panel-note snapshots-workstation-copy">
              把股票池、指数基准和权益篮子的关键门禁放在同一屏，先看哪些来源可用，再决定是否继续建仓。
            </p>
          </div>
        </div>
        <div className="bond-core-grid">
          <article className="bond-core-card">
            <div className="source-head">
              <div>
                <strong>股票底库</strong>
                <p>股票清单、行业映射与公司行为审计，是整个研究入口的基础库存。</p>
              </div>
              <span className={pendingCount ? 'status-chip status-chip--warning' : 'status-chip status-chip--success'}>
                {pendingCount ? '待审计' : '就绪'}
              </span>
            </div>
            <div className="progress-shell">
              <div className="progress-meta">
                <span>{stockBaseReadyCount}/{stockBaseTotalCount} 就绪</span>
                <span>{formatCount(totalUniverseMembers)} 成分</span>
              </div>
              <div className="progress-bar">
                <span style={{ width: formatPercent(stockBaseReadyCount, stockBaseTotalCount) }} />
              </div>
            </div>
            <ul>
              <li>角色：多因子实验室、工作站与筛选器的统一股票底座。</li>
              <li>状态：待补项会进入原始快照清单，先修复再继续建仓。</li>
            </ul>
          </article>
          <article className="bond-core-card">
            <div className="source-head">
              <div>
                <strong>指数与基准</strong>
                <p>SPY、QQQ、TLT、GLD、VIX 以及研究口径下的核心对照对象。</p>
              </div>
              <span className={benchmarkReady ? 'status-chip status-chip--success' : 'status-chip status-chip--warning'}>
                {benchmarkReady ? '就绪' : `${benchmarkCoverage.total - benchmarkCoverage.ready} 待补`}
              </span>
            </div>
            <div className="progress-shell">
              <div className="progress-meta">
                <span>{benchmarkCoverage.ready} 就绪</span>
                <span>{benchmarkCoverage.total} 总数</span>
              </div>
              <div className="progress-bar">
                <span style={{ width: formatPercent(benchmarkCoverage.ready, benchmarkCoverage.total) }} />
              </div>
            </div>
            <ul>
              <li>角色：详情页、回测分析与工作台共用的观察和对照对象。</li>
              <li>状态：全部对齐后，才可作为收益曲线和策略对照默认基准。</li>
            </ul>
          </article>
          <article className="bond-core-card">
            <div className="source-head">
              <div>
                <strong>权益篮子</strong>
                <p>主题 ETF、因子篮子与资产腿的权益库存，都保留在可审计快照源里。</p>
              </div>
              <span className={basketReady ? 'status-chip status-chip--success' : 'status-chip status-chip--warning'}>
                {basketReady ? '就绪' : `${basketUnavailableCount} 待处理`}
              </span>
            </div>
            <div className="progress-shell">
              <div className="progress-meta">
                <span>{availableBasketCount} 就绪</span>
                <span>{basketRows.length} 总数</span>
              </div>
              <div className="progress-bar">
                <span style={{ width: formatPercent(availableBasketCount, basketRows.length) }} />
              </div>
            </div>
            <ul>
              <li>角色：资产腿与正式组合的通用权益来源。</li>
              <li>状态：待补项目会直接跳到原始快照清单，修复后再引用。</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="panel" id="equity-runtime-snapshot-list">
        <div className="panel-header">
          <div>
            <h2>原始快照清单</h2>
            <p className="panel-note">
              展示每组股票或指数快照的字段覆盖、调度来源与缺口原因，支持从待审计项回到修复动作。
            </p>
          </div>
          <span className="status-chip status-chip--soft">数据集快照 / 股票池快照</span>
        </div>
        <div className="toolbar" aria-label="权益快照筛选">
          {EQUITY_FILTERS.map((filter) => (
            <button
              aria-pressed={activeFilter === filter.id}
              className={filterButtonClassName(filter.id, activeFilter)}
              key={filter.id}
              onClick={() => {
                setActiveFilter(filter.id);
              }}
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </div>
        {visibleRows.length ? (
          <div className="bond-snapshot-table">
            {visibleRows.map((row) => (
              <article
                className={`bond-snapshot-row snapshots-row-card ${
                  row.id === highlightTarget ? 'snapshots-row-card--highlight' : ''
                }`}
                data-snapshot-id={row.id}
                key={`${row.filter}-${row.id}`}
              >
                <div className="bond-snapshot-row__cell">
                  <strong>{row.title}</strong>
                  <span>{row.summary}</span>
                </div>
                <div className="bond-snapshot-row__cell">
                  <strong>字段</strong>
                  <span>{row.fields}</span>
                </div>
                <div className="bond-snapshot-row__cell">
                  <strong>调度</strong>
                  <span>{row.schedule}</span>
                </div>
                <div className="bond-snapshot-row__cell">
                  <strong>状态</strong>
                  <span>
                    <span className={statusChipClassName(row.status)}>{row.statusLabel}</span>
                  </span>
                  <span>{row.note}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="drawer-callout">
            当前筛选下没有快照记录。请先触发刷新，或检查本地市场数据仓库是否有入库数据。
          </div>
        )}
      </section>
        </div>
        <aside className="detail-rail snapshots-equity-right-stack">
      <section className="rail-panel">
        <div className="panel-header">
          <div>
            <h2>数据诊断报告</h2>
            <p className="panel-note">
              诊断区汇总当前快照状态：{pendingCount} 项待补，最近刷新{' '}
              {lastRefresh ? formatDateTime(lastRefresh) : '暂无'}。
            </p>
          </div>
        </div>
        <div className="snapshots-bond-source-stack">
          {rows.filter((row) => isPendingStatus(row.status)).map((row) => (
            <article className="snapshots-bond-evidence-card" key={`diagnostic-${row.filter}-${row.id}`}>
              <div className="snapshots-bond-snapshot-head">
                <strong>待补：{row.title}</strong>
                <span className={statusChipClassName(row.status)}>{row.statusLabel}</span>
              </div>
              <span>{row.note}</span>
            </article>
          ))}
          {pendingCount === 0 ? (
            <article className="snapshots-bond-evidence-card">
              <strong>当前没有待补项</strong>
              <span>所有快照均已通过当前就绪门禁。</span>
            </article>
          ) : null}
        </div>
      </section>
      <section className="rail-panel snapshots-equity-readiness">
        <div className="panel-header">
          <div>
            <h2>就绪标准</h2>
            <p className="panel-note">
              只有数据集快照和股票池快照同时可用，后续创建、回测和优化链路才视为通过数据门禁。
            </p>
          </div>
        </div>
        <div className="snapshots-bond-source-stack">
          <article className="snapshots-bond-evidence-card">
            <strong>数据集门禁</strong>
            <span>{readyDatasetCount}/{datasetSnapshots.length} 个数据集已就绪，覆盖价格与公司行为。</span>
          </article>
          <article className="snapshots-bond-evidence-card">
            <strong>股票池门禁</strong>
            <span>{readyUniverseCount}/{universeSnapshots.length} 个股票池已就绪，覆盖成员与历史锚点。</span>
          </article>
        </div>
      </section>
        </aside>
      </div>
      <DataTrustLayerPanel layers={dataTrustLayers} />
    </div>
  );
}
