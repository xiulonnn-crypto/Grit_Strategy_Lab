import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatDateTime, formatPercent, formatRatio, formatShortDate } from '../lib/format';
import { buildOptimizationConfigPath } from '../lib/optimization-routes';
import { formatParameterLabel as formatSharedParameterLabel, formatParameterValue as formatSharedParameterValue } from '../lib/adapters';
import { formatStrategyVersionTag, getStrategyDisplayName } from '../lib/strategy-version';
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
  recentRunVersionFallback: '版本待补充',
} as const;

const DYNAMIC_BUY_AND_HOLD_RUNTIME_WARNING =
  '当前回测引擎尚未接入动态定投所需的估值/基本面时间序列，dynamic_investment_logic 未执行；结果暂按固定金额定投计算。';

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
  contribution_anchor: '定投执行锚点',
  dynamic_investment_logic: '动态定投逻辑',
  lookback_months: '回看月数',
  skip_recent_months: '跳过最近月数',
  hold_rank_threshold: '保留排名阈值',
  top_n: '入选数量',
  weighting_method: '权重方式',
  rebalance_anchor_dates: '调仓锚点',
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
  contribution_anchor: 125,
  dynamic_investment_logic: 126,
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
  'dynamic_investment_proxy_key',
  'dynamic_investment_metric_key',
  'dynamic_investment_rules',
]);

const HIDDEN_HISTORY_PARAMETER_KEYS = new Set([
  'deviation_threshold',
  'window_size',
  'mean_target',
  'risk_budget',
  'strategy_description',
  'dynamic_investment_proxy_key',
  'dynamic_investment_metric_key',
  'dynamic_investment_rules',
]);

const HISTORY_COMMENT_LABELS: Record<string, string> = {
  'Initial import.': '初始导入。',
  'Promoted after tuning the current settings.': '调优当前设置后晋升为正式版本。',
};

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
  if (PARAMETER_LABELS[key]) {
    return PARAMETER_LABELS[key];
  }
  const sharedLabel = formatSharedParameterLabel(key);
  return sharedLabel !== key ? sharedLabel : key.replace(/_/g, ' ');
}

function historyCommentLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return TEXT.historyFallbackComment;
  }
  return HISTORY_COMMENT_LABELS[normalized] ?? normalized;
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
    if (key.endsWith('_pct') || ['rsi_buy_threshold', 'rsi_sell_threshold', 'deviation_threshold'].includes(key)) {
      return `${value}%`;
    }
    if (key.endsWith('_atr')) return `${value} ATR`;
    if (key === 'capital' || key === 'contribution_amount') return `${value.toLocaleString('zh-HK')} 美元`;
    return String(value);
  }
  if (typeof value === 'boolean') {
    return formatSharedParameterValue(value, key);
  }
  if (typeof value === 'string') {
    return formatSharedParameterValue(value, key);
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

function runVersionTag(value: string | null | undefined): string {
  return formatStrategyVersionTag(value) ?? TEXT.recentRunVersionFallback;
}

function runRangeLabel(run: ApiBacktestRunListItem): string {
  if (run.start_date && run.end_date) {
    return `${formatShortDate(run.start_date)} - ${formatShortDate(run.end_date)}`;
  }
  return TEXT.recentRunRangeFallback;
}

function readStringParameter(value: ParameterValue | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function readNumberParameter(value: ParameterValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && /^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function rebalanceSummaryLabel(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const map: Record<string, string> = {
    never: '不主动再平衡',
    daily: '按日调仓',
    weekly: '按周调仓',
    monthly: '按月调仓',
    quarterly: '按季度调仓',
    semiannual: '每半年调仓',
    yearly: '按年调仓',
    monthly_first_trading_day: '每月首个交易日调仓',
  };
  return map[normalized] ?? `按 ${value} 调仓`;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '基于当前参数执行策略。';
  }
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function buildStrategySummary(strategy: ApiStrategyDetail): string {
  const parameters = strategy.parameters ?? {};
  const universe =
    strategy.universe_name?.trim() ||
    readStringParameter(parameters.universe_name) ||
    '当前股票池';
  const rawBenchmark =
    strategy.benchmark_symbol?.trim() ||
    readStringParameter(parameters.benchmark_symbol);
  const benchmark = rawBenchmark ? benchmarkLabel(rawBenchmark) : null;
  const includeBenchmark = Boolean(
    benchmark &&
      benchmark !== '-' &&
      rawBenchmark &&
      !universe.toUpperCase().includes(rawBenchmark.toUpperCase()) &&
      !universe.includes(benchmark),
  );
  const rebalance = rebalanceSummaryLabel(
    strategy.rebalance_frequency ?? readStringParameter(parameters.rebalance_frequency),
  );
  const weightingMethod = readStringParameter(parameters.weighting_method);
  const weightingLabel =
    weightingMethod && weightingMethod !== '-'
      ? formatSharedParameterValue(weightingMethod, 'weighting_method')
      : null;

  const parts: string[] = [];

  if (strategy.strategy_type === 'MOMENTUM') {
    const lookbackMonths = readNumberParameter(parameters.lookback_months);
    const skipRecentMonths = readNumberParameter(parameters.skip_recent_months);
    const topN = readNumberParameter(parameters.top_n);
    const holdRankThreshold = readNumberParameter(parameters.hold_rank_threshold);

    if (lookbackMonths !== null) {
      parts.push(
        skipRecentMonths !== null && skipRecentMonths > 0
          ? `按过去 ${lookbackMonths} 个月剔除最近 ${skipRecentMonths} 个月的收益做动量排序`
          : `按过去 ${lookbackMonths} 个月收益做动量排序`,
      );
    } else {
      parts.push('执行动量轮动');
    }

    if (topN !== null) {
      if (holdRankThreshold !== null && holdRankThreshold >= topN) {
        parts.push(`持有前 ${topN} 名，跌出前 ${holdRankThreshold} 名时调出`);
      } else {
        parts.push(`持有前 ${topN} 名`);
      }
    } else if (holdRankThreshold !== null) {
      parts.push(`以排名前 ${holdRankThreshold} 名作为持仓阈值`);
    }
  } else if (strategy.strategy_type === 'MEAN_REVERSION') {
    const timeframe = readStringParameter(parameters.observation_timeframe);
    const bollingerPeriod = readNumberParameter(parameters.bollinger_period);
    const rsiPeriod = readNumberParameter(parameters.rsi_period);
    const rsiBuyThreshold = readNumberParameter(parameters.rsi_buy_threshold);
    const rsiSellThreshold = readNumberParameter(parameters.rsi_sell_threshold);
    const longEntrySize = readNumberParameter(parameters.long_entry_size_pct);
    const shortEntrySize = readNumberParameter(parameters.short_entry_size_pct);

    parts.push(`基于${timeframe ? timeframeLabel(timeframe) : '当前'}信号做均值回归交易`);

    if (bollingerPeriod !== null && rsiPeriod !== null) {
      parts.push(`结合 ${bollingerPeriod} 期布林带与 RSI(${rsiPeriod}) 判断偏离`);
    } else if (rsiPeriod !== null) {
      parts.push(`使用 RSI(${rsiPeriod}) 识别偏离`);
    } else if (bollingerPeriod !== null) {
      parts.push(`使用 ${bollingerPeriod} 期布林带识别偏离`);
    }

    if (rsiBuyThreshold !== null && rsiSellThreshold !== null) {
      parts.push(`RSI 低于 ${rsiBuyThreshold} 时分批买入，高于 ${rsiSellThreshold} 时分批减仓`);
    }

    if (longEntrySize !== null || shortEntrySize !== null) {
      if (longEntrySize !== null && shortEntrySize !== null && longEntrySize === shortEntrySize) {
        parts.push(`每次按 ${longEntrySize}% 仓位进出`);
      } else {
        if (longEntrySize !== null) {
          parts.push(`买入仓位 ${longEntrySize}%`);
        }
        if (shortEntrySize !== null) {
          parts.push(`卖出仓位 ${shortEntrySize}%`);
        }
      }
    }
  } else if (strategy.strategy_type === 'GRID') {
    const gridInterval = readNumberParameter(parameters.grid_interval);
    const initialPosition = readNumberParameter(parameters.initial_position);
    const buySize = readNumberParameter(parameters.buy_size_pct);
    const sellStep = readNumberParameter(parameters.sell_step_pct);
    const sellSize = readNumberParameter(parameters.sell_size_pct);
    const maxStopLoss = readNumberParameter(parameters.max_stop_loss_pct);

    parts.push(
      gridInterval !== null ? `按 ${gridInterval}% 网格间距分批交易` : '按网格规则分批交易',
    );

    if (initialPosition !== null) {
      parts.push(`初始仓位 ${initialPosition}%`);
    }
    if (gridInterval !== null && buySize !== null) {
      parts.push(`每下跌 ${gridInterval}% 加仓 ${buySize}%`);
    } else if (buySize !== null) {
      parts.push(`每次加仓 ${buySize}%`);
    }
    if (sellStep !== null && sellSize !== null) {
      parts.push(`每上涨 ${sellStep}% 减仓 ${sellSize}%`);
    } else if (sellSize !== null) {
      parts.push(`每次减仓 ${sellSize}%`);
    }
    if (maxStopLoss !== null) {
      parts.push(`最大止损 ${maxStopLoss}%`);
    }
  } else if (strategy.strategy_type === 'BUY_AND_HOLD') {
    const contributionAmount = readNumberParameter(parameters.contribution_amount);
    const investmentFrequency = readStringParameter(parameters.investment_frequency);
    const contributionAnchor = readStringParameter(parameters.contribution_anchor);
    const dynamicInvestmentLogic = readStringParameter(parameters.dynamic_investment_logic);

    parts.push('长期持有核心资产');
    if (contributionAmount !== null && investmentFrequency) {
      parts.push(
        `${rebalanceLabel(investmentFrequency)}${dynamicInvestmentLogic ? '基准定投' : '定投'} ${contributionAmount.toLocaleString('zh-HK')} 美元`,
      );
    } else if (contributionAmount !== null) {
      parts.push(`${dynamicInvestmentLogic ? '基准投入' : '投入'} ${contributionAmount.toLocaleString('zh-HK')} 美元`);
    }
    if (contributionAnchor) {
      parts.push(`按${contributionAnchor}执行`);
    }
    if (dynamicInvestmentLogic) {
      parts.push('按估值区间动态调整投入倍率');
    }
  } else {
    parts.push(`执行${strategyTypeLabel(strategy.strategy_type)}策略`);
  }

  if (weightingLabel && weightingLabel !== '-') {
    parts.push(`按${weightingLabel}配置`);
  }
  if (rebalance) {
    parts.push(rebalance);
  }
  if (includeBenchmark && benchmark) {
    parts.push(`基准为${benchmark}`);
  }

  const filteredParts = parts
    .map((part) => part.trim())
    .filter((part, index, allParts) => part.length > 0 && allParts.indexOf(part) === index);

  if (filteredParts.length) {
    const [firstPart, ...restParts] = filteredParts;
    return ensureSentence(`在${universe}中${[firstPart, ...restParts].join('，')}`);
  }

  const fallbackDescription =
    readStringParameter(parameters.strategy_description) ??
    (typeof strategy.description === 'string' ? strategy.description.trim() : null);
  if (fallbackDescription) {
    return ensureSentence(fallbackDescription);
  }

  return ensureSentence(`在${universe}中执行当前策略`);
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

  const strategySummary = useMemo(() => (strategy ? buildStrategySummary(strategy) : ''), [strategy]);
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
          <div className="strategy-detail-hero__title-row">
            <h1 className="strategy-detail-hero__title">{getStrategyDisplayName(strategy.name, strategy.id)}</h1>
            {formatStrategyVersionTag(strategy.current_parameter_version_id) ? (
              <span aria-hidden="true" className="status-chip status-chip--soft strategy-detail-hero__version">
                {formatStrategyVersionTag(strategy.current_parameter_version_id)}
              </span>
            ) : null}
          </div>
          <p className="strategy-detail-hero__summary">{strategySummary}</p>
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
                      <th>参数版本编号</th>
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
                        <td>{entry.created_at ? formatDateTime(entry.created_at) : '-'}</td>
                        <td className="strategy-detail-history-table__comment">{historyCommentLabel(entry.comment)}</td>
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
                  const versionTag = runVersionTag(run.parameter_version_id);
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
                        <div className="workspace-recent-runs__strategy-row">
                          <h4 className="workspace-recent-runs__strategy">{getStrategyDisplayName(strategy.name, strategy.id)}</h4>
                          {versionTag ? <span className="workspace-recent-runs__version">{versionTag}</span> : null}
                        </div>
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
          aria-modal="true"
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
            </div>
            <div className="strategy-detail-history-modal__meta">
              <span className="status-chip status-chip--soft">修订 {selectedHistoryEntry.revision}</span>
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
            <div className="modal-card__footer">
              <button className="ghost-button" onClick={() => setSelectedHistoryId(null)} type="button">
                {TEXT.historyDetailClose}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
