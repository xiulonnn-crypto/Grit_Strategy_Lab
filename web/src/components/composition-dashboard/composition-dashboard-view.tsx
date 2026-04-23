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

function estimateVolatility(composition: ApiCompositionListItem): number {
  const annualizedReturn = Math.abs(normalizePercentLike(composition.annualized_return));
  const drawdown = Math.abs(normalizePercentLike(composition.max_drawdown));
  return Math.max(0.036, Math.min(0.092, annualizedReturn * 0.62 + drawdown * 0.02));
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
  const dominantCadenceLabel = getDominantCadenceLabel(compositions);
  const visibleCompositions = updatedCompositions.slice(0, 2);
  const visibleTasks = pendingTasks.slice(0, 3);
  const visibleActivities = updatedCompositions.slice(0, 4);

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
                  {activeCompositions.length} 个正式组合
                </span>
              </div>

              <div className="composition-dashboard-card-grid">
                {visibleCompositions.map((composition) => {
                  const tone = getStatusTone(composition.status);
                  const normalizedStatus = String(composition.status || '').toUpperCase();
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
                          <span>波动</span>
                          <strong>{formatComposePercent(estimateVolatility(composition))}</strong>
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
                  最近 90 日
                </span>
              </div>

              <div className="composition-dashboard-observation__chart" aria-hidden="true">
                <svg viewBox="0 0 620 208" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="composition-dashboard-fill" x1="0%" x2="0%" y1="0%" y2="100%">
                      <stop offset="0%" stopColor="rgba(31, 135, 123, 0.18)" />
                      <stop offset="100%" stopColor="rgba(31, 135, 123, 0)" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0 150 L88 146 L176 136 L264 120 L352 108 L440 84 L528 66 L620 46 L620 208 L0 208 Z"
                    fill="url(#composition-dashboard-fill)"
                  />
                  <polyline
                    fill="none"
                    points="0,154 88,150 176,144 264,134 352,124 440,112 528,102 620,94"
                    stroke="#4c78c7"
                    strokeDasharray="8 7"
                    strokeWidth="3"
                  />
                  <polyline
                    fill="none"
                    points="0,150 88,146 176,136 264,120 352,108 440,84 528,66 620,46"
                    stroke="#1f877b"
                    strokeWidth="4"
                  />
                </svg>
              </div>

              <div className="composition-dashboard-observation__chips">
                <span className="composition-dashboard-chip composition-dashboard-chip--accent">
                  正式组合收益流
                </span>
                <span className="composition-dashboard-chip">
                  基准虚线
                </span>
                <span className="composition-dashboard-chip">
                  ETF 腿相关性略升
                </span>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
