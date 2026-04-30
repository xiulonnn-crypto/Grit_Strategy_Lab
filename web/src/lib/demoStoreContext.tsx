import React, { createContext, useContext, useMemo } from 'react';
import { ApiError } from '../types';
import {
  buildCompositionStressScenarios,
  selectWorstCompositionStressScenario,
  type CompositionStressScenario,
} from './composition-stress-scenarios';
import type {
  ApiAssetLeg,
  ApiAssetLegCreatePayload,
  ApiBacktestRunDeleteResult,
  ApiBacktestRunDetail,
  ApiBacktestRunListItem,
  ApiBacktestRunTradeAudit,
  ApiBacktestRunTradePage,
  ApiBacktestSubmissionPreview,
  ApiCashLeg,
  ApiCashLegCreatePayload,
  ApiConfirmationUpdateRequest,
  ApiCompositionAllocationJob,
  ApiCompositionAllocationJobPayload,
  ApiCompositionBacktestOrderNetting,
  ApiCompositionBacktestOrderPage,
  ApiCompositionBacktestOrdersQuery,
  ApiCompositionBacktestRun,
  ApiCompositionBacktestRunPayload,
  ApiCompositionGlobalAllocationJobListItem,
  ApiCompositionGlobalBacktestRunListItem,
  ApiCompositionOrderExportFormat,
  ApiCompositionCreatePayload,
  ApiCompositionDecisionPacket,
  ApiCompositionDetail,
  ApiCompositionListItem,
  ApiCompositionPreview,
  ApiCompositionPreviewPayload,
  ApiCompositionProxyConfirmationPayload,
  ApiCompositionUpdatePayload,
  ApiCompositionVersion,
  ApiLegInventory,
  ApiOptimizationJobCreatePayload,
  ApiOptimizationJobDeleteResult,
  ApiOptimizationJobDetail,
  ApiOptimizationJobListItem,
  ApiSnapshotOverview,
  ApiStrategyCreationSession,
  ApiStrategyDetail,
  ApiStrategyListItem,
  ApiWorkspaceOverview,
  AssetAllocationRecommendationRequest,
  AssetAllocationRecommendationResponse,
  BacktestRunDetailRequest,
  DemoApi,
  BacktestRunListQuery,
} from '../types';

const ApiClientContext = createContext<DemoApi | null>(null);

function apiBaseUrl(): string {
  const configured = (typeof import.meta !== 'undefined'
    ? (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL
    : undefined)?.trim();
  if (configured) {
    return configured;
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if ((hostname === '127.0.0.1' || hostname === 'localhost') && port && port !== '8000') {
      return `${protocol}//${hostname}:8000`;
    }
  }
  return '';
}

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl) {
    return path;
  }
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function parseError(response: Response): Promise<ApiError> {
  let payload: Partial<ApiError> & { message?: string; code?: string } = {};
  try {
    payload = (await response.json()) as Partial<ApiError> & { message?: string; code?: string };
  } catch {
    payload = { message: response.statusText };
  }
  return new ApiError({
    status: response.status,
    code: payload.code ?? 'http_error',
    message: payload.message ?? response.statusText ?? '请求失败。',
    blocking_code: payload.blocking_code,
    blocking_target: payload.blocking_target,
    next_action: payload.next_action,
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  headers.set('Accept', 'application/json');
  if (init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(joinUrl(apiBaseUrl(), path), {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function requestText(path: string, init?: RequestInit): Promise<string> {
  const headers = new Headers(init?.headers ?? {});
  headers.set('Accept', 'text/csv,text/plain,*/*');
  if (init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(joinUrl(apiBaseUrl(), path), {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.text();
}

function withJsonBody(body: unknown, init?: RequestInit): RequestInit {
  return {
    ...init,
    method: init?.method ?? 'POST',
    body: JSON.stringify(body),
  };
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function formatStressPercent(value: number | null): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : null;
}

function formatStressDays(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}d` : '未修复';
}

function formatStressPoints(value: number | null): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}pt` : null;
}

function stressScenarioDetail(scenario: CompositionStressScenario): string {
  const parts = [
    scenario.period,
    formatStressPercent(scenario.portfolioDrawdown) ? `组合回撤 ${formatStressPercent(scenario.portfolioDrawdown)}` : null,
    formatStressPercent(scenario.benchmarkDrawdown) ? `${scenario.benchmarkLabel} ${formatStressPercent(scenario.benchmarkDrawdown)}` : null,
    `修复 组合 ${formatStressDays(scenario.recoveryDays)} / 基准 ${formatStressDays(scenario.benchmarkRecoveryDays)}`,
    formatStressPoints(scenario.defensiveDelta) ? `相对抗跌 ${formatStressPoints(scenario.defensiveDelta)}` : null,
  ].filter((item): item is string => Boolean(item));
  return parts.join(' · ');
}

function normalizeAllocationMethodKey(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['risk_parity', 'riskparity'].includes(normalized) || normalized.startsWith('risk_parity')) {
    return 'risk_parity';
  }
  if (['min_vol', 'minimum_volatility', 'min_volatility', 'minimum_variance'].includes(normalized) || normalized.startsWith('min_vol')) {
    return 'min_vol';
  }
  if (['max_sharpe', 'maximum_sharpe'].includes(normalized) || normalized.startsWith('max_sharpe')) {
    return 'max_sharpe';
  }
  if (['mvo', 'mean_variance', 'mean_variance_optimization'].includes(normalized)) {
    return 'mean_variance';
  }
  if (['black_litterman', 'black-litterman'].includes(normalized)) {
    return 'black_litterman';
  }
  return normalized;
}

function allocationMethodLabel(value: unknown): string | null {
  const key = normalizeAllocationMethodKey(value);
  if (key === 'risk_parity') return '风险平价';
  if (key === 'min_vol') return '最小波动';
  if (key === 'max_sharpe') return '最大夏普';
  if (key === 'mean_variance') return '均值方差';
  if (key === 'black_litterman') return 'Black-Litterman';
  const raw = readString(value);
  return raw ? raw : null;
}

function allocationCopyLabel(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'heuristic_from_composition_detail_preview') {
    return '来自组合详情预演的启发式证据';
  }
  if (normalized === 'allocation candidates were derived deterministically from the saved composition preview.') {
    return '确定性候选生成';
  }
  if (normalized === 'derived from full-window composition rebalance events and source return streams; these are model instructions, not broker fills.') {
    return '来自完整窗口组合再平衡事件和来源收益流；这是模型调仓指令，不是券商成交回报。';
  }
  if (normalized === 'current saved allocation.') {
    return '当前已保存配置。';
  }
  if (normalized === 'benchmark reference portfolio for comparison only.') {
    return '仅用于对比的基准组合。';
  }
  if (normalized.includes('inverse realized volatility')) {
    return '按实现波动率倒数分配风险预算';
  }
  if (normalized.includes('away from the highest risk contribution')) {
    return '从最高风险贡献腿移出少量权重。';
  }
  if (normalized.includes('toward the highest return contribution')) {
    return '向最高收益贡献腿增加少量权重。';
  }
  return raw;
}

function metricDelta(candidateMetric: unknown, currentMetric: unknown): number | null {
  const candidate = readNumber(candidateMetric);
  const current = readNumber(currentMetric);
  return candidate !== null && current !== null ? Number((candidate - current).toFixed(6)) : null;
}

function unwrapItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  const record = readRecord(payload);
  return Array.isArray(record.items) ? (record.items as T[]) : [];
}

function mapCompositionListItem(item: ApiCompositionListItem): ApiCompositionListItem {
  const latestBacktestSummary = readRecord(item.latest_backtest_summary);
  const latestBacktestPayload = readRecord(latestBacktestSummary.summary);
  const labSummary = readRecord(item.lab_summary);
  const labPayload = readRecord(labSummary.summary);
  const promotionReadiness = readRecord(item.promotion_readiness);
  const promotionCandidateCount =
    item.promotion_candidate_count ?? readNumber(labPayload.candidate_count) ?? (promotionReadiness.status === 'ready' ? 1 : 0);
  return {
    ...item,
    version_status_label: item.version_status_label ?? (item.version_status === 'ACTIVE' ? '正式版本' : item.version_status ?? null),
    evidence_label: item.evidence_label ?? null,
    latest_backtest_label:
      item.latest_backtest_label ??
      readString(latestBacktestPayload.stability_verdict) ??
      readString(latestBacktestSummary.status) ??
      null,
    latest_backtest_detail:
      item.latest_backtest_detail ??
      readString(latestBacktestPayload.quality_label) ??
      readString(latestBacktestPayload.evidence_label) ??
      null,
    allocation_lab_label: item.allocation_lab_label ?? readString(labPayload.intent) ?? null,
    allocation_lab_detail:
      item.allocation_lab_detail ??
      (typeof promotionCandidateCount === 'number' ? `${promotionCandidateCount} 个候选待确认` : null),
    promotion_candidate_count: promotionCandidateCount,
    primary_diagnosis: item.primary_diagnosis ?? item.diagnoses?.[0] ?? null,
    diagnoses: item.diagnoses ?? (item.primary_diagnosis ? [item.primary_diagnosis] : []),
  };
}

function mapCompositionBacktestRunItem(run: ApiCompositionBacktestRun): ApiCompositionGlobalBacktestRunListItem {
  const summary = readRecord(run.summary);
  const diagnostics = readRecord(run.diagnostics);
  const orderSummary = readRecord(run.order_summary);
  const metricWindow = readRecordArray(diagnostics.metric_matrix)[0] ?? {};
  const fallbackScenario = readRecordArray(run.scenario_anchors)[0] ?? {};
  const worstScenario = selectWorstCompositionStressScenario(buildCompositionStressScenarios({
    benchmarkLabel: readString(summary.benchmark_label),
    benchmarkSeries: run.benchmark_series,
    returnsPreview: run.returns_preview,
  }));
  const riskBudget = readRecordArray(run.risk_budget_timeline)[0] ?? {};
  const horizonYears = readNumber(summary.horizon_years);
  const scenarioStart = readString(fallbackScenario.start);
  const scenarioEnd = readString(fallbackScenario.end);
  const scenarioDrawdown = readNumber(fallbackScenario.drawdown_pct);
  const fallbackScenarioDetailParts = [
    scenarioStart && scenarioEnd ? `${scenarioStart} 至 ${scenarioEnd}` : null,
    typeof scenarioDrawdown === 'number' ? `回撤 ${scenarioDrawdown.toFixed(1)}%` : null,
  ].filter((item): item is string => Boolean(item));
  const scenarioDetail = worstScenario
    ? stressScenarioDetail(worstScenario)
    : fallbackScenarioDetailParts.join(' · ') || null;
  return {
    id: run.id,
    run_id: run.run_id,
    composition_id: run.composition_id,
    composition_name: readString(summary.composition_name),
    composition_version_label: readString(run.request?.composition_version) ?? '当前快照',
    status: run.status,
    time_period_label:
      readString(metricWindow.window) ??
      (typeof horizonYears === 'number' && horizonYears > 0 ? `${Number.isInteger(horizonYears) ? horizonYears.toFixed(0) : horizonYears}Y` : null),
    verdict_label: readString(diagnostics.stability_verdict) ?? run.status,
    verdict_detail: readString(summary.quality_label) ?? readString(summary.evidence_label),
    annualized_return: readNumber(metricWindow.annualized_return) ?? readNumber(summary.annualized_return),
    sharpe: readNumber(metricWindow.sharpe) ?? readNumber(summary.sharpe),
    max_drawdown: readNumber(metricWindow.max_drawdown) ?? readNumber(summary.max_drawdown),
    scenario_id: worstScenario?.id ?? readString(fallbackScenario.id) ?? readString(fallbackScenario.label),
    scenario_label: worstScenario?.title ?? readString(fallbackScenario.label),
    scenario_detail: scenarioDetail,
    scenario_status_label: worstScenario?.status ?? readString(fallbackScenario.status),
    scenario_drawdown: worstScenario?.portfolioDrawdown ?? scenarioDrawdown,
    scenario_benchmark_drawdown: worstScenario?.benchmarkDrawdown ?? null,
    scenario_recovery_days: worstScenario?.recoveryDays ?? null,
    scenario_benchmark_recovery_days: worstScenario?.benchmarkRecoveryDays ?? null,
    scenario_defensive_delta: worstScenario?.defensiveDelta ?? null,
    scenario_source: worstScenario?.source ?? null,
    order_count: readNumber(orderSummary.order_count),
    order_evidence_label: readString(summary.evidence_label),
    risk_budget_label: readString(riskBudget.event_label) ?? (run.risk_contribution_preview.length > 0 ? '已生成' : null),
    evidence_grade: run.evidence_grade ?? null,
    evidence_label: readString(summary.quality_label),
    primary_diagnosis: run.primary_diagnosis ?? run.diagnoses?.[0] ?? null,
    diagnoses: run.diagnoses ?? (run.primary_diagnosis ? [run.primary_diagnosis] : []),
    created_at: run.created_at,
    completed_at: run.completed_at ?? null,
  };
}

function mapCompositionAllocationJobItem(job: ApiCompositionAllocationJob): ApiCompositionGlobalAllocationJobListItem {
  const summary = readRecord(job.summary);
  const candidates = readRecordArray(job.candidates);
  const promotable = candidates.filter((candidate) => {
    const actions = Array.isArray(candidate.allowed_actions) ? candidate.allowed_actions : [];
    const readiness = readRecord(candidate.promotion_readiness);
    return actions.includes('promote_candidate') && readiness.status !== 'blocked';
  });
  const reviewCandidate = promotable[0] ?? candidates.find((candidate) => candidate.id !== 'current' && candidate.id !== 'benchmark') ?? candidates[0] ?? {};
  const currentCandidate = candidates.find((candidate) => candidate.id === 'current') ?? {};
  const metrics = readRecord(reviewCandidate.metrics);
  const currentMetrics = readRecord(currentCandidate.metrics);
  const readiness = readRecord(reviewCandidate.promotion_readiness);
  const methodKey =
    normalizeAllocationMethodKey(summary.intent) ??
    normalizeAllocationMethodKey(reviewCandidate.id) ??
    normalizeAllocationMethodKey(reviewCandidate.label);
  const gateStatus = readiness.status === 'blocked'
    ? 'blocked'
    : promotable.length > 0
      ? 'pass'
      : 'review';
  return {
    id: job.id,
    job_id: job.job_id,
    composition_id: job.composition_id,
    composition_name: readString(summary.composition_name),
    composition_version_label: readString(job.request?.composition_version) ?? '当前快照',
    status: job.status,
    method_key: methodKey,
    method_label: allocationMethodLabel(methodKey ?? summary.intent ?? reviewCandidate.label),
    method_detail: allocationCopyLabel(summary.latest_update) ?? allocationCopyLabel(reviewCandidate.thesis),
    best_candidate_label: allocationMethodLabel(reviewCandidate.label ?? reviewCandidate.id),
    candidate_count:
      readNumber(summary.candidate_count) ?? candidates.filter((candidate) => candidate.id !== 'current' && candidate.id !== 'benchmark').length,
    promotion_ready_count: promotable.length,
    promotion_gate_label: readiness.status === 'blocked' ? '门禁阻断' : promotable.length > 0 ? '可晋升' : '待审查',
    gate_status: gateStatus,
    migration_cost_bps: readNumber(readiness.migration_cost_bps),
    annualized_return_delta: metricDelta(metrics.annualized_return ?? metrics.cagr, currentMetrics.annualized_return ?? currentMetrics.cagr),
    sharpe_delta: metricDelta(metrics.sharpe, currentMetrics.sharpe),
    max_drawdown_delta: metricDelta(metrics.max_drawdown, currentMetrics.max_drawdown),
    enb: readNumber(readRecord(job.residual_budget).optimizable_weight_pct),
    evidence_grade: job.evidence_grade ?? readString(readiness.evidence_grade),
    evidence_label: allocationCopyLabel(summary.quality_label),
    primary_diagnosis: job.primary_diagnosis ?? job.diagnoses?.[0] ?? null,
    diagnoses: job.diagnoses ?? (job.primary_diagnosis ? [job.primary_diagnosis] : []),
    policy_violation_count: readRecordArray(readiness.policy_violations).length,
    created_at: job.created_at,
    completed_at: job.completed_at ?? null,
  };
}

function normalizeBacktestRunDetailRequest(
  options?: BacktestRunDetailRequest | AbortSignal,
): BacktestRunDetailRequest {
  if (!options) {
    return {};
  }
  if (typeof AbortSignal !== 'undefined' && options instanceof AbortSignal) {
    return { signal: options };
  }
  return options as BacktestRunDetailRequest;
}

function createHttpApiClient(): DemoApi {
  return {
    getWorkspaceOverview: (includeCleanupAudit = false, signal) =>
      requestJson<ApiWorkspaceOverview>(
        `/workspace/overview${includeCleanupAudit ? '?include_cleanup_audit=1' : ''}`,
        { signal },
      ),
    listStrategies: (signal) => requestJson<ApiStrategyListItem[]>('/strategies', { signal }),
    getStrategyDetail: (id) => requestJson<ApiStrategyDetail>(`/strategies/${encodeURIComponent(id)}/detail`),
    restoreStrategyParameterVersion: (strategyId, parameterVersionId, payload) =>
      requestJson<ApiStrategyDetail>(
        `/strategies/${encodeURIComponent(strategyId)}/parameter-versions/${encodeURIComponent(parameterVersionId)}/restore`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    getCreationSession: (id) => requestJson<ApiStrategyCreationSession>(`/strategy-creation-sessions/${encodeURIComponent(id)}`),
    createCreationSession: (payload) =>
      requestJson<ApiStrategyCreationSession>(
        '/strategy-creation-sessions',
        withJsonBody(payload ?? {}, { method: 'POST' }),
      ),
    appendCreationMessage: (id, content, revision) =>
      requestJson<ApiStrategyCreationSession>(
        `/strategy-creation-sessions/${encodeURIComponent(id)}/messages`,
        withJsonBody({ content, revision }, { method: 'POST' }),
      ),
    prepareConfirmation: (id) =>
      requestJson<ApiStrategyCreationSession>(`/strategy-creation-sessions/${encodeURIComponent(id)}/prepare-confirmation`, {
        method: 'POST',
      }),
    updateConfirmation: (id, payload: ApiConfirmationUpdateRequest) =>
      requestJson<ApiStrategyCreationSession>(
        `/strategy-creation-sessions/${encodeURIComponent(id)}/confirmation`,
        withJsonBody(payload, { method: 'PATCH' }),
      ),
    recommendAssetAllocationWeights: (id, payload: AssetAllocationRecommendationRequest) =>
      requestJson<AssetAllocationRecommendationResponse>(
        `/strategy-creation-sessions/${encodeURIComponent(id)}/asset-allocation/recommendation`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    materializeStrategy: (id, idempotencyKey, confirmedRevision) =>
      requestJson<ApiStrategyDetail>(
        `/strategy-creation-sessions/${encodeURIComponent(id)}/materialize`,
        withJsonBody({ idempotency_key: idempotencyKey, confirmed_revision: confirmedRevision }, { method: 'POST' }),
      ),
    listBacktestRuns: (params?: BacktestRunListQuery, signal?: AbortSignal) => {
      const query = new URLSearchParams();
      if (params?.limit !== undefined) {
        query.set('limit', String(params.limit));
      }
      if (params?.status) {
        query.set('status', params.status);
      }
      const suffix = query.toString();
      return requestJson<ApiBacktestRunListItem[]>(`/backtest-runs${suffix ? `?${suffix}` : ''}`, { signal });
    },
    getBacktestRunDetail: (id, options) => {
      const request = normalizeBacktestRunDetailRequest(options);
      const query = new URLSearchParams();
      if (request.view && request.view !== 'full') {
        query.set('view', request.view);
      }
      const suffix = query.toString();
      return requestJson<ApiBacktestRunDetail>(
        `/backtest-runs/${encodeURIComponent(id)}/detail${suffix ? `?${suffix}` : ''}`,
        { signal: request.signal },
      );
    },
    saveBacktestRun: (id) =>
      requestJson<ApiBacktestRunDetail>(`/backtest-runs/${encodeURIComponent(id)}/save`, {
        method: 'POST',
      }),
    deleteBacktestRun: (id) =>
      requestJson<ApiBacktestRunDeleteResult>(`/backtest-runs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    getBacktestRunTrades: (id, params) => {
      const query = new URLSearchParams();
      if (params?.page !== undefined) query.set('page', String(params.page));
      if (params?.page_size !== undefined) query.set('page_size', String(params.page_size));
      if (params?.segment && params.segment !== 'all') query.set('segment', params.segment);
      const suffix = query.toString();
      return requestJson<ApiBacktestRunTradePage>(
        `/backtest-runs/${encodeURIComponent(id)}/trades${suffix ? `?${suffix}` : ''}`,
      );
    },
    getBacktestTradeAudit: (runId, tradeId) =>
      requestJson<ApiBacktestRunTradeAudit>(
        `/backtest-runs/${encodeURIComponent(runId)}/trades/${encodeURIComponent(tradeId)}/audit`,
      ),
    previewBacktestRun: (strategyId, payload) =>
      requestJson<ApiBacktestSubmissionPreview>(
        `/strategies/${encodeURIComponent(strategyId)}/backtest-runs/preview`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    submitBacktestRun: (strategyId, payload) =>
      requestJson<ApiBacktestRunDetail>(
        `/strategies/${encodeURIComponent(strategyId)}/backtest-runs`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    cloneBacktestRun: (id, idempotencyKey) =>
      requestJson<ApiBacktestRunDetail>(
        `/backtest-runs/${encodeURIComponent(id)}/clone`,
        withJsonBody({ idempotency_key: idempotencyKey }, { method: 'POST' }),
      ),
    listOptimizationJobs: () => requestJson<ApiOptimizationJobListItem[]>('/optimization-jobs'),
    getOptimizationJobDetail: (id) => requestJson<ApiOptimizationJobDetail>(`/optimization-jobs/${encodeURIComponent(id)}/detail`),
    updateOptimizationJobConstraints: (jobId, payload) =>
      requestJson<ApiOptimizationJobDetail>(
        `/optimization-jobs/${encodeURIComponent(jobId)}`,
        withJsonBody(payload, { method: 'PATCH' }),
      ),
    saveOptimizationFilteredResult: (jobId, payload) =>
      requestJson<ApiOptimizationJobDetail>(
        `/optimization-jobs/${encodeURIComponent(jobId)}/filtered-results`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    deleteOptimizationJob: (id) =>
      requestJson<ApiOptimizationJobDeleteResult>(`/optimization-jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    createOptimizationJob: (strategyId, payload?: ApiOptimizationJobCreatePayload) =>
      requestJson<ApiOptimizationJobDetail>(
        `/strategies/${encodeURIComponent(strategyId)}/optimization-jobs`,
        withJsonBody(payload ?? {}, { method: 'POST' }),
      ),
    resumeOptimizationJob: (jobId, idempotencyKey) =>
      requestJson<ApiOptimizationJobDetail>(
        `/optimization-jobs/${encodeURIComponent(jobId)}/resume`,
        withJsonBody({ idempotency_key: idempotencyKey }, { method: 'POST' }),
      ),
    createOptimizationCandidate: (jobId, payload) =>
      requestJson<ApiOptimizationJobDetail>(
        `/optimization-jobs/${encodeURIComponent(jobId)}/candidates`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    promoteOptimizationCandidate: (
      jobId,
      trialId,
      mode,
      idempotencyKey,
      comment,
      baseParameterVersionId,
    ) =>
      requestJson<ApiOptimizationJobDetail>(
        `/optimization-jobs/${encodeURIComponent(jobId)}/candidates/${encodeURIComponent(trialId)}/promote`,
        withJsonBody(
          {
            idempotency_key: idempotencyKey,
            mode,
            comment,
            base_parameter_version_id: baseParameterVersionId,
          },
          { method: 'POST' },
        ),
      ),
    deleteOptimizationCandidate: (jobId, trialId) =>
      requestJson<ApiOptimizationJobDetail>(
        `/optimization-jobs/${encodeURIComponent(jobId)}/candidates/${encodeURIComponent(trialId)}`,
        { method: 'DELETE' },
      ),
    getLegInventory: () => requestJson<ApiLegInventory>('/leg-inventory'),
    createAssetLeg: (payload) =>
      requestJson<ApiAssetLeg>('/asset-legs', withJsonBody(payload, { method: 'POST' })),
    updateAssetLeg: (id, payload) =>
      requestJson<ApiAssetLeg>(`/asset-legs/${encodeURIComponent(id)}`, withJsonBody(payload, { method: 'PATCH' })),
    createCashLeg: (payload) =>
      requestJson<ApiCashLeg>('/cash-legs', withJsonBody(payload, { method: 'POST' })),
    updateCashLeg: (id, payload) =>
      requestJson<ApiCashLeg>(`/cash-legs/${encodeURIComponent(id)}`, withJsonBody(payload, { method: 'PATCH' })),
    listCompositions: async () => {
      const items = await requestJson<ApiCompositionListItem[]>('/compositions');
      return items.map(mapCompositionListItem);
    },
    getCompositionDetail: (id) =>
      requestJson<ApiCompositionDetail>(`/compositions/${encodeURIComponent(id)}`),
    previewComposition: (payload: ApiCompositionPreviewPayload) =>
      requestJson<ApiCompositionPreview>(
        '/compositions/preview',
        withJsonBody(payload, { method: 'POST' }),
      ),
    createComposition: (payload: ApiCompositionCreatePayload) =>
      requestJson<ApiCompositionDetail>(
        '/compositions',
        withJsonBody(payload, { method: 'POST' }),
      ),
    updateComposition: (id, payload: ApiCompositionUpdatePayload) =>
      requestJson<ApiCompositionDetail>(
        `/compositions/${encodeURIComponent(id)}`,
        withJsonBody(payload, { method: 'PATCH' }),
      ),
    refreshCompositionDiagnostics: (id) =>
      requestJson<ApiCompositionDetail>(
        `/compositions/${encodeURIComponent(id)}/diagnostics/refresh`,
        withJsonBody({}, { method: 'POST' }),
      ),
    confirmCompositionProxy: (id, payload: ApiCompositionProxyConfirmationPayload) =>
      requestJson<ApiCompositionDetail>(
        `/compositions/${encodeURIComponent(id)}/proxy-confirmations`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    listCompositionBacktestRuns: async () => {
      const payload = await requestJson<unknown>('/compositions/backtest-runs');
      return unwrapItems<ApiCompositionBacktestRun>(payload).map(mapCompositionBacktestRunItem);
    },
    listCompositionAllocationJobs: async () => {
      const payload = await requestJson<unknown>('/compositions/allocation-jobs');
      return unwrapItems<ApiCompositionAllocationJob>(payload).map(mapCompositionAllocationJobItem);
    },
    createCompositionBacktestRun: (id, payload: ApiCompositionBacktestRunPayload) =>
      requestJson<ApiCompositionBacktestRun>(
        `/compositions/${encodeURIComponent(id)}/backtest-runs`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    getCompositionBacktestRun: (id, runId) =>
      requestJson<ApiCompositionBacktestRun>(
        `/compositions/${encodeURIComponent(id)}/backtest-runs/${encodeURIComponent(runId)}`,
      ),
    getCompositionBacktestOrders: (id, runId, params?: ApiCompositionBacktestOrdersQuery) => {
      const query = new URLSearchParams();
      if (params?.symbol) query.set('symbol', params.symbol);
      if (params?.source_leg) query.set('source_leg', params.source_leg);
      if (params?.scenario) query.set('scenario', params.scenario);
      if (params?.page !== undefined) query.set('page', String(params.page));
      if (params?.page_size !== undefined) query.set('page_size', String(params.page_size));
      const suffix = query.toString();
      return requestJson<ApiCompositionBacktestOrderPage>(
        `/compositions/${encodeURIComponent(id)}/backtest-runs/${encodeURIComponent(runId)}/orders${suffix ? `?${suffix}` : ''}`,
      );
    },
    getCompositionBacktestOrderNetting: (id, runId, orderId) =>
      requestJson<ApiCompositionBacktestOrderNetting>(
        `/compositions/${encodeURIComponent(id)}/backtest-runs/${encodeURIComponent(runId)}/orders/${encodeURIComponent(orderId)}/netting`,
      ),
    exportCompositionBacktestOrders: (
      id,
      runId,
      format: ApiCompositionOrderExportFormat = 'csv',
      params?: { symbol?: string | null; source_leg?: string | null; scenario?: string | null },
    ) => {
      const query = new URLSearchParams();
      query.set('format', format);
      if (params?.symbol) query.set('symbol', params.symbol);
      if (params?.source_leg) query.set('source_leg', params.source_leg);
      if (params?.scenario) query.set('scenario', params.scenario);
      return requestText(
        `/compositions/${encodeURIComponent(id)}/backtest-runs/${encodeURIComponent(runId)}/orders/export?${query.toString()}`,
      );
    },
    createCompositionAllocationJob: (id, payload: ApiCompositionAllocationJobPayload) =>
      requestJson<ApiCompositionAllocationJob>(
        `/compositions/${encodeURIComponent(id)}/allocation-jobs`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    getCompositionAllocationJob: (id, jobId) =>
      requestJson<ApiCompositionAllocationJob>(
        `/compositions/${encodeURIComponent(id)}/allocation-jobs/${encodeURIComponent(jobId)}`,
      ),
    promoteCompositionAllocationCandidateToDraft: (id, jobId, candidateId, payload) =>
      requestJson<ApiCompositionVersion>(
        `/compositions/${encodeURIComponent(id)}/allocation-jobs/${encodeURIComponent(jobId)}/candidates/${encodeURIComponent(candidateId)}/promote-draft`,
        withJsonBody(payload ?? {}, { method: 'POST' }),
      ),
    createCompositionDecisionPacket: (id, payload) =>
      requestJson<ApiCompositionDecisionPacket>(
        `/compositions/${encodeURIComponent(id)}/decision-packets`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    getCompositionDecisionPacket: (id, packetId) =>
      requestJson<ApiCompositionDecisionPacket>(
        `/compositions/${encodeURIComponent(id)}/decision-packets/${encodeURIComponent(packetId)}`,
      ),
    exportCompositionDecisionPacket: (id, packetId, format = 'markdown') =>
      requestText(
        `/compositions/${encodeURIComponent(id)}/decision-packets/${encodeURIComponent(packetId)}/export?format=${encodeURIComponent(format)}`,
      ),
    getSnapshotOverview: () => requestJson<ApiSnapshotOverview>('/data-snapshots/overview'),
    refreshSnapshots: (payload) =>
      requestJson<ApiSnapshotOverview>(
        '/admin/snapshot-refresh-jobs',
        withJsonBody(payload ?? {}, { method: 'POST' }),
      ),
  };
}

export function ApiClientProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const api = useMemo(() => createHttpApiClient(), []);
  return <ApiClientContext.Provider value={api}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): DemoApi {
  const api = useContext(ApiClientContext);
  if (!api) {
    throw new Error('useApiClient 必须在 ApiClientProvider 内使用。');
  }
  return api;
}

export const useDemoApi = useApiClient;
export const DemoStoreProvider = ApiClientProvider;
