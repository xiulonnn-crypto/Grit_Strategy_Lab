import { formatPercent, formatRatio } from './format';
import type {
  ApiBacktestRunDetail,
  ApiStrategyDetail,
  ApiStrategyLatestCompletedRunSummary,
  ApiStrategyListItem,
  ParameterValue,
} from '../types';

export type WorkspaceStrategyCardVM = {
  id: string;
  name: string;
  strategyType: string;
  universeName: string;
  parameterVersion: number;
  parameterVersionId: string | null;
  latestOptimizationJobId: string | null;
  latestRunId?: string | null;
  compareEligible: boolean;
  compareBlocker: string | null;
  cardState: 'READY' | 'PENDING_RUN' | 'RUNNING_CURRENT_VERSION';
  parameters: Record<string, ParameterValue>;
  sparklinePoints?: Array<{ date: string; equity: number; isOos: boolean }>;
  summary?: {
    totalReturn: string;
    annualizedReturn: string;
    sharpe: string;
    maxDrawdown: string;
    oosTotalReturn: string;
    oosSharpe: string;
  } | null;
  auxiliaryCopy?: string;
  metaPrimary?: string;
  metaSecondary?: string;
  metaTimestamp?: string | null;
};

export type ParameterDiffRow = {
  key: string;
  previousValue: ParameterValue | undefined;
  nextValue: ParameterValue | undefined;
};

const STRATEGY_TYPE_LABELS: Record<string, string> = {
  MOMENTUM: '动量',
  GRID: '网格',
  MEAN_REVERSION: '均值回归',
  BUY_AND_HOLD: '买入持有',
  GENERAL: '通用',
  momentum: '动量',
  grid: '网格',
  mean_reversion: '均值回归',
  buy_and_hold: '买入持有',
  general: '通用',
  quality_momentum: '质量动量',
};

const PARAMETER_LABELS: Record<string, string> = {
  benchmark_symbol: '基准',
  buy_step_pct: '买入步长(%)',
  capital: '初始资金(USD)',
  contribution_amount: '定投金额(USD)',
  contribution_anchor: '定投执行锚点',
  dynamic_investment_logic: '动态定投逻辑',
  grid_count: '网格数量',
  hold_rank_threshold: '保留排名阈值',
  investment_frequency: '定投频率',
  lookback_months: '动量回看(月)',
  max_position_pct: '单标的上限(%)',
  max_stop_loss_pct: '最大止损仓位(%)',
  mean_target: '回归目标',
  rebalance_anchor_dates: '调仓锚点',
  rebalance_frequency: '调仓频率',
  risk_budget: '风险预算(%)',
  sell_size_pct: '上涨卖出仓位(%)',
  sell_step_pct: '卖出步长(%)',
  skip_recent_months: '跳过最近(月)',
  strategy_description: '策略描述',
  strategy_name: '策略名称',
  strategy_type: '策略类型',
  top_n: '买入排名阈值',
  universe_name: '股票池',
  weighting_method: '权重方法',
};

const PARAMETER_VALUE_LABELS: Record<string, string> = {
  BUY_AND_HOLD: '买入持有',
  GENERAL: '通用',
  GRID: '网格',
  MEAN_REVERSION: '均值回归',
  MOMENTUM: '动量',
  buy_and_hold: '买入持有',
  daily: '每天',
  equal_weight: '等权',
  mean_reversion: '均值回归',
  monthly: '每月',
  never: '从不',
  quarterly: '每季度',
  quality_momentum: '质量动量',
  risk_parity: '风险平价',
  score_weighted: '按动量分数加权',
  semiannual: '每半年',
  volatility_adjusted: '波动率调整',
  weekly: '每周',
  yearly: '每年',
};

function getStrategyTypeLabel(strategyType: string): string {
  return STRATEGY_TYPE_LABELS[strategyType] ?? strategyType;
}

type UnknownRecord = Record<string, unknown>;

function readString(record: UnknownRecord | undefined, keys: string[]): string | null {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function formatCardTimestamp(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const isoWithTime = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (isoWithTime) {
    return `${Number(isoWithTime[2])}月${Number(isoWithTime[3])}日 ${isoWithTime[4]}:${isoWithTime[5]}`;
  }

  const isoDateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateOnly) {
    return `${Number(isoDateOnly[2])}月${Number(isoDateOnly[3])}日`;
  }

  return null;
}

function buildMetaPrimary(
  strategy: ApiStrategyListItem,
  detail: ApiStrategyDetail | undefined,
  latestRunDetail: ApiBacktestRunDetail | undefined,
  latestCompletedRunSummary: ApiStrategyLatestCompletedRunSummary | null | undefined,
): string {
  const executionPolicy =
    latestCompletedRunSummary?.execution_policy ??
    readString(latestRunDetail?.configuration as UnknownRecord | undefined, ['execution_policy', 'executionPolicy']) ??
    readString(latestRunDetail?.request as UnknownRecord | undefined, ['execution_policy', 'executionPolicy']);

  if (executionPolicy) {
    return `执行策略 ${executionPolicy}`;
  }

  const universeName = detail?.universe_name ?? strategy.universe_name;
  const strategyType = detail?.strategy_type ?? strategy.strategy_type;
  return `股票池 ${universeName} · ${getStrategyTypeLabel(strategyType)}`;
}

function buildMetaSecondary(
  strategy: ApiStrategyListItem,
  detail: ApiStrategyDetail | undefined,
  latestRunDetail: ApiBacktestRunDetail | undefined,
  latestCompletedRunSummary: ApiStrategyLatestCompletedRunSummary | null | undefined,
  parameterVersion: number,
): string {
  const summaryDatasetSnapshotId = latestCompletedRunSummary?.dataset_snapshot_id?.trim() ?? '';
  const summaryUniverseSnapshotId = latestCompletedRunSummary?.universe_snapshot_id?.trim() ?? '';

  if (summaryDatasetSnapshotId && summaryUniverseSnapshotId) {
    return `快照 ${summaryDatasetSnapshotId} / ${summaryUniverseSnapshotId}`;
  }
  if (summaryDatasetSnapshotId) {
    return `数据快照 ${summaryDatasetSnapshotId}`;
  }
  if (summaryUniverseSnapshotId) {
    return `股票池快照 ${summaryUniverseSnapshotId}`;
  }

  const snapshotSummary = latestRunDetail?.snapshot_summary as UnknownRecord | undefined;
  const datasetSnapshotId = readString(snapshotSummary, ['dataset_snapshot_id', 'datasetSnapshotId']);
  const universeSnapshotId = readString(snapshotSummary, ['universe_snapshot_id', 'universeSnapshotId']);

  if (datasetSnapshotId && universeSnapshotId) {
    return `快照 ${datasetSnapshotId} / ${universeSnapshotId}`;
  }
  if (datasetSnapshotId) {
    return `数据快照 ${datasetSnapshotId}`;
  }
  if (universeSnapshotId) {
    return `股票池快照 ${universeSnapshotId}`;
  }

  return `参数版本 ${detail?.current_parameter_version_id ?? strategy.current_parameter_version_id ?? `v${parameterVersion}`}`;
}

export function buildWorkspaceStrategyCards(
  strategies: ApiStrategyListItem[],
  details: Record<string, ApiStrategyDetail>,
  latestRunDetails: Record<string, ApiBacktestRunDetail>,
): WorkspaceStrategyCardVM[] {
  return strategies.map((strategy) => {
    const detail = details[strategy.id];
    const latestCompletedRunSummary = strategy.latest_completed_run_summary;
    const latestRunId =
      latestCompletedRunSummary?.run_id ??
      detail?.latest_successful_run_id ??
      strategy.latest_successful_run_id ??
      strategy.latest_run_id ??
      null;
    const latestRunDetail = latestRunId ? latestRunDetails[latestRunId] : undefined;
    const parameterVersion = detail?.current_parameter_version ?? strategy.current_parameter_version ?? 1;
    const compareEligible = Boolean(latestRunId);
    const compareBlocker = compareEligible ? null : '当前参数版本还没有正式回测，暂时不能加入对比。';
    const latestStatus =
      latestCompletedRunSummary?.status ??
      latestRunDetail?.status ??
      detail?.lifecycle_status ??
      strategy.lifecycle_status ??
      'PENDING_RUN';
    const detailMetrics = latestRunDetail?.metrics ?? {};
    const summary = latestRunDetail || latestCompletedRunSummary
      ? {
          totalReturn: formatPercent(latestCompletedRunSummary?.total_return ?? detailMetrics.total_return ?? 0),
          annualizedReturn: formatPercent(
            latestCompletedRunSummary?.annualized_return ?? detailMetrics.annualized_return ?? 0,
          ),
          sharpe: formatRatio(latestCompletedRunSummary?.sharpe ?? detailMetrics.sharpe ?? 0),
          maxDrawdown: formatPercent(latestCompletedRunSummary?.max_drawdown ?? detailMetrics.max_drawdown ?? 0),
          oosTotalReturn: formatPercent(
            latestCompletedRunSummary?.oos_total_return ??
              detailMetrics.oos_total_return ??
              detailMetrics.oos_return ??
              0,
          ),
          oosSharpe: formatRatio(latestCompletedRunSummary?.oos_sharpe ?? detailMetrics.oos_sharpe ?? 0),
        }
      : null;

    return {
      id: strategy.id,
      name: strategy.name,
      strategyType: detail?.strategy_type ?? strategy.strategy_type,
      universeName: detail?.universe_name ?? strategy.universe_name,
      parameterVersion,
      parameterVersionId: detail?.current_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
      latestOptimizationJobId: detail?.latest_optimization_job_id ?? strategy.latest_optimization_job_id ?? null,
      latestRunId,
      compareEligible,
      compareBlocker,
      cardState:
        latestStatus === 'RUNNING' ? 'RUNNING_CURRENT_VERSION' : compareEligible ? 'READY' : 'PENDING_RUN',
      parameters: detail?.parameters ?? strategy.parameters ?? {},
      sparklinePoints:
        latestRunDetail?.chart_series?.map((point) => ({
          date: point.trade_date,
          equity: point.equity,
          isOos: point.is_oos,
        })) ??
        latestCompletedRunSummary?.sparkline_points?.map((point) => ({
          date: point.date,
          equity: point.equity,
          isOos: point.is_oos,
        })) ??
        [],
      summary,
      auxiliaryCopy: compareEligible ? '当前参数版本已可加入对比。' : compareBlocker ?? undefined,
      metaPrimary: buildMetaPrimary(strategy, detail, latestRunDetail, latestCompletedRunSummary),
      metaSecondary: buildMetaSecondary(strategy, detail, latestRunDetail, latestCompletedRunSummary, parameterVersion),
      metaTimestamp: formatCardTimestamp(
        detail?.updated_at ??
          strategy.updated_at ??
          detail?.created_at ??
          strategy.created_at ??
          latestRunDetail?.updated_at ??
          latestRunDetail?.created_at ??
          latestCompletedRunSummary?.completed_at ??
          null,
      ),
    };
  });
}

export function buildParameterDiffRows(
  baseline: Record<string, ParameterValue>,
  candidate: Record<string, ParameterValue>,
): ParameterDiffRow[] {
  const rows: ParameterDiffRow[] = [];
  for (const key of [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort()) {
    const previousValue = baseline[key];
    const nextValue = candidate[key];
    if (previousValue !== nextValue) {
      rows.push({ key, previousValue, nextValue });
    }
  }
  return rows;
}

export function buildRecentRunScore(run?: ApiBacktestRunDetail): {
  totalReturn: string;
  annualizedReturn: string;
  sharpe: string;
} {
  const metrics = run?.metrics ?? {};
  const annualizedReturnValue =
    typeof metrics.annualized_return === 'number' && Number.isFinite(metrics.annualized_return)
      ? metrics.annualized_return
      : typeof metrics.cagr === 'number' && Number.isFinite(metrics.cagr)
        ? metrics.cagr
        : null;

  return {
    totalReturn: formatPercent(metrics.total_return ?? 0),
    annualizedReturn: annualizedReturnValue === null ? '待补充' : formatPercent(annualizedReturnValue),
    sharpe: formatRatio(metrics.sharpe ?? 0),
  };
}

export function formatParameterLabel(key: string): string {
  return PARAMETER_LABELS[key] ?? key;
}

export function formatParameterValue(value: ParameterValue | undefined, key?: string): string {
  if (value === null) {
    return '空';
  }
  if (value === undefined) {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return '-';
    }
    if (key === 'strategy_type') {
      return STRATEGY_TYPE_LABELS[normalized] ?? STRATEGY_TYPE_LABELS[normalized.toUpperCase()] ?? normalized;
    }
    return PARAMETER_VALUE_LABELS[normalized] ?? normalized;
  }
  return String(value);
}
