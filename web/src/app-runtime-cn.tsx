import { startTransition, useEffect, useState } from 'react';
import { ApiClientProvider, useApiClient } from './lib/demoStoreContext';
import { lazy, Suspense } from 'react';
import {
  AppRouteProvider,
  navigateTo,
  parseAppHash,
  type AppRoute,
} from './lib/appRouteContext';
import type {
  FactorMiningCandidate,
  FactorMiningCreatePayload,
  FactorMiningJob,
} from './pages/factor-sandbox-page';
import type {
  FactorModelCreateResponse,
  FactorModelOption,
  FactorModelPreview,
  FactorModelPreviewPayload,
} from './pages/factor-model-builder-page';
import { ShellFrameCn } from './shell-frame-cn';
import type {
  ApiFactorDirection,
  ApiFactorListItem,
  ApiFactorMiningCandidate as RuntimeMiningCandidate,
  ApiFactorMiningJob as RuntimeMiningJob,
} from './types';
import { CreationTemplatePage } from './pages/creation-template-page';

type ApiClient = ReturnType<typeof useApiClient>;
type FactorModelBuilderRoute = Extract<AppRoute, { kind: 'factor-model-builder' }>;
const FIRST_SCREEN_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 1200;
const FACTOR_CATEGORY_LABELS: Record<string, string> = {
  mom: '动量',
  val: '估值',
  qlty: '质量',
  vol: '波动',
  size: '规模',
  alpha: 'Alpha',
  beta: '市场',
  risk: '风险',
  style: '风格',
};

// Keep the shell light: each route downloads only the page module it renders.
const BacktestSubmitPage = lazy(() =>
  import('./pages/backtest-submit-page-cn').then((module) => ({ default: module.BacktestSubmitPage })),
);
const CompositionAllocationConfigPage = lazy(() =>
  import('./pages/composition-allocation-page').then((module) => ({ default: module.CompositionAllocationConfigPage })),
);
const CompositionAllocationResultPage = lazy(() =>
  import('./pages/composition-allocation-page').then((module) => ({ default: module.CompositionAllocationResultPage })),
);
const CompositionBacktestConfigPage = lazy(() =>
  import('./pages/composition-backtest-config-page').then((module) => ({ default: module.CompositionBacktestConfigPage })),
);
const CompositionBacktestResultPage = lazy(() =>
  import('./pages/composition-backtest-result-page').then((module) => ({ default: module.CompositionBacktestResultPage })),
);
const CompositionDashboardPage = lazy(() =>
  import('./pages/composition-dashboard-page').then((module) => ({ default: module.CompositionDashboardPage })),
);
const CompositionDetailPage = lazy(() =>
  import('./pages/composition-detail-page').then((module) => ({ default: module.CompositionDetailPage })),
);
const CompositionBacktestRunsIndexPage = lazy(() =>
  import('./pages/composition-global-index-page').then((module) => ({ default: module.CompositionBacktestRunsIndexPage })),
);
const CompositionLabIndexPage = lazy(() =>
  import('./pages/composition-global-index-page').then((module) => ({ default: module.CompositionLabIndexPage })),
);
const CompositionListIndexPage = lazy(() =>
  import('./pages/composition-global-index-page').then((module) => ({ default: module.CompositionListIndexPage })),
);
const CompositionWorkbenchPage = lazy(() =>
  import('./pages/composition-workbench-page').then((module) => ({ default: module.CompositionWorkbenchPage })),
);
const AssetAllocationConfigPage = lazy(() =>
  import('./pages/asset-allocation-config-page').then((module) => ({ default: module.AssetAllocationConfigPage })),
);
const CreationSessionPage = lazy(() =>
  import('./pages/creation-session-page').then((module) => ({ default: module.CreationSessionPage })),
);
const FactorDetailPage = lazy(() =>
  import('./pages/factors-page').then((module) => ({ default: module.FactorDetailPage })),
);
const FactorEditorPage = lazy(() =>
  import('./pages/factors-page').then((module) => ({ default: module.FactorEditorPage })),
);
const FactorLibraryPage = lazy(() =>
  import('./pages/factors-page').then((module) => ({ default: module.FactorLibraryPage })),
);
const PitCleaningCenterPage = lazy(() =>
  import('./pages/factors-page').then((module) => ({ default: module.PitCleaningCenterPage })),
);
const FactorSandboxPage = lazy(() => import('./pages/factor-sandbox-page'));
const FactorQuarantinePage = lazy(() => import('./pages/factor-quarantine-page'));
const FactorModelBuilderPage = lazy(() => import('./pages/factor-model-builder-page'));
const LegInventoryPage = lazy(() =>
  import('./pages/leg-inventory-page').then((module) => ({ default: module.LegInventoryPage })),
);
const OptimizationConfigPage = lazy(() =>
  import('./pages/optimization-lab-page').then((module) => ({ default: module.OptimizationConfigPage })),
);
const OptimizationJobsIndexPage = lazy(() =>
  import('./pages/optimization-lab-page').then((module) => ({ default: module.OptimizationJobsIndexPage })),
);
const OptimizationResultsPage = lazy(() =>
  import('./pages/optimization-lab-page').then((module) => ({ default: module.OptimizationResultsPage })),
);
const OptimizationStrategySelectPage = lazy(() =>
  import('./pages/optimization-lab-page').then((module) => ({ default: module.OptimizationStrategySelectPage })),
);
const RunDetailPage = lazy(() =>
  import('./pages/run-detail-page').then((module) => ({ default: module.RunDetailPage })),
);
const RunsIndexPage = lazy(() =>
  import('./pages/runs-index-page').then((module) => ({ default: module.RunsIndexPage })),
);
const SnapshotsPage = lazy(() =>
  import('./pages/snapshots-page').then((module) => ({ default: module.SnapshotsPage })),
);
const StrategyDetailPage = lazy(() =>
  import('./pages/strategy-detail-page').then((module) => ({ default: module.StrategyDetailPage })),
);
const WorkspacePage = lazy(() =>
  import('./pages/workspace-page-lane-b').then((module) => ({ default: module.WorkspacePage })),
);

function miningCandidateFamily(candidate: RuntimeMiningCandidate, index: number): string {
  const expression = String(candidate.expression ?? '');
  if (/Std|Vol/i.test(expression)) return `低波候选 #${index + 1}`;
  if (/Return|Momentum|Lag/i.test(expression)) return `动量候选 #${index + 1}`;
  if (/Log|Rank|ZScore|Winsorize/i.test(expression)) return `转换候选 #${index + 1}`;
  return `候选 #${index + 1}`;
}

function mapApiMiningCandidate(
  candidate: RuntimeMiningCandidate,
  index: number,
  sourceJobId?: string,
): FactorMiningCandidate {
  return {
    id: String(candidate.id ?? `candidate-${index + 1}`),
    expression: String(candidate.expression ?? ''),
    family: miningCandidateFamily(candidate, index),
    rankIc: Number(candidate.rank_ic ?? candidate.score ?? 0),
    coveragePct: Number(candidate.coverage ?? 0) * 100,
    turnoverPct: Number(candidate.turnover ?? 0) * 100,
    riskFlags: Array.isArray(candidate.risk_flags) ? candidate.risk_flags.map(String) : [],
    sourceJobId,
  };
}

function mapApiMiningJob(job: RuntimeMiningJob): FactorMiningJob {
  const request = job.request ?? {};
  const progress = job.progress ?? {};
  const topCandidates = job.top_candidates ?? [];
  const topRankIc = topCandidates.reduce((best, candidate) => Math.max(best, Math.abs(Number(candidate.rank_ic ?? 0))), 0);
  return {
    id: job.id,
    name: `${String(request.universe ?? 'SP500')} 因子挖掘`,
    status: job.status,
    universe: String(request.universe ?? 'SP500'),
    dateRange: `${String(request.start_date ?? '')} 至 ${String(request.end_date ?? '')}`,
    operators: Array.isArray(request.operators) ? request.operators.map(String) : [],
    candidateCount: Number(progress.total_candidates ?? request.candidate_count ?? 0),
    startDate: String(request.start_date ?? ''),
    endDate: String(request.end_date ?? ''),
    progressPct: Number(progress.percent ?? 0),
    throughputPerMinute: Number(progress.throughput_per_second ?? 0) * 60,
    failedSampleCount: Number(progress.failed_candidates ?? job.failed_samples?.length ?? 0),
    topRankIc,
    createdAt: job.created_at,
    randomSeed: request.random_seed ?? null,
    minRankIc: Number(request.min_rank_ic ?? 0),
    maxDepth: Number(request.max_depth ?? 0),
    topCandidates: topCandidates.map((candidate, index) => mapApiMiningCandidate(candidate, index, job.id)),
  };
}

function mapDirectionToModel(direction: ApiFactorDirection): 'HIGH_IS_GOOD' | 'LOW_IS_GOOD' {
  return direction === 'LOW_IS_BETTER' ? 'LOW_IS_GOOD' : 'HIGH_IS_GOOD';
}

function mapDirectionToApi(direction: 'HIGH_IS_GOOD' | 'LOW_IS_GOOD'): ApiFactorDirection {
  return direction === 'LOW_IS_GOOD' ? 'LOW_IS_BETTER' : 'HIGH_IS_BETTER';
}

function factorCategoryLabel(factor: ApiFactorListItem): string {
  const family = String(factor.factor_family ?? '').trim();
  if (family) return family;
  const category = String(factor.descriptor?.category ?? '').trim();
  return FACTOR_CATEGORY_LABELS[category] ?? (category || '自定义');
}

function factorMetricLabel(label: string, value: unknown, digits: number): string {
  if (value === null || value === undefined || value === '') return `${label} 待诊断`;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${label} 待诊断`;
  return `${label} ${numeric.toFixed(digits)}`;
}

function factorMetricValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function mapFactorOption(factor: ApiFactorListItem): FactorModelOption {
  const pitCoverage = factor.pit_coverage as { missing_fields?: unknown[]; required_fields?: unknown[] } | undefined;
  const requiredCount = Array.isArray(pitCoverage?.required_fields) ? pitCoverage.required_fields.length : 0;
  const missingCount = Array.isArray(pitCoverage?.missing_fields) ? pitCoverage.missing_fields.length : 0;
  const coveragePct = requiredCount > 0 ? Math.max(0, 100 - (missingCount / requiredCount) * 100) : 100;
  const factorRecord = factor as ApiFactorListItem & {
    default_model_weight?: unknown;
    default_weight?: unknown;
    suggested_model_weight?: unknown;
  };
  const suggestedWeight = Number(
    factorRecord.default_model_weight ?? factorRecord.suggested_model_weight ?? factorRecord.default_weight ?? 0,
  );
  const diagnosticSummary: { rank_ic?: unknown; ir?: unknown } =
    factor.latest_diagnostic_summary ?? factor.batch_diagnostic_summary ?? {};
  const categoryLabel = factorCategoryLabel(factor);
  const rankIc = factorMetricValue(diagnosticSummary.rank_ic);
  const ir = factorMetricValue(diagnosticSummary.ir);
  return {
    id: factor.id,
    displayName: factor.name,
    family: categoryLabel,
    categoryLabel,
    rankIc,
    ir,
    rankIcLabel: factorMetricLabel('Rank IC', rankIc, 3),
    irLabel: factorMetricLabel('IR', ir, 2),
    sourceLabel: factor.source === 'SYSTEM_SEED' ? '系统默认' : factor.source === 'AUTO_MINED' ? '自动挖掘' : '人工',
    diagnosticStatus: factor.diagnostic_status,
    pitCoveragePct: coveragePct,
    defaultWeight: Number.isFinite(suggestedWeight) ? suggestedWeight : 0,
    defaultDirection: mapDirectionToModel(factor.direction),
  };
}

function mapModelPayload(payload: FactorModelPreviewPayload) {
  return {
    name: payload.modelName,
    universe: 'SP500',
    rebalance_frequency: payload.rebalanceFrequency,
    scoring_method: 'zscore_weighted',
    components: payload.factors.map((factor) => ({
      factor_id: factor.factorId,
      weight: factor.weightPct,
      direction: mapDirectionToApi(factor.direction),
    })),
    neutralization: {
      enabled: payload.neutralization.enabled,
      method: 'industry',
    },
  };
}

function mapModelPreview(response: Awaited<ReturnType<ApiClient['previewFactorModel']>>): FactorModelPreview {
  const coverage = response.coverage ?? {};
  const estimatedCoverage = Number(coverage.estimated_factor_coverage ?? 0);
  const normalizedWeights = response.normalized_weights.map((item) => ({
    factorId: String(item.factor_id),
    weightPct: Number(item.weight ?? 0),
    normalizedWeightPct: Math.abs(Number(item.normalized_weight ?? 0)) * 100,
    direction: mapDirectionToModel(item.direction),
    diagnosticStatus: String(item.diagnostic_status ?? ''),
  }));
  const scorePreview = response.score_preview.map((item) => {
    const coveragePct = Number(item.coverage ?? 0);
    return {
      symbol: String(item.symbol ?? ''),
      score: Number(item.score ?? 0),
      coveragePct: coveragePct > 1 ? coveragePct : coveragePct * 100,
    };
  });
  const scores = scorePreview.map((item) => item.score);
  const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
  const neutralization = response.neutralization_status ?? {};
  const neutralizationBlockers = Array.isArray(neutralization.blockers) ? neutralization.blockers.map(String) : [];
  const neutralizationSourceNames = Array.isArray(neutralization.source_names)
    ? neutralization.source_names.map(String).filter(Boolean)
    : [];
  const estimatedTurnover = Number(response.estimated_turnover ?? 0);
  return {
    status: String(response.status ?? 'UNKNOWN'),
    coveragePct: estimatedCoverage > 1 ? estimatedCoverage : estimatedCoverage * 100,
    factorCount: Number(coverage.factor_count ?? normalizedWeights.length),
    readyFactorCount: Number(coverage.ready_factor_count ?? normalizedWeights.length),
    universeSymbolCount: Number(coverage.universe_symbol_count ?? scorePreview.length),
    turnoverPct: estimatedTurnover > 1 ? estimatedTurnover : estimatedTurnover * 100,
    scoreSpread: spread,
    scorePreview,
    normalizedWeights,
    pitBlockers: response.pit_blockers.map((item) => String(item.message ?? item.code ?? 'PIT blocker')),
    neutralizationStatus: {
      enabled: Boolean(neutralization.enabled),
      method: String(neutralization.method ?? 'industry'),
      status: String(neutralization.status ?? 'UNKNOWN'),
      blockers: neutralizationBlockers,
      industryField: typeof neutralization.industry_field === 'string' ? neutralization.industry_field : null,
      taxonomy: typeof neutralization.taxonomy === 'string' ? neutralization.taxonomy : null,
      coveredSymbolCount: Number.isFinite(Number(neutralization.covered_symbol_count))
        ? Number(neutralization.covered_symbol_count)
        : null,
      missingSymbolCount: Number.isFinite(Number(neutralization.missing_symbol_count))
        ? Number(neutralization.missing_symbol_count)
        : null,
      sourceNames: neutralizationSourceNames,
    },
    warnings: Array.isArray(response.warnings) ? response.warnings.map(String) : [],
    strategyCreationRisk: response.strategy_creation_risk,
  };
}

function FactorSandboxRoutePage(): JSX.Element {
  const api = useApiClient();
  return (
    <FactorSandboxPage
      api={{
        listFactorMiningJobs: async () => {
          await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
          const payload = await api.listFactorMiningJobs();
          return payload.items.map(mapApiMiningJob);
        },
        createFactorMiningJob: async (payload: FactorMiningCreatePayload) =>
          mapApiMiningJob(
            await api.createFactorMiningJob({
              universe: payload.universe,
              start_date: payload.startDate,
              end_date: payload.endDate,
              operators: payload.operators,
              candidate_count: payload.candidateCount,
              random_seed: payload.randomSeed,
              min_rank_ic: payload.minRankIc,
              max_depth: payload.maxDepth,
            }),
          ),
        cancelFactorMiningJob: async (jobId: string) => mapApiMiningJob(await api.cancelFactorMiningJob(jobId)),
        intakeFactorQuarantine: async (payload) => {
          if (!api.factorQuarantineIntake) {
            throw new Error('检疫接收 API 尚未接入。');
          }
          const response = await api.factorQuarantineIntake({
            mining_job_id: payload.miningJobId,
            candidate_ids: payload.candidateIds,
          });
          return {
            intakeCount: Number(response?.summary?.intake_count ?? response?.items.length ?? 0),
            sourceMiningJobId: typeof response?.summary?.source_mining_job_id === 'string'
              ? response.summary.source_mining_job_id
              : null,
          };
        },
      }}
      onOpenPitGate={() => navigateTo('/pit-data?section=fundamental-requirements')}
    />
  );
}

function FactorModelBuilderRoutePage({ route }: { route: FactorModelBuilderRoute }): JSX.Element {
  const api = useApiClient();
  const [factors, setFactors] = useState<FactorModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .listFactors()
        .then((response) => {
          if (!cancelled) {
            setFactors(response.items.map(mapFactorOption));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFactors([]);
          }
        });
    }, FIRST_SCREEN_DEFER_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api]);

  return (
    <FactorModelBuilderPage
      key={factors.length ? `live-factors-${factors.map((factor) => factor.id).join('|')}` : 'empty-live-factors'}
      api={{
        previewFactorModel: async (payload: FactorModelPreviewPayload) =>
          mapModelPreview(await api.previewFactorModel(mapModelPayload(payload))),
        createFactorModel: async (payload: FactorModelPreviewPayload): Promise<FactorModelCreateResponse> => {
          const strategy = await api.createFactorModel(mapModelPayload(payload));
          return {
            strategy_id: strategy.id,
            parameter_version_id: strategy.current_parameter_version_id ?? undefined,
          };
        },
      }}
      factors={factors}
      autoPreviewDelayMs={FIRST_SCREEN_DEFER_MS}
      initialPrefill={route.prefill}
      useDefaultFallback={true}
      defaultSelectAll={false}
      onCreated={(strategyId) => navigateTo(`/strategies/${strategyId}`)}
    />
  );
}

function RouteLoadingFallback(): JSX.Element {
  return (
    <div className="route-loading-fallback" role="status">
      路由加载中...
    </div>
  );
}

function AppShell(): JSX.Element {
  /*
    [hash route]
      -> [route meta]
      -> [shell frame]
      -> [page-local view model]
      -> [real API page]
  */
  const [route, setRoute] = useState<AppRoute>(() => parseAppHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      startTransition(() => {
        setRoute(parseAppHash(window.location.hash));
      });
    };

    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) {
      navigateTo('/workspace');
    }

    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <AppRouteProvider navigate={navigateTo} route={route}>
      <ShellFrameCn route={route}>
        <Suspense fallback={<RouteLoadingFallback />}>
          {route.kind === 'workspace' ? <WorkspacePage /> : null}
          {route.kind === 'composition-dashboard' ? <CompositionDashboardPage /> : null}
          {route.kind === 'composition-list' ? <CompositionListIndexPage /> : null}
          {route.kind === 'composition-backtest-runs' ? <CompositionBacktestRunsIndexPage /> : null}
          {route.kind === 'composition-lab' ? <CompositionLabIndexPage /> : null}
          {route.kind === 'leg-inventory' ? <LegInventoryPage /> : null}
          {route.kind === 'composition-workbench' ? <CompositionWorkbenchPage /> : null}
          {route.kind === 'composition-detail' ? (
            <CompositionDetailPage compositionId={route.compositionId} />
          ) : null}
          {route.kind === 'composition-backtest-new' ? (
            <CompositionBacktestConfigPage compositionId={route.compositionId} />
          ) : null}
          {route.kind === 'composition-backtest-result' ? (
            <CompositionBacktestResultPage
              compositionId={route.compositionId}
              highlightedEventId={route.eventId}
              highlightedOrderId={route.orderId}
              initialTab={route.tab}
              runId={route.runId}
            />
          ) : null}
          {route.kind === 'composition-allocation-config' ? (
            <CompositionAllocationConfigPage compositionId={route.compositionId} />
          ) : null}
          {route.kind === 'composition-allocation-result' ? (
            <CompositionAllocationResultPage compositionId={route.compositionId} jobId={route.jobId} />
          ) : null}
          {route.kind === 'creation-template' ? <CreationTemplatePage /> : null}
          {route.kind === 'asset-allocation-config' ? (
            <AssetAllocationConfigPage sessionId={route.sessionId} />
          ) : null}
          {route.kind === 'creation-session' ? <CreationSessionPage sessionId={route.sessionId} /> : null}
          {route.kind === 'strategy-detail' ? <StrategyDetailPage strategyId={route.strategyId} /> : null}
          {route.kind === 'backtest' ? (
            <BacktestSubmitPage
              periodYears={route.periodYears}
              sourceRunId={route.sourceRunId}
              strategyId={route.strategyId}
            />
          ) : null}
          {route.kind === 'runs-index' ? <RunsIndexPage /> : null}
          {route.kind === 'run' ? <RunDetailPage runId={route.runId} /> : null}
          {route.kind === 'snapshots' ? <SnapshotsPage /> : null}
          {route.kind === 'pit-data' ? (
            <PitCleaningCenterPage highlightedSection={route.section} initialLoadDelayMs={FIRST_SCREEN_DEFER_MS} />
          ) : null}
          {route.kind === 'factor-library' ? (
            <FactorLibraryPage
              initialLoadDelayMs={FIRST_SCREEN_DEFER_MS}
              initialSource={route.source}
              initialStatus={route.status}
              initialTag={route.tag}
            />
          ) : null}
          {route.kind === 'factor-detail' ? <FactorDetailPage factorId={route.factorId} /> : null}
          {route.kind === 'factor-editor' ? <FactorEditorPage factorId={route.factorId} /> : null}
          {route.kind === 'factor-sandbox' ? <FactorSandboxRoutePage /> : null}
          {route.kind === 'factor-model-builder' ? <FactorModelBuilderRoutePage route={route} /> : null}
          {route.kind === 'factor-quarantine' ? <FactorQuarantinePage /> : null}
          {route.kind === 'optimization-index' ? <OptimizationJobsIndexPage /> : null}
          {route.kind === 'optimization-select' ? (
            <OptimizationStrategySelectPage
              entryPoint={route.entryPoint}
              sourceRunId={route.sourceRunId}
              strategyId={route.strategyId}
            />
          ) : null}
          {route.kind === 'optimization-config' ? (
            <OptimizationConfigPage
              entryPoint={route.entryPoint}
              sourceRunId={route.sourceRunId}
              strategyId={route.strategyId}
            />
          ) : null}
          {route.kind === 'optimization' ? <OptimizationResultsPage jobId={route.jobId} /> : null}
        </Suspense>
      </ShellFrameCn>
    </AppRouteProvider>
  );
}

export default function AppRuntimeCn(): JSX.Element {
  return (
    <ApiClientProvider>
      <AppShell />
    </ApiClientProvider>
  );
}
