import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatStrategyVersionTag, getStrategyDisplayName } from '../lib/strategy-version';
import type { ApiBacktestRunDetail, ApiBacktestRunListItem, ApiStrategyListItem, StrategyType } from '../types';
import './creation-backtest.css';

type TemplateCard = {
  strategyType: StrategyType;
  label: string;
  description: string;
  actionLabel: string;
};

type HorizonKey = 'tenYear' | 'twentyYear' | 'thirtyYear';
type SortKey = HorizonKey | 'updatedAt';
type SortDirection = 'asc' | 'desc';

type SortState = {
  key: SortKey;
  direction: SortDirection;
};

type StrategyReturnLink = {
  label: string;
  sharpeLabel: string;
  runId: string;
  horizonLabel: '10Y' | '20Y' | '30Y';
  sortValue: number;
  tone: 'positive' | 'negative';
};

type StrategyLibraryRow = {
  id: string;
  name: string;
  universeName: string;
  currentVersionLabel: string;
  currentParameterVersionId: string | null;
  datasetSnapshotId?: string | null;
  universeSnapshotId?: string | null;
  strategyTypeLabel: string;
  returns: Record<HorizonKey, StrategyReturnLink | null>;
  inflightReturns: Record<HorizonKey, boolean>;
  statusLabel: '已验证' | '待回测' | '生成中';
  statusTone: 'ready' | 'pending' | 'running';
  updatedAtLabel: string;
  updatedAtTime: number;
  latestOptimizationJobId?: string | null;
};

type StatusFilter = 'all' | 'ready' | 'pending';

const TEXT = {
  pageEyebrow: '策略管理',
  pageTitle: '策略库',
  pageCopy: '集中管理已创建策略、参数版本、长期回测表现与后续研究动作。',
  newStrategy: '新建策略',
  listTitle: '策略列表',
  listCopy: '按最近编辑时间排序，支持查看策略、发起回测与进入优化配置。',
  strategyCount: '策略总数',
  completedLongTerm: '已完成长期回测',
  pendingLongTerm: '待补充回测',
  optimizableStrategies: '可优化策略',
  searchPlaceholder: '搜索策略名、类型或投资标的',
  searchAriaLabel: '搜索策略',
  all: '全部',
  ready: '已验证',
  pending: '待回测',
  loading: '加载策略列表中...',
  empty: '暂无策略记录。请通过新建策略建立研究对象。',
  filteredEmpty: '没有符合条件的策略记录。',
  generateReturn: '一键生成',
  generatingReturn: '生成中',
  generationToastInfo: '已提交长期回测生成任务，正在写入 10Y / 20Y / 30Y 记录。',
  generationToastSuccess: '长期回测记录已生成，策略列表已刷新。',
  generationToastErrorPrefix: '一键生成失败：',
  actions: '操作',
  view: '查看',
  backtest: '回测',
  optimize: '优化',
  createModalEyebrow: '新建策略',
  createModalTitle: '选择策略类型',
  createModalCopy:
    '请选择策略研究框架。系统将基于所选类型建立创建会话，并在后续步骤中确认参数、标的范围与回测假设。',
  close: '关闭',
  creating: '创建中...',
} as const;

const templates: TemplateCard[] = [
  {
    strategyType: 'MOMENTUM',
    label: '动量 / 趋势跟随',
    description: '用于研究截面动量、趋势延续和相对强弱轮动框架。',
    actionLabel: '创建动量策略',
  },
  {
    strategyType: 'GRID',
    label: '网格交易',
    description: '用于研究区间震荡下的分层买入、分层卖出和仓位再平衡规则。',
    actionLabel: '创建网格策略',
  },
  {
    strategyType: 'MEAN_REVERSION',
    label: '均值回归',
    description: '用于研究价格偏离、风险预算、止盈止损和均值回归触发条件。',
    actionLabel: '创建均值回归策略',
  },
  {
    strategyType: 'BUY_AND_HOLD',
    label: '指数 / 定投',
    description: '用于研究长期持有、固定投入、估值分位和动态倍率配置。',
    actionLabel: '创建定投策略',
  },
  {
    strategyType: 'ASSET_ALLOCATION',
    label: '资产配置型',
    description: '用于多资产风险预算、目标权重、再平衡与成本假设配置。',
    actionLabel: '创建资产配置策略',
  },
  {
    strategyType: 'MULTI_FACTOR',
    label: '多因子策略',
    description: '从因子库选择系统或验证因子，配置权重、方向与行业中性化后创建可回测策略。',
    actionLabel: '创建多因子策略',
  },
  {
    strategyType: 'GENERAL',
    label: '通用策略',
    description: '用于定义非模板化交易逻辑，适合需要自定义规则的研究场景。',
    actionLabel: '创建通用策略',
  },
];

const STRATEGY_TYPE_LABELS: Record<StrategyType, string> = {
  MOMENTUM: '动量 / 趋势跟随',
  GRID: '网格交易',
  MEAN_REVERSION: '均值回归',
  BUY_AND_HOLD: '指数 / 定投',
  ASSET_ALLOCATION: '资产配置型',
  MULTI_FACTOR: '多因子策略',
  GENERAL: '通用策略',
};

const HORIZONS: Array<{ key: HorizonKey; label: '10Y' | '20Y' | '30Y'; headerLabel: string; years: number }> = [
  { key: 'tenYear', label: '10Y', headerLabel: '10Y年化收益/夏普', years: 10 },
  { key: 'twentyYear', label: '20Y', headerLabel: '20Y年化收益/夏普', years: 20 },
  { key: 'thirtyYear', label: '30Y', headerLabel: '30Y年化收益/夏普', years: 30 },
];

const DEFAULT_BACKTEST_END_DATE = '2026-03-24';

function isAbortError(caught: unknown): boolean {
  return caught instanceof DOMException
    ? caught.name === 'AbortError'
    : typeof caught === 'object' &&
        caught !== null &&
        'name' in caught &&
        (caught as { name?: string }).name === 'AbortError';
}

function isCompletedRun(run: ApiBacktestRunListItem): boolean {
  return run.status === 'COMPLETED' || run.status === 'COMPLETED_WITH_WARNINGS';
}

function isInflightRun(run: ApiBacktestRunListItem): boolean {
  return run.status === 'QUEUED' || run.status === 'RUNNING';
}

function toValidDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value: string | null | undefined): string {
  const date = toValidDate(value);
  if (!date) {
    return '未记录';
  }
  const parts = new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day} ${lookup.hour}:${lookup.minute}`;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPresetRange(years: number): { startDate: string; endDate: string } {
  const end = new Date(DEFAULT_BACKTEST_END_DATE);
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - years);
  return { startDate: formatDate(start), endDate: DEFAULT_BACKTEST_END_DATE };
}

function formatReturn(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const percent = value * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function readMetric(metrics: Record<string, number> | undefined, keys: string[]): number | undefined {
  if (!metrics) {
    return undefined;
  }
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function formatSharpe(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(2);
}

function getRunStartDate(run: ApiBacktestRunListItem): string | null | undefined {
  return run.start_date ?? run.preview?.effective_start_date;
}

function getRunEndDate(run: ApiBacktestRunListItem): string | null | undefined {
  return run.end_date ?? run.preview?.effective_end_date ?? run.completed_at ?? run.updated_at;
}

function getRunWindowYears(run: ApiBacktestRunListItem): number | null {
  const start = toValidDate(getRunStartDate(run));
  const end = toValidDate(getRunEndDate(run));
  if (!start || !end || end.getTime() <= start.getTime()) {
    return null;
  }
  return (end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

function getRunHorizon(run: ApiBacktestRunListItem): HorizonKey | null {
  const years = getRunWindowYears(run);
  if (years === null) {
    return null;
  }

  const closest = HORIZONS.map((horizon) => ({
    horizon,
    distance: Math.abs(years - horizon.years),
  })).sort((left, right) => left.distance - right.distance)[0];

  return closest && closest.distance <= 1.25 ? closest.horizon.key : null;
}

function getRunTimeValue(run: ApiBacktestRunListItem): number {
  const date = toValidDate(run.completed_at ?? run.updated_at ?? run.created_at);
  return date ? date.getTime() : 0;
}

function getCurrentParameterVersionId(strategy: ApiStrategyListItem): string | null {
  const explicitVersionId = strategy.current_parameter_version_id?.trim();
  if (explicitVersionId) {
    return explicitVersionId;
  }
  if (typeof strategy.current_parameter_version === 'number' && Number.isFinite(strategy.current_parameter_version)) {
    return `${strategy.id}-v${strategy.current_parameter_version}`;
  }
  return null;
}

function getRunParameterVersionId(run: ApiBacktestRunListItem): string | null {
  return (run.parameter_version_id ?? run.preview?.parameter_version_id ?? '').trim() || null;
}

function matchesCurrentParameterVersion(strategy: ApiStrategyListItem, run: ApiBacktestRunListItem): boolean {
  const runVersionId = getRunParameterVersionId(run);
  if (!runVersionId) {
    return true;
  }
  const currentVersionId = getCurrentParameterVersionId(strategy);
  return !currentVersionId || runVersionId === currentVersionId;
}

function buildReturnLink(run: ApiBacktestRunListItem, horizonKey: HorizonKey): StrategyReturnLink | null {
  const horizon = HORIZONS.find((item) => item.key === horizonKey);
  const annualizedReturn = readMetric(run.metrics, [
    'annualized_return',
    'cagr',
    'oos_annualized_return',
  ]);
  const label = formatReturn(annualizedReturn);
  if (!horizon || !label || annualizedReturn === undefined) {
    return null;
  }
  const sharpe = readMetric(run.metrics, ['return_sharpe', 'sharpe']);
  return {
    label: `${label} / ${formatSharpe(sharpe)}`,
    sharpeLabel: formatSharpe(sharpe),
    runId: run.id,
    horizonLabel: horizon.label,
    sortValue: annualizedReturn,
    tone: annualizedReturn >= 0 ? 'positive' : 'negative',
  };
}

function getHorizonByKey(horizonKey: HorizonKey): (typeof HORIZONS)[number] {
  return HORIZONS.find((item) => item.key === horizonKey) ?? HORIZONS[0];
}

function getVersionLabel(strategy: ApiStrategyListItem): string {
  if (typeof strategy.current_parameter_version === 'number') {
    return `v${strategy.current_parameter_version}`;
  }
  return formatStrategyVersionTag(strategy.current_parameter_version_id) ?? 'v1';
}

function buildRows(
  strategies: ApiStrategyListItem[],
  runs: ApiBacktestRunListItem[],
): StrategyLibraryRow[] {
  const currentRuns = runs
    .slice()
    .sort((left, right) => getRunTimeValue(right) - getRunTimeValue(left));

  return strategies
    .map((strategy) => {
      const currentStrategyRuns = currentRuns.filter(
        (run) => run.strategy_id === strategy.id && matchesCurrentParameterVersion(strategy, run),
      );
      const strategyRuns = currentStrategyRuns.filter(isCompletedRun);
      const inflightRuns = currentStrategyRuns.filter(isInflightRun);
      const returns: Record<HorizonKey, StrategyReturnLink | null> = {
        tenYear: null,
        twentyYear: null,
        thirtyYear: null,
      };
      const inflightReturns: Record<HorizonKey, boolean> = {
        tenYear: false,
        twentyYear: false,
        thirtyYear: false,
      };

      strategyRuns.forEach((run) => {
        const horizonKey = getRunHorizon(run);
        if (!horizonKey || returns[horizonKey]) {
          return;
        }
        returns[horizonKey] = buildReturnLink(run, horizonKey);
      });
      inflightRuns.forEach((run) => {
        const horizonKey = getRunHorizon(run);
        if (horizonKey && !returns[horizonKey]) {
          inflightReturns[horizonKey] = true;
        }
      });

      const hasLongTermRun = Object.values(returns).some(Boolean);
      const hasInflightRun = Object.values(inflightReturns).some(Boolean);
      return {
        id: strategy.id,
        name: getStrategyDisplayName(strategy.name, strategy.id),
        universeName: strategy.universe_name || '未记录',
        currentVersionLabel: getVersionLabel(strategy),
        currentParameterVersionId: getCurrentParameterVersionId(strategy),
        datasetSnapshotId: strategy.dataset_snapshot_id,
        universeSnapshotId: strategy.universe_snapshot_id,
        strategyTypeLabel: STRATEGY_TYPE_LABELS[strategy.strategy_type] ?? strategy.strategy_type,
        returns,
        inflightReturns,
        statusLabel: hasInflightRun ? '生成中' : hasLongTermRun ? '已验证' : '待回测',
        statusTone: hasInflightRun ? 'running' : hasLongTermRun ? 'ready' : 'pending',
        updatedAtLabel: formatDateTime(strategy.updated_at ?? strategy.created_at),
        updatedAtTime: toValidDate(strategy.updated_at ?? strategy.created_at)?.getTime() ?? 0,
        latestOptimizationJobId: strategy.latest_optimization_job_id,
      } satisfies StrategyLibraryRow;
    })
    .sort((left, right) => right.updatedAtTime - left.updatedAtTime);
}

function hasAnyReturn(row: StrategyLibraryRow): boolean {
  return Object.values(row.returns).some(Boolean);
}

function matchesSearch(row: StrategyLibraryRow, search: string): boolean {
  const keyword = search.trim().toLowerCase();
  if (!keyword) {
    return true;
  }
  return [row.name, row.strategyTypeLabel, row.universeName].some((value) =>
    value.toLowerCase().includes(keyword),
  );
}

function matchesStatus(row: StrategyLibraryRow, statusFilter: StatusFilter): boolean {
  if (statusFilter === 'all') {
    return true;
  }
  if (statusFilter === 'pending') {
    return row.statusTone === 'pending' || row.statusTone === 'running';
  }
  return row.statusTone === statusFilter;
}

function compareNullableNumbers(
  leftValue: number | null,
  rightValue: number | null,
  direction: SortDirection,
): number {
  if (leftValue === null && rightValue === null) {
    return 0;
  }
  if (leftValue === null) {
    return 1;
  }
  if (rightValue === null) {
    return -1;
  }
  return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
}

function sortRows(rows: StrategyLibraryRow[], sortState: SortState): StrategyLibraryRow[] {
  return rows.slice().sort((left, right) => {
    const compared =
      sortState.key === 'updatedAt'
        ? compareNullableNumbers(left.updatedAtTime, right.updatedAtTime, sortState.direction)
        : compareNullableNumbers(
            left.returns[sortState.key]?.sortValue ?? null,
            right.returns[sortState.key]?.sortValue ?? null,
            sortState.direction,
          );
    return compared || right.updatedAtTime - left.updatedAtTime || left.name.localeCompare(right.name);
  });
}

function getMissingHorizons(row: StrategyLibraryRow): typeof HORIZONS {
  return HORIZONS.filter((horizon) => !row.returns[horizon.key] && !row.inflightReturns[horizon.key]);
}

function buildSubmissionPayload(
  row: StrategyLibraryRow,
  horizon: (typeof HORIZONS)[number],
): Record<string, unknown> {
  const range = getPresetRange(horizon.years);
  const versionKey = row.currentParameterVersionId ?? row.currentVersionLabel;
  return {
    idempotency_key: `strategy-library-${row.id}-${versionKey}-${horizon.years}-${Date.now()}`,
    start_date: range.startDate,
    end_date: range.endDate,
    parameter_version_id: row.currentParameterVersionId ?? undefined,
    dataset_snapshot_id: row.datasetSnapshotId ?? undefined,
    universe_snapshot_id: row.universeSnapshotId ?? undefined,
    is_permanent: false,
  };
}

function submittedDetailToListItem(
  detail: ApiBacktestRunDetail,
  row: StrategyLibraryRow,
  payload: Record<string, unknown>,
): ApiBacktestRunListItem {
  return {
    ...detail,
    strategy_id: detail.strategy_id ?? row.id,
    strategy_name: detail.strategy_name ?? row.name,
    start_date: detail.start_date ?? (typeof payload.start_date === 'string' ? payload.start_date : null),
    end_date: detail.end_date ?? (typeof payload.end_date === 'string' ? payload.end_date : null),
    parameter_version_id:
      detail.parameter_version_id ??
      (typeof payload.parameter_version_id === 'string' ? payload.parameter_version_id : row.currentParameterVersionId),
    is_permanent: detail.is_permanent ?? false,
  };
}

function mergeRuns(incoming: ApiBacktestRunListItem[], existing: ApiBacktestRunListItem[]): ApiBacktestRunListItem[] {
  const merged = new Map<string, ApiBacktestRunListItem>();
  [...incoming, ...existing].forEach((run) => {
    if (!merged.has(run.id)) {
      merged.set(run.id, run);
    }
  });
  return Array.from(merged.values());
}

function ReturnCell({
  disabled,
  generating,
  horizonKey,
  link,
  name,
  onGenerate,
}: {
  disabled: boolean;
  generating: boolean;
  horizonKey: HorizonKey;
  link: StrategyReturnLink | null;
  name: string;
  onGenerate: () => void;
}): JSX.Element {
  if (!link) {
    const horizon = getHorizonByKey(horizonKey);
    return (
      <button
        aria-label={
          generating
            ? `正在为 ${name} 生成 ${horizon.label} 回测`
            : `为 ${name} 从 ${horizon.label} 入口一键生成 10Y、20Y、30Y 回测`
        }
        className={`strategy-library-return strategy-library-return--${generating ? 'running' : 'generate'}`}
        disabled={disabled || generating}
        onClick={onGenerate}
        type="button"
      >
        {generating ? TEXT.generatingReturn : TEXT.generateReturn}
      </button>
    );
  }
  return (
    <button
      aria-label={`查看 ${name} ${link.horizonLabel} 回测，年化收益 ${link.label}，夏普 ${link.sharpeLabel}`}
      className={`strategy-library-return strategy-library-return--${link.tone}`}
      onClick={() => navigateTo(`/runs/${link.runId}`)}
      type="button"
    >
      {link.label}
    </button>
  );
}

export function CreationTemplatePage(): JSX.Element {
  const api = useApiClient();
  const [strategies, setStrategies] = useState<ApiStrategyListItem[]>([]);
  const [runs, setRuns] = useState<ApiBacktestRunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortState, setSortState] = useState<SortState>({ key: 'updatedAt', direction: 'desc' });
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [busyStrategyType, setBusyStrategyType] = useState<StrategyType | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generatingStrategyId, setGeneratingStrategyId] = useState<string | null>(null);
  const [generationToast, setGenerationToast] = useState<{ tone: 'info' | 'success' | 'error'; message: string } | null>(
    null,
  );

  async function loadLibrary(
    signal?: AbortSignal,
    options: { showLoading?: boolean } = {},
  ): Promise<void> {
    try {
      if (options.showLoading) {
        setLoading(true);
      }
      setLoadError(null);
      const [strategyItems, runItems] = await Promise.all([
        api.listStrategies(signal),
        api.listBacktestRuns({ limit: 100 }, signal),
      ]);
      if (signal?.aborted) {
        return;
      }
      setStrategies(strategyItems);
      setRuns(runItems);
      if (options.showLoading) {
        setLoading(false);
      }
    } catch (caught) {
      if (isAbortError(caught)) {
        return;
      }
      if (!signal?.aborted) {
        setLoadError((caught as Error).message);
        if (options.showLoading) {
          setLoading(false);
        }
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadLibrary(controller.signal, { showLoading: true });
    return () => {
      controller.abort();
    };
  }, [api]);

  useEffect(() => {
    if (!isCreateModalOpen) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && busyStrategyType === null) {
        setIsCreateModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busyStrategyType, isCreateModalOpen]);

  const rows = useMemo(() => buildRows(strategies, runs), [runs, strategies]);
  const visibleRows = useMemo(
    () => sortRows(rows.filter((row) => matchesSearch(row, search) && matchesStatus(row, statusFilter)), sortState),
    [rows, search, sortState, statusFilter],
  );
  const completedLongTermCount = rows.filter(hasAnyReturn).length;
  const pendingLongTermCount = rows.length - completedLongTermCount;
  const optimizableCount = rows.filter((row) => hasAnyReturn(row) || row.latestOptimizationJobId).length;

  async function handleCreateSession(strategyType: StrategyType): Promise<void> {
    try {
      setBusyStrategyType(strategyType);
      setCreateError(null);
      if (strategyType === 'ASSET_ALLOCATION') {
        navigateTo('/creation/asset-allocation/new');
        return;
      }
      if (strategyType === 'MULTI_FACTOR') {
        navigateTo('/factor-models/new');
        return;
      }
      const session = await api.createCreationSession({ strategy_type: strategyType });
      navigateTo(`/creation/sessions/${session.id}`);
    } catch (caught) {
      setCreateError((caught as Error).message);
    } finally {
      setBusyStrategyType(null);
    }
  }

  async function handleGenerateLongTermRuns(row: StrategyLibraryRow): Promise<void> {
    const targetHorizons = getMissingHorizons(row);
    if (targetHorizons.length === 0 || generatingStrategyId !== null) {
      return;
    }
    try {
      setGeneratingStrategyId(row.id);
      setGenerationToast({ tone: 'info', message: TEXT.generationToastInfo });
      const submittedRuns = await Promise.all(
        targetHorizons.map(async (horizon) => {
          const payload = buildSubmissionPayload(row, horizon);
          const submitted = await api.submitBacktestRun(row.id, payload);
          return submittedDetailToListItem(submitted, row, payload);
        }),
      );
      setRuns((current) => mergeRuns(submittedRuns, current));
      await loadLibrary(undefined, { showLoading: false });
      setGenerationToast({ tone: 'success', message: TEXT.generationToastSuccess });
    } catch (caught) {
      setGenerationToast({
        tone: 'error',
        message: `${TEXT.generationToastErrorPrefix}${(caught as Error).message}`,
      });
    } finally {
      setGeneratingStrategyId(null);
    }
  }

  function renderStatusFilter(label: string, value: StatusFilter): JSX.Element {
    return (
      <button
        aria-pressed={statusFilter === value}
        className={`strategy-library-filter-button ${statusFilter === value ? 'strategy-library-filter-button--active' : ''}`}
        onClick={() => setStatusFilter(value)}
        type="button"
      >
        {label}
      </button>
    );
  }

  function toggleSort(key: SortKey): void {
    setSortState((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  }

  function renderSortableHeader(key: SortKey, label: string): JSX.Element {
    const active = sortState.key === key;
    const directionLabel = sortState.direction === 'desc' ? '降序' : '升序';
    return (
      <th aria-sort={active ? (sortState.direction === 'desc' ? 'descending' : 'ascending') : 'none'} key={key}>
        <button
          aria-label={`按${label}${active ? `切换为${sortState.direction === 'desc' ? '升序' : '降序'}` : '排序'}`}
          className={`strategy-library-sort-button ${active ? 'strategy-library-sort-button--active' : ''}`}
          onClick={() => toggleSort(key)}
          type="button"
        >
          <span>{label}</span>
          {active ? <span className="strategy-library-sort-button__state">{directionLabel}</span> : null}
        </button>
      </th>
    );
  }

  return (
    <div className="creation-template-page strategy-library-page">
      {loadError ? <div className="error-banner" role="alert">{loadError}</div> : null}

      <section className="strategy-library-hero">
        <div>
          <p className="strategy-library-eyebrow">{TEXT.pageEyebrow}</p>
          <h1>{TEXT.pageTitle}</h1>
          <p>{TEXT.pageCopy}</p>
        </div>
        <div className="strategy-library-hero__actions">
          <button
            className="primary-button"
            onClick={() => {
              setCreateError(null);
              setIsCreateModalOpen(true);
            }}
            type="button"
          >
            {TEXT.newStrategy}
          </button>
        </div>
      </section>

      {generationToast ? (
        <div
          className={`strategy-library-toast strategy-library-toast--${generationToast.tone}`}
          role={generationToast.tone === 'error' ? 'alert' : 'status'}
        >
          {generationToast.message}
        </div>
      ) : null}

      <section className="strategy-library-panel" aria-label={TEXT.listTitle}>
        <div className="strategy-library-panel__header">
          <div>
            <h2>{TEXT.listTitle}</h2>
            <p>{TEXT.listCopy}</p>
          </div>
        </div>

        <div className="strategy-library-metrics" aria-label="策略摘要">
          <div className="strategy-library-metric">
            <span>{TEXT.strategyCount}</span>
            <strong>{rows.length}</strong>
          </div>
          <div className="strategy-library-metric">
            <span>{TEXT.completedLongTerm}</span>
            <strong>{completedLongTermCount}</strong>
          </div>
          <div className="strategy-library-metric">
            <span>{TEXT.pendingLongTerm}</span>
            <strong>{pendingLongTermCount}</strong>
          </div>
          <div className="strategy-library-metric">
            <span>{TEXT.optimizableStrategies}</span>
            <strong>{optimizableCount}</strong>
          </div>
        </div>

        <div className="strategy-library-toolbar">
          <input
            aria-label={TEXT.searchAriaLabel}
            className="strategy-library-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={TEXT.searchPlaceholder}
            type="search"
            value={search}
          />
          <div className="strategy-library-filter-group" role="group" aria-label="策略状态筛选">
            {renderStatusFilter(TEXT.all, 'all')}
            {renderStatusFilter(TEXT.ready, 'ready')}
            {renderStatusFilter(TEXT.pending, 'pending')}
          </div>
        </div>

        {loading ? <p className="empty-state">{TEXT.loading}</p> : null}

        {!loading && !loadError && rows.length === 0 ? <p className="empty-state">{TEXT.empty}</p> : null}

        {!loading && !loadError && rows.length > 0 && visibleRows.length === 0 ? (
          <p className="empty-state">{TEXT.filteredEmpty}</p>
        ) : null}

        {!loading && !loadError && visibleRows.length > 0 ? (
          <div className="strategy-library-table-wrap">
            <table className="strategy-library-table">
              <thead>
                <tr>
                  <th>策略名</th>
                  <th>版本</th>
                  <th>策略类型</th>
                  {HORIZONS.map((horizon) => renderSortableHeader(horizon.key, horizon.headerLabel))}
                  <th>状态</th>
                  {renderSortableHeader('updatedAt', '最近编辑时间')}
                  <th>{TEXT.actions}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="strategy-library-name-cell">
                        <strong>{row.name}</strong>
                        <span>投资标的：{row.universeName}</span>
                      </div>
                    </td>
                    <td>
                      <span className="strategy-library-version">{row.currentVersionLabel}</span>
                    </td>
                    <td>
                      <span className="strategy-library-type">{row.strategyTypeLabel}</span>
                    </td>
                    <td>
                      <ReturnCell
                        disabled={generatingStrategyId !== null}
                        generating={generatingStrategyId === row.id || row.inflightReturns.tenYear}
                        horizonKey="tenYear"
                        link={row.returns.tenYear}
                        name={row.name}
                        onGenerate={() => void handleGenerateLongTermRuns(row)}
                      />
                    </td>
                    <td>
                      <ReturnCell
                        disabled={generatingStrategyId !== null}
                        generating={generatingStrategyId === row.id || row.inflightReturns.twentyYear}
                        horizonKey="twentyYear"
                        link={row.returns.twentyYear}
                        name={row.name}
                        onGenerate={() => void handleGenerateLongTermRuns(row)}
                      />
                    </td>
                    <td>
                      <ReturnCell
                        disabled={generatingStrategyId !== null}
                        generating={generatingStrategyId === row.id || row.inflightReturns.thirtyYear}
                        horizonKey="thirtyYear"
                        link={row.returns.thirtyYear}
                        name={row.name}
                        onGenerate={() => void handleGenerateLongTermRuns(row)}
                      />
                    </td>
                    <td>
                      <span
                        className={`strategy-library-status strategy-library-status--${
                          generatingStrategyId === row.id ? 'running' : row.statusTone
                        }`}
                      >
                        {generatingStrategyId === row.id ? '生成中' : row.statusLabel}
                      </span>
                    </td>
                    <td>{row.updatedAtLabel}</td>
                    <td>
                      <div className="strategy-library-actions">
                        <button className="ghost-button" onClick={() => navigateTo(`/strategies/${row.id}`)} type="button">
                          {TEXT.view}
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => navigateTo(`/strategies/${row.id}/backtest-runs/new`)}
                          type="button"
                        >
                          {TEXT.backtest}
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => navigateTo(`/optimization-jobs/new/config?strategy_id=${encodeURIComponent(row.id)}`)}
                          type="button"
                        >
                          {TEXT.optimize}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {isCreateModalOpen ? (
        <div className="strategy-library-modal-backdrop">
          <section
            aria-labelledby="strategy-library-create-title"
            aria-modal="true"
            className="strategy-library-create-modal"
            role="dialog"
          >
            <div className="strategy-library-create-modal__header">
              <div>
                <p className="strategy-library-eyebrow">{TEXT.createModalEyebrow}</p>
                <h2 id="strategy-library-create-title">{TEXT.createModalTitle}</h2>
                <p>{TEXT.createModalCopy}</p>
              </div>
              <button
                className="ghost-button"
                disabled={busyStrategyType !== null}
                onClick={() => setIsCreateModalOpen(false)}
                type="button"
              >
                {TEXT.close}
              </button>
            </div>

            {createError ? <div className="error-banner" role="alert">{createError}</div> : null}

            <div className="strategy-library-template-grid" aria-label="策略类型">
              {templates.map((template) => (
                <article className="strategy-library-template-card" key={template.strategyType}>
                  <div>
                    <h3>{template.label}</h3>
                    <p>{template.description}</p>
                  </div>
                  <button
                    className="primary-button"
                    disabled={busyStrategyType !== null}
                    onClick={() => void handleCreateSession(template.strategyType)}
                    type="button"
                  >
                    {busyStrategyType === template.strategyType ? TEXT.creating : template.actionLabel}
                  </button>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
