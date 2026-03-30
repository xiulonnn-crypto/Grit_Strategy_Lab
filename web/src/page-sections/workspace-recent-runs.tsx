import React, { useMemo, useState } from 'react';
import { ActionButton, SectionCard, cx } from '../components';
import { formatPercent, formatRatio } from '../lib/format';
import { formatDateRangeText, runStatusTone } from '../lib/i18n-dictionary';
import type { BacktestRunListItem } from '../types';
import './workspace-recent-runs.css';

export interface WorkspaceRecentRunItem {
  id: string;
  runId: string;
  strategyName: string;
  status: BacktestRunListItem['status'];
  totalReturn: number;
  sharpe: number;
  completedAt?: string;
  periodLabel?: string;
  statusLabel?: string;
}

export interface WorkspaceRecentRunsSectionProps {
  recentRuns?: WorkspaceRecentRunItem[];
  latestRun?: BacktestRunListItem;
  navigate: (path: string) => void;
  translateStatus: (status: string) => string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

const RECENT_RUNS_TITLE = '\u6700\u8fd1\u56de\u6d4b';
const RECENT_RUNS_SUBTITLE = '\u5c55\u793a\u6700\u8fd1 10 \u6b21\u5df2\u5b8c\u6210\u7684\u56de\u6d4b\u4efb\u52a1\uff0c\u70b9\u51fb\u53ef\u8ffd\u6eaf\u5ba1\u8ba1\u8be6\u60c5\u3002';
const EMPTY_COPY = '\u6682\u65e0\u8fd0\u884c\u8bb0\u5f55\uff0c\u8bf7\u524d\u5f80\u2018\u65b0\u5efa\u7b56\u7565\u2019\u542f\u52a8\u56de\u6d4b\u3002';
const TOOLTIP_COPY = '\u542b\u6267\u884c\u8b66\u544a';
const CTA_COPY = '\u67e5\u770b\u8be6\u60c5';
const BADGE_LABEL = '\u6536\u76ca\u7387\u548c\u590f\u666e\u6bd4\u7387';
const PERIOD_PLACEHOLDER = '\u5468\u671f\u4fe1\u606f\u5f85\u8865\u5145';
const COMPLETION_PLACEHOLDER = '\u5b8c\u6210\u65f6\u95f4\u5f85\u5b9a';
const ERROR_COPY = '\u6700\u8fd1\u56de\u6d4b\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002';
const RETRY_COPY = '\u91cd\u8bd5';

function toTimestamp(value?: string): number {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCompletionTime(value?: string): string {
  if (!value) {
    return COMPLETION_PLACEHOLDER;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return COMPLETION_PLACEHOLDER;
  }

  const diffMinutes = Math.floor((Date.now() - parsed.getTime()) / 60000);
  let relative = '\u521a\u521a';
  if (diffMinutes >= 60 * 24) {
    const diffDays = Math.floor(diffMinutes / (60 * 24));
    relative = `${diffDays} \u5929\u524d`;
  } else if (diffMinutes >= 60) {
    const diffHours = Math.floor(diffMinutes / 60);
    relative = `${diffHours} \u5c0f\u65f6\u524d`;
  } else if (diffMinutes >= 1) {
    relative = `${diffMinutes} \u5206\u949f\u524d`;
  }

  const absolute = new Intl.DateTimeFormat('zh-HK', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);

  return `${relative} (${absolute})`;
}

function normalizeRecentRuns(
  recentRuns: WorkspaceRecentRunItem[] | undefined,
  latestRun: BacktestRunListItem | undefined,
  translateStatus: (status: string) => string,
): WorkspaceRecentRunItem[] {
  if (recentRuns && recentRuns.length > 0) {
    return [...recentRuns]
      .sort((left, right) => toTimestamp(right.completedAt) - toTimestamp(left.completedAt))
      .slice(0, 10);
  }

  if (!latestRun) {
    return [];
  }

  return [
    {
      id: latestRun.id,
      runId: latestRun.id,
      strategyName: latestRun.strategyName,
      status: latestRun.status,
      totalReturn: latestRun.totalReturn,
      sharpe: latestRun.sharpe,
      completedAt: latestRun.completedAt,
      periodLabel: formatDateRangeText(latestRun.effectiveStartDate ?? latestRun.startedAt, latestRun.effectiveEndDate ?? latestRun.completedAt),
      statusLabel: translateStatus(latestRun.status),
    },
  ];
}

function RecentRunSkeleton(): React.ReactElement {
  return (
    <li className="workspace-recent-runs__item" aria-hidden="true">
      <div className="workspace-recent-runs__card workspace-recent-runs__card--skeleton">
        <span className="workspace-recent-runs__dot workspace-recent-runs__dot--skeleton" />
        <div className="workspace-recent-runs__body">
          <span className="workspace-recent-runs__line workspace-recent-runs__line--run-id" />
          <span className="workspace-recent-runs__line workspace-recent-runs__line--title" />
          <span className="workspace-recent-runs__line workspace-recent-runs__line--period" />
          <div className="workspace-recent-runs__badge-row">
            <span className="workspace-recent-runs__badge workspace-recent-runs__badge--skeleton" />
            <span className="workspace-recent-runs__badge workspace-recent-runs__badge--skeleton workspace-recent-runs__badge--short" />
          </div>
          <span className="workspace-recent-runs__line workspace-recent-runs__line--footer" />
        </div>
      </div>
    </li>
  );
}

function WorkspaceRecentRunRow({
  item,
  navigate,
  translateStatus,
  activeTooltipId,
  setActiveTooltipId,
}: {
  item: WorkspaceRecentRunItem;
  navigate: (path: string) => void;
  translateStatus: (status: string) => string;
  activeTooltipId: string | null;
  setActiveTooltipId: React.Dispatch<React.SetStateAction<string | null>>;
}): React.ReactElement {
  const isWarning = item.status === 'COMPLETED_WITH_WARNINGS';
  const isActive = activeTooltipId === item.id;
  const tooltipId = `${item.id}-warning-tooltip`;
  const statusLabel = item.statusLabel ?? translateStatus(item.status);
  const statusTone = runStatusTone(item.status);

  return (
    <li className="workspace-recent-runs__item">
      <button
        type="button"
        className="workspace-recent-runs__card"
        onClick={() => navigate('/runs/' + item.id)}
        onMouseEnter={() => {
          if (isWarning) {
            setActiveTooltipId(item.id);
          }
        }}
        onMouseLeave={() => setActiveTooltipId((current) => (current === item.id ? null : current))}
        onFocus={() => {
          if (isWarning) {
            setActiveTooltipId(item.id);
          }
        }}
        onBlur={() => setActiveTooltipId((current) => (current === item.id ? null : current))}
        aria-describedby={isWarning && isActive ? tooltipId : undefined}
      >
        <span
          className={cx(
            'workspace-recent-runs__dot',
            isWarning ? 'workspace-recent-runs__dot--warning' : 'workspace-recent-runs__dot--completed',
          )}
          aria-hidden="true"
        />
        <div className="workspace-recent-runs__body">
          <div className="workspace-recent-runs__topline">
            <span className="workspace-recent-runs__run-id">{item.runId}</span>
            <span className={cx('workspace-recent-runs__status', `workspace-recent-runs__status--${statusTone}`)}>
              <span className="workspace-recent-runs__status-label">{statusLabel}</span>
              {isWarning ? (
                <span
                  id={tooltipId}
                  role="tooltip"
                  className={cx('workspace-recent-runs__tooltip', isActive && 'workspace-recent-runs__tooltip--visible')}
                >
                  {TOOLTIP_COPY}
                </span>
              ) : null}
            </span>
          </div>

          <h3 className="workspace-recent-runs__strategy">{item.strategyName}</h3>

          <p className="workspace-recent-runs__period">{item.periodLabel ?? PERIOD_PLACEHOLDER}</p>

          <div className="workspace-recent-runs__badge-row" aria-label={BADGE_LABEL}>
            <span className={cx('workspace-recent-runs__badge', item.totalReturn >= 0 ? 'workspace-recent-runs__badge--positive' : 'workspace-recent-runs__badge--negative')}>
              收益率 {formatPercent(item.totalReturn)}
            </span>
            <span className="workspace-recent-runs__badge workspace-recent-runs__badge--neutral">
              夏普比率 {formatRatio(item.sharpe)}
            </span>
          </div>

          <div className="workspace-recent-runs__footer">
            <span className="workspace-recent-runs__completed">{formatCompletionTime(item.completedAt)}</span>
            <span className="workspace-recent-runs__cta">
              {CTA_COPY} <span aria-hidden="true">&#8594;</span>
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}

export function WorkspaceRecentRunsSection({
  recentRuns,
  latestRun,
  navigate,
  translateStatus,
  loading = false,
  error,
  onRetry,
}: WorkspaceRecentRunsSectionProps): React.ReactElement {
  const [activeTooltipId, setActiveTooltipId] = useState<string | null>(null);
  const normalizedRuns = useMemo(() => normalizeRecentRuns(recentRuns, latestRun, translateStatus), [recentRuns, latestRun, translateStatus]);

  return (
    <SectionCard title={RECENT_RUNS_TITLE} subtitle={RECENT_RUNS_SUBTITLE} className="workspace-recent-runs">
      {loading ? (
        <ol className="workspace-recent-runs__timeline workspace-recent-runs__timeline--loading" aria-label={RECENT_RUNS_TITLE}>
          {Array.from({ length: 4 }, (_, index) => (
            <RecentRunSkeleton key={index} />
          ))}
        </ol>
      ) : error ? (
        <div className="workspace-recent-runs__empty workspace-recent-runs__empty--error" role="alert">
          <p>{error || ERROR_COPY}</p>
          {onRetry ? <ActionButton kind="secondary" onClick={onRetry}>{RETRY_COPY}</ActionButton> : null}
        </div>
      ) : normalizedRuns.length > 0 ? (
        <ol className="workspace-recent-runs__timeline" aria-label={RECENT_RUNS_TITLE}>
          {normalizedRuns.map((item) => (
            <WorkspaceRecentRunRow
              key={item.id}
              item={item}
              navigate={navigate}
              translateStatus={translateStatus}
              activeTooltipId={activeTooltipId}
              setActiveTooltipId={setActiveTooltipId}
            />
          ))}
        </ol>
      ) : (
        <div className="workspace-recent-runs__empty" role="status">
          <p>{EMPTY_COPY}</p>
        </div>
      )}
    </SectionCard>
  );
}



