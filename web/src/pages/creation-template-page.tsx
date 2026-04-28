import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatStrategyVersionTag, getStrategyDisplayName } from '../lib/strategy-version';
import type { ApiBacktestRunListItem, ApiStrategyListItem, StrategyType } from '../types';
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
  strategyTypeLabel: string;
  returns: Record<HorizonKey, StrategyReturnLink | null>;
  statusLabel: '已验证' | '待回测';
  statusTone: 'ready' | 'pending';
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
  GENERAL: '通用策略',
};

const HORIZONS: Array<{ key: HorizonKey; label: '10Y' | '20Y' | '30Y'; headerLabel: string; years: number }> = [
  { key: 'tenYear', label: '10Y', headerLabel: '10Y年化收益/夏普', years: 10 },
  { key: 'twentyYear', label: '20Y', headerLabel: '20Y年化收益/夏普', years: 20 },
  { key: 'thirtyYear', label: '30Y', headerLabel: '30Y年化收益/夏普', years: 30 },
];

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

function buildBacktestCreatePath(strategyId: string, horizonKey: HorizonKey): string {
  const horizon = getHorizonByKey(horizonKey);
  return `/strategies/${encodeURIComponent(strategyId)}/backtest-runs/new?period_years=${horizon.years}`;
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
  const completedRuns = runs
    .filter(isCompletedRun)
    .slice()
    .sort((left, right) => getRunTimeValue(right) - getRunTimeValue(left));

  return strategies
    .map((strategy) => {
      const strategyRuns = completedRuns.filter((run) => run.strategy_id === strategy.id);
      const returns: Record<HorizonKey, StrategyReturnLink | null> = {
        tenYear: null,
        twentyYear: null,
        thirtyYear: null,
      };

      strategyRuns.forEach((run) => {
        const horizonKey = getRunHorizon(run);
        if (!horizonKey || returns[horizonKey]) {
          return;
        }
        returns[horizonKey] = buildReturnLink(run, horizonKey);
      });

      const hasLongTermRun = Object.values(returns).some(Boolean);
      return {
        id: strategy.id,
        name: getStrategyDisplayName(strategy.name, strategy.id),
        universeName: strategy.universe_name || '未记录',
        currentVersionLabel: getVersionLabel(strategy),
        strategyTypeLabel: STRATEGY_TYPE_LABELS[strategy.strategy_type] ?? strategy.strategy_type,
        returns,
        statusLabel: hasLongTermRun ? '已验证' : '待回测',
        statusTone: hasLongTermRun ? 'ready' : 'pending',
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

function ReturnCell({
  horizonKey,
  link,
  name,
  strategyId,
}: {
  horizonKey: HorizonKey;
  link: StrategyReturnLink | null;
  name: string;
  strategyId: string;
}): JSX.Element {
  if (!link) {
    const horizon = getHorizonByKey(horizonKey);
    return (
      <button
        aria-label={`为 ${name} 一键生成 ${horizon.label} 回测`}
        className="strategy-library-return strategy-library-return--generate"
        onClick={() => navigateTo(buildBacktestCreatePath(strategyId, horizonKey))}
        type="button"
      >
        {TEXT.generateReturn}
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

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setLoadError(null);
        const [strategyItems, runItems] = await Promise.all([
          api.listStrategies(controller.signal),
          api.listBacktestRuns({ limit: 100 }, controller.signal),
        ]);
        if (cancelled) {
          return;
        }
        setStrategies(strategyItems);
        setRuns(runItems);
        setLoading(false);
      } catch (caught) {
        if (isAbortError(caught)) {
          return;
        }
        if (!cancelled) {
          setLoadError((caught as Error).message);
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
      const session = await api.createCreationSession({ strategy_type: strategyType });
      navigateTo(`/creation/sessions/${session.id}`);
    } catch (caught) {
      setCreateError((caught as Error).message);
    } finally {
      setBusyStrategyType(null);
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
                      <ReturnCell horizonKey="tenYear" link={row.returns.tenYear} name={row.name} strategyId={row.id} />
                    </td>
                    <td>
                      <ReturnCell horizonKey="twentyYear" link={row.returns.twentyYear} name={row.name} strategyId={row.id} />
                    </td>
                    <td>
                      <ReturnCell horizonKey="thirtyYear" link={row.returns.thirtyYear} name={row.name} strategyId={row.id} />
                    </td>
                    <td>
                      <span className={`strategy-library-status strategy-library-status--${row.statusTone}`}>
                        {row.statusLabel}
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
