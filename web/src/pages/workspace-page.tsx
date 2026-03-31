import { useEffect, useMemo, useState } from 'react';
import { buildWorkspaceStrategyCards } from '../lib/adapters';
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
    const strategyName = strategyNamesById[run.strategy_id] ?? run.strategy_id;
    const totalReturn = detail?.metrics.total_return;
    const sharpe = detail?.metrics.sharpe;
    const oosStart =
      detail?.configuration && typeof detail.configuration === 'object'
        ? (detail.configuration as { oos_start_date?: string }).oos_start_date
        : undefined;

    return {
      id: run.id,
      runId: run.id,
      strategyName,
      status: run.status,
      totalReturn: typeof totalReturn === 'number' ? totalReturn : 0,
      sharpe: typeof sharpe === 'number' ? sharpe : 0,
      completedAt: run.created_at,
      periodLabel: oosStart ? `OOS starts ${oosStart}` : run.created_at ?? 'Completion pending',
      statusLabel: run.status,
    };
  });
}

export function WorkspacePage(): JSX.Element {
  const api = useApiClient();
  const [overview, setOverview] = useState<ApiWorkspaceOverview | null>(null);
  const [strategies, setStrategies] = useState<ApiStrategyListItem[]>([]);
  const [details, setDetails] = useState<Record<string, ApiStrategyDetail>>({});
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
          api.listBacktestRuns({ limit: 6 }),
        ]);
        const detailEntries = await Promise.all(
          strategyItems.map(async (strategy) => [strategy.id, await api.getStrategyDetail(strategy.id)] as const),
        );
        const recentRunDetailEntries = await Promise.all(
          backtestRuns.map(async (run) => [run.id, await api.getBacktestRunDetail(run.id)] as const),
        );
        if (cancelled) {
          return;
        }
        setOverview(workspaceOverview);
        setStrategies(strategyItems);
        setDetails(Object.fromEntries(detailEntries));
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

  const cards = useMemo(() => buildWorkspaceStrategyCards(strategies, details), [details, strategies]);
  const recentRunItems = useMemo(() => {
    const strategyNamesById = Object.fromEntries(strategies.map((strategy) => [strategy.id, strategy.name] as const));
    return buildRecentRunItems(recentRuns, recentRunDetails, strategyNamesById);
  }, [recentRunDetails, recentRuns, strategies]);
  const isEmptyWorkspace = !loading && !error && cards.length === 0;

  return (
    <div className="stack workspace-page">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>{overview?.workspace_name ?? 'Grit Strategy Lab'}</h2>
          <p className="hero-copy">{overview?.subtitle ?? 'Loading workspace contract...'}</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => navigateTo('/creation/new')} type="button">
            Open Creation
          </button>
          {overview?.latest_optimization_job_id ? (
            <button
              className="ghost-button"
              onClick={() => navigateTo(`/optimization-jobs/${overview.latest_optimization_job_id}`)}
              type="button"
            >
              Open Latest Manual Lab
            </button>
          ) : null}
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="stats-grid">
        <MetricCard label="Strategies" value={String(overview?.strategy_count ?? 0)} />
        <MetricCard label="Active Runs" value={String(overview?.active_run_count ?? 0)} />
        <MetricCard label="Optimizations" value={String(overview?.running_optimization_count ?? 0)} />
      </section>

      <div className="workspace-page__content">
        {isEmptyWorkspace ? (
          <section className="blank-state-card workspace-empty-state">
            <h3 className="blank-state-title">Create the first strategy</h3>
            <p className="blank-state-copy">
              The workspace is connected to the real backend, but the current database has no materialized
              strategies yet. Start a creation session to restore the main product chain.
            </p>
            <button className="primary-button" onClick={() => navigateTo('/creation/new')} type="button">
              Create First Strategy
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
