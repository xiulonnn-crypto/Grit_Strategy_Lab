import { useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../lib/format';
import type {
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

const EQUITY_FILTERS: Array<{ id: EquityFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '仅看待补' },
  { id: 'dataset', label: '数据集快照' },
  { id: 'universe', label: '股票池快照' },
];

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
      return 'SEC EDGAR';
    case 'alpha_vantage':
      return 'Alpha Vantage';
    case 'tiingo':
      return 'Tiingo';
    case 'fmp':
      return 'Financial Modeling Prep';
    case 'fmp_historical_constituent':
      return 'FMP 历史成分';
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

export function EquitySnapshotsTab({
  overview,
  onRefresh,
  refreshDisabled,
  refreshLabel,
  highlightTarget,
}: EquitySnapshotsTabProps): JSX.Element {
  const [activeFilter, setActiveFilter] = useState<EquityFilter>('all');
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
  const lastRefresh =
    overview?.last_refreshed_at ??
    overview?.latest_job?.completed_at ??
    overview?.latest_job?.updated_at ??
    null;

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
            </small>
          </div>
        </div>
      </section>

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
    </div>
  );
}
