import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import type { ApiBacktestRunListItem } from '../types';
import './runs-index-page.css';

const TEXT = {
  title: '回测列表',
  copy: '按最新完成时间排序。',
  empty: '暂无回测任务。先 materialize 一个策略再回到这里。',
  loading: '加载回测历史中...',
  retry: '重试',
} as const;

function isAbortError(caught: unknown): boolean {
  return caught instanceof DOMException
    ? caught.name === 'AbortError'
    : typeof caught === 'object' && caught !== null && 'name' in caught && (caught as { name?: string }).name === 'AbortError';
}

function formatMetric(value: number | undefined, kind: 'percent' | 'ratio'): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '待补充';
  }
  if (kind === 'percent') {
    const percent = value * 100;
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
  }
  return value.toFixed(2);
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

function buildRows(runs: ApiBacktestRunListItem[]) {
  return runs
    .map((run) => {
      const metrics = run.metrics ?? {};
      const completedAt = run.completed_at ?? run.updated_at ?? run.created_at;
      return {
        id: run.id,
        strategyId: run.strategy_id,
        strategyName: run.strategy_name ?? run.strategy_id,
        runTypeText: run.is_permanent ? '永久回测' : '临时回测',
        runTypeTone: run.is_permanent ? 'permanent' : 'temporary',
        status: run.status,
        statusText: statusLabel(run.status),
        statusTone: getTone(run.status),
        totalReturn: formatMetric(metrics.total_return, 'percent'),
        sharpe: formatMetric(metrics.sharpe, 'ratio'),
        maxDrawdown: formatMetric(metrics.max_drawdown, 'percent'),
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const items = await api.listBacktestRuns({ limit: 20 }, controller.signal);
        if (cancelled) {
          return;
        }
        setRuns(items);
        setLoading(false);
      } catch (caught) {
        if (isAbortError(caught)) {
          return;
        }
        if (!cancelled) {
          setError((caught as Error).message);
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [api]);

  const rows = useMemo(() => buildRows(runs), [runs]);

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
                <th>类型</th>
                <th>状态</th>
                <th>收益</th>
                <th>夏普</th>
                <th>回撤</th>
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
                  <td className="runs-index-table__type-cell">
                    <span className={`runs-index-badge runs-index-badge--${row.runTypeTone}`}>{row.runTypeText}</span>
                  </td>
                  <td className="runs-index-table__status-cell">
                    <span className={`runs-index-badge runs-index-badge--${row.statusTone}`}>{row.statusText}</span>
                  </td>
                  <td>{row.totalReturn}</td>
                  <td>{row.sharpe}</td>
                  <td>{row.maxDrawdown}</td>
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
