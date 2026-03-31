import { useMemo } from 'react';
import { formatPercent, formatRatio } from '../lib/format';
import type { ApiBacktestRunListItem } from '../types';

export type WorkspaceRecentRunItem = {
  id: string;
  runId: string;
  strategyName: string;
  status: ApiBacktestRunListItem['status'];
  totalReturn: number;
  sharpe: number;
  completedAt?: string;
  periodLabel?: string;
  statusLabel?: string;
};

export type WorkspaceRecentRunsSectionProps = {
  recentRuns?: WorkspaceRecentRunItem[];
  navigate: (path: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

const EMPTY_COPY = 'No recent backtests yet. Materialize a strategy to populate the run history.';
const ERROR_COPY = 'Recent backtests could not be loaded.';
const RETRY_COPY = 'Retry';

function formatTime(value?: string): string {
  if (!value) {
    return 'Completion time pending';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Completion time pending';
  }

  return new Intl.DateTimeFormat('en', {
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

function WorkspaceRecentRunRow({
  item,
  navigate,
}: {
  item: WorkspaceRecentRunItem;
  navigate: (path: string) => void;
}): JSX.Element {
  const tone = getStatusTone(item.status);

  return (
    <li className="workspace-recent-runs__item">
      <button className="workspace-recent-runs__card" onClick={() => navigate(`/runs/${item.runId}`)} type="button">
        <div className="workspace-recent-runs__header">
          <span className="workspace-recent-runs__run-id">{item.runId}</span>
          <span className={`workspace-recent-runs__status workspace-recent-runs__status--${tone}`}>{item.status}</span>
        </div>
        <h4 className="workspace-recent-runs__strategy">{item.strategyName}</h4>
        <p className="workspace-recent-runs__period">{item.periodLabel ?? 'Period unavailable'}</p>
        <div className="workspace-recent-runs__badge-row">
          <span className={`workspace-recent-runs__badge workspace-recent-runs__badge--${item.totalReturn >= 0 ? 'positive' : 'negative'}`}>
            Return {formatPercent(item.totalReturn)}
          </span>
          <span className="workspace-recent-runs__badge workspace-recent-runs__badge--neutral">
            Sharpe {formatRatio(item.sharpe)}
          </span>
        </div>
        <div className="workspace-recent-runs__footer">
          <span className="workspace-recent-runs__completed">{formatTime(item.completedAt)}</span>
          <span className="workspace-recent-runs__cta">Open detail</span>
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
    <section className="workspace-recent-runs panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Recent Backtests</p>
          <h3>Latest runs</h3>
        </div>
        {onRetry ? (
          <button className="text-button" onClick={onRetry} type="button">
            {RETRY_COPY}
          </button>
        ) : null}
      </div>

      {loading ? (
        <ol className="workspace-recent-runs__timeline" aria-label="Recent backtests">
          {Array.from({ length: 4 }, (_, index) => (
            <RecentRunSkeleton key={index} />
          ))}
        </ol>
      ) : error ? (
        <div className="workspace-recent-runs__empty workspace-recent-runs__empty--error" role="alert">
          <p>{error || ERROR_COPY}</p>
        </div>
      ) : normalizedRuns.length > 0 ? (
        <ol className="workspace-recent-runs__timeline" aria-label="Recent backtests">
          {normalizedRuns.map((item) => (
            <WorkspaceRecentRunRow key={item.id} item={item} navigate={navigate} />
          ))}
        </ol>
      ) : (
        <div className="workspace-recent-runs__empty" role="status">
          <p>{EMPTY_COPY}</p>
        </div>
      )}
    </section>
  );
}
