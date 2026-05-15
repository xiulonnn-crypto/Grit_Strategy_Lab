import { useMemo, useState } from 'react';
import { formatRatio } from '../../lib/format';
import {
  formatComposePercent,
  formatCompositionName,
  formatCompositionStatusLabel,
  formatRebalanceCadence,
  normalizePercentLike,
} from '../../lib/compose-display';
import {
  diagnosisNeedsAction,
} from '../../lib/composition-diagnostics';
import { navigateTo } from '../../lib/appRouteContext';
import type { WorkspaceRecentRunItem } from '../../page-sections/workspace-recent-runs-lane-b';
import type {
  ApiCompositionGlobalAllocationJobListItem,
  ApiCompositionGlobalBacktestRunListItem,
  ApiCompositionListItem,
  ApiCompositionStatusAction,
  ApiCompositionSourceIntegrity,
  ApiCompositionStatus,
} from '../../types';
import '../../page-sections/workspace-recent-runs-lane-b.css';
import './composition-dashboard.css';

type CompositionDashboardViewProps = {
  compositions: ApiCompositionListItem[];
  backtestRuns?: ApiCompositionGlobalBacktestRunListItem[];
  allocationJobs?: ApiCompositionGlobalAllocationJobListItem[];
  loading?: boolean;
  activityLoading?: boolean;
  activityError?: string | null;
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

function explicitCompositionDiagnosis(composition: ApiCompositionListItem) {
  return composition.primary_diagnosis ?? composition.diagnoses?.[0] ?? null;
}

function getDiagnosisToneClass(composition: ApiCompositionListItem): 'accent' | 'warning' | 'danger' | 'success' {
  const diagnosis = explicitCompositionDiagnosis(composition);
  if (diagnosis?.status === '失效') return 'danger';
  if (diagnosis?.status === '待校准') return 'warning';
  if (diagnosis?.status === '稳健') return 'success';
  return 'accent';
}

function getStatusLabelForComposition(composition: ApiCompositionListItem): string {
  const diagnosis = explicitCompositionDiagnosis(composition);
  if (diagnosis?.diagnosis_label) {
    return diagnosis.diagnosis_label;
  }
  if (compositionHasNewVersion(composition)) {
    return '有新版本';
  }
  return getStatusLabel(composition.status);
}

function actionPathFromDiagnosisAction(action: ApiCompositionStatusAction | undefined, compositionId: string): string {
  const route = String(action?.route ?? '').trim();
  if (route) {
    return route;
  }
  return `/compositions/workbench?composition_id=${encodeURIComponent(compositionId)}`;
}

function sourceIntegrityHasNewVersion(item: ApiCompositionSourceIntegrity): boolean {
  const sourceRefId = String(item.source_ref_id ?? '').trim();
  const currentRefId = String(item.current_ref_id ?? '').trim();
  const alerts = (item.alerts ?? []).map((alert) => String(alert).toLowerCase());
  return (
    sourceRefId.startsWith('strategy_leg::') &&
    (
      (Boolean(currentRefId) && currentRefId !== sourceRefId) ||
      alerts.some(
        (alert) =>
          alert.includes('newer parameter version') ||
          alert.includes('newer version') ||
          alert.includes('新版本'),
      )
    )
  );
}

function getNewVersionLegCount(composition: ApiCompositionListItem): number {
  const updatedLegIds = new Set<string>();
  (composition.source_integrity ?? []).forEach((item, index) => {
    if (sourceIntegrityHasNewVersion(item)) {
      updatedLegIds.add(item.leg_id || item.source_ref_id || `${composition.id}-${index}`);
    }
  });
  if (updatedLegIds.size > 0) {
    return updatedLegIds.size;
  }
  return composition.has_new_version ? 1 : 0;
}

function compositionHasNewVersion(composition: ApiCompositionListItem): boolean {
  return getNewVersionLegCount(composition) > 0;
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
    const diagnosis = explicitCompositionDiagnosis(composition);
    if (diagnosis && diagnosisNeedsAction(diagnosis)) {
      return {
        id: `${composition.id}-${diagnosis.diagnosis_type || 'status-label'}`,
        title: diagnosis.issue_type || '状态标签待处理',
        description: diagnosis.frontend_explanation,
        tone: diagnosis.status === '失效' ? 'danger' : 'warning',
        label: diagnosis.status,
        actionLabel: '处理状态标签',
        actionPath: actionPathFromDiagnosisAction(diagnosis.actions?.[0], composition.id),
      };
    }
    const newVersionLegCount = getNewVersionLegCount(composition);
    if (newVersionLegCount > 0) {
      return {
        id: `${composition.id}-leg-version`,
        title: '腿版本更新',
        description: `“${formatCompositionName({
          name: composition.name,
          benchmarkLabel: composition.benchmark_label,
          status: composition.status,
        })}”底层有 ${newVersionLegCount} 条策略腿存在更新版本。`,
        tone: 'warning',
        label: '需确认',
        actionLabel: '进入工作台',
        actionPath: `/compositions/workbench?composition_id=${encodeURIComponent(composition.id)}`,
      };
    }
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

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatActivityDate(value?: string | null): string | null {
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

function pickActivityTime(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function formatActivityStatus(status?: string | null): string {
  switch (String(status ?? '').toUpperCase()) {
    case 'QUEUED':
      return '排队中';
    case 'RUNNING':
      return '进行中';
    case 'INTERRUPTED':
      return '已中断';
    case 'COMPLETED':
      return '已完成';
    case 'COMPLETED_WITH_WARNINGS':
      return '已完成有提醒';
    case 'PARTIALLY_FAILED':
      return '部分失败';
    case 'FAILED':
      return '失败';
    default:
      return '状态待确认';
  }
}

function formatSignedMetric(value?: number | null, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatActivityPercent(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return formatComposePercent(value);
}

function formatActivityPeriodLabel(value?: string | null): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const yearMatch = raw.match(/^(\d+)Y$/i);
  if (yearMatch) {
    return `${yearMatch[1]} 年窗口`;
  }
  const monthMatch = raw.match(/^(\d+)M$/i);
  if (monthMatch) {
    return `${monthMatch[1]} 个月窗口`;
  }
  return raw;
}

function metricTone(value?: number | null): WorkspaceRecentRunItem['badges'][number]['tone'] {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'neutral';
  }
  return value < 0 ? 'negative' : 'positive';
}

function activityTimelineTone(status: string): WorkspaceRecentRunItem['badges'][number]['tone'] {
  const normalized = status.toUpperCase();
  if (normalized === 'FAILED') {
    return 'negative';
  }
  if (['INTERRUPTED', 'COMPLETED_WITH_WARNINGS', 'PARTIALLY_FAILED'].includes(normalized)) {
    return 'warning';
  }
  return 'positive';
}

function resolveCompositionActivityName(
  compositionId: string,
  compositionName: string | null | undefined,
  compositionNamesById: Record<string, string>,
): string {
  return compositionNamesById[compositionId] || compositionName || compositionId;
}

function formatActivityRecordLabel(kind: 'backtest' | 'optimization', rawId: string): string {
  const cleanedId = rawId
    .replace(/^composition[-_]?backtest[-_]?run[-_]?/i, '')
    .replace(/^composition[-_]?run[-_]?/i, '')
    .replace(/^comp[-_]?run[-_]?/i, '')
    .replace(/^allocation[-_]?job[-_]?/i, '')
    .replace(/^alloc[-_]?job[-_]?/i, '')
    .replace(/^backtest[-_]?run[-_]?/i, '')
    .replace(/^run[-_]?/i, '')
    .replace(/^job[-_]?/i, '');
  const suffix = cleanedId && cleanedId !== rawId ? ` #${cleanedId}` : '';
  return kind === 'optimization' ? `优化记录${suffix}` : `回测记录${suffix}`;
}

function normalizeAllocationMethodKey(value?: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) {
    return '';
  }
  if (['risk_parity', 'parity'].includes(normalized)) {
    return 'risk_parity';
  }
  if (['min_vol', 'minimum_volatility', 'minimum_variance'].includes(normalized)) {
    return 'min_vol';
  }
  if (['max_sharpe', 'maximum_sharpe'].includes(normalized)) {
    return 'max_sharpe';
  }
  if (['mvo', 'mean_variance', 'mean_variance_optimization'].includes(normalized)) {
    return 'mean_variance';
  }
  if (['black_litterman', 'black_litterman_model'].includes(normalized)) {
    return 'black_litterman';
  }
  if (['efficient_frontier', 'frontier'].includes(normalized)) {
    return 'efficient_frontier';
  }
  return normalized;
}

function allocationMethodLabel(methodKey?: string | null, methodLabel?: string | null): string {
  const key = normalizeAllocationMethodKey(methodKey ?? methodLabel);
  if (key === 'risk_parity') return '风险平价';
  if (key === 'min_vol') return '最小波动';
  if (key === 'max_sharpe') return '最大夏普';
  if (key === 'mean_variance') return '均值方差优化';
  if (key === 'black_litterman') return '贝莱克-利特曼';
  if (key === 'efficient_frontier') return '有效前沿';
  return formatAllocationCopy(methodLabel) ?? '优化方法待确认';
}

function formatEvidenceCopy(value?: string | null): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'verified_from_composition_detail_preview') {
    return '来自组合详情预演的已验证证据';
  }
  if (normalized === 'proxy_from_composition_detail_preview') {
    return '来自组合详情预演的代理证据';
  }
  if (normalized === 'heuristic_from_composition_detail_preview') {
    return '来自组合详情预演';
  }
  if (/^[a-z0-9_:-]+$/i.test(raw) && raw.includes('_')) {
    return '运行证据待人工复核';
  }
  return raw;
}

function formatAllocationCopy(value?: string | null): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  const evidenceCopy = formatEvidenceCopy(raw);
  if (evidenceCopy && evidenceCopy !== raw) return evidenceCopy;
  if (normalized === 'allocation candidates were derived deterministically from the saved composition preview.') {
    return '确定性候选生成';
  }
  if (normalized === 'derived from full-window composition rebalance events and source return streams; these are model instructions, not broker fills.') {
    return '来自完整窗口组合再平衡事件和来源收益流；这是模型调仓指令，不是券商成交回报。';
  }
  if (normalized === 'current saved allocation.') {
    return '当前已保存配置。';
  }
  if (normalized === 'benchmark reference portfolio for comparison only.') {
    return '仅用于对比的基准组合。';
  }
  if (['pass', 'passed'].includes(normalized)) {
    return '可通过';
  }
  if (['blocked', 'block'].includes(normalized)) {
    return '门禁阻断';
  }
  if (['review', 'needs_review', 'pending_review'].includes(normalized)) {
    return '待审查';
  }
  return raw
    .replace(/\bRisk Parity\b/gi, '风险平价')
    .replace(/\bBlack[-\s]?Litterman\b/gi, '贝莱克-利特曼')
    .replace(/\bMVO\b/gi, '均值方差优化')
    .replace(/\bMean[-\s]?Variance(?: Optimization)?\b/gi, '均值方差优化')
    .replace(/\bMinimum Volatility\b/gi, '最小波动')
    .replace(/\bMin Vol\b/gi, '最小波动')
    .replace(/\bMax(?:imum)? Sharpe\b/gi, '最大夏普')
    .replace(/\befficient frontier\b/gi, '有效前沿');
}

function buildBacktestActivityItems(
  runs: ApiCompositionGlobalBacktestRunListItem[],
  compositionNamesById: Record<string, string>,
): WorkspaceRecentRunItem[] {
  return runs.filter((run) => Boolean(compositionNamesById[run.composition_id])).map((run) => {
    const runId = run.run_id ?? run.id;
    const completedAt = pickActivityTime(run.completed_at, run.created_at);
    const scenarioLabel = formatEvidenceCopy(run.scenario_label ?? run.verdict_label) ?? formatActivityStatus(run.status);
    const verdictDetail = formatEvidenceCopy(run.verdict_detail);
    const dateLabel = formatActivityDate(completedAt);
    return {
      id: `composition-backtest-${run.id}`,
      kind: 'backtest',
      activityId: formatActivityRecordLabel('backtest', runId),
      strategyName: resolveCompositionActivityName(run.composition_id, run.composition_name, compositionNamesById),
      strategyVersionTag: run.composition_version_label,
      status: run.status,
      completedAt,
      statusLabel: formatActivityStatus(run.status),
      kindLabel: '组合回测',
      metaLabel: [formatActivityPeriodLabel(run.time_period_label), verdictDetail, dateLabel].filter(Boolean).join(' · ') || '回测窗口待确认',
      badges: [
        { text: `年化收益率 ${formatActivityPercent(run.annualized_return)}`, tone: metricTone(run.annualized_return) },
        { text: `收益夏普 ${typeof run.sharpe === 'number' ? formatRatio(run.sharpe) : '-'}`, tone: 'neutral' },
        { text: `压力窗口 ${scenarioLabel}`, tone: run.scenario_status_label ? 'warning' : 'neutral' },
      ],
      completedRelativeLabel: formatRelativeTime(completedAt),
      navigatePath: `/compositions/${encodeURIComponent(run.composition_id)}/backtest-runs/${encodeURIComponent(runId)}`,
    };
  });
}

function buildAllocationActivityItems(
  jobs: ApiCompositionGlobalAllocationJobListItem[],
  compositionNamesById: Record<string, string>,
): WorkspaceRecentRunItem[] {
  return jobs.filter((job) => Boolean(compositionNamesById[job.composition_id])).map((job) => {
    const jobId = job.job_id ?? job.id;
    const completedAt = pickActivityTime(job.completed_at, job.created_at);
    const candidateCount = job.candidate_count ?? 0;
    const gateTone = job.gate_status === 'blocked' ? 'warning' : 'neutral';
    const methodLabel = allocationMethodLabel(job.method_key, job.method_label);
    const detailLabel = formatAllocationCopy(job.method_detail);
    const gateLabel = formatAllocationCopy(job.promotion_gate_label);
    return {
      id: `composition-optimization-${job.id}`,
      kind: 'optimization',
      activityId: formatActivityRecordLabel('optimization', jobId),
      strategyName: resolveCompositionActivityName(job.composition_id, job.composition_name, compositionNamesById),
      strategyVersionTag: job.composition_version_label,
      status: job.status,
      completedAt,
      statusLabel: formatActivityStatus(job.status),
      kindLabel: '组合优化',
      metaLabel: [methodLabel, detailLabel, gateLabel].filter(Boolean).join(' · ') || '优化任务待确认',
      badges: [
        { text: `候选 ${candidateCount}`, tone: 'neutral' },
        { text: job.gate_status === 'blocked' ? '需复核' : '测试参考', tone: gateTone },
        { text: `夏普增量 ${formatSignedMetric(job.sharpe_delta)}`, tone: metricTone(job.sharpe_delta) },
      ],
      completedRelativeLabel: formatRelativeTime(completedAt),
      navigatePath: `/compositions/${encodeURIComponent(job.composition_id)}/allocation-jobs/${encodeURIComponent(jobId)}`,
    };
  });
}

export function CompositionDashboardView({
  compositions,
  backtestRuns = [],
  allocationJobs = [],
  loading,
  activityLoading = false,
  activityError = null,
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
  const archivedCompositions = compositions.filter(
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
  const observationCards = buildObservationCards(liveCompositions);
  const recentActivityItems = useMemo(() => {
    const compositionNamesById = Object.fromEntries(
      liveCompositions.map((composition) => [
        composition.id,
        formatCompositionName({
          benchmarkLabel: composition.benchmark_label,
          name: composition.name,
          status: composition.status,
        }),
      ] as const),
    );
    return [
      ...buildBacktestActivityItems(backtestRuns, compositionNamesById),
      ...buildAllocationActivityItems(allocationJobs, compositionNamesById),
    ]
      .sort((left, right) => {
        const leftTime = left.completedAt ? new Date(left.completedAt).getTime() : 0;
        const rightTime = right.completedAt ? new Date(right.completedAt).getTime() : 0;
        return rightTime - leftTime;
      })
      .slice(0, 8);
  }, [allocationJobs, backtestRuns, liveCompositions]);
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
                  const hasNewVersion = compositionHasNewVersion(composition);
                  const diagnosis = explicitCompositionDiagnosis(composition);
                  const tone = diagnosis?.diagnosis_label
                    ? getDiagnosisToneClass(composition)
                    : hasNewVersion
                      ? 'warning'
                      : getStatusTone(composition.status);
                  const statusLabel = getStatusLabelForComposition(composition);
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
                          {statusLabel}
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
                  <button
                    aria-label={`${task.title}: ${task.description}`}
                    className="composition-dashboard-task"
                    key={task.id}
                    onClick={() => navigateTo(task.actionPath)}
                    type="button"
                  >
                    <div className="composition-dashboard-task__header">
                      <strong>{task.title}</strong>
                      <span className={`composition-dashboard-chip composition-dashboard-chip--${task.tone}`}>
                        {task.label}
                      </span>
                    </div>
                    <p className="composition-dashboard-task__meta">{task.description}</p>
                    <span className="composition-dashboard-task__action">{task.actionLabel}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="composition-dashboard-column">
            <section className="composition-dashboard-panel">
              <div className="composition-dashboard-panel__header">
                <div className="composition-dashboard-panel__copy">
                  <h2>最近回测优化</h2>
                  <p>按组合维度展示最新组合回测与资产配置优化记录，点击进入对应结果页。</p>
                </div>
                <span className="composition-dashboard-chip">最近 {recentActivityItems.length} 项</span>
              </div>

              <div className="composition-dashboard-activity-list workspace-recent-runs__timeline">
                {activityLoading ? (
                  Array.from({ length: 3 }, (_, index) => (
                    <div className="workspace-recent-runs__card workspace-recent-runs__card--skeleton" key={`composition-activity-skeleton-${index}`} />
                  ))
                ) : activityError ? (
                  <div className="workspace-recent-runs__empty workspace-recent-runs__empty--error" role="alert">
                    <p>{activityError}</p>
                  </div>
                ) : recentActivityItems.length > 0 ? (
                  recentActivityItems.map((item) => (
                    <div className={`workspace-recent-runs__item workspace-recent-runs__item--${activityTimelineTone(item.status)}`} key={item.id}>
                      <span className={`workspace-recent-runs__rail-dot workspace-recent-runs__rail-dot--${activityTimelineTone(item.status)}`} aria-hidden="true" />
                      <button
                        className="composition-dashboard-activity workspace-recent-runs__card"
                        onClick={() => navigateTo(item.navigatePath)}
                        type="button"
                      >
                      <div className="workspace-recent-runs__row-top">
                        <span className="workspace-recent-runs__run-id">{item.activityId}</span>
                        <span className={`workspace-recent-runs__kind workspace-recent-runs__kind--${item.kind === 'optimization' ? 'optimization' : 'temporary'}`}>
                          {item.kindLabel}
                        </span>
                      </div>
                      <div className="workspace-recent-runs__strategy-row">
                        <h4 className="workspace-recent-runs__strategy">{item.strategyName}</h4>
                        {item.strategyVersionTag ? <span className="workspace-recent-runs__version">{item.strategyVersionTag}</span> : null}
                      </div>
                      <p className="workspace-recent-runs__period">{item.metaLabel}</p>
                      <div className="workspace-recent-runs__badge-row">
                        <div className="workspace-recent-runs__badges">
                          {item.badges.map((badge) => (
                            <span className={`workspace-recent-runs__badge workspace-recent-runs__badge--${badge.tone}`} key={`${item.id}-${badge.text}`}>
                              {badge.text}
                            </span>
                          ))}
                        </div>
                        <span className="workspace-recent-runs__completed">{item.completedRelativeLabel}</span>
                      </div>
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="workspace-recent-runs__empty" role="status">
                    <p>暂无组合回测或优化记录。</p>
                  </div>
                )}
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
