import { useEffect, useMemo, useState } from 'react';
import { buildRecentRunScore, buildWorkspaceStrategyCards } from '../lib/workspace-adapters';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { WorkspaceStrategySection } from '../page-sections/workspace';
import { WorkspaceRecentRunsSection, type WorkspaceRecentRunItem } from '../page-sections/workspace-recent-runs';
import type {
  ApiBacktestRunDetail,
  ApiBacktestRunListItem,
  ApiStrategyDetail,
  ApiStrategyListItem,
  ApiWorkspaceOverview,
} from '../types';
import './workspace-page.css';

const TEXT = {
  heroEyebrow: '工作台',
  heroTitle: '策略工作台',
  heroCopy: '创建、回测和优化的统一工作台。',
  openCreation: '创建策略',
  openLatestLab: '打开最近优化',
  loadingCopy: '加载工作台契约中...',
  noStrategyTitle: '创建第一个策略',
  noStrategyCopy: '当前数据库还没有可用策略，先进入创建流程把主链路打通。',
  noStrategyAction: '创建第一个策略',
  healthTitle: '工作台健康度',
  strategiesLabel: '策略数',
  activeRunsLabel: '活跃回测',
  optimizationsLabel: '运行中的优化',
  latestRunLabel: '最新回测',
  warningLabel: '最新提醒',
  quickActionsLabel: '快捷动作',
} as const;

function MetricCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
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
    const oosStart =
      detail?.oos_start_date ??
      (detail?.configuration && typeof detail.configuration === 'object'
        ? (detail.configuration as { oos_start_date?: string }).oos_start_date
        : undefined) ??
      run.preview?.oos_start_date ??
      run.preview?.effective_date;

    return {
      id: run.id,
      runId: run.id,
      strategyName,
      status: run.status,
      totalReturn: score.totalReturn,
      sharpe: score.sharpe,
      completedAt: run.completed_at ?? detail?.completed_at ?? run.updated_at ?? run.created_at,
      periodLabel: oosStart ? `OOS 起始 ${oosStart}` : '还没有完整区间',
      statusLabel: run.status === 'QUEUED' ? '排队中' : run.status === 'RUNNING' ? '运行中' : run.status === 'COMPLETED' ? '已完成' : run.status === 'COMPLETED_WITH_WARNINGS' ? '已完成有提醒' : '失败',
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
            return detail?.latest_successful_run_id ?? detail?.latest_run_id ?? strategy.latest_successful_run_id ?? strategy.latest_run_id;
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
  const recentRunItems = useMemo(() => {
    const strategyNamesById = Object.fromEntries(strategies.map((strategy) => [strategy.id, strategy.name] as const));
    return buildRecentRunItems(recentRuns, recentRunDetails, strategyNamesById);
  }, [recentRunDetails, recentRuns, strategies]);
  const isEmptyWorkspace = !loading && !error && cards.length === 0;

  return (
    <div className="stack workspace-page">
      <section className="hero-card">
        <div>
          <p className="eyebrow">{TEXT.heroEyebrow}</p>
          <h2>{overview?.workspace_name ?? TEXT.heroTitle}</h2>
          <p className="hero-copy">{overview?.subtitle ?? TEXT.loadingCopy}</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => navigateTo('/strategies')} type="button">
            {TEXT.openCreation}
          </button>
          {overview?.latest_optimization_job_id ? (
            <button
              className="ghost-button"
              onClick={() => navigateTo(`/optimization-jobs/${overview.latest_optimization_job_id}`)}
              type="button"
            >
              {TEXT.openLatestLab}
            </button>
          ) : null}
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace-health panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{TEXT.healthTitle}</p>
            <h3>{overview?.workspace_name ?? TEXT.heroTitle}</h3>
          </div>
          {overview?.top_momentum_warning ? <p className="workspace-warning-banner">{overview.top_momentum_warning}</p> : null}
        </div>
        <div className="stats-grid">
          <MetricCard label={TEXT.strategiesLabel} value={String(overview?.strategy_count ?? 0)} />
          <MetricCard label={TEXT.activeRunsLabel} value={String(overview?.active_run_count ?? 0)} />
          <MetricCard label={TEXT.optimizationsLabel} value={String(overview?.running_optimization_count ?? 0)} />
          <MetricCard label={TEXT.latestRunLabel} value={overview?.latest_backtest_run_id ?? '暂无'} />
        </div>
        {overview?.quick_actions?.length ? (
          <div className="workspace-health__quick-actions">
            <span className="workspace-health__quick-actions-label">{TEXT.quickActionsLabel}</span>
            <div className="workspace-health__chips">
              {overview.quick_actions.map((action) => (
                <span className="workspace-health__chip" key={action}>
                  {action}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className="workspace-page__content">
        {isEmptyWorkspace ? (
          <section className="workspace-empty-state panel">
            <p className="eyebrow">{TEXT.warningLabel}</p>
            <h3 className="blank-state-title">{TEXT.noStrategyTitle}</h3>
            <p className="blank-state-copy">{TEXT.noStrategyCopy}</p>
            <button className="primary-button" onClick={() => navigateTo('/strategies')} type="button">
              {TEXT.noStrategyAction}
            </button>
          </section>
        ) : (
          <WorkspaceStrategySection error={error} loading={loading} navigate={navigateTo} strategies={cards} />
        )}
        <WorkspaceRecentRunsSection error={error} loading={loading} navigate={navigateTo} recentRuns={recentRunItems} />
      </div>
    </div>
  );
}


