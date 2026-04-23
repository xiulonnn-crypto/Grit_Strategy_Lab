import { useMemo, useState } from 'react';
import { formatDateTime } from '../lib/format';
import type { ApiDatasetSnapshot, ApiSnapshotOverview, ApiUniverseSnapshot } from '../types';

type EquitySnapshotsTabProps = {
  overview: ApiSnapshotOverview | null;
  onRefresh: () => void;
  refreshDisabled: boolean;
  refreshLabel: string;
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
      : item.freshness_label || '来自 runtime snapshot repository';

  return {
    id: item.id,
    title: item.name || item.id,
    summary: `${item.id} · ${coverage}`,
    fields: `窗口 ${item.start_date ?? '未知'} 至 ${item.end_date ?? '未知'}`,
    schedule: `来源 ${item.source || item.fallback_source || '未声明'}`,
    status: item.status,
    statusLabel: getStatusLabel(item.status),
    note,
    filter: 'dataset',
  };
}

function describeUniverse(item: ApiUniverseSnapshot): EquityRuntimeRow {
  const metadata = getMetadata(item);
  const historical = getNumber(metadata, 'historical_anchor_count');
  const anchors = getNumber(metadata, 'anchor_count');
  const missingAnchors = getStringList(metadata, 'official_seed_missing_anchors');
  const coverage =
    historical !== null && anchors !== null && anchors > 0
      ? `${formatCount(historical)} / ${formatCount(anchors)} 锚点`
      : `${formatCount(item.member_count)} 成分`;
  const note = item.blocker?.message
    ? translateSnapshotNote(item.blocker.message) ?? item.blocker.message
    : missingAnchors.length
      ? `仍有 ${formatCount(missingAnchors.length)} 个历史锚点待补`
      : item.freshness_label || '来自 runtime universe snapshot repository';

  return {
    id: item.id,
    title: item.name || item.id,
    summary: `${item.id} · ${coverage}`,
    fields: `窗口 ${item.window_start ?? '未知'} 至 ${item.window_end ?? '未知'}`,
    schedule: `来源 ${item.source || item.fallback_source || '未声明'}`,
    status: item.status,
    statusLabel: getStatusLabel(item.status),
    note,
    filter: 'universe',
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
  const readyDatasetCount = datasetSnapshots.filter((item) => isReadyStatus(item.status)).length;
  const readyUniverseCount = universeSnapshots.filter((item) => isReadyStatus(item.status)).length;
  const pendingCount = rows.filter((row) => isPendingStatus(row.status)).length;
  const basketRows = rows.filter(isEquityBasketRow);
  const readyBasketCount = basketRows.filter((row) => isReadyStatus(row.status)).length;
  const totalDatasetRows = datasetSnapshots.reduce((total, item) => total + (item.row_count ?? 0), 0);
  const totalUniverseMembers = universeSnapshots.reduce((total, item) => total + (item.member_count ?? 0), 0);
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
      <section className="panel snapshots-equity-overview">
        <div className="panel-header">
          <div>
            <h2>全局视角</h2>
            <p className="panel-note">
              用批准稿的治理结构展示当前 runtime 快照状态；底层没有返回的数据保持 0 或待补，不使用静态样例兜底。
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
            <strong>{formatReadyPercent(readyDatasetCount, datasetSnapshots.length)}</strong>
            <small>{readyDatasetCount}/{datasetSnapshots.length} 个数据集就绪，覆盖价格与公司行为。</small>
          </div>
          <div className="metric-card metric-card--accent">
            <span>指数基准</span>
            <strong>{formatReadyPercent(readyUniverseCount, universeSnapshots.length)}</strong>
            <small>{readyUniverseCount}/{universeSnapshots.length} 个股票池就绪，覆盖成分与历史锚点。</small>
          </div>
          <div className={basketRows.length && readyBasketCount === basketRows.length ? 'metric-card metric-card--accent' : 'metric-card metric-card--warning'}>
            <span>权益篮子</span>
            <strong>{formatAvailablePercent(readyBasketCount, basketRows.length)}</strong>
            <small>
              {basketRows.length
                ? `${readyBasketCount}/${basketRows.length} 个篮子可用。`
                : '当前 overview 未返回权益篮子快照，按 0 处理。'}
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
              数据行 {formatCount(totalDatasetRows)} · 成分 {formatCount(totalUniverseMembers)}
            </small>
          </div>
        </div>
      </section>

      <div className="detail-grid">
        <div className="detail-main">
      <section className="panel snapshots-equity-workstation">
        <div className="panel-header">
          <div>
            <h2>三位一体工作站</h2>
            <p className="panel-note">
              把股票池、指数基准和权益篮子的关键门禁放在同一屏，先看哪些来源可用，再决定是否继续建仓。
            </p>
          </div>
        </div>
        <div className="bond-core-grid">
          <article className="bond-core-card">
            <div className="source-head">
              <div>
                <strong>股票 Universe</strong>
                <p>股票清单、行业映射与公司行为审计，是整个研究入口的基础库存。</p>
              </div>
              <span className={pendingCount ? 'status-chip status-chip--warning' : 'status-chip status-chip--success'}>
                {pendingCount ? '待审计' : '就绪'}
              </span>
            </div>
            <div className="progress-shell">
              <div className="progress-meta">
                <span>{readyUniverseCount}/{universeSnapshots.length} 就绪</span>
                <span>{formatCount(totalUniverseMembers)} 成分</span>
              </div>
              <div className="progress-bar">
                <span style={{ width: formatPercent(readyUniverseCount, universeSnapshots.length) }} />
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
              <span className="status-chip status-chip--success">
                {readyUniverseCount} Ready
              </span>
            </div>
            <div className="progress-shell">
              <div className="progress-meta">
                <span>{readyUniverseCount} 就绪</span>
                <span>{universeSnapshots.length} 总数</span>
              </div>
              <div className="progress-bar">
                <span style={{ width: formatPercent(readyUniverseCount, universeSnapshots.length) }} />
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
              <span className={pendingCount ? 'status-chip status-chip--warning' : 'status-chip status-chip--success'}>
                {pendingCount} Pending
              </span>
            </div>
            <div className="progress-shell">
              <div className="progress-meta">
                <span>{rows.length - pendingCount} 就绪</span>
                <span>{rows.length} 总数</span>
              </div>
              <div className="progress-bar">
                <span style={{ width: formatPercent(rows.length - pendingCount, rows.length) }} />
              </div>
            </div>
            <ul>
              <li>角色：资产腿与正式组合的通用权益来源。</li>
              <li>状态：待补项目会直接跳到原始快照清单，修复后再引用。</li>
            </ul>
          </article>
        </div>
      </section>
        </div>
        <aside className="detail-rail">
      <section className="rail-panel">
        <div className="panel-header">
          <div>
            <h2>数据诊断报告</h2>
            <p className="panel-note">
              诊断区汇总当前 runtime 快照状态：{pendingCount} 项待补，最近刷新{' '}
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
              <span>所有 runtime 快照均已通过当前就绪门禁。</span>
            </article>
          ) : null}
        </div>
      </section>
        </aside>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
      <section className="panel" id="equity-runtime-snapshot-list">
        <div className="panel-header">
          <div>
            <h2>原始快照清单</h2>
            <p className="panel-note">
              每一行都直接映射 runtime payload：状态、行数、来源、窗口和 blocker 都来自真实接口。
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
              <article className="bond-snapshot-row snapshots-row-card" key={`${row.filter}-${row.id}`}>
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
            当前筛选下没有 runtime 快照记录。请先触发刷新，或检查 market-data repository 是否有入库数据。
          </div>
        )}
      </section>

        </div>
        <aside className="detail-rail">
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
