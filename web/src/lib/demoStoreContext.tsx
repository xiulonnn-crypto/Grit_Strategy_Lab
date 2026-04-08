import React, { createContext, useContext, useMemo } from 'react';
import { ApiError } from '../types';
import type {
  ApiBacktestRunDetail,
  ApiBacktestRunListItem,
  ApiBacktestRunTradeAudit,
  ApiBacktestRunTradePage,
  ApiBacktestSubmissionPreview,
  ApiConfirmationUpdateRequest,
  ApiOptimizationJobDetail,
  ApiSnapshotOverview,
  ApiStrategyCreationSession,
  ApiStrategyDetail,
  ApiStrategyListItem,
  ApiWorkspaceOverview,
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

function withJsonBody(body: unknown, init?: RequestInit): RequestInit {
  return {
    ...init,
    method: init?.method ?? 'POST',
    body: JSON.stringify(body),
  };
}

function createHttpApiClient(): DemoApi {
  return {
    getWorkspaceOverview: (includeCleanupAudit = false) =>
      requestJson<ApiWorkspaceOverview>(
        `/workspace/overview${includeCleanupAudit ? '?include_cleanup_audit=1' : ''}`,
      ),
    listStrategies: () => requestJson<ApiStrategyListItem[]>('/strategies'),
    getStrategyDetail: (id) => requestJson<ApiStrategyDetail>(`/strategies/${encodeURIComponent(id)}/detail`),
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
    materializeStrategy: (id, idempotencyKey, confirmedRevision) =>
      requestJson<ApiStrategyDetail>(
        `/strategy-creation-sessions/${encodeURIComponent(id)}/materialize`,
        withJsonBody({ idempotency_key: idempotencyKey, confirmed_revision: confirmedRevision }, { method: 'POST' }),
      ),
    listBacktestRuns: (params?: BacktestRunListQuery) => {
      const query = new URLSearchParams();
      if (params?.limit !== undefined) {
        query.set('limit', String(params.limit));
      }
      if (params?.status) {
        query.set('status', params.status);
      }
      const suffix = query.toString();
      return requestJson<ApiBacktestRunListItem[]>(`/backtest-runs${suffix ? `?${suffix}` : ''}`);
    },
    getBacktestRunDetail: (id) => requestJson<ApiBacktestRunDetail>(`/backtest-runs/${encodeURIComponent(id)}/detail`),
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
    getOptimizationJobDetail: (id) => requestJson<ApiOptimizationJobDetail>(`/optimization-jobs/${encodeURIComponent(id)}/detail`),
    createOptimizationJob: (strategyId) =>
      requestJson<ApiOptimizationJobDetail>(`/strategies/${encodeURIComponent(strategyId)}/optimization-jobs`, { method: 'POST' }),
    createOptimizationCandidate: (jobId, payload) =>
      requestJson<ApiOptimizationJobDetail>(
        `/optimization-jobs/${encodeURIComponent(jobId)}/candidates`,
        withJsonBody(payload, { method: 'POST' }),
      ),
    promoteOptimizationCandidate: (jobId, trialId, mode, idempotencyKey, comment) =>
      requestJson<ApiOptimizationJobDetail>(
        `/optimization-jobs/${encodeURIComponent(jobId)}/candidates/${encodeURIComponent(trialId)}/promote`,
        withJsonBody({ idempotency_key: idempotencyKey, mode, comment }, { method: 'POST' }),
      ),
    deleteOptimizationCandidate: (jobId, trialId) =>
      requestJson<ApiOptimizationJobDetail>(
        `/optimization-jobs/${encodeURIComponent(jobId)}/candidates/${encodeURIComponent(trialId)}`,
        { method: 'DELETE' },
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
