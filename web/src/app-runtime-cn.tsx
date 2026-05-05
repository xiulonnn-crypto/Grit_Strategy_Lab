import { startTransition, useEffect, useState } from 'react';
import { ApiClientProvider, useApiClient } from './lib/demoStoreContext';
import {
  AppRouteProvider,
  navigateTo,
  parseAppHash,
  type AppRoute,
} from './lib/appRouteContext';
import { BacktestSubmitPage } from './pages/backtest-submit-page-cn';
import { CompositionAllocationConfigPage, CompositionAllocationResultPage } from './pages/composition-allocation-page';
import { CompositionBacktestConfigPage } from './pages/composition-backtest-config-page';
import { CompositionBacktestResultPage } from './pages/composition-backtest-result-page';
import { CompositionDashboardPage } from './pages/composition-dashboard-page';
import { CompositionDetailPage } from './pages/composition-detail-page';
import {
  CompositionBacktestRunsIndexPage,
  CompositionLabIndexPage,
  CompositionListIndexPage,
} from './pages/composition-global-index-page';
import { CompositionWorkbenchPage } from './pages/composition-workbench-page';
import { AssetAllocationConfigPage } from './pages/asset-allocation-config-page';
import { CreationSessionPage } from './pages/creation-session-page';
import { CreationTemplatePage } from './pages/creation-template-page';
import {
  FactorDetailPage,
  FactorEditorPage,
  FactorLibraryPage,
  FactorPlaceholderPage,
  PitCleaningCenterPage,
} from './pages/factors-page';
import FactorSandboxPage, {
  type FactorMiningCreatePayload,
  type FactorMiningJob,
} from './pages/factor-sandbox-page';
import FactorModelBuilderPage, {
  type FactorModelCreateResponse,
  type FactorModelOption,
  type FactorModelPreview,
  type FactorModelPreviewPayload,
} from './pages/factor-model-builder-page';
import { LegInventoryPage } from './pages/leg-inventory-page';
import {
  OptimizationConfigPage,
  OptimizationJobsIndexPage,
  OptimizationResultsPage,
  OptimizationStrategySelectPage,
} from './pages/optimization-lab-page';
import { RunDetailPage } from './pages/run-detail-page';
import { RunsIndexPage } from './pages/runs-index-page';
import { SnapshotsPage } from './pages/snapshots-page';
import { StrategyDetailPage } from './pages/strategy-detail-page';
import { WorkspacePage } from './pages/workspace-page-lane-b';
import { ShellFrameCn } from './shell-frame-cn';
import type { ApiFactorDirection, ApiFactorListItem } from './types';

type ApiClient = ReturnType<typeof useApiClient>;

function mapApiMiningJob(job: Awaited<ReturnType<ApiClient['createFactorMiningJob']>>): FactorMiningJob {
  const request = job.request ?? {};
  const progress = job.progress ?? {};
  const topCandidates = job.top_candidates ?? [];
  const topRankIc = topCandidates.reduce((best, candidate) => Math.max(best, Math.abs(Number(candidate.rank_ic ?? 0))), 0);
  return {
    id: job.id,
    name: `${String(request.universe ?? 'SP500')} 因子挖掘`,
    status: job.status,
    universe: String(request.universe ?? 'SP500'),
    dateRange: `${String(request.start_date ?? '')} - ${String(request.end_date ?? '')}`,
    operators: Array.isArray(request.operators) ? request.operators.map(String) : [],
    candidateCount: Number(progress.total_candidates ?? request.candidate_count ?? 0),
    progressPct: Number(progress.percent ?? 0),
    throughputPerMinute: Number(progress.throughput_per_second ?? 0) * 60,
    failedSampleCount: Number(progress.failed_candidates ?? job.failed_samples?.length ?? 0),
    topRankIc,
    createdAt: job.created_at,
  };
}

function mapDirectionToModel(direction: ApiFactorDirection): 'HIGH_IS_GOOD' | 'LOW_IS_GOOD' {
  return direction === 'LOW_IS_BETTER' ? 'LOW_IS_GOOD' : 'HIGH_IS_GOOD';
}

function mapDirectionToApi(direction: 'HIGH_IS_GOOD' | 'LOW_IS_GOOD'): ApiFactorDirection {
  return direction === 'LOW_IS_GOOD' ? 'LOW_IS_BETTER' : 'HIGH_IS_BETTER';
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
  return {
    id: factor.id,
    displayName: factor.name,
    family: String(factor.factor_family ?? factor.descriptor?.category ?? '自定义'),
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
    },
    warnings: Array.isArray(response.warnings) ? response.warnings.map(String) : [],
  };
}

function FactorSandboxRoutePage(): JSX.Element {
  const api = useApiClient();
  return (
    <FactorSandboxPage
      api={{
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
      }}
      onOpenPitGate={() => navigateTo('/pit-data?section=fundamental-requirements')}
    />
  );
}

function FactorModelBuilderRoutePage(): JSX.Element {
  const api = useApiClient();
  const [factors, setFactors] = useState<FactorModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
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
    return () => {
      cancelled = true;
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
      useDefaultFallback={false}
      onCreated={(strategyId) => navigateTo(`/strategies/${strategyId}`)}
    />
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
        {route.kind === 'pit-data' ? <PitCleaningCenterPage highlightedSection={route.section} /> : null}
        {route.kind === 'factor-library' ? (
          <FactorLibraryPage initialSource={route.source} initialStatus={route.status} initialTag={route.tag} />
        ) : null}
        {route.kind === 'factor-detail' ? <FactorDetailPage factorId={route.factorId} /> : null}
        {route.kind === 'factor-editor' ? <FactorEditorPage factorId={route.factorId} /> : null}
        {route.kind === 'factor-sandbox' ? <FactorSandboxRoutePage /> : null}
        {route.kind === 'factor-model-builder' ? <FactorModelBuilderRoutePage /> : null}
        {route.kind === 'factor-quarantine' ? <FactorPlaceholderPage title="隔离检疫区" /> : null}
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
