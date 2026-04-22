import { formatDateTime, formatRatio } from '../../lib/format';
import {
  formatBenchmarkLabel,
  formatComposePercent,
  formatCompositionActivityLabel,
  formatCompositionName,
  formatCompositionStatusLabel,
  formatRebalanceCadence,
  normalizePercentLike,
} from '../../lib/compose-display';
import { navigateTo } from '../../lib/appRouteContext';
import type { ApiCompositionListItem } from '../../types';
import './composition-dashboard.css';

type CompositionDashboardViewProps = {
  compositions: ApiCompositionListItem[];
  loading?: boolean;
  error?: string | null;
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

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function buildObservationPath(values: number[], width: number, height: number): string {
  if (!values.length) {
    return '';
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = 18 + (index / Math.max(1, values.length - 1)) * (width - 36);
      const y = height - 20 - ((value - min) / range) * (height - 36);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
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
    const compositionName = formatCompositionName({
      name: composition.name,
      benchmarkLabel: composition.benchmark_label,
      status: composition.status,
    });
    if (normalizedStatus === 'DRAFT') {
      return {
        id: `${composition.id}-draft`,
        title: `补齐并保存 ${compositionName}`,
        description: `当前仍为草稿，建议先在工作台完成来源确认与权重复核，再进入正式持有。`,
        tone: 'warning',
        label: '高优先',
        actionLabel: '进入工作台',
        actionPath: `/compositions/workbench?composition_id=${encodeURIComponent(composition.id)}`,
      };
    }
    if (-Math.abs(normalizePercentLike(composition.max_drawdown)) <= -0.12) {
      return {
        id: `${composition.id}-drawdown`,
        title: `复核 ${compositionName} 的回撤约束`,
        description: `当前最大回撤达到 ${formatComposePercent(composition.max_drawdown, {
          forceNegative: true,
        })}，建议回看来源配置与维护成本约束。`,
        tone: 'danger',
        label: '处理中',
        actionLabel: '查看详情',
        actionPath: `/compositions/${encodeURIComponent(composition.id)}`,
      };
    }
    if (composition.composition_score < 70) {
      return {
        id: `${composition.id}-score`,
        title: `关注 ${compositionName} 的成立性评分`,
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
      title: `安排 ${compositionName} 的维护检查`,
      description: `${getRebalanceLabel(
        composition.rebalance_frequency,
      )} 已接近更新窗口，建议核对近期来源变更与组合引用。`,
      tone: 'accent',
      label: '观察',
      actionLabel: '查看详情',
      actionPath: `/compositions/${encodeURIComponent(composition.id)}`,
    };
  });

  return tasks.slice(0, 4);
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
}: CompositionDashboardViewProps): JSX.Element {
  const activeCompositions = compositions.filter(
    (composition) => String(composition.status || '').toUpperCase() === 'ACTIVE',
  );
  const archivedCompositions = compositions.filter(
    (composition) => String(composition.status || '').toUpperCase() === 'ARCHIVED',
  );
  const pendingTasks = buildTaskList(compositions);
  const coveragePercent = compositions.length
    ? Math.round((activeCompositions.length / compositions.length) * 100)
    : 0;
  const updatedCompositions = [...compositions].sort((left, right) =>
    (right.updated_at || '').localeCompare(left.updated_at || ''),
  );
  const observationSeries = updatedCompositions
    .slice(0, 6)
    .map((composition) => normalizePercentLike(composition.annualized_return) * 100);
  const averageScore = average(
    compositions.map((composition) => composition.composition_score),
  );
  const worstDrawdown = compositions.length
    ? Math.min(
        ...compositions.map((composition) => -Math.abs(normalizePercentLike(composition.max_drawdown))),
      )
    : 0;
  const observationPath = buildObservationPath(observationSeries, 640, 220);
  const dominantCadenceLabel = getDominantCadenceLabel(compositions);

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

        <div className="composition-dashboard-metric-grid">
          <article className="composition-dashboard-metric composition-dashboard-metric--accent">
            <span>正式组合</span>
            <strong>{activeCompositions.length}</strong>
            <small>
              共 {compositions.length} 个已保存组合，其中 {archivedCompositions.length}{' '}
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

      {compositions.length === 0 ? (
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
                  <p>展示正式组合的收益表现、波动约束与维护状态，便于识别需要优先复核的组合。</p>
                </div>
                <span className="composition-dashboard-chip composition-dashboard-chip--accent">
                  {compositions.length} 个已保存组合
                </span>
              </div>

              <div className="composition-dashboard-card-grid">
                {updatedCompositions.slice(0, 4).map((composition) => {
                  const tone = getStatusTone(composition.status);
                  return (
                    <article className="composition-dashboard-card" key={composition.id}>
                      <div className="composition-dashboard-card__header">
                        <div className="composition-dashboard-card__copy">
                          <div className="composition-dashboard-card__chips">
                            <span
                              className={`composition-dashboard-chip composition-dashboard-chip--${tone}`}
                            >
                              {getStatusLabel(composition.status)}
                            </span>
                            <span className="composition-dashboard-chip">
                              {getRebalanceLabel(composition.rebalance_frequency)}
                            </span>
                          </div>
                          <h3>
                            {formatCompositionName({
                              name: composition.name,
                              benchmarkLabel: composition.benchmark_label,
                              status: composition.status,
                            })}
                          </h3>
                          <p className="composition-dashboard-card__subtitle">
                            {composition.benchmark_label
                              ? `基准 ${formatBenchmarkLabel(composition.benchmark_label)} · ${formatCompositionActivityLabel(
                                  composition.latest_activity_label,
                                )}`
                              : formatCompositionActivityLabel(composition.latest_activity_label)}
                          </p>
                        </div>
                        <span className="composition-dashboard-chip">
                          {composition.leg_count} 条腿
                        </span>
                      </div>

                      <div className="composition-dashboard-card__metrics">
                        <div className="composition-dashboard-card__metric">
                          <span>年化</span>
                          <strong
                            className={composition.annualized_return >= 0 ? 'is-positive' : 'is-negative'}
                          >
                            {formatComposePercent(composition.annualized_return)}
                          </strong>
                        </div>
                        <div className="composition-dashboard-card__metric">
                          <span>最大回撤</span>
                          <strong className="is-negative">
                            {formatComposePercent(composition.max_drawdown, { forceNegative: true })}
                          </strong>
                        </div>
                        <div className="composition-dashboard-card__metric">
                          <span>成立性评分</span>
                          <strong>{formatRatio(composition.composition_score)}</strong>
                        </div>
                        <div className="composition-dashboard-card__metric">
                          <span>维护动作</span>
                          <strong>{composition.allowed_actions.length}</strong>
                        </div>
                      </div>

                      <div className="composition-dashboard-card__footer">
                        <div className="composition-dashboard-card__meta">
                          <span>最近更新</span>
                          <strong>{formatDateTime(composition.updated_at)}</strong>
                        </div>
                        <div className="composition-dashboard-card__actions">
                          <ActionButton
                            className="ghost-button"
                            label="查看详情"
                            path={`/compositions/${encodeURIComponent(composition.id)}`}
                          />
                          <ActionButton
                            className="primary-button"
                            label="进入工作台"
                            path={`/compositions/workbench?composition_id=${encodeURIComponent(
                              composition.id,
                            )}`}
                          />
                        </div>
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
                {pendingTasks.map((task) => (
                  <article className="composition-dashboard-task" key={task.id}>
                    <div className="composition-dashboard-task__header">
                      <strong>{task.title}</strong>
                      <span className={`composition-dashboard-chip composition-dashboard-chip--${task.tone}`}>
                        {task.label}
                      </span>
                    </div>
                    <p className="composition-dashboard-task__meta">{task.description}</p>
                    <button
                      className="ghost-button"
                      onClick={() => navigateTo(task.actionPath)}
                      type="button"
                    >
                      {task.actionLabel}
                    </button>
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
                <span className="composition-dashboard-chip">最近 {Math.min(updatedCompositions.length, 5)} 项</span>
              </div>

              <div className="composition-dashboard-activity-list">
                {updatedCompositions.slice(0, 5).map((composition) => (
                  <article className="composition-dashboard-activity" key={`${composition.id}-activity`}>
                    <div className="composition-dashboard-activity__header">
                      <strong>
                        {formatCompositionName({
                          name: composition.name,
                          benchmarkLabel: composition.benchmark_label,
                          status: composition.status,
                        })}
                      </strong>
                      <span className="composition-dashboard-chip">
                        {formatDateTime(composition.updated_at)}
                      </span>
                    </div>
                    <p className="composition-dashboard-activity__meta">
                      {formatCompositionActivityLabel(composition.latest_activity_label)}
                    </p>
                    <p className="composition-dashboard-activity__detail">
                      {composition.benchmark_label
                        ? `当前基准 ${formatBenchmarkLabel(composition.benchmark_label)}，结构内共有 ${composition.leg_count} 条来源腿。`
                        : `当前已保存 ${composition.leg_count} 条来源腿，建议补齐基准与维护说明。`}
                    </p>
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
                  最近 90 日
                </span>
              </div>

              <div className="composition-dashboard-observation__chart" aria-hidden="true">
                <svg viewBox="0 0 640 220" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="composition-dashboard-fill" x1="0%" x2="0%" y1="0%" y2="100%">
                      <stop offset="0%" stopColor="rgba(31, 135, 123, 0.20)" />
                      <stop offset="100%" stopColor="rgba(31, 135, 123, 0.03)" />
                    </linearGradient>
                  </defs>
                  <line x1="24" x2="616" y1="184" y2="184" stroke="rgba(148, 163, 184, 0.35)" />
                  <line x1="24" x2="24" y1="20" y2="184" stroke="rgba(148, 163, 184, 0.35)" />
                  {observationPath ? (
                    <>
                      <path
                        d={`${observationPath} L 616 184 L 24 184 Z`}
                        fill="url(#composition-dashboard-fill)"
                        opacity="0.95"
                      />
                      <path
                        d={observationPath}
                        fill="none"
                        stroke="#1f877b"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="3"
                      />
                    </>
                  ) : null}
                </svg>
              </div>

              <div className="composition-dashboard-observation__chips">
                <span className="composition-dashboard-chip composition-dashboard-chip--accent">
                  正式组合收益流
                </span>
                <span className="composition-dashboard-chip">
                  平均评分 {formatRatio(averageScore)}
                </span>
                <span className="composition-dashboard-chip composition-dashboard-chip--warning">
                  最深回撤 {formatComposePercent(worstDrawdown, { forceNegative: true })}
                </span>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
