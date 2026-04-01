import { useEffect, useMemo, useState } from 'react';
import { buildRecentRunScore, buildWorkspaceStrategyCards } from '../lib/workspace-adapters';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { WorkspaceRecentRunsSection, type WorkspaceRecentRunItem } from '../page-sections/workspace-recent-runs-lane-b';
import { WorkspaceStrategySection } from '../page-sections/workspace-lane-b';
import type {
  ApiBacktestRunDetail,
  ApiBacktestRunListItem,
  ApiStrategyDetail,
  ApiStrategyListItem,
  ApiWorkspaceOverview,
} from '../types';
import './workspace-page-lane-b.css';

const TEXT = {
  healthTitle: '工作台健康度',
  healthCopy: '当前研究工作台的核心状态与风险提示。',
  createStrategy: '创建策略',
  openSnapshots: '数据快照',
  noStrategyTitle: '创建第一个策略',
  noStrategyCopy: '当前数据库还没有可用策略，先进入创建流程把主链路打通。',
  noStrategyAction: '创建第一个策略',
  strategiesLabel: '策略数',
  activeRunsLabel: '活跃回测',
  optimizationsLabel: '运行中的优化',
  latestRunLabel: '最新回测',
  latestRunFallback: '暂无',
} as const;

function MetricCard({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}): JSX.Element {
  return (
    <article className={`metric-card${emphasized ? ' metric-card--accent' : ''}`}>
      <span>{label}</span>
      <strong className="metric-value">{value}</strong>
    </article>
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDisplayDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}.${isoMatch[2]}.${isoMatch[3]}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return `${parsed.getFullYear()}.${pad(parsed.getMonth() + 1)}.${pad(parsed.getDate())}`;
}

function formatDateRange(start?: string | null, end?: string | null): string {
  const formattedStart = formatDisplayDate(start);
  const formattedEnd = formatDisplayDate(end);

  if (formattedStart && formattedEnd) {
    return `${formattedStart} - ${formattedEnd}`;
  }
  if (formattedStart) {
    return `${formattedStart} - 区间待补充`;
  }
  if (formattedEnd) {
    return `区间待补充 - ${formattedEnd}`;
  }

  return '区间待补充';
}

function formatRelativeTime(value?: string | null): string {
  if (!value) {
    return '完成时间待定';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '完成时间待定';
  }

  const diffMs = Date.now() - parsed.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60_000));
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  return `${Math.round(diffHours / 24)} 天前`;
}

function getConfigDate(configuration: ApiBacktestRunDetail['configuration'], key: string): string | undefined {
  if (!configuration || typeof configuration !== 'object') {
    return undefined;
  }

  const value = (configuration as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function buildRecentRunItems(
  runs: ApiBacktestRunListItem[],
  detailsById: Record<string, ApiBacktestRunDetail>,
  strategyNamesById: Record<string, string>,
): WorkspaceRecentRunItem[] {
  return runs.map((run) => {
    const detail = detailsById[run.id];
    const strategyName = strategyNamesById[run.strategy_id] ?? run.strategy_name ?? run.strategy_id;
    const score = buildRecentRunScore(detail);
    const preview = detail?.preview ?? run.preview;
    const rangeStart =
      preview?.effective_start_date ??
      getConfigDate(detail?.configuration, 'effective_start_date') ??
      preview?.oos_start_date ??
      detail?.oos_start_date ??
      run.preview?.oos_start_date ??
      run.created_at;
    const rangeEnd =
      preview?.effective_end_date ??
      getConfigDate(detail?.configuration, 'effective_end_date') ??
      detail?.effective_date ??
      run.preview?.effective_date ??
      run.completed_at ??
      detail?.completed_at ??
      run.updated_at ??
      run.created_at;
    const completedAt = run.completed_at ?? detail?.completed_at ?? run.updated_at ?? run.created_at;

    return {
      id: run.id,
      runId: run.id,
      strategyName,
      status: run.status,
      totalReturn: score.totalReturn,
      sharpe: score.sharpe,
      completedAt,
      periodLabel: rangeStart ? `OOS 起始 ${formatDisplayDate(rangeStart) ?? '待补充'}` : '还没有完整区间',
      statusLabel:
        run.status === 'QUEUED'
          ? '排队中'
          : run.status === 'RUNNING'
            ? '运行中'
            : run.status === 'COMPLETED'
              ? '已完成'
              : run.status === 'COMPLETED_WITH_WARNINGS'
                ? '已完成有提醒'
                : '失败',
      runKindLabel: (detail?.is_permanent ?? run.is_permanent) ? '永久回测' : '临时回测',
      dateRangeLabel: formatDateRange(rangeStart, rangeEnd),
      completedRelativeLabel: formatRelativeTime(completedAt),
    };
  });
}

export function WorkspacePage(): JSX.Element {
  const api = useApiClient();
  const [overview, setOverview] = useState<ApiWorkspaceOverview | null>(null);
  const [strategies, setStrategies] = useState<ApiStrategyListItem[]>([]);
  const [strategyDetails, setStrategyDetails] = useState<Record<string, ApiStrategyDetail>>({});
  const [strategyLatestRuns, setStrategyLatestRuns] = useState<Record<string, ApiBacktestRunDetail>>({});
  const [recentRuns, setRecentRuns] = useState<ApiBacktestRunListItem[]>([]);
  const [recentRunDetails, setRecentRunDetails] = useState<Record<string, ApiBacktestRunDetail>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const [workspaceOverview, strategyItems, backtestRuns] = await Promise.all([
          api.getWorkspaceOverview(),
          api.listStrategies(),
          api.listBacktestRuns({ limit: 8 }),
        ]);
        const detailEntries = await Promise.all(
          strategyItems.map(async (strategy) => [strategy.id, await api.getStrategyDetail(strategy.id)] as const),
        );
        const latestRunIds = strategyItems
          .map((strategy) => {
            const detail = detailEntries.find(([id]) => id === strategy.id)?.[1];
            return (
              detail?.latest_successful_run_id ??
              detail?.latest_run_id ??
              strategy.latest_successful_run_id ??
              strategy.latest_run_id
            );
          })
          .filter((runId): runId is string => Boolean(runId));
        const latestRunDetailEntries = await Promise.all(
          [...new Set(latestRunIds)].map(async (runId) => [runId, await api.getBacktestRunDetail(runId)] as const),
        );
        const recentRunDetailEntries = await Promise.all(
          backtestRuns.map(async (run) => [run.id, await api.getBacktestRunDetail(run.id)] as const),
        );

        if (cancelled) {
          return;
        }

        setOverview(workspaceOverview);
        setStrategies(strategyItems);
        setStrategyDetails(Object.fromEntries(detailEntries));
        setStrategyLatestRuns(Object.fromEntries(latestRunDetailEntries));
        setRecentRuns(backtestRuns);
        setRecentRunDetails(Object.fromEntries(recentRunDetailEntries));
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

    void load();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const cards = useMemo(
    () => buildWorkspaceStrategyCards(strategies, strategyDetails, strategyLatestRuns),
    [strategies, strategyDetails, strategyLatestRuns],
  );
  const latestStrategyId = overview?.latest_strategy_id ?? cards[0]?.id ?? null;
  const recentRunItems = useMemo(() => {
    const strategyNamesById = Object.fromEntries(strategies.map((strategy) => [strategy.id, strategy.name] as const));
    return buildRecentRunItems(recentRuns, recentRunDetails, strategyNamesById);
  }, [recentRunDetails, recentRuns, strategies]);
  const isEmptyWorkspace = !loading && !error && cards.length === 0;

  return (
    <div className="stack workspace-page">
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace-health panel gsl-card">
        <div className="workspace-health__top">
          <div className="workspace-health__intro">
            <h2>{TEXT.healthTitle}</h2>
            <p className="hero-copy">{TEXT.healthCopy}</p>
          </div>

          <div className="workspace-health__actions">
            <button className="primary-button gsl-btn-primary" onClick={() => navigateTo('/creation/new')} type="button">
              {TEXT.createStrategy}
            </button>
            <button className="ghost-button" onClick={() => navigateTo('/snapshots')} type="button">
              {TEXT.openSnapshots}
            </button>
          </div>
        </div>

        <div className="workspace-health__metrics">
          <MetricCard label={TEXT.strategiesLabel} value={String(overview?.strategy_count ?? 0)} />
          <MetricCard label={TEXT.activeRunsLabel} value={String(overview?.active_run_count ?? 0)} />
          <MetricCard label={TEXT.optimizationsLabel} value={String(overview?.running_optimization_count ?? 0)} />
          <MetricCard
            emphasized
            label={TEXT.latestRunLabel}
            value={overview?.latest_backtest_run_id ?? TEXT.latestRunFallback}
          />
        </div>
      </section>

      <div className="workspace-page__content">
        <div className="workspace-page__main">
          {isEmptyWorkspace ? (
            <section className="workspace-empty-state panel gsl-card">
              <h3 className="blank-state-title">{TEXT.noStrategyTitle}</h3>
              <p className="blank-state-copy">{TEXT.noStrategyCopy}</p>
              <button className="primary-button gsl-btn-primary" onClick={() => navigateTo('/creation/new')} type="button">
                {TEXT.noStrategyAction}
              </button>
            </section>
          ) : (
            <WorkspaceStrategySection
              error={error}
              latestStrategyId={latestStrategyId}
              loading={loading}
              navigate={navigateTo}
              strategies={cards}
            />
          )}
        </div>

        <div className="workspace-page__side">
          <WorkspaceRecentRunsSection error={error} loading={loading} navigate={navigateTo} recentRuns={recentRunItems} />
        </div>
      </div>
    </div>
  );
}