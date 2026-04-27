import { useState } from 'react';
import { formatDateTime, formatRatio } from '../../lib/format';
import {
  formatComposePercent,
  formatCompositionActivityLabel,
  formatCompositionName,
  formatCompositionStatusLabel,
  formatRebalanceCadence,
  normalizePercentLike,
} from '../../lib/compose-display';
import { navigateTo } from '../../lib/appRouteContext';
import type { ApiCompositionListItem, ApiCompositionStatus } from '../../types';
import './composition-dashboard.css';

type CompositionDashboardViewProps = {
  compositions: ApiCompositionListItem[];
  loading?: boolean;
  error?: string | null;
  savingCompositionId?: string | null;
  writeError?: string | null;
  onStatusChange?: (compositionId: string, status: ApiCompositionStatus) => Promise<void> | void;
};

type DashboardTask = {
  id: string;
  title: string;
  description: string;
  tone: 'accent' | 'warning' | 'danger' | 'success';
  label: string;
  actionLabel: string;
  actionPath: string;
};

type DashboardObservationCard = {
  detail: string;
  label: string;
  tone?: 'positive' | 'negative';
  value: string;
};

function getStatusTone(status: string): 'accent' | 'warning' | 'danger' | 'success' {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'ACTIVE') {
    return 'success';
  }
  if (normalized === 'DRAFT') {
    return 'warning';
  }
  if (normalized === 'ARCHIVED') {
    return 'danger';
  }
  return 'accent';
}

function getStatusLabel(status: string): string {
  return formatCompositionStatusLabel(status);
}

function getStatusWriteAction(status: string): { label: string; nextStatus: ApiCompositionStatus } {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'ACTIVE') {
    return { label: '归档', nextStatus: 'ARCHIVED' };
  }
  if (normalized === 'ARCHIVED') {
    return { label: '恢复草稿', nextStatus: 'DRAFT' };
  }
  return { label: '激活', nextStatus: 'ACTIVE' };
}

function getRebalanceLabel(value?: string | null): string {
  return formatRebalanceCadence(value);
}

function getDominantCadenceLabel(compositions: ApiCompositionListItem[]): string {
  const counts = new Map<string, number>();
  compositions.forEach((composition) => {
    const label = getRebalanceLabel(composition.rebalance_frequency);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? '维护节奏待确认';
}

function buildTaskList(compositions: ApiCompositionListItem[]): DashboardTask[] {
  const sorted = [...compositions].sort((left, right) => {
    if (left.status !== right.status) {
      if (left.status === 'DRAFT') return -1;
      if (right.status === 'DRAFT') return 1;
    }
    return (right.updated_at || '').localeCompare(left.updated_at || '');
  });

  const tasks: DashboardTask[] = sorted.map((composition): DashboardTask => {
    const normalizedStatus = String(composition.status || '').toUpperCase();
    if (normalizedStatus === 'DRAFT') {
      return {
        id: `${composition.id}-draft`,
        title: '来源检查',
        description: `当前仍为草稿，建议先补齐来源确认与权重复核，再进入正式持有。`,
        tone: 'warning',
        label: '高优先',
        actionLabel: '进入工作台',
        actionPath: `/compositions/workbench?composition_id=${encodeURIComponent(composition.id)}`,
      };
    }
    if (-Math.abs(normalizePercentLike(composition.max_drawdown)) <= -0.12) {
      return {
        id: `${composition.id}-drawdown`,
        title: '组合管理',
        description: `当前最大回撤达到 ${formatComposePercent(composition.max_drawdown, {
          forceNegative: true,
        })}，建议回看来源配置与维护成本。`,
        tone: 'danger',
        label: '处理中',
        actionLabel: '查看详情',
        actionPath: `/compositions/${encodeURIComponent(composition.id)}`,
      };
    }
    if (composition.composition_score < 70) {
      return {
        id: `${composition.id}-score`,
        title: '成立性复核',
        description: `当前评分 ${formatRatio(
          composition.composition_score,
        )}，建议复核分散度与来源可信度。`,
        tone: 'warning',
        label: '观察',
        actionLabel: '查看详情',
        actionPath: `/compositions/${encodeURIComponent(composition.id)}`,
      };
    }
    return {
      id: `${composition.id}-cadence`,
      title: '再平衡复核',
      description: `${getRebalanceLabel(
        composition.rebalance_frequency,
      )} 已接近更新窗口，需要确认现金腿缓冲。`,
      tone: 'accent',
      label: '观察',
      actionLabel: '查看详情',
      actionPath: `/compositions/${encodeURIComponent(composition.id)}`,
    };
  });

  return tasks.slice(0, 4);
}

function estimateThirtyDayReturn(composition: ApiCompositionListItem): number {
  return normalizePercentLike(composition.annualized_return) / 3.5;
}

function getCompositionSharpe(composition: ApiCompositionListItem): number {
  const value = Number(composition.sharpe);
  return Number.isFinite(value) ? value : 0;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function buildObservationCards(compositions: ApiCompositionListItem[]): DashboardObservationCard[] {
  if (compositions.length === 0) {
    return [];
  }
  const topReturn = [...compositions].sort(
    (left, right) => normalizePercentLike(right.annualized_return) - normalizePercentLike(left.annualized_return),
  )[0];
  const largestDrawdown = [...compositions].sort(
    (left, right) => Math.abs(normalizePercentLike(right.max_drawdown)) - Math.abs(normalizePercentLike(left.max_drawdown)),
  )[0];
  const averageScore = average(compositions.map((composition) => composition.composition_score));

  return [
    {
      detail: formatCompositionName({
        benchmarkLabel: topReturn.benchmark_label,
        name: topReturn.name,
        status: topReturn.status,
      }),
      label: '最高年化',
      tone: normalizePercentLike(topReturn.annualized_return) >= 0 ? 'positive' : 'negative',
      value: formatComposePercent(topReturn.annualized_return),
    },
    {
      detail: formatCompositionName({
        benchmarkLabel: largestDrawdown.benchmark_label,
        name: largestDrawdown.name,
        status: largestDrawdown.status,
      }),
      label: '最大回撤',
      tone: 'negative',
      value: formatComposePercent(largestDrawdown.max_drawdown, { forceNegative: true }),
    },
    {
      detail: `${compositions.length} 个运行时组合`,
      label: '平均评分',
      value: formatRatio(averageScore),
    },
  ];
}

function getCompositionNextStep(composition: ApiCompositionListItem): string {
  const normalizedStatus = String(composition.status || '').toUpperCase();
  if (normalizedStatus === 'DRAFT') {
    return '下一步：确认来源快照之后，才适合转成正式版本。';
  }
  if (-Math.abs(normalizePercentLike(composition.max_drawdown)) <= -0.1) {
    return '下一步：复核回撤约束与现金腿缓冲，再确认下一轮维护窗口。';
  }
  return '下一步：补一条现金腿阈值判断，再确认下一轮季度再平衡窗口。';
}

function ActionButton({
  className,
  label,
  path,
}: {
  className: string;
  label: string;
  path: string;
}): JSX.Element {
  return (
    <button
      className={className}
      onClick={() => navigateTo(path)}
      type="button"
    >
      {label}
    </button>
  );
}

export function CompositionDashboardView({
  compositions,
  loading,
  error,
  savingCompositionId = null,
  writeError = null,
  onStatusChange,
}: CompositionDashboardViewProps): JSX.Element {
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);
  const liveCompositions = compositions.filter(
    (composition) => String(composition.status || '').toUpperCase() !== 'ARCHIVED',
  );
  const activeCompositions = liveCompositions.filter(
    (composition) => String(composition.status || '').toUpperCase() === 'ACTIVE',
  );
  const archivedCompositions = liveCompositions.filter(
    (composition) => String(composition.status || '').toUpperCase() === 'ARCHIVED',
  );
  const pendingTasks = buildTaskList(liveCompositions);
  const coveragePercent = liveCompositions.length
    ? Math.round((activeCompositions.length / liveCompositions.length) * 100)
    : 0;
  const updatedCompositions = [...liveCompositions].sort((left, right) =>
    (right.updated_at || '').localeCompare(left.updated_at || ''),
  );
  const dominantCadenceLabel = getDominantCadenceLabel(liveCompositions);
  const visibleCompositions = updatedCompositions.slice(0, 2);
  const visibleTasks = pendingTasks.slice(0, 3);
  const visibleActivities = updatedCompositions.slice(0, 4);
  const observationCards = buildObservationCards(liveCompositions);
  const pendingArchiveComposition =
    liveCompositions.find((composition) => composition.id === pendingArchiveId) ?? null;

  function requestStatusChange(compositionId: string, status: ApiCompositionStatus): void {
    if (status === 'ARCHIVED') {
      setPendingArchiveId(compositionId);
      return;
    }
    void onStatusChange?.(compositionId, status);
  }

  function closeArchiveDialog(): void {
    if (pendingArchiveComposition && savingCompositionId === pendingArchiveComposition.id) {
      return;
    }
    setPendingArchiveId(null);
  }

  async function confirmArchiveComposition(): Promise<void> {
    if (!pendingArchiveComposition || !onStatusChange) {
      return;
    }
    await onStatusChange(pendingArchiveComposition.id, 'ARCHIVED');
    setPendingArchiveId(null);
  }

  if (loading) {
    return (
      <div
        className="composition-dashboard-page stack"
        data-page-root="composition-dashboard"
        data-route-root="compositions"
      >
        <section className="page-heading">
          <p className="page-heading__eyebrow">组合仪表板</p>
          <h1>组合仪表板</h1>
          <p>正在加载正式组合与来源维护摘要...</p>
        </section>
        <section className="composition-dashboard-feedback" aria-live="polite">
          <p>组合摘要正在准备中，请稍候。</p>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="composition-dashboard-page stack"
        data-page-root="composition-dashboard"
        data-route-root="compositions"
      >
        <section className="page-heading">
          <p className="page-heading__eyebrow">组合仪表板</p>
          <h1>组合仪表板</h1>
          <p>集中呈现正式组合状态、来源复核事项与近期维护窗口，便于快速定位当日需处理的组合动作。</p>
        </section>
        <div className="error-banner" role="alert">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div
      className="composition-dashboard-page stack"
      data-page-root="composition-dashboard"
      data-route-root="compositions"
    >
      <section className="composition-dashboard-hero">
        <div className="composition-dashboard-hero__header">
          <div className="composition-dashboard-hero__copy">
            <p className="page-heading__eyebrow">组合仪表板</p>
            <h1>组合仪表板</h1>
            <p>集中呈现正式组合状态、来源复核事项与近期维护窗口，便于快速定位当日需处理的组合动作。</p>
          </div>
          <div className="composition-dashboard-hero__actions">
            <ActionButton
              className="primary-button"
              label="新建组合"
              path="/compositions/workbench"
            />
          </div>
        </div>

        <div className="composition-dashboard-chip-row">
          <span className="composition-dashboard-chip composition-dashboard-chip--accent">
            正式组合 {activeCompositions.length} 个
          </span>
          <span className="composition-dashboard-chip">
            待处理动作 {pendingTasks.length} 项
          </span>
          <span className="composition-dashboard-chip">
            {dominantCadenceLabel}
          </span>
          <span className="composition-dashboard-chip">
            来源覆盖 {coveragePercent}%
          </span>
        </div>

        {writeError ? (
          <div className="error-banner" role="alert">
            {writeError}
          </div>
        ) : null}

        <div className="composition-dashboard-metric-grid">
          <article className="composition-dashboard-metric composition-dashboard-metric--accent">
            <span>正式组合</span>
            <strong>{activeCompositions.length}</strong>
            <small>
              共 {liveCompositions.length} 个已保存组合，其中 {archivedCompositions.length}{' '}
              个已转入归档视图。
            </small>
          </article>
          <article className="composition-dashboard-metric">
            <span>待处理动作</span>
            <strong>{pendingTasks.length}</strong>
            <small>已根据草稿、回撤约束与成立性评分自动汇总为当日工作队列。</small>
          </article>
          <article className="composition-dashboard-metric">
            <span>冻结来源覆盖</span>
            <strong>{coveragePercent}%</strong>
            <small>当前以已进入正式状态的组合占比作为首页维护覆盖的代理指标。</small>
          </article>
        </div>
      </section>

      {liveCompositions.length === 0 ? (
        <section className="composition-dashboard-empty">
          <h2>还没有已保存组合</h2>
          <p>组合仪表板会在这里展示正式组合、待处理动作与近期维护活动。现在可以先进入工作台创建第一组组合结构。</p>
          <div className="composition-dashboard-card__actions">
            <ActionButton
              className="primary-button"
              label="进入组合工作台"
              path="/compositions/workbench"
            />
          </div>
        </section>
      ) : (
        <div className="composition-dashboard-layout">
          <div className="composition-dashboard-column">
            <section className="composition-dashboard-panel">
              <div className="composition-dashboard-panel__header">
                <div className="composition-dashboard-panel__copy">
                  <h2>我的组合</h2>
                  <p>展示正式组合的收益表现、夏普质量与维护状态，便于识别需要优先复核的组合。</p>
                </div>
                <span className="composition-dashboard-chip composition-dashboard-chip--accent">
                  {activeCompositions.length} 个正式组合
                </span>
              </div>

              <div className="composition-dashboard-card-grid">
                {visibleCompositions.map((composition) => {
                  const tone = getStatusTone(composition.status);
                  const normalizedStatus = String(composition.status || '').toUpperCase();
                  const statusAction = getStatusWriteAction(composition.status);
                  const isSavingStatus = savingCompositionId === composition.id;
                  return (
                    <article className="composition-dashboard-card" key={composition.id}>
                      <div className="composition-dashboard-card__header">
                        <div className="composition-dashboard-card__copy">
                          <h3>
                            {formatCompositionName({
                              name: composition.name,
                              benchmarkLabel: composition.benchmark_label,
                              status: composition.status,
                            })}
                          </h3>
                          <div className="composition-dashboard-card__chips">
                            <span className="composition-dashboard-chip composition-dashboard-chip--accent">
                              {getRebalanceLabel(composition.rebalance_frequency)}
                            </span>
                            <span className="composition-dashboard-chip">
                              {composition.leg_count} 条腿
                            </span>
                          </div>
                        </div>
                        <span className={`composition-dashboard-chip composition-dashboard-chip--${tone}`}>
                          {getStatusLabel(composition.status)}
                        </span>
                      </div>

                      <div className="composition-dashboard-card__metrics">
                        <div className="composition-dashboard-card__metric">
                          <span>近 30 日</span>
                          <strong
                            className={composition.annualized_return >= 0 ? 'is-positive' : 'is-negative'}
                          >
                            {formatComposePercent(estimateThirtyDayReturn(composition))}
                          </strong>
                        </div>
                        <div className="composition-dashboard-card__metric">
                          <span>年化</span>
                          <strong
                            className={composition.annualized_return >= 0 ? 'is-positive' : 'is-negative'}
                          >
                            {formatComposePercent(composition.annualized_return)}
                          </strong>
                        </div>
                        <div className="composition-dashboard-card__metric">
                          <span>夏普</span>
                          <strong className={getCompositionSharpe(composition) >= 0 ? 'is-positive' : 'is-negative'}>
                            {formatRatio(getCompositionSharpe(composition))}
                          </strong>
                        </div>
                        <div className="composition-dashboard-card__metric">
                          <span>最大回撤</span>
                          <strong className="is-negative">
                            {formatComposePercent(composition.max_drawdown, { forceNegative: true })}
                          </strong>
                        </div>
                      </div>

                      <p className="composition-dashboard-card__next-step">{getCompositionNextStep(composition)}</p>

                      <div className="composition-dashboard-card__actions">
                        <button
                          className="ghost-button"
                          disabled={isSavingStatus || !onStatusChange}
                          onClick={() => {
                            requestStatusChange(composition.id, statusAction.nextStatus);
                          }}
                          type="button"
                        >
                          {isSavingStatus ? '保存中...' : statusAction.label}
                        </button>
                        {normalizedStatus === 'DRAFT' ? (
                          <ActionButton
                            className="ghost-button"
                            label="补来源"
                            path={`/compositions/workbench?composition_id=${encodeURIComponent(
                              composition.id,
                            )}`}
                          />
                        ) : (
                          <ActionButton
                            className="ghost-button"
                            label="查看详情"
                            path={`/compositions/${encodeURIComponent(composition.id)}`}
                          />
                        )}
                        <ActionButton
                          className="primary-button"
                          label={normalizedStatus === 'DRAFT' ? '继续编辑' : '进入工作台'}
                          path={`/compositions/workbench?composition_id=${encodeURIComponent(
                            composition.id,
                          )}`}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="composition-dashboard-panel">
              <div className="composition-dashboard-panel__header">
                <div className="composition-dashboard-panel__copy">
                  <h2>待处理动作</h2>
                  <p>汇总来源修复、版本确认与再平衡复核事项，形成组合运营的当日工作队列。</p>
                </div>
                <span className="composition-dashboard-chip">
                  {pendingTasks.length} 条待办
                </span>
              </div>

              <div className="composition-dashboard-task-grid">
                {visibleTasks.map((task) => (
                  <article className="composition-dashboard-task" key={task.id}>
                    <div className="composition-dashboard-task__header">
                      <strong>{task.title}</strong>
                      <span className={`composition-dashboard-chip composition-dashboard-chip--${task.tone}`}>
                        {task.label}
                      </span>
                    </div>
                    <p className="composition-dashboard-task__meta">{task.description}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <div className="composition-dashboard-column">
            <section className="composition-dashboard-panel">
              <div className="composition-dashboard-panel__header">
                <div className="composition-dashboard-panel__copy">
                  <h2>最近活动</h2>
                  <p>记录组合、来源与回测的最新变动，便于追踪近期版本与维护节奏。</p>
                </div>
                <span className="composition-dashboard-chip">最近 {Math.min(updatedCompositions.length, 8)} 项</span>
              </div>

              <div className="composition-dashboard-activity-list">
                {visibleActivities.map((composition) => (
                  <article className="composition-dashboard-activity" key={`${composition.id}-activity`}>
                    <strong>
                      {formatCompositionName({
                        name: composition.name,
                        benchmarkLabel: composition.benchmark_label,
                        status: composition.status,
                      })}
                    </strong>
                    <span className="composition-dashboard-activity__meta">
                      {formatCompositionActivityLabel(composition.latest_activity_label)} · {formatDateTime(composition.updated_at)}
                    </span>
                  </article>
                ))}
              </div>
            </section>

            <section className="composition-dashboard-observation">
              <div className="composition-dashboard-panel__header">
                <div className="composition-dashboard-panel__copy">
                  <h2>组合观察</h2>
                  <p>提供组合层面的轻量市场观察，用于首页快速筛查，不替代详情页分析。</p>
                </div>
                <span className="composition-dashboard-chip composition-dashboard-chip--accent">
                  {liveCompositions.length} 个运行时组合
                </span>
              </div>

              <div className="composition-dashboard-observation__summary">
                {observationCards.map((card) => (
                  <article className="composition-dashboard-observation__summary-card" key={card.label}>
                    <span>{card.label}</span>
                    <strong className={card.tone === 'negative' ? 'is-negative' : card.tone === 'positive' ? 'is-positive' : undefined}>
                      {card.value}
                    </strong>
                    <small>{card.detail}</small>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
      {pendingArchiveComposition ? (
        <div
          aria-label="确认归档组合"
          aria-modal="true"
          className="modal-shell"
          onClick={closeArchiveDialog}
          role="dialog"
        >
          <div className="modal-card composition-dashboard-archive-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="composition-dashboard-archive-dialog__copy">
              <p className="eyebrow">逻辑删除确认</p>
              <h3>确认归档组合</h3>
              <p>
                归档后该组合会从组合仪表盘和后续配置入口隐藏，但底层记录仍会保留用于审计与历史追溯。
              </p>
            </div>
            <dl className="composition-dashboard-archive-dialog__summary">
              <div>
                <dt>组合</dt>
                <dd>
                  {formatCompositionName({
                    name: pendingArchiveComposition.name,
                    benchmarkLabel: pendingArchiveComposition.benchmark_label,
                    status: pendingArchiveComposition.status,
                  })}
                </dd>
              </div>
              <div>
                <dt>ID</dt>
                <dd>{pendingArchiveComposition.id}</dd>
              </div>
            </dl>
            <div className="composition-dashboard-card__actions">
              <button className="ghost-button" disabled={savingCompositionId === pendingArchiveComposition.id} onClick={closeArchiveDialog} type="button">
                取消
              </button>
              <button
                className="primary-button composition-dashboard-archive-dialog__confirm"
                disabled={savingCompositionId === pendingArchiveComposition.id}
                onClick={() => void confirmArchiveComposition()}
                type="button"
              >
                {savingCompositionId === pendingArchiveComposition.id ? '归档中...' : '确认归档'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
