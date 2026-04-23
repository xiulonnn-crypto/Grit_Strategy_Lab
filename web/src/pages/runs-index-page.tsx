import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatStrategyVersionTag, getStrategyDisplayName } from '../lib/strategy-version';
import type { ApiBacktestRunListItem } from '../types';
import './runs-index-page.css';

const TEXT = {
  title: '回测列表',
  copy: '按最新完成时间排序。',
  empty: '暂无回测任务。先 materialize 一个策略再回到这里。',
  loading: '加载回测历史中...',
  retry: '重试',
  actions: '操作',
  delete: '删除',
  deleting: '删除中...',
  deleteDisabledHint: '运行中的回测暂不支持删除',
  deleteDialogEyebrow: '逻辑删除',
  deleteDialogTitle: '删除回测',
  deleteDialogBody: '确认后该回测会从回测列表和详情页隐藏，但不会物理清理底层记录。',
  deleteDialogCancel: '取消',
  deleteDialogConfirm: '确认',
  deleteErrorPrefix: '删除回测失败：',
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

function canDeleteRun(status: ApiBacktestRunListItem['status']): boolean {
  return status !== 'QUEUED' && status !== 'RUNNING';
}

function buildRows(runs: ApiBacktestRunListItem[]) {
  return runs
    .map((run) => {
      const metrics = run.metrics ?? {};
      const completedAt = run.completed_at ?? run.updated_at ?? run.created_at;
      return {
        id: run.id,
        strategyId: run.strategy_id,
        strategyName: getStrategyDisplayName(run.strategy_name ?? run.strategy_id, run.strategy_id),
        strategyVersionTag: formatStrategyVersionTag(run.parameter_version_id ?? run.preview?.parameter_version_id),
        runTypeText: run.is_permanent ? '永久回测' : '临时回测',
        runTypeTone: run.is_permanent ? 'permanent' : 'temporary',
        status: run.status,
        statusText: statusLabel(run.status),
        statusTone: getTone(run.status),
        totalReturn: formatMetric(metrics.total_return, 'percent'),
        sharpe: formatMetric(metrics.sharpe, 'ratio'),
        maxDrawdown: formatMetric(metrics.max_drawdown, 'percent'),
        completedAt,
        canDelete: canDeleteRun(run.status),
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
  const pendingDeleteRow = useMemo(
    () => rows.find((row) => row.id === pendingDeleteId) ?? null,
    [pendingDeleteId, rows],
  );

  function openDeleteDialog(runId: string): void {
    setDeleteError(null);
    setPendingDeleteId(runId);
  }

  function closeDeleteDialog(): void {
    if (deleteBusy) {
      return;
    }
    setPendingDeleteId(null);
    setDeleteError(null);
  }

  async function handleDeleteRun(): Promise<void> {
    if (!pendingDeleteRow) {
      return;
    }
    const runId = pendingDeleteRow.id;
    try {
      setDeleteBusy(true);
      setDeleteError(null);
      await api.deleteBacktestRun(runId);
      setRuns((current) => current.filter((run) => run.id !== runId));
      setPendingDeleteId(null);
    } catch (caught) {
      setDeleteError((caught as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

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
                <th>{TEXT.actions}</th>
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
                    <div className="runs-index-table__strategy-cell">
                      <div className="runs-index-table__strategy-inline">
                        <button className="runs-index-link runs-index-link--strategy" onClick={() => navigateTo(`/strategies/${row.strategyId}`)} type="button">
                          {row.strategyName}
                        </button>
                        {row.strategyVersionTag ? (
                          <span className="runs-index-badge runs-index-badge--version">{row.strategyVersionTag}</span>
                        ) : null}
                      </div>
                    </div>
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
                  <td className="runs-index-table__actions-cell">
                    <button
                      className="text-button runs-index-table__action-button"
                      disabled={!row.canDelete}
                      onClick={() => openDeleteDialog(row.id)}
                      title={row.canDelete ? undefined : TEXT.deleteDisabledHint}
                      type="button"
                    >
                      {TEXT.delete}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pendingDeleteRow ? (
        <div
          aria-label={TEXT.deleteDialogTitle}
          aria-modal="true"
          className="modal-shell"
          onClick={closeDeleteDialog}
          role="dialog"
        >
          <div className="modal-card runs-index-delete-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.deleteDialogEyebrow}</p>
                <h3>{TEXT.deleteDialogTitle}</h3>
                <p className="runs-index-delete-modal__copy">{TEXT.deleteDialogBody}</p>
              </div>
            </div>

            <dl className="runs-index-delete-modal__summary">
              <div>
                <dt>回测号</dt>
                <dd>{pendingDeleteRow.id}</dd>
              </div>
              <div>
                <dt>策略</dt>
                <dd className="runs-index-delete-modal__strategy-summary">
                  <span>{pendingDeleteRow.strategyName}</span>
                  {pendingDeleteRow.strategyVersionTag ? (
                    <span className="runs-index-badge runs-index-badge--version">{pendingDeleteRow.strategyVersionTag}</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>当前状态</dt>
                <dd>{pendingDeleteRow.statusText}</dd>
              </div>
            </dl>

            {deleteError ? <div className="error-banner" role="alert">{`${TEXT.deleteErrorPrefix}${deleteError}`}</div> : null}

            <div className="modal-card__footer">
              <button className="ghost-button" disabled={deleteBusy} onClick={closeDeleteDialog} type="button">
                {TEXT.deleteDialogCancel}
              </button>
              <button
                className="primary-button runs-index-delete-modal__confirm"
                disabled={deleteBusy}
                onClick={() => void handleDeleteRun()}
                type="button"
              >
                {deleteBusy ? TEXT.deleting : TEXT.deleteDialogConfirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
