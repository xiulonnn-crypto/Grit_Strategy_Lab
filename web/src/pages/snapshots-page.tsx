import { useEffect, useState } from 'react';
import { formatDateTime, formatShortDate } from '../lib/format';
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
  标普500: '过去30年历史时点成分股，按 01-01 / 07-01 锚点快照更新。',
  纳指100: '过去30年历史时点成分股，按 01-01 / 07-01 锚点快照更新。',
};

function normalizeSnapshotOverview(raw: unknown): ApiSnapshotOverview {
  if (raw && typeof raw === 'object') {
    const payload = raw as Record<string, unknown>;
    if (
      typeof payload.overall_status === 'string' &&
      Array.isArray(payload.dataset_snapshots) &&
      Array.isArray(payload.universe_snapshots)
    ) {
      return payload as ApiSnapshotOverview;
    }

    const latestJob =
      payload.latest_job && typeof payload.latest_job === 'object'
        ? (payload.latest_job as ApiSnapshotJob)
        : null;
    const looksLegacy = 'status' in payload || 'coverages' in payload;

    return {
      overall_status: looksLegacy
        ? 'PENDING'
        : String(payload.overall_status ?? payload.status ?? latestJob?.status ?? 'PENDING').toUpperCase(),
      last_refreshed_at:
        typeof payload.last_refreshed_at === 'string'
          ? payload.last_refreshed_at
          : latestJob?.completed_at ?? latestJob?.updated_at ?? null,
      dataset_snapshots: [],
      universe_snapshots: [],
      latest_job: latestJob,
      blocking_code: looksLegacy ? 'SNAPSHOT_API_NEEDS_RESTART' : 'SNAPSHOT_REFRESH_REQUIRED',
      blocking_target: 'data_snapshots',
      message: looksLegacy
        ? '当前本地后端还在返回旧版快照接口。重启后端服务后，再点“刷新快照”即可看到完整快照。'
        : '还没有生成快照。点击右上角“刷新快照”后，这里会显示最新状态。',
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
    message: '还没有生成快照。点击右上角“刷新快照”后，这里会显示最新状态。',
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
      return '待补齐';
    case 'FAILED':
      return '刷新失败';
    case 'BLOCKED':
      return '有阻塞';
    case 'EMPTY':
    case 'PENDING':
      return '待刷新';
    default:
      return '未刷新';
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

function formatCount(value?: number | null): string {
  return typeof value === 'number' ? value.toLocaleString('zh-HK') : '刷新后显示';
}

function formatRange(start?: string | null, end?: string | null): string {
  if (start && end) {
    return `${formatShortDate(start)} 至 ${formatShortDate(end)}`;
  }

  if (end) {
    return `截至 ${formatShortDate(end)}`;
  }

  return '刷新后显示';
}

const SOURCE_LABELS: Record<string, string> = {
  yahoo: 'Yahoo Finance',
  Yahoo: 'Yahoo Finance',
  fake_yahoo: '测试行情',
  test_revision_history: '测试历史成分',
  wikipedia_revision_history: 'Wikipedia 历史修订',
  wikipedia_current_page: 'Wikipedia 当前页面',
  static_seed: '静态样本',
  mixed_sources: '多来源汇总',
  mixed_fallbacks: '多层兜底',
  fallback_unavailable: '暂无在线兜底',
  'fallback unavailable': '暂无在线兜底',
  local_cold_backup: '本地冷备',
  legacy_local_cache: '本地历史缓存',
  live_refresh_pending: '在线补齐中',
  lab2: 'Lab2 冷备',
};

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

const BLOCKER_LABELS: Record<string, string> = {
  CORPORATE_ACTIONS_INCOMPLETE: '公司行为数据仍在补齐',
  CORPORATE_ACTIONS_PENDING: '公司行为数据待补齐',
  PRICE_SNAPSHOT_INCOMPLETE: '价格数据仍在补齐',
  PRICE_SNAPSHOT_FAILED: '价格数据刷新失败',
  UNIVERSE_HISTORY_INCOMPLETE: '股票池历史成分仍在补齐',
  UNIVERSE_HISTORY_FAILED: '股票池历史成分刷新失败',
  LIVE_REFRESH_PENDING: '在线补齐仍在进行',
  SNAPSHOT_REFRESH_REQUIRED: '需要刷新快照',
  SNAPSHOT_API_NEEDS_RESTART: '本地后端需要重启',
};

function getBlockerTitle(blocker?: ApiSnapshotBlocker | null): string {
  const code = String(blocker?.code ?? '').toUpperCase();
  return BLOCKER_LABELS[code] ?? '当前数据仍需补齐';
}

function getLastRefreshedLabel(overview: ApiSnapshotOverview | null): string {
  const value =
    overview?.last_refreshed_at ??
    overview?.latest_job?.completed_at ??
    overview?.latest_job?.updated_at;
  return value ? formatDateTime(value) : '尚未刷新';
}

function getOverviewMessage(overview: ApiSnapshotOverview | null): string {
  if (overview?.message) {
    return overview.message;
  }
  if (!overview?.last_refreshed_at && !(overview?.dataset_snapshots.length || overview?.universe_snapshots.length)) {
    return '还没有生成快照。点击右上角“刷新快照”后，这里会显示价格数据、公司行为和股票池的状态。';
  }
  if (overview?.blocking_code) {
    return '快照还没补齐，暂时不能直接提交正式回测。';
  }
  return '这里会集中展示价格数据、公司行为和股票池的最新状态。';
}

function getSectionStatus(
  items: Array<ApiDatasetSnapshot | ApiUniverseSnapshot>,
): string {
  if (!items.length) {
    return 'PENDING';
  }
  const statuses = items.map((item) => String(item.status ?? '').toUpperCase());
  if (statuses.includes('FAILED')) {
    return 'FAILED';
  }
  if (statuses.includes('BLOCKED')) {
    return 'BLOCKED';
  }
  if (statuses.includes('INCOMPLETE')) {
    return 'INCOMPLETE';
  }
  if (statuses.includes('STALE')) {
    return 'STALE';
  }
  if (statuses.includes('RUNNING')) {
    return 'RUNNING';
  }
  return 'READY';
}

function findCardBlocker(
  items: Array<ApiDatasetSnapshot | ApiUniverseSnapshot>,
): ApiSnapshotBlocker | null {
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
  copy,
  items,
  emptyCopy,
  kind,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  items: Array<ApiDatasetSnapshot | ApiUniverseSnapshot>;
  emptyCopy: string;
  kind: 'dataset' | 'universe';
}): JSX.Element {
  const blocker = findCardBlocker(items);
  const sectionStatus = getSectionStatus(items);

  return (
    <section className="panel snapshots-section-card">
      <div className="panel-header snapshots-section-card__header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          <p className="snapshots-panel-copy">{copy}</p>
        </div>
        <span className={getStatusChipClassName(sectionStatus, sectionStatus === 'BLOCKED')}>
          {getStatusLabel(sectionStatus)}
        </span>
      </div>

      {items.length ? (
        <div className="snapshots-list-stack">
          {items.map((item) => (
            <SnapshotRow item={item} key={item.id} kind={kind} />
          ))}
        </div>
      ) : (
        <p className="empty-state">{emptyCopy}</p>
      )}

      {blocker ? (
        <section className="snapshots-banner snapshots-banner--danger" role="status">
          <strong>{getBlockerTitle(blocker)}</strong>
          <p>{blocker.message}</p>
        </section>
      ) : null}
    </section>
  );
}

function SnapshotRow({
  item,
  kind,
}: {
  item: ApiDatasetSnapshot | ApiUniverseSnapshot;
  kind: 'dataset' | 'universe';
}): JSX.Element {
  const blocked = Boolean(item.blocker);
  const description =
    kind === 'dataset'
      ? DATASET_COPY[item.name] ?? '快照信息会在刷新后显示。'
      : UNIVERSE_COPY[item.name] ?? '这里会显示股票池的历史快照范围。';

  return (
    <article className="snapshots-row-card">
      <div className="snapshots-row-card__top">
        <div className="snapshots-row-card__title">
          <strong>{item.name}</strong>
          <p>{description}</p>
        </div>
        <span className={getStatusChipClassName(item.status, blocked)}>
          {getStatusLabel(item.status)}
        </span>
      </div>

      <div className="snapshots-row-card__meta-grid">
        <div className="snapshots-row-card__meta">
          <span>更新时间</span>
          <strong>{item.as_of ? formatDateTime(item.as_of) : '尚未刷新'}</strong>
        </div>
        <div className="snapshots-row-card__meta">
          <span>刷新说明</span>
          <strong>{item.freshness_label ?? '刷新后显示'}</strong>
        </div>
        <div className="snapshots-row-card__meta">
          <span>{kind === 'dataset' ? '覆盖区间' : '观察窗口'}</span>
          <strong>
            {kind === 'dataset'
              ? formatRange(item.start_date, item.end_date)
              : formatRange(item.window_start, item.window_end)}
          </strong>
        </div>
        <div className="snapshots-row-card__meta">
          <span>{kind === 'dataset' ? '总行数' : '成员数量'}</span>
          <strong>
            {kind === 'dataset'
              ? formatCount(item.row_count)
              : formatCount(item.member_count)}
          </strong>
        </div>
      </div>

      <div className="snapshots-row-card__footer">
        <span>来源链路 {formatSource(item.source, item.fallback_source)}</span>
        {kind === 'universe' ? (
          <span>锚点 {item.anchor_schedule ?? '刷新后显示'}</span>
        ) : null}
      </div>
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

    async function loadOverview(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const payload = normalizeSnapshotOverview(await api.getSnapshotOverview());
        if (!cancelled) {
          setOverview(payload);
        }
      } catch (caught) {
        if (!cancelled) {
          setError((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadOverview();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    const latestJobStatus = String(overview?.latest_job?.status ?? '').toUpperCase();
    if (latestJobStatus !== 'RUNNING') {
      return undefined;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void api
        .getSnapshotOverview()
        .then((payload) => {
          if (!cancelled) {
            setOverview(normalizeSnapshotOverview(payload));
          }
        })
        .catch((caught) => {
          if (!cancelled) {
            setError((caught as Error).message);
          }
        });
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, overview?.latest_job?.status]);

  async function handleRefresh(): Promise<void> {
    try {
      setRefreshing(true);
      setError(null);
      const payload = normalizeSnapshotOverview(await api.refreshSnapshots());
      setOverview(payload);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  const lastRefreshedLabel = getLastRefreshedLabel(overview);
  const jobRunning = String(overview?.latest_job?.status ?? '').toUpperCase() === 'RUNNING';
  const canRefresh = (overview?.allowed_actions?.includes('refresh_snapshots') ?? true) && !jobRunning;

  return (
    <div className="stack snapshots-page">
      <section className="page-heading snapshots-header-card">
        <div className="snapshots-header">
          <div className="snapshots-header__copy">
            <p className="page-heading__eyebrow">数据快照</p>
            <h1 className="snapshots-header__title">快照总览</h1>
            <p className="snapshots-header__body">{getOverviewMessage(overview)}</p>
            <div className="snapshots-header__meta">
              <span className={getStatusChipClassName(overview?.overall_status)}>
                {getStatusLabel(overview?.overall_status)}
              </span>
              <span className="status-chip status-chip--soft">最近刷新 {lastRefreshedLabel}</span>
            </div>
          </div>

          <div className="snapshots-header__actions">
            <button
              className="primary-button snapshots-header__primary"
              disabled={loading || refreshing || !canRefresh}
              onClick={() => void handleRefresh()}
              type="button"
            >
              {refreshing || jobRunning ? '刷新中...' : '刷新快照'}
            </button>
          </div>
        </div>
      </section>

      {loading && !overview ? (
        <section className="panel snapshots-feedback-panel" role="status">
          <p>正在加载快照状态...</p>
        </section>
      ) : null}

      {error ? <div className="error-banner">加载数据快照失败：{error}</div> : null}

      {!loading && !error ? (
        <section className="snapshots-two-column-grid snapshots-main-grid">
          <SnapshotListCard
            copy="这里会告诉你公司行为和价格数据是不是已经准备好。"
            emptyCopy="还没有生成数据集快照，点右上角“刷新快照”后显示。"
            eyebrow="数据集快照"
            items={overview?.dataset_snapshots ?? []}
            kind="dataset"
            title="数据集快照"
          />
          <SnapshotListCard
            copy="这里会告诉你股票池是不是已经准备好。当前先显示历史锚点快照，完整历史成分仍在持续补齐。"
            emptyCopy="还没有生成股票池快照，点右上角“刷新快照”后显示。"
            eyebrow="股票池快照"
            items={overview?.universe_snapshots ?? []}
            kind="universe"
            title="股票池快照"
          />
        </section>
      ) : null}
    </div>
  );
}
