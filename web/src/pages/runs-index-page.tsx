import { useEffect, useMemo, useRef, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import {
  buildSmartEvidenceTasks,
  buildStrategyEvidenceGroups,
  formatMetricValue,
  type EvidencePeriod,
  type RunEvidenceNode,
  type SmartEvidenceTask,
  type StrategyEvidenceGroup,
  type StrategyEvidenceStatus,
  type VersionEvidenceNode,
} from '../lib/runs-strategy-library-view-model';
import type { ApiBacktestRunDetail, ApiBacktestRunListItem, ApiStrategyDetail } from '../types';
import './runs-index-page.css';

const TEXT = {
  batchFill: '批量补齐',
  copy: '按策略与参数版本归档回测证据，集中呈现收益、回撤、夏普与长周期覆盖。',
  diagnostics: '运行诊断',
  deleteConfirm: '确认删除',
  deleteTitle: '删除回测',
  empty: '暂无回测任务。先 materialize 一个策略再回到这里。',
  fillLongPeriod: '补齐长周期',
  filterPermanent: '仅永久回测',
  filterTemporary: '显示临时',
  headingEyebrow: '回测数据',
  libraryTab: '策略库视图',
  loading: '加载回测历史中...',
  noDiagnostics: '选择左侧 run 行查看诊断。',
  noTasks: '当前证据树暂无待补齐长周期任务。',
  queuedFull: '排队中 / 计算中...',
  recentTab: '最近运行',
  recentTitle: '最近运行时间线',
  searchPlaceholder: '搜索策略、版本或 run id',
  smartTasks: '智能任务栏',
  title: '回测历史',
  treeTitle: '策略-版本证据树',
} as const;

const REQUIRED_PERIODS: EvidencePeriod[] = ['10Y', '20Y', '30Y'];
const FIRST_SCREEN_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 80;

type RunsTab = 'library' | 'recent';

type TaskState = {
  message?: string;
  status: 'queued' | 'running' | 'done' | 'error';
  virtualRunId?: string;
};

type DeleteState = {
  busy: boolean;
  error: string | null;
  run: ApiBacktestRunListItem | null;
};

function isAbortError(caught: unknown): boolean {
  return caught instanceof DOMException
    ? caught.name === 'AbortError'
    : typeof caught === 'object' &&
        caught !== null &&
        'name' in caught &&
        (caught as { name?: string }).name === 'AbortError';
}

function versionKey(strategyId: string, versionId: string): string {
  return `${strategyId}:${versionId}`;
}

function compareRunTimeDesc(left: ApiBacktestRunListItem, right: ApiBacktestRunListItem): number {
  const leftTime = Date.parse(left.completed_at ?? left.updated_at ?? left.created_at ?? '');
  const rightTime = Date.parse(right.completed_at ?? right.updated_at ?? right.created_at ?? '');
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function latestRuns(runs: ApiBacktestRunListItem[]): ApiBacktestRunListItem[] {
  return [...runs].sort(compareRunTimeDesc);
}

function matchesRunQuery(run: ApiBacktestRunListItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [
    run.id,
    run.strategy_id,
    run.strategy_name,
    run.parameter_version_id,
    run.preview?.parameter_version_id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
}

function statusLabel(status: string, isVirtual = false): string {
  if (isVirtual) {
    return TEXT.queuedFull;
  }
  switch (status) {
    case 'QUEUED':
      return '排队中';
    case 'RUNNING':
      return '计算中...';
    case 'COMPLETED':
      return '已完成';
    case 'COMPLETED_WITH_WARNINGS':
      return '已完成，需复核';
    case 'FAILED':
      return '失败';
    default:
      return status;
  }
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'FAILED') {
    return 'danger';
  }
  if (status === 'COMPLETED_WITH_WARNINGS') {
    return 'warning';
  }
  if (status === 'COMPLETED') {
    return 'success';
  }
  return 'neutral';
}

function evidenceTone(status: StrategyEvidenceStatus): 'success' | 'warning' | 'danger' {
  if (status === 'MATURE') {
    return 'success';
  }
  if (status === 'DRIFT') {
    return 'warning';
  }
  return 'danger';
}

function evidenceBadgeLabel(status: StrategyEvidenceStatus): string {
  switch (status) {
    case 'MATURE':
      return '验证通过';
    case 'DRIFT':
      return '存在漂移';
    case 'FAILED_REVIEW':
      return '失败需复核';
    default:
      return '证据断裂';
  }
}

function evidenceBadgeClass(status: StrategyEvidenceStatus): string {
  return `badge--${evidenceTone(status)}`;
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

function periodDisplayLabel(period: EvidencePeriod): string {
  return period === 'CUSTOM' ? '自定义' : period;
}

function formatPeriodRange(run: RunEvidenceNode): string {
  if (run.startDate && run.endDate) {
    return `${run.startDate} 至 ${run.endDate}`;
  }
  return run.startDate ?? run.endDate ?? '未记录周期';
}

function shortRunId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}...` : id;
}

function displayRunId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 14)}...` : id;
}

function runDetailPath(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}`;
}

function compareEvidenceRunTimeDesc(left: RunEvidenceNode, right: RunEvidenceNode): number {
  const leftTime = Date.parse(left.completedAt ?? left.raw.updated_at ?? left.raw.created_at ?? '');
  const rightTime = Date.parse(right.completedAt ?? right.raw.updated_at ?? right.raw.created_at ?? '');
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function bestCoveredPeriod(periods: EvidencePeriod[]): EvidencePeriod | null {
  const covered = ['30Y', '20Y', '10Y'].find((period) => periods.includes(period as EvidencePeriod)) as
    | EvidencePeriod
    | undefined;
  return covered ?? null;
}

function currentVersion(group: StrategyEvidenceGroup): VersionEvidenceNode | null {
  return group.versions.find((version) => version.isLatest) ?? group.versions[0] ?? null;
}

function bestEvidenceVersion(group: StrategyEvidenceGroup): VersionEvidenceNode | null {
  return [...group.versions]
    .filter(
      (version) =>
        version.metrics.sharpe !== null ||
        version.metrics.annualizedReturn !== null ||
        version.periods.length > 0,
    )
    .sort((left, right) => {
      const leftSharpe = left.metrics.sharpe ?? Number.NEGATIVE_INFINITY;
      const rightSharpe = right.metrics.sharpe ?? Number.NEGATIVE_INFINITY;
      const leftReturn = left.metrics.annualizedReturn ?? Number.NEGATIVE_INFINITY;
      const rightReturn = right.metrics.annualizedReturn ?? Number.NEGATIVE_INFINITY;
      return (
        rightSharpe - leftSharpe ||
        rightReturn - leftReturn ||
        (right.evidenceHeat ?? 0) - (left.evidenceHeat ?? 0) ||
        (right.latestCompletedAt ?? '').localeCompare(left.latestCompletedAt ?? '')
      );
    })[0] ?? currentVersion(group);
}

function latestEvidenceRun(group: StrategyEvidenceGroup): RunEvidenceNode | null {
  return group.versions.flatMap((version) => version.runs).sort(compareEvidenceRunTimeDesc)[0] ?? null;
}

function versionBadgeLabel(version: VersionEvidenceNode): string {
  if (version.status === 'BROKEN') {
    const missingLongPeriods = version.missingPeriods.filter((period) => period === '20Y' || period === '30Y');
    if (missingLongPeriods.length > 0) {
      return `待补 ${missingLongPeriods.join('/')}`;
    }
  }
  return evidenceBadgeLabel(version.status);
}

function versionSummaryCopy(version: VersionEvidenceNode): string {
  const candidate = (version.decisionNote ?? version.summary ?? '').trim();
  const noisySummary =
    !candidate ||
    candidate === '该版本暂无演进说明。' ||
    candidate.length > 64 ||
    /策略描述|本金|parameter|参数版本|run_|strat_|围绕|回测配置|dataset/i.test(candidate);

  if (!noisySummary) {
    return candidate;
  }
  if (version.isLatest && version.status === 'MATURE') {
    return '长期证据完整，作为当前主证据版本。';
  }
  if (version.isLatest) {
    return '当前主证据版本，长周期证据待补齐。';
  }
  if (version.status === 'DRIFT') {
    return '阶段表现存在漂移，保留为复核证据版本。';
  }
  if (version.status === 'FAILED_REVIEW') {
    return '存在失败样本，需复核后再纳入证据链。';
  }
  return '长周期证据待补齐，暂不作为完整证据闭环。';
}

function readString(source: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function sourceSnapshotValue(detail: ApiBacktestRunDetail | null, key: string): string | undefined {
  const request = detail?.request as Record<string, unknown> | null | undefined;
  const snapshotSummary = detail?.snapshot_summary as Record<string, unknown> | null | undefined;
  const previewSnapshot = detail?.preview?.snapshot_summary as Record<string, unknown> | null | undefined;
  return readString(request, key) ?? readString(snapshotSummary, key) ?? readString(previewSnapshot, key);
}

function taskPayload(task: SmartEvidenceTask, sourceDetail: ApiBacktestRunDetail | null): Record<string, unknown> {
  return {
    data_segment_type: sourceDetail?.data_segment_type ?? 'FULL',
    dataset_snapshot_id: sourceSnapshotValue(sourceDetail, 'dataset_snapshot_id'),
    end_date: task.endDate,
    idempotency_key: `runs-index:${task.id}:${task.startDate}:${task.endDate}`,
    is_permanent: true,
    parameter_version_id: task.versionId,
    period_years: task.targetPeriod === '30Y' ? 30 : 20,
    source_run_id: task.sourceRunId,
    start_date: task.startDate,
    universe_snapshot_id: sourceSnapshotValue(sourceDetail, 'universe_snapshot_id'),
  };
}

function makeVirtualRun(task: SmartEvidenceTask, virtualRunId: string): ApiBacktestRunListItem {
  const now = new Date().toISOString();
  return {
    completed_at: null,
    created_at: now,
    data_segment_type: 'FULL',
    end_date: task.endDate,
    id: virtualRunId,
    is_permanent: true,
    metrics: {},
    parameter_version_id: task.versionId,
    preview: {
      data_segment_type: 'FULL',
      effective_end_date: task.endDate,
      effective_start_date: task.startDate,
      parameter_version_id: task.versionId,
      warnings: [TEXT.queuedFull],
    },
    source_run_id: task.sourceRunId,
    start_date: task.startDate,
    status: 'QUEUED',
    strategy_id: task.strategyId,
    strategy_name: task.strategyName,
    trades_count: 0,
    updated_at: now,
    warnings: [TEXT.queuedFull],
  };
}

function detailToListItem(detail: ApiBacktestRunDetail, task: SmartEvidenceTask): ApiBacktestRunListItem {
  return {
    completed_at: detail.completed_at,
    created_at: detail.created_at,
    data_segment_type: detail.data_segment_type,
    end_date: detail.end_date ?? task.endDate,
    id: detail.id,
    is_permanent: detail.is_permanent ?? true,
    metrics: detail.metrics,
    parameter_version_id: detail.parameter_version_id ?? task.versionId,
    preview: detail.preview,
    source_run_id: detail.source_run_id ?? task.sourceRunId,
    start_date: detail.start_date ?? task.startDate,
    status: detail.status,
    strategy_id: detail.strategy_id ?? task.strategyId,
    strategy_name: detail.strategy_name ?? task.strategyName,
    trades_count: detail.trades_count,
    updated_at: detail.updated_at,
    warnings: detail.warnings,
  };
}

function MetricCell({
  label,
  percent = false,
  signed = false,
  value,
}: {
  label?: string;
  percent?: boolean;
  signed?: boolean;
  value: number | null | undefined;
}): JSX.Element {
  const formatted = formatMetricValue(value, { percent, signed });
  return (
    <span className="metric-cell runs-evidence-cell runs-evidence-cell--number">
      {label ? <small>{label}</small> : null}
      <strong className={percent && formatted.startsWith('-') ? 'risk' : percent ? 'positive' : ''}>{formatted}</strong>
    </span>
  );
}

function PeriodPills({ periods }: { periods: EvidencePeriod[] }): JSX.Element {
  const visiblePeriods = periods.length === 1 && periods[0] === 'CUSTOM' ? periods : REQUIRED_PERIODS;
  return (
    <span className="evidence-track runs-evidence-periods">
      {visiblePeriods.map((period) => (
        <span
          className={
            periods.includes(period)
              ? 'evidence-pill is-done runs-evidence-period-pill runs-evidence-period-pill--ready'
              : 'evidence-pill is-soft runs-evidence-period-pill'
          }
          key={period}
        >
          {period === 'CUSTOM' ? '自定义' : period}
        </span>
      ))}
    </span>
  );
}

function EvidenceHeat({
  heat,
  status,
}: {
  heat: number;
  status: StrategyEvidenceStatus;
}): JSX.Element {
  const active = Math.max(0, Math.min(10, Math.round(heat * 10)));
  const tone = evidenceTone(status);
  return (
    <span className={`heatmap runs-evidence-heat runs-evidence-heat--${tone}`} aria-label="证据热力">
      {Array.from({ length: 10 }).map((_, index) => (
        <span
          className={
            index >= active ? 'heat' : index > active - 3 && tone !== 'success' ? 'heat is-watch' : 'heat is-good'
          }
          key={index}
        />
      ))}
    </span>
  );
}

function TrendSparkline({ versions }: { versions: VersionEvidenceNode[] }): JSX.Element {
  const values = versions
    .map((version) => version.metrics.sharpe)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const points = values.length >= 2 ? values : [0.7, 1.0, 1.18];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const path = points
    .map((value, index) => {
      const x = 8 + (index * 52) / Math.max(1, points.length - 1);
      const y = 30 - ((value - min) / range) * 22;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg aria-label="证据热力趋势" className="trend" focusable="false" viewBox="0 0 68 36">
      <path d={path} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      {points.map((value, index) => {
        const x = 8 + (index * 52) / Math.max(1, points.length - 1);
        const y = 30 - ((value - min) / range) * 22;
        return <circle cx={x} cy={y} fill="currentColor" key={`${value}-${index}`} r="2.4" />;
      })}
    </svg>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  return (
    <span className={`status-pill runs-index-badge runs-index-badge--${statusTone(status)}`}>{statusLabel(status)}</span>
  );
}

function StrategyRow({
  expanded,
  group,
  hoveredTask,
  onToggle,
  selectedRunId,
  virtualRunIds,
  expandedVersionIds,
  onRunSelect,
  onVersionToggle,
}: {
  expanded: boolean;
  expandedVersionIds: Set<string>;
  group: StrategyEvidenceGroup;
  hoveredTask: SmartEvidenceTask | null;
  onRunSelect: (run: RunEvidenceNode) => void;
  onToggle: (group: StrategyEvidenceGroup) => void;
  onVersionToggle: (version: VersionEvidenceNode) => void;
  selectedRunId: string | null;
  virtualRunIds: Set<string>;
}): JSX.Element {
  const rowClassName = [
    'strategy-row runs-evidence-row runs-evidence-row--strategy runs-evidence-grid',
    hoveredTask?.strategyId === group.strategyId ? 'runs-evidence-row--task-hover' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const runCount = group.versions.reduce((total, version) => total + version.runs.length, 0);
  const activeVersion = currentVersion(group);
  const bestVersion = bestEvidenceVersion(group);
  const latestRun = latestEvidenceRun(group);
  const coveredPeriod = bestCoveredPeriod(group.periods);
  return (
    <section className="strategy-block runs-evidence-group">
      <button className={rowClassName} onClick={() => onToggle(group)} type="button">
        <span className="identity runs-tree-object runs-tree-object--strategy">
          <span className="chevron runs-evidence-caret">{expanded ? '▾' : '▸'}</span>
          <span className="tree-copy">
            <span className="runs-evidence-title">{group.strategyName}</span>
            <span className="tree-meta">
              {runCount} 次回测 / {group.versions.length} 个版本 · 当前版本 {activeVersion?.versionTag ?? '--'} · 最佳证据{' '}
              {bestVersion?.versionTag ?? '--'}
            </span>
            <span className="badge-row">
              <span className={`badge ${evidenceBadgeClass(group.status)}`}>{evidenceBadgeLabel(group.status)}</span>
              {coveredPeriod ? <span className="badge badge--blue">{coveredPeriod} 已覆盖</span> : null}
              {latestRun ? <span className="badge badge--soft">最新 {shortRunId(latestRun.id)}</span> : null}
            </span>
          </span>
        </span>
        <MetricCell label="最佳 10Y" percent signed value={group.metrics.annualizedReturn} />
        <MetricCell label="最佳夏普" value={group.metrics.sharpe} />
        <MetricCell label="最优回撤" percent value={group.metrics.maxDrawdown} />
        <span className="runs-evidence-cell runs-evidence-cell--center">
          <PeriodPills periods={group.periods} />
        </span>
        <span className="runs-evidence-cell runs-evidence-cell--heat">
          <TrendSparkline versions={group.versions} />
        </span>
      </button>
      {expanded ? (
        <div className="tree-children runs-evidence-children runs-evidence-children--versions">
          {group.versions.map((version) => (
            <VersionRow
              expanded={expandedVersionIds.has(versionKey(version.strategyId, version.id))}
              hovered={hoveredTask?.strategyId === version.strategyId && hoveredTask.versionId === version.id}
              key={version.id}
              onRunSelect={onRunSelect}
              onToggle={onVersionToggle}
              selectedRunId={selectedRunId}
              version={version}
              virtualRunIds={virtualRunIds}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function VersionRow({
  expanded,
  hovered,
  onRunSelect,
  onToggle,
  selectedRunId,
  version,
  virtualRunIds,
}: {
  expanded: boolean;
  hovered: boolean;
  onRunSelect: (run: RunEvidenceNode) => void;
  onToggle: (version: VersionEvidenceNode) => void;
  selectedRunId: string | null;
  version: VersionEvidenceNode;
  virtualRunIds: Set<string>;
}): JSX.Element {
  const rowClassName = [
    'version-row runs-evidence-row runs-evidence-row--version runs-evidence-grid',
    hovered ? 'runs-evidence-row--task-hover' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="runs-evidence-version">
      <button className={rowClassName} onClick={() => onToggle(version)} type="button">
        <span className="identity runs-tree-object runs-tree-object--version runs-evidence-object--version">
          <span className="chevron runs-evidence-caret">{expanded ? '▾' : '▸'}</span>
          <span className="tree-copy">
            <span className="version-title">
              <strong>{version.versionTag}</strong>
              <span className={`badge ${evidenceBadgeClass(version.status)}`}>{versionBadgeLabel(version)}</span>
              {version.isLatest ? <span className="mini-mark runs-evidence-mini-mark" title="当前版本">★</span> : null}
            </span>
            <span className="version-copy">{versionSummaryCopy(version)}</span>
          </span>
        </span>
        <MetricCell label="10Y 年化" percent signed value={version.metrics.annualizedReturn} />
        <MetricCell label="代表夏普" value={version.metrics.sharpe} />
        <MetricCell label="代表回撤" percent value={version.metrics.maxDrawdown} />
        <span className="runs-evidence-cell runs-evidence-cell--center">
          <PeriodPills periods={version.periods} />
        </span>
        <span className="runs-evidence-cell runs-evidence-cell--heat">
          <EvidenceHeat heat={version.evidenceHeat} status={version.status} />
        </span>
      </button>
      {expanded ? (
        <div className="tree-children runs-evidence-children runs-evidence-children--runs">
          {version.runs.map((run) => (
            <RunRow
              isPrimary={version.sourceRunId === run.id}
              isSelected={selectedRunId === run.id}
              isVirtual={virtualRunIds.has(run.id)}
              key={run.id}
              onSelect={onRunSelect}
              run={run}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RunRow({
  isPrimary,
  isSelected,
  isVirtual,
  onSelect,
  run,
}: {
  isPrimary: boolean;
  isSelected: boolean;
  isVirtual: boolean;
  onSelect: (run: RunEvidenceNode) => void;
  run: RunEvidenceNode;
}): JSX.Element {
  const rowClassName = [
    `${isVirtual ? 'queue-row' : 'run-row'} runs-evidence-row runs-evidence-row--run runs-evidence-grid`,
    isSelected ? 'runs-evidence-row--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={rowClassName} onClick={() => onSelect(run)} type="button">
      <span className="identity runs-tree-object runs-tree-object--run runs-evidence-object--run">
        <span className="run-line">
          <span className="run-id runs-evidence-run-id">{isVirtual ? statusLabel(run.status, true) : displayRunId(run.id)}</span>
          {isPrimary && !isVirtual ? <span className="run-marker runs-evidence-mini-mark" title="证据主 run">✓</span> : null}
          {!run.isTemporary && !isVirtual && (run.period === '20Y' || run.period === '30Y') ? (
            <span className="run-marker run-marker--calendar runs-evidence-mini-mark--locked" title="长期确认">
              📅
            </span>
          ) : null}
        </span>
        <span className="run-meta">
          {isVirtual
            ? '长周期回测补齐已提交。'
            : `${periodDisplayLabel(run.period)} · ${run.isTemporary ? '临时回测' : '永久回测'} · ${formatPeriodRange(run)}`}
        </span>
      </span>
      <MetricCell percent signed value={run.metrics.annualizedReturn} />
      <MetricCell value={run.metrics.sharpe} />
      <MetricCell percent value={run.metrics.maxDrawdown} />
      <span className="runs-evidence-cell runs-evidence-cell--center">
        <PeriodPills periods={[run.period]} />
      </span>
      <span className="runs-evidence-cell runs-evidence-cell--heat">
        <StatusBadge status={run.status} />
      </span>
    </button>
  );
}

function TaskCard({
  onHover,
  onSubmit,
  state,
  task,
}: {
  onHover: (task: SmartEvidenceTask | null) => void;
  onSubmit: (task: SmartEvidenceTask) => void;
  state?: TaskState;
  task: SmartEvidenceTask;
}): JSX.Element {
  const busy = state?.status === 'queued' || state?.status === 'running';
  const toneClass = task.tone === 'amber' ? 'is-drift' : 'is-highlight';
  return (
    <article
      className={`task-card ${toneClass} runs-smart-task runs-smart-task--${task.tone}`}
      onMouseEnter={() => onHover(task)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="task-head">
        <span className="task-icon" aria-hidden="true">{task.tone === 'amber' ? '⚠' : '!'}</span>
        <div>
          <strong>{task.title}</strong>
          <p>{task.description}</p>
        </div>
      </div>
      <div className="task-actions">
        <div className="runs-smart-task__meta">
          <span>{task.periodLabel}</span>
          <span>{task.versionTag}</span>
          {state?.status === 'done' ? <span className="runs-smart-task__state--done">已提交</span> : null}
          {busy ? <span className="runs-smart-task__state--running">{TEXT.queuedFull}</span> : null}
          {state?.status === 'error' ? (
            <span className="runs-smart-task__state--error">{state.message ?? '提交失败'}</span>
          ) : null}
        </div>
      <button
          className="action-button runs-smart-task__button"
        disabled={busy}
        onClick={() => onSubmit(task)}
        onMouseEnter={() => onHover(task)}
        onMouseLeave={() => onHover(null)}
        type="button"
      >
        {TEXT.fillLongPeriod}
      </button>
      </div>
    </article>
  );
}

function RecentRunRow({
  onDelete,
  onSelect,
  run,
  selected,
}: {
  onDelete: (run: ApiBacktestRunListItem) => void;
  onSelect: (runId: string) => void;
  run: ApiBacktestRunListItem;
  selected: boolean;
}): JSX.Element {
  const metrics = run.metrics;
  return (
    <div
      aria-label={`打开回测详情 ${run.id}`}
      className={selected ? 'runs-recent-row runs-recent-row--selected runs-recent-grid' : 'runs-recent-row runs-recent-grid'}
      onClick={() => onSelect(run.id)}
      role="row"
    >
      <div role="cell">
        <button
          className="text-button run-id runs-evidence-run-id"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(run.id);
          }}
          type="button"
        >
          {run.id}
        </button>
      </div>
      <div role="cell">
        {run.strategy_name ?? run.strategy_id} · {run.parameter_version_id ?? run.preview?.parameter_version_id ?? '--'}
      </div>
      <div role="cell">{run.is_permanent === false ? '临时回测' : '永久回测'}</div>
      <div role="cell">
        <StatusBadge status={run.status} />
      </div>
      <div role="cell">{formatMetricValue(metrics?.sharpe)}</div>
      <div role="cell">{formatDate(run.completed_at ?? run.updated_at)}</div>
      <div role="cell">
        <button
          className="text-button text-button--danger"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(run);
          }}
          type="button"
        >
          删除
        </button>
      </div>
    </div>
  );
}

function DiagnosticsPanel({
  detail,
  detailError,
  loading,
  selectedRunId,
}: {
  detail: ApiBacktestRunDetail | null;
  detailError: string | null;
  loading: boolean;
  selectedRunId: string | null;
}): JSX.Element {
  if (loading) {
    return <p className="runs-diagnostics__muted">读取运行诊断...</p>;
  }
  if (detailError) {
    return <p className="runs-diagnostics__error">{detailError}</p>;
  }
  if (!detail) {
    return <p className="runs-diagnostics__muted">{selectedRunId ? TEXT.queuedFull : TEXT.noDiagnostics}</p>;
  }
  return (
    <div className="runs-diagnostics">
      <button className="runs-diagnostics__run" type="button">
        {detail.id}
      </button>
      <dl>
        <div>
          <dt>状态</dt>
          <dd>{statusLabel(detail.status)}</dd>
        </div>
        <div>
          <dt>年化</dt>
          <dd>{formatMetricValue(detail.metrics?.annualized_return, { percent: true, signed: true })}</dd>
        </div>
        <div>
          <dt>夏普</dt>
          <dd>{formatMetricValue(detail.metrics?.sharpe)}</dd>
        </div>
        <div>
          <dt>最大回撤</dt>
          <dd>{formatMetricValue(detail.metrics?.max_drawdown, { percent: true })}</dd>
        </div>
        <div>
          <dt>完成时间</dt>
          <dd>{formatDate(detail.completed_at)}</dd>
        </div>
      </dl>
      {(detail.warnings ?? []).length ? (
        <ul className="runs-diagnostics__warnings">
          {(detail.warnings ?? []).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : (
        <p className="runs-diagnostics__muted">暂无诊断提醒。</p>
      )}
    </div>
  );
}

export function RunsIndexPage(): JSX.Element {
  const api = useApiClient();
  const [activeTab, setActiveTab] = useState<RunsTab>('library');
  const [query, setQuery] = useState('');
  const [permanentOnly, setPermanentOnly] = useState(false);
  const [showTemporary, setShowTemporary] = useState(true);
  const [runs, setRuns] = useState<ApiBacktestRunListItem[]>([]);
  const [virtualRuns, setVirtualRuns] = useState<ApiBacktestRunListItem[]>([]);
  const [strategies, setStrategies] = useState<ApiStrategyDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedStrategyIds, setExpandedStrategyIds] = useState<Set<string>>(() => new Set());
  const [expandedVersionIds, setExpandedVersionIds] = useState<Set<string>>(() => new Set());
  const [didPrimeExpansion, setDidPrimeExpansion] = useState(false);
  const autoPrimedVersionKeyRef = useRef<string | null>(null);
  const [hoveredTask, setHoveredTask] = useState<SmartEvidenceTask | null>(null);
  const [taskStates, setTaskStates] = useState<Record<string, TaskState>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ApiBacktestRunDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState>({ busy: false, error: null, run: null });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
        if (cancelled) {
          return;
        }
        const runItems = await api.listBacktestRuns({ limit: 200 }, controller.signal);
        if (cancelled) {
          return;
        }
        setRuns(runItems);
        setLoading(false);
        await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
        const strategyIds = [...new Set(runItems.map((run) => run.strategy_id))];
        const detailItems = await Promise.all(
          strategyIds.map(async (strategyId) => {
            try {
              return await api.getStrategyDetail(strategyId);
            } catch {
              return null;
            }
          }),
        );
        if (!cancelled) {
          setStrategies(detailItems.filter((item): item is ApiStrategyDetail => item !== null));
        }
      } catch (caught) {
        if (!cancelled && !isAbortError(caught)) {
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
      controller.abort();
    };
  }, [api]);

  const virtualRunIds = useMemo(() => new Set(virtualRuns.map((run) => run.id)), [virtualRuns]);
  const allRuns = useMemo(() => [...runs, ...virtualRuns], [runs, virtualRuns]);
  const unfilteredGroups = useMemo(() => buildStrategyEvidenceGroups(allRuns, strategies), [allRuns, strategies]);
  const visibleRuns = useMemo(
    () =>
      allRuns.filter((run) => {
        if ((permanentOnly || !showTemporary) && run.is_permanent === false) {
          return false;
        }
        return matchesRunQuery(run, query);
      }),
    [allRuns, permanentOnly, query, showTemporary],
  );
  const groups = useMemo(() => buildStrategyEvidenceGroups(visibleRuns, strategies), [visibleRuns, strategies]);
  const tasks = useMemo(() => buildSmartEvidenceTasks(unfilteredGroups), [unfilteredGroups]);
  const recentRuns = useMemo(
    () =>
      latestRuns(
        runs.filter((run) => {
          if ((permanentOnly || !showTemporary) && run.is_permanent === false) {
            return false;
          }
          return matchesRunQuery(run, query);
        }),
      ),
    [permanentOnly, query, runs, showTemporary],
  );
  const headingMetrics = useMemo(
    () => ({
      groups: unfilteredGroups.length,
      permanentRuns: runs.filter((run) => run.is_permanent !== false).length,
      tasks: tasks.length,
    }),
    [runs, tasks.length, unfilteredGroups.length],
  );

  useEffect(() => {
    if (groups.length === 0) {
      return;
    }
    const firstGroup = groups[0];
    const firstVersion = firstGroup.versions[0];
    const firstVersionKey = firstVersion ? versionKey(firstVersion.strategyId, firstVersion.id) : null;
    const shouldPrime =
      !didPrimeExpansion ||
      (strategies.length > 0 && Boolean(firstVersionKey) && autoPrimedVersionKeyRef.current !== firstVersionKey);
    if (!shouldPrime) {
      return;
    }
    setExpandedStrategyIds(new Set([firstGroup.strategyId]));
    setExpandedVersionIds(firstVersionKey ? new Set([firstVersionKey]) : new Set());
    autoPrimedVersionKeyRef.current = firstVersionKey;
    setDidPrimeExpansion(true);
  }, [didPrimeExpansion, groups, strategies.length]);

  function toggleStrategy(group: StrategyEvidenceGroup): void {
    setExpandedStrategyIds((current) => {
      const next = new Set(current);
      if (next.has(group.strategyId)) {
        next.delete(group.strategyId);
      } else {
        next.add(group.strategyId);
      }
      return next;
    });
  }

  function toggleVersion(version: VersionEvidenceNode): void {
    const key = versionKey(version.strategyId, version.id);
    setExpandedVersionIds((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function expandTaskTarget(task: SmartEvidenceTask): void {
    setExpandedStrategyIds((current) => new Set(current).add(task.strategyId));
    setExpandedVersionIds((current) => new Set(current).add(versionKey(task.strategyId, task.versionId)));
  }

  function updateTaskState(taskId: string, state: TaskState): void {
    setTaskStates((current) => ({
      ...current,
      [taskId]: state,
    }));
  }

  async function submitTask(task: SmartEvidenceTask): Promise<void> {
    const currentState = taskStates[task.id];
    if (currentState?.status === 'queued' || currentState?.status === 'running') {
      return;
    }
    expandTaskTarget(task);
    const virtualRunId = `virtual-${task.id}-${Date.now()}`;
    setVirtualRuns((current) => [...current, makeVirtualRun(task, virtualRunId)]);
    updateTaskState(task.id, { status: 'queued', virtualRunId });
    try {
      const sourceDetail = task.sourceRunId
        ? await api.getBacktestRunDetail(task.sourceRunId, { view: 'context' })
        : null;
      updateTaskState(task.id, { status: 'running', virtualRunId });
      const submitted = await api.submitBacktestRun(task.strategyId, taskPayload(task, sourceDetail));
      setVirtualRuns((current) => current.filter((run) => run.id !== virtualRunId));
      setRuns((current) => {
        const next = current.filter((run) => run.id !== submitted.id);
        return [detailToListItem(submitted, task), ...next];
      });
      updateTaskState(task.id, { status: 'done' });
    } catch (caught) {
      setVirtualRuns((current) => current.filter((run) => run.id !== virtualRunId));
      updateTaskState(task.id, {
        message: (caught as Error).message || '提交失败',
        status: 'error',
      });
    }
  }

  async function submitBatch(): Promise<void> {
    const pendingTasks = tasks.filter((task) => {
      const state = taskStates[task.id];
      return state?.status !== 'queued' && state?.status !== 'running' && state?.status !== 'done';
    });
    let cursor = 0;
    const workerCount = Math.min(2, pendingTasks.length);
    await Promise.all(
      Array.from({ length: workerCount }).map(async () => {
        while (cursor < pendingTasks.length) {
          const task = pendingTasks[cursor];
          cursor += 1;
          await submitTask(task);
        }
      }),
    );
  }

  async function selectRunById(runId: string): Promise<void> {
    setSelectedRunId(runId);
    setDetailError(null);
    if (virtualRunIds.has(runId)) {
      setSelectedDetail(null);
      return;
    }
    try {
      setDetailLoading(true);
      const detail = await api.getBacktestRunDetail(runId, { view: 'context' });
      setSelectedDetail(detail);
    } catch (caught) {
      setSelectedDetail(null);
      setDetailError((caught as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }

  function openRunDetail(runId: string): void {
    navigateTo(runDetailPath(runId));
  }

  async function confirmDeleteRun(): Promise<void> {
    const target = deleteState.run;
    if (!target) {
      return;
    }
    try {
      setDeleteState((current) => ({ ...current, busy: true, error: null }));
      await api.deleteBacktestRun(target.id);
      setRuns((current) => current.filter((run) => run.id !== target.id));
      if (selectedRunId === target.id) {
        setSelectedRunId(null);
        setSelectedDetail(null);
      }
      setDeleteState({ busy: false, error: null, run: null });
    } catch (caught) {
      setDeleteState((current) => ({
        ...current,
        busy: false,
        error: (caught as Error).message || '删除失败',
      }));
    }
  }

  return (
    <div className="runs-index-page" data-page-root="runs-index">
      <section className="runs-page-heading">
        <div>
          <p className="runs-eyebrow">{TEXT.headingEyebrow}</p>
          <h1>{TEXT.title}</h1>
          <p>{TEXT.copy}</p>
        </div>
        <div className="runs-heading-metrics" aria-label="回测历史摘要">
          <div className="runs-heading-chip">
            <span>策略组</span>
            <strong>{headingMetrics.groups}</strong>
          </div>
          <div className="runs-heading-chip">
            <span>永久回测</span>
            <strong>{headingMetrics.permanentRuns}</strong>
          </div>
          <div className="runs-heading-chip">
            <span>待补长周期</span>
            <strong>{headingMetrics.tasks}</strong>
          </div>
        </div>
      </section>

      <section className="runs-toolbar" aria-label="回测历史视图">
        <div className="runs-segmented" role="tablist" aria-label="回测历史视图">
          <button
            aria-selected={activeTab === 'library'}
            className={activeTab === 'library' ? 'is-active' : ''}
            onClick={() => setActiveTab('library')}
            role="tab"
            type="button"
          >
            {TEXT.libraryTab}
          </button>
          <button
            aria-selected={activeTab === 'recent'}
            className={activeTab === 'recent' ? 'is-active' : ''}
            onClick={() => setActiveTab('recent')}
            role="tab"
            type="button"
          >
            {TEXT.recentTab}
          </button>
        </div>
        <label className="runs-search">
          <input
            aria-label={TEXT.searchPlaceholder}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={TEXT.searchPlaceholder}
            type="search"
            value={query}
          />
        </label>
        <div className="runs-filter-row">
          <button
            aria-pressed={permanentOnly}
            className={permanentOnly ? 'runs-toggle is-on' : 'runs-toggle'}
            onClick={() => setPermanentOnly((current) => !current)}
            type="button"
          >
            <span>{TEXT.filterPermanent}</span>
            <span className="runs-switch" aria-hidden="true" />
          </button>
          <button
            aria-pressed={showTemporary}
            className={showTemporary ? 'runs-toggle is-on' : 'runs-toggle'}
            onClick={() => setShowTemporary((current) => !current)}
            type="button"
          >
            <span>{TEXT.filterTemporary}</span>
          </button>
        </div>
      </section>

      {loading ? <p className="empty-state">{TEXT.loading}</p> : null}
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {!loading && !error && runs.length === 0 ? <p className="empty-state">{TEXT.empty}</p> : null}

      {!loading && !error && runs.length > 0 ? (
        <div className="runs-layout runs-index-layout">
          <div className="runs-index-layout__main">
            {activeTab === 'library' ? (
              <section className="runs-library-panel runs-evidence-shell" aria-label={TEXT.libraryTab}>
                <div className="runs-evidence-board">
                  <div className="runs-panel-header runs-evidence-board__title">
                    <div>
                      <p className="runs-eyebrow">Strategy Library</p>
                      <h2>{TEXT.treeTitle}</h2>
                      <p>策略版本、周期覆盖与运行质量统一归档，支持审阅、下钻与证据补齐。</p>
                    </div>
                    <span className="runs-index-badge runs-index-badge--neutral">只读证据库</span>
                  </div>
                  <div className="runs-table-head runs-evidence-grid runs-evidence-grid--header" role="list" aria-label="证据树字段">
                    <span role="listitem">策略 / 版本 / 运行</span>
                    <span>年化收益</span>
                    <span>夏普</span>
                    <span>最大回撤</span>
                    <span>周期完整度</span>
                    <span>证据热力</span>
                  </div>
                  <div className="runs-tree" role="tree">
                    {groups.map((group) => (
                      <StrategyRow
                        expanded={expandedStrategyIds.has(group.strategyId)}
                        expandedVersionIds={expandedVersionIds}
                        group={group}
                        hoveredTask={hoveredTask}
                        key={group.strategyId}
                        onRunSelect={(run) => {
                          if (virtualRunIds.has(run.id)) {
                            void selectRunById(run.id);
                            return;
                          }
                          openRunDetail(run.id);
                        }}
                        onToggle={toggleStrategy}
                        onVersionToggle={toggleVersion}
                        selectedRunId={selectedRunId}
                        virtualRunIds={virtualRunIds}
                      />
                    ))}
                  </div>
                </div>
              </section>
            ) : (
              <section className="runs-recent-panel runs-recent-list" aria-label={TEXT.recentTab}>
                <div className="runs-panel-header">
                  <div>
                    <p className="runs-eyebrow">Recent Runs</p>
                    <h2>{TEXT.recentTitle}</h2>
                    <p>按完成时间记录最新回测，保留审计与复核入口。</p>
                  </div>
                </div>
                <div className="runs-recent-table" role="table" aria-label="最近运行表">
                  <div className="runs-recent-grid runs-recent-grid--header header" role="row">
                    <div role="columnheader">回测号</div>
                    <div role="columnheader">策略</div>
                    <div role="columnheader">类型</div>
                    <div role="columnheader">状态</div>
                    <div role="columnheader">夏普</div>
                    <div role="columnheader">完成时间</div>
                    <div role="columnheader">操作</div>
                  </div>
                {recentRuns.map((run) => (
                  <RecentRunRow
                    key={run.id}
                    onDelete={(candidate) => setDeleteState({ busy: false, error: null, run: candidate })}
                    onSelect={(runId) => {
                      openRunDetail(runId);
                    }}
                    run={run}
                    selected={selectedRunId === run.id}
                  />
                ))}
                </div>
              </section>
            )}
          </div>

          <aside className="runs-rail-panel runs-index-side">
            <section className="runs-rail-section runs-side-section" aria-label={TEXT.smartTasks}>
              <div className="smart-toolbar runs-side-section__header">
                <h3>{TEXT.smartTasks}</h3>
                <button className="action-button action-button--ghost runs-side-batch" disabled={!tasks.length} onClick={() => void submitBatch()} type="button">
                  {TEXT.batchFill}
                </button>
              </div>
              <div className="runs-smart-task-list">
                {tasks.length ? (
                  tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      onHover={setHoveredTask}
                      onSubmit={(candidate) => {
                        void submitTask(candidate);
                      }}
                      state={taskStates[task.id]}
                      task={task}
                    />
                  ))
                ) : (
                  <p className="runs-side-empty">{TEXT.noTasks}</p>
                )}
              </div>
            </section>

            <section className="runs-rail-section runs-side-section" aria-label={TEXT.diagnostics}>
              <div className="runs-side-section__header">
                <h3>{TEXT.diagnostics}</h3>
              </div>
              <DiagnosticsPanel
                detail={selectedDetail}
                detailError={detailError}
                loading={detailLoading}
                selectedRunId={selectedRunId}
              />
            </section>

            <section className="runs-rail-section runs-side-section" aria-label="证据状态">
              <div className="status-legend runs-status-legend">
                <span className="legend-item runs-index-badge runs-index-badge--success">✓ 路径成熟</span>
                <span className="legend-item runs-index-badge runs-index-badge--warning">⚠ 存在漂移</span>
                <span className="legend-item runs-index-badge runs-index-badge--danger">× 证据断裂</span>
              </div>
            </section>
          </aside>
        </div>
      ) : null}

      {deleteState.run ? (
        <div className="runs-delete-modal" role="dialog" aria-modal="true" aria-labelledby="runs-delete-title">
          <div className="runs-delete-card">
            <p className="runs-eyebrow">Backtest Run</p>
            <h2 id="runs-delete-title">{TEXT.deleteTitle}</h2>
            <p>
              确认删除 {deleteState.run.id}。记录将从最近运行列表移除，后端保留审计结果。
            </p>
            {deleteState.error ? <p className="runs-diagnostics__error">{deleteState.error}</p> : null}
            <div className="runs-delete-actions">
              <button
                className="text-button"
                disabled={deleteState.busy}
                onClick={() => setDeleteState({ busy: false, error: null, run: null })}
                type="button"
              >
                取消
              </button>
              <button
                className="action-button action-button--danger"
                disabled={deleteState.busy}
                onClick={() => void confirmDeleteRun()}
                type="button"
              >
                {TEXT.deleteConfirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
