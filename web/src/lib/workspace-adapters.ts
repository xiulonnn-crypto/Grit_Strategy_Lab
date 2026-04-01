import { formatPercent, formatRatio } from './format';
import type { ApiBacktestRunDetail, ApiStrategyDetail, ApiStrategyListItem, ParameterValue } from '../types';

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
): string {
  const executionPolicy =
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
  parameterVersion: number,
): string {
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
    const latestRunId = detail?.latest_successful_run_id ?? strategy.latest_successful_run_id ?? strategy.latest_run_id ?? null;
    const latestRunDetail = latestRunId ? latestRunDetails[latestRunId] : undefined;
    const parameterVersion = detail?.current_parameter_version ?? strategy.current_parameter_version ?? 1;
    const compareEligible = Boolean(latestRunId);
    const compareBlocker = compareEligible ? null : '当前参数版本还没有正式回测，暂时不能加入对比。';
    const latestStatus = latestRunDetail?.status ?? detail?.lifecycle_status ?? strategy.lifecycle_status ?? 'PENDING_RUN';
    const metrics = latestRunDetail?.metrics ?? {};
    const summary = latestRunDetail
      ? {
          totalReturn: formatPercent(metrics.total_return ?? 0),
          annualizedReturn: formatPercent(metrics.annualized_return ?? 0),
          sharpe: formatRatio(metrics.sharpe ?? 0),
          maxDrawdown: formatPercent(metrics.max_drawdown ?? 0),
          oosTotalReturn: formatPercent(metrics.oos_total_return ?? metrics.oos_return ?? 0),
          oosSharpe: formatRatio(metrics.oos_sharpe ?? 0),
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
        })) ?? [],
      summary,
      auxiliaryCopy: compareEligible ? '当前参数版本已可加入对比。' : compareBlocker,
      metaPrimary: buildMetaPrimary(strategy, detail, latestRunDetail),
      metaSecondary: buildMetaSecondary(strategy, detail, latestRunDetail, parameterVersion),
      metaTimestamp: formatCardTimestamp(
        latestRunDetail?.completed_at ?? latestRunDetail?.updated_at ?? latestRunDetail?.created_at ?? null,
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

export function buildRecentRunScore(run?: ApiBacktestRunDetail): { totalReturn: string; sharpe: string } {
  const metrics = run?.metrics ?? {};
  return {
    totalReturn: formatPercent(metrics.total_return ?? 0),
    sharpe: formatRatio(metrics.sharpe ?? 0),
  };
}

export function formatParameterValue(value: ParameterValue | undefined): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}