import { useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../lib/format';
import { useApiClient } from '../lib/demoStoreContext';
import type {
  ApiDatasetSnapshot,
  ApiSnapshotBlocker,
  ApiSnapshotJob,
  ApiSnapshotOverview,
  ApiUniverseSnapshot,
} from '../types';
import './run-detail-page.css';
import './snapshots-page.css';

const DATASET_COPY: Record<string, string> = {
  公司行为数据: '1996-01-01 至今的公司事件日期（拆股 / 合股 / 股息 / 财报等）。',
  股票价格数据: '1996-01-01 至今的日线 OHLC 数据。',
};

const UNIVERSE_COPY: Record<string, string> = {
  标普500: '过去 30 年历史时点成分股，按 01-01 / 07-01 锚点快照更新。',
  纳指100: '过去 30 年历史时点成分股，按 01-01 / 07-01 锚点快照更新。',
};

const SOURCE_LABELS: Record<string, string> = {
  yahoo: 'Yahoo Finance',
  Yahoo: 'Yahoo Finance',
  tiingo: 'Tiingo',
  Tiingo: 'Tiingo',
  alpha_vantage: 'Alpha Vantage',
  AlphaVantage: 'Alpha Vantage',
  sec_edgar: 'SEC EDGAR',
  SecEdgar: 'SEC EDGAR',
  fmp: 'Financial Modeling Prep',
  Fmp: 'Financial Modeling Prep',
  fmp_historical_constituent: 'FMP 历史成分',
  FmpHistoricalConstituent: 'FMP 历史成分',
  longbridge: 'Longbridge',
  longbridge_static_info: 'Longbridge',
  akshare_us: 'AkShare',
  official_announcement: '官方公告',
  officialAnnouncement: '官方公告',
  nasdaq_official_annual_changes: '纳指官方公告',
  sp_global_official_constituent_change: '标普官方公告',
  wikipedia_revision_history: 'Wikipedia 历史修订',
  wikipedia_current_page: 'Wikipedia 当前页面',
  slickcharts_current_page: 'Slickcharts 当前页面',
  static_seed: '静态样本',
  mixed_sources: '多来源汇总',
  mixed_fallbacks: '多层兜底',
  fallback_unavailable: '暂无在线兜底',
  'fallback unavailable': '暂无在线兜底',
  local_cold_backup: '本地冷备',
  legacy_local_cache: '本地历史缓存',
  live_refresh_pending: '在线补齐中',
  lab2: 'Lab2 冷备',
  fake_yahoo: '测试数据源',
  test_revision_history: '测试历史修订',
};

const BLOCKER_LABELS: Record<string, string> = {
  CORPORATE_ACTIONS_INCOMPLETE: '公司行为数据部分可用',
  CORPORATE_ACTIONS_PENDING: '公司行为数据待刷新',
  CORPORATE_ACTIONS_FAILED: '公司行为数据刷新失败',
  PRICE_SNAPSHOT_INCOMPLETE: '价格数据部分可用',
  PRICE_SNAPSHOT_FAILED: '价格数据刷新失败',
  UNIVERSE_HISTORY_INCOMPLETE: '股票池历史数据部分可用',
  UNIVERSE_HISTORY_FAILED: '股票池历史数据刷新失败',
  LIVE_REFRESH_PENDING: '后台更新中',
  SNAPSHOT_REFRESH_REQUIRED: '还没有生成快照',
  SNAPSHOT_API_NEEDS_RESTART: '本地后端需要重启',
};

const BLOCKER_MESSAGES: Record<string, string> = {
  CORPORATE_ACTIONS_INCOMPLETE: '公司行为数据已部分可用，仍有少量公司事件待继续补齐。',
  CORPORATE_ACTIONS_PENDING: '公司行为数据还在准备，刷新完成后会显示完整结果。',
  CORPORATE_ACTIONS_FAILED: '公司行为数据刷新失败，请稍后重试。',
  PRICE_SNAPSHOT_INCOMPLETE: '股票价格数据已部分可用，仍有少量股票待继续补齐。',
  PRICE_SNAPSHOT_FAILED: '股票价格数据刷新失败，请稍后重试。',
  UNIVERSE_HISTORY_INCOMPLETE: '股票池历史成分已部分可用，仍有部分历史锚点待继续补齐。',
  UNIVERSE_HISTORY_FAILED: '股票池历史数据刷新失败，请稍后重试。',
  LIVE_REFRESH_PENDING: '后台正在刷新快照，页面会在完成后自动更新。',
  SNAPSHOT_REFRESH_REQUIRED: '还没有生成快照，点右上角“刷新快照”后会显示结果。',
  SNAPSHOT_API_NEEDS_RESTART: '当前本地后端仍在返回旧版快照接口，重启后端后再刷新即可。',
};

const OVERVIEW_MESSAGE_TRANSLATIONS: Record<string, string> = {
  'Corporate action data is partially available, but the snapshot is not complete yet.':
    '公司行为数据已部分可用，仍有少量公司事件待继续补齐。',
  'Price snapshot is still incomplete. Please retry after the missing symbols are repaired.':
    '股票价格数据已部分可用，仍有少量股票待继续补齐。',
  'Universe history is partially available, but some historical anchors are still missing.':
    '股票池历史成分已部分可用，仍有部分历史锚点待继续补齐。',
  'Please refresh snapshots before using this view.': '请先刷新快照，再查看当前快照结果。',
};

type SnapshotItem = ApiDatasetSnapshot | ApiUniverseSnapshot;

function normalizeSnapshotOverview(raw: unknown): ApiSnapshotOverview {
  if (raw && typeof raw === 'object') {
    const payload = raw as Partial<ApiSnapshotOverview> & Record<string, unknown>;
    const latestJob =
      payload.latest_job && typeof payload.latest_job === 'object'
        ? (payload.latest_job as ApiSnapshotJob)
        : null;
    const looksLegacy = 'status' in payload || 'coverages' in payload;

    if (!looksLegacy && typeof payload.overall_status === 'string') {
      return {
        overall_status: String(payload.overall_status).toUpperCase(),
        last_refreshed_at:
          typeof payload.last_refreshed_at === 'string'
            ? payload.last_refreshed_at
            : latestJob?.completed_at ?? latestJob?.updated_at ?? null,
        dataset_snapshots: Array.isArray(payload.dataset_snapshots)
          ? (payload.dataset_snapshots as ApiDatasetSnapshot[])
          : [],
        universe_snapshots: Array.isArray(payload.universe_snapshots)
          ? (payload.universe_snapshots as ApiUniverseSnapshot[])
          : [],
        latest_job: latestJob,
        blocking_code: (payload.blocking_code as string | null | undefined) ?? null,
        blocking_target: payload.blocking_target ?? null,
        message: typeof payload.message === 'string' ? payload.message : null,
        allowed_actions: Array.isArray(payload.allowed_actions)
          ? (payload.allowed_actions as string[])
          : ['refresh_snapshots'],
      };
    }

    return {
      overall_status: 'PENDING',
      last_refreshed_at: latestJob?.completed_at ?? latestJob?.updated_at ?? null,
      dataset_snapshots: [],
      universe_snapshots: [],
      latest_job: latestJob,
      blocking_code: 'SNAPSHOT_API_NEEDS_RESTART',
      blocking_target: 'data_snapshots',
      message:
        '当前本地后端还在返回旧版快照接口。重启后端服务后，再点“刷新快照”即可看到完整快照。',
      allowed_actions: ['refresh_snapshots'],
    };
  }

  return {
    overall_status: 'PENDING',
    last_refreshed_at: null,
    dataset_snapshots: [],
    universe_snapshots: [],
    latest_job: null,
    blocking_code: 'SNAPSHOT_REFRESH_REQUIRED',
    blocking_target: 'data_snapshots',
    message: '还没有生成快照，点右上角“刷新快照”后会显示。',
    allowed_actions: ['refresh_snapshots'],
  };
}

function getStatusLabel(status?: string | null): string {
  switch ((status ?? '').toUpperCase()) {
    case 'READY':
    case 'COMPLETED':
      return '就绪';
    case 'RUNNING':
      return '后台更新中';
    case 'STALE':
      return '使用缓存';
    case 'INCOMPLETE':
      return '部分可用';
    case 'FAILED':
    case 'BLOCKED':
      return '有阻塞';
    case 'PENDING':
    case 'EMPTY':
      return '待刷新';
    default:
      return '待刷新';
  }
}

function getStatusChipClassName(status?: string | null, blocked = false): string {
  if (blocked || ['FAILED', 'BLOCKED'].includes((status ?? '').toUpperCase())) {
    return 'status-chip status-chip--danger';
  }
  if (['RUNNING', 'STALE', 'INCOMPLETE'].includes((status ?? '').toUpperCase())) {
    return 'status-chip status-chip--warning';
  }
  if (['READY', 'COMPLETED'].includes((status ?? '').toUpperCase())) {
    return 'status-chip status-chip--success';
  }
  return 'status-chip status-chip--soft';
}

function shouldRenderStatusChip(status?: string | null, blocked = false): boolean {
  const normalizedStatus = String(status ?? '').toUpperCase();
  if (normalizedStatus === 'INCOMPLETE' || normalizedStatus === 'STALE') {
    return false;
  }
  return blocked || Boolean(normalizedStatus);
}

function formatCount(value?: number | null): string {
  return typeof value === 'number' ? value.toLocaleString('zh-HK') : '刷新后显示';
}

function formatCompactDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().slice(0, 10).replace(/-/g, '');
  return /^\d{8}$/.test(normalized) ? normalized : null;
}

function formatRange(start?: string | null, end?: string | null): string {
  const compactStart = formatCompactDate(start);
  const compactEnd = formatCompactDate(end);
  if (compactStart && compactEnd) {
    return `${compactStart}至${compactEnd}`;
  }
  if (compactEnd) {
    return `截至${compactEnd}`;
  }
  return '刷新后显示';
}

function formatSourceLabel(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  return SOURCE_LABELS[value] ?? value.replace(/_/g, ' ');
}

function formatSource(source?: string | null, fallbackSource?: string | null): string {
  const primary = formatSourceLabel(source);
  const fallback = formatSourceLabel(fallbackSource);
  if (primary && fallback) {
    return `${primary} / ${fallback}`;
  }
  return primary ?? fallback ?? '刷新后显示';
}

function getSnapshotMetadata(item: SnapshotItem): Record<string, unknown> {
  return item.metadata && typeof item.metadata === 'object'
    ? (item.metadata as Record<string, unknown>)
    : {};
}

function getMetadataCount(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getDatasetRefreshLabel(item: ApiDatasetSnapshot): string {
  const metadata = getSnapshotMetadata(item);
  const covered = getMetadataCount(metadata, 'covered_symbol_count');
  const total = getMetadataCount(metadata, 'total_symbol_count');
  if (covered !== null && total !== null && total > 0) {
    return `${covered.toLocaleString('zh-HK')}/${total.toLocaleString('zh-HK')}`;
  }
  return item.freshness_label ?? '刷新后显示';
}

function getUniverseRefreshLabel(item: ApiUniverseSnapshot): string {
  const metadata = getSnapshotMetadata(item);
  const covered = getMetadataCount(metadata, 'historical_anchor_count');
  const total = getMetadataCount(metadata, 'anchor_count');
  if (covered !== null && total !== null && total > 0) {
    return `${covered.toLocaleString('zh-HK')}/${total.toLocaleString('zh-HK')}`;
  }
  const freshnessLabel = String(item.freshness_label ?? '').trim();
  const ratioMatch = freshnessLabel.match(/\((\d+\/\d+)\)/);
  if (ratioMatch) {
    return ratioMatch[1];
  }
  return freshnessLabel || '刷新后显示';
}

function getBlockerTitle(blocker?: ApiSnapshotBlocker | null): string {
  const code = String(blocker?.code ?? '').toUpperCase();
  return BLOCKER_LABELS[code] ?? '快照状态提醒';
}

function getBlockerMessage(blocker?: ApiSnapshotBlocker | null): string {
  const code = String(blocker?.code ?? '').toUpperCase();
  if (BLOCKER_MESSAGES[code]) {
    return BLOCKER_MESSAGES[code];
  }
  const raw = String(blocker?.message ?? '').trim();
  if (!raw) {
    return '当前快照状态仍需继续确认。';
  }
  if (raw.startsWith('Corporate action data is partially available')) {
    return '公司行为数据已部分可用，仍有少量公司事件待继续补齐。';
  }
  if (raw.startsWith('Price snapshot is still incomplete')) {
    return '股票价格数据已部分可用，仍有少量股票待继续补齐。';
  }
  if (raw.startsWith('Universe history is partially available')) {
    return '股票池历史成分已部分可用，仍有部分历史锚点待继续补齐。';
  }
  return raw;
}

function translateOverviewMessage(raw?: string | null): string | null {
  const text = String(raw ?? '').trim();
  if (!text) {
    return null;
  }
  if (OVERVIEW_MESSAGE_TRANSLATIONS[text]) {
    return OVERVIEW_MESSAGE_TRANSLATIONS[text];
  }
  if (text.startsWith('Corporate action data is partially available')) {
    return '公司行为数据已部分可用，仍有少量公司事件待继续补齐。';
  }
  if (text.startsWith('Price snapshot is still incomplete')) {
    return '股票价格数据已部分可用，仍有少量股票待继续补齐。';
  }
  if (text.startsWith('Universe history is partially available')) {
    return '股票池历史成分已部分可用，仍有部分历史锚点待继续补齐。';
  }
  return text;
}

function getRefreshStats(overview: ApiSnapshotOverview | null): Record<string, unknown> {
  const summary = overview?.latest_job?.summary;
  if (!summary || typeof summary !== 'object') {
    return {};
  }
  const refreshStats = (summary as Record<string, unknown>).refresh_stats;
  return refreshStats && typeof refreshStats === 'object' ? (refreshStats as Record<string, unknown>) : {};
}

function getDatasetRefreshStat(
  refreshStats: Record<string, unknown>,
  snapshotId: string,
): Record<string, unknown> | null {
  const datasets =
    refreshStats.datasets && typeof refreshStats.datasets === 'object'
      ? (refreshStats.datasets as Record<string, unknown>)
      : null;
  const item = datasets?.[snapshotId];
  return item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
}

function getUniverseRefreshStat(
  refreshStats: Record<string, unknown>,
  snapshotId: string,
): Record<string, unknown> | null {
  const universes =
    refreshStats.universes && typeof refreshStats.universes === 'object'
      ? (refreshStats.universes as Record<string, unknown>)
      : null;
  const item = universes?.[snapshotId];
  return item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
}

function getPositiveCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function getLastRefreshSummaryLabel(overview: ApiSnapshotOverview | null): string {
  const value =
    overview?.last_refreshed_at ??
    overview?.latest_job?.completed_at ??
    overview?.latest_job?.updated_at;
  const prefix = value ? `最近刷新 ${formatDateTime(value)}` : '最近刷新';
  if (!overview) {
    return `${prefix} · 摘要待显示`;
  }
  const refreshStats = getRefreshStats(overview);
  const corporateStat = getDatasetRefreshStat(refreshStats, 'ds-corporate-actions');
  const priceStat = getDatasetRefreshStat(refreshStats, 'ds-price');
  const sp500Stat = getUniverseRefreshStat(refreshStats, 'un-sp500');
  const ndx100Stat = getUniverseRefreshStat(refreshStats, 'un-ndx100');
  const parts = [
    (() => {
      const symbols = getPositiveCount(corporateStat?.updated_symbol_count);
      const rows = getPositiveCount(corporateStat?.updated_row_count);
      if (!symbols && !rows) return null;
      if (symbols && rows) return `公司行为数据${symbols.toLocaleString('zh-HK')}家${rows.toLocaleString('zh-HK')}行`;
      if (symbols) return `公司行为数据${symbols.toLocaleString('zh-HK')}家`;
      return `公司行为数据${rows?.toLocaleString('zh-HK')}行`;
    })(),
    (() => {
      const symbols = getPositiveCount(priceStat?.updated_symbol_count);
      const rows = getPositiveCount(priceStat?.updated_row_count);
      if (!symbols && !rows) return null;
      if (symbols && rows) return `股票价格数据${symbols.toLocaleString('zh-HK')}家${rows.toLocaleString('zh-HK')}行`;
      if (symbols) return `股票价格数据${symbols.toLocaleString('zh-HK')}家`;
      return `股票价格数据${rows?.toLocaleString('zh-HK')}行`;
    })(),
    (() => {
      const rows = getPositiveCount(sp500Stat?.updated_row_count);
      return rows ? `标普500股票池${rows.toLocaleString('zh-HK')}行` : null;
    })(),
    (() => {
      const rows = getPositiveCount(ndx100Stat?.updated_row_count);
      return rows ? `纳指100股票池${rows.toLocaleString('zh-HK')}行` : null;
    })(),
  ].filter(Boolean);
  if (parts.length) {
    return `${prefix} ·新增${parts.join('，')}。`;
  }
  return value ? `${prefix} ·本次未新增数据。` : `${prefix} · 摘要待显示`;
}

function getOverviewMessage(overview: ApiSnapshotOverview | null): string {
  if (!overview) {
    return '正在加载快照概览...';
  }

  const latestJobStatus = String(overview.latest_job?.status ?? '').toUpperCase();
  if (latestJobStatus === 'RUNNING') {
    const mode = String(overview.latest_job?.request?.mode ?? '').toLowerCase();
    return mode === 'repair'
      ? '正在修复快照，页面会自动更新。当前先显示已有数据。'
      : '正在刷新快照，页面会自动更新。当前先显示已有数据。';
  }

  const translatedOverviewMessage = translateOverviewMessage(overview.message);
  if (translatedOverviewMessage) {
    return translatedOverviewMessage;
  }

  const hasItems = overview.dataset_snapshots.length > 0 || overview.universe_snapshots.length > 0;
  if (!hasItems) {
    return '还没有生成快照，点右上角“刷新快照”后会显示数据集和股票池快照。';
  }

  const partial = [...overview.dataset_snapshots, ...overview.universe_snapshots].some((item) =>
    ['INCOMPLETE', 'STALE', 'FAILED', 'BLOCKED'].includes(String(item.status ?? '').toUpperCase()),
  );
  return partial
    ? '当前已有可用数据，但还不是完整正式快照。'
    : '数据集和股票池快照都已准备好，可以继续正式回测。';
}

function getSectionStatus(items: SnapshotItem[]): string {
  if (!items.length) {
    return 'PENDING';
  }
  const statuses = items.map((item) => String(item.status ?? '').toUpperCase());
  if (statuses.includes('FAILED')) return 'FAILED';
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.includes('RUNNING')) return 'RUNNING';
  if (statuses.includes('INCOMPLETE')) return 'INCOMPLETE';
  if (statuses.includes('STALE')) return 'STALE';
  return 'READY';
}

function findCardBlocker(items: SnapshotItem[]): ApiSnapshotBlocker | null {
  for (const item of items) {
    if (item.blocker) {
      return item.blocker;
    }
  }
  return null;
}

function SnapshotListCard({
  eyebrow,
  title,
  items,
  emptyCopy,
  renderRow,
}: {
  eyebrow: string;
  title: string;
  items: SnapshotItem[];
  emptyCopy: string;
  renderRow: (item: SnapshotItem) => JSX.Element;
}): JSX.Element {
  const status = getSectionStatus(items);
  const blocker = findCardBlocker(items);
  const blocked = Boolean(blocker && ['FAILED', 'BLOCKED'].includes(status));

  return (
    <section className="panel snapshots-section-card">
      <div className="panel-header snapshots-section-card__header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        {shouldRenderStatusChip(status, blocked) ? (
          <span className={getStatusChipClassName(status, blocked)}>{getStatusLabel(status)}</span>
        ) : null}
      </div>

      {items.length ? (
        <div className="snapshots-list-stack">{items.map(renderRow)}</div>
      ) : (
        <div className="panel-subtle snapshots-feedback-panel">
          <p>{emptyCopy}</p>
        </div>
      )}

      {blocker ? (
        <div className={`snapshots-banner ${blocked ? 'snapshots-banner--danger' : ''}`}>
          <strong>{getBlockerTitle(blocker)}</strong>
          <p>{getBlockerMessage(blocker)}</p>
        </div>
      ) : null}
    </section>
  );
}

function DatasetRow({ item }: { item: ApiDatasetSnapshot }): JSX.Element {
  return (
    <article className="snapshots-row-card">
      <div className="snapshots-row-card__top">
        <div className="snapshots-row-card__title">
          <strong>{item.name}</strong>
          <p>{DATASET_COPY[item.name] ?? '刷新后会显示这个数据集的覆盖范围与来源。'}</p>
        </div>
        {shouldRenderStatusChip(item.status, Boolean(item.blocker)) ? (
          <span className={getStatusChipClassName(item.status, Boolean(item.blocker))}>
            {getStatusLabel(item.status)}
          </span>
        ) : null}
      </div>

      <div className="snapshots-row-card__meta-grid">
        <div className="snapshots-row-card__meta">
          <span>更新时间</span>
          <strong>{item.as_of ? formatDateTime(item.as_of) : '尚未刷新'}</strong>
        </div>
        <div className="snapshots-row-card__meta">
          <span>刷新说明</span>
          <strong>{getDatasetRefreshLabel(item)}</strong>
        </div>
        <div className="snapshots-row-card__meta">
          <span>覆盖区间</span>
          <strong>{formatRange(item.start_date, item.end_date)}</strong>
        </div>
        <div className="snapshots-row-card__meta">
          <span>总行数</span>
          <strong>{formatCount(item.row_count)}</strong>
        </div>
      </div>

      <footer className="snapshots-row-card__footer">
        <span>来源链路 {formatSource(item.source, item.fallback_source)}</span>
      </footer>
    </article>
  );
}

function UniverseRow({ item }: { item: ApiUniverseSnapshot }): JSX.Element {
  return (
    <article className="snapshots-row-card">
      <div className="snapshots-row-card__top">
        <div className="snapshots-row-card__title">
          <strong>{item.name}</strong>
          <p>{UNIVERSE_COPY[item.name] ?? '刷新后会显示这个股票池的历史锚点覆盖情况。'}</p>
        </div>
        {shouldRenderStatusChip(item.status, Boolean(item.blocker)) ? (
          <span className={getStatusChipClassName(item.status, Boolean(item.blocker))}>
            {getStatusLabel(item.status)}
          </span>
        ) : null}
      </div>

      <div className="snapshots-row-card__meta-grid">
        <div className="snapshots-row-card__meta">
          <span>更新时间</span>
          <strong>{item.as_of ? formatDateTime(item.as_of) : '尚未刷新'}</strong>
        </div>
        <div className="snapshots-row-card__meta">
          <span>刷新说明</span>
          <strong>{getUniverseRefreshLabel(item)}</strong>
        </div>
        <div className="snapshots-row-card__meta">
          <span>观察窗口</span>
          <strong>{formatRange(item.window_start, item.window_end)}</strong>
        </div>
        <div className="snapshots-row-card__meta">
          <span>成员数量</span>
          <strong>{formatCount(item.member_count)}</strong>
        </div>
      </div>

      <footer className="snapshots-row-card__footer">
        <span>来源链路 {formatSource(item.source, item.fallback_source)}</span>
        <span>锚点 {item.anchor_schedule ?? '01-01,07-01'}</span>
      </footer>
    </article>
  );
}

export function SnapshotsPage(): JSX.Element {
  const api = useApiClient();
  const [overview, setOverview] = useState<ApiSnapshotOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        if (!cancelled) {
          setLoading(true);
          setError(null);
        }
        const response = await api.getSnapshotOverview();
        if (!cancelled) {
          setOverview(normalizeSnapshotOverview(response));
        }
      } catch (caught) {
        if (!cancelled) {
          setError(`加载数据快照失败：${(caught as Error).message}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!overview?.latest_job || String(overview.latest_job.status).toUpperCase() !== 'RUNNING') {
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.getSnapshotOverview();
        setOverview(normalizeSnapshotOverview(response));
      } catch {
        // Polling is best effort; keep current data on screen.
      }
    }, 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [api, overview]);

  async function handleRefresh(): Promise<void> {
    try {
      setRefreshing(true);
      setError(null);
      const response = await api.refreshSnapshots({
        mode: 'repair',
        targets: ['price', 'corporate', 'universes'],
        reason: 'manual-refresh-latest-and-repair',
      });
      setOverview(normalizeSnapshotOverview(response));
    } catch (caught) {
      setError(`刷新数据快照失败：${(caught as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }

  const datasetSnapshots = useMemo(() => overview?.dataset_snapshots ?? [], [overview]);
  const universeSnapshots = useMemo(() => overview?.universe_snapshots ?? [], [overview]);
  const pageStatus = getStatusLabel(overview?.overall_status);
  const pageBlocked = Boolean(
    overview?.blocking_code &&
      ['FAILED', 'BLOCKED'].includes(String(overview?.overall_status ?? '').toUpperCase()),
  );

  return (
    <div className="stack snapshots-page">
      <section className="page-heading snapshots-header-card">
        <div className="snapshots-header">
          <div className="snapshots-header__copy">
            <p className="page-heading__eyebrow">数据快照</p>
            <h1 className="snapshots-header__title">快照总览</h1>
            <p className="snapshots-header__body">{getOverviewMessage(overview)}</p>
            <div className="snapshots-header__meta">
              {shouldRenderStatusChip(overview?.overall_status, pageBlocked) ? (
                <span className={getStatusChipClassName(overview?.overall_status, pageBlocked)}>
                  {pageStatus}
                </span>
              ) : null}
              <span className="status-chip status-chip--soft snapshots-header__summary">
                {getLastRefreshSummaryLabel(overview)}
              </span>
            </div>
          </div>
          <div className="snapshots-header__actions">
            <button
              className="primary-button snapshots-header__primary"
              disabled={loading || refreshing}
              onClick={() => {
                void handleRefresh();
              }}
              type="button"
            >
              {refreshing ? '刷新中...' : '刷新快照'}
            </button>
          </div>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {loading ? (
        <section className="panel snapshots-feedback-panel">
          <p>正在加载快照概览...</p>
        </section>
      ) : null}

      {!loading ? (
        <div className="snapshots-two-column-grid snapshots-main-grid">
          <SnapshotListCard
            eyebrow="数据集快照"
            title="数据集快照"
            items={datasetSnapshots}
            emptyCopy="还没有生成数据集快照，点右上角“刷新快照”后显示。"
            renderRow={(item) => <DatasetRow item={item as ApiDatasetSnapshot} key={item.id} />}
          />
          <SnapshotListCard
            eyebrow="股票池快照"
            title="股票池快照"
            items={universeSnapshots}
            emptyCopy="还没有生成股票池快照，点右上角“刷新快照”后显示。"
            renderRow={(item) => <UniverseRow item={item as ApiUniverseSnapshot} key={item.id} />}
          />
        </div>
      ) : null}
    </div>
  );
}
