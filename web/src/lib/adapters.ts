export type { ParameterDiffRow } from './workspace-adapters';
export {
  buildParameterDiffRows,
  buildRecentRunScore,
  formatParameterLabel,
  formatParameterValue,
} from './workspace-adapters';
/*
import { formatPercent, formatRatio } from '../lib/format';
import type {
  ApiBacktestRunDetail,
  ApiStrategyDetail,
  ApiStrategyListItem,
  ParameterValue,
  StrategyCompareCard,
} from '../types';

export type ParameterDiffRow = {
  key: string;
  previousValue: ParameterValue | undefined;
  nextValue: ParameterValue | undefined;
};

export function buildWorkspaceStrategyCards(
  strategies: ApiStrategyListItem[],
  details: Record<string, ApiStrategyDetail>,
): StrategyCompareCard[] {
  return strategies.map((strategy) => {
    const detail = details[strategy.id];
    const parameterVersion = detail?.current_parameter_version ?? strategy.current_parameter_version ?? 1;
    const latestRunId = detail?.latest_successful_run_id ?? strategy.latest_successful_run_id ?? strategy.latest_run_id ?? null;
    const compareEligible = Boolean(latestRunId);
    const latestStatus = detail?.lifecycle_status ?? strategy.lifecycle_status ?? 'PENDING_RUN';
    return {
      id: strategy.id,
      name: strategy.name,
      strategyType: detail?.strategy_type ?? strategy.strategy_type,
      universeName: detail?.universe_name ?? strategy.universe_name,
      parameterVersion,
      parameterVersionId: detail?.current_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
      latestOptimizationJobId: detail?.latest_optimization_job_id ?? strategy.latest_optimization_job_id ?? null,
      compareEligible,
      compareBlocker: compareEligible ? null : '当前版本还没有正式回测，暂时不能加入对比。',
      cardState: latestStatus === 'RUNNING' ? 'RUNNING_CURRENT_VERSION' : compareEligible ? 'READY' : 'PENDING_RUN',
      parameters: detail?.parameters ?? strategy.parameters ?? {},
    };
  });
}
*/

/*
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
*/

/*
export function buildRecentRunScore(run?: ApiBacktestRunDetail): { totalReturn: string; sharpe: string } {
  const metrics = run?.metrics ?? {};
  return {
    totalReturn: formatPercent(metrics.total_return ?? 0),
    sharpe: formatRatio(metrics.sharpe ?? 0),
  };
}
*/

/*
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
*/
