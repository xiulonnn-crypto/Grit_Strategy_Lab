import type {
  ApiAssetLeg,
  ApiBacktestRunTradeAudit,
  ApiCashLeg,
  ApiCompositionDetail,
  ApiFactorDetail,
  ApiOptimizationCandidate,
  ApiOptimizationJobDetail,
  ApiStrategyCreationSession,
  ApiStrategyDetail,
  ParameterValue,
} from '../types';
import { buildParameterDiffRows } from './adapters';
import { stripStrategyVersionSuffix } from './strategy-version';

export type DemoState = {
  strategies: ApiStrategyDetail[];
  assetLegs: ApiAssetLeg[];
  cashLegs: ApiCashLeg[];
  compositions: ApiCompositionDetail[];
  factors: ApiFactorDetail[];
  optimizationJobs: ApiOptimizationJobDetail[];
  sessions: ApiStrategyCreationSession[];
  runs: import('../types').ApiBacktestRunDetail[];
  tradeAudits: Record<string, Record<string, ApiBacktestRunTradeAudit>>;
  promoteConflicts: Set<string>;
};

export const FIXED_NOW = '2026-03-30T09:00:00.000Z';

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function nowIso(): string {
  return FIXED_NOW;
}

export function nextId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

export function formatVersionedStrategyName(name: string, version: number | undefined): string {
  const baseName = stripStrategyVersionSuffix(name) || name.trim() || '策略';
  void version;
  return baseName;
}

export function buildDelta(
  baseline: Record<string, ParameterValue>,
  snapshot: Record<string, ParameterValue>,
): Record<string, ParameterValue> {
  return Object.fromEntries(
    buildParameterDiffRows(baseline, snapshot).map((row) => [row.key, row.nextValue ?? null]),
  );
}

export function createStrategy(overrides: Partial<ApiStrategyDetail>): ApiStrategyDetail {
  const id = overrides.id ?? nextId('strat');
  const parameterVersion = overrides.current_parameter_version ?? 2;
  const parameterVersionId = overrides.current_parameter_version_id ?? `${id}-v${parameterVersion}`;
  const parameters = overrides.parameters ?? {
    lookback_months: 6,
    skip_recent_months: 1,
    top_n: 5,
    weighting_method: 'equal_weight',
    max_position_pct: 15,
  };
  return {
    id,
    name: overrides.name ?? 'Quality Momentum',
    description: overrides.description ?? 'Recovered strategy detail',
    strategy_type: overrides.strategy_type ?? 'MOMENTUM',
    universe_name: overrides.universe_name ?? 'SPY',
    rebalance_frequency: overrides.rebalance_frequency ?? 'monthly',
    lifecycle_status: overrides.lifecycle_status ?? 'ACTIVE',
    latest_run_id: overrides.latest_run_id ?? 'bt-001',
    latest_optimization_job_id: overrides.latest_optimization_job_id ?? 'opt-001',
    current_parameter_version: parameterVersion,
    current_parameter_version_id: parameterVersionId,
    parameters,
    parameter_history: overrides.parameter_history ?? [
      {
        version_number: parameterVersion,
        parameter_version_id: parameterVersionId,
        revision: parameterVersion,
        created_at: nowIso(),
        comment: 'Recovered baseline after restore.',
        parameters,
      },
    ],
    confirmation_fields: overrides.confirmation_fields ?? { top_level: [], parameters: [] },
    allowed_actions: overrides.allowed_actions ?? ['run_backtest', 'open_optimization'],
    benchmark_symbol: overrides.benchmark_symbol ?? 'SPY',
  };
}

export function createCandidate(
  strategy: ApiStrategyDetail,
  overrides: Partial<ApiOptimizationCandidate> = {},
  rank = 1,
): ApiOptimizationCandidate {
  const snapshot = overrides.parameter_snapshot ?? {
    ...strategy.parameters,
    top_n: Number(strategy.parameters?.top_n ?? 5) + rank,
  };
  return {
    id: overrides.id ?? nextId('trial'),
    label: overrides.label ?? `Candidate ${rank}`,
    title: overrides.title ?? null,
    summary: overrides.summary ?? 'Recovered optimization candidate',
    status: overrides.status ?? 'SUCCEEDED',
    status_label: overrides.status_label ?? null,
    rank,
    score: overrides.score ?? Number((1.35 - rank * 0.08).toFixed(2)),
    parameter_snapshot: snapshot,
    parameter_delta: overrides.parameter_delta ?? buildDelta(strategy.parameters ?? {}, snapshot),
    metrics: overrides.metrics ?? {
      total_return: Number((12 - rank * 1.8).toFixed(2)),
      sharpe: Number((1.25 - rank * 0.06).toFixed(2)),
    },
    analysis: overrides.analysis,
    base_parameter_version_id:
      overrides.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
    allowed_actions: overrides.allowed_actions ?? ['promote', 'delete'],
  };
}
