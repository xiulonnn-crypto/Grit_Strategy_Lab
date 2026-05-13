import { useEffect, useMemo, useState } from 'react';
import { buildRecentRunScore, buildWorkspaceStrategyCards } from '../lib/workspace-adapters';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatStrategyVersionTag, getStrategyDisplayName } from '../lib/strategy-version';
import { WorkspaceRecentRunsSection, type WorkspaceRecentRunItem } from '../page-sections/workspace-recent-runs-lane-b';
import { WorkspaceStrategySection } from '../page-sections/workspace-lane-b';
import type {
  ApiBacktestRunDetail,
  ApiBacktestRunListItem,
  ApiOptimizationJobListItem,
  ApiStrategyDetail,
  ApiStrategyListItem,
  ApiWorkspaceOverview,
} from '../types';
import './workspace-page-lane-b.css';

const TEXT = {
  healthTitle: '工作台健康度',
  healthCopy: '总览策略规模、活跃回测与优化进度，直达最新任务。',
  createStrategy: '创建策略',
  openSnapshots: '数据快照',
  noStrategyTitle: '创建第一个策略',
  noStrategyCopy: '当前还没有可用策略，先创建一个策略，把回测与优化主链路跑通。',
  noStrategyAction: '创建第一个策略',
  strategiesLabel: '策略数',
  activeRunsLabel: '活跃回测',
  optimizationsLabel: '优化任务',
  latestRunLabel: '最新回测',
  latestRunFallback: '暂无',
} as const;

const STRATEGY_BOARD_LIMIT = 6;
const FIRST_SCREEN_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 80;
const OPTIMIZATION_ACTIVITY_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 1000;

function isAbortError(caught: unknown): boolean {
  return caught instanceof DOMException
    ? caught.name === 'AbortError'
    : typeof caught === 'object' && caught !== null && 'name' in caught && (caught as { name?: string }).name === 'AbortError';
}

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

function getStrategyEditedTime(strategy: ApiStrategyListItem): number {
  const value = strategy.updated_at ?? strategy.created_at;
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareStrategiesByRecentEdit(left: ApiStrategyListItem, right: ApiStrategyListItem): number {
  const timeDiff = getStrategyEditedTime(right) - getStrategyEditedTime(left);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  const nameDiff = left.name.localeCompare(right.name, 'zh-Hans');
  return nameDiff || left.id.localeCompare(right.id);
}

function formatDateRange(start?: string | null, end?: string | null): string {
  const normalizedStart = start ? new Date(start).getTime() : Number.NaN;
  const normalizedEnd = end ? new Date(end).getTime() : Number.NaN;
  const orderedStart = Number.isFinite(normalizedStart) && Number.isFinite(normalizedEnd) && normalizedStart > normalizedEnd ? end : start;
  const orderedEnd = Number.isFinite(normalizedStart) && Number.isFinite(normalizedEnd) && normalizedStart > normalizedEnd ? start : end;

  const formattedStart = formatDisplayDate(orderedStart);
  const formattedEnd = formatDisplayDate(orderedEnd);

  if (formattedStart && formattedEnd) {
    return `${formattedStart} - ${formattedEnd}`;
  }
  if (formattedStart) {
    return `${formattedStart} - 区间待定`;
  }
  if (formattedEnd) {
    return `区间待定 - ${formattedEnd}`;
  }

  return '区间待定';
}

function formatRelativeTime(value?: string | null): string {
  if (!value) {
    return '时间未知';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '时间未知';
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

function formatOptimizationStatus(status?: string | null): string {
  switch (String(status ?? '').toUpperCase()) {
    case 'QUEUED':
      return '排队中';
    case 'RUNNING':
      return '进行中';
    case 'INTERRUPTED':
      return '已中断';
    case 'COMPLETED':
      return '已完成';
    case 'PARTIALLY_FAILED':
      return '部分失败';
    case 'FAILED':
      return '失败';
    default:
      return '未知状态';
  }
}

function formatOptimizationRate(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function formatOptimizationMetric(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return value.toFixed(2);
}

function translateOptimizationText(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const text = value.trim();
  if (!text) {
    return null;
  }

  const exactReplacements: Array<[RegExp, string]> = [
    [/^Preparing trial\s+(\d+)\/(\d+)$/i, '准备试验 $1/$2'],
    [/^Completed\s+(\d+)\/(\d+)\s+trials\.?$/i, '已完成 $1/$2 组试验'],
    [/^Interrupted at\s+(\d+)\/(\d+)$/i, '已中断（$1/$2）'],
    [/^Running trial\s+(\d+)\/(\d+)$/i, '正在评估第 $1/$2 组'],
    [/^Evaluating trial\s+(\d+)\/(\d+)\.?$/i, '正在评估第 $1/$2 组'],
  ];

  for (const [pattern, replacement] of exactReplacements) {
    if (pattern.test(text)) {
      return text.replace(pattern, replacement);
    }
  }

  return text.replace(/\bWalk Forward\b/gi, '滚动前瞻验证');
}

function formatOptimizationStage(value?: string | null): string {
  return translateOptimizationText(value) ?? '等待中';
}

function pickActivityTime(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function buildOptimizationKindLabel(status: string): string {
  return status === 'INTERRUPTED' ? '优化已中断' : '优化任务';
}

function formatOptimizationEntryPoint(value?: string | null): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'run_detail':
      return '回测详情';
    case 'strategy_detail':
      return '策略详情';
    default:
      return '工作台';
  }
}

function formatOptimizationValidationMode(value?: string | null): string {
  return String(value ?? '').toLowerCase() === 'single_oos' ? '单窗口样本外' : '滚动前瞻验证';
}

function getConfigDate(configuration: ApiBacktestRunDetail['configuration'], key: string): string | undefined {
  if (!configuration || typeof configuration !== 'object') {
    return undefined;
  }

  const value = (configuration as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function toRunSummaryDetail(run: ApiBacktestRunListItem): ApiBacktestRunDetail {
  return {
    id: run.id,
    strategy_id: run.strategy_id,
    strategy_name: run.strategy_name,
    status: run.status,
    metrics: run.metrics ?? {},
    warnings: run.warnings ?? [],
    preview: run.preview,
    data_segment_type: run.data_segment_type,
    parameter_version_id: run.parameter_version_id ?? run.preview?.parameter_version_id ?? null,
    request: {},
    start_date: run.start_date ?? null,
    end_date: run.end_date ?? null,
    oos_start_date: run.oos_start_date ?? run.preview?.oos_start_date ?? null,
    effective_date: run.effective_date ?? run.preview?.effective_date ?? null,
    is_permanent: run.is_permanent,
    source_run_id: run.source_run_id ?? null,
    trades_count: run.trades_count,
    created_at: run.created_at,
    updated_at: run.updated_at,
    completed_at: run.completed_at ?? null,
  };
}

function buildBacktestRecentRunItems(
  runs: ApiBacktestRunListItem[],
  detailsById: Record<string, ApiBacktestRunDetail>,
  strategyNamesById: Record<string, string>,
): WorkspaceRecentRunItem[] {
  return runs.map((run) => {
    const detail = detailsById[run.id] ?? toRunSummaryDetail(run);
    const strategyName = getStrategyDisplayName(
      strategyNamesById[run.strategy_id] ?? run.strategy_name ?? run.strategy_id,
      run.strategy_id,
    );
    const score = buildRecentRunScore(detail);
    const preview = detail?.preview ?? run.preview;
    const rangeStart =
      detail?.start_date ??
      run.start_date ??
      getConfigDate(detail?.configuration, 'start_date') ??
      preview?.effective_start_date ??
      getConfigDate(detail?.configuration, 'effective_start_date') ??
      preview?.oos_start_date ??
      detail?.oos_start_date ??
      run.oos_start_date ??
      run.preview?.oos_start_date ??
      run.created_at;
    const rangeEnd =
      detail?.end_date ??
      run.end_date ??
      getConfigDate(detail?.configuration, 'end_date') ??
      preview?.effective_end_date ??
      getConfigDate(detail?.configuration, 'effective_end_date') ??
      detail?.effective_date ??
      run.effective_date ??
      run.preview?.effective_date ??
      run.completed_at ??
      detail?.completed_at ??
      run.updated_at ??
      run.created_at;
    const completedAt = run.completed_at ?? detail?.completed_at ?? run.updated_at ?? run.created_at;
    const strategyVersionTag = formatStrategyVersionTag(
      detail?.parameter_version_id ?? run.parameter_version_id ?? preview?.parameter_version_id,
    );

    return {
      id: run.id,
      kind: 'backtest',
      activityId: run.id,
      strategyName,
      strategyVersionTag,
      status: run.status,
      completedAt,
      statusLabel:
        run.status === 'QUEUED'
          ? '排队中'
          : run.status === 'RUNNING'
            ? '运行中'
            : run.status === 'INTERRUPTED'
              ? '已中断'
            : run.status === 'COMPLETED'
              ? '已完成'
              : run.status === 'COMPLETED_WITH_WARNINGS'
                ? '已完成有提醒'
                : '失败',
      kindLabel: (detail?.is_permanent ?? run.is_permanent) ? '永久回测' : '临时回测',
      metaLabel: formatDateRange(rangeStart, rangeEnd),
      badges: [
        {
          text: `年化收益率 ${score.annualizedReturn}`,
          tone: score.annualizedReturn.startsWith('-')
            ? 'negative'
            : score.annualizedReturn.startsWith('+')
              ? 'positive'
              : 'neutral',
        },
        { text: `收益夏普 ${score.sharpe}`, tone: 'neutral' },
        {
          text: `状态 ${
            run.status === 'COMPLETED_WITH_WARNINGS'
              ? '已完成有提醒'
              : run.status === 'COMPLETED'
                ? '已完成'
                : run.status === 'INTERRUPTED'
                  ? '已中断'
                : run.status === 'RUNNING'
                  ? '运行中'
                  : run.status === 'QUEUED'
                    ? '排队中'
                    : '失败'
          }`,
          tone: run.status === 'FAILED' ? 'negative' : run.status === 'COMPLETED_WITH_WARNINGS' ? 'warning' : 'neutral',
        },
      ],
      completedRelativeLabel: formatRelativeTime(completedAt),
      navigatePath: `/runs/${run.id}`,
    };
  });
}

function buildOptimizationRecentRunItems(
  jobs: ApiOptimizationJobListItem[],
  strategyNamesById: Record<string, string>,
): WorkspaceRecentRunItem[] {
  return jobs.map((job) => {
    const status = String(job.status ?? '').toUpperCase();
    const strategyBaseName = getStrategyDisplayName(
      strategyNamesById[job.strategy_id] ?? job.strategy_name ?? job.strategy_id,
      job.strategy_id,
    );
    const strategyVersionTag = formatStrategyVersionTag(job.base_parameter_version_id);
    const completedAt = pickActivityTime(job.completed_at, job.updated_at, job.created_at);
    const bestMetrics = job.best_metrics_summary?.metrics ?? {};
    const annualizedReturn =
      typeof bestMetrics.annualized_return === 'number'
        ? bestMetrics.annualized_return
        : typeof bestMetrics.cagr === 'number'
          ? bestMetrics.cagr
          : null;
    const returnSharpe =
      typeof bestMetrics.return_sharpe === 'number'
        ? bestMetrics.return_sharpe
        : typeof bestMetrics.sharpe === 'number'
          ? bestMetrics.sharpe
          : null;
    const progressPct = typeof job.progress_pct === 'number' ? job.progress_pct : 0;
    const etaText =
      typeof job.estimated_remaining_minutes === 'number'
        ? `预计 ${Math.max(0, Math.round(job.estimated_remaining_minutes))} 分钟`
        : '等待首批样本';
    const progressLabel = job.budget_combinations
      ? `${job.completed_combinations ?? 0} / ${job.budget_combinations}`
      : `${job.completed_combinations ?? 0}`;
    const stageLabel = formatOptimizationStage(job.current_stage);
    const latestUpdateLabel = translateOptimizationText(job.latest_update);

    const badges =
      status === 'INTERRUPTED'
        ? [
            { text: `已完成 ${progressLabel}`, tone: 'warning' as const },
            { text: '进度已保留', tone: 'warning' as const },
            { text: `恢复起点 第 ${job.next_trial_index ?? (job.completed_combinations ?? 0) + 1} 轮`, tone: 'neutral' as const },
          ]
        : ['QUEUED', 'RUNNING'].includes(status)
          ? [
              { text: `进度 ${progressPct}%`, tone: 'neutral' as const },
              { text: etaText, tone: typeof job.estimated_remaining_minutes === 'number' ? 'positive' as const : 'neutral' as const },
              { text: `阶段 ${stageLabel}`, tone: 'neutral' as const },
            ]
          : [
              { text: `年化收益率 ${formatOptimizationRate(annualizedReturn)}`, tone: annualizedReturn !== null && annualizedReturn < 0 ? 'negative' as const : 'positive' as const },
              { text: `收益夏普 ${formatOptimizationMetric(returnSharpe)}`, tone: 'neutral' as const },
              { text: `状态 ${formatOptimizationStatus(status)}`, tone: status === 'FAILED' ? 'negative' as const : status === 'PARTIALLY_FAILED' ? 'warning' as const : 'neutral' as const },
            ];

    const baseMetaLabel =
      status === 'INTERRUPTED'
        ? latestUpdateLabel ?? '优化已中断，当前进度已保留，可继续恢复任务。'
        : ['QUEUED', 'RUNNING'].includes(status)
          ? latestUpdateLabel ?? `当前阶段 ${stageLabel}`
          : [
              formatOptimizationEntryPoint(job.entry_point),
              formatOptimizationValidationMode(job.validation_mode),
            ]
              .filter((value): value is string => Boolean(value))
              .join(' · ');

    return {
      id: job.id,
      kind: 'optimization',
      activityId: job.id,
      strategyName: strategyBaseName,
      strategyVersionTag,
      status,
      completedAt,
      statusLabel: formatOptimizationStatus(status),
      kindLabel: buildOptimizationKindLabel(status),
      metaLabel: baseMetaLabel,
      badges,
      completedRelativeLabel: formatRelativeTime(completedAt),
      navigatePath: `/optimization-jobs/${job.id}`,
    };
  });
}

export function WorkspacePage(): JSX.Element {
  const api = useApiClient();
  const [overview, setOverview] = useState<ApiWorkspaceOverview | null>(null);
  const [strategies, setStrategies] = useState<ApiStrategyListItem[]>([]);
  const [strategyDetails] = useState<Record<string, ApiStrategyDetail>>({});
  const [strategyLatestRuns, setStrategyLatestRuns] = useState<Record<string, ApiBacktestRunDetail>>({});
  const [recentRuns, setRecentRuns] = useState<ApiBacktestRunListItem[]>([]);
  const [recentOptimizations, setRecentOptimizations] = useState<ApiOptimizationJobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let optimizationTimer: number | null = null;
    const overviewController = new AbortController();

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const workspaceOverview = await api.getWorkspaceOverview(false, overviewController.signal);

        if (cancelled) {
          return;
        }

        setOverview(workspaceOverview);
        setLoading(false);
        await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
        const library = api.getStrategyLibrary
          ? await api.getStrategyLibrary(overviewController.signal)
          : null;
        const [strategyItems, backtestRuns] = library
          ? [library.strategies, library.runs.slice(0, 8)]
          : await Promise.all([
              api.listStrategies(overviewController.signal),
              api.listBacktestRuns({ limit: 8 }, overviewController.signal),
            ]);

        if (cancelled) {
          return;
        }

        setStrategies(strategyItems);
        setRecentRuns(backtestRuns);

        const runSummariesById = Object.fromEntries(
          backtestRuns.map((run) => [run.id, toRunSummaryDetail(run)] as const),
        );
        setStrategyLatestRuns(
          Object.fromEntries(
            Object.keys(runSummariesById)
              .map((runId) => [runId, runSummariesById[runId]] as const)
              .filter((entry): entry is readonly [string, ApiBacktestRunDetail] => Boolean(entry[1])),
          ),
        );
        setLoading(false);

        const loadOptimizationActivity = async (): Promise<void> => {
          try {
            const optimizationJobs = await api.listOptimizationJobs();
            if (!cancelled) {
              setRecentOptimizations(optimizationJobs);
            }
          } catch {
            // Optimization activity is not required for first paint.
          }
        };
        if (OPTIMIZATION_ACTIVITY_DEFER_MS > 0) {
          optimizationTimer = window.setTimeout(() => {
            void loadOptimizationActivity();
          }, OPTIMIZATION_ACTIVITY_DEFER_MS);
        } else {
          await loadOptimizationActivity();
        }
      } catch (caught) {
        if (isAbortError(caught)) {
          return;
        }
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
      if (optimizationTimer !== null) {
        window.clearTimeout(optimizationTimer);
      }
      overviewController.abort();
    };
  }, [api]);

  const cards = useMemo(
    () =>
      buildWorkspaceStrategyCards(
        [...strategies].sort(compareStrategiesByRecentEdit).slice(0, STRATEGY_BOARD_LIMIT),
        strategyDetails,
        strategyLatestRuns,
      ),
    [strategies, strategyDetails, strategyLatestRuns],
  );
  const latestStrategyId = overview?.latest_strategy_id ?? cards[0]?.id ?? null;
  const recentRunItems = useMemo(() => {
    const strategyNamesById = Object.fromEntries(strategies.map((strategy) => [strategy.id, strategy.name] as const));
    return [
      ...buildBacktestRecentRunItems(recentRuns, strategyLatestRuns, strategyNamesById),
      ...buildOptimizationRecentRunItems(recentOptimizations, strategyNamesById),
    ]
      .sort((left, right) => {
        const leftTime = left.completedAt ? new Date(left.completedAt).getTime() : 0;
        const rightTime = right.completedAt ? new Date(right.completedAt).getTime() : 0;
        return rightTime - leftTime;
      })
      .slice(0, 8);
  }, [recentOptimizations, recentRuns, strategies, strategyLatestRuns]);
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
            <button className="primary-button gsl-btn-primary" onClick={() => navigateTo('/strategies')} type="button">
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
              <button className="primary-button gsl-btn-primary" onClick={() => navigateTo('/strategies')} type="button">
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
