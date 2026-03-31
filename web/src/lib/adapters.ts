import type {
  ApiOptimizationCandidate,
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
    const compareEligible = Boolean(detail?.latest_run_id ?? strategy.latest_run_id);
    return {
      id: strategy.id,
      name: strategy.name,
      strategyType: detail?.strategy_type ?? strategy.strategy_type,
      universeName: detail?.universe_name ?? strategy.universe_name,
      parameterVersion,
      parameterVersionId: detail?.current_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
      latestOptimizationJobId: detail?.latest_optimization_job_id ?? strategy.latest_optimization_job_id ?? null,
      compareEligible,
      compareBlocker: compareEligible ? null : 'Run the current parameter version before compare.',
      cardState: compareEligible ? 'READY' : 'PENDING_RUN',
      parameters: detail?.parameters ?? strategy.parameters ?? {},
    };
  });
}

export function buildParameterDiffRows(
  baseline: Record<string, ParameterValue>,
  candidate: ApiOptimizationCandidate | Record<string, ParameterValue>,
): ParameterDiffRow[] {
  const snapshot =
    'parameter_snapshot' in candidate &&
    candidate.parameter_snapshot !== null &&
    typeof candidate.parameter_snapshot === 'object'
      ? (candidate.parameter_snapshot as Record<string, ParameterValue>)
      : (candidate as Record<string, ParameterValue>);
  const rows: ParameterDiffRow[] = [];
  for (const key of [...new Set([...Object.keys(baseline), ...Object.keys(snapshot)])].sort()) {
    const previousValue = baseline[key];
    const nextValue = snapshot[key];
    if (previousValue !== nextValue) {
      rows.push({ key, previousValue, nextValue });
    }
  }
  return rows;
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
