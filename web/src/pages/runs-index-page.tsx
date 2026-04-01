import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import type { ApiBacktestRunDetail, ApiBacktestRunListItem, ApiStrategyListItem } from '../types';
import './runs-index-page.css';

const TEXT = {
  title: '回测列表',
  copy: '按最新完成时间排序。',
  empty: '暂无回测任务。先 materialize 一个策略再回到这里。',
  loading: '加载回测历史中...',
  retry: '重试',
} as const;

function formatMetric(value: number | undefined, kind: 'percent' | 'ratio'): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '待补充';
  }
  return kind === 'percent' ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` : value.toFixed(2);
}

function formatDate(value?: string | null): string {
  if (!value) {
    return '未完成';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
}

function statusLabel(status: ApiBacktestRunListItem['status']): string {
  switch (status) {
    case 'QUEUED':
      return '排队中';
    case 'RUNNING':
      return '运行中';
    case 'COMPLETED':
      return '已完成';
    case 'COMPLETED_WITH_WARNINGS':
      return '有提醒';
    case 'FAILED':
      return '失败';
    default:
      return status;
  }
}

function getTone(status: ApiBacktestRunListItem['status']): string {
  return status === 'FAILED' ? 'danger' : status === 'COMPLETED_WITH_WARNINGS' ? 'warning' : 'success';
}

function buildStrategyNameMap(strategies: ApiStrategyListItem[]): Record<string, string> {
  return Object.fromEntries(
    strategies
      .filter((strategy) => Boolean(strategy.id && strategy.name))
      .map((strategy) => [strategy.id, strategy.name] as const),
  );
}

function buildRows(
  runs: ApiBacktestRunListItem[],
  details: Record<string, ApiBacktestRunDetail>,
  strategyNamesById: Record<string, string>,
) {
  return runs
    .map((run) => {
      const detail = details[run.id];
      const metrics = detail?.metrics ?? run.metrics ?? {};
      const completedAt = run.completed_at ?? detail?.completed_at ?? run.updated_at ?? run.created_at;
      return {
        id: run.id,
        strategyId: run.strategy_id,
        strategyName: strategyNamesById[run.strategy_id] ?? run.strategy_name ?? detail?.strategy_name ?? run.strategy_id,
        status: run.status,
        statusText: statusLabel(run.status),
        statusTone: getTone(run.status),
        totalReturn: formatMetric(metrics.total_return, 'percent'),
        sharpe: formatMetric(metrics.sharpe, 'ratio'),
        maxDrawdown: formatMetric(metrics.max_drawdown, 'percent'),
        warnings: detail?.warnings?.length ?? run.warnings?.length ?? 0,
        completedAt,
      };
    })
    .sort((left, right) => {
      const leftTime = left.completedAt ? new Date(left.completedAt).getTime() : 0;
      const rightTime = right.completedAt ? new Date(right.completedAt).getTime() : 0;
      return rightTime - leftTime;
    });
}

export function RunsIndexPage(): JSX.Element {
  const api = useApiClient();
  const [runs, setRuns] = useState<ApiBacktestRunListItem[]>([]);
  const [runDetails, setRunDetails] = useState<Record<string, ApiBacktestRunDetail>>({});
  const [strategyNamesById, setStrategyNamesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const [items, strategies] = await Promise.all([api.listBacktestRuns({ limit: 20 }), api.listStrategies()]);
        const detailEntries = await Promise.all(items.map(async (run) => [run.id, await api.getBacktestRunDetail(run.id)] as const));
        if (cancelled) {
          return;
        }
        setRuns(items);
        setRunDetails(Object.fromEntries(detailEntries));
        setStrategyNamesById(buildStrategyNameMap(strategies));
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

  const rows = useMemo(() => buildRows(runs, runDetails, strategyNamesById), [runDetails, runs, strategyNamesById]);

  return (
    <div className="runs-index-page panel">
      <section className="runs-index-page__hero">
        <div>
          <h2>{TEXT.title}</h2>
          <p className="hero-copy">{TEXT.copy}</p>
        </div>
      </section>

      {loading ? <p className="empty-state">{TEXT.loading}</p> : null}
      {error ? <div className="error-banner" role="alert">{error}</div> : null}

      {!loading && !error && !rows.length ? <p className="empty-state">{TEXT.empty}</p> : null}

      {!loading && rows.length ? (
        <div className="runs-index-table-wrap">
          <table className="runs-index-table">
            <thead>
              <tr>
                <th>回测号</th>
                <th>策略</th>
                <th>状态</th>
                <th>收益</th>
                <th>夏普</th>
                <th>回撤</th>
                <th>提醒</th>
                <th>完成时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className={`runs-index-table__row runs-index-table__row--${row.statusTone}`} key={row.id}>
                  <td>
                    <button className="runs-index-link runs-index-link--run" onClick={() => navigateTo(`/runs/${row.id}`)} type="button">
                      {row.id}
                    </button>
                  </td>
                  <td>
                    <button className="runs-index-link runs-index-link--strategy" onClick={() => navigateTo(`/strategies/${row.strategyId}`)} type="button">
                      {row.strategyName}
                    </button>
                  </td>
                  <td className="runs-index-table__status-cell">
                    <span className={`runs-index-badge runs-index-badge--${row.statusTone}`}>{row.statusText}</span>
                  </td>
                  <td>{row.totalReturn}</td>
                  <td>{row.sharpe}</td>
                  <td>{row.maxDrawdown}</td>
                  <td>{row.warnings}</td>
                  <td>{formatDate(row.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
