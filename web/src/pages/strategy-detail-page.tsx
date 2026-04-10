import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatDateTime, formatPercent, formatRatio, formatShortDate } from '../lib/format';
import { buildOptimizationConfigPath } from '../lib/optimization-routes';
import type { ApiBacktestRunListItem, ApiStrategyDetail, ParameterValue } from '../types';
import './creation-backtest.css';
import '../page-sections/workspace-recent-runs-lane-b.css';
import './strategy-detail-page.css';

const TEXT = {
  eyebrow: '策略详情',
  title: '策略详情',
  loading: '正在加载策略详情...',
  loadError: '策略详情加载失败。',
  runBacktest: '运行回测',
  editStrategy: '修改策略',
  openOptimization: '打开优化',
  parameterTitle: '当前参数',
  parameterCopy: '这里展示当前版本真正参与执行的策略参数，交易逻辑会固定排在首位，其他参数按类别平铺展示。',
  historyTitle: '参数历史',
  historyCopy: '按版本查看参数迭代记录，帮助快速回看每次调整的时间、说明和字段规模。',
  historyOpenDetail: '查看参数',
  historyDetailTitle: '版本参数明细',
  historyDetailClose: '关闭',
  historyDetailEmpty: '该版本没有可展示的参数。',
  recentRunTitle: '最近回测',
  recentRunCopy: '按时间轴查看最近回测记录，并同步展示每次回测对应的策略参数版本。',
  emptyParameters: '当前没有可展示的参数。',
  emptyHistory: '暂时没有参数历史。',
  emptyRun: '暂无最近回测',
  latestRunStatus: '运行状态',
  totalReturn: '总收益',
  sharpe: '夏普',
  maxDrawdown: '最大回撤',
  tradeCount: '交易笔数',
  historyFallbackComment: '该版本没有额外备注。',
  editError: '打开策略修改页失败，请稍后重试。',
  recentRunRangeFallback: '回测区间待补充',
  recentRunVersionFallback: '参数版本待补充',
} as const;

const PARAMETER_LABELS: Record<string, string> = {
  strategy_name: '策略名称',
  strategy_description: '策略描述',
  strategy_type: '策略类型',
  universe_name: '股票池',
  benchmark_symbol: '基准',
  rebalance_frequency: '再平衡',
  trading_logic: '交易逻辑',
  observation_timeframe: '观察周期',
  bollinger_period: '布林带周期',
  rsi_period: 'RSI 周期',
  rsi_buy_threshold: 'RSI 买入阈值',
  rsi_sell_threshold: 'RSI 卖出阈值',
  atr_period: 'ATR 周期',
  take_profit_atr: '止盈倍数',
  stop_loss_atr: '止损倍数',
  long_entry_size_pct: '买入仓位',
  short_entry_size_pct: '卖出仓位',
  capital: '初始资金',
  contribution_amount: '每期投入',
  investment_frequency: '投入频次',
  lookback_months: '回看月数',
  skip_recent_months: '跳过最近月数',
  top_n: '入选数量',
  weighting_method: '权重方式',
  max_position_pct: '单票上限',
  holding_count: '持仓数量',
  lookback_days: '回看天数',
  signal_lookback_days: '信号观察天数',
  initial_position: '初始仓位',
  grid_interval: '下跌间距',
  buy_size_pct: '下跌买入仓位',
  sell_step_pct: '上涨间距',
  sell_size_pct: '上涨卖出仓位',
  max_stop_loss_pct: '最大止损仓位',
};

const PARAMETER_ORDER: Record<string, number> = {
  strategy_name: -60,
  strategy_description: -50,
  strategy_type: -40,
  universe_name: -30,
  benchmark_symbol: -20,
  rebalance_frequency: -10,
  observation_timeframe: 10,
  bollinger_period: 20,
  rsi_period: 30,
  rsi_buy_threshold: 40,
  rsi_sell_threshold: 50,
  atr_period: 60,
  take_profit_atr: 70,
  stop_loss_atr: 80,
  long_entry_size_pct: 90,
  short_entry_size_pct: 100,
  contribution_amount: 110,
  investment_frequency: 120,
  lookback_months: 130,
  skip_recent_months: 140,
  top_n: 150,
  holding_count: 160,
  lookback_days: 170,
  signal_lookback_days: 180,
  weighting_method: 190,
  max_position_pct: 200,
  initial_position: 210,
  grid_interval: 220,
  buy_size_pct: 230,
  sell_step_pct: 240,
  sell_size_pct: 250,
  max_stop_loss_pct: 260,
  capital: 270,
};

const HIDDEN_PARAMETER_KEYS = new Set([
  'strategy_name',
  'strategy_description',
  'strategy_type',
  'universe_name',
  'benchmark_symbol',
  'rebalance_frequency',
  'deviation_threshold',
  'window_size',
  'mean_target',
  'risk_budget',
  'trading_logic',
]);

const HIDDEN_HISTORY_PARAMETER_KEYS = new Set([
  'deviation_threshold',
  'window_size',
  'mean_target',
  'risk_budget',
  'strategy_description',
]);

type ParameterCardItem = {
  key: string;
  label: string;
  value: string;
};

function strategyTypeLabel(value: string): string {
  const map: Record<string, string> = {
    MOMENTUM: '动量 / 趋势跟随',
    GRID: '网格交易',
    MEAN_REVERSION: '均值回归',
    BUY_AND_HOLD: '定投 / 持有',
    GENERAL: '通用策略',
  };
  return map[value] ?? value;
}

function strategyStatusLabel(value: string): string {
  const lowered = String(value ?? '').toLowerCase();
  if (lowered.includes('complete') || lowered.includes('done') || lowered.includes('success') || lowered === 'active') {
    return '已完成';
  }
  if (lowered.includes('pending') || lowered.includes('queued') || lowered.includes('running')) {
    return '进行中';
  }
  if (lowered.includes('fail') || lowered.includes('error')) {
    return '失败';
  }
  return value || '-';
}

function benchmarkLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized === 'SPY') return '标普 SPY';
  if (normalized === 'QQQ') return '纳指 QQQ';
  return normalized || '-';
}

function rebalanceLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').toLowerCase();
  const map: Record<string, string> = {
    never: '从不',
    daily: '每日',
    weekly: '每周',
    monthly: '每月',
    quarterly: '每季',
    semiannual: '每半年',
    yearly: '每年',
    monthly_first_trading_day: '每月首个交易日',
  };
  return map[normalized] ?? (value ? String(value) : '-');
}

function timeframeLabel(value: string): string {
  const map: Record<string, string> = {
    daily: '日线',
    weekly: '周线',
    monthly: '月线',
    hourly: '小时线',
  };
  return map[value.toLowerCase()] ?? value;
}

function parameterLabel(key: string): string {
  return PARAMETER_LABELS[key] ?? key.replace(/_/g, ' ');
}

function hasParameterValue(value: ParameterValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function formatParameterValue(key: string, value: ParameterValue): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'strategy_type') return strategyTypeLabel(String(value));
  if (key === 'benchmark_symbol') return benchmarkLabel(String(value));
  if (key === 'rebalance_frequency' || key === 'investment_frequency') return rebalanceLabel(String(value));
  if (key === 'observation_timeframe') return timeframeLabel(String(value));
  if (typeof value === 'number') {
    if (key.endsWith('_pct') || key.includes('threshold')) return `${value}%`;
    if (key.endsWith('_atr')) return `${value} ATR`;
    if (key === 'capital' || key === 'contribution_amount') return `USD ${value.toLocaleString('en-US')}`;
    return String(value);
  }
  return String(value);
}

function formatRunMetric(key: string, value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (key.includes('sharpe') || key.includes('ratio')) return formatRatio(value);
  if (key.includes('return') || key.includes('drawdown') || key.includes('rate')) return formatPercent(value);
  return value.toLocaleString('en-US');
}

function runStatusTone(status: string): 'positive' | 'warning' | 'negative' {
  const lowered = String(status ?? '').toLowerCase();
  if (lowered.includes('fail') || lowered.includes('error')) return 'negative';
  if (lowered.includes('warning')) return 'warning';
  return 'positive';
}

function runVersionLabel(value: string | null | undefined): string {
  return value ? `参数版本 ${value}` : TEXT.recentRunVersionFallback;
}

function runRangeLabel(run: ApiBacktestRunListItem): string {
  if (run.start_date && run.end_date) {
    return `${formatShortDate(run.start_date)} - ${formatShortDate(run.end_date)}`;
  }
  return TEXT.recentRunRangeFallback;
}

export function StrategyDetailPage({ strategyId }: { strategyId: string }): JSX.Element {
  const api = useApiClient();
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [recentRuns, setRecentRuns] = useState<ApiBacktestRunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openingRevision, setOpeningRevision] = useState(false);
  const [recentRunsLoading, setRecentRunsLoading] = useState(true);
  const [recentRunsError, setRecentRunsError] = useState<string | null>(null);

  const latestRun = recentRuns[0] ?? null;
  const canOpenOptimization = Boolean(strategy);
  const canEditStrategy = strategy ? (strategy.allowed_actions?.includes('edit_parameters') ?? true) : false;
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  function handleOpenOptimization(): void {
    if (!strategy) {
      return;
    }
    if (strategy.latest_optimization_job_id) {
      navigateTo(`/optimization-jobs/${strategy.latest_optimization_job_id}`);
      return;
    }
    navigateTo(
      buildOptimizationConfigPath({
        strategyId: strategy.id,
        entryPoint: 'strategy_detail',
      }),
    );
  }

  async function handleEditStrategy(): Promise<void> {
    if (!strategy || openingRevision) {
      return;
    }
    try {
      setOpeningRevision(true);
      setActionError(null);
      const session = await api.createCreationSession({
        strategy_type: strategy.strategy_type,
        mode: 'REVISION',
        base_strategy_id: strategy.id,
        base_parameter_version_id: strategy.current_parameter_version_id ?? null,
      });
      navigateTo(`/creation/sessions/${session.id}`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : TEXT.editError);
    } finally {
      setOpeningRevision(false);
    }
  }

  const heroMetaItems = useMemo(() => {
    if (!strategy) return [];
    return [
      { key: '类型', value: strategyTypeLabel(strategy.strategy_type) },
      { key: '股票池', value: strategy.universe_name || '-' },
      { key: '基准', value: benchmarkLabel(strategy.benchmark_symbol) },
      { key: '再平衡', value: rebalanceLabel(strategy.rebalance_frequency) },
      { key: '参数版本', value: strategy.current_parameter_version_id ?? '-' },
      { key: '最近运行', value: latestRun?.id ?? strategy.latest_successful_run_id ?? strategy.latest_run_id ?? '暂无' },
    ];
  }, [latestRun, strategy]);

  const tradingLogic = useMemo(() => {
    const value = strategy?.parameters?.trading_logic;
    return typeof value === 'string' && value.trim() ? value : null;
  }, [strategy]);

  const parameterCards = useMemo<ParameterCardItem[]>(() => {
    const parameters = strategy?.parameters ?? {};
    return Object.entries(parameters)
      .filter(([key, value]) => !HIDDEN_PARAMETER_KEYS.has(key) && hasParameterValue(value))
      .sort((left, right) => (PARAMETER_ORDER[left[0]] ?? 999) - (PARAMETER_ORDER[right[0]] ?? 999))
      .map(([key, value]) => ({
        key,
        label: parameterLabel(key),
        value: formatParameterValue(key, value),
      }));
  }, [strategy]);

  const parameterHistoryRows = useMemo(() => strategy?.parameter_history ?? [], [strategy]);

  const selectedHistoryEntry = useMemo(
    () => parameterHistoryRows.find((entry) => entry.parameter_version_id === selectedHistoryId) ?? null,
    [parameterHistoryRows, selectedHistoryId],
  );

  const selectedHistoryLogic = useMemo(() => {
    const value = selectedHistoryEntry?.parameters?.trading_logic;
    return typeof value === 'string' && value.trim() ? value : null;
  }, [selectedHistoryEntry]);

  const selectedHistoryCards = useMemo<ParameterCardItem[]>(() => {
    const parameters = selectedHistoryEntry?.parameters ?? {};
    return Object.entries(parameters)
      .filter(([key, value]) => !HIDDEN_HISTORY_PARAMETER_KEYS.has(key) && key !== 'trading_logic' && hasParameterValue(value))
      .sort((left, right) => (PARAMETER_ORDER[left[0]] ?? 999) - (PARAMETER_ORDER[right[0]] ?? 999))
      .map(([key, value]) => ({
        key,
        label: parameterLabel(key),
        value: formatParameterValue(key, value),
      }));
  }, [selectedHistoryEntry]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const payload = await api.getStrategyDetail(strategyId);
        if (!cancelled) setStrategy(payload);
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, strategyId]);

  useEffect(() => {
    let cancelled = false;

    async function loadRecentRuns(): Promise<void> {
      try {
        setRecentRunsLoading(true);
        setRecentRunsError(null);
        const payload = await api.listBacktestRuns({ limit: 24 });
        if (cancelled) {
          return;
        }
        const filtered = payload
          .filter((item) => item.strategy_id === strategyId)
          .sort((left, right) => {
            const leftTime = new Date(left.completed_at ?? left.updated_at ?? left.created_at ?? 0).getTime();
            const rightTime = new Date(right.completed_at ?? right.updated_at ?? right.created_at ?? 0).getTime();
            return rightTime - leftTime;
          })
          .slice(0, 6);
        setRecentRuns(filtered);
      } catch (caught) {
        if (!cancelled) {
          setRecentRuns([]);
          setRecentRunsError(caught instanceof Error ? caught.message : TEXT.emptyRun);
        }
      } finally {
        if (!cancelled) {
          setRecentRunsLoading(false);
        }
      }
    }

    void loadRecentRuns();
    return () => {
      cancelled = true;
    };
  }, [api, strategyId]);

  if (loading) {
    return (
      <section className="panel strategy-detail-page">
        <div className="panel-header">
          <h2>{TEXT.title}</h2>
        </div>
        <p className="hero-copy">{TEXT.loading}</p>
      </section>
    );
  }

  if (error || !strategy) {
    return (
      <section className="panel strategy-detail-page">
        <div className="panel-header">
          <h2>{TEXT.title}</h2>
        </div>
        <p className="hero-copy">{error ?? TEXT.loadError}</p>
      </section>
    );
  }

  return (
    <div className="stack strategy-detail-page">
      <section className="strategy-detail-hero panel">
        <div className="strategy-detail-hero__copy">
          <p className="eyebrow">{TEXT.eyebrow}</p>
          <h1 className="strategy-detail-hero__title">{strategy.name}</h1>
          <div className="strategy-detail-hero__meta">
            {heroMetaItems.map((item) => (
              <span className="status-chip status-chip--soft" key={item.key}>
                {item.key}: {item.value}
              </span>
            ))}
            {latestRun ? <span className="status-chip status-chip--soft">状态: {strategyStatusLabel(latestRun.status)}</span> : null}
          </div>
        </div>
        <div className="strategy-detail-hero__actions">
          <button
            className="primary-button"
            disabled={!canEditStrategy || openingRevision}
            onClick={() => void handleEditStrategy()}
            type="button"
          >
            {TEXT.editStrategy}
          </button>
          <button className="ghost-button" onClick={() => navigateTo(`/strategies/${strategy.id}/backtest-runs/new`)} type="button">
            {TEXT.runBacktest}
          </button>
          <button
            className="ghost-button"
            disabled={!canOpenOptimization}
            onClick={handleOpenOptimization}
            type="button"
          >
            {TEXT.openOptimization}
          </button>
        </div>
      </section>

      {actionError ? <div className="error-banner">{actionError}</div> : null}

      <div className="strategy-detail-main-grid">
        <div className="strategy-detail-content-stack">
          <section className="panel strategy-detail-parameters-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.parameterTitle}</p>
                <h3>{TEXT.parameterTitle}</h3>
                <p className="creation-panel-copy">{TEXT.parameterCopy}</p>
              </div>
            </div>
            {tradingLogic || parameterCards.length ? (
              <div className="strategy-detail-parameter-grid">
                {tradingLogic ? (
                  <article className="strategy-detail-parameter-card strategy-detail-parameter-card--logic">
                    <span>{parameterLabel('trading_logic')}</span>
                    <strong>{tradingLogic}</strong>
                  </article>
                ) : null}
                {parameterCards.map((parameter) => (
                  <article className="strategy-detail-parameter-card" key={parameter.key}>
                    <span>{parameter.label}</span>
                    <strong>{parameter.value}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">{TEXT.emptyParameters}</p>
            )}
          </section>

          <section className="panel strategy-detail-history-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.historyTitle}</p>
                <h3>{TEXT.historyTitle}</h3>
                <p className="creation-panel-copy">{TEXT.historyCopy}</p>
              </div>
            </div>
            {parameterHistoryRows.length ? (
              <div className="table-shell strategy-detail-history-table-shell">
                <table className="strategy-detail-history-table">
                  <thead>
                    <tr>
                      <th>版本</th>
                      <th>参数版本 ID</th>
                      <th>修订</th>
                      <th>更新时间</th>
                      <th>备注</th>
                      <th>字段数</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parameterHistoryRows.map((entry) => (
                      <tr key={entry.parameter_version_id}>
                        <td>
                          <strong>v{entry.version_number}</strong>
                        </td>
                        <td>{entry.parameter_version_id}</td>
                        <td>{entry.revision}</td>
                        <td>{entry.created_at ? formatDateTime(entry.created_at) : '-'}</td>
                        <td className="strategy-detail-history-table__comment">{entry.comment ?? TEXT.historyFallbackComment}</td>
                        <td>{Object.keys(entry.parameters ?? {}).length}</td>
                        <td>
                          <button className="text-button" onClick={() => setSelectedHistoryId(entry.parameter_version_id)} type="button">
                            {TEXT.historyOpenDetail}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">{TEXT.emptyHistory}</p>
            )}
          </section>
        </div>

        <aside className="strategy-detail-sidebar">
          <section className="panel strategy-detail-side-panel strategy-detail-side-panel--recent-run">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.recentRunTitle}</p>
                <h3>{TEXT.recentRunTitle}</h3>
                <p className="creation-panel-copy">{TEXT.recentRunCopy}</p>
              </div>
            </div>
            {recentRunsLoading ? (
              <ol className="workspace-recent-runs__timeline strategy-detail-run-timeline" aria-label={TEXT.recentRunTitle}>
                {Array.from({ length: 3 }, (_, index) => (
                  <li className="workspace-recent-runs__item workspace-recent-runs__item--skeleton" key={index}>
                    <div className="workspace-recent-runs__card workspace-recent-runs__card--skeleton" />
                  </li>
                ))}
              </ol>
            ) : recentRuns.length ? (
              <ol className="workspace-recent-runs__timeline strategy-detail-run-timeline" aria-label={TEXT.recentRunTitle}>
                {recentRuns.map((run) => {
                  const tone = runStatusTone(run.status);
                  return (
                    <li className={`workspace-recent-runs__item workspace-recent-runs__item--${tone}`} key={run.id}>
                      <span className={`workspace-recent-runs__rail-dot workspace-recent-runs__rail-dot--${tone}`} aria-hidden="true" />
                      <button
                        className="workspace-recent-runs__card gsl-card strategy-detail-run-card"
                        onClick={() => navigateTo(`/runs/${run.id}`)}
                        type="button"
                      >
                        <div className="workspace-recent-runs__row-top">
                          <div className="workspace-recent-runs__identity">
                            <span className="workspace-recent-runs__run-id">{run.id}</span>
                          </div>
                          <span className={`workspace-recent-runs__status workspace-recent-runs__status--${tone}`}>
                            {strategyStatusLabel(run.status)}
                          </span>
                        </div>
                        <h4 className="workspace-recent-runs__strategy">{runVersionLabel(run.parameter_version_id)}</h4>
                        <p className="workspace-recent-runs__period">{runRangeLabel(run)}</p>
                        <div className="workspace-recent-runs__badge-row">
                          <div className="workspace-recent-runs__badges">
                            <span
                              className={`workspace-recent-runs__badge workspace-recent-runs__badge--${
                                Number(run.metrics?.total_return ?? 0) >= 0 ? 'positive' : 'negative'
                              }`}
                            >
                              {TEXT.totalReturn} {formatRunMetric('total_return', run.metrics?.total_return)}
                            </span>
                            <span className="workspace-recent-runs__badge workspace-recent-runs__badge--neutral">
                              {TEXT.sharpe} {formatRunMetric('sharpe', run.metrics?.sharpe)}
                            </span>
                          </div>
                          <span className="workspace-recent-runs__completed">
                            {run.completed_at ? formatDateTime(run.completed_at) : '-'}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : recentRunsError ? (
              <p className="empty-state">{recentRunsError}</p>
            ) : (
              <p className="empty-state">{TEXT.emptyRun}</p>
            )}
          </section>
        </aside>
      </div>

      {selectedHistoryEntry ? (
        <div
          aria-label={TEXT.historyDetailTitle}
          className="modal-shell"
          onClick={() => setSelectedHistoryId(null)}
          role="dialog"
        >
          <div className="modal-card strategy-detail-history-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.historyDetailTitle}</p>
                <h3>{selectedHistoryEntry.parameter_version_id}</h3>
                <p className="creation-panel-copy">
                  创建时间: {selectedHistoryEntry.created_at ? formatDateTime(selectedHistoryEntry.created_at) : '-'}，字段数:{' '}
                  {Object.keys(selectedHistoryEntry.parameters ?? {}).length}
                </p>
              </div>
              <div className="hero-actions">
                <span className="status-chip status-chip--soft">修订 {selectedHistoryEntry.revision}</span>
                <button className="ghost-button" onClick={() => setSelectedHistoryId(null)} type="button">
                  {TEXT.historyDetailClose}
                </button>
              </div>
            </div>
            {selectedHistoryLogic || selectedHistoryCards.length ? (
              <div className="strategy-detail-parameter-grid strategy-detail-parameter-grid--history">
                {selectedHistoryLogic ? (
                  <article className="strategy-detail-parameter-card strategy-detail-parameter-card--logic">
                    <span>{parameterLabel('trading_logic')}</span>
                    <strong>{selectedHistoryLogic}</strong>
                  </article>
                ) : null}
                {selectedHistoryCards.map((parameter) => (
                  <article className="strategy-detail-parameter-card" key={`${selectedHistoryEntry.parameter_version_id}-${parameter.key}`}>
                    <span>{parameter.label}</span>
                    <strong>{parameter.value}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">{TEXT.historyDetailEmpty}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
