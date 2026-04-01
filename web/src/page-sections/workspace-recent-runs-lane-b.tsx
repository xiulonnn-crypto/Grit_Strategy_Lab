import { useMemo } from 'react';
import './workspace-recent-runs-lane-b.css';

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
  runKindLabel: string;
  dateRangeLabel: string;
  completedRelativeLabel: string;
};

type WorkspaceRecentRunsSectionProps = {
  recentRuns?: WorkspaceRecentRunItem[];
  navigate: (path: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

const TEXT = {
  title: '最近回测',
  copy: '展示最近 10 次已完成的回测任务，点击可追溯审计详情。',
  empty: '暂无最近回测。先 materialize 一个策略再填充历史。',
  error: '最近回测加载失败。',
  retry: '重试',
} as const;

function getStatusTone(status: WorkspaceRecentRunItem['status']): 'positive' | 'warning' | 'negative' {
  return status === 'FAILED' ? 'negative' : status === 'COMPLETED_WITH_WARNINGS' ? 'warning' : 'positive';
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
  const totalReturnTone = item.totalReturn.startsWith('-') ? 'negative' : 'positive';
  const kindTone = item.runKindLabel.includes('永久') ? 'permanent' : 'temporary';

  return (
    <li className={`workspace-recent-runs__item workspace-recent-runs__item--${tone}`}>
      <span className={`workspace-recent-runs__rail-dot workspace-recent-runs__rail-dot--${tone}`} aria-hidden="true" />
      <button className="workspace-recent-runs__card gsl-card" onClick={() => navigate(`/runs/${item.runId}`)} type="button">
        <div className="workspace-recent-runs__row-top">
          <div className="workspace-recent-runs__identity">
            <span className="workspace-recent-runs__run-id">{item.runId}</span>
          </div>
          <span className={`workspace-recent-runs__kind workspace-recent-runs__kind--${kindTone}`}>{item.runKindLabel}</span>
        </div>

        <h4 className="workspace-recent-runs__strategy" title={item.strategyName}>
          {item.strategyName}
        </h4>

        <p className="workspace-recent-runs__period">{item.dateRangeLabel || item.periodLabel || '区间待补充'}</p>

        <div className="workspace-recent-runs__badge-row">
          <span className={`workspace-recent-runs__badge workspace-recent-runs__badge--${totalReturnTone}`}>收益率 {item.totalReturn}</span>
          <span className="workspace-recent-runs__badge workspace-recent-runs__badge--neutral">夏普比率 {item.sharpe}</span>
        </div>

        <div className="workspace-recent-runs__footer">
          <span className={`workspace-recent-runs__status workspace-recent-runs__status--${tone}`}>{item.statusLabel}</span>
          <span className="workspace-recent-runs__completed">{item.completedRelativeLabel}</span>
        </div>
      </button>
    </li>
  );
}

export function WorkspaceRecentRunsSection({
  recentRuns,
  navigate,
  loading = false,
  error,
  onRetry,
}: WorkspaceRecentRunsSectionProps): JSX.Element {
  const normalizedRuns = useMemo(() => normalizeRecentRuns(recentRuns), [recentRuns]);

  return (
    <section className="workspace-recent-runs panel gsl-card">
      <div className="workspace-recent-runs__section-header">
        <div>
          <h3>{TEXT.title}</h3>
          <p className="hero-copy">{TEXT.copy}</p>
        </div>
        {onRetry ? (
          <button className="text-button gsl-text-link" onClick={onRetry} type="button">
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
