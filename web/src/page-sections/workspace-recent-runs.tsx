import { useMemo } from 'react';

export type WorkspaceRecentRunItem = {
  id: string;
  runId: string;
  strategyName: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED';
  totalReturn: string;
  sharpe: string;
  completedAt?: string | null;
  periodLabel?: string | null;
  statusLabel: string;
};

type WorkspaceRecentRunsSectionProps = {
  recentRuns?: WorkspaceRecentRunItem[];
  navigate: (path: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

const TEXT = {
  eyebrow: '最近回测',
  title: '最新回测',
  copy: '展示最近 10 次已完成的回测任务，点击可追溯详情。',
  empty: '暂无最近回测。先 materialize 一个策略再填充历史。',
  error: '最近回测加载失败。',
  retry: '重试',
  detail: '查看详情',
} as const;

function formatTime(value?: string | null): string {
  if (!value) {
    return '完成时间待定';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '完成时间待定';
  }
  return new Intl.DateTimeFormat('zh-HK', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    month: 'short',
    day: '2-digit',
  }).format(parsed);
}

function getStatusTone(status: WorkspaceRecentRunItem['status']): string {
  return status === 'FAILED' ? 'danger' : status === 'COMPLETED_WITH_WARNINGS' ? 'warning' : 'success';
}

function normalizeRecentRuns(recentRuns: WorkspaceRecentRunItem[] | undefined): WorkspaceRecentRunItem[] {
  return [...(recentRuns ?? [])].sort((left, right) => {
    const leftTime = left.completedAt ? new Date(left.completedAt).getTime() : 0;
    const rightTime = right.completedAt ? new Date(right.completedAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

function RecentRunSkeleton(): JSX.Element {
  return (
    <li className="workspace-recent-runs__item workspace-recent-runs__item--skeleton" aria-hidden="true">
      <div className="workspace-recent-runs__card workspace-recent-runs__card--skeleton" />
    </li>
  );
}

function WorkspaceRecentRunRow({ item, navigate }: { item: WorkspaceRecentRunItem; navigate: (path: string) => void }): JSX.Element {
  const tone = getStatusTone(item.status);
  return (
    <li className="workspace-recent-runs__item">
      <button className="workspace-recent-runs__card" onClick={() => navigate(`/runs/${item.runId}`)} type="button">
        <div className="workspace-recent-runs__header">
          <span className="workspace-recent-runs__run-id">{item.runId}</span>
          <span className={`workspace-recent-runs__status workspace-recent-runs__status--${tone}`}>{item.statusLabel}</span>
        </div>
        <h4 className="workspace-recent-runs__strategy">{item.strategyName}</h4>
        <p className="workspace-recent-runs__period">{item.periodLabel ?? '区间信息待补充'}</p>
        <div className="workspace-recent-runs__badge-row">
          <span className={`workspace-recent-runs__badge workspace-recent-runs__badge--${Number(item.totalReturn) >= 0 ? 'positive' : 'negative'}`}>
            收益 {item.totalReturn}
          </span>
          <span className="workspace-recent-runs__badge workspace-recent-runs__badge--neutral">夏普 {item.sharpe}</span>
        </div>
        <div className="workspace-recent-runs__footer">
          <span className="workspace-recent-runs__completed">{formatTime(item.completedAt)}</span>
          <span className="workspace-recent-runs__cta">{TEXT.detail}</span>
        </div>
      </button>
    </li>
  );
}

export function WorkspaceRecentRunsSection({ recentRuns, navigate, loading = false, error, onRetry }: WorkspaceRecentRunsSectionProps): JSX.Element {
  const normalizedRuns = useMemo(() => normalizeRecentRuns(recentRuns), [recentRuns]);

  return (
    <section className="workspace-recent-runs panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{TEXT.eyebrow}</p>
          <h3>{TEXT.title}</h3>
          <p className="hero-copy">{TEXT.copy}</p>
        </div>
        {onRetry ? (
          <button className="text-button" onClick={onRetry} type="button">
            {TEXT.retry}
          </button>
        ) : null}
      </div>

      {loading ? (
        <ol className="workspace-recent-runs__timeline" aria-label="最近回测">
          {Array.from({ length: 4 }, (_, index) => (
            <RecentRunSkeleton key={index} />
          ))}
        </ol>
      ) : error ? (
        <div className="workspace-recent-runs__empty workspace-recent-runs__empty--error" role="alert">
          <p>{error || TEXT.error}</p>
        </div>
      ) : normalizedRuns.length > 0 ? (
        <ol className="workspace-recent-runs__timeline" aria-label="最近回测">
          {normalizedRuns.map((item) => (
            <WorkspaceRecentRunRow key={item.id} item={item} navigate={navigate} />
          ))}
        </ol>
      ) : (
        <div className="workspace-recent-runs__empty" role="status">
          <p>{TEXT.empty}</p>
        </div>
      )}
    </section>
  );
}

