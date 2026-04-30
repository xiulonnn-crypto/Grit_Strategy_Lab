import { useMemo } from 'react';
import './workspace-recent-runs-lane-b.css';

type WorkspaceRecentRunBadgeTone = 'positive' | 'warning' | 'negative' | 'neutral';

export type WorkspaceRecentRunItem = {
  id: string;
  kind: 'backtest' | 'optimization';
  activityId: string;
  strategyName: string;
  strategyVersionTag?: string | null;
  status: string;
  completedAt?: string | null;
  statusLabel: string;
  kindLabel: string;
  metaLabel: string;
  badges: Array<{
    text: string;
    tone: WorkspaceRecentRunBadgeTone;
  }>;
  completedRelativeLabel: string;
  navigatePath: string;
};

type WorkspaceRecentRunsSectionProps = {
  recentRuns?: WorkspaceRecentRunItem[];
  navigate: (path: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

const TEXT = {
  title: '最近回测优化',
  copy: '汇总近 8 条回测与优化记录，按最新进展排序。',
  empty: '暂无最近回测或优化任务。',
  error: '最近回测优化加载失败。',
  retry: '重试',
} as const;

function getStatusTone(status: string): WorkspaceRecentRunBadgeTone {
  const normalized = status.toUpperCase();
  if (['FAILED'].includes(normalized)) {
    return 'negative';
  }
  if (['INTERRUPTED', 'COMPLETED_WITH_WARNINGS', 'PARTIALLY_FAILED'].includes(normalized)) {
    return 'warning';
  }
  if (['QUEUED', 'RUNNING'].includes(normalized)) {
    return 'neutral';
  }
  return 'positive';
}

function getKindTone(kindLabel: string): 'permanent' | 'temporary' | 'optimization' {
  if (kindLabel.includes('优化')) {
    return 'optimization';
  }
  return kindLabel.includes('永久') ? 'permanent' : 'temporary';
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
  const kindTone = getKindTone(item.kindLabel);

  return (
    <li className={`workspace-recent-runs__item workspace-recent-runs__item--${tone}`}>
      <span className={`workspace-recent-runs__rail-dot workspace-recent-runs__rail-dot--${tone}`} aria-hidden="true" />
      <button className="workspace-recent-runs__card gsl-card" onClick={() => navigate(item.navigatePath)} type="button">
        <div className="workspace-recent-runs__row-top">
          <div className="workspace-recent-runs__identity">
            <span className="workspace-recent-runs__run-id">{item.activityId}</span>
          </div>
          <span className={`workspace-recent-runs__kind workspace-recent-runs__kind--${kindTone}`}>{item.kindLabel}</span>
        </div>

        <div className="workspace-recent-runs__strategy-row">
          <h4
            className="workspace-recent-runs__strategy"
            title={item.strategyVersionTag ? `${item.strategyName} ${item.strategyVersionTag}` : item.strategyName}
          >
            {item.strategyName}
          </h4>
          {item.strategyVersionTag ? <span className="workspace-recent-runs__version">{item.strategyVersionTag}</span> : null}
        </div>

        <p className="workspace-recent-runs__period">{item.metaLabel}</p>

        <div className="workspace-recent-runs__badge-row">
          <div className="workspace-recent-runs__badges">
            {item.badges.map((badge) => (
              <span className={`workspace-recent-runs__badge workspace-recent-runs__badge--${badge.tone}`} key={`${item.id}-${badge.text}`}>
                {badge.text}
              </span>
            ))}
          </div>
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
        <ol className="workspace-recent-runs__timeline" aria-label={TEXT.title}>
          {Array.from({ length: 4 }, (_, index) => (
            <RecentRunSkeleton key={index} />
          ))}
        </ol>
      ) : error ? (
        <div className="workspace-recent-runs__empty workspace-recent-runs__empty--error" role="alert">
          <p>{error || TEXT.error}</p>
        </div>
      ) : normalizedRuns.length > 0 ? (
        <ol className="workspace-recent-runs__timeline" aria-label={TEXT.title}>
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
