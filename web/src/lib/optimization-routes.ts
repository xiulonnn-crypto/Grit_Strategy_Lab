type OptimizationRouteParams = {
  strategyId?: string | null;
  sourceRunId?: string | null;
  entryPoint?: string | null;
};

function buildQuery(params: OptimizationRouteParams): string {
  const searchParams = new URLSearchParams();
  if (params.strategyId) {
    searchParams.set('strategy_id', params.strategyId);
  }
  if (params.sourceRunId) {
    searchParams.set('source_run_id', params.sourceRunId);
  }
  if (params.entryPoint) {
    searchParams.set('entry_point', params.entryPoint);
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export function buildOptimizationJobsPath(): string {
  return '/optimization-jobs';
}

export function buildOptimizationSelectPath(params: OptimizationRouteParams = {}): string {
  return `/optimization-jobs/new${buildQuery(params)}`;
}

export function buildOptimizationConfigPath(params: Required<Pick<OptimizationRouteParams, 'strategyId'>> & OptimizationRouteParams): string {
  return `/optimization-jobs/new/config${buildQuery(params)}`;
}
