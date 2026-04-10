import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { collectOptimizationParameterSeeds } from '../lib/optimization-config-fields';
import {
  buildOptimizationConfigPath,
  buildOptimizationJobsPath,
  buildOptimizationSelectPath,
} from '../lib/optimization-routes';
import type {
  ApiBacktestRunDetail,
  ApiOptimizationCandidate,
  ApiOptimizationJobCreatePayload,
  ApiOptimizationJobDetail,
  ApiOptimizationJobListItem,
  ApiOptimizationSearchSpaceField,
  ApiStrategyDetail,
  ApiStrategyListItem,
  ParameterValue,
} from '../types';
import './optimization-lab-page.css';

type StepKey = 'select' | 'config' | 'results';
const OPTIMIZATION_POLL_INTERVAL_MS = import.meta.env.MODE === 'test' ? 50 : 1200;

const TEXT = {
  jobsTitle: '优化任务列表',
  jobsCopy: '默认入口，先看任务再决定下一步。',
  jobsLoading: '正在加载优化任务...',
  jobsEmpty: '暂无优化任务，先创建一条新的优化任务。',
  createJob: '创建优化任务',
  backToJobs: '返回任务列表',
  selectTitle: '先决定要优化哪条策略',
  selectCopy: '保持列表式浏览，选中策略后直接进入参数配置。',
  configTitle: '参数配置',
  configCopy: '确认搜索边界、验证方式和预算，然后启动优化。',
  resultsTitle: '结果中心',
  resultsCopy: '回看候选版本、稳定性和参数热区。',
  continueTune: '继续调参',
  promoteVersion: '晋升当前版本',
  resetPreset: '恢复预设',
  startOptimization: '启动优化',
  selectStrategy: '选择策略',
  selectedStrategy: '已选择',
  candidatePanel: '参数候选盘',
  stabilityCenter: '稳定策略中心',
  heatmapPanel: '参数热区',
  validationPanel: '多窗口验证',
  candidateShelf: '快速切换候选版本',
} as const;

function humanizeKey(key: string): string {
  const labels: Record<string, string> = {
    lookback_months: '观察窗口',
    lookback_days: '观察窗口',
    top_n: '持仓数量',
    max_position_pct: '最大仓位',
    skip_recent_months: '偏移月份',
    weighting_method: '加权方式',
    hold_rank_threshold: '持有阈值',
    grid_interval: '网格间距',
  };
  return labels[key] ?? key.replace(/_/g, ' ');
}

function formatParameterValue(value: ParameterValue | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  return String(value);
}

function formatEditableParameterValue(value: ParameterValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

function formatOptimizationStatus(status: string): string {
  switch (status.toUpperCase()) {
    case 'QUEUED':
      return '待启动';
    case 'RUNNING':
      return '运行中';
    case 'COMPLETED':
      return '已完成';
    case 'PARTIALLY_FAILED':
      return '部分完成';
    case 'FAILED':
      return '失败';
    default:
      return status;
  }
}

function formatEntryPoint(value?: string | null): string {
  switch ((value ?? '').toLowerCase()) {
    case 'run_detail':
      return '回测详情';
    case 'strategy_detail':
      return '策略详情';
    default:
      return '菜单创建';
  }
}

function formatValidationMode(value?: string | null): string {
  switch ((value ?? '').toLowerCase()) {
    case 'single_oos':
      return '单次样本外';
    case 'walk_forward':
    default:
      return 'Walk Forward';
  }
}

function formatUpdatedAt(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-HK', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function formatMetric(value: number | undefined, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return value.toFixed(digits);
}

function formatPercentMetric(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

type OptimizationParameterEntry = {
  key: string;
  label: string;
  value: string;
};

function getOptimizationSearchSpace(job: ApiOptimizationJobDetail | null | undefined): ApiOptimizationSearchSpaceField[] {
  const requestFields = Array.isArray(job?.request?.search_space) ? job?.request?.search_space : [];
  const summaryFields = Array.isArray(job?.summary?.search_space) ? job?.summary?.search_space : [];
  return (requestFields?.length ? requestFields : summaryFields ?? []) as ApiOptimizationSearchSpaceField[];
}

function getOptimizationRangeLabel(field: ApiOptimizationSearchSpaceField): string {
  const compactLabels: Record<string, string> = {
    lookback_months: '回看(月)',
    lookback_days: '回看(日)',
    skip_recent_months: '跳过最近(月)',
    top_n: '买入排名阈值',
    hold_rank_threshold: '保留排名阈值',
    max_position_pct: '单票仓位(%)',
    grid_interval: '网格间距(%)',
  };
  return compactLabels[field.key] ?? field.label;
}

function buildOptimizationRangeSummary(fields: ApiOptimizationSearchSpaceField[]): string | null {
  const rangedFields = fields.filter((field) => field.mode === 'range');
  if (!rangedFields.length) {
    return null;
  }
  return rangedFields
    .map(
      (field) =>
        `${getOptimizationRangeLabel(field)}${formatEditableParameterValue(field.start)}-${formatEditableParameterValue(field.end)}`,
    )
    .join('；');
}

function buildCandidateParameterEntries(
  snapshot: Record<string, ParameterValue> | undefined,
  fields: ApiOptimizationSearchSpaceField[],
): OptimizationParameterEntry[] {
  if (!fields.length) {
    return Object.entries(snapshot ?? {}).slice(0, 4).map(([key, value]) => ({
      key,
      label: humanizeKey(key),
      value: formatParameterValue(value),
    }));
  }
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    value: formatParameterValue(snapshot?.[field.key] ?? field.value ?? field.current),
  }));
}

function buildCandidateParameterSummary(
  snapshot: Record<string, ParameterValue> | undefined,
  fields: ApiOptimizationSearchSpaceField[],
): string {
  return buildCandidateParameterEntries(snapshot, fields)
    .map((entry) => `${entry.label} ${entry.value}`)
    .join('；');
}

function buildRangeParameterEntries(
  snapshot: Record<string, ParameterValue> | undefined,
  fields: ApiOptimizationSearchSpaceField[],
): OptimizationParameterEntry[] {
  const rangedFields = fields.filter((field) => field.mode === 'range');
  if (!rangedFields.length) {
    return [];
  }
  return rangedFields.map((field) => ({
    key: field.key,
    label: field.label,
    value: formatParameterValue(snapshot?.[field.key] ?? field.value ?? field.current),
  }));
}

function readProgressText(source: Record<string, unknown> | undefined, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readProgressNumber(source: Record<string, unknown> | undefined, key: string, fallback = 0): number {
  const value = source?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function isOptimizationInFlight(status?: string | null): boolean {
  return ['QUEUED', 'RUNNING'].includes(String(status ?? '').toUpperCase());
}

function getCandidateMetric(candidate: ApiOptimizationCandidate, key: string): number | undefined {
  const value = candidate.metrics?.[key];
  return typeof value === 'number' ? value : undefined;
}

function cloneSearchSpace(fields: ApiOptimizationSearchSpaceField[]): ApiOptimizationSearchSpaceField[] {
  return fields.map((field) => ({ ...field }));
}

function asFiniteNumber(value: ParameterValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function getLockedFieldValue(field: ApiOptimizationSearchSpaceField): ParameterValue {
  return field.current ?? field.value ?? field.start ?? field.end ?? null;
}

function getDefaultFieldStep(value: ParameterValue): ParameterValue {
  const numericValue = asFiniteNumber(value);
  if (numericValue === null) {
    return 1;
  }
  return Number.isInteger(numericValue) ? 1 : 0.5;
}

function normalizeSearchField(field: ApiOptimizationSearchSpaceField): ApiOptimizationSearchSpaceField {
  if (field.mode !== 'fixed') {
    return {
      ...field,
      value: field.value ?? getLockedFieldValue(field),
    };
  }

  const lockedValue = getLockedFieldValue(field);
  return {
    ...field,
    mode: 'fixed',
    value: lockedValue,
    start: lockedValue,
    end: lockedValue,
    step: getDefaultFieldStep(lockedValue),
  };
}

function countSearchFieldCombinations(field: ApiOptimizationSearchSpaceField): number {
  if (field.mode === 'fixed') {
    return 1;
  }

  const start = asFiniteNumber(field.start);
  const end = asFiniteNumber(field.end);
  const step = asFiniteNumber(field.step);
  if (start === null || end === null || step === null || step === 0) {
    return 1;
  }

  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const stride = Math.abs(step);
  const decimals = [min, max, stride].reduce((maxDigits, value) => {
    const fraction = value.toString().split('.')[1];
    return Math.max(maxDigits, fraction?.length ?? 0);
  }, 0);
  const scale = 10 ** decimals;
  const scaledRange = Math.round((max - min) * scale);
  const scaledStride = Math.round(stride * scale);
  if (scaledStride <= 0) {
    return 1;
  }

  return Math.max(Math.floor(scaledRange / scaledStride) + 1, 1);
}

function calculateBudgetCombinations(fields: ApiOptimizationSearchSpaceField[]): number {
  if (!fields.length) {
    return 0;
  }
  return fields.reduce((total, field) => total * countSearchFieldCombinations(field), 1);
}

function buildConfiguredSearchField(
  field: ReturnType<typeof collectOptimizationParameterSeeds>[number],
  index: number,
): ApiOptimizationSearchSpaceField {
  const numericValue = asFiniteNumber(field.value);
  if (numericValue === null) {
    return normalizeSearchField({
      key: field.key,
      label: field.label,
      mode: 'fixed',
      current: field.value,
      value: field.value,
      start: field.value,
      end: field.value,
      step: 1,
      tag: '选股规则',
    });
  }

  const step = Number.isInteger(numericValue) ? 1 : 0.5;
  return normalizeSearchField({
    key: field.key,
    label: field.label,
    mode: 'range',
    current: numericValue,
    start: Math.max(1, numericValue - (index + 2) * step),
    end: numericValue + (index + 2) * step,
    step,
    tag: '选股规则',
  });
}

function buildDefaultSearchSpace(
  strategy: ApiStrategyDetail,
  parameterSnapshot?: Record<string, ParameterValue> | null,
): ApiOptimizationSearchSpaceField[] {
  const configuredFields = collectOptimizationParameterSeeds(strategy, parameterSnapshot);
  if (configuredFields.length) {
    return configuredFields.map((field, index) => buildConfiguredSearchField(field, index));
  }

  const parameters = Object.entries(strategy.parameters ?? {});
  const numericEntries = parameters.filter(([, value]) => typeof value === 'number').slice(0, 2);
  const fixedEntries = parameters
    .filter(([key]) => !numericEntries.some(([numericKey]) => numericKey === key))
    .slice(0, 2);
  const fields: ApiOptimizationSearchSpaceField[] = numericEntries.map(([key, value], index) => {
    const numericValue = Number(value);
    const step = Number.isInteger(numericValue) ? 1 : 0.5;
    return {
      key,
      label: humanizeKey(key),
      mode: 'range',
      current: numericValue,
      start: Math.max(1, numericValue - (index + 2) * step),
      end: numericValue + (index + 2) * step,
      step,
      tag: index === 0 ? '核心参数' : '验证参数',
    };
  });
  fixedEntries.forEach(([key, value]) => {
    fields.push({
      key,
      label: humanizeKey(key),
      mode: 'fixed',
      current: value,
      value,
      start: value,
      end: value,
      step: 1,
      tag: '当前固定',
    });
  });
  return fields.map(normalizeSearchField);
}

function buildStrategyMetricsMap(runDetails: Record<string, ApiBacktestRunDetail>) {
  return Object.fromEntries(
    Object.entries(runDetails).map(([runId, runDetail]) => [
      runId,
      {
        sharpe: typeof runDetail.metrics?.sharpe === 'number' ? runDetail.metrics.sharpe : undefined,
        totalReturn: typeof runDetail.metrics?.total_return === 'number' ? runDetail.metrics.total_return * 100 : undefined,
        maxDrawdown:
          typeof runDetail.metrics?.max_drawdown === 'number' ? runDetail.metrics.max_drawdown * 100 : undefined,
      },
    ]),
  );
}

function OptimizationStepBar({
  current,
  selectHref,
  configHref,
}: {
  current: StepKey;
  selectHref?: string;
  configHref?: string;
}): JSX.Element {
  const steps = [
    { key: 'select', title: '选择策略', description: '菜单创建时先选策略，再进入参数配置。', href: selectHref },
    { key: 'config', title: '参数配置', description: '确认搜索边界与验证方式，然后启动优化。', href: configHref },
    { key: 'results', title: '结果中心', description: '回看候选版本、稳定性和参数热区。' },
  ] as const;

  function isCompleted(step: typeof steps[number]): boolean {
    return (current === 'config' && step.key === 'select') || current === 'results';
  }

  return (
    <section className="optimization-steps" aria-label="优化步骤">
      {steps.map((step) => {
        const active = current === step.key;
        const completed = isCompleted(step);
        const disabled = !active && !completed;
        const className = [
          'optimization-step',
          active ? 'optimization-step--active' : '',
          completed ? 'optimization-step--completed' : '',
          disabled ? 'optimization-step--disabled' : '',
        ]
          .filter(Boolean)
          .join(' ');

        if ((active || completed) && step.href) {
          return (
            <button className={className} key={step.key} onClick={() => navigateTo(step.href!)} type="button">
              <strong>{step.title}</strong>
              <span>{step.description}</span>
            </button>
          );
        }

        return (
          <div aria-disabled={disabled} className={className} key={step.key}>
            <strong>{step.title}</strong>
            <span>{step.description}</span>
          </div>
        );
      })}
    </section>
  );
}

export function OptimizationJobsIndexPage(): JSX.Element {
  const api = useApiClient();
  const [jobs, setJobs] = useState<ApiOptimizationJobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const payload = await api.listOptimizationJobs();
        if (!cancelled) {
          setJobs(payload);
        }
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

  return (
    <div className="optimization-lab-page">
      <section className="optimization-lab-panel optimization-lab-panel--header">
        <div>
          <h1>{TEXT.jobsTitle}</h1>
          <p>{TEXT.jobsCopy}</p>
        </div>
        <button className="primary-button" onClick={() => navigateTo(buildOptimizationSelectPath())} type="button">
          {TEXT.createJob}
        </button>
      </section>

      {loading ? <p className="empty-state">{TEXT.jobsLoading}</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {!loading && !error && !jobs.length ? <p className="empty-state">{TEXT.jobsEmpty}</p> : null}

      {!loading && jobs.length ? (
        <section className="optimization-lab-panel">
          <div className="optimization-lab-table-shell">
            <table className="optimization-lab-table">
              <thead>
                <tr>
                  <th>任务号</th>
                  <th>策略</th>
                  <th>入口</th>
                  <th>验证</th>
                  <th>预算</th>
                  <th>当前首选</th>
                  <th>状态</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <button className="optimization-link" onClick={() => navigateTo(`/optimization-jobs/${job.id}`)} type="button">
                        {job.id}
                      </button>
                    </td>
                    <td>{job.strategy_name ?? job.strategy_id}</td>
                    <td>{formatEntryPoint(job.entry_point)}</td>
                    <td>{formatValidationMode(job.validation_mode)}</td>
                    <td>
                      {job.completed_combinations ?? 0} / {job.budget_combinations ?? 0}
                    </td>
                    <td>{job.best_candidate_label ?? '-'}</td>
                    <td>{formatOptimizationStatus(job.status)}</td>
                    <td>{formatUpdatedAt(job.updated_at ?? job.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function OptimizationStrategySelectPage({
  strategyId,
  sourceRunId,
  entryPoint,
}: {
  strategyId?: string;
  sourceRunId?: string;
  entryPoint?: string;
}): JSX.Element {
  const api = useApiClient();
  const [strategies, setStrategies] = useState<ApiStrategyListItem[]>([]);
  const [runDetails, setRunDetails] = useState<Record<string, ApiBacktestRunDetail>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const payload = await api.listStrategies();
        const latestRunIds = payload
          .map((item) => item.latest_successful_run_id ?? item.latest_run_id)
          .filter((value): value is string => Boolean(value));
        const runEntries = await Promise.all(
          [...new Set(latestRunIds)].map(async (runId) => [runId, await api.getBacktestRunDetail(runId)] as const),
        );
        if (!cancelled) {
          setStrategies(payload);
          setRunDetails(Object.fromEntries(runEntries));
        }
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

  const metricsByRunId = useMemo(() => buildStrategyMetricsMap(runDetails), [runDetails]);

  return (
    <div className="optimization-lab-page">
      <OptimizationStepBar current="select" />

      <section className="optimization-lab-panel optimization-lab-panel--hero">
        <div>
          <p className="optimization-lab-eyebrow">第一步 · 选择策略</p>
          <h1>{TEXT.selectTitle}</h1>
          <p>{TEXT.selectCopy}</p>
        </div>
        <button className="ghost-button" onClick={() => navigateTo(buildOptimizationJobsPath())} type="button">
          {TEXT.backToJobs}
        </button>
      </section>

      {loading ? <p className="empty-state">正在加载策略列表...</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {!loading && strategies.length ? (
        <section className="optimization-lab-panel">
          <div className="optimization-lab-panel__heading">
            <div>
              <p className="optimization-lab-eyebrow">策略列表</p>
              <h2>{TEXT.selectStrategy}</h2>
            </div>
          </div>
          <div className="optimization-lab-table-shell">
            <table className="optimization-lab-table">
              <thead>
                <tr>
                  <th>策略</th>
                  <th>当前版本</th>
                  <th>最近回测</th>
                  <th>夏普</th>
                  <th>回撤</th>
                  <th>样本外</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((strategy) => {
                  const latestRunId = strategy.latest_successful_run_id ?? strategy.latest_run_id ?? null;
                  const metrics = latestRunId ? metricsByRunId[latestRunId] : undefined;
                  const selected = strategyId === strategy.id;
                  return (
                    <tr className={selected ? 'optimization-lab-table__row--selected' : ''} key={strategy.id}>
                      <td>
                        <div className="optimization-lab-table__stack">
                          <strong>{strategy.name}</strong>
                          <span>{strategy.universe_name}</span>
                        </div>
                      </td>
                      <td>{strategy.current_parameter_version_id ?? '-'}</td>
                      <td>{latestRunId ?? '-'}</td>
                      <td>{formatMetric(metrics?.sharpe)}</td>
                      <td>{formatPercentMetric(metrics?.maxDrawdown)}</td>
                      <td>{formatPercentMetric(metrics?.totalReturn)}</td>
                      <td>
                        <button
                          className={selected ? 'ghost-button' : 'primary-button'}
                          onClick={() =>
                            navigateTo(
                              buildOptimizationConfigPath({
                                strategyId: strategy.id,
                                sourceRunId,
                                entryPoint: entryPoint ?? 'lab_menu',
                              }),
                            )
                          }
                          type="button"
                        >
                          {selected ? TEXT.selectedStrategy : TEXT.selectStrategy}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function OptimizationConfigPage({
  strategyId,
  sourceRunId,
  entryPoint,
}: {
  strategyId: string;
  sourceRunId?: string;
  entryPoint?: string;
}): JSX.Element {
  const api = useApiClient();
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [sourceRun, setSourceRun] = useState<ApiBacktestRunDetail | null>(null);
  const [validationMode, setValidationMode] = useState<'walk_forward' | 'single_oos'>('walk_forward');
  const [searchSpace, setSearchSpace] = useState<ApiOptimizationSearchSpaceField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const strategyPayload = await api.getStrategyDetail(strategyId);
        const runPayload = sourceRunId ? await api.getBacktestRunDetail(sourceRunId) : null;
        if (!cancelled) {
          setStrategy(strategyPayload);
          setSourceRun(runPayload);
          setValidationMode('walk_forward');
          setSearchSpace(buildDefaultSearchSpace(strategyPayload, runPayload?.parameter_snapshot));
        }
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
  }, [api, sourceRunId, strategyId]);

  const selectHref = buildOptimizationSelectPath({
    strategyId,
    sourceRunId,
    entryPoint,
  });
  const budgetCombinations = useMemo(() => calculateBudgetCombinations(searchSpace), [searchSpace]);

  async function handleStartOptimization(): Promise<void> {
    if (!strategy) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const payload: ApiOptimizationJobCreatePayload = {
        objective: 'sharpe',
        base_parameter_version_id: strategy.current_parameter_version_id ?? null,
        source_run_id: sourceRunId ?? null,
        entry_point: entryPoint ?? (sourceRunId ? 'run_detail' : 'lab_menu'),
        validation_mode: validationMode,
        budget_combinations: budgetCombinations,
        search_space: cloneSearchSpace(searchSpace),
      };
      const created = await api.createOptimizationJob(strategy.id, payload);
      navigateTo(`/optimization-jobs/${created.id}`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function resetPreset(): void {
    if (!strategy) {
      return;
    }
    setValidationMode('walk_forward');
    setSearchSpace(buildDefaultSearchSpace(strategy, sourceRun?.parameter_snapshot));
  }

  function updateSearchField(index: number, patch: Partial<ApiOptimizationSearchSpaceField>): void {
    setSearchSpace((current) =>
      current.map((field, fieldIndex) =>
        fieldIndex === index ? normalizeSearchField({ ...field, ...patch }) : field,
      ),
    );
  }

  return (
    <div className="optimization-lab-page">
      <OptimizationStepBar current="config" selectHref={selectHref} />

      <section className="optimization-lab-panel optimization-lab-panel--hero">
        <div>
          <p className="optimization-lab-eyebrow">第二步 · 参数配置</p>
          <h1>{strategy?.name ?? TEXT.configTitle}</h1>
          <p>{TEXT.configCopy}</p>
          {!loading && strategy ? (
            <div className="optimization-meta-chips">
              <span className="status-chip status-chip--soft">入口：{formatEntryPoint(entryPoint)}</span>
              <span className="status-chip status-chip--soft">参数版本：{strategy.current_parameter_version_id ?? '-'}</span>
              <span className="status-chip status-chip--soft">预计组合：{budgetCombinations} 组</span>
              {sourceRun ? <span className="status-chip status-chip--soft">来源回测：{sourceRun.id}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="optimization-hero-actions optimization-hero-actions--single-row">
          <button className="ghost-button" onClick={() => navigateTo(buildOptimizationJobsPath())} type="button">
            {TEXT.backToJobs}
          </button>
          <button className="ghost-button" onClick={resetPreset} type="button">
            {TEXT.resetPreset}
          </button>
          <button className="primary-button" disabled={saving || loading} onClick={() => void handleStartOptimization()} type="button">
            {TEXT.startOptimization}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <p className="empty-state">正在加载参数配置...</p> : null}

      {!loading && strategy ? (
        <div className="optimization-config-grid">
          <section className="optimization-lab-panel">
            <div className="optimization-lab-panel__heading">
              <div>
                <p className="optimization-lab-eyebrow">搜索边界</p>
                <h2>{TEXT.configTitle}</h2>
              </div>
            </div>
            <div className="optimization-form-stack">
              <label className="optimization-form-field">
                <span>验证方式</span>
                <select value={validationMode} onChange={(event) => setValidationMode(event.target.value as 'walk_forward' | 'single_oos')}>
                  <option value="walk_forward">Walk Forward / 多窗口验证</option>
                  <option value="single_oos">单次样本外验证</option>
                </select>
              </label>

              <label className="optimization-form-field">
                <span>预算组合</span>
                <input
                  aria-label="预算组合"
                  readOnly
                  type="number"
                  value={budgetCombinations}
                />
              </label>
            </div>

            <div className="optimization-lab-table-shell optimization-lab-table-shell--form">
              <table className="optimization-lab-table">
                <thead>
                  <tr>
                    <th>参数</th>
                    <th>当前值</th>
                    <th>模式</th>
                    <th>起点</th>
                    <th>终点</th>
                    <th>步长</th>
                    <th>标签</th>
                  </tr>
                </thead>
                <tbody>
                  {searchSpace.map((field, index) => (
                    <tr key={field.key}>
                      <td>{field.label}</td>
                      <td>{formatParameterValue(field.current)}</td>
                      <td>
                        <select
                          aria-label={`${field.label} 模式`}
                          value={field.mode}
                          onChange={(event) => updateSearchField(index, { mode: event.target.value as 'range' | 'fixed' })}
                        >
                          <option value="range">范围</option>
                          <option value="fixed">固定</option>
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`${field.label} 起点`}
                          disabled={field.mode === 'fixed'}
                          onChange={(event) => updateSearchField(index, { start: event.target.value })}
                          value={formatEditableParameterValue(field.start)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${field.label} 终点`}
                          disabled={field.mode === 'fixed'}
                          onChange={(event) => updateSearchField(index, { end: event.target.value })}
                          value={formatEditableParameterValue(field.end)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${field.label} 步长`}
                          disabled={field.mode === 'fixed'}
                          onChange={(event) => updateSearchField(index, { step: event.target.value })}
                          value={formatEditableParameterValue(field.step)}
                        />
                      </td>
                      <td>{field.tag ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function OptimizationResultsPage({ jobId }: { jobId: string }): JSX.Element {
  const api = useApiClient();
  const [job, setJob] = useState<ApiOptimizationJobDetail | null>(null);
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const jobPayload = await api.getOptimizationJobDetail(jobId);
        const strategyPayload = await api.getStrategyDetail(jobPayload.strategy_id);
        if (!cancelled) {
          setJob(jobPayload);
          setStrategy(strategyPayload);
          setSelectedCandidateId(jobPayload.result.best_candidate_id ?? jobPayload.candidates[0]?.id ?? null);
        }
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
  }, [api, jobId]);

  useEffect(() => {
    if (!job || !isOptimizationInFlight(job.status)) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const jobPayload = await api.getOptimizationJobDetail(jobId);
          if (!cancelled) {
            setJob(jobPayload);
          }
        } catch (caught) {
          if (!cancelled) {
            setError((caught as Error).message);
          }
        }
      })();
    }, OPTIMIZATION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, job, jobId]);

  useEffect(() => {
    if (!job) {
      return;
    }
    const fallbackCandidateId = job.result.best_candidate_id ?? job.candidates[0]?.id ?? null;
    if (!selectedCandidateId || !job.candidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(fallbackCandidateId);
    }
  }, [job, selectedCandidateId]);

  const selectedCandidate = useMemo(
    () => job?.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? job?.candidates[0] ?? null,
    [job, selectedCandidateId],
  );
  const optimizationSearchSpace = useMemo(() => getOptimizationSearchSpace(job), [job]);
  const optimizationRangeSummary = useMemo(
    () => buildOptimizationRangeSummary(optimizationSearchSpace),
    [optimizationSearchSpace],
  );
  const selectedCandidateParameters = useMemo(
    () => buildCandidateParameterEntries(selectedCandidate?.parameter_snapshot, optimizationSearchSpace),
    [optimizationSearchSpace, selectedCandidate],
  );
  const optimizationInFlight = isOptimizationInFlight(job?.status);
  const progressSummary = (job?.summary ?? {}) as Record<string, unknown>;
  const progressResult = (job?.result ?? {}) as Record<string, unknown>;
  const progressPct = readProgressNumber(progressSummary, 'progress_pct', optimizationInFlight ? 0 : 100);
  const completedCombinations = readProgressNumber(progressSummary, 'completed_combinations', 0);
  const budgetCombinations = readProgressNumber(progressSummary, 'budget_combinations', 0);
  const currentStage =
    readProgressText(progressSummary, 'current_stage') ??
    readProgressText(progressResult, 'current_stage') ??
    (optimizationInFlight ? '等待执行' : '结果就绪');
  const latestUpdate =
    readProgressText(progressSummary, 'latest_update') ??
    readProgressText(progressResult, 'latest_update') ??
    (optimizationInFlight ? '正在生成首轮候选。' : job?.result.summary ?? TEXT.resultsCopy);
  const latestCandidateLabel =
    readProgressText(progressSummary, 'latest_candidate_label') ??
    job?.result.best_candidate_label ??
    selectedCandidate?.label ??
    null;
  const strategyDisplayName = strategy?.name ?? job?.strategy_id ?? TEXT.resultsTitle;
  const heroTitle = `参数优化：${strategyDisplayName}`;
  const heroCopy =
    optimizationRangeSummary ??
    (optimizationInFlight ? latestUpdate : selectedCandidate?.analysis?.thesis ?? job?.result.summary ?? TEXT.resultsCopy);

  const selectHref = buildOptimizationSelectPath({
    strategyId: job?.strategy_id,
    sourceRunId: typeof job?.request.source_run_id === 'string' ? job.request.source_run_id : undefined,
    entryPoint: typeof job?.request.entry_point === 'string' ? job.request.entry_point : undefined,
  });
  const configHref = buildOptimizationConfigPath({
    strategyId: job?.strategy_id ?? '',
    sourceRunId: typeof job?.request.source_run_id === 'string' ? job.request.source_run_id : undefined,
    entryPoint: typeof job?.request.entry_point === 'string' ? job.request.entry_point : undefined,
  });

  async function handlePromote(): Promise<void> {
    if (!job || !selectedCandidate) {
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await api.promoteOptimizationCandidate(
        job.id,
        selectedCandidate.id,
        'set_current',
        `promote-${selectedCandidate.id}`,
        '从优化实验室晋升当前版本',
      );
      setNotice('已完成版本晋升。');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="optimization-lab-page">
      <OptimizationStepBar current="results" selectHref={selectHref} configHref={job ? configHref : undefined} />

      <section className="optimization-lab-panel optimization-lab-panel--hero">
        <div>
          <p className="optimization-lab-eyebrow">任务结果中心</p>
          <h1>{heroTitle}</h1>
          <p>{heroCopy}</p>
          {job ? (
            <div className="optimization-meta-chips">
              <span className="status-chip status-chip--soft">任务编号：{job.id}</span>
            </div>
          ) : null}
          {notice ? <p className="optimization-inline-notice">{notice}</p> : null}
        </div>
        <div className="optimization-hero-actions optimization-hero-actions--single-row">
          <button className="ghost-button" onClick={() => navigateTo(buildOptimizationJobsPath())} type="button">
            {TEXT.backToJobs}
          </button>
          <button className="ghost-button" disabled={!job} onClick={() => navigateTo(configHref)} type="button">
            {TEXT.continueTune}
          </button>
          <button className="primary-button" disabled={saving || !selectedCandidate || optimizationInFlight} onClick={() => void handlePromote()} type="button">
            {TEXT.promoteVersion}
          </button>
        </div>
      </section>

      {loading ? <p className="empty-state">正在加载结果中心...</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {!loading && job ? (
        <>
          {optimizationInFlight ? (
            <section className="optimization-lab-panel optimization-progress-panel">
              <div className="optimization-lab-panel__heading">
                <div>
                  <p className="optimization-lab-eyebrow">实时进度</p>
                  <h2>优化进行中</h2>
                </div>
                <span className="status-chip status-chip--soft">{formatOptimizationStatus(job.status)}</span>
              </div>
              <div className="optimization-metric-row">
                <article className="optimization-metric-tile">
                  <span>当前阶段</span>
                  <strong>{currentStage}</strong>
                </article>
                <article className="optimization-metric-tile">
                  <span>已完成组合</span>
                  <strong>{budgetCombinations ? `${completedCombinations} / ${budgetCombinations}` : `${completedCombinations}`}</strong>
                </article>
                <article className="optimization-metric-tile">
                  <span>整体进度</span>
                  <strong>{Math.min(progressPct, 100)}%</strong>
                </article>
                <article className="optimization-metric-tile">
                  <span>当前首选</span>
                  <strong>{latestCandidateLabel ?? '首轮候选生成中'}</strong>
                </article>
              </div>
              <div className="optimization-summary-list">
                <div className="optimization-summary-row">
                  <span>最新进展</span>
                  <strong>{latestUpdate}</strong>
                </div>
                <div className="optimization-summary-row">
                  <span>最近刷新</span>
                  <strong>{formatUpdatedAt(job.updated_at)}</strong>
                </div>
              </div>
            </section>
          ) : null}

          {job.candidates.length && selectedCandidate ? (
            <>
              <div className="optimization-results-grid">
            <section className="optimization-lab-panel optimization-results-card">
              <div className="optimization-lab-panel__heading">
                <div>
                  <p className="optimization-lab-eyebrow">{TEXT.candidatePanel}</p>
                  <h2>{TEXT.candidatePanel}</h2>
                </div>
              </div>
              <div className="optimization-lab-table-shell">
                <table className="optimization-lab-table">
                  <thead>
                    <tr>
                      <th>排名</th>
                      <th>候选</th>
                      <th>参数值</th>
                      <th>收益夏普</th>
                      <th>样本外夏普</th>
                      <th>最大回撤</th>
                      <th>稳定性</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.candidates.map((candidate) => {
                      const active = candidate.id === selectedCandidate?.id;
                      return (
                        <tr
                          className={active ? 'optimization-lab-table__row--selected' : ''}
                          key={candidate.id}
                          onClick={() => setSelectedCandidateId(candidate.id)}
                        >
                          <td>{candidate.rank}</td>
                          <td>
                            <div className="optimization-lab-table__stack">
                              <strong>{candidate.title ?? candidate.label}</strong>
                              <span>{candidate.summary ?? '-'}</span>
                            </div>
                          </td>
                          <td className="optimization-lab-table__cell--wrap">
                            <div className="optimization-parameter-summary">
                              {buildRangeParameterEntries(candidate.parameter_snapshot, optimizationSearchSpace).length ? (
                                buildRangeParameterEntries(candidate.parameter_snapshot, optimizationSearchSpace).map((entry) => (
                                  <div className="optimization-parameter-summary__line" key={`${candidate.id}-${entry.key}`}>
                                    <span>{entry.label}：<strong>{entry.value}</strong></span>
                                  </div>
                                ))
                              ) : (
                                <span>-</span>
                              )}
                            </div>
                          </td>
                          <td>{formatMetric(getCandidateMetric(candidate, 'return_sharpe') ?? getCandidateMetric(candidate, 'sharpe'))}</td>
                          <td>{formatMetric(getCandidateMetric(candidate, 'out_of_sample_sharpe'))}</td>
                          <td>{formatPercentMetric(getCandidateMetric(candidate, 'max_drawdown_pct'))}</td>
                          <td>{formatMetric(getCandidateMetric(candidate, 'stability'), 0)}</td>
                          <td>{candidate.status_label ?? formatOptimizationStatus(candidate.status)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="optimization-lab-panel optimization-results-card optimization-results-card--rail">
              <div className="optimization-lab-panel__heading">
                <div>
                  <p className="optimization-lab-eyebrow">{TEXT.stabilityCenter}</p>
                  <h2>{TEXT.stabilityCenter}</h2>
                </div>
                <span className="status-chip status-chip--soft">{selectedCandidate.status_label ?? '观察中'}</span>
              </div>

              <div className="optimization-metric-row">
                <article className="optimization-metric-tile">
                  <span>收益夏普</span>
                  <strong>{formatMetric(getCandidateMetric(selectedCandidate, 'return_sharpe') ?? getCandidateMetric(selectedCandidate, 'sharpe'))}</strong>
                </article>
                <article className="optimization-metric-tile">
                  <span>样本外夏普</span>
                  <strong>{formatMetric(getCandidateMetric(selectedCandidate, 'out_of_sample_sharpe'))}</strong>
                </article>
                <article className="optimization-metric-tile">
                  <span>最大回撤</span>
                  <strong>{formatPercentMetric(getCandidateMetric(selectedCandidate, 'max_drawdown_pct'))}</strong>
                </article>
                <article className="optimization-metric-tile">
                  <span>稳定性</span>
                  <strong>{formatMetric(getCandidateMetric(selectedCandidate, 'stability'), 0)}</strong>
                </article>
              </div>

              <p className="optimization-results-summary">
                {selectedCandidate.analysis?.stability_summary ?? selectedCandidate.analysis?.thesis ?? selectedCandidate.summary}
              </p>

              <section className="optimization-parameter-panel">
                <div className="optimization-parameter-panel__title">当前参数</div>
                <div className="optimization-parameter-chip-list">
                  {selectedCandidateParameters.map((entry) => (
                    <article className="optimization-parameter-chip" key={entry.key}>
                      <span>{entry.label}</span>
                      <strong>{entry.value}</strong>
                    </article>
                  ))}
                </div>
              </section>

              <div className="optimization-check-list">
                {(selectedCandidate.analysis?.stability_checks ?? []).map((check) => (
                  <article className={`optimization-check optimization-check--${check.verdict}`} key={check.key}>
                    <div>
                      <strong>{check.label}</strong>
                      <p>{check.detail}</p>
                    </div>
                    <span>{typeof check.value === 'number' ? check.value : '-'}</span>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <div className="optimization-results-bottom-grid">
            <section className="optimization-lab-panel">
              <div className="optimization-lab-panel__heading">
                <div>
                  <p className="optimization-lab-eyebrow">{TEXT.heatmapPanel}</p>
                  <h2>{TEXT.heatmapPanel}</h2>
                </div>
              </div>
              <div className="optimization-heatmap-shell">
                <table className="optimization-heatmap-table">
                  <thead>
                    <tr>
                      <th>{selectedCandidate.analysis?.heatmap?.y_label ?? '-'}</th>
                      {(selectedCandidate.analysis?.heatmap?.x_values ?? []).map((value) => (
                        <th key={`heatmap-x-${value}`}>{value}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedCandidate.analysis?.heatmap?.y_values ?? []).map((rowValue) => (
                      <tr key={`heatmap-row-${rowValue}`}>
                        <th>{rowValue}</th>
                        {(selectedCandidate.analysis?.heatmap?.x_values ?? []).map((columnValue) => {
                          const cell = (selectedCandidate.analysis?.heatmap?.cells ?? []).find(
                            (item) => item.x === columnValue && item.y === rowValue,
                          );
                          return (
                            <td
                              className={`optimization-heatmap-cell optimization-heatmap-cell--${cell?.tone ?? 'cool'} ${
                                cell?.is_candidate ? 'optimization-heatmap-cell--selected' : ''
                              }`}
                              key={`heatmap-cell-${rowValue}-${columnValue}`}
                            >
                              {cell?.score?.toFixed(2) ?? '-'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="optimization-lab-panel">
              <div className="optimization-lab-panel__heading">
                <div>
                  <p className="optimization-lab-eyebrow">{TEXT.validationPanel}</p>
                  <h2>{TEXT.validationPanel}</h2>
                </div>
              </div>
              <div className="optimization-lab-table-shell">
                <table className="optimization-lab-table optimization-lab-table--compact">
                  <thead>
                    <tr>
                      <th>窗口</th>
                      <th>收益夏普</th>
                      <th>样本外</th>
                      <th>回撤</th>
                      <th>稳定性</th>
                      <th>结论</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedCandidate.analysis?.validation_windows ?? []).map((windowItem) => (
                      <tr key={windowItem.label}>
                        <td>{windowItem.label}</td>
                        <td>{formatMetric(windowItem.return_sharpe)}</td>
                        <td>{formatMetric(windowItem.out_of_sample_sharpe)}</td>
                        <td>{formatPercentMetric(windowItem.max_drawdown_pct)}</td>
                        <td>{formatMetric(windowItem.stability, 0)}</td>
                        <td>{windowItem.verdict === 'pass' ? '通过' : windowItem.verdict === 'watch' ? '观察' : '风险'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="optimization-lab-panel">
            <div className="optimization-lab-panel__heading">
              <div>
                <p className="optimization-lab-eyebrow">{TEXT.candidateShelf}</p>
                <h2>{TEXT.candidateShelf}</h2>
              </div>
            </div>
            <div className="optimization-shelf-grid">
              {job.candidates.map((candidate) => (
                <button
                  className={`optimization-shelf-card ${candidate.id === selectedCandidate?.id ? 'optimization-shelf-card--active' : ''}`}
                  key={candidate.id}
                  onClick={() => setSelectedCandidateId(candidate.id)}
                  type="button"
                >
                  <strong>{candidate.title ?? candidate.label}</strong>
                  <span>{candidate.status_label ?? formatOptimizationStatus(candidate.status)}</span>
                  <p>{candidate.analysis?.shelf_copy ?? candidate.summary}</p>
                </button>
              ))}
            </div>
              </section>
            </>
          ) : (
            <section className="optimization-lab-panel">
              <p className="empty-state">正在生成首轮候选，结果中心会自动刷新。</p>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
